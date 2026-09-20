/* ==========================================================================
   Lumina — intelligence.js
   "Lumina Study Intelligence": a transparent, rule-based study engine.
   There is NO language model here. It reads your stored sessions, tasks,
   subjects and streak, and turns them into recommendations and a suggested
   daily schedule using simple, explainable rules.
   ========================================================================== */
(() => {
  'use strict';
  const L = (window.Lumina = window.Lumina || {});
  const { dates, fmt, esc, plural, uid, clamp } = L.utils;
  const { icon, on, tabs, emptyState, progress } = L.ui;
  const S = L.state;
  const A = L.analytics;

  /* ---------- patterns ---------- */
  /** The 2-hour window where you have historically studied most effectively. */
  function bestWindow() {
    const sessions = S.get('sessions');
    if (sessions.length < 4) return null;
    const score = Array(24).fill(0);
    const count = Array(24).fill(0);
    for (const s of sessions) {
      const h = new Date(s.startedAt).getHours();
      score[h] += A.minutesOf(s) * (s.productivity || 3);
      count[h] += 1;
    }
    let best = null;
    for (let h = 0; h < 23; h += 1) {
      const sc = score[h] + score[h + 1];
      const n = count[h] + count[h + 1];
      if (n >= 2 && (!best || sc > best.score)) best = { startHour: h, endHour: h + 2, score: sc, sessions: n };
    }
    return best;
  }

  const getPlan = (key) => S.getSetting(`plan:${key}`, null);
  const savePlan = (plan) => S.setSetting(`plan:${plan.date}`, plan);

  /** Completed / planned blocks this week (days up to today only). */
  function weekPlanStats() {
    const today = dates.today();
    let total = 0;
    let done = 0;
    for (const key of dates.weekKeys()) {
      if (key > today) continue;
      const plan = getPlan(key);
      if (!plan) continue;
      total += plan.items.length;
      done += plan.items.filter((i) => i.done).length;
    }
    return { total, done };
  }

  /** A finished focus session ticks off the first matching block in today's plan. */
  async function markPlanProgress(subjectId, dateKey = dates.today()) {
    const plan = getPlan(dateKey);
    if (!plan) return false;
    const item = plan.items.find((i) => !i.done && (i.subjectId || '') === (subjectId || ''));
    if (!item) return false;
    item.done = true;
    await savePlan(plan);
    return true;
  }

  function daySummary(key = dates.today()) {
    const plan = getPlan(key);
    const total = plan ? plan.items.length : 0;
    const done = plan ? plan.items.filter((i) => i.done).length : 0;
    return { plan, total, done };
  }

  /* ---------- insights ---------- */
  function insights() {
    const out = [];
    const subjects = S.get('subjects');
    const sessions = S.get('sessions');
    const today = dates.today();
    const stats = A.subjectStats();
    const tasks = S.get('tasks');

    if (!subjects.length) {
      return [
        {
          kind: 'tip',
          weight: 100,
          text: 'Add your first subject so Lumina has something to learn from.',
          action: { label: 'Add a subject', type: 'nav', page: 'subjects' },
        },
      ];
    }

    if (!sessions.length) {
      out.push({
        kind: 'tip',
        weight: 90,
        text: 'Finish your first focus session to unlock pattern-based insights like your best study hours and focus trends.',
        action: { label: 'Start a session', type: 'nav', page: 'focus' },
      });
    }

    // 1. subjects that have been left alone
    stats
      .filter((s) => s.daysSince !== null && s.daysSince >= 3)
      .sort((a, b) => b.daysSince - a.daysSince)
      .slice(0, 2)
      .forEach((s) =>
        out.push({
          kind: 'nudge',
          weight: 60 + Math.min(s.daysSince, 20),
          text: `You haven't studied ${s.subject.name} in ${s.daysSince} days.`,
          detail: s.tasksOpen ? `${plural(s.tasksOpen, 'open task')} are waiting there.` : '',
          action: { label: `Study ${s.subject.name}`, type: 'focus', subjectId: s.subject.id },
        })
      );
    stats
      .filter((s) => s.daysSince === null && sessions.length && (s.tasksOpen || Number(s.subject.targetHours) > 0))
      .slice(0, 1)
      .forEach((s) =>
        out.push({
          kind: 'nudge',
          weight: 55,
          text: `${s.subject.name} has no study time logged yet.`,
          action: { label: `Study ${s.subject.name}`, type: 'focus', subjectId: s.subject.id },
        })
      );

    // 2. overdue rate by subject
    const overdueRank = stats
      .filter((s) => s.overdue > 0 && s.tasksTotal > 0)
      .map((s) => ({ s, rate: s.overdue / s.tasksTotal }))
      .sort((a, b) => b.rate - a.rate || b.s.overdue - a.s.overdue);
    if (overdueRank.length) {
      const { s } = overdueRank[0];
      out.push({
        kind: 'warn',
        weight: 75,
        text: `Your ${s.subject.name} tasks have the highest overdue rate: ${s.overdue} of ${s.tasksTotal} are past due.`,
        action: { label: 'Review tasks', type: 'nav', page: 'tasks' },
      });
    }

    // 3. deadlines
    const open = tasks.filter((t) => !t.completed);
    const overdue = open.filter((t) => t.dueDate && t.dueDate < today);
    const soon = open.filter((t) => t.dueDate && dates.diffDays(today, t.dueDate) >= 0 && dates.diffDays(today, t.dueDate) <= 2);
    if (overdue.length) {
      const quick = overdue.slice().sort((a, b) => (a.estimatedMinutes || 999) - (b.estimatedMinutes || 999))[0];
      out.push({
        kind: 'warn',
        weight: 80,
        text: `${plural(overdue.length, 'task')} ${overdue.length === 1 ? 'is' : 'are'} overdue.`,
        detail: `The quickest win is “${quick.title}”${quick.estimatedMinutes ? ` (about ${fmt.duration(quick.estimatedMinutes)})` : ''}.`,
        action: { label: 'Open overdue', type: 'nav', page: 'tasks' },
      });
    }
    if (soon.length) {
      const first = soon.slice().sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0];
      out.push({
        kind: 'nudge',
        weight: 70,
        text: `${plural(soon.length, 'task')} ${soon.length === 1 ? 'is' : 'are'} due within 2 days.`,
        detail: `Start with “${first.title}” (${fmt.dueLabel(first.dueDate).toLowerCase()}).`,
        action: { label: 'Plan my day', type: 'plan' },
      });
    }

    // 4. best study window
    const win = bestWindow();
    if (win) {
      out.push({
        kind: 'tip',
        weight: 45,
        text: `You usually study most effectively between ${fmt.hour12(win.startHour)} and ${fmt.hour12(win.endHour)}.`,
        detail: `Based on ${plural(win.sessions, 'session')} weighted by your focus ratings.`,
      });
    }

    // 5. planned sessions completed
    const wp = weekPlanStats();
    if (wp.total > 0) {
      const pct = Math.round((wp.done / wp.total) * 100);
      out.push({
        kind: pct >= 70 ? 'praise' : 'tip',
        weight: 50,
        text: `You completed ${pct}% of your planned study sessions this week.`,
        detail: `${wp.done} of ${wp.total} planned blocks done.`,
      });
    }

    // 6. streak
    const st = A.streaks();
    const todayMin = A.dayMinutes(today);
    if (!st.todayQualified && st.current > 0) {
      out.push({
        kind: 'nudge',
        weight: 85,
        text: `You're ${Math.ceil(A.STREAK_MIN - todayMin)} minutes away from keeping your ${st.current}-day streak alive today.`,
        action: { label: 'Start a session', type: 'nav', page: 'focus' },
      });
    } else if (!st.todayQualified && st.current === 0 && sessions.length) {
      out.push({
        kind: 'nudge',
        weight: 58,
        text: `A ${A.STREAK_MIN}-minute session today starts a new streak.`,
        action: { label: 'Start a session', type: 'nav', page: 'focus' },
      });
    } else if (st.todayQualified && st.current >= 2) {
      out.push({ kind: 'praise', weight: 40, text: `${st.current}-day streak and today already counts. Nicely steady.` });
    }

    // 7. weekly goal pace
    const goal = Number(S.prefs.get('weeklyGoalHours')) || 0;
    if (goal > 0) {
      const week = A.weekStats(0).totalMinutes;
      const target = goal * 60;
      const dayIndex = (new Date().getDay() + 6) % 7; // Mon = 0
      const daysLeft = 7 - dayIndex;
      if (week >= target) {
        out.push({ kind: 'praise', weight: 52, text: `You've already reached your ${goal}h weekly goal.` });
      } else if (sessions.length) {
        out.push({
          kind: 'tip',
          weight: 48,
          text: `${fmt.duration(target - week)} left to reach your ${goal}h weekly goal.`,
          detail: `That's about ${fmt.duration((target - week) / daysLeft)} a day for the rest of the week.`,
        });
      }
    }

    // 8. focus quality trend
    const rated = sessions.filter((s) => s.productivity);
    const recentKeys = new Set(Array.from({ length: 7 }, (_, i) => dates.addDaysKey(today, -i)));
    const prevKeys = new Set(Array.from({ length: 7 }, (_, i) => dates.addDaysKey(today, -7 - i)));
    const recent = rated.filter((s) => recentKeys.has(A.sessionDate(s)));
    const prev = rated.filter((s) => prevKeys.has(A.sessionDate(s)));
    if (recent.length >= 3 && prev.length >= 3) {
      const avg = (list) => list.reduce((n, s) => n + s.productivity, 0) / list.length;
      const delta = avg(recent) - avg(prev);
      if (Math.abs(delta) >= 0.3) {
        out.push({
          kind: delta > 0 ? 'praise' : 'tip',
          weight: 42,
          text: `Your average focus rating is ${delta > 0 ? 'up' : 'down'} ${Math.abs(delta).toFixed(1)} points compared with the week before.`,
        });
      }
    }

    // 9. least-progressed subject with a target
    const targeted = stats.filter((s) => Number(s.subject.targetHours) > 0).sort((a, b) => a.completion - b.completion);
    if (targeted.length > 1 && sessions.length) {
      const s = targeted[0];
      out.push({
        kind: 'tip',
        weight: 30,
        text: `${s.subject.name} is the furthest from its ${s.subject.targetHours}h target (${Math.round(s.completion)}% there).`,
      });
    }

    if (!out.length) out.push({ kind: 'praise', weight: 1, text: 'Everything looks on track. Keep your rhythm going.' });
    return out.sort((a, b) => b.weight - a.weight).slice(0, 8);
  }

  /* ---------- Plan my day ---------- */
  const roundTo5 = (n) => Math.round(n / 5) * 5;

  function planDefaults() {
    const today = dates.today();
    let start = Math.ceil((dates.nowMinutes() + 5) / 15) * 15;
    let note = '';
    const win = bestWindow();
    if (win && win.startHour * 60 >= start + 15 && win.startHour <= 20) {
      start = win.startHour * 60;
      note = `Start time set to ${fmt.hour12(win.startHour)}, your most effective window.`;
    }
    const recent = [];
    for (let i = 1; i <= 14; i += 1) {
      const m = A.dayMinutes(dates.addDaysKey(today, -i));
      if (m > 0) recent.push(m);
    }
    const avg = recent.length ? recent.reduce((n, m) => n + m, 0) / recent.length : 0;
    return {
      start: dates.toHHMM(Math.min(start, 22 * 60)),
      available: avg ? Math.max(60, Math.round(avg / 15) * 15) : 120,
      breakMin: 10,
      note,
    };
  }

  /**
   * Score open tasks (priority, deadline, how long the subject has been neglected,
   * subject progress), group them by subject, and lay them out from `start`.
   */
  function generatePlan({ start, available, breakMin }) {
    const today = dates.today();
    const stats = new Map(A.subjectStats().map((s) => [s.subject.id, s]));
    const weight = { Urgent: 4, High: 3, Medium: 2, Low: 1 };

    const scored = S.get('tasks')
      .filter((t) => !t.completed)
      .map((t) => {
        const due = t.dueDate ? dates.diffDays(today, t.dueDate) : null;
        const why = [];
        let urgency = 0;
        if (due !== null) {
          if (due < 0) {
            urgency = 50 + Math.min(-due, 10);
            why.push('Overdue');
          } else if (due === 0) {
            urgency = 40;
            why.push('Due today');
          } else if (due === 1) {
            urgency = 30;
            why.push('Due tomorrow');
          } else if (due <= 3) {
            urgency = 20;
            why.push(`Due in ${due} days`);
          } else urgency = due <= 7 ? 10 : 2;
        }
        const st = stats.get(t.subjectId);
        if (st && st.daysSince !== null && st.daysSince >= 4) why.push(`Not studied in ${st.daysSince} days`);
        if (t.priority === 'Urgent' || t.priority === 'High') why.push(`${t.priority} priority`);
        const neglect = st ? Math.min(st.daysSince ?? 7, 14) : 0;
        const deficit = st ? (1 - st.completion / 100) * 8 : 0;
        return {
          task: t,
          why,
          score: (weight[t.priority] || 2) * 10 + urgency + neglect + deficit,
          minutes: clamp(roundTo5(Number(t.estimatedMinutes) || 45), 15, 90),
        };
      })
      .sort((a, b) => b.score - a.score);

    // merge tasks of one subject into a single block (max 90 minutes)
    const blocks = [];
    for (const c of scored) {
      const sid = c.task.subjectId || '';
      const b = blocks.find((x) => x.subjectId === sid && x.minutes + c.minutes <= 90);
      if (b) {
        b.minutes += c.minutes;
        b.tasks.push(c.task);
        c.why.forEach((w) => {
          if (!b.why.includes(w)) b.why.push(w);
        });
      } else {
        blocks.push({ subjectId: sid, minutes: c.minutes, tasks: [c.task], why: [...c.why] });
      }
    }

    // top up with review blocks for neglected subjects that have no tasks in the plan
    const planned = new Set(blocks.map((b) => b.subjectId));
    [...stats.values()]
      .filter((s) => !planned.has(s.subject.id))
      .map((s) => ({ s, score: Math.min(s.daysSince ?? 10, 14) + (100 - s.completion) / 10 }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 2)
      .forEach(({ s }) =>
        blocks.push({
          subjectId: s.subject.id,
          minutes: 30,
          tasks: [],
          why: [s.daysSince === null ? 'Nothing logged yet' : s.daysSince >= 3 ? `Not studied in ${s.daysSince} days` : 'Keeps your target on track'],
          review: true,
        })
      );

    const items = [];
    let cursor = dates.toMinutes(start);
    let left = available;
    const cutoff = 23 * 60 + 30;
    for (const b of blocks) {
      if (left < 15 || cursor >= cutoff) break;
      let minutes = Math.max(15, Math.floor(Math.min(b.minutes, left) / 5) * 5);
      if (cursor + minutes > cutoff) minutes = Math.floor((cutoff - cursor) / 5) * 5;
      if (minutes < 15) break;
      const subject = S.find('subjects', b.subjectId);
      const label = b.review
        ? `Review ${subject ? subject.name : 'notes'}`
        : b.tasks.length === 1
          ? b.tasks[0].title
          : `${b.tasks[0].title} + ${b.tasks.length - 1} more`;
      items.push({
        id: uid(),
        start: dates.toHHMM(cursor),
        minutes,
        subjectId: b.subjectId,
        subjectName: subject ? subject.name : '',
        label,
        reason: b.why.slice(0, 2).join(', '),
        done: false,
        taskIds: b.tasks.map((t) => t.id),
      });
      cursor += minutes + breakMin;
      left -= minutes;
    }
    return { date: today, items, generatedAt: Date.now(), params: { start, available, breakMin } };
  }

  /* ---------- AI Study page ---------- */
  let tab = 'insights';
  let viewRoot = null;

  const insightHTML = (i) => `
    <li class="insight insight-${i.kind}">
      <span class="insight-mark" aria-hidden="true">✦</span>
      <div class="insight-body">
        <p class="insight-text">${esc(i.text)}</p>
        ${i.detail ? `<p class="insight-detail">${esc(i.detail)}</p>` : ''}
        ${
          i.action
            ? `<button type="button" class="btn btn-soft btn-sm" data-click="ai:action" data-type="${esc(i.action.type)}" data-page="${esc(i.action.page || '')}" data-subject-id="${esc(i.action.subjectId || '')}">${esc(i.action.label)}</button>`
            : ''
        }
      </div>
    </li>`;

  function insightsBody() {
    return `<ul class="insight-list">${insights().map(insightHTML).join('')}</ul>
      <p class="fine-print">Insights are recalculated from your stored data each time it changes. Nothing is sent anywhere.</p>`;
  }

  function planItemHTML(item) {
    return `<li class="plan-item${item.done ? ' is-done' : ''}" data-id="${esc(item.id)}">
      <button type="button" class="check" role="checkbox" aria-checked="${item.done}" aria-label="Mark “${esc(item.label)}” ${item.done ? 'not done' : 'done'}" data-click="plan:toggle" data-id="${esc(item.id)}">${icon('tick', 16)}</button>
      <label class="plan-time"><span class="sr-only">Start time</span><input type="time" name="start" value="${esc(item.start)}" data-change="plan:edit" required></label>
      <div class="plan-main">
        <label class="sr-only" for="pl-${esc(item.id)}">What to study</label>
        <input id="pl-${esc(item.id)}" class="plan-label" type="text" name="label" maxlength="90" value="${esc(item.label)}" data-change="plan:edit">
        <div class="plan-sub">
          <label class="sr-only" for="ps-${esc(item.id)}">Subject</label>
          <select id="ps-${esc(item.id)}" name="subjectId" data-change="plan:edit">${S.subjectOptions(item.subjectId, 'No subject')}</select>
          <label class="plan-minutes"><span class="sr-only">Minutes</span><input type="number" name="minutes" min="5" max="240" step="5" value="${item.minutes}" data-change="plan:edit"> min</label>
        </div>
        ${item.reason ? `<p class="plan-reason">${esc(item.reason)}</p>` : ''}
      </div>
      <div class="plan-actions">
        <button type="button" class="btn btn-soft btn-sm" data-click="plan:start" data-id="${esc(item.id)}">${icon('play', 16)}<span>Focus</span></button>
        <button type="button" class="icon-btn" data-click="plan:delete" data-id="${esc(item.id)}" aria-label="Remove ${esc(item.label)}" data-tip="Remove">${icon('trash', 18)}</button>
      </div>
    </li>`;
  }

  function planItemsHTML() {
    const { plan, total, done } = daySummary();
    if (!plan || !plan.items.length) {
      return emptyState({
        icon: '🗓',
        title: 'No plan for today yet',
        text: S.get('tasks').length || S.get('subjects').length
          ? 'Choose your start time and available minutes above, then let Lumina lay out your day.'
          : 'Add a subject and a few tasks first. The planner schedules from those.',
      });
    }
    const minutes = plan.items.reduce((n, i) => n + i.minutes, 0);
    return `<div class="plan-summary">
        <div><strong>${plural(total, 'block')}</strong>, ${esc(fmt.duration(minutes))} of focus</div>
        <div class="plan-progress">${progress(total ? (done / total) * 100 : 0, { label: 'Plan progress' })}<span>${done} of ${total} done</span></div>
      </div>
      <ol class="plan-list">${plan.items.map(planItemHTML).join('')}</ol>
      <div class="plan-foot">
        <button type="button" class="btn btn-ghost btn-sm" data-click="plan:add">${icon('plus', 16)}<span>Add a block</span></button>
        <button type="button" class="btn btn-ghost btn-sm" data-click="plan:clear">Clear plan</button>
      </div>`;
  }

  function planBody() {
    const { plan } = daySummary();
    const d = plan && plan.params ? { ...planDefaults(), ...plan.params, note: '' } : planDefaults();
    return `<section class="panel">
        <form class="plan-controls" data-submit="plan:generate" novalidate>
          <label class="field"><span>Start at</span><input type="time" name="start" value="${esc(d.start)}" required></label>
          <label class="field"><span>Study time available (minutes)</span><input type="number" name="available" min="15" max="720" step="15" value="${d.available}" required></label>
          <label class="field"><span>Break between blocks</span>
            <select name="breakMin">${[5, 10, 15, 20].map((n) => `<option value="${n}"${n === d.breakMin ? ' selected' : ''}>${n} minutes</option>`).join('')}</select>
          </label>
          <button type="submit" class="btn btn-primary">${icon('wand', 18)}<span>${plan && plan.items.length ? 'Regenerate plan' : 'Plan my day'}</span></button>
        </form>
        ${d.note ? `<p class="fine-print">${esc(d.note)}</p>` : ''}
        <p class="fine-print">The planner weighs priority, deadlines, how long each subject has been neglected, subject progress and your usual daily study time. Edit any block afterwards.</p>
      </section>
      <section class="panel" id="plan-region"><div class="panel-head"><h3>Today's plan</h3><span class="panel-sub">${esc(fmt.longDate())}</span></div><div id="plan-items">${planItemsHTML()}</div></section>`;
  }

  const view = {
    title: 'AI Study',
    render(root) {
      viewRoot = root;
      root.innerHTML = `
        <div class="page-head">
          <div><h2 class="page-title">Lumina Study Intelligence</h2>
          <p class="lede">A rule-based study coach that reads your sessions, tasks and streak.</p></div>
        </div>
        <div class="honesty-note"><span aria-hidden="true">✦</span><p>No AI model runs on your device. These suggestions come from plain, explainable rules applied to your own data, and everything stays offline.</p></div>
        <div id="ai-tabs">${tabs({ tabs: [{ id: 'insights', label: 'Insights' }, { id: 'plan', label: 'Plan my day' }], active: tab, action: 'ai:tab', label: 'Study intelligence' })}</div>
        <div id="ai-body" role="tabpanel">${tab === 'insights' ? insightsBody() : planBody()}</div>`;
    },
    update() {
      if (!viewRoot || !document.getElementById('ai-body')) return;
      if (tab === 'insights') {
        document.getElementById('ai-body').innerHTML = insightsBody();
      } else {
        const ae = document.activeElement;
        const editing = ae && ae.closest && ae.closest('#plan-items') && /INPUT|SELECT|TEXTAREA/.test(ae.tagName);
        const items = document.getElementById('plan-items');
        if (items && !editing) items.innerHTML = planItemsHTML();
      }
    },
  };

  const rerenderPlan = (focusSel) => {
    const items = document.getElementById('plan-items');
    if (!items) return;
    items.innerHTML = planItemsHTML();
    if (focusSel) document.querySelector(focusSel)?.focus();
  };

  on('click', 'ai:tab', (btn) => {
    tab = btn.dataset.tab;
    view.render(viewRoot);
    document.querySelector(`#ai-tabs [data-tab="${tab}"]`)?.focus();
  });

  on('click', 'ai:action', (btn) => {
    const { type, page, subjectId } = btn.dataset;
    if (type === 'focus') L.timer.prepare({ subjectId });
    else if (type === 'plan') {
      tab = 'plan';
      view.render(viewRoot);
    } else if (type === 'nav' && page) location.hash = `#/${page}`;
  });

  on('submit', 'plan:generate', async (form) => {
    const start = form.elements.start.value;
    const available = clamp(Math.round(Number(form.elements.available.value)) || 0, 15, 720);
    const breakMin = Number(form.elements.breakMin.value) || 10;
    if (!/^\d{2}:\d{2}$/.test(start)) {
      L.ui.toast('Choose a start time first.', { type: 'error' });
      return;
    }
    const existing = getPlan(dates.today());
    if (existing && existing.items.length) {
      const ok = await L.ui.confirm({
        title: 'Replace today’s plan?',
        message: 'Regenerating creates a fresh schedule. Your edits and ticked-off blocks in the current plan will be replaced.',
        confirmLabel: 'Replace plan',
      });
      if (!ok) return;
    }
    const plan = generatePlan({ start, available, breakMin });
    if (!plan.items.length) {
      L.ui.toast('Nothing to schedule. Add subjects or tasks, or allow more time.', { type: 'error' });
      return;
    }
    await savePlan(plan);
    S.logActivity('plan', `Planned ${plural(plan.items.length, 'study block')} for today`);
    L.ui.toast(`Plan ready: ${plural(plan.items.length, 'block')} scheduled.`, { type: 'success' });
    view.render(viewRoot);
  });

  on('change', 'plan:edit', async (el) => {
    const row = el.closest('.plan-item');
    const plan = getPlan(dates.today());
    if (!row || !plan) return;
    const item = plan.items.find((i) => i.id === row.dataset.id);
    if (!item) return;
    if (el.name === 'start' && /^\d{2}:\d{2}$/.test(el.value)) item.start = el.value;
    else if (el.name === 'minutes') item.minutes = clamp(Math.round(Number(el.value)) || item.minutes, 5, 240);
    else if (el.name === 'label') item.label = el.value.trim().slice(0, 90) || item.label;
    else if (el.name === 'subjectId') {
      item.subjectId = el.value;
      item.subjectName = el.value ? S.subjectName(el.value, '') : '';
    }
    plan.items.sort((a, b) => a.start.localeCompare(b.start));
    await savePlan(plan);
    rerenderPlan(`[data-id="${item.id}"] [name="${el.name}"]`);
  });

  on('click', 'plan:toggle', async (btn) => {
    const plan = getPlan(dates.today());
    const item = plan && plan.items.find((i) => i.id === btn.dataset.id);
    if (!item) return;
    item.done = !item.done;
    await savePlan(plan);
    rerenderPlan(`[data-id="${item.id}"] .check`);
  });

  on('click', 'plan:delete', async (btn) => {
    const plan = getPlan(dates.today());
    if (!plan) return;
    plan.items = plan.items.filter((i) => i.id !== btn.dataset.id);
    await savePlan(plan);
    rerenderPlan();
  });

  on('click', 'plan:add', async () => {
    const plan = getPlan(dates.today());
    if (!plan) return;
    const last = plan.items[plan.items.length - 1];
    const startMin = last ? dates.toMinutes(last.start) + last.minutes + 10 : Math.ceil((dates.nowMinutes() + 5) / 15) * 15;
    const item = { id: uid(), start: dates.toHHMM(Math.min(startMin, 23 * 60)), minutes: 30, subjectId: '', subjectName: '', label: 'Study block', reason: 'Added by you', done: false, taskIds: [] };
    plan.items.push(item);
    await savePlan(plan);
    rerenderPlan(`[data-id="${item.id}"] [name="label"]`);
  });

  on('click', 'plan:clear', async () => {
    const ok = await L.ui.confirm({ title: 'Clear today’s plan?', message: 'This removes every block from today’s plan.', confirmLabel: 'Clear plan', danger: true });
    if (!ok) return;
    await S.remove('settings', `plan:${dates.today()}`);
    view.render(viewRoot);
  });

  on('click', 'plan:start', (btn) => {
    const plan = getPlan(dates.today());
    const item = plan && plan.items.find((i) => i.id === btn.dataset.id);
    if (item) L.timer.prepare({ subjectId: item.subjectId, minutes: item.minutes });
  });

  L.views = L.views || {};
  L.views.ai = view;
  L.intelligence = { insights, bestWindow, planDefaults, generatePlan, getPlan, savePlan, markPlanProgress, daySummary, weekPlanStats };
})();
