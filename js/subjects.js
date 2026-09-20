/* ==========================================================================
   Lumina — subjects.js
   Subject management: create, edit, delete, search and filter.
   Subject = { id, name, color, description, targetHours, createdAt }
   ========================================================================== */
(() => {
  'use strict';
  const L = (window.Lumina = window.Lumina || {});
  const { esc, uid, palette, deepOf, plural, clamp, fmt } = L.utils;
  const { icon, on, progress, emptyState, dropdown } = L.ui;
  const S = L.state;
  const A = L.analytics;

  let query = '';
  let filter = 'all';
  let sort = 'name';

  /* ---------- Subject card component ---------- */
  function card(st) {
    const { subject } = st;
    const last = st.lastKey ? (st.daysSince === 0 ? 'Today' : st.daysSince === 1 ? 'Yesterday' : `${st.daysSince} days ago`) : 'Not yet';
    return `<article class="subject-card" style="--subject:${esc(subject.color)};--subject-deep:${esc(deepOf(subject.color))}" data-id="${esc(subject.id)}">
      <header class="subject-head">
        <span class="subject-swatch" aria-hidden="true"></span>
        <h3>${esc(subject.name)}</h3>
        ${dropdown({
          label: `Actions for ${subject.name}`,
          items: [
            { label: 'Edit subject', action: 'subject:edit', data: { id: subject.id }, icon: 'edit' },
            { label: 'Delete subject', action: 'subject:delete', data: { id: subject.id }, icon: 'trash', danger: true },
          ],
        })}
      </header>
      <p class="subject-desc">${subject.description ? esc(subject.description) : '<span class="muted">No description yet.</span>'}</p>
      <div class="subject-progress">
        ${progress(st.completion, { color: deepOf(subject.color), label: `${subject.name} progress` })}
        <span class="progress-caption"><strong>${Math.round(st.completion)}%</strong> ${esc(st.basis)}</span>
      </div>
      <dl class="subject-stats">
        <div><dt>Study time</dt><dd>${esc(fmt.duration(st.minutes))}</dd></div>
        <div><dt>Tasks</dt><dd>${st.tasksDone} / ${st.tasksTotal} done</dd></div>
        <div><dt>Notes</dt><dd>${st.notes}</dd></div>
        <div><dt>Last studied</dt><dd>${esc(last)}</dd></div>
      </dl>
      <footer class="subject-foot">
        <button type="button" class="btn btn-soft btn-sm" data-click="subject:focus" data-id="${esc(subject.id)}">${icon('timer', 16)}<span>Focus on this</span></button>
        ${st.overdue ? `<span class="badge badge-warn">${plural(st.overdue, 'overdue task')}</span>` : ''}
      </footer>
    </article>`;
  }

  /* ---------- list ---------- */
  function filtered() {
    const q = query.trim().toLowerCase();
    let rows = A.subjectStats().filter((st) => {
      if (q && !`${st.subject.name} ${st.subject.description}`.toLowerCase().includes(q)) return false;
      switch (filter) {
        case 'week':
          return st.weekMinutes > 0;
        case 'idle':
          return st.weekMinutes === 0;
        case 'open':
          return st.tasksOpen > 0;
        case 'attention':
          return st.overdue > 0 || (st.daysSince !== null && st.daysSince >= 7);
        default:
          return true;
      }
    });
    rows = rows.slice().sort((a, b) => {
      if (sort === 'time') return b.minutes - a.minutes;
      if (sort === 'recent') return (a.daysSince ?? 9999) - (b.daysSince ?? 9999);
      if (sort === 'stale') return (b.daysSince ?? 9999) - (a.daysSince ?? 9999);
      return a.subject.name.localeCompare(b.subject.name);
    });
    return rows;
  }

  function renderList() {
    const host = document.getElementById('subject-list');
    if (!host) return;
    const total = S.get('subjects').length;
    const rows = filtered();
    if (!total) {
      host.className = '';
      host.innerHTML = emptyState({
        icon: '📚',
        title: 'No subjects yet',
        text: 'A subject groups your tasks, notes and study time. Start with the one on your mind.',
        action: { label: 'Add a subject', click: 'subject:new' },
      });
    } else if (!rows.length) {
      host.className = '';
      host.innerHTML = emptyState({ icon: '🔍', title: 'No subjects match', text: 'Try a different search or filter.' });
    } else {
      host.className = 'card-grid';
      host.innerHTML = rows.map(card).join('');
    }
    const count = document.getElementById('subject-count');
    if (count) count.textContent = total ? `${rows.length} of ${plural(total, 'subject')}` : '';
  }

  /* ---------- form ---------- */
  function openForm(id) {
    const existing = id ? S.find('subjects', id) : null;
    const used = new Set(S.get('subjects').map((s) => s.color));
    const color = existing ? existing.color : (palette.find((p) => !used.has(p.fill)) || palette[S.get('subjects').length % palette.length]).fill;
    L.ui.modal({
      title: existing ? 'Edit subject' : 'New subject',
      body: `<form class="form" data-submit="subject:save" novalidate>
        <input type="hidden" name="id" value="${esc(existing ? existing.id : '')}">
        <label class="field"><span>Name</span><input name="name" maxlength="60" required autofocus autocomplete="off" placeholder="e.g. Computer Networks" value="${esc(existing ? existing.name : '')}"></label>
        <fieldset class="field swatches"><legend>Colour</legend>
          <div class="swatch-row">${palette
            .map(
              (p) => `<label class="swatch"><input type="radio" name="color" value="${p.fill}"${p.fill.toLowerCase() === color.toLowerCase() ? ' checked' : ''}><span style="--sw:${p.fill};--sw-deep:${p.deep}"><span class="sr-only">${p.name}</span></span></label>`
            )
            .join('')}</div>
        </fieldset>
        <label class="field"><span>Description <em class="optional">(optional)</em></span><textarea name="description" rows="2" maxlength="200" placeholder="What are you studying here?">${esc(existing ? existing.description : '')}</textarea></label>
        <label class="field"><span>Target hours</span><input type="number" name="targetHours" min="0" max="2000" step="1" value="${existing ? existing.targetHours : 30}"><small class="hint">Total hours you want to study this subject. Use 0 to track by tasks instead.</small></label>
        <p class="form-error" role="alert" hidden></p>
        <div class="form-actions"><button type="button" class="btn btn-ghost" data-modal-dismiss>Cancel</button><button type="submit" class="btn btn-primary">${existing ? 'Save changes' : 'Add subject'}</button></div>
      </form>`,
    });
  }

  on('click', 'subject:new', () => openForm());
  on('click', 'subject:edit', (el) => openForm(el.dataset.id));
  on('click', 'subject:focus', (el) => L.timer.prepare({ subjectId: el.dataset.id }));

  on('submit', 'subject:save', async (form) => {
    const f = form.elements;
    const name = f.name.value.trim();
    const err = form.querySelector('.form-error');
    const fail = (msg, field) => {
      err.textContent = msg;
      err.hidden = false;
      field.setAttribute('aria-invalid', 'true');
      field.focus();
    };
    f.name.removeAttribute('aria-invalid');
    err.hidden = true;
    if (!name) return fail('Give the subject a name.', f.name);
    const clash = S.get('subjects').find((s) => s.name.toLowerCase() === name.toLowerCase() && s.id !== f.id.value);
    if (clash) return fail(`You already have a subject called “${clash.name}”.`, f.name);
    const target = clamp(Number(f.targetHours.value) || 0, 0, 2000);
    const color = (form.querySelector('input[name="color"]:checked') || {}).value || palette[0].fill;
    const existing = f.id.value ? S.find('subjects', f.id.value) : null;
    const record = existing
      ? { ...existing, name, color, description: f.description.value.trim(), targetHours: target }
      : { id: uid(), name, color, description: f.description.value.trim(), targetHours: target, createdAt: Date.now() };
    try {
      if (existing) await S.update('subjects', record);
      else {
        await S.add('subjects', record);
        S.logActivity('subject', `Added subject “${name}”`);
      }
      L.ui.closeModal(form);
      L.ui.toast(existing ? 'Subject updated' : 'Subject added', { type: 'success' });
    } catch (e) {
      console.error(e);
      err.textContent = 'Could not save. Please try again.';
      err.hidden = false;
    }
  });

  on('click', 'subject:delete', async (el) => {
    const subject = S.find('subjects', el.dataset.id);
    if (!subject) return;
    const tasks = S.get('tasks').filter((t) => t.subjectId === subject.id);
    const notes = S.get('notes').filter((n) => n.subjectId === subject.id);
    const ok = await L.ui.confirm({
      title: `Delete “${subject.name}”?`,
      messageHTML: `<p>The subject will be removed. Its ${plural(tasks.length, 'task')} and ${plural(notes.length, 'note')} are kept but become unassigned, and your study history stays in your analytics.</p>`,
      confirmLabel: 'Delete subject',
      danger: true,
    });
    if (!ok) return;
    try {
      for (const t of tasks) await S.update('tasks', { ...t, subjectId: '' });
      for (const n of notes) await S.update('notes', { ...n, subjectId: '' });
      await S.remove('subjects', subject.id);
      if (S.prefs.get('lastSubjectId') === subject.id) S.prefs.set('lastSubjectId', '');
      S.logActivity('subject', `Deleted subject “${subject.name}”`);
      L.ui.toast('Subject deleted');
    } catch (e) {
      console.error(e);
      L.ui.toast('Could not delete the subject.', { type: 'error' });
    }
  });

  on('input', 'subjects:search', (el) => {
    query = el.value;
    renderList();
  });
  on('change', 'subjects:filter', (el) => {
    filter = el.value;
    renderList();
  });
  on('change', 'subjects:sort', (el) => {
    sort = el.value;
    renderList();
  });

  const view = {
    title: 'Subjects',
    render(root) {
      const opt = (v, l, cur) => `<option value="${v}"${v === cur ? ' selected' : ''}>${l}</option>`;
      root.innerHTML = `
        <div class="page-head">
          <div><h2 class="page-title">Subjects</h2><p class="lede">Everything you study, with its time, tasks and notes in one place.</p></div>
          <button type="button" class="btn btn-primary" data-click="subject:new">${icon('plus', 18)}<span>Add subject</span></button>
        </div>
        <div class="toolbar">
          <label class="search"><span class="sr-only">Search subjects</span>${icon('search', 18)}<input type="search" placeholder="Search subjects" value="${esc(query)}" data-input="subjects:search" autocomplete="off"></label>
          <label class="select-inline"><span>Show</span><select data-change="subjects:filter">
            ${opt('all', 'All subjects', filter)}${opt('week', 'Studied this week', filter)}${opt('idle', 'Not studied this week', filter)}${opt('open', 'With open tasks', filter)}${opt('attention', 'Needs attention', filter)}
          </select></label>
          <label class="select-inline"><span>Sort</span><select data-change="subjects:sort">
            ${opt('name', 'Name', sort)}${opt('time', 'Most studied', sort)}${opt('recent', 'Recently studied', sort)}${opt('stale', 'Longest idle', sort)}
          </select></label>
          <span class="toolbar-count" id="subject-count" aria-live="polite"></span>
        </div>
        <div id="subject-list"></div>`;
      renderList();
    },
    update() {
      renderList();
    },
  };

  L.views = L.views || {};
  L.views.subjects = view;
  L.subjects = { openForm, card };
})();
