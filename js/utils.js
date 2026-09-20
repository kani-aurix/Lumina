/* ==========================================================================
   Lumina — utils.js
   Helpers (dates, formatting, markdown, storage) and reusable UI components
   (modal, confirm, toast, dropdown, tabs, progress, stat card, empty state).
   Everything lives under the single `window.Lumina` namespace.
   ========================================================================== */
(() => {
  'use strict';
  const L = (window.Lumina = window.Lumina || {});

  /* ---------- small helpers ---------- */
  const pad = (n) => String(n).padStart(2, '0');
  const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
  const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
  const esc = (v) =>
    String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = () =>
    window.crypto && typeof window.crypto.randomUUID === 'function'
      ? window.crypto.randomUUID()
      : `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const debounce = (fn, wait = 300) => {
    let timer;
    const wrapped = (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), wait);
    };
    wrapped.cancel = () => clearTimeout(timer);
    return wrapped;
  };
  const dataAttrs = (obj = {}) =>
    Object.entries(obj)
      .filter(([, v]) => v !== undefined && v !== null)
      .map(([k, v]) => ` data-${k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}="${esc(v)}"`)
      .join('');

  /* ---------- dates (all keys are local-time "YYYY-MM-DD") ---------- */
  const DAY_MS = 86400000;
  const dates = {
    key(d = new Date()) {
      const x = new Date(d);
      return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`;
    },
    fromKey(k) {
      const [y, m, d] = String(k).split('-').map(Number);
      return new Date(y, (m || 1) - 1, d || 1);
    },
    today() {
      return dates.key(new Date());
    },
    addDays(keyOrDate, n) {
      const d = typeof keyOrDate === 'string' ? dates.fromKey(keyOrDate) : new Date(keyOrDate);
      d.setDate(d.getDate() + n);
      return d;
    },
    addDaysKey(k, n) {
      return dates.key(dates.addDays(k, n));
    },
    /** whole days from a to b (b - a) */
    diffDays(aKey, bKey) {
      return Math.round((dates.fromKey(bKey) - dates.fromKey(aKey)) / DAY_MS);
    },
    /** Monday 00:00 of the week containing d */
    weekStart(d = new Date()) {
      const x = new Date(d);
      x.setHours(0, 0, 0, 0);
      x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
      return x;
    },
    weekKeys(d = new Date()) {
      const start = dates.weekStart(d);
      return Array.from({ length: 7 }, (_, i) => dates.key(dates.addDays(start, i)));
    },
    isValidKey(k) {
      if (typeof k !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(k)) return false;
      return dates.key(dates.fromKey(k)) === k;
    },
    toMinutes(hhmm) {
      const [h, m] = String(hhmm).split(':').map(Number);
      return (h || 0) * 60 + (m || 0);
    },
    toHHMM(min) {
      const m = ((Math.round(min) % 1440) + 1440) % 1440;
      return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
    },
    nowMinutes() {
      const n = new Date();
      return n.getHours() * 60 + n.getMinutes();
    },
    DAY_NAMES: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
    SHORT_DAYS: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
  };

  /* ---------- formatting ---------- */
  const fmt = {
    duration(min) {
      const m = Math.max(0, Math.round(min));
      if (m === 0) return min > 0 ? '<1m' : '0m';
      const h = Math.floor(m / 60);
      const r = m % 60;
      if (!h) return `${r}m`;
      return r ? `${h}h ${pad(r)}m` : `${h}h`;
    },
    clock(min) {
      const m = Math.max(0, Math.round(min));
      return `${pad(Math.floor(m / 60))}h ${pad(m % 60)}m`;
    },
    hours(min, digits = 1) {
      return `${(min / 60).toFixed(digits)}h`;
    },
    time12(hhmm) {
      const [h, m] = String(hhmm).split(':').map(Number);
      const suffix = h >= 12 ? 'PM' : 'AM';
      return `${h % 12 || 12}:${pad(m || 0)} ${suffix}`;
    },
    hour12(h) {
      const hh = ((h % 24) + 24) % 24;
      return `${hh % 12 || 12} ${hh >= 12 ? 'PM' : 'AM'}`;
    },
    date(key) {
      return dates.fromKey(key).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
    },
    longDate(d = new Date()) {
      return d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
    },
    clockTime(ts) {
      return new Date(ts).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    },
    dateTime(ts) {
      return new Date(ts).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
    },
    dayLabel(key) {
      const diff = dates.diffDays(dates.today(), key);
      if (diff === 0) return 'Today';
      if (diff === 1) return 'Tomorrow';
      if (diff === -1) return 'Yesterday';
      return fmt.date(key);
    },
    dueLabel(key) {
      if (!key) return 'No due date';
      const diff = dates.diffDays(dates.today(), key);
      if (diff < 0) return `Overdue by ${plural(-diff, 'day')}`;
      if (diff === 0) return 'Due today';
      if (diff === 1) return 'Due tomorrow';
      if (diff <= 6) return `Due in ${diff} days`;
      return `Due ${fmt.date(key)}`;
    },
    ago(ts) {
      const s = (Date.now() - ts) / 1000;
      if (s < 45) return 'just now';
      const m = Math.round(s / 60);
      if (m < 60) return `${m} min ago`;
      const h = Math.round(m / 60);
      if (h < 24) return `${h} h ago`;
      const d = Math.round(h / 24);
      if (d === 1) return 'yesterday';
      if (d < 7) return `${d} days ago`;
      return fmt.date(dates.key(new Date(ts)));
    },
    bytes(n) {
      if (!Number.isFinite(n)) return '—';
      if (n < 1024) return `${n} B`;
      if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
      return `${(n / 1024 / 1024).toFixed(2)} MB`;
    },
    percent(n) {
      return `${Math.round(n)}%`;
    },
    greeting(d = new Date()) {
      const h = d.getHours();
      if (h >= 5 && h < 12) return 'Good morning';
      if (h >= 12 && h < 17) return 'Good afternoon';
      return 'Good evening';
    },
  };

  /* ---------- lightweight markdown → HTML (escaped first, so it is safe) ---------- */
  const inlineMd = (escaped) =>
    escaped
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>');

  function md(text) {
    const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
    let html = '';
    let list = null;
    let para = [];
    let inCode = false;
    let code = [];
    const flushPara = () => {
      if (para.length) html += `<p>${inlineMd(para.map(esc).join('<br>'))}</p>`;
      para = [];
    };
    const closeList = () => {
      if (list) html += `</${list}>`;
      list = null;
    };
    const openList = (type) => {
      if (list !== type) {
        closeList();
        html += `<${type}>`;
        list = type;
      }
    };
    for (const raw of lines) {
      if (/^```/.test(raw)) {
        if (inCode) {
          html += `<pre><code>${esc(code.join('\n'))}</code></pre>`;
          code = [];
          inCode = false;
        } else {
          flushPara();
          closeList();
          inCode = true;
        }
        continue;
      }
      if (inCode) {
        code.push(raw);
        continue;
      }
      const line = raw.trimEnd();
      let m;
      if (!line.trim()) {
        flushPara();
        closeList();
      } else if (/^(-{3,}|\*{3,})$/.test(line.trim())) {
        flushPara();
        closeList();
        html += '<hr>';
      } else if ((m = line.match(/^(#{1,3})\s+(.*)$/))) {
        flushPara();
        closeList();
        html += `<h${m[1].length + 1}>${inlineMd(esc(m[2]))}</h${m[1].length + 1}>`;
      } else if ((m = line.match(/^\s*[-*]\s+\[( |x|X)\]\s+(.*)$/))) {
        flushPara();
        openList('ul');
        const done = m[1].toLowerCase() === 'x';
        html += `<li class="md-task${done ? ' is-done' : ''}"><span aria-hidden="true">${done ? '☑' : '☐'}</span> ${inlineMd(esc(m[2]))}</li>`;
      } else if ((m = line.match(/^\s*[-*]\s+(.*)$/))) {
        flushPara();
        openList('ul');
        html += `<li>${inlineMd(esc(m[1]))}</li>`;
      } else if ((m = line.match(/^\s*\d+[.)]\s+(.*)$/))) {
        flushPara();
        openList('ol');
        html += `<li>${inlineMd(esc(m[1]))}</li>`;
      } else if ((m = line.match(/^>\s?(.*)$/))) {
        flushPara();
        closeList();
        html += `<blockquote>${inlineMd(esc(m[1]))}</blockquote>`;
      } else {
        closeList();
        para.push(line);
      }
    }
    if (inCode) html += `<pre><code>${esc(code.join('\n'))}</code></pre>`;
    flushPara();
    closeList();
    return html;
  }

  /* ---------- localStorage wrapper (lightweight preferences only) ---------- */
  const store = {
    get(key, fallback = null) {
      try {
        const raw = localStorage.getItem(`lumina:${key}`);
        return raw === null ? fallback : JSON.parse(raw);
      } catch {
        return fallback;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem(`lumina:${key}`, JSON.stringify(value));
        return true;
      } catch {
        return false;
      }
    },
    remove(key) {
      try {
        localStorage.removeItem(`lumina:${key}`);
      } catch {
        /* ignore */
      }
    },
    clearAll() {
      try {
        Object.keys(localStorage)
          .filter((k) => k.startsWith('lumina:'))
          .forEach((k) => localStorage.removeItem(k));
      } catch {
        /* ignore */
      }
    },
  };

  /* ---------- subject colours ---------- */
  const palette = [
    { name: 'Blush', fill: '#FFC7DC', deep: '#E07AA4' },
    { name: 'Lavender', fill: '#E8D9FF', deep: '#A883E0' },
    { name: 'Peach', fill: '#FFE5D4', deep: '#F0A57A' },
    { name: 'Sage', fill: '#DCEFE5', deep: '#78BC9A' },
    { name: 'Butter', fill: '#FFF0B8', deep: '#E3BE4B' },
    { name: 'Sky', fill: '#D7E9FA', deep: '#6FA6D9' },
  ];
  const deepOf = (fill) => (palette.find((p) => p.fill.toLowerCase() === String(fill).toLowerCase()) || { deep: fill }).deep;

  /* ---------- icons (inline SVG, no external assets) ---------- */
  const ICONS = {
    home: '<path d="M3.5 11 12 3.5 20.5 11"/><path d="M5.5 9.5V20h5v-6h3v6h5V9.5"/>',
    book: '<path d="M5 4.5h10.5A3.5 3.5 0 0 1 19 8v12H8.5A3.5 3.5 0 0 1 5 16.5z"/><path d="M5 16.5A3.5 3.5 0 0 1 8.5 13H19"/>',
    check: '<circle cx="12" cy="12" r="8.5"/><path d="m8.5 12.4 2.4 2.4 4.6-5"/>',
    tick: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
    timer: '<circle cx="12" cy="13.5" r="7.5"/><path d="M12 9.5v4.2l2.6 1.6M9.5 2.8h5"/>',
    note: '<path d="M6 3.5h8.5L19 8v12.5H6z"/><path d="M14 3.5V8.5h5M9 13h7M9 16.5h5"/>',
    sparkle:
      '<path d="m12 3 2.1 5.9L20 11l-5.9 2.1L12 19l-2.1-5.9L4 11l5.9-2.1z"/><path d="m18.5 17.5.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z"/>',
    chart: '<path d="M5 20v-7M12 20V5M19 20v-10"/>',
    settings: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
    lock: '<rect x="5" y="10.5" width="14" height="9.5" rx="2.5"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>',
    edit: '<path d="M4.5 19.5h4L19 9l-4-4L4.5 15.5z"/><path d="m13.5 6.5 4 4"/>',
    trash: '<path d="M5 7h14M9.5 7V4.5h5V7M7 7l.8 12.5h8.4L17 7"/>',
    more: '<circle cx="6" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="18" cy="12" r="1.3"/>',
    play: '<path d="M8 5.5v13l10.5-6.5z"/>',
    pause: '<path d="M9 5.5v13M15 5.5v13"/>',
    reset: '<path d="M4.5 12a7.5 7.5 0 1 0 2.4-5.5"/><path d="M4.5 4.5v4h4"/>',
    x: '<path d="M6 6l12 12M18 6 6 18"/>',
    download: '<path d="M12 4v11M7.5 11 12 15.5 16.5 11M5 20h14"/>',
    upload: '<path d="M12 16V5M7.5 9 12 4.5 16.5 9M5 20h14"/>',
    calendar: '<rect x="4" y="5.5" width="16" height="14.5" rx="2.5"/><path d="M4 10.5h16M9 3.5v4M15 3.5v4"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    bell: '<path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 1.5h-15z"/><path d="M10 20.5h4"/>',
    back: '<path d="M14.5 5.5 8 12l6.5 6.5"/>',
    sidebar: '<rect x="4" y="5" width="16" height="14" rx="2.5"/><path d="M9.5 5v14"/>',
    tag: '<path d="M4 12.5V5h7.5L20 13.5 13.5 20z"/><circle cx="8.5" cy="9" r="1"/>',
    wand: '<path d="m5 19 9-9"/><path d="m13 5 .8 2.2L16 8l-2.2.8L13 11l-.8-2.2L10 8l2.2-.8z"/><path d="m18 13 .5 1.5 1.5.5-1.5.5-.5 1.5-.5-1.5-1.5-.5 1.5-.5z"/>',
  };
  const icon = (name, size = 20) =>
    `<svg class="icon icon-${name}" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${ICONS[name] || ''}</svg>`;

  /* ---------- delegated event system ----------
     Markup declares behaviour with data attributes:
       data-click="task:toggle"   data-input="tasks:search"
       data-change="timer:mode"   data-submit="task:save"
     Modules register handlers with ui.on(type, name, fn). No inline JS anywhere. */
  const handlers = { click: new Map(), input: new Map(), change: new Map(), submit: new Map() };
  const on = (type, name, fn) => handlers[type].set(name, fn);

  /* ---------- modal / confirm ---------- */
  const modalStack = [];
  const FOCUSABLE =
    'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

  function modal({ title, body = '', footer = '', size = 'md', onClose, dismissible = true, className = '' }) {
    const opener = document.activeElement;
    const titleId = `modal-title-${uid().slice(0, 6)}`;
    const layer = document.createElement('div');
    layer.className = 'modal-layer';
    layer.innerHTML = `
      <div class="modal-backdrop"${dismissible ? ' data-modal-dismiss' : ''}></div>
      <section class="modal modal-${size} ${className}" role="dialog" aria-modal="true" aria-labelledby="${titleId}" tabindex="-1">
        <div class="modal-head">
          <h2 id="${titleId}">${esc(title)}</h2>
          ${dismissible ? `<button type="button" class="icon-btn" data-modal-dismiss aria-label="Close dialog" data-tip="Close">${icon('x')}</button>` : ''}
        </div>
        <div class="modal-body"></div>
        ${footer ? `<div class="modal-foot">${footer}</div>` : ''}
      </section>`;
    const bodyEl = layer.querySelector('.modal-body');
    if (typeof body === 'string') bodyEl.innerHTML = body;
    else bodyEl.append(body);

    let closed = false;
    const handle = {
      el: layer,
      body: bodyEl,
      dismissible,
      close() {
        if (closed) return;
        closed = true;
        const idx = modalStack.indexOf(handle);
        if (idx >= 0) modalStack.splice(idx, 1);
        layer.classList.remove('is-open');
        layer.classList.add('is-closing');
        setTimeout(() => layer.remove(), 180);
        if (!modalStack.length) document.body.classList.remove('has-modal');
        if (opener && typeof opener.focus === 'function' && document.contains(opener)) opener.focus();
        if (typeof onClose === 'function') onClose();
      },
    };
    layer.__modal = handle;
    document.body.append(layer);
    document.body.classList.add('has-modal');
    modalStack.push(handle);
    requestAnimationFrame(() => layer.classList.add('is-open'));
    const auto = layer.querySelector('[autofocus]') || layer.querySelector(`.modal-body ${FOCUSABLE.split(', ').join(', .modal-body ')}`);
    (auto || layer.querySelector('.modal')).focus({ preventScroll: true });
    return handle;
  }

  const closeModal = (fromEl) => {
    const layer = fromEl && fromEl.closest ? fromEl.closest('.modal-layer') : null;
    if (layer && layer.__modal) layer.__modal.close();
  };

  function confirm({ title, message = '', messageHTML = '', confirmLabel = 'Confirm', cancelLabel = 'Cancel', danger = false }) {
    return new Promise((resolve) => {
      let settled = false;
      const settle = (v) => {
        if (!settled) {
          settled = true;
          resolve(v);
        }
      };
      const m = modal({
        title,
        size: 'sm',
        body: `<div class="confirm-text">${messageHTML || `<p>${esc(message)}</p>`}</div>`,
        footer: `<button type="button" class="btn btn-ghost" data-confirm="no" autofocus>${esc(cancelLabel)}</button>
                 <button type="button" class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-confirm="yes">${esc(confirmLabel)}</button>`,
        onClose: () => settle(false),
      });
      m.el.addEventListener('click', (e) => {
        const b = e.target.closest('[data-confirm]');
        if (!b) return;
        settle(b.dataset.confirm === 'yes');
        m.close();
      });
    });
  }

  /* ---------- toast ---------- */
  function toast(message, { type = 'info', duration = 3600 } = {}) {
    const host = document.getElementById('toasts');
    if (!host) return;
    const el = document.createElement('div');
    el.className = `toast toast-${type}`;
    el.setAttribute('role', type === 'error' ? 'alert' : 'status');
    el.innerHTML = `<span class="toast-mark" aria-hidden="true">${type === 'achievement' ? '🏆' : type === 'error' ? '!' : '✦'}</span><span class="toast-text">${esc(message)}</span>`;
    host.append(el);
    requestAnimationFrame(() => el.classList.add('is-in'));
    const remove = () => {
      el.classList.remove('is-in');
      el.classList.add('is-out');
      setTimeout(() => el.remove(), 220);
    };
    setTimeout(remove, duration);
    el.addEventListener('click', remove);
    while (host.children.length > 4) host.firstElementChild.remove();
  }

  /* ---------- dropdown ---------- */
  function dropdown({ label = 'More actions', items = [], trigger = 'icon', buttonText = '', buttonClass = 'btn btn-primary', align = 'right' }) {
    const menu = items
      .map(
        (it) =>
          `<button type="button" role="menuitem" class="dropdown-item${it.danger ? ' is-danger' : ''}" data-click="${esc(it.action)}"${dataAttrs(it.data)}>${it.icon ? icon(it.icon, 18) : ''}<span>${esc(it.label)}</span></button>`
      )
      .join('');
    const trig =
      trigger === 'button'
        ? `<button type="button" class="${buttonClass}" data-click="dropdown:toggle" aria-haspopup="menu" aria-expanded="false">${icon('plus', 18)}<span>${esc(buttonText)}</span></button>`
        : `<button type="button" class="icon-btn" data-click="dropdown:toggle" aria-haspopup="menu" aria-expanded="false" aria-label="${esc(label)}" data-tip="More actions">${icon('more')}</button>`;
    return `<div class="dropdown" data-align="${align}">${trig}<div class="dropdown-menu" role="menu" hidden>${menu}</div></div>`;
  }

  const closeDropdowns = (except) => {
    document.querySelectorAll('.dropdown.is-open').forEach((d) => {
      if (d === except) return;
      d.classList.remove('is-open');
      d.querySelector('.dropdown-menu').hidden = true;
      d.querySelector('[aria-haspopup]').setAttribute('aria-expanded', 'false');
    });
  };

  on('click', 'dropdown:toggle', (btn) => {
    const wrap = btn.closest('.dropdown');
    const menu = wrap.querySelector('.dropdown-menu');
    const opening = menu.hidden;
    closeDropdowns(wrap);
    menu.hidden = !opening;
    wrap.classList.toggle('is-open', opening);
    btn.setAttribute('aria-expanded', String(opening));
    if (opening) menu.querySelector('.dropdown-item')?.focus();
  });

  /* ---------- tabs / progress / stat card / empty state ---------- */
  function tabs({ tabs: list, active, action, label = 'Sections' }) {
    return `<div class="tabs" role="tablist" aria-label="${esc(label)}">${list
      .map(
        (t) =>
          `<button type="button" role="tab" class="tab" aria-selected="${t.id === active}" tabindex="${t.id === active ? 0 : -1}" data-click="${esc(action)}" data-tab="${esc(t.id)}">${esc(t.label)}${
            t.count !== undefined ? `<span class="tab-count">${t.count}</span>` : ''
          }</button>`
      )
      .join('')}</div>`;
  }

  function progress(pct, { color = '', label = 'Progress', tall = false } = {}) {
    const v = clamp(Math.round(pct || 0), 0, 100);
    return `<div class="progress${tall ? ' is-tall' : ''}" role="progressbar" aria-label="${esc(label)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${v}"><span style="width:${v}%${color ? `;background:${color}` : ''}"></span></div>`;
  }

  function statCard({ href, icon: ic, label, value, sub = '', trend = '', trendTone = '', pct = null }) {
    return `<a class="stat-card" href="${esc(href)}">
      <span class="stat-label">${ic ? `<span class="stat-icon">${ic}</span>` : ''}${esc(label)}</span>
      <span class="stat-value">${value}</span>
      ${sub ? `<span class="stat-sub">${sub}</span>` : ''}
      ${trend ? `<span class="stat-trend ${trendTone}">${trend}</span>` : ''}
      ${pct !== null ? progress(pct, { label: `${label} progress` }) : ''}
    </a>`;
  }

  function emptyState({ icon: ic = '✦', title, text = '', action }) {
    return `<div class="empty-state">
      <span class="empty-mark" aria-hidden="true">${ic}</span>
      <h3>${esc(title)}</h3>
      ${text ? `<p>${esc(text)}</p>` : ''}
      ${action ? `<button type="button" class="btn btn-primary" data-click="${esc(action.click)}"${dataAttrs(action.data)}>${esc(action.label)}</button>` : ''}
    </div>`;
  }

  /* ---------- global listeners ---------- */
  function init() {
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.dropdown')) closeDropdowns();
      const dismiss = e.target.closest('[data-modal-dismiss]');
      if (dismiss) {
        const layer = dismiss.closest('.modal-layer');
        if (layer && layer.__modal && layer.__modal.dismissible) layer.__modal.close();
        return;
      }
      const el = e.target.closest('[data-click]');
      if (!el || el.disabled || el.getAttribute('aria-disabled') === 'true') return;
      const fn = handlers.click.get(el.dataset.click);
      if (fn) {
        fn(el, e);
        if (el.closest('.dropdown-menu')) closeDropdowns();
      }
    });
    ['input', 'change'].forEach((type) =>
      document.addEventListener(type, (e) => {
        const el = e.target.closest(`[data-${type}]`);
        if (!el) return;
        const fn = handlers[type].get(el.dataset[type]);
        if (fn) fn(el, e);
      })
    );
    document.addEventListener('submit', (e) => {
      const form = e.target.closest('[data-submit]');
      if (!form) return;
      e.preventDefault();
      const fn = handlers.submit.get(form.dataset.submit);
      if (fn) fn(form, e);
    });
    document.addEventListener('keydown', (e) => {
      const top = modalStack[modalStack.length - 1];
      if (e.key === 'Escape') {
        if (document.querySelector('.dropdown.is-open')) {
          const open = document.querySelector('.dropdown.is-open');
          closeDropdowns();
          open.querySelector('[aria-haspopup]')?.focus();
          return;
        }
        if (top && top.dismissible) top.close();
        return;
      }
      if (e.key === 'Tab' && top) {
        const nodes = [...top.el.querySelectorAll(FOCUSABLE)].filter((n) => n.offsetParent !== null || n === document.activeElement);
        if (!nodes.length) return;
        const first = nodes[0];
        const last = nodes[nodes.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
        return;
      }
      // arrow-key navigation for tab lists and dropdown menus
      const tab = e.target.closest && e.target.closest('[role="tab"]');
      if (tab && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
        const all = [...tab.closest('[role="tablist"]').querySelectorAll('[role="tab"]')];
        const next = all[(all.indexOf(tab) + (e.key === 'ArrowRight' ? 1 : -1) + all.length) % all.length];
        next.focus();
        next.click();
        e.preventDefault();
        return;
      }
      const item = e.target.closest && e.target.closest('.dropdown-item');
      if (item && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
        const all = [...item.closest('.dropdown-menu').querySelectorAll('.dropdown-item')];
        all[(all.indexOf(item) + (e.key === 'ArrowDown' ? 1 : -1) + all.length) % all.length].focus();
        e.preventDefault();
      }
    });
  }

  L.utils = { pad, clamp, plural, esc, uid, debounce, dataAttrs, dates, fmt, md, store, palette, deepOf };
  L.ui = { init, on, icon, modal, closeModal, confirm, toast, dropdown, tabs, progress, statCard, emptyState };
})();
