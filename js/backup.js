/* ==========================================================================
   Lumina — backup.js
   Export / import / clear, plus the Privacy Center page.

   Backup file (lumina-backup.json):
     { app: "lumina", version: 1, exportedAt, data: {
         subjects, tasks, sessions, notes, settings, activity } }
   Preferences kept in localStorage travel inside `settings` as the record
   { key: "__preferences__", value: {...} } so a restore is complete.
   ========================================================================== */
(() => {
  'use strict';
  const L = (window.Lumina = window.Lumina || {});
  const { dates, fmt, esc, plural, palette, uid } = L.utils;
  const { icon, on } = L.ui;
  const S = L.state;

  const APP_TAG = 'lumina';
  const FORMAT_VERSION = 1;
  const PREF_KEY = '__preferences__';
  const MAX_BYTES = 50 * 1024 * 1024;
  const PRIORITIES = ['Low', 'Medium', 'High', 'Urgent'];

  /* ---------- export ---------- */
  async function buildExport() {
    const data = await L.db.exportAll();
    data.settings = data.settings.filter((s) => s.key !== PREF_KEY);
    data.settings.push({ key: PREF_KEY, value: S.prefs.all(), updatedAt: Date.now() });
    return { app: APP_TAG, version: FORMAT_VERSION, exportedAt: new Date().toISOString(), data };
  }

  async function exportData() {
    try {
      const payload = await buildExport();
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'lumina-backup.json';
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      await S.setSetting('lastBackupAt', Date.now());
      S.logActivity('backup', 'Exported a backup');
      L.ui.toast('Backup saved as lumina-backup.json', { type: 'success' });
    } catch (err) {
      console.error(err);
      L.ui.toast('Could not create the backup. Please try again.', { type: 'error' });
    }
  }

  /* ---------- validation ---------- */
  const isStr = (v) => typeof v === 'string' && v.length > 0;
  const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
  const REQUIRED = {
    subjects: { id: isStr, name: isStr },
    tasks: { id: isStr, title: isStr },
    sessions: { id: isStr, startedAt: isNum, durationSec: (v) => isNum(v) && v >= 0 },
    notes: { id: isStr },
    settings: { key: isStr },
    activity: { id: isStr, at: isNum },
  };

  const normalize = {
    subjects: (r) => ({
      id: r.id,
      name: String(r.name).slice(0, 80),
      color: isStr(r.color) ? r.color : palette[0].fill,
      description: typeof r.description === 'string' ? r.description : '',
      targetHours: isNum(r.targetHours) && r.targetHours >= 0 ? r.targetHours : 0,
      createdAt: isNum(r.createdAt) ? r.createdAt : Date.now(),
    }),
    tasks: (r) => ({
      id: r.id,
      title: String(r.title).slice(0, 200),
      subjectId: typeof r.subjectId === 'string' ? r.subjectId : '',
      priority: PRIORITIES.includes(r.priority) ? r.priority : 'Medium',
      dueDate: dates.isValidKey(r.dueDate) ? r.dueDate : '',
      estimatedMinutes: isNum(r.estimatedMinutes) && r.estimatedMinutes > 0 ? Math.round(r.estimatedMinutes) : 0,
      completed: Boolean(r.completed),
      createdAt: isNum(r.createdAt) ? r.createdAt : Date.now(),
      completedAt: isNum(r.completedAt) ? r.completedAt : null,
    }),
    sessions: (r) => ({
      id: r.id,
      subjectId: typeof r.subjectId === 'string' ? r.subjectId : '',
      subjectName: typeof r.subjectName === 'string' ? r.subjectName : '',
      startedAt: r.startedAt,
      endedAt: isNum(r.endedAt) ? r.endedAt : r.startedAt + r.durationSec * 1000,
      durationSec: Math.round(r.durationSec),
      plannedMinutes: isNum(r.plannedMinutes) ? r.plannedMinutes : Math.round(r.durationSec / 60),
      mode: typeof r.mode === 'string' ? r.mode : 'custom',
      productivity: isNum(r.productivity) && r.productivity >= 1 && r.productivity <= 5 ? Math.round(r.productivity) : 0,
      date: dates.isValidKey(r.date) ? r.date : dates.key(r.startedAt),
    }),
    notes: (r) => ({
      id: r.id,
      title: typeof r.title === 'string' ? r.title : '',
      content: typeof r.content === 'string' ? r.content : '',
      subjectId: typeof r.subjectId === 'string' ? r.subjectId : '',
      tags: Array.isArray(r.tags) ? r.tags.filter((t) => typeof t === 'string').slice(0, 20) : [],
      createdAt: isNum(r.createdAt) ? r.createdAt : Date.now(),
      updatedAt: isNum(r.updatedAt) ? r.updatedAt : Date.now(),
    }),
    settings: (r) => ({ key: r.key, value: r.value, updatedAt: isNum(r.updatedAt) ? r.updatedAt : Date.now() }),
    activity: (r) => ({ id: r.id, type: typeof r.type === 'string' ? r.type : 'info', text: typeof r.text === 'string' ? r.text : '', at: r.at }),
  };

  /** Returns { ok, errors, data, counts } — never throws on bad input. */
  function validate(raw) {
    const errors = [];
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, errors: ['The file is valid JSON, but it is not a Lumina backup.'] };
    if (raw.app !== APP_TAG) errors.push('This file was not exported from Lumina (the "app" field is missing or different).');
    if (!isNum(raw.version)) errors.push('The backup has no version number.');
    else if (raw.version > FORMAT_VERSION) errors.push(`This backup was made by a newer version of Lumina (format ${raw.version}).`);
    if (!raw.data || typeof raw.data !== 'object') errors.push('The backup has no "data" section.');
    if (errors.length) return { ok: false, errors };

    const data = {};
    const counts = {};
    for (const [store, rules] of Object.entries(REQUIRED)) {
      const list = raw.data[store];
      if (!Array.isArray(list)) {
        errors.push(`The "${store}" list is missing or is not a list.`);
        continue;
      }
      const seen = new Set();
      data[store] = [];
      list.forEach((rec, i) => {
        if (!rec || typeof rec !== 'object') {
          errors.push(`${store}[${i}] is not a record.`);
          return;
        }
        const bad = Object.entries(rules).find(([field, check]) => !check(rec[field]));
        if (bad) {
          errors.push(`${store}[${i}] has a missing or invalid "${bad[0]}".`);
          return;
        }
        const key = store === 'settings' ? rec.key : rec.id;
        if (seen.has(key)) {
          errors.push(`${store}[${i}] repeats the id "${key}".`);
          return;
        }
        seen.add(key);
        data[store].push(normalize[store](rec));
      });
      counts[store] = data[store].length;
    }
    return { ok: errors.length === 0, errors, data, counts };
  }

  /* ---------- import ---------- */
  const COUNT_LABELS = [['subjects', 'subject'], ['tasks', 'task'], ['sessions', 'study session'], ['notes', 'note'], ['activity', 'activity entry', 'activity entries']];

  async function readBackupFile(file) {
    if (!file) return;
    if (file.size > MAX_BYTES) {
      showImportError(['The file is larger than 50 MB, which is far bigger than any Lumina backup.']);
      return;
    }
    let parsed;
    try {
      parsed = JSON.parse(await file.text());
    } catch {
      showImportError(['This file is not valid JSON, so it cannot be a Lumina backup.']);
      return;
    }
    const result = validate(parsed);
    if (!result.ok) {
      showImportError(result.errors);
      return;
    }
    confirmImport(result, file.name);
  }

  function showImportError(errors) {
    const shown = errors.slice(0, 6);
    const more = errors.length - shown.length;
    L.ui.modal({
      title: 'This backup can’t be imported',
      size: 'sm',
      body: `<p>Nothing was changed. Here is what needs fixing:</p>
             <ul class="error-list">${shown.map((e) => `<li>${esc(e)}</li>`).join('')}${more > 0 ? `<li>…and ${more} more.</li>` : ''}</ul>`,
      footer: '<button type="button" class="btn btn-primary" data-modal-dismiss>Close</button>',
    });
  }

  function confirmImport(result, fileName) {
    const lines = COUNT_LABELS.map(([k, one, many]) => `<li><strong>${result.counts[k]}</strong> ${result.counts[k] === 1 ? one : many || `${one}s`}</li>`).join('');
    const m = L.ui.modal({
      title: 'Import this backup?',
      size: 'sm',
      body: `<p class="import-warning"><strong>Importing this backup may replace existing data.</strong> Anything on this device that is not in the backup will be removed.</p>
             <p class="fine-print">File: ${esc(fileName)}</p>
             <ul class="import-counts">${lines}</ul>`,
      footer: `<button type="button" class="btn btn-ghost" data-modal-dismiss autofocus>Cancel</button>
               <button type="button" class="btn btn-primary" data-click="backup:confirm-import">Import Backup</button>`,
    });
    m.el.__pending = result;
  }

  on('click', 'backup:confirm-import', async (btn) => {
    const layer = btn.closest('.modal-layer');
    const result = layer && layer.__pending;
    if (!result) return;
    btn.disabled = true;
    try {
      const prefsRec = result.data.settings.find((s) => s.key === PREF_KEY);
      const settings = result.data.settings.filter((s) => s.key !== PREF_KEY);
      await S.replaceAll({ ...result.data, settings });
      const restored = prefsRec && prefsRec.value && typeof prefsRec.value === 'object' ? prefsRec.value : S.prefs.all();
      S.prefs.replace({ ...restored, onboarded: true, notifications: false });
      await L.analytics.checkAchievements({ silent: true });
      S.logActivity('backup', 'Imported a backup');
      L.ui.closeModal(btn);
      L.ui.toast('Backup imported. Welcome back.', { type: 'success' });
      if (L.app) L.app.refresh();
    } catch (err) {
      console.error(err);
      btn.disabled = false;
      L.ui.toast('Import failed and no data was changed.', { type: 'error' });
    }
  });

  function openImport() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.addEventListener('change', () => readBackupFile(input.files[0]));
    input.click();
  }

  /* ---------- clear ---------- */
  function openClear() {
    const m = L.ui.modal({
      title: 'Clear all data?',
      size: 'sm',
      body: `<p>This permanently deletes every subject, task, study session, note and setting stored on this device. Lumina will start over with the welcome screen.</p>
             <p class="fine-print">Export a backup first if there’s any chance you’ll want this data again.</p>
             <label class="check-row"><input type="checkbox" data-change="backup:clear-check"> <span>I understand this can’t be undone.</span></label>`,
      footer: `<button type="button" class="btn btn-ghost" data-modal-dismiss autofocus>Cancel</button>
               <button type="button" class="btn btn-danger" data-click="backup:clear-confirm" disabled>Clear All Data</button>`,
    });
    return m;
  }

  on('change', 'backup:clear-check', (box) => {
    const btn = box.closest('.modal-layer').querySelector('[data-click="backup:clear-confirm"]');
    btn.disabled = !box.checked;
  });

  on('click', 'backup:clear-confirm', async (btn) => {
    btn.disabled = true;
    try {
      await S.clearAll();
      S.prefs.reset();
      location.hash = '';
      location.reload();
    } catch (err) {
      console.error(err);
      btn.disabled = false;
      L.ui.toast('Could not clear the data. Please try again.', { type: 'error' });
    }
  });

  on('click', 'backup:export', exportData);
  on('click', 'backup:import', openImport);
  on('click', 'backup:clear', openClear);
  on('click', 'backup:persist', async () => {
    try {
      const granted = navigator.storage && navigator.storage.persist ? await navigator.storage.persist() : false;
      L.ui.toast(granted ? 'Storage is now protected from automatic cleanup.' : 'Your browser did not grant protected storage. Regular backups are the safest option.', { type: granted ? 'success' : 'info', duration: 6000 });
      view.update();
    } catch {
      L.ui.toast('Protected storage isn’t available here.', { type: 'error' });
    }
  });

  /* ---------- drag & drop import ---------- */
  function initDropZone() {
    const zoneOf = (e) => e.target.closest && e.target.closest('[data-dropzone]');
    ['dragenter', 'dragover'].forEach((type) =>
      document.addEventListener(type, (e) => {
        const z = zoneOf(e);
        if (!z) return;
        e.preventDefault();
        z.classList.add('is-over');
      })
    );
    document.addEventListener('dragleave', (e) => {
      const z = zoneOf(e);
      if (z && !z.contains(e.relatedTarget)) z.classList.remove('is-over');
    });
    document.addEventListener('drop', (e) => {
      const z = zoneOf(e);
      if (!z) return;
      e.preventDefault();
      z.classList.remove('is-over');
      const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      readBackupFile(file);
    });
    // stop the browser from navigating away if a file is dropped outside the zone
    ['dragover', 'drop'].forEach((type) =>
      window.addEventListener(type, (e) => {
        if (!zoneOf(e)) e.preventDefault();
      })
    );
  }

  /* ---------- Privacy Center page ---------- */
  const lastBackup = () => S.getSetting('lastBackupAt', null);

  async function statsHTML() {
    let info = null;
    try {
      info = await L.db.storageInfo();
    } catch {
      /* show placeholders below */
    }
    const last = lastBackup();
    const rows = info
      ? [['Subjects', 'subjects'], ['Tasks', 'tasks'], ['Study sessions', 'sessions'], ['Notes', 'notes'], ['Settings', 'settings'], ['Activity', 'activity']]
          .map(([label, key]) => `<tr><th scope="row">${label}</th><td>${info.perStore[key]}</td></tr>`)
          .join('')
      : '';
    return `
      <div class="metric-grid privacy-stats">
        <div class="metric"><span class="metric-label">Storage used</span><span class="metric-value">${info ? esc(fmt.bytes(info.bytes)) : '—'}</span><span class="metric-sub">of app data on this device</span></div>
        <div class="metric"><span class="metric-label">Records stored</span><span class="metric-value">${info ? info.records.toLocaleString() : '—'}</span></div>
        <div class="metric"><span class="metric-label">Last backup</span><span class="metric-value metric-small">${last ? esc(fmt.dateTime(last)) : 'Never'}</span>${last ? '' : '<span class="metric-sub">Export a copy to be safe</span>'}</div>
      </div>
      <details class="disclosure"><summary>What’s stored, and where</summary>
        <div class="disclosure-body">
          <table class="mini-table"><tbody>${rows}</tbody></table>
          <p class="fine-print"><strong>IndexedDB</strong> holds your subjects, tasks, sessions, notes, settings and activity. <strong>localStorage</strong> holds only light preferences: your name, weekly goal, accent colour, sidebar state, last page and timer choices.</p>
          ${
            info && info.persisted !== null
              ? `<p class="fine-print">Automatic cleanup protection: <strong>${info.persisted ? 'on' : 'off'}</strong>. ${info.persisted ? '' : '<button type="button" class="link-btn" data-click="backup:persist">Ask the browser to protect this data</button>'}</p>`
              : ''
          }
        </div>
      </details>`;
  }

  const view = {
    title: 'Privacy',
    render(root) {
      root.innerHTML = `
        <div class="page-head"><div><h2 class="page-title">Privacy center</h2><p class="lede">What Lumina does with your data: nothing beyond keeping it here.</p></div></div>
        <section class="panel privacy-hero">
          <span class="privacy-lock" aria-hidden="true">${icon('lock', 34)}</span>
          <div>
            <h3>Your data stays on this device.</h3>
            <ul class="privacy-list">
              <li>No account required.</li>
              <li>No server required.</li>
              <li>No external database.</li>
              <li>No analytics tracking.</li>
              <li>No cloud synchronization.</li>
            </ul>
          </div>
        </section>
        <section class="panel"><div class="panel-head"><h3>Your storage</h3></div><div id="privacy-stats"></div></section>
        <section class="panel">
          <div class="panel-head"><h3>Your data, your control</h3></div>
          <div class="btn-row">
            <button type="button" class="btn btn-primary" data-click="backup:export">${icon('download', 18)}<span>Export Data</span></button>
            <button type="button" class="btn btn-soft" data-click="backup:import">${icon('upload', 18)}<span>Import Data</span></button>
            <button type="button" class="btn btn-danger-soft" data-click="backup:clear">${icon('trash', 18)}<span>Clear All Data</span></button>
          </div>
          <div class="dropzone" data-dropzone tabindex="0" role="button" aria-label="Drop a Lumina backup file here, or press Enter to choose one" data-click="backup:import">
            ${icon('upload', 22)}<p><strong>Drop lumina-backup.json here</strong> or press to choose a file. You’ll see what it contains before anything changes.</p>
          </div>
        </section>`;
      view.update();
    },
    async update() {
      const host = document.getElementById('privacy-stats');
      if (!host) return;
      host.innerHTML = await statsHTML();
    },
  };

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.matches && e.target.matches('[data-dropzone]')) openImport();
  });

  L.views = L.views || {};
  L.views.privacy = view;
  L.backup = { buildExport, exportData, validate, openImport, openClear, initDropZone, lastBackup, PREF_KEY };
})();
