/* ==========================================================================
   Lumina — app.js
   Bootstrap and shell: router, onboarding, settings page, online indicator,
   sidebar / header behaviour. Loaded last; everything else registers itself
   on window.Lumina first.
   ========================================================================== */
(() => {
  'use strict';
  const L = (window.Lumina = window.Lumina || {});
  const { esc, dates, fmt, plural, palette, uid, clamp } = L.utils;
  const { icon, on, dropdown } = L.ui;
  const S = L.state;

  const ROUTES = {
    dashboard: 'Dashboard',
    subjects: 'Subjects',
    tasks: 'Tasks',
    focus: 'Focus',
    notes: 'Notes',
    ai: 'AI Study',
    analytics: 'Analytics',
    settings: 'Settings',
    privacy: 'Privacy',
  };
  const $ = (id) => document.getElementById(id);

  let current = null;
  let navToken = 0;
  let firstRoute = true;
  let lastDay = dates.today();

  /* ---------- shell ---------- */
  function applyPrefs() {
    document.documentElement.dataset.accent = S.prefs.get('accent') || 'blush';
    const collapsed = Boolean(S.prefs.get('sidebarCollapsed'));
    $('app').dataset.collapsed = String(collapsed);
    const btn = $('collapse-btn');
    if (btn) {
      btn.setAttribute('aria-pressed', String(collapsed));
      btn.setAttribute('aria-label', collapsed ? 'Expand sidebar' : 'Collapse sidebar');
      btn.setAttribute('data-tip', collapsed ? 'Expand sidebar' : 'Collapse sidebar');
    }
  }

  function updateNet() {
    const online = navigator.onLine;
    const pill = $('net-pill');
    if (pill) {
      pill.className = `net-pill ${online ? 'is-online' : 'is-offline'}`;
      pill.querySelector('.txt').textContent = online ? 'Online' : 'Offline';
    }
    const side = $('net-status');
    if (side) {
      side.className = `status-line ${online ? 'is-online' : 'is-offline'}`;
      side.querySelector('.txt').textContent = online ? 'Online. Works offline too' : 'Offline mode';
      side.querySelector('.dot').textContent = online ? '●' : '○';
    }
  }

  function updateBadges() {
    const overdue = L.analytics.taskStats().overdue;
    const badge = $('badge-tasks');
    if (badge) {
      badge.hidden = overdue === 0;
      badge.textContent = String(overdue);
      badge.setAttribute('aria-label', `${overdue} overdue`);
    }
  }

  function setActiveNav() {
    document.querySelectorAll('[data-route]').forEach((a) => {
      if (a.dataset.route === current) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
  }

  /* ---------- router ---------- */
  let skipNextHashChange = false;
  /** Set the URL hash without adding a history entry. Some browsers refuse replaceState on file:// pages. */
  function setHash(route) {
    try {
      history.replaceState(null, '', `#/${route}`);
    } catch {
      skipNextHashChange = true;
      location.replace(`#/${route}`);
    }
  }

  async function navigate() {
    const token = ++navToken;
    const raw = location.hash.replace(/^#\/?/, '').split('/')[0];
    let route = ROUTES[raw] && L.views[raw] ? raw : null;
    if (!route) {
      const saved = S.prefs.get('lastPage');
      route = ROUTES[saved] && L.views[saved] ? saved : 'dashboard';
      setHash(route);
    }
    const prev = current && L.views[current];
    if (prev && prev.destroy) {
      try {
        await prev.destroy();
      } catch (err) {
        console.error(err);
      }
    }
    if (token !== navToken) return;
    current = route;
    S.prefs.set('lastPage', route, { silent: true });
    renderCurrent(true);
  }

  function renderCurrent(fresh) {
    const view = L.views[current];
    const root = $('view');
    if (!view || !root) return;
    root.className = 'view';
    root.dataset.page = current;
    if (fresh) {
      void root.offsetWidth; // restart the entrance animation
      root.classList.add('page-enter');
      root.dataset.fresh = '1';
      setTimeout(() => delete root.dataset.fresh, 1200);
    }
    view.render(root);
    $('page-title').textContent = view.title;
    document.title = `${view.title} · Lumina`;
    setActiveNav();
    if (fresh) {
      window.scrollTo(0, 0);
      if (!firstRoute) root.focus({ preventScroll: true });
    }
    firstRoute = false;
  }

  /* ---------- fatal storage error ---------- */
  function showFatal(err) {
    console.error(err);
    $('view').innerHTML = `<div class="panel fatal">
      <h2 class="page-title">Lumina can’t open its local storage</h2>
      <p>${esc(err && err.message ? err.message : 'Unknown error')}</p>
      <p class="fine-print">This usually happens in a private/incognito window or when the browser blocks site data. Open Lumina in a normal window, allow site data, and reload.</p>
      <button type="button" class="btn btn-primary" data-click="app:reload">Try again</button>
    </div>`;
    const s = $('storage-status');
    if (s) {
      s.querySelector('.dot').textContent = '○';
      s.querySelector('.txt').textContent = 'Local storage unavailable';
    }
  }
  on('click', 'app:reload', () => location.reload());

  /* ---------- generic actions ---------- */
  on('click', 'nav:go', (el) => {
    location.hash = `#/${el.dataset.page}`;
  });
  on('click', 'sidebar:toggle', () => S.prefs.set('sidebarCollapsed', !S.prefs.get('sidebarCollapsed')));
  on('click', 'quick:task', () => L.tasks.openForm());
  on('click', 'quick:note', () => L.notes.create());
  on('click', 'quick:subject', () => L.subjects.openForm());
  on('click', 'quick:focus', () => {
    location.hash = '#/focus';
  });

  /* ---------- onboarding ---------- */
  const SUGGESTED_SUBJECTS = ['Computer Networks', 'Theory of Computation', 'AI & ML', 'Java', 'DBMS', 'Aptitude'];

  function showOnboarding() {
    const existing = new Set(S.get('subjects').map((s) => s.name.toLowerCase()));
    const st = { step: 0, name: S.prefs.get('name') || '', goal: S.prefs.get('weeklyGoalHours') || 20, picked: [], custom: [], error: '' };
    const TOTAL = 4;
    const m = L.ui.modal({ title: 'Welcome to Lumina', size: 'lg', dismissible: false, className: 'modal-onboarding', body: '' });
    const body = m.body;

    const dots = () =>
      `<div class="ob-dots" role="img" aria-label="Step ${st.step + 1} of ${TOTAL}">${Array.from({ length: TOTAL }, (_, i) => `<span class="${i === st.step ? 'is-active' : i < st.step ? 'is-done' : ''}"></span>`).join('')}</div>`;

    const chips = () =>
      [...SUGGESTED_SUBJECTS, ...st.custom]
        .filter((n) => !existing.has(n.toLowerCase()))
        .map((n) => `<button type="button" class="pick-chip" aria-pressed="${st.picked.includes(n)}" data-ob="toggle" data-name="${esc(n)}">${esc(n)}</button>`)
        .join('');

    const steps = [
      () => `<div class="ob-step ob-welcome">
          <span class="ob-mark" aria-hidden="true">✦</span>
          <h3 class="ob-title">Welcome to Lumina ✦</h3>
          <p class="ob-lede">Your private offline study companion.</p>
          <p class="ob-tag">Learn quietly. Track deeply. Grow consistently.</p>
          <div class="ob-actions"><button type="button" class="btn btn-primary btn-lg" data-ob="next" autofocus>Get started</button></div>
        </div>`,
      () => `<div class="ob-step">
          <h3 class="ob-title">What should we call you?</h3>
          <label class="field"><span class="sr-only">Your name</span><input class="ob-input" name="ob-name" maxlength="40" autocomplete="given-name" placeholder="Your name" value="${esc(st.name)}" autofocus></label>
          <p class="fine-print">Only stored on this device. You can change it in Settings.</p>
          <div class="ob-actions"><button type="button" class="btn btn-ghost" data-ob="back">Back</button><button type="button" class="btn btn-primary" data-ob="next">Continue</button></div>
        </div>`,
      () => `<div class="ob-step">
          <h3 class="ob-title">What is your weekly study goal?</h3>
          <div class="ob-goal"><input class="ob-input ob-input-num" type="number" name="ob-goal" min="1" max="100" step="0.5" value="${esc(st.goal)}" aria-label="Weekly study goal in hours" autofocus><span>hours a week</span></div>
          <div class="chip-row">${[10, 15, 20, 25, 30].map((n) => `<button type="button" class="pick-chip" aria-pressed="${Number(st.goal) === n}" data-ob="goal" data-value="${n}">${n}h</button>`).join('')}</div>
          <p class="form-error" role="alert"${st.error ? '' : ' hidden'}>${esc(st.error)}</p>
          <div class="ob-actions"><button type="button" class="btn btn-ghost" data-ob="back">Back</button><button type="button" class="btn btn-primary" data-ob="next">Continue</button></div>
        </div>`,
      () => `<div class="ob-step">
          <h3 class="ob-title">Add your first subjects.</h3>
          <p class="ob-lede">Pick a few, or type your own. You can change them any time.</p>
          <div class="chip-row" id="ob-chips">${chips()}</div>
          <div class="ob-custom"><input class="ob-input" name="ob-custom" maxlength="60" placeholder="Another subject" aria-label="Add another subject" autocomplete="off"><button type="button" class="btn btn-soft" data-ob="add">Add</button></div>
          <div class="ob-actions"><button type="button" class="btn btn-ghost" data-ob="back">Back</button><button type="button" class="btn btn-primary btn-lg" data-ob="finish">Enter Lumina →</button></div>
        </div>`,
    ];

    const paint = () => {
      body.innerHTML = `${dots()}${steps[st.step]()}`;
      const auto = body.querySelector('[autofocus]') || body.querySelector('input, button');
      if (auto) auto.focus({ preventScroll: true });
    };

    async function finish() {
      const name = st.name.trim().slice(0, 40);
      S.prefs.setMany({ name, weeklyGoalHours: clamp(Number(st.goal) || 20, 1, 100), onboarded: true });
      const used = new Set(S.get('subjects').map((s) => s.name.toLowerCase()));
      let i = S.get('subjects').length;
      for (const n of st.picked) {
        if (used.has(n.toLowerCase())) continue;
        await S.add('subjects', { id: uid(), name: n, color: palette[i % palette.length].fill, description: '', targetHours: 30, createdAt: Date.now() });
        i += 1;
      }
      m.close();
      L.ui.toast(`Welcome to Lumina${name ? `, ${name}` : ''} ✦`, { type: 'success' });
      location.hash = '#/dashboard';
      renderCurrent(false);
    }

    const addCustom = () => {
      const input = body.querySelector('[name="ob-custom"]');
      const value = input.value.trim().slice(0, 60);
      if (!value) return;
      const known = [...SUGGESTED_SUBJECTS, ...st.custom].find((n) => n.toLowerCase() === value.toLowerCase());
      const name = known || value;
      if (!known) st.custom.push(name);
      if (!st.picked.includes(name)) st.picked.push(name);
      body.querySelector('#ob-chips').innerHTML = chips();
      input.value = '';
      input.focus();
    };

    m.el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-ob]');
      if (!b) return;
      switch (b.dataset.ob) {
        case 'next': {
          if (st.step === 2) {
            const g = Number(st.goal);
            if (!Number.isFinite(g) || g < 1 || g > 100) {
              st.error = 'Choose a goal between 1 and 100 hours.';
              paint();
              return;
            }
            st.error = '';
          }
          st.step = Math.min(TOTAL - 1, st.step + 1);
          paint();
          break;
        }
        case 'back':
          st.step = Math.max(0, st.step - 1);
          paint();
          break;
        case 'goal':
          st.goal = Number(b.dataset.value);
          body.querySelector('[name="ob-goal"]').value = st.goal;
          body.querySelectorAll('[data-ob="goal"]').forEach((c) => c.setAttribute('aria-pressed', String(Number(c.dataset.value) === st.goal)));
          break;
        case 'toggle': {
          const n = b.dataset.name;
          st.picked = st.picked.includes(n) ? st.picked.filter((x) => x !== n) : [...st.picked, n];
          b.setAttribute('aria-pressed', String(st.picked.includes(n)));
          break;
        }
        case 'add':
          addCustom();
          break;
        case 'finish':
          b.disabled = true;
          finish().catch((err) => {
            console.error(err);
            b.disabled = false;
            L.ui.toast('Something went wrong while saving. Please try again.', { type: 'error' });
          });
          break;
        default:
      }
    });
    m.el.addEventListener('input', (e) => {
      if (e.target.name === 'ob-name') st.name = e.target.value;
      if (e.target.name === 'ob-goal') {
        st.goal = e.target.value;
        body.querySelectorAll('[data-ob="goal"]').forEach((c) => c.setAttribute('aria-pressed', String(Number(c.dataset.value) === Number(st.goal))));
      }
    });
    m.el.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || !e.target.matches('input')) return;
      e.preventDefault();
      if (e.target.name === 'ob-custom') addCustom();
      else if (st.step < TOTAL - 1) body.querySelector('[data-ob="next"]').click();
      else body.querySelector('[data-ob="finish"]').click();
    });
    paint();
  }

  /* ---------- settings page ---------- */
  const switchHTML = (key, isOn, label, desc) => `<div class="switch-row">
      <div><strong id="sw-${key}">${label}</strong><p class="fine-print" id="sw-desc-${key}">${desc}</p></div>
      <button type="button" role="switch" class="switch" aria-checked="${isOn}" aria-labelledby="sw-${key}" data-click="settings:switch" data-key="${key}"><span class="switch-knob"></span><span class="switch-text">${isOn ? 'On' : 'Off'}</span></button>
    </div>`;

  const notifDesc = () => {
    if (!S.prefs.get('notifications')) return 'Get a reminder 10 minutes before each block in your daily plan.';
    const p = L.notifications.permission();
    if (p === 'granted') return 'Reminders arrive 10 minutes before each planned block, while Lumina is open.';
    return 'Your browser isn’t allowing system notifications here, so reminders appear inside Lumina instead.';
  };

  const settingsView = {
    title: 'Settings',
    render(root) {
      const p = S.prefs.all();
      const accents = [['blush', 'Blush', '#FFD9E8'], ['lavender', 'Lavender', '#E8D9FF'], ['sage', 'Sage', '#DCEFE5']];
      root.innerHTML = `
        <div class="page-head"><div><h2 class="page-title">Settings</h2><p class="lede">Small choices that make Lumina yours. All stored on this device.</p></div></div>
        <div class="settings-grid">
          <section class="panel"><div class="panel-head"><h3>Profile</h3></div>
            <label class="field"><span>Your name</span><input type="text" maxlength="40" value="${esc(p.name)}" data-change="settings:name" autocomplete="given-name"></label>
            <label class="field"><span>Weekly study goal (hours)</span><input type="number" min="1" max="100" step="0.5" value="${esc(p.weeklyGoalHours)}" data-change="settings:goal"></label>
          </section>
          <section class="panel"><div class="panel-head"><h3>Appearance</h3></div>
            <p class="fine-print">Choose an accent. Lumina stays light and calm either way.</p>
            <div class="accent-row" role="group" aria-label="Accent colour">${accents
              .map(([k, label, c]) => `<button type="button" class="accent-choice" aria-pressed="${p.accent === k}" data-click="settings:accent" data-key="${k}"><span style="background:${c}" aria-hidden="true"></span>${label}</button>`)
              .join('')}</div>
          </section>
          <section class="panel"><div class="panel-head"><h3>Focus timer</h3></div>
            <label class="field"><span>Custom session length (minutes)</span><input type="number" min="1" max="300" step="1" value="${esc(p.customMinutes)}" data-change="settings:custom"></label>
            ${switchHTML('sound', Boolean(p.sound), 'Completion chime', 'Play a soft sound when a session ends.')}
            <p class="fine-print">A day counts toward your streak once you’ve studied ${L.analytics.STREAK_MIN} minutes.</p>
          </section>
          <section class="panel"><div class="panel-head"><h3>Notifications</h3></div>
            ${switchHTML('notifications', Boolean(p.notifications), 'Study reminders', notifDesc())}
            <button type="button" class="btn btn-soft btn-sm" data-click="settings:test">${icon('bell', 16)}<span>Send a test reminder</span></button>
          </section>
          <section class="panel"><div class="panel-head"><h3>Your data</h3></div>
            <p>Everything lives in this browser. Export a copy any time, or review what’s stored.</p>
            <div class="btn-row">
              <button type="button" class="btn btn-soft" data-click="backup:export">${icon('download', 18)}<span>Export My Data</span></button>
              <button type="button" class="btn btn-ghost" data-click="nav:go" data-page="privacy">${icon('lock', 18)}<span>Privacy center</span></button>
            </div>
          </section>
          <section class="panel"><div class="panel-head"><h3>About Lumina</h3></div>
            <p class="fine-print">Lumina 1.0. Built with plain HTML, CSS and JavaScript. It works offline once loaded and never sends your data anywhere.</p>
            <button type="button" class="btn btn-danger-soft" data-click="backup:clear">${icon('trash', 18)}<span>Reset application</span></button>
          </section>
        </div>`;
    },
  };

  on('change', 'settings:name', (el) => {
    S.prefs.set('name', el.value.trim().slice(0, 40));
    L.ui.toast('Name saved', { duration: 1600 });
  });
  on('change', 'settings:goal', (el) => {
    const v = clamp(Number(el.value) || 20, 1, 100);
    el.value = v;
    S.prefs.set('weeklyGoalHours', v);
    L.ui.toast('Weekly goal saved', { duration: 1600 });
  });
  on('change', 'settings:custom', (el) => {
    const v = clamp(Math.round(Number(el.value)) || 40, 1, 300);
    el.value = v;
    S.prefs.set('customMinutes', v);
    L.ui.toast('Timer length saved', { duration: 1600 });
  });
  on('click', 'settings:accent', (btn) => {
    S.prefs.set('accent', btn.dataset.key);
    document.querySelectorAll('.accent-choice').forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
  });
  on('click', 'settings:switch', async (btn) => {
    const key = btn.dataset.key;
    const next = btn.getAttribute('aria-checked') !== 'true';
    if (key === 'notifications') await L.notifications.setEnabled(next);
    else S.prefs.set(key, next);
    const actual = Boolean(S.prefs.get(key));
    btn.setAttribute('aria-checked', String(actual));
    btn.querySelector('.switch-text').textContent = actual ? 'On' : 'Off';
    if (key === 'notifications') document.getElementById('sw-desc-notifications').textContent = notifDesc();
  });
  on('click', 'settings:test', () => L.notifications.notify('Your 7:00 PM study session starts in 10 minutes.', 'This is a test reminder.'));

  /* ---------- boot ---------- */
  function buildHeader() {
    $('today-label').textContent = fmt.longDate();
    $('quick-add').innerHTML = dropdown({
      trigger: 'button',
      buttonText: 'Quick add',
      label: 'Quick add',
      items: [
        { label: 'New task', action: 'quick:task', icon: 'check' },
        { label: 'New note', action: 'quick:note', icon: 'note' },
        { label: 'New subject', action: 'quick:subject', icon: 'book' },
        { label: 'Start focus', action: 'quick:focus', icon: 'timer' },
      ],
    });
    document.querySelectorAll('[data-icon]').forEach((el) => {
      el.innerHTML = icon(el.dataset.icon, 22);
    });
  }

  function refresh() {
    applyPrefs();
    updateBadges();
    renderCurrent(false);
  }

  async function boot() {
    L.ui.init();
    applyPrefs();
    buildHeader();
    updateNet();
    window.addEventListener('online', updateNet);
    window.addEventListener('offline', updateNet);
    window.addEventListener('hashchange', () => {
      if (skipNextHashChange) {
        skipNextHashChange = false;
        return;
      }
      navigate();
    });

    try {
      await L.db.open();
      await S.load();
    } catch (err) {
      showFatal(err);
      return;
    }

    S.subscribe((reasons) => {
      if (reasons.includes('prefs')) applyPrefs();
      const view = L.views[current];
      if (view && view.update) view.update(reasons);
      updateBadges();
      if (reasons.some((r) => ['sessions', 'tasks', 'notes', 'load'].includes(r))) L.analytics.checkAchievements().catch((e) => console.error(e));
    });

    L.notifications.init();
    L.timer.init();
    L.backup.initDropZone();
    await L.analytics.checkAchievements();
    updateBadges();
    await navigate();
    if (!S.prefs.get('onboarded')) showOnboarding();

    setInterval(() => {
      if (dates.today() === lastDay) return;
      lastDay = dates.today();
      $('today-label').textContent = fmt.longDate();
      const view = L.views[current];
      if (view && view.update) view.update(['day']);
    }, 60000);
  }

  L.views = L.views || {};
  L.views.settings = settingsView;
  L.app = { refresh, baseTitle: () => `${(L.views[current] || {}).title || 'Lumina'} · Lumina` };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
