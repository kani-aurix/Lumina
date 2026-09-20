/* ==========================================================================
   Lumina — analytics.js
   Pure statistics computed from stored sessions / tasks / notes (no fake
   numbers anywhere), the XP + achievement system, and the Analytics page
   (native SVG charts — no chart library).
   ========================================================================== */
(() => {
  'use strict';
  const L = (window.Lumina = window.Lumina || {});
  const { dates, fmt, esc, plural, deepOf } = L.utils;
  const { icon, progress, emptyState, on } = L.ui;
  const S = L.state;

  const STREAK_MIN = 30; // minutes of study that make a day "count"

  const minutesOf = (s) => (Number(s.durationSec) || 0) / 60;
  const sessionDate = (s) => s.date || dates.key(s.startedAt);

  /** Cache a computation until the data (or the calendar day) changes. */
  const memo = (fn) => {
    let ver = -1;
    let day = '';
    let val;
    return () => {
      const cur = S.version();
      const today = dates.today();
      if (cur !== ver || today !== day) {
        val = fn();
        ver = cur;
        day = today;
      }
      return val;
    };
  };

  /* ---------- daily totals ---------- */
  const dayMap = memo(() => {
    const map = new Map();
    for (const s of S.get('sessions')) {
      const k = sessionDate(s);
      const e = map.get(k) || { minutes: 0, sessions: 0 };
      e.minutes += minutesOf(s);
      e.sessions += 1;
      map.set(k, e);
    }
    return map;
  });

  const dayMinutes = (key) => dayMap().get(key)?.minutes || 0;

  function todayStats() {
    const today = dates.today();
    const yesterday = dates.addDaysKey(today, -1);
    const t = dayMinutes(today);
    const y = dayMinutes(yesterday);
    return {
      minutes: t,
      sessions: dayMap().get(today)?.sessions || 0,
      yesterday: y,
      change: y > 0 ? ((t - y) / y) * 100 : null,
    };
  }

  /** Mon–Sun stats for the current week (offset 0) or earlier weeks (offset -1, -2 …). */
  function weekStats(offset = 0) {
    const base = dates.addDays(dates.weekStart(), offset * 7);
    const todayKey = dates.today();
    const days = dates.weekKeys(base).map((key, i) => {
      const minutes = dayMinutes(key);
      return {
        key,
        label: dates.SHORT_DAYS[i],
        minutes,
        qualified: minutes >= STREAK_MIN,
        isToday: key === todayKey,
        isFuture: key > todayKey,
      };
    });
    return { days, totalMinutes: days.reduce((n, d) => n + d.minutes, 0) };
  }

  const streaks = memo(() => {
    const map = dayMap();
    const ok = (k) => (map.get(k)?.minutes || 0) >= STREAK_MIN;
    const today = dates.today();
    let cursor = ok(today) ? today : dates.addDaysKey(today, -1);
    let current = 0;
    while (ok(cursor)) {
      current += 1;
      cursor = dates.addDaysKey(cursor, -1);
    }
    const days = [...map.keys()].filter(ok).sort();
    let longest = 0;
    let run = 0;
    let prev = null;
    for (const k of days) {
      run = prev && dates.diffDays(prev, k) === 1 ? run + 1 : 1;
      longest = Math.max(longest, run);
      prev = k;
    }
    return { current, longest, todayQualified: ok(today), qualifiedDays: days.length };
  });

  function taskStats() {
    const tasks = S.get('tasks');
    const today = dates.today();
    const open = tasks.filter((t) => !t.completed);
    const done = tasks.length - open.length;
    return {
      total: tasks.length,
      done,
      open: open.length,
      overdue: open.filter((t) => t.dueDate && t.dueDate < today).length,
      dueToday: open.filter((t) => t.dueDate === today).length,
      rate: tasks.length ? (done / tasks.length) * 100 : 0,
    };
  }

  /* ---------- per-subject stats (used by Subjects, Dashboard, Intelligence) ---------- */
  const subjectStats = memo(() => {
    const today = dates.today();
    const weekKeys = new Set(dates.weekKeys());
    const sessions = S.get('sessions');
    const tasks = S.get('tasks');
    const notes = S.get('notes');
    return S.get('subjects').map((subject) => {
      const mine = sessions.filter((s) => s.subjectId === subject.id);
      const minutes = mine.reduce((n, s) => n + minutesOf(s), 0);
      const weekMinutes = mine.filter((s) => weekKeys.has(sessionDate(s))).reduce((n, s) => n + minutesOf(s), 0);
      const lastKey = mine.map(sessionDate).sort().pop() || null;
      const t = tasks.filter((x) => x.subjectId === subject.id);
      const done = t.filter((x) => x.completed).length;
      const open = t.filter((x) => !x.completed);
      const target = Number(subject.targetHours) || 0;
      const completion = target > 0 ? Math.min(100, (minutes / 60 / target) * 100) : t.length ? (done / t.length) * 100 : 0;
      return {
        subject,
        minutes,
        weekMinutes,
        lastKey,
        daysSince: lastKey ? dates.diffDays(lastKey, today) : null,
        sessionCount: mine.length,
        tasksTotal: t.length,
        tasksDone: done,
        tasksOpen: open.length,
        overdue: open.filter((x) => x.dueDate && x.dueDate < today).length,
        notes: notes.filter((n) => n.subjectId === subject.id).length,
        completion,
        basis: target > 0 ? `of ${target}h target` : 'of tasks done',
      };
    });
  });

  /* ---------- distribution & metrics ---------- */
  function distribution() {
    const totals = new Map();
    for (const s of S.get('sessions')) {
      const id = s.subjectId || '';
      const cur = totals.get(id) || { id, minutes: 0, snapshot: s.subjectName };
      cur.minutes += minutesOf(s);
      totals.set(id, cur);
    }
    const total = [...totals.values()].reduce((n, x) => n + x.minutes, 0);
    const rows = [...totals.values()]
      .map((x) => {
        const subj = S.find('subjects', x.id);
        return {
          id: x.id,
          name: subj ? subj.name : x.snapshot || 'Unassigned',
          color: subj ? subj.color : '#E4DDE8',
          minutes: x.minutes,
          pct: total ? (x.minutes / total) * 100 : 0,
        };
      })
      .sort((a, b) => b.minutes - a.minutes);
    return { total, rows };
  }

  function metrics() {
    const sessions = S.get('sessions');
    const tasks = taskStats();
    const st = streaks();
    const total = sessions.reduce((n, s) => n + minutesOf(s), 0);
    const longest = sessions.reduce((m, s) => Math.max(m, minutesOf(s)), 0);
    const dist = distribution();
    // weekday totals from daily totals → most productive weekday
    const byDow = Array(7).fill(0);
    const dowDays = Array(7).fill(0);
    for (const [key, v] of dayMap()) {
      const dow = dates.fromKey(key).getDay();
      byDow[dow] += v.minutes;
      dowDays[dow] += 1;
    }
    let bestDow = -1;
    byDow.forEach((m, i) => {
      if (m > 0 && (bestDow < 0 || m > byDow[bestDow])) bestDow = i;
    });
    const rated = sessions.filter((s) => s.productivity);
    return {
      sessions: sessions.length,
      totalMinutes: total,
      avgMinutes: sessions.length ? total / sessions.length : 0,
      longestMinutes: longest,
      tasksDone: tasks.done,
      tasksTotal: tasks.total,
      completionRate: tasks.rate,
      currentStreak: st.current,
      longestStreak: st.longest,
      topSubject: dist.rows[0] || null,
      bestDay: bestDow >= 0 ? { name: dates.DAY_NAMES[bestDow], avgMinutes: byDow[bestDow] / dowDays[bestDow] } : null,
      avgRating: rated.length ? rated.reduce((n, s) => n + s.productivity, 0) / rated.length : null,
      qualifiedDays: st.qualifiedDays,
    };
  }

  /* ---------- XP, levels, achievements (all derived from real data) ---------- */
  const xpForNextLevel = (level) => 150 + 50 * (level - 1);

  function xpInfo() {
    const m = metrics();
    const xp = Math.round(m.totalMinutes) + m.sessions * 20 + m.tasksDone * 15 + m.qualifiedDays * 10;
    let level = 1;
    let rest = xp;
    while (rest >= xpForNextLevel(level)) {
      rest -= xpForNextLevel(level);
      level += 1;
    }
    const need = xpForNextLevel(level);
    return { xp, level, into: rest, need, pct: (rest / need) * 100 };
  }

  const bestWeekMinutes = () => {
    const weeks = new Map();
    for (const [key, v] of dayMap()) {
      const wk = dates.key(dates.weekStart(dates.fromKey(key)));
      weeks.set(wk, (weeks.get(wk) || 0) + v.minutes);
    }
    return Math.max(0, ...weeks.values());
  };

  const ACHIEVEMENTS = [
    { id: 'first-session', icon: '🌱', title: 'First Session', desc: 'Complete your first focus session.', measure: () => [metrics().sessions, 1] },
    { id: 'streak-7', icon: '🔥', title: '7-Day Streak', desc: 'Study 30+ minutes a day for 7 days in a row.', measure: () => [streaks().longest, 7] },
    { id: 'tasks-10', icon: '📚', title: '10 Tasks Completed', desc: 'Finish ten tasks.', measure: () => [taskStats().done, 10] },
    { id: 'hours-10', icon: '⏱', title: '10 Hours Studied', desc: 'Log ten hours of focused study.', measure: () => [metrics().totalMinutes / 60, 10] },
    { id: 'focus-25', icon: '🧠', title: '25 Focus Sessions', desc: 'Complete 25 focus sessions.', measure: () => [metrics().sessions, 25] },
    { id: 'hours-50', icon: '🏆', title: '50 Hours Studied', desc: 'Log fifty hours of focused study.', measure: () => [metrics().totalMinutes / 60, 50] },
    { id: 'first-note', icon: '📝', title: 'First Note', desc: 'Write your first note.', measure: () => [S.get('notes').length, 1] },
    {
      id: 'weekly-goal',
      icon: '🎯',
      title: 'Weekly Goal Reached',
      desc: 'Hit your weekly study goal in any week.',
      measure: () => [bestWeekMinutes() / 60, Math.max(1, Number(S.prefs.get('weeklyGoalHours')) || 20)],
    },
  ];

  function achievements() {
    const saved = S.getSetting('achievements', {}) || {};
    return ACHIEVEMENTS.map((a) => {
      const [value, target] = a.measure();
      const unlockedAt = saved[a.id] || null;
      return { ...a, value, target, pct: Math.min(100, (value / target) * 100), met: value >= target, unlockedAt };
    });
  }

  let evaluating = false;
  /** Unlock achievements that are newly met. `silent` skips toasts (first run / imports). */
  async function checkAchievements({ silent = false } = {}) {
    if (evaluating) return;
    evaluating = true;
    try {
      const raw = S.getSetting('achievements', null);
      const saved = { ...(raw || {}) };
      const fresh = achievements().filter((a) => a.met && !saved[a.id]);
      if (raw !== null && !fresh.length) return;
      fresh.forEach((a) => {
        saved[a.id] = Date.now();
      });
      await S.setSetting('achievements', saved);
      if (raw === null || silent) return;
      for (const a of fresh) {
        L.ui.toast(`Achievement unlocked: ${a.title}`, { type: 'achievement', duration: 5200 });
        S.logActivity('achievement', `Unlocked “${a.title}”`);
      }
    } finally {
      evaluating = false;
    }
  }

  /* ---------- chart renderers (native SVG) ---------- */
  function weeklyChartSVG(days, dailyGoalMin) {
    const W = 640;
    const H = 270;
    const padL = 40;
    const padR = 10;
    const padT = 28;
    const padB = 38;
    const iw = W - padL - padR;
    const ih = H - padT - padB;
    const maxMin = Math.max(60, dailyGoalMin || 0, ...days.map((d) => d.minutes));
    const yMaxH = Math.max(1, Math.ceil(maxMin / 60));
    const yMax = yMaxH * 60;
    const step = yMaxH > 6 ? 2 : 1;
    const y = (min) => padT + ih - (min / yMax) * ih;
    const slot = iw / 7;
    const bw = Math.min(48, slot * 0.58);
    let grid = '';
    for (let h = 0; h <= yMaxH; h += step) {
      grid += `<line class="chart-grid" x1="${padL}" x2="${W - padR}" y1="${y(h * 60)}" y2="${y(h * 60)}"/><text class="chart-axis" x="${padL - 8}" y="${y(h * 60) + 4}" text-anchor="end">${h}h</text>`;
    }
    const bars = days
      .map((d, i) => {
        const cx = padL + slot * i + slot / 2;
        const h = (d.minutes / yMax) * ih;
        const top = padT + ih - h;
        return `<g class="chart-col${d.isToday ? ' is-today' : ''}">
          <title>${esc(d.label)} — ${esc(fmt.duration(d.minutes))}${d.qualified ? ' (counts for your streak)' : ''}</title>
          <rect class="chart-bar${d.qualified ? ' is-hit' : ''}" x="${cx - bw / 2}" y="${top}" width="${bw}" height="${d.minutes > 0 ? Math.max(h, 4) : 0}" rx="10" style="animation-delay:${i * 50}ms"/>
          <text class="chart-value" x="${cx}" y="${top - 8}" text-anchor="middle">${d.minutes > 0 ? fmt.hours(d.minutes) : ''}</text>
          <text class="chart-axis${d.isToday ? ' is-today' : ''}" x="${cx}" y="${H - 14}" text-anchor="middle">${esc(d.label)}</text>
        </g>`;
      })
      .join('');
    const goal = dailyGoalMin
      ? `<line class="chart-goal" x1="${padL}" x2="${W - padR}" y1="${y(dailyGoalMin)}" y2="${y(dailyGoalMin)}"/><text class="chart-goal-label" x="${W - padR}" y="${y(dailyGoalMin) - 6}" text-anchor="end">daily pace for your goal</text>`
      : '';
    const summary = days.map((d) => `${d.label} ${fmt.duration(d.minutes)}`).join(', ');
    return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Weekly study hours: ${esc(summary)}">${grid}${goal}${bars}</svg>`;
  }

  function donutSVG(rows, total) {
    const r = 54;
    const C = 2 * Math.PI * r;
    let offset = 0;
    const segs = rows
      .map((row) => {
        const len = total ? (row.minutes / total) * C : 0;
        const seg = `<circle class="donut-seg" cx="70" cy="70" r="${r}" fill="none" stroke="${esc(deepOf(row.color))}" stroke-width="20" stroke-dasharray="${len.toFixed(2)} ${(C - len).toFixed(2)}" stroke-dashoffset="${(-offset).toFixed(2)}" transform="rotate(-90 70 70)"><title>${esc(row.name)} — ${Math.round(row.pct)}%</title></circle>`;
        offset += len;
        return seg;
      })
      .join('');
    return `<svg class="donut" viewBox="0 0 140 140" role="img" aria-label="Study time by subject">
      <circle cx="70" cy="70" r="${r}" fill="none" class="donut-track" stroke-width="20"/>${segs}
      <text x="70" y="68" text-anchor="middle" class="donut-num">${fmt.hours(total)}</text>
      <text x="70" y="86" text-anchor="middle" class="donut-cap">studied</text></svg>`;
  }

  function heatmapSVG() {
    const weeks = 12;
    const cell = 26;
    const gap = 8;
    const left = 38;
    const map = dayMap();
    const start = dates.addDays(dates.weekStart(), -(weeks - 1) * 7);
    const todayKey = dates.today();
    let cells = '';
    for (let w = 0; w < weeks; w += 1) {
      for (let d = 0; d < 7; d += 1) {
        const key = dates.key(dates.addDays(start, w * 7 + d));
        if (key > todayKey) continue;
        const m = map.get(key)?.minutes || 0;
        const lvl = m === 0 ? 0 : m < 30 ? 1 : m < 60 ? 2 : m < 120 ? 3 : 4;
        cells += `<rect class="heat lvl-${lvl}" x="${left + w * (cell + gap)}" y="${d * (cell + gap)}" width="${cell}" height="${cell}" rx="8"><title>${esc(fmt.date(key))} — ${esc(fmt.duration(m))}</title></rect>`;
      }
    }
    const labels = [0, 2, 4].map((d) => `<text class="chart-axis" x="${left - 8}" y="${d * (cell + gap) + 17}" text-anchor="end">${dates.SHORT_DAYS[d]}</text>`).join('');
    const W = left + weeks * (cell + gap);
    const H = 7 * (cell + gap);
    return `<svg class="heatmap" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Daily study minutes over the last 12 weeks">${labels}${cells}</svg>`;
  }

  /* ---------- Analytics page ---------- */
  let weekOffset = 0;

  function metricTile(label, value, sub = '') {
    return `<div class="metric"><span class="metric-label">${esc(label)}</span><span class="metric-value">${value}</span>${sub ? `<span class="metric-sub">${sub}</span>` : ''}</div>`;
  }

  function metricsHTML() {
    const m = metrics();
    return `
      ${metricTile('Total study time', esc(fmt.duration(m.totalMinutes)), plural(m.sessions, 'session'))}
      ${metricTile('Average session', esc(m.sessions ? fmt.duration(m.avgMinutes) : '—'))}
      ${metricTile('Longest session', esc(m.sessions ? fmt.duration(m.longestMinutes) : '—'))}
      ${metricTile('Tasks completed', `${m.tasksDone}<small> / ${m.tasksTotal}</small>`)}
      ${metricTile('Task completion rate', m.tasksTotal ? fmt.percent(m.completionRate) : '—')}
      ${metricTile('Current streak', `🔥 ${plural(m.currentStreak, 'day')}`, `Counts at ${STREAK_MIN}+ min a day`)}
      ${metricTile('Longest streak', plural(m.longestStreak, 'day'))}
      ${metricTile('Most studied subject', m.topSubject ? esc(m.topSubject.name) : '—', m.topSubject ? esc(fmt.duration(m.topSubject.minutes)) : '')}
      ${metricTile('Most productive day', m.bestDay ? esc(m.bestDay.name) : '—', m.bestDay ? `${esc(fmt.duration(m.bestDay.avgMinutes))} on average` : '')}
      ${metricTile('Average focus rating', m.avgRating ? `${m.avgRating.toFixed(1)}<small> / 5</small>` : '—')}`;
  }

  function achievementsHTML() {
    return achievements()
      .map((a) => {
        const unlocked = Boolean(a.unlockedAt) || a.met;
        return `<li class="achievement${unlocked ? ' is-unlocked' : ''}">
          <span class="achievement-icon" aria-hidden="true">${a.icon}</span>
          <div>
            <h4>${esc(a.title)}</h4>
            <p>${esc(a.desc)}</p>
            ${unlocked ? `<span class="achievement-state">Unlocked${a.unlockedAt ? ` ${esc(fmt.date(dates.key(a.unlockedAt)))}` : ''}</span>` : progress(a.pct, { label: `${a.title} progress` })}
            ${unlocked ? '' : `<span class="achievement-state">${Math.min(a.value, a.target).toFixed(a.target < 5 ? 0 : 1).replace(/\.0$/, '')} / ${a.target}</span>`}
          </div>
        </li>`;
      })
      .join('');
  }

  function chartsHTML() {
    const week = weekStats(weekOffset);
    const goalHours = Number(S.prefs.get('weeklyGoalHours')) || 0;
    const dist = distribution();
    const noData = !S.get('sessions').length;
    const weekName = weekOffset === 0 ? 'This week' : weekOffset === -1 ? 'Last week' : `${-weekOffset} weeks ago`;
    return `
      <section class="panel span-8">
        <div class="panel-head">
          <h3>Weekly study hours</h3>
          <label class="select-inline"><span class="sr-only">Week</span>
            <select data-change="analytics:week" aria-label="Choose week">
              ${[0, -1, -2, -3].map((o) => `<option value="${o}"${o === weekOffset ? ' selected' : ''}>${o === 0 ? 'This week' : o === -1 ? 'Last week' : `${-o} weeks ago`}</option>`).join('')}
            </select>
          </label>
        </div>
        <p class="panel-sub">${esc(weekName)}: ${esc(fmt.duration(week.totalMinutes))}${goalHours ? ` of your ${goalHours}h goal` : ''}</p>
        ${weeklyChartSVG(week.days, goalHours ? (goalHours * 60) / 7 : 0)}
        <ul class="week-list" aria-label="Study time per day">${week.days
          .map((d) => `<li><span>${esc(d.label)}</span><strong>${esc(fmt.hours(d.minutes))}</strong></li>`)
          .join('')}</ul>
      </section>
      <section class="panel span-4">
        <div class="panel-head"><h3>Subject distribution</h3></div>
        ${
          dist.total
            ? `<div class="donut-wrap">${donutSVG(dist.rows, dist.total)}</div>
               <ul class="dist-list">${dist.rows
                 .map(
                   (r) => `<li><span class="dot" style="background:${esc(deepOf(r.color))}"></span><span class="dist-name">${esc(r.name)}</span><strong>${Math.round(r.pct)}%</strong></li>`
                 )
                 .join('')}</ul>`
            : emptyState({ icon: '📊', title: 'No study time yet', text: 'Finish a focus session and your subject split appears here.', action: { label: 'Start a session', click: 'nav:go', data: { page: 'focus' } } })
        }
      </section>
      <section class="panel span-12">
        <div class="panel-head"><h3>Consistency</h3><span class="panel-sub">Last 12 weeks${noData ? '' : ` · ${plural(streaks().qualifiedDays, 'day')} at ${STREAK_MIN}+ minutes`}</span></div>
        <div class="heat-wrap">${heatmapSVG()}</div>
        <div class="heat-legend" aria-hidden="true"><span>Less</span><i class="heat-swatch lvl-0"></i><i class="heat-swatch lvl-1"></i><i class="heat-swatch lvl-2"></i><i class="heat-swatch lvl-3"></i><i class="heat-swatch lvl-4"></i><span>More</span></div>
      </section>`;
  }

  const view = {
    title: 'Analytics',
    render(root) {
      const xp = xpInfo();
      root.innerHTML = `
        <div class="page-head">
          <div><h2 class="page-title">Analytics</h2><p class="lede">Every number below is calculated from the sessions and tasks stored on this device.</p></div>
          <div class="level-chip" title="XP comes from study minutes, sessions, completed tasks and streak days">
            <span class="level-badge">Level ${xp.level}</span>
            <span class="level-xp">${xp.xp.toLocaleString()} XP</span>
            ${progress(xp.pct, { label: 'Progress to next level' })}
            <span class="level-next">${Math.round(xp.need - xp.into)} XP to level ${xp.level + 1}</span>
          </div>
        </div>
        <div class="grid-12" id="analytics-charts">${chartsHTML()}</div>
        <section class="panel">
          <div class="panel-head"><h3>Productivity metrics</h3></div>
          <div class="metric-grid" id="analytics-metrics">${metricsHTML()}</div>
        </section>
        <section class="panel">
          <div class="panel-head"><h3>Achievements</h3><span class="panel-sub">Unlocked from your real activity</span></div>
          <ul class="achievement-grid" id="analytics-achievements">${achievementsHTML()}</ul>
        </section>`;
    },
    update() {
      const charts = document.getElementById('analytics-charts');
      if (!charts) return;
      const focused = document.activeElement && document.activeElement.matches('[data-change="analytics:week"]');
      if (!focused) charts.innerHTML = chartsHTML();
      document.getElementById('analytics-metrics').innerHTML = metricsHTML();
      document.getElementById('analytics-achievements').innerHTML = achievementsHTML();
    },
  };

  on('change', 'analytics:week', (el) => {
    weekOffset = Number(el.value) || 0;
    const charts = document.getElementById('analytics-charts');
    if (charts) charts.innerHTML = chartsHTML();
    document.querySelector('[data-change="analytics:week"]')?.focus();
  });
  L.views = L.views || {};
  L.views.analytics = view;
  L.analytics = {
    STREAK_MIN,
    minutesOf,
    sessionDate,
    dayMinutes,
    todayStats,
    weekStats,
    streaks,
    taskStats,
    subjectStats,
    distribution,
    metrics,
    xpInfo,
    achievements,
    checkAchievements,
  };
})();
