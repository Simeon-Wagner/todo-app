'use strict';
/* Nextcloud-Anbindung ueber CalDAV: Anmeldung, Kalender lesen, Aenderungen einreihen und uebertragen. */
(function () {
  const App = window.App;
  const S = () => App.state;
  const NS = { d: 'DAV:', c: 'urn:ietf:params:xml:ns:caldav', cs: 'http://calendarserver.org/ns/', a: 'http://apple.com/ns/ical/' };
  const UA = 'Kalender & To-dos (Android)';

  App.models = {}; // href -> aufbereiteter Eintrag (nicht gespeichert, wird aus dem ICS erzeugt)
  App.sync = { status: 'idle', detail: '' };
  let occCache = {};

  class AuthError extends Error {}
  function offline(e) {
    const err = new Error(e && e.message ? e.message : String(e));
    err.offline = true;
    return err;
  }

  function authHeader(acc) {
    return 'Basic ' + btoa(unescape(encodeURIComponent(acc.user + ':' + acc.password)));
  }
  async function dav(acc, method, url, opt) {
    opt = opt || {};
    const headers = Object.assign({ Authorization: authHeader(acc) }, opt.headers || {});
    if (opt.depth != null) headers.Depth = String(opt.depth);
    if (opt.body != null && !headers['Content-Type']) headers['Content-Type'] = 'application/xml; charset=utf-8';
    let r;
    try {
      r = await App.http({ url, method, headers, body: opt.body == null ? null : opt.body });
    } catch (e) {
      throw offline(e);
    }
    if (r.status === 401) throw new AuthError('Anmeldung abgelehnt. Bitte Benutzername und App-Passwort prüfen.');
    return r;
  }

  // ---------- XML ----------
  function responses(text) {
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    return Array.from(doc.getElementsByTagNameNS(NS.d, 'response'));
  }
  const el = (node, ns, name) => node.getElementsByTagNameNS(ns, name)[0] || null;
  function ownHref(resp) {
    for (const c of Array.from(resp.children)) if (c.localName === 'href') return c.textContent.trim();
    return '';
  }
  function hrefIn(node, ns, name) {
    const e = el(node, ns, name);
    const h = e && el(e, NS.d, 'href');
    return h ? h.textContent.trim() : null;
  }

  // ---------- Anmeldung ----------
  function normalizeServer(server) {
    let base = String(server || '').trim();
    if (!base) throw new Error('Bitte die Adresse der Nextcloud eingeben.');
    if (!/^https?:\/\//i.test(base)) base = 'https://' + base;
    base = base.replace(/[?#].*$/, '').replace(/\/+$/, '');
    base = base.replace(/\/(index\.php|remote\.php|apps|login)(\/.*)?$/i, '');
    return base;
  }
  App.normalizeServer = normalizeServer;

  async function discover(server, user, password) {
    const base = normalizeServer(server);
    const acc = { server: base, user: String(user || '').trim(), password: String(password || '') };
    if (!acc.user || !acc.password) throw new Error('Bitte Benutzername und App-Passwort eingeben.');
    const body = '<d:propfind xmlns:d="DAV:"><d:prop><d:current-user-principal/></d:prop></d:propfind>';
    let principal = null;
    let last = 0;
    for (const url of [base + '/remote.php/dav/', base + '/']) {
      const r = await dav(acc, 'PROPFIND', url, { depth: 0, body });
      last = r.status;
      if (r.status !== 207) continue;
      const rs = responses(r.body);
      const h = rs.length ? hrefIn(rs[0], NS.d, 'current-user-principal') : null;
      if (h) {
        principal = new URL(h, url).href;
        break;
      }
    }
    if (!principal) throw new Error('Unter dieser Adresse wurde kein Kalenderdienst gefunden (Antwort ' + last + ').');
    const r2 = await dav(acc, 'PROPFIND', principal, {
      depth: 0,
      body: '<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><c:calendar-home-set/></d:prop></d:propfind>'
    });
    const rs2 = r2.status === 207 ? responses(r2.body) : [];
    const home = rs2.length ? hrefIn(rs2[0], NS.c, 'calendar-home-set') : null;
    if (!home) throw new Error('Der Server hat keinen Kalenderordner für dieses Konto gemeldet.');
    acc.principal = principal;
    acc.home = new URL(home, principal).href;
    return acc;
  }

  App.connect = async function (server, user, password) {
    const acc = await discover(server, user, password);
    App.resetState();
    App.models = {};
    occCache = {};
    S().account = acc;
    await App.saveNow();
    App.requestSync(0);
  };

  App.logout = async function () {
    App.resetState();
    App.models = {};
    occCache = {};
    App.sync = { status: 'idle', detail: '' };
    await App.saveNow();
  };

  // Nextcloud-Anmeldung im Browser: liefert automatisch ein App-Passwort.
  let flowCancelled = false;
  App.cancelLoginFlow = () => (flowCancelled = true);
  App.loginFlow = async function (server) {
    const base = normalizeServer(server);
    flowCancelled = false;
    let r;
    try {
      r = await App.http({ url: base + '/index.php/login/v2', method: 'POST', headers: { 'User-Agent': UA, Accept: 'application/json' }, body: '' });
    } catch (e) {
      throw new Error('Server nicht erreichbar: ' + (e && e.message ? e.message : e));
    }
    let j = null;
    try {
      j = JSON.parse(r.body);
    } catch (e) {}
    if (r.status !== 200 || !j || !j.login || !j.poll) throw new Error('Diese Adresse antwortet nicht wie eine Nextcloud (Antwort ' + r.status + ').');
    App.openExternal(j.login);
    const until = Date.now() + 20 * 60000;
    while (Date.now() < until && !flowCancelled) {
      await new Promise((res) => setTimeout(res, 2000));
      let p = null;
      try {
        p = await App.http({
          url: j.poll.endpoint,
          method: 'POST',
          headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' },
          body: 'token=' + encodeURIComponent(j.poll.token)
        });
      } catch (e) {}
      if (p && p.status === 200) {
        const k = JSON.parse(p.body);
        return { server: k.server || base, user: k.loginName, password: k.appPassword };
      }
    }
    throw new Error(flowCancelled ? 'Anmeldung abgebrochen.' : 'Die Anmeldung ist abgelaufen. Bitte erneut versuchen.');
  };

  // ---------- Kalender lesen ----------
  async function listCalendars(acc) {
    const body =
      '<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:cs="http://calendarserver.org/ns/" xmlns:a="http://apple.com/ns/ical/"><d:prop>' +
      '<d:displayname/><d:resourcetype/><c:supported-calendar-component-set/><cs:getctag/><d:sync-token/><a:calendar-color/><d:current-user-privilege-set/>' +
      '</d:prop></d:propfind>';
    const r = await dav(acc, 'PROPFIND', acc.home, { depth: 1, body });
    if (r.status !== 207) throw new Error('Kalenderliste konnte nicht gelesen werden (Antwort ' + r.status + ').');
    const out = [];
    for (const resp of responses(r.body)) {
      const rt = el(resp, NS.d, 'resourcetype');
      if (!rt || !el(rt, NS.c, 'calendar')) continue;
      const url = new URL(ownHref(resp), acc.home).href;
      const comps = Array.from(resp.getElementsByTagNameNS(NS.c, 'comp')).map((c) => (c.getAttribute('name') || '').toUpperCase());
      const nameEl = el(resp, NS.d, 'displayname');
      const colEl = el(resp, NS.a, 'calendar-color');
      const ctagEl = el(resp, NS.cs, 'getctag') || el(resp, NS.d, 'sync-token');
      const priv = el(resp, NS.d, 'current-user-privilege-set');
      let readOnly = false;
      if (priv && priv.children.length) {
        const names = Array.from(priv.getElementsByTagName('*')).map((n) => n.localName);
        readOnly = !names.some((n) => n === 'write' || n === 'write-content' || n === 'all' || n === 'bind');
      }
      let color = colEl ? colEl.textContent.trim() : '';
      color = /^#[0-9a-f]{6}/i.test(color) ? color.slice(0, 7) : '#998DA0';
      const name = (nameEl && nameEl.textContent.trim()) || decodeURIComponent(url.replace(/\/$/, '').split('/').pop());
      out.push({
        url,
        name,
        color,
        readOnly,
        events: !comps.length || comps.includes('VEVENT'),
        todos: !comps.length || comps.includes('VTODO'),
        serverCtag: ctagEl ? ctagEl.textContent.trim() : ''
      });
    }
    return out;
  }

  const stamp = (d) => d.getUTCFullYear() + App.pad(d.getUTCMonth() + 1) + App.pad(d.getUTCDate()) + 'T000000Z';
  function eventWindow() {
    const n = new Date();
    return { from: new Date(n.getFullYear(), n.getMonth() - 3, 1), to: new Date(n.getFullYear(), n.getMonth() + 25, 1) };
  }
  async function report(acc, cal, comp, range) {
    const tr = range ? '<c:time-range start="' + stamp(range.from) + '" end="' + stamp(range.to) + '"/>' : '';
    const body =
      '<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><d:getetag/><c:calendar-data/></d:prop>' +
      '<c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="' + comp + '">' + tr + '</c:comp-filter></c:comp-filter></c:filter></c:calendar-query>';
    const r = await dav(acc, 'REPORT', cal.url, { depth: 1, body });
    if (r.status !== 207) throw new Error('„' + cal.name + '“ konnte nicht gelesen werden (Antwort ' + r.status + ').');
    const out = [];
    for (const resp of responses(r.body)) {
      const data = el(resp, NS.c, 'calendar-data');
      if (!data || !data.textContent.trim()) continue;
      const etag = el(resp, NS.d, 'getetag');
      out.push({ href: new URL(ownHref(resp), cal.url).href, etag: etag ? etag.textContent.trim() : null, ics: data.textContent });
    }
    return out;
  }

  // ---------- ICS -> Eintrag ----------
  function toLocal(t) {
    if (!t) return null;
    if (t.isDate) return new Date(t.year, t.month - 1, t.day);
    return t.toJSDate();
  }
  function parseCal(ics) {
    const comp = new ICAL.Component(ICAL.parse(ics));
    comp.getAllSubcomponents('vtimezone').forEach((tz) => {
      const id = tz.getFirstPropertyValue('tzid');
      if (id && !ICAL.TimezoneService.has(id)) ICAL.TimezoneService.register(tz);
    });
    return comp;
  }
  function buildModel(rec) {
    try {
      const comp = parseCal(rec.ics);
      const todos = comp.getAllSubcomponents('vtodo');
      if (todos.length) {
        const t = todos.find((x) => !x.hasProperty('recurrence-id')) || todos[0];
        const due = t.getFirstPropertyValue('due');
        const completed = t.getFirstPropertyValue('completed');
        const status = String(t.getFirstPropertyValue('status') || '').toUpperCase();
        const cats = [];
        t.getAllProperties('categories').forEach((p) => p.getValues().forEach((v) => cats.push(String(v).trim().toLowerCase())));
        const done = status === 'COMPLETED' || !!completed;
        const dueLocal = due ? toLocal(due) : null;
        const doneLocal = completed ? toLocal(completed) : null;
        return {
          kind: 'todo',
          href: rec.href,
          cal: rec.cal,
          title: String(t.getFirstPropertyValue('summary') || '(ohne Titel)'),
          due: dueLocal ? App.dkey(dueLocal) : null,
          done,
          doneKey: doneLocal ? App.dkey(doneLocal) : null,
          scope: cats.includes('woche') ? 'week' : cats.includes('monat') ? 'month' : 'day'
        };
      }
      const evs = comp.getAllSubcomponents('vevent');
      if (evs.length) {
        const master = evs.find((x) => !x.hasProperty('recurrence-id')) || evs[0];
        const ev = new ICAL.Event(master);
        evs.forEach((x) => {
          if (x !== master && x.hasProperty('recurrence-id')) {
            try {
              ev.relateException(x);
            } catch (e) {}
          }
        });
        const allDay = !!ev.startDate.isDate;
        const start = toLocal(ev.startDate);
        let end = toLocal(ev.endDate) || start;
        if (allDay && end <= start) end = App.addDays(start, 1);
        return {
          kind: 'event',
          href: rec.href,
          cal: rec.cal,
          title: String(ev.summary || '(ohne Titel)'),
          location: String(ev.location || ''),
          allDay,
          start,
          end,
          recurring: ev.isRecurring(),
          ev
        };
      }
    } catch (e) {
      console.warn('Eintrag nicht lesbar', rec.href, e);
    }
    return null;
  }
  function reparse(href) {
    const rec = S().items[href];
    const m = rec ? buildModel(rec) : null;
    if (m) App.models[href] = m;
    else delete App.models[href];
    occCache = {};
  }
  App.rebuildModels = function () {
    App.models = {};
    Object.keys(S().items).forEach((h) => {
      const m = buildModel(S().items[h]);
      if (m) App.models[h] = m;
    });
    occCache = {};
  };

  // Alle Termin-Vorkommen in einem Zeitraum, nach Tagen sortiert (mit Serienterminen).
  function occurrences(from, to) {
    const out = [];
    const hidden = S().settings.hiddenEv;
    for (const m of Object.values(App.models)) {
      if (m.kind !== 'event' || hidden[m.cal]) continue;
      if (!m.recurring) {
        if (m.start < to && (m.end > from || (+m.end === +m.start && m.start >= from))) out.push({ m, title: m.title, start: m.start, end: m.end });
        continue;
      }
      try {
        const it = m.ev.iterator();
        let n;
        let guard = 0;
        while ((n = it.next()) && guard++ < 8000) {
          const d = m.ev.getOccurrenceDetails(n);
          const s = toLocal(d.startDate);
          let e = toLocal(d.endDate) || s;
          if (m.allDay && e <= s) e = App.addDays(s, 1);
          if (s >= to) break;
          if (e > from || (+e === +s && s >= from)) out.push({ m, title: String((d.item && d.item.summary) || m.title), start: s, end: e });
        }
      } catch (e) {
        console.warn('Serie nicht lesbar', m.href, e);
      }
    }
    return out;
  }
  App.dayIndex = function (from, to) {
    const key = App.dkey(from) + '_' + App.dkey(to);
    if (occCache[key]) return occCache[key];
    const idx = {};
    for (const o of occurrences(from, to)) {
      let d = new Date(Math.max(+new Date(o.start.getFullYear(), o.start.getMonth(), o.start.getDate()), +from));
      let guard = 0;
      while (d < to && guard++ < 400) {
        if (d < o.end || +o.start === +o.end) (idx[App.dkey(d)] = idx[App.dkey(d)] || []).push(o);
        d = App.addDays(d, 1);
        if (d >= o.end) break;
      }
    }
    Object.values(idx).forEach((list) =>
      list.sort((a, b) => (b.m.allDay ? 1 : 0) - (a.m.allDay ? 1 : 0) || a.start - b.start || a.title.localeCompare(b.title))
    );
    occCache[key] = idx;
    return idx;
  };
  App.dayOccs = function (key) {
    const d = App.fromKey(key);
    return App.dayIndex(d, App.addDays(d, 1))[key] || [];
  };

  // ---------- Aenderungen (lokal sofort, Uebertragung ueber die Warteschlange) ----------
  function localPut(href, cal, ics) {
    const prev = S().items[href];
    S().items[href] = { href, cal, ics, etag: prev ? prev.etag : null, isNew: prev ? !!prev.isNew : true };
    reparse(href);
    if (!S().queue.some((o) => o.type === 'put' && o.href === href && !o.inflight)) S().queue.push({ type: 'put', href });
    App.save();
    App.requestSync(400);
  }
  App.deleteItem = function (href) {
    const it = S().items[href];
    if (!it) return;
    const busy = S().queue.some((o) => o.href === href && o.inflight);
    delete S().items[href];
    delete App.models[href];
    occCache = {};
    S().queue = S().queue.filter((o) => !(o.href === href && !o.inflight));
    if (!it.isNew || busy) S().queue.push({ type: 'delete', href, etag: it.isNew ? null : it.etag });
    App.save();
    App.requestSync(400);
  };

  const nowUtc = () => ICAL.Time.fromJSDate(new Date(), true);
  function touch(comp, isNew) {
    comp.updatePropertyWithValue('dtstamp', nowUtc());
    comp.updatePropertyWithValue('last-modified', nowUtc());
    if (isNew) comp.updatePropertyWithValue('created', nowUtc());
    else comp.updatePropertyWithValue('sequence', (parseInt(comp.getFirstPropertyValue('sequence'), 10) || 0) + 1);
  }
  function setTime(comp, name, value) {
    comp.removeAllProperties(name);
    if (!value) return;
    const p = new ICAL.Property(name);
    p.setValue(value);
    comp.addProperty(p);
  }
  const dateOnly = (d) => ICAL.Time.fromData({ year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate(), isDate: true });
  function newCalendar() {
    const c = new ICAL.Component(['vcalendar', [], []]);
    c.updatePropertyWithValue('version', '2.0');
    c.updatePropertyWithValue('prodid', '-//Kalender und To-dos//DE');
    return c;
  }

  App.defaultCal = function (kind) {
    const st = S().settings;
    const wanted = kind === 'todo' ? st.taskCal : st.eventCal;
    const ok = (c) => !c.readOnly && (kind === 'todo' ? c.todos : c.events);
    return S().calendars.find((c) => c.url === wanted && ok(c)) || S().calendars.find(ok) || null;
  };

  // scope: 'day' | 'week' | 'month'; due: 'JJJJ-MM-TT' oder null
  App.addTask = function ({ title, due, scope }) {
    const cal = App.defaultCal('todo');
    if (!cal) throw new Error('Es gibt keine beschreibbare Aufgabenliste in der Nextcloud.');
    const uid = App.uuid();
    const c = newCalendar();
    const t = new ICAL.Component('vtodo');
    t.updatePropertyWithValue('uid', uid);
    t.updatePropertyWithValue('summary', title);
    t.updatePropertyWithValue('status', 'NEEDS-ACTION');
    if (due) setTime(t, 'due', dateOnly(App.fromKey(due)));
    if (scope === 'week') t.updatePropertyWithValue('categories', 'Woche');
    if (scope === 'month') t.updatePropertyWithValue('categories', 'Monat');
    touch(t, true);
    c.addSubcomponent(t);
    localPut(cal.url + uid + '.ics', cal.url, c.toString());
  };

  function editTodo(href, fn) {
    const rec = S().items[href];
    if (!rec) return;
    const c = parseCal(rec.ics);
    const todos = c.getAllSubcomponents('vtodo');
    const t = todos.find((x) => !x.hasProperty('recurrence-id')) || todos[0];
    if (!t) return;
    fn(t);
    touch(t, false);
    localPut(href, rec.cal, c.toString());
  }
  App.toggleTask = function (href) {
    const m = App.models[href];
    if (!m) return;
    editTodo(href, (t) => {
      if (!m.done) {
        t.updatePropertyWithValue('status', 'COMPLETED');
        t.updatePropertyWithValue('completed', nowUtc());
        t.updatePropertyWithValue('percent-complete', 100);
      } else {
        t.updatePropertyWithValue('status', 'NEEDS-ACTION');
        t.removeAllProperties('completed');
        t.removeAllProperties('percent-complete');
      }
    });
  };
  App.updateTask = function (href, { title, due }) {
    editTodo(href, (t) => {
      t.updatePropertyWithValue('summary', title);
      if (due !== undefined) setTime(t, 'due', due ? dateOnly(App.fromKey(due)) : null);
    });
  };

  // start/end: Date; bei ganztaegig ist end der letzte Tag (einschliesslich)
  App.saveEvent = function ({ href, title, allDay, start, end, location, cal }) {
    let c;
    let v;
    const isNew = !href;
    if (isNew) {
      const uid = App.uuid();
      c = newCalendar();
      v = new ICAL.Component('vevent');
      v.updatePropertyWithValue('uid', uid);
      c.addSubcomponent(v);
      href = cal + uid + '.ics';
    } else {
      const rec = S().items[href];
      if (!rec) return;
      cal = rec.cal;
      c = parseCal(rec.ics);
      v = c.getFirstSubcomponent('vevent');
    }
    v.updatePropertyWithValue('summary', title);
    if (location) v.updatePropertyWithValue('location', location);
    else v.removeAllProperties('location');
    v.removeAllProperties('duration');
    if (allDay) {
      setTime(v, 'dtstart', dateOnly(start));
      setTime(v, 'dtend', dateOnly(App.addDays(end, 1)));
    } else {
      setTime(v, 'dtstart', ICAL.Time.fromJSDate(start, true));
      setTime(v, 'dtend', ICAL.Time.fromJSDate(end, true));
    }
    touch(v, isNew);
    localPut(href, cal, c.toString());
  };

  // ---------- Abgleich ----------
  async function flush(acc, forced, notes) {
    while (S().queue.length) {
      const op = S().queue[0];
      const it = S().items[op.href];
      if (op.type === 'put' && !it) {
        S().queue.shift();
        continue;
      }
      op.inflight = true;
      let r;
      try {
        if (op.type === 'put') {
          const headers = { 'Content-Type': 'text/calendar; charset=utf-8' };
          if (it.isNew) headers['If-None-Match'] = '*';
          else if (it.etag) headers['If-Match'] = it.etag;
          r = await dav(acc, 'PUT', op.href, { headers, body: it.ics });
        } else {
          r = await dav(acc, 'DELETE', op.href, { headers: op.etag ? { 'If-Match': op.etag } : {} });
        }
      } finally {
        delete op.inflight;
      }
      if (r.status >= 500 || r.status === 429) throw new Error('Der Server meldet einen Fehler (Antwort ' + r.status + ').');
      const i = S().queue.indexOf(op);
      if (i >= 0) S().queue.splice(i, 1);
      const ok = r.status >= 200 && r.status < 300;
      const calUrl = it ? it.cal : op.href.replace(/[^/]+$/, '');
      if (op.type === 'put') {
        const cur = S().items[op.href];
        if (ok) {
          const etag = r.headers.etag || null;
          if (cur) {
            cur.isNew = false;
            cur.etag = etag;
          }
          S().queue.forEach((o) => {
            if (o.href === op.href && o.type === 'delete') o.etag = etag;
          });
        } else {
          forced.add(calUrl);
          if (cur && cur.isNew && r.status !== 412) {
            delete S().items[op.href];
            delete App.models[op.href];
            occCache = {};
          } else if (cur) cur.isNew = false;
          S().queue = S().queue.filter((o) => o.href !== op.href);
          notes.push(
            r.status === 403
              ? 'Ein Eintrag konnte nicht gespeichert werden: Der Kalender ist schreibgeschützt.'
              : r.status === 412 || r.status === 409
              ? 'Ein Eintrag wurde inzwischen woanders geändert. Der Stand vom Server wurde übernommen.'
              : 'Ein Eintrag konnte nicht gespeichert werden (Antwort ' + r.status + ').'
          );
        }
      } else if (!ok && r.status !== 404) {
        forced.add(calUrl);
        notes.push('Ein Eintrag konnte nicht gelöscht werden (Antwort ' + r.status + ').');
      } else {
        forced.add(calUrl);
      }
      App.save();
    }
  }

  function applyRecords(cal, recs, kinds) {
    const pending = new Set(S().queue.map((o) => o.href));
    const seen = new Set();
    for (const rec of recs) {
      seen.add(rec.href);
      if (pending.has(rec.href)) continue;
      const old = S().items[rec.href];
      if (old && old.etag && old.etag === rec.etag && App.models[rec.href]) continue;
      S().items[rec.href] = { href: rec.href, cal: cal.url, etag: rec.etag, ics: rec.ics, isNew: false };
      const m = buildModel(S().items[rec.href]);
      if (m) App.models[rec.href] = m;
      else delete App.models[rec.href];
    }
    for (const href of Object.keys(S().items)) {
      const it = S().items[href];
      if (it.cal !== cal.url || seen.has(href) || pending.has(href) || it.isNew) continue;
      const m = App.models[href];
      if (m && !kinds.includes(m.kind)) continue;
      delete S().items[href];
      delete App.models[href];
    }
    occCache = {};
  }

  async function runSync() {
    const acc = S().account;
    if (!acc) return [];
    const forced = new Set();
    const notes = [];
    await flush(acc, forced, notes);
    const found = await listCalendars(acc);
    const prev = S().calendars;
    const urls = new Set(found.map((c) => c.url));
    for (const href of Object.keys(S().items)) {
      if (!urls.has(S().items[href].cal) && !S().items[href].isNew) {
        delete S().items[href];
        delete App.models[href];
      }
    }
    S().calendars = found.map((c) => {
      const old = prev.find((p) => p.url === c.url);
      return Object.assign({}, c, { ctag: old ? old.ctag : null });
    });
    App.save();
    for (const cal of S().calendars) {
      if (cal.ctag && cal.ctag === cal.serverCtag && !forced.has(cal.url)) continue;
      const kinds = [];
      let recs = [];
      if (cal.events) {
        recs = recs.concat(await report(acc, cal, 'VEVENT', eventWindow()));
        kinds.push('event');
      }
      if (cal.todos) {
        recs = recs.concat(await report(acc, cal, 'VTODO', null));
        kinds.push('todo');
      }
      applyRecords(cal, recs, kinds);
      cal.ctag = cal.serverCtag || null;
      App.save();
      if (App.render) App.render();
    }
    const st = S().settings;
    if (!App.defaultCal('event') || !S().calendars.some((c) => c.url === st.eventCal)) st.eventCal = (App.defaultCal('event') || {}).url || null;
    if (!S().calendars.some((c) => c.url === st.taskCal)) st.taskCal = (App.defaultCal('todo') || {}).url || null;
    S().lastSync = Date.now();
    return notes;
  }

  let running = false;
  let again = false;
  let timer = null;
  App.requestSync = function (delay) {
    clearTimeout(timer);
    timer = setTimeout(doSync, delay || 0);
  };
  async function doSync() {
    if (!S().account) return;
    if (running) {
      again = true;
      return;
    }
    running = true;
    App.sync = { status: 'syncing', detail: '' };
    if (App.render) App.render();
    try {
      const notes = await runSync();
      App.sync = { status: 'ok', detail: '' };
      if (notes.length && App.toast) App.toast(notes[0]);
    } catch (e) {
      if (e instanceof AuthError) App.sync = { status: 'auth', detail: e.message };
      else if (e.offline) App.sync = { status: 'offline', detail: e.message };
      else App.sync = { status: 'error', detail: e.message || String(e) };
    } finally {
      running = false;
      await App.saveNow();
      if (App.render) App.render();
      if (again) {
        again = false;
        App.requestSync(300);
      }
    }
  }
})();
