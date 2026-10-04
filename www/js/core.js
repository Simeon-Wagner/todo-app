'use strict';
/* Grundlagen: Netzwerkzugriff (nativ oder Browser), lokaler Speicher, Datumshelfer. */
(function () {
  const App = (window.App = {});
  const cap = window.Capacitor;
  const native = !!(cap && cap.isNativePlatform && cap.isNativePlatform());
  const Dav = native ? window.capacitorExports.registerPlugin('Dav') : null;
  App.native = native;

  // In der installierten App laufen Anfragen ueber den nativen Baustein (keine Browser-Sperre),
  // im Browser ueber fetch (funktioniert nur, wenn die App auf derselben Adresse wie der Server liegt).
  App.http = async function ({ url, method = 'GET', headers = {}, body = null }) {
    if (native) {
      const r = await Dav.request({ url, method, headers, body });
      return { status: r.status, headers: r.headers || {}, body: r.body || '' };
    }
    const init = { method, headers, cache: 'no-store', credentials: 'omit' };
    if (body != null && method !== 'GET' && method !== 'HEAD') init.body = body;
    const r = await fetch(url, init);
    const h = {};
    r.headers.forEach((v, k) => (h[k.toLowerCase()] = v));
    return { status: r.status, headers: h, body: await r.text() };
  };

  App.openExternal = function (url) {
    if (native) return Dav.openUrl({ url });
    window.open(url, '_blank', 'noopener');
  };

  // ---------- lokaler Speicher (IndexedDB) ----------
  const dbp = new Promise((res, rej) => {
    const rq = indexedDB.open('kalender-todos', 1);
    rq.onupgradeneeded = () => rq.result.createObjectStore('kv');
    rq.onsuccess = () => res(rq.result);
    rq.onerror = () => rej(rq.error);
  });
  async function kvGet(key) {
    const db = await dbp;
    return new Promise((res, rej) => {
      const r = db.transaction('kv').objectStore('kv').get(key);
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }
  async function kvSet(key, val) {
    const db = await dbp;
    return new Promise((res, rej) => {
      const tx = db.transaction('kv', 'readwrite');
      tx.objectStore('kv').put(val, key);
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
  }

  function emptyState() {
    return {
      account: null,
      calendars: [],
      items: {},
      queue: [],
      settings: { hiddenEv: {}, hiddenTodo: {}, eventCal: null, taskCal: null },
      lastSync: null
    };
  }
  App.state = emptyState();
  App.resetState = function () {
    App.state = emptyState();
  };
  App.load = async function () {
    try {
      const s = await kvGet('state');
      if (s) {
        App.state = Object.assign(emptyState(), s);
        App.state.settings = Object.assign(emptyState().settings, s.settings || {});
        App.state.queue.forEach((o) => delete o.inflight);
      }
    } catch (e) {
      console.error('Laden fehlgeschlagen', e);
    }
  };
  let saveTimer = null;
  App.saveNow = function () {
    clearTimeout(saveTimer);
    saveTimer = null;
    return kvSet('state', JSON.parse(JSON.stringify(App.state))).catch((e) => console.error('Speichern fehlgeschlagen', e));
  };
  App.save = function () {
    if (saveTimer) return;
    saveTimer = setTimeout(App.saveNow, 250);
  };

  // ---------- Datum ----------
  const pad = (n) => String(n).padStart(2, '0');
  App.pad = pad;
  App.MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
  App.MONTHS_SHORT = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
  App.DAYS = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
  App.dkey = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  App.fromKey = (k) => {
    const p = k.split('-').map(Number);
    return new Date(p[0], p[1] - 1, p[2]);
  };
  App.addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  App.monday = (d) => App.addDays(d, -((d.getDay() + 6) % 7));
  App.isoWeek = (d) => {
    const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    const day = t.getUTCDay() || 7;
    t.setUTCDate(t.getUTCDate() + 4 - day);
    const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
    return Math.ceil(((t - y0) / 864e5 + 1) / 7);
  };
  App.hhmm = (d) => pad(d.getHours()) + ':' + pad(d.getMinutes());
  App.uuid = () =>
    window.crypto && crypto.randomUUID
      ? crypto.randomUUID()
      : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
          const r = (Math.random() * 16) | 0;
          return (c === 'x' ? r : (r & 3) | 8).toString(16);
        });
})();
