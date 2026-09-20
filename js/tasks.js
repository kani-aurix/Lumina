/* ==========================================================================
   Lumina — tasks.js
   Task management. Task = { id, title, subjectId, priority, dueDate,
   estimatedMinutes, completed, createdAt, completedAt }
   Views: All · Today · Upcoming · Completed · Overdue
   ========================================================================== */
(() => {
  'use strict';
  const L = (window.Lumina = window.Lumina || {});
  const { esc, uid, dates, fmt, deepOf, plural, clamp } = L.utils;
  const { icon, on, tabs, emptyState, dropdown } = L.ui;
  const S = L.state;

  const PRIORITIES = ['Low', 'Medium', 'High', 'Urgent'];
  const PRIORITY_RANK = { Urgent: 4, High: 3, Medium: 2, Low: 1 };

  let tab = 'all';
  let query = '';
  let subjectFilter = 'all';
  let priorityFilter = 'all';
  let sort = 'due';
  let justDone = null;

  const isOverdue = (t) => !t.completed && Boolean(t.dueDate) && t.dueDate < dates.today();

  const matchers = {
    all: () => true,
    today: (t) => t.dueDate === dates.today(),
    upcoming: (t) => !t.completed && Boolean(t.dueDate) && t.dueDate > dates.today(),
    completed: (t) => t.completed,
    overdue: isOverdue,
  };

  /* ---------- Task card component ---------- */
  function card(task, { compact = false } = {}) {
    const subject = S.find('subjects', task.subjectId);
    const overdue = isOverdue(task);
    const cls = ['task-card', overdue ? 'is-overdue' : '', task.completed ? 'is-done' : '', justDone === task.id ? 'just-done' : '', compact ? 'is-compact' : '']
      .filter(Boolean)
      .join(' ');
    return `<article class="${cls}" data-id="${esc(task.id)}">
      <button type="button" class="check" role="checkbox" aria-checked="${task.completed}" aria-label="${task.completed ? 'Mark not done' : 'Mark done'}: ${esc(task.title)}" data-click="task:toggle" data-id="${esc(task.id)}">${icon('tick', 16)}</button>
      <div class="task-main">
        <h3 class="task-title">${esc(task.title)}</h3>
        <div class="task-meta">
          ${subject ? `<span class="chip" style="--chip:${esc(subject.color)};--chip-deep:${esc(deepOf(subject.color))}">${esc(subject.name)}</span>` : ''}
          <span class="badge prio-${task.priority.toLowerCase()}">${esc(task.priority)}</span>
          ${task.dueDate ? `<span class="due${overdue ? ' is-overdue' : ''}">${icon('calendar', 14)}${esc(overdue || task.completed ? (overdue ? fmt.dueLabel(task.dueDate) : `Due ${fmt.date(task.dueDate)}`) : fmt.dueLabel(task.dueDate))}</span>` : ''}
          ${task.estimatedMinutes && !compact ? `<span class="est">${icon('clock', 14)}${esc(fmt.duration(task.estimatedMinutes))}</span>` : ''}
        </div>
      </div>
      ${
        compact
          ? ''
          : dropdown({
              label: `Actions for ${task.title}`,
              items: [
                { label: 'Edit task', action: 'task:edit', data: { id: task.id }, icon: 'edit' },
                { label: 'Delete task', action: 'task:delete', data: { id: task.id }, icon: 'trash', danger: true },
              ],
            })
      }
    </article>`;
  }

  /* ---------- filtering & sorting ---------- */
  function visibleTasks() {
    const q = query.trim().toLowerCase();
    const list = S.get('tasks').filter((t) => {
      if (!matchers[tab](t)) return false;
      if (subjectFilter === 'none' && t.subjectId) return false;
      if (subjectFilter !== 'all' && subjectFilter !== 'none' && t.subjectId !== subjectFilter) return false;
      if (priorityFilter !== 'all' && t.priority !== priorityFilter) return false;
      if (q && !`${t.title} ${S.subjectName(t.subjectId, '')}`.toLowerCase().includes(q)) return false;
      return true;
    });
    const dueCmp = (a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999');
    const prioCmp = (a, b) => PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority];
    list.sort((a, b) => {
      if (tab === 'all' && a.completed !== b.completed) return a.completed ? 1 : -1;
      switch (sort) {
        case 'priority':
          return prioCmp(a, b) || dueCmp(a, b);
        case 'created':
          return b.createdAt - a.createdAt;
        case 'title':
          return a.title.localeCompare(b.title);
        case 'time':
          return (a.estimatedMinutes || 9999) - (b.estimatedMinutes || 9999);
        default:
          return dueCmp(a, b) || prioCmp(a, b);
      }
    });
    return list;
  }

  const counts = () => {
    const all = S.get('tasks');
    return Object.fromEntries(Object.entries(matchers).map(([k, fn]) => [k, all.filter(fn).length]));
  };

  const TAB_LABELS = { all: 'All', today: 'Today', upcoming: 'Upcoming', completed: 'Completed', overdue: 'Overdue' };

  function renderTabs() {
    const host = document.getElementById('task-tabs');
    if (!host) return;
    const c = counts();
    host.innerHTML = tabs({
      tabs: Object.keys(TAB_LABELS).map((id) => ({ id, label: TAB_LABELS[id], count: c[id] })),
      active: tab,
      action: 'tasks:tab',
      label: 'Task views',
    });
  }

  function renderList() {
    const host = document.getElementById('task-list');
    if (!host) return;
    const total = S.get('tasks').length;
    const list = visibleTasks();
    if (!total) {
      host.innerHTML = emptyState({
        icon: '✓',
        title: 'No tasks yet',
        text: 'Add the first thing you need to finish. Deadlines and priorities feed your daily plan.',
        action: { label: 'Add a task', click: 'task:new' },
      });
    } else if (!list.length) {
      const messages = {
        today: 'Nothing is due today.',
        upcoming: 'No upcoming deadlines.',
        completed: 'Finished tasks will collect here.',
        overdue: 'Nothing overdue. Nicely done.',
      };
      host.innerHTML = emptyState({ icon: '✦', title: messages[tab] || 'No tasks match', text: tab === 'all' || query ? 'Try a different search or filter.' : '' });
    } else {
      host.innerHTML = `<div class="task-list">${list.map((t) => card(t)).join('')}</div>`;
    }
    const count = document.getElementById('task-count');
    if (count) count.textContent = total ? `${list.length} shown` : '';
    if (justDone) {
      const id = justDone;
      setTimeout(() => {
        if (justDone === id) justDone = null;
      }, 900);
    }
  }

  /* ---------- form ---------- */
  function openForm(id, defaults = {}) {
    const t = id ? S.find('tasks', id) : null;
    const v = t || { title: '', subjectId: defaults.subjectId || '', priority: 'Medium', dueDate: defaults.dueDate || '', estimatedMinutes: 30 };
    L.ui.modal({
      title: t ? 'Edit task' : 'New task',
      body: `<form class="form" data-submit="task:save" novalidate>
        <input type="hidden" name="id" value="${esc(t ? t.id : '')}">
        <label class="field"><span>Title</span><input name="title" maxlength="140" required autofocus autocomplete="off" placeholder="e.g. Solve subnetting worksheet" value="${esc(v.title)}"></label>
        <div class="field-row">
          <label class="field"><span>Subject</span><select name="subjectId">${S.subjectOptions(v.subjectId)}</select></label>
          <label class="field"><span>Priority</span><select name="priority">${PRIORITIES.map((p) => `<option${p === v.priority ? ' selected' : ''}>${p}</option>`).join('')}</select></label>
        </div>
        <div class="field-row">
          <label class="field"><span>Due date <em class="optional">(optional)</em></span><input type="date" name="dueDate" value="${esc(v.dueDate)}"></label>
          <label class="field"><span>Estimated minutes</span><input type="number" name="estimatedMinutes" min="5" max="600" step="5" value="${v.estimatedMinutes || ''}" placeholder="30"></label>
        </div>
        <p class="form-error" role="alert" hidden></p>
        <div class="form-actions"><button type="button" class="btn btn-ghost" data-modal-dismiss>Cancel</button><button type="submit" class="btn btn-primary">${t ? 'Save changes' : 'Add task'}</button></div>
      </form>`,
    });
  }

  on('click', 'task:new', () => openForm());
  on('click', 'task:edit', (el) => openForm(el.dataset.id));

  on('submit', 'task:save', async (form) => {
    const f = form.elements;
    const err = form.querySelector('.form-error');
    const fail = (msg, field) => {
      err.textContent = msg;
      err.hidden = false;
      field.setAttribute('aria-invalid', 'true');
      field.focus();
    };
    [...form.querySelectorAll('[aria-invalid]')].forEach((n) => n.removeAttribute('aria-invalid'));
    err.hidden = true;
    const title = f.title.value.trim();
    if (!title) return fail('Give the task a title.', f.title);
    if (f.dueDate.value && !dates.isValidKey(f.dueDate.value)) return fail('That due date isn’t valid.', f.dueDate);
    const minutesRaw = f.estimatedMinutes.value.trim();
    const minutes = minutesRaw === '' ? 0 : Math.round(Number(minutesRaw));
    if (!Number.isFinite(minutes) || minutes < 0 || minutes > 1440) return fail('Estimated minutes must be a number between 5 and 600.', f.estimatedMinutes);
    const existing = f.id.value ? S.find('tasks', f.id.value) : null;
    const base = { title, subjectId: f.subjectId.value, priority: PRIORITIES.includes(f.priority.value) ? f.priority.value : 'Medium', dueDate: f.dueDate.value, estimatedMinutes: minutes };
    try {
      if (existing) await S.update('tasks', { ...existing, ...base });
      else {
        await S.add('tasks', { id: uid(), ...base, completed: false, createdAt: Date.now(), completedAt: null });
        S.logActivity('task', `Added task “${title}”`);
      }
      L.ui.closeModal(form);
      L.ui.toast(existing ? 'Task updated' : 'Task added', { type: 'success' });
    } catch (e) {
      console.error(e);
      err.textContent = 'Could not save. Please try again.';
      err.hidden = false;
    }
  });

  on('click', 'task:toggle', async (el) => {
    const t = S.find('tasks', el.dataset.id);
    if (!t) return;
    const completed = !t.completed;
    justDone = completed ? t.id : null;
    try {
      await S.update('tasks', { ...t, completed, completedAt: completed ? Date.now() : null });
      if (completed) {
        S.logActivity('task', `Completed “${t.title}”`);
        L.ui.toast('Task completed ✦', { type: 'success', duration: 2200 });
      }
    } catch (e) {
      console.error(e);
      L.ui.toast('Could not update the task.', { type: 'error' });
    }
  });

  on('click', 'task:delete', async (el) => {
    const t = S.find('tasks', el.dataset.id);
    if (!t) return;
    const ok = await L.ui.confirm({ title: 'Delete this task?', message: `“${t.title}” will be removed permanently.`, confirmLabel: 'Delete task', danger: true });
    if (!ok) return;
    await S.remove('tasks', t.id);
    L.ui.toast('Task deleted');
  });

  on('click', 'tasks:tab', (btn) => {
    tab = btn.dataset.tab;
    renderTabs();
    renderList();
    document.querySelector(`#task-tabs [data-tab="${tab}"]`)?.focus();
  });
  on('input', 'tasks:search', (el) => {
    query = el.value;
    renderList();
  });
  on('change', 'tasks:subject', (el) => {
    subjectFilter = el.value;
    renderList();
  });
  on('change', 'tasks:priority', (el) => {
    priorityFilter = el.value;
    renderList();
  });
  on('change', 'tasks:sort', (el) => {
    sort = el.value;
    renderList();
  });

  const view = {
    title: 'Tasks',
    render(root) {
      const opt = (v, l, cur) => `<option value="${esc(v)}"${v === cur ? ' selected' : ''}>${esc(l)}</option>`;
      const subjectOpts = [opt('all', 'All subjects', subjectFilter), opt('none', 'No subject', subjectFilter), ...S.get('subjects').map((s) => opt(s.id, s.name, subjectFilter))].join('');
      root.innerHTML = `
        <div class="page-head">
          <div><h2 class="page-title">Tasks</h2><p class="lede">Deadlines, priorities and time estimates that also shape your daily plan.</p></div>
          <button type="button" class="btn btn-primary" data-click="task:new">${icon('plus', 18)}<span>Add task</span></button>
        </div>
        <div id="task-tabs"></div>
        <div class="toolbar">
          <label class="search"><span class="sr-only">Search tasks</span>${icon('search', 18)}<input type="search" placeholder="Search tasks" value="${esc(query)}" data-input="tasks:search" autocomplete="off"></label>
          <label class="select-inline"><span>Subject</span><select data-change="tasks:subject" id="task-subject-filter">${subjectOpts}</select></label>
          <label class="select-inline"><span>Priority</span><select data-change="tasks:priority">${opt('all', 'Any', priorityFilter)}${PRIORITIES.map((p) => opt(p, p, priorityFilter)).join('')}</select></label>
          <label class="select-inline"><span>Sort</span><select data-change="tasks:sort">${opt('due', 'Due date', sort)}${opt('priority', 'Priority', sort)}${opt('created', 'Newest', sort)}${opt('time', 'Shortest first', sort)}${opt('title', 'Title', sort)}</select></label>
          <span class="toolbar-count" id="task-count" aria-live="polite"></span>
        </div>
        <div id="task-list"></div>`;
      renderTabs();
      renderList();
    },
    update() {
      const sel = document.getElementById('task-subject-filter');
      if (sel && document.activeElement !== sel) {
        const opt = (v, l) => `<option value="${esc(v)}"${v === subjectFilter ? ' selected' : ''}>${esc(l)}</option>`;
        sel.innerHTML = [opt('all', 'All subjects'), opt('none', 'No subject'), ...S.get('subjects').map((s) => opt(s.id, s.name))].join('');
      }
      renderTabs();
      renderList();
    },
  };

  L.views = L.views || {};
  L.views.tasks = view;
  L.tasks = { card, openForm, isOverdue, PRIORITIES };
})();
