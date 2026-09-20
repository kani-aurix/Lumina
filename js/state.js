/* ==========================================================================
   Lumina — state.js
   The single source of truth for the UI.

   • Application data lives in IndexedDB (via db.js) and is mirrored in memory
     so views can render synchronously.
   • Every mutation writes to IndexedDB first, then updates memory, then
     notifies subscribers (one batched notification per tick).
   • Lightweight preferences live in localStorage (prefs.*).
   ========================================================================== */
(() => {
  'use strict';
  const L = (window.Lumina = window.Lumina || {});
  const { uid, store, esc } = L.utils;

  const data = Object.fromEntries(L.db.STORE_NAMES.map((n) => [n, []]));
  const subscribers = new Set();
  const pending = new Set();
  let scheduled = false;
  let version = 0;

  /* ---------- subscriptions ---------- */
  const subscribe = (fn) => {
    subscribers.add(fn);
    return () => subscribers.delete(fn);
  };

  function emit(reason = 'data') {
    version += 1;
    pending.add(reason);
    if (scheduled) return;
    scheduled = true;
    Promise.resolve().then(() => {
      scheduled = false;
      const reasons = [...pending];
      pending.clear();
      subscribers.forEach((fn) => {
        try {
          fn(reasons);
        } catch (err) {
          console.error('[Lumina] subscriber failed', err);
        }
      });
    });
  }

  /* ---------- data ---------- */
  async function load() {
    const results = await Promise.all(L.db.STORE_NAMES.map((n) => L.db.getAllRecords(n)));
    L.db.STORE_NAMES.forEach((n, i) => {
      data[n] = results[i];
    });
    emit('load');
  }

  const keyField = (storeName) => (storeName === 'settings' ? 'key' : 'id');
  const get = (storeName) => data[storeName];
  const find = (storeName, id) => data[storeName].find((r) => r[keyField(storeName)] === id);

  async function add(storeName, record) {
    await L.db.addRecord(storeName, record);
    data[storeName].push(record);
    emit(storeName);
    return record;
  }

  async function update(storeName, record) {
    await L.db.updateRecord(storeName, record);
    const kf = keyField(storeName);
    const idx = data[storeName].findIndex((r) => r[kf] === record[kf]);
    if (idx >= 0) data[storeName][idx] = record;
    else data[storeName].push(record);
    emit(storeName);
    return record;
  }

  async function remove(storeName, id) {
    await L.db.deleteRecord(storeName, id);
    const kf = keyField(storeName);
    data[storeName] = data[storeName].filter((r) => r[kf] !== id);
    emit(storeName);
  }

  /** Replace everything (used by backup import). */
  async function replaceAll(next) {
    await L.db.replaceAll(next);
    await load();
  }

  async function clearAll() {
    await L.db.clearAll();
    L.db.STORE_NAMES.forEach((n) => {
      data[n] = [];
    });
    emit('load');
  }

  /* ---------- settings store (durable app settings kept in IndexedDB) ---------- */
  const getSetting = (key, fallback = null) => {
    const rec = find('settings', key);
    return rec ? rec.value : fallback;
  };
  const setSetting = (key, value) => update('settings', { key, value, updatedAt: Date.now() });

  /* ---------- activity feed ---------- */
  const MAX_ACTIVITY = 300;
  function logActivity(type, text) {
    const entry = { id: uid(), type, text, at: Date.now() };
    const job = add('activity', entry).then(async () => {
      if (data.activity.length > MAX_ACTIVITY) {
        const sorted = [...data.activity].sort((a, b) => a.at - b.at);
        const drop = sorted.slice(0, data.activity.length - (MAX_ACTIVITY - 50)).map((a) => a.id);
        await L.db.deleteMany('activity', drop);
        data.activity = data.activity.filter((a) => !drop.includes(a.id));
        emit('activity');
      }
    });
    job.catch((err) => console.error('[Lumina] could not log activity', err));
    return job;
  }

  /* ---------- preferences (localStorage) ---------- */
  const DEFAULT_PREFS = {
    name: '',
    weeklyGoalHours: 20,
    onboarded: false,
    accent: 'blush',
    sidebarCollapsed: false,
    lastPage: 'dashboard',
    notifications: false,
    sound: true,
    customMinutes: 40,
    timerMode: 'pomodoro',
    lastSubjectId: '',
  };
  let prefsCache = { ...DEFAULT_PREFS, ...(store.get('prefs', {}) || {}) };

  const prefs = {
    get: (key) => prefsCache[key],
    all: () => ({ ...prefsCache }),
    set(key, value, { silent = false } = {}) {
      prefsCache = { ...prefsCache, [key]: value };
      store.set('prefs', prefsCache);
      if (!silent) emit('prefs');
    },
    setMany(obj) {
      prefsCache = { ...prefsCache, ...obj };
      store.set('prefs', prefsCache);
      emit('prefs');
    },
    replace(obj) {
      prefsCache = { ...DEFAULT_PREFS, ...(obj || {}) };
      store.set('prefs', prefsCache);
      emit('prefs');
    },
    reset() {
      store.clearAll();
      prefsCache = { ...DEFAULT_PREFS };
    },
  };

  /* ---------- selectors / view helpers ---------- */
  const subjectName = (id, fallback = 'No subject') => {
    const s = find('subjects', id);
    return s ? s.name : fallback;
  };

  const subjectOptions = (selectedId = '', noneLabel = 'No subject') =>
    `<option value="">${esc(noneLabel)}</option>` +
    data.subjects
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((s) => `<option value="${esc(s.id)}"${s.id === selectedId ? ' selected' : ''}>${esc(s.name)}</option>`)
      .join('');

  L.state = {
    subscribe,
    emit,
    version: () => version,
    load,
    get,
    find,
    add,
    update,
    remove,
    replaceAll,
    clearAll,
    getSetting,
    setSetting,
    logActivity,
    prefs,
    subjectName,
    subjectOptions,
  };
})();
