/* ==========================================================================
   Lumina — notifications.js
   Optional study reminders. Uses the Web Notifications API where the browser
   allows it and always falls back to an in-app toast. Nothing here is required
   for the app to work, and everything stays on-device.
   ========================================================================== */
(() => {
  'use strict';
  const L = (window.Lumina = window.Lumina || {});
  const { dates, fmt, store } = L.utils;

  const LEAD_MINUTES = 10;
  const CHECK_EVERY_MS = 30000;
  let intervalId = null;

  const supported = () => 'Notification' in window;
  const permission = () => (supported() ? Notification.permission : 'unsupported');
  const isEnabled = () => Boolean(L.state.prefs.get('notifications'));

  /** Turn reminders on/off. Turning on asks the browser for permission if needed. */
  async function setEnabled(on) {
    if (!on) {
      L.state.prefs.set('notifications', false);
      return false;
    }
    if (supported() && Notification.permission === 'default') {
      try {
        await Notification.requestPermission();
      } catch {
        /* older browsers use callbacks; ignore */
      }
    }
    // Reminders are on even if the browser refuses system notifications: we then use in-app toasts.
    L.state.prefs.set('notifications', true);
    return true;
  }

  function notify(title, body) {
    if (supported() && Notification.permission === 'granted') {
      try {
        const n = new Notification(title, { body, tag: 'lumina-reminder', silent: false });
        n.onclick = () => {
          window.focus();
          location.hash = '#/focus';
          n.close();
        };
        return;
      } catch {
        /* fall through to toast */
      }
    }
    L.ui.toast(`${title} ${body}`.trim(), { duration: 8000 });
  }

  const sentKey = (date, id) => `${date}:${id}`;

  /** Check today's plan and remind about sessions starting soon. */
  function tick() {
    if (!isEnabled() || !L.intelligence) return;
    const today = dates.today();
    const plan = L.intelligence.getPlan(today);
    if (!plan || !plan.items.length) return;
    const sent = new Set(store.get('notified', []));
    const nowMin = dates.nowMinutes();
    let changed = false;
    for (const item of plan.items) {
      if (item.done) continue;
      const until = dates.toMinutes(item.start) - nowMin;
      const key = sentKey(today, item.id);
      if (until <= LEAD_MINUTES && until >= 0 && !sent.has(key)) {
        const subject = item.subjectName || L.state.subjectName(item.subjectId, item.label || 'study');
        const when = until <= 1 ? 'now' : `in ${until} minutes`;
        notify(`Your ${fmt.time12(item.start)} study session starts ${when}.`, `${subject} · ${fmt.duration(item.minutes)}`);
        sent.add(key);
        changed = true;
      }
    }
    if (changed) {
      // keep the list small: only today's keys matter
      store.set('notified', [...sent].filter((k) => k.startsWith(today)));
    }
  }

  function init() {
    if (intervalId) clearInterval(intervalId);
    intervalId = setInterval(tick, CHECK_EVERY_MS);
    tick();
  }

  L.notifications = { supported, permission, isEnabled, setEnabled, notify, tick, init, LEAD_MINUTES };
})();
