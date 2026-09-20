/* ==========================================================================
   Lumina — db.js
   A small promise-based IndexedDB data-access layer. No UI code lives here,
   and no other file talks to IndexedDB directly.

   Object stores
     subjects   { id, name, color, description, targetHours, createdAt }
     tasks      { id, title, subjectId, priority, dueDate, estimatedMinutes, completed, createdAt, completedAt }
     sessions   { id, subjectId, subjectName, startedAt, endedAt, durationSec, plannedMinutes, mode, productivity, date }
     notes      { id, title, content, subjectId, tags, createdAt, updatedAt }
     settings   { key, value, updatedAt }                       (keyPath: "key")
     activity   { id, type, text, at }
   ========================================================================== */
(() => {
  'use strict';
  const L = (window.Lumina = window.Lumina || {});

  const DB_NAME = 'lumina-db';
  const DB_VERSION = 1;

  /** store name → { keyPath, indexes: [[indexName, keyPath]] } */
  const SCHEMA = {
    subjects: { keyPath: 'id', indexes: [['name', 'name']] },
    tasks: { keyPath: 'id', indexes: [['subjectId', 'subjectId'], ['dueDate', 'dueDate']] },
    sessions: { keyPath: 'id', indexes: [['subjectId', 'subjectId'], ['date', 'date'], ['startedAt', 'startedAt']] },
    notes: { keyPath: 'id', indexes: [['subjectId', 'subjectId'], ['updatedAt', 'updatedAt']] },
    settings: { keyPath: 'key', indexes: [] },
    activity: { keyPath: 'id', indexes: [['at', 'at']] },
  };
  const STORE_NAMES = Object.keys(SCHEMA);

  let dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) {
        reject(new Error('IndexedDB is not available in this browser.'));
        return;
      }
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        for (const [name, def] of Object.entries(SCHEMA)) {
          const os = db.objectStoreNames.contains(name)
            ? request.transaction.objectStore(name)
            : db.createObjectStore(name, { keyPath: def.keyPath });
          for (const [idx, path] of def.indexes) {
            if (!os.indexNames.contains(idx)) os.createIndex(idx, path, { unique: false });
          }
        }
      };
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => db.close();
        resolve(db);
      };
      request.onerror = () => reject(request.error || new Error('Could not open the local database.'));
      request.onblocked = () => reject(new Error('The database is blocked by another open Lumina tab. Close it and reload.'));
    });
    dbPromise.catch(() => {
      dbPromise = null;
    });
    return dbPromise;
  }

  /**
   * Run `work(tx, setResult)` inside one transaction and resolve with the result
   * once the transaction has fully committed (so data is durable when we resolve).
   */
  function transact(storeNames, mode, work) {
    return open().then(
      (db) =>
        new Promise((resolve, reject) => {
          const tx = db.transaction(storeNames, mode);
          let result;
          tx.oncomplete = () => resolve(result);
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error || new Error('Database transaction was aborted.'));
          work(tx, (value) => {
            result = value;
          });
        })
    );
  }

  const assertStore = (name) => {
    if (!SCHEMA[name]) throw new Error(`Unknown store "${name}".`);
  };

  /** Insert a new record. Rejects if the key already exists. */
  function addRecord(store, record) {
    assertStore(store);
    return transact(store, 'readwrite', (tx, out) => {
      const req = tx.objectStore(store).add(record);
      req.onsuccess = () => out(record);
    });
  }

  function getRecord(store, key) {
    assertStore(store);
    return transact(store, 'readonly', (tx, out) => {
      const req = tx.objectStore(store).get(key);
      req.onsuccess = () => out(req.result);
    });
  }

  function getAllRecords(store) {
    assertStore(store);
    return transact(store, 'readonly', (tx, out) => {
      const req = tx.objectStore(store).getAll();
      req.onsuccess = () => out(req.result || []);
    });
  }

  function getByIndex(store, indexName, value) {
    assertStore(store);
    return transact(store, 'readonly', (tx, out) => {
      const req = tx.objectStore(store).index(indexName).getAll(value);
      req.onsuccess = () => out(req.result || []);
    });
  }

  /** Insert-or-replace a record (used for updates). */
  function updateRecord(store, record) {
    assertStore(store);
    return transact(store, 'readwrite', (tx, out) => {
      const req = tx.objectStore(store).put(record);
      req.onsuccess = () => out(record);
    });
  }

  function deleteRecord(store, key) {
    assertStore(store);
    return transact(store, 'readwrite', (tx, out) => {
      const req = tx.objectStore(store).delete(key);
      req.onsuccess = () => out(true);
    });
  }

  function deleteMany(store, keys) {
    assertStore(store);
    return transact(store, 'readwrite', (tx, out) => {
      const os = tx.objectStore(store);
      keys.forEach((k) => os.delete(k));
      out(keys.length);
    });
  }

  function countRecords(store) {
    assertStore(store);
    return transact(store, 'readonly', (tx, out) => {
      const req = tx.objectStore(store).count();
      req.onsuccess = () => out(req.result);
    });
  }

  function clearStore(store) {
    assertStore(store);
    return transact(store, 'readwrite', (tx, out) => {
      const req = tx.objectStore(store).clear();
      req.onsuccess = () => out(true);
    });
  }

  /** Read every store in one consistent snapshot. */
  function exportAll() {
    return transact(STORE_NAMES, 'readonly', (tx, out) => {
      const result = {};
      let pending = STORE_NAMES.length;
      STORE_NAMES.forEach((name) => {
        const req = tx.objectStore(name).getAll();
        req.onsuccess = () => {
          result[name] = req.result || [];
          if (--pending === 0) out(result);
        };
      });
    });
  }

  /** Atomically replace the entire database with the given data (used by import). */
  function replaceAll(data) {
    return transact(STORE_NAMES, 'readwrite', (tx, out) => {
      STORE_NAMES.forEach((name) => {
        const os = tx.objectStore(name);
        os.clear();
        (data[name] || []).forEach((record) => os.put(record));
      });
      out(true);
    });
  }

  function clearAll() {
    return transact(STORE_NAMES, 'readwrite', (tx, out) => {
      STORE_NAMES.forEach((name) => tx.objectStore(name).clear());
      out(true);
    });
  }

  /** How much data do we hold? JSON size is the honest number; the browser estimate is a bonus. */
  async function storageInfo() {
    const data = await exportAll();
    const bytes = new Blob([JSON.stringify(data)]).size;
    const records = STORE_NAMES.reduce((n, s) => n + data[s].length, 0);
    let browserUsage = null;
    let persisted = null;
    try {
      if (navigator.storage && navigator.storage.estimate) {
        const est = await navigator.storage.estimate();
        if (typeof est.usage === 'number') browserUsage = est.usage;
      }
      if (navigator.storage && navigator.storage.persisted) persisted = await navigator.storage.persisted();
    } catch {
      /* estimates are optional */
    }
    return { bytes, records, browserUsage, persisted, perStore: Object.fromEntries(STORE_NAMES.map((s) => [s, data[s].length])) };
  }

  L.db = {
    STORE_NAMES,
    open,
    addRecord,
    getRecord,
    getAllRecords,
    getByIndex,
    updateRecord,
    deleteRecord,
    deleteMany,
    countRecords,
    clearStore,
    exportAll,
    replaceAll,
    clearAll,
    storageInfo,
  };
})();
