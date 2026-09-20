/* ==========================================================================
   Lumina — timer.js
   Focus timer. Modes: Pomodoro 25 · Deep Focus 50 · Deep Work 90 · Custom.

   • Timestamp-based (endAt), so background-tab throttling can't make it drift.
   • The running state is saved to localStorage, so a refresh doesn't lose it.
   • A finished session is saved to IndexedDB (store: sessions) after the
     student says what they studied and rates their focus.
   ========================================================================== */
(() => {
  'use strict';
  const L = (window.Lumina = window.Lumina || {});
  const { esc, dates, fmt, uid, clamp, plural, store } = L.utils;
  const { icon, on, progress, emptyState } = L.ui;
  const S = L.state;
  const A = L.analytics;

  const MODES = {
    pomodoro: { label: 'Pomodoro', minutes: 25 },
    deep: { label: 'Deep Focus', minutes: 50 },
    work: { label: 'Deep Work', minutes: 90 },
    custom: { label: 'Custom', minutes: null },
  };
  const STORE_KEY = 'timer';
  const BASE_TITLE = document.title;
  const RADIUS = 118;
  const CIRC = 2 * Math.PI * RADIUS;

  let t = { mode: 'pomodoro', totalSec: 1500, remainingSec: 1500, status: 'idle', endAt: null, startedAt: null, subjectId: '' };
  let tickId = null;
  let viewRoot = null;

  const minutesFor = (mode) => (mode === 'custom' ? clamp(Number(S.prefs.get('customMinutes')) || 40, 1, 300) : MODES[mode].minutes);
  const remaining = () => (t.status === 'running' ? Math.max(0, Math.ceil((t.endAt - Date.now()) / 1000)) : t.remainingSec);
  const elapsed = () => t.totalSec - remaining();
  const persist = () => store.set(STORE_KEY, t);

  const clockText = (sec) => {
    const s = Math.max(0, sec);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const r = s % 60;
    return h ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
  };

  /* ---------- sound (Web Audio, no files needed) ---------- */
  function chime() {
    if (!S.prefs.get('sound')) return;
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx();
      [523.25, 659.25, 783.99].forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        const t0 = ctx.currentTime + i * 0.18;
        osc.type = 'sine';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.0001, t0);
        gain.gain.exponentialRampToValueAtTime(0.16, t0 + 0.03);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.7);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(t0);
        osc.stop(t0 + 0.75);
      });
      setTimeout(() => ctx.close(), 1800);
    } catch {
      /* audio is a nicety */
    }
  }

  /* ---------- ticking ---------- */
  function startTicking() {
    stopTicking();
    tickId = setInterval(() => {
      paintTick();
      if (t.status === 'running' && Date.now() >= t.endAt) finish(false);
    }, 250);
  }
  function stopTicking() {
    if (tickId) clearInterval(tickId);
    tickId = null;
  }

  /* ---------- state transitions ---------- */
  function start() {
    if (t.status === 'running') return;
    const rem = t.status === 'paused' ? t.remainingSec : t.totalSec;
    if (t.status === 'idle') t.startedAt = Date.now();
    t.remainingSec = rem;
    t.endAt = Date.now() + rem * 1000;
    t.status = 'running';
    persist();
    startTicking();
    renderCard();
    L.ui.toast(elapsed() > 0 ? 'Timer resumed' : 'Focus started. Good luck ✦', { duration: 1800 });
  }

  function pause() {
    if (t.status !== 'running') return;
    t.remainingSec = remaining();
    t.status = 'paused';
    t.endAt = null;
    persist();
    stopTicking();
    renderCard();
    paintTick();
  }

  function resetTimer() {
    stopTicking();
    t = { ...t, status: 'idle', endAt: null, startedAt: null, totalSec: minutesFor(t.mode) * 60 };
    t.remainingSec = t.totalSec;
    persist();
    renderCard();
    paintTick();
  }

  async function reset() {
    if (t.status !== 'idle' && elapsed() >= 60) {
      const ok = await L.ui.confirm({
        title: 'Reset the timer?',
        message: `You've focused for ${fmt.duration(elapsed() / 60)} in this session. Resetting discards it. Use “Finish early” to save it instead.`,
        confirmLabel: 'Reset and discard',
        danger: true,
      });
      if (!ok) return;
    }
    resetTimer();
  }

  /** End the session (naturally or early) and ask what it was for. */
  function finish(early) {
    if (t.status === 'idle') return;
    const focusSec = Math.max(0, early ? elapsed() : t.totalSec);
    const snap = {
      mode: t.mode,
      totalSec: t.totalSec,
      startedAt: t.startedAt || Date.now() - focusSec * 1000,
      subjectId: t.subjectId,
      focusSec,
    };
    resetTimer();
    if (early && focusSec < 60) {
      L.ui.toast('Sessions under one minute aren’t saved.');
      return;
    }
    if (!early) {
      chime();
      if (document.hidden && L.notifications.isEnabled()) L.notifications.notify('Focus session completed ✦', `You focused for ${fmt.duration(focusSec / 60)}.`);
    }
    openCompletion(snap);
  }

  function openCompletion(snap) {
    const m = L.ui.modal({
      title: 'Focus session completed ✦',
      dismissible: false,
      size: 'sm',
      className: 'modal-celebrate',
      body: `<form class="form" data-submit="timer:save" novalidate>
        <p class="session-summary">You focused for <strong>${esc(fmt.duration(snap.focusSec / 60))}</strong>. Let’s log it.</p>
        <label class="field"><span>What did you study?</span><select name="subjectId" autofocus>${S.subjectOptions(snap.subjectId, 'No subject')}</select></label>
        <fieldset class="field"><legend>How productive was this session?</legend>
          <div class="rating" role="radiogroup" aria-label="Productivity from 1 to 5">${[1, 2, 3, 4, 5]
            .map((n) => `<label class="rating-opt"><input type="radio" name="productivity" value="${n}"><span><span class="sr-only">Rating </span>${n}</span></label>`)
            .join('')}</div>
          <small class="hint rating-hint"><span>1 scattered</span><span>5 deeply focused</span></small>
        </fieldset>
        <p class="form-error" role="alert" hidden></p>
        <div class="form-actions"><button type="button" class="btn btn-ghost" data-click="timer:discard">Discard session</button><button type="submit" class="btn btn-primary">Save session</button></div>
      </form>`,
    });
    m.el.__snap = snap;
  }

  on('submit', 'timer:save', async (form) => {
    const layer = form.closest('.modal-layer');
    const snap = layer && layer.__snap;
    if (!snap) return;
    const err = form.querySelector('.form-error');
    const rating = Number((form.querySelector('input[name="productivity"]:checked') || {}).value);
    if (!rating) {
      err.textContent = 'Rate your focus from 1 to 5 so Lumina can learn what works for you.';
      err.hidden = false;
      return;
    }
    const subjectId = form.elements.subjectId.value;
    const record = {
      id: uid(),
      subjectId,
      subjectName: S.subjectName(subjectId, ''),
      startedAt: snap.startedAt,
      endedAt: Date.now(),
      durationSec: snap.focusSec,
      plannedMinutes: Math.round(snap.totalSec / 60),
      mode: snap.mode,
      productivity: rating,
      date: dates.key(snap.startedAt),
    };
    const submit = form.querySelector('[type="submit"]');
    submit.disabled = true;
    try {
      await S.add('sessions', record);
      t.subjectId = subjectId;
      S.prefs.set('lastSubjectId', subjectId);
      persist();
      await L.intelligence.markPlanProgress(subjectId, record.date);
      S.logActivity('session', `Focused ${fmt.duration(snap.focusSec / 60)} on ${record.subjectName || 'a session'}`);
      L.ui.closeModal(form);
      L.ui.toast(`Session saved: ${fmt.duration(snap.focusSec / 60)}`, { type: 'success' });
    } catch (e) {
      console.error(e);
      submit.disabled = false;
      err.textContent = 'Could not save the session. Please try again.';
      err.hidden = false;
    }
  });

  on('click', 'timer:discard', async (btn) => {
    const ok = await L.ui.confirm({ title: 'Discard this session?', message: 'It won’t count toward your study time or streak.', confirmLabel: 'Discard', danger: true });
    if (ok) L.ui.closeModal(btn);
  });

  /* ---------- header pill ---------- */
  function updatePill() {
    const pill = document.getElementById('timer-pill');
    if (!pill) return;
    const active = t.status !== 'idle';
    pill.hidden = !active;
    if (active) {
      const label = `${t.status === 'paused' ? 'Paused' : 'Focus'} ${clockText(remaining())}`;
      pill.querySelector('.pill-text').textContent = label;
      pill.setAttribute('aria-label', `${label}. Open the focus timer.`);
    }
  }

  /* ---------- rendering ---------- */
  function paintTick() {
    const rem = remaining();
    const time = document.getElementById('timer-time');
    if (time) time.textContent = clockText(rem);
    const ring = document.getElementById('timer-ring-fill');
    if (ring) ring.style.strokeDashoffset = String(CIRC * (t.totalSec ? rem / t.totalSec : 1));
    if (t.status === 'running') document.title = `${clockText(rem)} · Lumina`;
    else document.title = t.status === 'paused' ? `Paused ${clockText(rem)} · Lumina` : L.app ? L.app.baseTitle() : BASE_TITLE;
    updatePill();
  }

  function cardHTML() {
    const rem = remaining();
    const idle = t.status === 'idle';
    const statusText = t.status === 'running' ? 'Focusing' : t.status === 'paused' ? 'Paused' : 'Ready when you are';
    const controls = `
      ${
        t.status === 'running'
          ? `<button type="button" class="btn btn-primary btn-lg" data-click="timer:pause">${icon('pause', 20)}<span>Pause</span></button>`
          : `<button type="button" class="btn btn-primary btn-lg" data-click="timer:start">${icon('play', 20)}<span>${t.status === 'paused' ? 'Resume' : 'Start'}</span></button>`
      }
      <button type="button" class="btn btn-soft btn-lg" data-click="timer:reset"${idle && rem === t.totalSec ? ' disabled' : ''}>${icon('reset', 20)}<span>Reset</span></button>`;
    return `
      <div class="mode-chips" role="radiogroup" aria-label="Session length">
        ${Object.entries(MODES)
          .map(
            ([key, m]) =>
              `<button type="button" role="radio" class="mode-chip" aria-checked="${t.mode === key}" data-click="timer:mode" data-mode="${key}"${idle ? '' : ' disabled'}><strong>${m.minutes ? `${m.minutes} min` : 'Custom'}</strong><span>${esc(m.label)}</span></button>`
          )
          .join('')}
      </div>
      ${
        t.mode === 'custom'
          ? `<label class="custom-minutes"><span>Minutes</span><input type="number" min="1" max="300" step="1" value="${minutesFor('custom')}" data-change="timer:custom"${idle ? '' : ' disabled'}></label>`
          : ''
      }
      <div class="timer-ring">
        <svg viewBox="0 0 260 260" aria-hidden="true">
          <circle class="ring-track" cx="130" cy="130" r="${RADIUS}"/>
          <circle id="timer-ring-fill" class="ring-fill" cx="130" cy="130" r="${RADIUS}" style="stroke-dasharray:${CIRC};stroke-dashoffset:${CIRC * (t.totalSec ? rem / t.totalSec : 1)}" transform="rotate(-90 130 130)"/>
        </svg>
        <div class="timer-face">
          <span class="timer-star" aria-hidden="true">✦</span>
          <span id="timer-time" class="timer-time" role="timer">${clockText(rem)}</span>
          <span class="timer-state">${statusText}</span>
        </div>
      </div>
      <label class="field timer-subject"><span>Studying</span><select data-change="timer:subject">${S.subjectOptions(t.subjectId, 'Choose after the session')}</select></label>
      <div class="timer-controls">${controls}</div>
      ${!idle && elapsed() >= 60 ? `<button type="button" class="link-btn" data-click="timer:finish">Finish early and save ${esc(fmt.duration(elapsed() / 60))}</button>` : ''}`;
  }

  function renderCard() {
    const host = document.getElementById('timer-card');
    if (host) {
      host.dataset.status = t.status;
      host.innerHTML = cardHTML();
    }
    updatePill();
  }

  function sideHTML() {
    const today = dates.today();
    const list = S.get('sessions').filter((s) => A.sessionDate(s) === today).sort((a, b) => b.startedAt - a.startedAt);
    const mins = A.dayMinutes(today);
    const pct = Math.min(100, (mins / A.STREAK_MIN) * 100);
    const st = A.streaks();
    const streakLine = st.todayQualified
      ? `Today counts toward your streak. ${st.current ? `That's ${plural(st.current, 'day')} in a row.` : ''}`
      : `${Math.ceil(A.STREAK_MIN - mins)} more minutes make today count toward your streak.`;
    return `<section class="panel">
        <div class="panel-head"><h3>Today</h3><span class="panel-sub">${esc(fmt.duration(mins))} studied</span></div>
        ${progress(pct, { label: 'Progress toward today’s streak minimum' })}
        <p class="fine-print">${esc(streakLine)}</p>
        ${
          list.length
            ? `<ul class="session-list">${list
                .map(
                  (s) => `<li>
                    <div><strong>${esc(s.subjectName || S.subjectName(s.subjectId, 'No subject'))}</strong>
                    <span class="muted">${esc(fmt.clockTime(s.startedAt))}, ${esc(fmt.duration(A.minutesOf(s)))}${s.productivity ? `, focus ${s.productivity}/5` : ''}</span></div>
                    <button type="button" class="icon-btn" data-click="timer:delete-session" data-id="${esc(s.id)}" aria-label="Delete this session" data-tip="Delete">${icon('trash', 16)}</button>
                  </li>`
                )
                .join('')}</ul>`
            : emptyState({ icon: '⏱', title: 'No sessions yet today', text: 'Start the timer and your first session appears here.' })
        }
      </section>`;
  }

  function renderSide() {
    const host = document.getElementById('focus-side');
    if (host) host.innerHTML = sideHTML();
  }

  /* ---------- handlers ---------- */
  on('click', 'timer:start', start);
  on('click', 'timer:pause', pause);
  on('click', 'timer:reset', reset);
  on('click', 'timer:finish', () => finish(true));

  on('click', 'timer:mode', (btn) => {
    if (t.status !== 'idle') return;
    t.mode = btn.dataset.mode;
    t.totalSec = minutesFor(t.mode) * 60;
    t.remainingSec = t.totalSec;
    S.prefs.set('timerMode', t.mode);
    persist();
    renderCard();
    document.querySelector(`.mode-chip[data-mode="${t.mode}"]`)?.focus();
  });

  on('change', 'timer:custom', (input) => {
    const minutes = clamp(Math.round(Number(input.value)) || 25, 1, 300);
    input.value = minutes;
    S.prefs.set('customMinutes', minutes);
    if (t.status === 'idle' && t.mode === 'custom') {
      t.totalSec = minutes * 60;
      t.remainingSec = t.totalSec;
      persist();
      paintTick();
    }
  });

  on('change', 'timer:subject', (sel) => {
    t.subjectId = sel.value;
    S.prefs.set('lastSubjectId', sel.value);
    persist();
  });

  on('click', 'timer:delete-session', async (btn) => {
    const s = S.find('sessions', btn.dataset.id);
    if (!s) return;
    const ok = await L.ui.confirm({
      title: 'Delete this session?',
      message: `${fmt.duration(A.minutesOf(s))} will be removed from your study time, streak and analytics.`,
      confirmLabel: 'Delete session',
      danger: true,
    });
    if (!ok) return;
    await S.remove('sessions', s.id);
    L.ui.toast('Session deleted');
  });

  /** Jump to the timer with a subject and/or length preselected (used by Subjects, Plan and Insights). */
  function prepare({ subjectId, minutes } = {}) {
    if (t.status !== 'idle') {
      L.ui.toast('Finish or reset the current session first.');
      location.hash = '#/focus';
      return;
    }
    if (subjectId !== undefined) {
      t.subjectId = S.find('subjects', subjectId) ? subjectId : '';
      S.prefs.set('lastSubjectId', t.subjectId);
    }
    if (minutes) {
      const m = clamp(Math.round(minutes), 1, 300);
      const preset = Object.entries(MODES).find(([, mode]) => mode.minutes === m);
      if (preset) t.mode = preset[0];
      else {
        t.mode = 'custom';
        S.prefs.set('customMinutes', m);
      }
      S.prefs.set('timerMode', t.mode);
      t.totalSec = m * 60;
      t.remainingSec = t.totalSec;
    }
    persist();
    if (location.hash === '#/focus') {
      renderCard();
      paintTick();
    } else location.hash = '#/focus';
  }

  /** Restore the timer after a reload. */
  function init() {
    const mode = MODES[S.prefs.get('timerMode')] ? S.prefs.get('timerMode') : 'pomodoro';
    t = { mode, totalSec: minutesFor(mode) * 60, remainingSec: minutesFor(mode) * 60, status: 'idle', endAt: null, startedAt: null, subjectId: S.find('subjects', S.prefs.get('lastSubjectId')) ? S.prefs.get('lastSubjectId') : '' };
    const saved = store.get(STORE_KEY, null);
    if (saved && (saved.status === 'running' || saved.status === 'paused') && Number.isFinite(saved.totalSec) && MODES[saved.mode]) {
      t = { ...t, ...saved, subjectId: S.find('subjects', saved.subjectId) ? saved.subjectId : '' };
      if (t.status === 'running') {
        if (t.endAt <= Date.now()) setTimeout(() => finish(false), 600);
        else startTicking();
      }
    }
    updatePill();
    paintTick();
  }

  const view = {
    title: 'Focus',
    render(root) {
      viewRoot = root;
      root.innerHTML = `
        <div class="page-head"><div><h2 class="page-title">Focus</h2><p class="lede">One thing at a time. Your session is saved when you finish it.</p></div></div>
        <div class="focus-layout">
          <section class="timer-card" id="timer-card" aria-label="Focus timer"></section>
          <aside id="focus-side" aria-label="Today’s sessions"></aside>
        </div>`;
      renderCard();
      renderSide();
      paintTick();
    },
    update() {
      renderSide();
      const card = document.getElementById('timer-card');
      if (card && !card.contains(document.activeElement)) {
        // refresh subject options when subjects change without stealing focus
        const sel = card.querySelector('.timer-subject select');
        if (sel) sel.innerHTML = S.subjectOptions(t.subjectId, 'Choose after the session');
      }
    },
  };

  L.views = L.views || {};
  L.views.focus = view;
  L.timer = { init, prepare, status: () => t.status, start, pause };
})();
