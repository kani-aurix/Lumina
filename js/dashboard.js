/* ==========================================================================
   Lumina — dashboard.js
   The home screen. Every number here is computed from stored data.
   Order: welcome → statistics → today's focus → study progress →
          upcoming tasks → recent activity (+ intelligence highlights)
   ========================================================================== */
(() => {
  'use strict';
  const L = (window.Lumina = window.Lumina || {});
  const { esc, dates, fmt, plural, deepOf } = L.utils;
  const { icon, progress, statCard, emptyState } = L.ui;
  const S = L.state;
  const A = L.analytics;

  const ACTIVITY_ICONS = { session: '⏱', task: '✓', subject: '📚', note: '📝', achievement: '🏆', plan: '🗓', backup: '💾' };

  /* ---------- welcome ---------- */
  function welcomeHTML() {
    const name = (S.prefs.get('name') || '').trim();
    const { total, done } = L.intelligence.daySummary();
    const ts = A.taskStats();
    let line;
    if (total) line = `You have ${plural(total, 'focused session')} planned today${done ? `, ${done} already done` : ''}.`;
    else if (ts.overdue) line = `${plural(ts.overdue, 'task')} ${ts.overdue === 1 ? 'is' : 'are'} overdue. A short session could clear the smallest one.`;
    else if (ts.dueToday) line = `You have ${plural(ts.dueToday, 'task')} due today.`;
    else line = 'Nothing is scheduled yet. A good day to plan a session.';
    return `<section class="welcome">
      <div>
        <h2 class="greeting">${esc(fmt.greeting())}${name ? `, ${esc(name)}` : ''} ✦</h2>
        <p class="welcome-line">${esc(line)}</p>
      </div>
      <div class="welcome-actions">
        <button type="button" class="btn btn-primary" data-click="nav:go" data-page="focus">${icon('play', 18)}<span>Start focus</span></button>
        <button type="button" class="btn btn-soft" data-click="nav:go" data-page="ai">${icon('wand', 18)}<span>Plan my day</span></button>
      </div>
    </section>`;
  }

  /* ---------- statistics ---------- */
  function statsHTML() {
    const today = A.todayStats();
    const tasks = A.taskStats();
    const st = A.streaks();
    const goal = Number(S.prefs.get('weeklyGoalHours')) || 0;
    const week = A.weekStats(0).totalMinutes;
    const goalPct = goal ? Math.min(100, (week / (goal * 60)) * 100) : 0;

    let trend;
    let tone = '';
    if (today.change !== null) {
      const up = today.change >= 0;
      trend = `${up ? '↑' : '↓'} ${Math.abs(Math.round(today.change))}% from yesterday`;
      tone = up ? 'is-up' : 'is-down';
    } else trend = today.minutes > 0 ? 'Nothing logged yesterday' : 'Start a session to fill this in';

    const streakSub = st.todayQualified
      ? 'Today counts'
      : st.current > 0
        ? `${Math.ceil(A.STREAK_MIN - today.minutes)} min to keep it`
        : `Study ${A.STREAK_MIN} min to start one`;

    return `<section class="stats-grid" aria-label="Your statistics">
      ${statCard({ href: '#/focus', icon: icon('timer', 18), label: 'Today’s study time', value: esc(fmt.clock(today.minutes)), trend, trendTone: tone })}
      ${statCard({ href: '#/tasks', icon: icon('check', 18), label: 'Tasks completed', value: `${tasks.done}<small> / ${tasks.total}</small>`, sub: tasks.total ? fmt.percent(tasks.rate) : 'No tasks yet', pct: tasks.total ? tasks.rate : 0 })}
      ${statCard({ href: '#/analytics', icon: icon('calendar', 18), label: 'Current streak', value: `🔥 ${plural(st.current, 'day')}`, sub: streakSub, trend: st.longest > st.current ? `Longest: ${plural(st.longest, 'day')}` : '' })}
      ${statCard({ href: '#/analytics', icon: icon('sparkle', 18), label: 'Weekly goal', value: `${esc(fmt.duration(week))}<small> / ${goal}h</small>`, sub: goal ? fmt.percent(goalPct) : 'Set a goal in Settings', pct: goalPct })}
    </section>`;
  }

  /* ---------- today's focus ---------- */
  function focusHTML() {
    const { plan, total, done } = L.intelligence.daySummary();
    if (plan && plan.items.length) {
      const items = plan.items.slice().sort((a, b) => a.start.localeCompare(b.start));
      return `<section class="panel span-7">
        <div class="panel-head"><h3>Today’s focus</h3><a class="link-btn" href="#/ai">Edit plan</a></div>
        <p class="panel-sub">${done} of ${plural(total, 'block')} done</p>
        <ol class="focus-list">${items
          .map(
            (i) => `<li class="focus-item${i.done ? ' is-done' : ''}">
              <button type="button" class="check" role="checkbox" aria-checked="${i.done}" aria-label="${i.done ? 'Mark not done' : 'Mark done'}: ${esc(i.label)}" data-click="plan:toggle" data-id="${esc(i.id)}">${icon('tick', 16)}</button>
              <span class="focus-time">${esc(fmt.time12(i.start))}</span>
              <div class="focus-main"><strong>${esc(i.label)}</strong><span class="muted">${esc(i.subjectName || S.subjectName(i.subjectId, 'No subject'))}, ${esc(fmt.duration(i.minutes))}</span></div>
              ${i.done ? '' : `<button type="button" class="btn btn-soft btn-sm" data-click="plan:start" data-id="${esc(i.id)}">${icon('play', 14)}<span>Focus</span></button>`}
            </li>`
          )
          .join('')}</ol>
      </section>`;
    }
    const open = S.get('tasks')
      .filter((t) => !t.completed)
      .sort((a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999') || L.tasks.PRIORITIES.indexOf(b.priority) - L.tasks.PRIORITIES.indexOf(a.priority))
      .slice(0, 3);
    return `<section class="panel span-7">
      <div class="panel-head"><h3>Today’s focus</h3></div>
      ${
        open.length
          ? `<p class="panel-sub">No plan yet. These are next up:</p>
             <div class="task-list">${open.map((t) => L.tasks.card(t, { compact: true })).join('')}</div>
             <div class="panel-foot"><button type="button" class="btn btn-soft btn-sm" data-click="nav:go" data-page="ai">${icon('wand', 16)}<span>Plan my day</span></button></div>`
          : emptyState({ icon: '✦', title: 'A clear day', text: 'Add a task or plan a session and it shows up here.', action: { label: 'Plan my day', click: 'nav:go', data: { page: 'ai' } } })
      }
    </section>`;
  }

  /* ---------- study progress ---------- */
  function progressHTML() {
    const week = A.weekStats(0);
    const st = A.streaks();
    const xp = A.xpInfo();
    const rows = A.subjectStats()
      .slice()
      .sort((a, b) => b.weekMinutes - a.weekMinutes || b.minutes - a.minutes)
      .slice(0, 4);
    return `<section class="panel span-5">
      <div class="panel-head"><h3>Study progress</h3><a class="link-btn" href="#/analytics">Analytics</a></div>
      <div class="streak-block">
        <p class="streak-title">🔥 ${plural(st.current, 'day')} streak</p>
        <ol class="week-dots" aria-label="This week's activity">${week.days
          .map(
            (d) => `<li class="day-dot${d.qualified ? ' is-hit' : ''}${d.isToday ? ' is-today' : ''}${d.isFuture ? ' is-future' : ''}">
              <span class="day-mark" aria-hidden="true">${d.qualified ? '●' : '○'}</span>
              <span class="day-name">${esc(d.label)}</span>
              <span class="sr-only">${d.qualified ? 'studied 30 minutes or more' : d.isFuture ? 'upcoming' : 'not enough study'}</span>
            </li>`
          )
          .join('')}</ol>
      </div>
      ${
        rows.length
          ? `<ul class="bar-list">${rows
              .map(
                (r) => `<li>
                  <div class="bar-row-head"><span class="dot" style="background:${esc(deepOf(r.subject.color))}"></span><span>${esc(r.subject.name)}</span><span class="muted">${esc(fmt.duration(r.weekMinutes))} this week</span></div>
                  ${progress(r.completion, { color: deepOf(r.subject.color), label: `${r.subject.name} progress` })}
                </li>`
              )
              .join('')}</ul>`
          : '<p class="muted fine-print">Add subjects to see your progress here.</p>'
      }
      <div class="level-line"><span class="level-badge">Level ${xp.level}</span><span class="muted">${xp.xp.toLocaleString()} XP</span>${progress(xp.pct, { label: 'Progress to next level' })}</div>
    </section>`;
  }

  /* ---------- upcoming tasks ---------- */
  function upcomingHTML() {
    const today = dates.today();
    const list = S.get('tasks')
      .filter((t) => !t.completed)
      .sort((a, b) => {
        const ao = a.dueDate && a.dueDate < today ? 0 : 1;
        const bo = b.dueDate && b.dueDate < today ? 0 : 1;
        return ao - bo || (a.dueDate || '9999').localeCompare(b.dueDate || '9999');
      })
      .slice(0, 5);
    return `<section class="panel span-7">
      <div class="panel-head"><h3>Upcoming tasks</h3><a class="link-btn" href="#/tasks">All tasks</a></div>
      ${
        list.length
          ? `<div class="task-list">${list.map((t) => L.tasks.card(t, { compact: true })).join('')}</div>`
          : emptyState({ icon: '✓', title: 'Nothing pending', text: 'Tasks you add will line up here by deadline.', action: { label: 'Add a task', click: 'task:new' } })
      }
    </section>`;
  }

  /* ---------- recent activity ---------- */
  function activityHTML() {
    const list = S.get('activity').slice().sort((a, b) => b.at - a.at).slice(0, 7);
    return `<section class="panel span-5">
      <div class="panel-head"><h3>Recent activity</h3></div>
      ${
        list.length
          ? `<ul class="activity-list">${list
              .map((a) => `<li><span class="activity-icon" aria-hidden="true">${ACTIVITY_ICONS[a.type] || '✦'}</span><span class="activity-text">${esc(a.text)}</span><time class="muted">${esc(fmt.ago(a.at))}</time></li>`)
              .join('')}</ul>`
          : '<p class="muted">Your sessions, tasks and notes will be listed here as you use Lumina.</p>'
      }
    </section>`;
  }

  /* ---------- intelligence highlights ---------- */
  function insightsHTML() {
    const list = L.intelligence.insights().slice(0, 3);
    return `<section class="panel span-12 insight-panel">
      <div class="panel-head"><h3>Lumina Study Intelligence</h3><a class="link-btn" href="#/ai">See all insights</a></div>
      <ul class="insight-strip">${list
        .map((i) => `<li class="insight insight-${i.kind}"><span class="insight-mark" aria-hidden="true">✦</span><p>${esc(i.text)}</p></li>`)
        .join('')}</ul>
    </section>`;
  }

  const view = {
    title: 'Dashboard',
    render(root) {
      root.innerHTML = `${welcomeHTML()}${statsHTML()}<div class="grid-12">${focusHTML()}${progressHTML()}${upcomingHTML()}${activityHTML()}${insightsHTML()}</div>`;
    },
    update() {
      const root = document.getElementById('view');
      if (root) view.render(root);
    },
  };

  L.views = L.views || {};
  L.views.dashboard = view;
})();
