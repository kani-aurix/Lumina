/* ==========================================================================
   Lumina — notes.js
   Offline notes. Note = { id, title, content, subjectId, tags, createdAt, updatedAt }
   • Auto-save (debounced) to IndexedDB
   • Markdown-like preview: # Heading, **bold**, *italic*, - bullet, 1. list, `code`
   • Search, tag filter, subject filter
   ========================================================================== */
(() => {
  'use strict';
  const L = (window.Lumina = window.Lumina || {});
  const { esc, uid, fmt, md, deepOf, plural } = L.utils;
  const { icon, on, emptyState } = L.ui;
  const S = L.state;

  const SAVE_DELAY = 600;
  const isNarrow = () => window.matchMedia('(max-width: 900px)').matches;

  let selectedId = null;
  let query = '';
  let subjectFilter = 'all';
  let tagFilter = '';
  let mode = window.innerWidth >= 1200 ? 'split' : 'write';
  let editorOpen = false; // narrow screens: show editor instead of list
  let dirty = false;
  let saveTimer = null;

  /* ---------- helpers ---------- */
  const isEmptyNote = (n) => !n.title.trim() && !n.content.trim() && !n.tags.length;
  const words = (text) => (text.trim() ? text.trim().split(/\s+/).length : 0);
  const snippet = (text) => text.replace(/[#*`>[\]_-]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 110);
  const parseTags = (raw) =>
    [...new Set(String(raw).split(/[,\n]/).map((t) => t.trim().replace(/^#/, '').toLowerCase().slice(0, 24)).filter(Boolean))].slice(0, 10);

  function visibleNotes() {
    const q = query.trim().toLowerCase();
    return S.get('notes')
      .filter((n) => {
        if (subjectFilter === 'none' && n.subjectId) return false;
        if (subjectFilter !== 'all' && subjectFilter !== 'none' && n.subjectId !== subjectFilter) return false;
        if (tagFilter && !n.tags.includes(tagFilter)) return false;
        if (q && !`${n.title} ${n.content} ${n.tags.join(' ')} ${S.subjectName(n.subjectId, '')}`.toLowerCase().includes(q)) return false;
        return true;
      })
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  /* ---------- Note card component ---------- */
  function card(note, { selected = false } = {}) {
    const subject = S.find('subjects', note.subjectId);
    return `<button type="button" class="note-card${selected ? ' is-selected' : ''}" data-click="note:select" data-id="${esc(note.id)}" aria-current="${selected}">
      <h3>${esc(note.title.trim() || 'Untitled note')}</h3>
      <p class="note-snippet">${esc(snippet(note.content)) || '<span class="muted">No content yet</span>'}</p>
      <span class="note-meta">
        ${subject ? `<span class="chip" style="--chip:${esc(subject.color)};--chip-deep:${esc(deepOf(subject.color))}">${esc(subject.name)}</span>` : ''}
        ${note.tags.slice(0, 3).map((t) => `<span class="tag">#${esc(t)}</span>`).join('')}
        <time>${esc(fmt.ago(note.updatedAt))}</time>
      </span>
    </button>`;
  }

  /* ---------- list ---------- */
  function renderList() {
    const host = document.getElementById('note-list');
    if (!host) return;
    const all = S.get('notes');
    const list = visibleNotes();
    if (!all.length) {
      host.innerHTML = emptyState({ icon: '📝', title: 'No notes yet', text: 'Capture formulas, definitions and things to revisit.', action: { label: 'Write a note', click: 'note:new' } });
    } else if (!list.length) {
      host.innerHTML = emptyState({ icon: '🔍', title: 'No notes match', text: 'Try another search, tag or subject.' });
    } else {
      host.innerHTML = list.map((n) => card(n, { selected: n.id === selectedId })).join('');
    }
    const count = document.getElementById('note-count');
    if (count) count.textContent = all.length ? `${list.length} of ${plural(all.length, 'note')}` : '';
    renderTags();
  }

  function renderTags() {
    const host = document.getElementById('note-tags');
    if (!host) return;
    const counts = new Map();
    S.get('notes').forEach((n) => n.tags.forEach((t) => counts.set(t, (counts.get(t) || 0) + 1)));
    const tags = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 12);
    host.innerHTML = tags.length
      ? tags.map(([t, n]) => `<button type="button" class="tag-chip" aria-pressed="${t === tagFilter}" data-click="notes:tag" data-tag="${esc(t)}">#${esc(t)} <span>${n}</span></button>`).join('')
      : '';
  }

  /* ---------- editor ---------- */
  function statusText(note) {
    return `${dirty ? 'Saving…' : 'Saved'}. Last edited ${fmt.dateTime(note.updatedAt)}. ${plural(words(note.content), 'word')}.`;
  }

  function renderPreview(text) {
    const el = document.getElementById('note-preview');
    if (el) el.innerHTML = text.trim() ? md(text) : '<p class="muted">Nothing to preview yet.</p>';
  }

  function renderEditor(focusTitle = false) {
    const host = document.getElementById('note-editor');
    if (!host) return;
    const note = S.find('notes', selectedId);
    document.getElementById('notes-layout')?.setAttribute('data-editor-open', String(editorOpen && Boolean(note)));
    if (!note) {
      host.innerHTML = emptyState({ icon: '✦', title: 'Pick a note or start a new one', text: 'Notes save automatically as you type.', action: { label: 'New note', click: 'note:new' } });
      return;
    }
    host.innerHTML = `
      <div class="editor-bar">
        <button type="button" class="icon-btn only-narrow" data-click="note:back" aria-label="Back to all notes" data-tip="Back">${icon('back')}</button>
        <input class="note-title" id="note-title" name="title" placeholder="Untitled note" maxlength="140" autocomplete="off" aria-label="Note title" value="${esc(note.title)}" data-input="note:edit">
        <div class="segmented" role="radiogroup" aria-label="Editor view">
          ${[['write', 'Write'], ['split', 'Split'], ['preview', 'Preview']]
            .map(([k, l]) => `<button type="button" role="radio" aria-checked="${mode === k}" class="seg${k === 'split' ? ' seg-split' : ''}" data-click="note:mode" data-mode="${k}">${l}</button>`)
            .join('')}
        </div>
        <button type="button" class="icon-btn" data-click="note:delete" aria-label="Delete this note" data-tip="Delete">${icon('trash')}</button>
      </div>
      <div class="editor-meta">
        <label class="field field-inline"><span>Subject</span><select id="note-subject" name="subjectId" data-change="note:edit">${S.subjectOptions(note.subjectId)}</select></label>
        <label class="field field-inline grow"><span>Tags</span><input id="note-tags-input" name="tags" placeholder="exam, formulas" autocomplete="off" value="${esc(note.tags.join(', '))}" data-input="note:edit"></label>
      </div>
      <div class="editor-body" data-mode="${mode}">
        <textarea id="note-content" class="note-content" name="content" aria-label="Note content" placeholder="Write here.&#10;# Heading&#10;**bold**&#10;- bullet" spellcheck="true" data-input="note:edit">${esc(note.content)}</textarea>
        <div class="note-preview" id="note-preview" aria-label="Formatted preview"></div>
      </div>
      <p class="editor-status" id="note-status" role="status">${esc(statusText(note))}</p>`;
    renderPreview(note.content);
    if (focusTitle) document.getElementById('note-title')?.focus();
  }

  /* ---------- saving ---------- */
  function readForm(note) {
    const val = (id) => document.getElementById(id);
    if (!val('note-title')) return note;
    return {
      ...note,
      title: val('note-title').value,
      content: val('note-content').value,
      subjectId: val('note-subject').value,
      tags: parseTags(val('note-tags-input').value),
      updatedAt: Date.now(),
    };
  }

  async function commit() {
    clearTimeout(saveTimer);
    saveTimer = null;
    if (!dirty || !selectedId) return;
    const note = S.find('notes', selectedId);
    if (!note) return;
    const next = readForm(note);
    dirty = false;
    try {
      await S.update('notes', next);
      const status = document.getElementById('note-status');
      if (status) status.textContent = statusText(next);
    } catch (e) {
      console.error(e);
      dirty = true;
      L.ui.toast('Auto-save failed. Your text is still on screen.', { type: 'error' });
    }
  }

  const onEdit = (el) => {
    const note = S.find('notes', selectedId);
    if (!note) return;
    dirty = true;
    if (el.id === 'note-content') renderPreview(el.value);
    const status = document.getElementById('note-status');
    if (status) status.textContent = 'Saving…';
    clearTimeout(saveTimer);
    saveTimer = setTimeout(commit, SAVE_DELAY);
  };
  on('input', 'note:edit', onEdit);
  on('change', 'note:edit', onEdit);

  /** Silently drop a note that was created but never written in. */
  async function dropIfEmpty() {
    const note = S.find('notes', selectedId);
    if (note && !dirty && isEmptyNote(note)) await S.remove('notes', note.id);
  }

  async function select(id) {
    await commit();
    if (selectedId && selectedId !== id) await dropIfEmpty();
    selectedId = id;
    editorOpen = true;
    renderList();
    renderEditor();
  }

  async function create(defaults = {}) {
    await commit();
    await dropIfEmpty();
    const now = Date.now();
    const note = { id: uid(), title: '', content: '', subjectId: defaults.subjectId ?? (subjectFilter !== 'all' && subjectFilter !== 'none' ? subjectFilter : ''), tags: tagFilter ? [tagFilter] : [], createdAt: now, updatedAt: now };
    await S.add('notes', note);
    S.logActivity('note', 'Started a new note');
    selectedId = note.id;
    editorOpen = true;
    if (location.hash !== '#/notes') location.hash = '#/notes';
    else {
      renderList();
      renderEditor(true);
    }
  }

  on('click', 'note:new', () => create());
  on('click', 'note:select', (el) => select(el.dataset.id));
  on('click', 'note:back', async () => {
    await commit();
    await dropIfEmpty();
    editorOpen = false;
    renderList();
    document.getElementById('notes-layout')?.setAttribute('data-editor-open', 'false');
  });
  on('click', 'note:mode', (btn) => {
    mode = btn.dataset.mode;
    document.querySelector('.editor-body')?.setAttribute('data-mode', mode);
    document.querySelectorAll('.segmented [role="radio"]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.mode === mode)));
  });
  on('click', 'note:delete', async () => {
    const note = S.find('notes', selectedId);
    if (!note) return;
    await commit();
    const ok = await L.ui.confirm({ title: 'Delete this note?', message: `“${note.title.trim() || 'Untitled note'}” will be removed permanently.`, confirmLabel: 'Delete note', danger: true });
    if (!ok) return;
    await S.remove('notes', note.id);
    selectedId = null;
    editorOpen = false;
    const next = visibleNotes()[0];
    if (next && !isNarrow()) selectedId = next.id;
    renderList();
    renderEditor();
    L.ui.toast('Note deleted');
  });
  on('click', 'notes:tag', (btn) => {
    tagFilter = tagFilter === btn.dataset.tag ? '' : btn.dataset.tag;
    renderList();
  });
  on('input', 'notes:search', (el) => {
    query = el.value;
    renderList();
  });
  on('change', 'notes:subject', (el) => {
    subjectFilter = el.value;
    renderList();
  });

  /* ---------- page ---------- */
  const view = {
    title: 'Notes',
    render(root) {
      if (!selectedId || !S.find('notes', selectedId)) {
        selectedId = null;
        if (!isNarrow()) selectedId = visibleNotes()[0]?.id || null;
        editorOpen = false;
      }
      const opt = (v, l) => `<option value="${esc(v)}"${v === subjectFilter ? ' selected' : ''}>${esc(l)}</option>`;
      root.innerHTML = `
        <div class="page-head">
          <div><h2 class="page-title">Notes</h2><p class="lede">Written and stored on this device. They save as you type.</p></div>
          <button type="button" class="btn btn-primary" data-click="note:new">${icon('plus', 18)}<span>New note</span></button>
        </div>
        <div class="notes-layout" id="notes-layout" data-editor-open="${editorOpen}">
          <aside class="notes-list-pane" aria-label="Your notes">
            <div class="toolbar toolbar-stack">
              <label class="search"><span class="sr-only">Search notes</span>${icon('search', 18)}<input type="search" placeholder="Search notes" value="${esc(query)}" data-input="notes:search" autocomplete="off"></label>
              <label class="select-inline"><span>Subject</span><select id="note-subject-filter" data-change="notes:subject">${opt('all', 'All subjects')}${opt('none', 'No subject')}${S.get('subjects').map((s) => opt(s.id, s.name)).join('')}</select></label>
              <span class="toolbar-count" id="note-count" aria-live="polite"></span>
            </div>
            <div class="tag-row" id="note-tags"></div>
            <div class="note-list" id="note-list"></div>
          </aside>
          <section class="note-editor-pane" id="note-editor" aria-label="Note editor"></section>
        </div>`;
      renderList();
      renderEditor();
    },
    update() {
      const sel = document.getElementById('note-subject-filter');
      if (sel && document.activeElement !== sel) {
        const opt = (v, l) => `<option value="${esc(v)}"${v === subjectFilter ? ' selected' : ''}>${esc(l)}</option>`;
        sel.innerHTML = opt('all', 'All subjects') + opt('none', 'No subject') + S.get('subjects').map((s) => opt(s.id, s.name)).join('');
      }
      renderList();
      // if the open note disappeared (e.g. a backup import), reset the editor
      if (selectedId && !S.find('notes', selectedId)) {
        selectedId = null;
        renderEditor();
      }
      const subj = document.getElementById('note-subject');
      if (subj && document.activeElement !== subj && selectedId) subj.innerHTML = S.subjectOptions(S.find('notes', selectedId)?.subjectId || '');
    },
    async destroy() {
      await commit();
      await dropIfEmpty();
    },
  };

  window.addEventListener('beforeunload', () => {
    commit();
  });

  L.views = L.views || {};
  L.views.notes = view;
  L.notes = { card, create, flush: commit };
})();
