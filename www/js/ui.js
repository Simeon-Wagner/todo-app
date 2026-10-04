'use strict';
/* Oberflaeche: Heute, Listen, Kalender, Nextcloud. */
(function () {
  const App = window.App;
  const S = () => App.state;
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const now0 = new Date();
  const ui = (App.ui = {
    view: 'today',
    mode: 'week',
    weekRef: App.monday(now0),
    monthRef: new Date(now0.getFullYear(), now0.getMonth(), 1),
    calY: now0.getFullYear(),
    calM: now0.getMonth(),
    sel: App.dkey(now0),
    login: { busy: false, error: '', flow: false, manual: false }
  });

  const svg = (d, w, sw) =>
    '<svg width="' + (w || 22) + '" height="' + (w || 22) + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="' + (sw || 2) +
    '" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + '</svg>';
  const IC = {
    sun: '<circle cx="12" cy="12" r="4"></circle><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"></path>',
    list: '<path d="M10 6h10M10 12h10M10 18h10"></path><path d="M3.5 6l1 1 2-2M3.5 12l1 1 2-2M3.5 18l1 1 2-2"></path>',
    cal: '<rect x="3" y="5" width="18" height="16" rx="2"></rect><path d="M3 10h18M8 3v4M16 3v4"></path>',
    cloud: '<path d="M7 18a4 4 0 0 1-.5-7.97A6 6 0 0 1 18 9.5a4.25 4.25 0 0 1-.5 8.5H7z"></path>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"></path>',
    plus: '<path d="M12 5v14M5 12h14"></path>',
    prev: '<path d="M15 6l-6 6 6 6"></path>',
    next: '<path d="M9 6l6 6-6 6"></path>',
    more: '<circle cx="5" cy="12" r="1.4"></circle><circle cx="12" cy="12" r="1.4"></circle><circle cx="19" cy="12" r="1.4"></circle>'
  };

  const MINI = '<button type="button" class="mini" data-act="new-event">' + svg(IC.plus, 18, 2.4) + '<span>Termin</span></button>';
  const calOf = (url) => S().calendars.find((c) => c.url === url) || { name: '', color: '#998DA0', readOnly: false };
  const fmtDay = (d) => d.getDate() + '. ' + App.MONTHS[d.getMonth()];
  const fmtShort = (d) => d.getDate() + '. ' + App.MONTHS_SHORT[d.getMonth()];

  // ---------- Aufgaben ----------
  function todos() {
    const hidden = S().settings.hiddenTodo;
    return Object.values(App.models).filter((m) => m.kind === 'todo' && !hidden[m.cal]);
  }
  function sortTasks(list) {
    return list.sort((a, b) => (a.done ? 1 : 0) - (b.done ? 1 : 0) || String(a.due || '9').localeCompare(String(b.due || '9')) || a.title.localeCompare(b.title));
  }
  function taskRow(m, sub) {
    return (
      '<div class="task' + (m.done ? ' done' : '') + '">' +
      '<button type="button" class="tmain" data-act="toggle" data-href="' + esc(m.href) + '" aria-pressed="' + m.done + '">' +
      '<span class="box">' + (m.done ? svg(IC.check, 16, 3) : '') + '</span>' +
      '<span class="ttext"><span class="ttitle">' + esc(m.title) + '</span>' + (sub ? '<span class="tsub">' + esc(sub) + '</span>' : '') + '</span></button>' +
      '<button type="button" class="more" data-act="edit-task" data-href="' + esc(m.href) + '" aria-label="Aufgabe bearbeiten: ' + esc(m.title) + '">' + svg(IC.more, 20) + '</button></div>'
    );
  }
  function addForm(scope) {
    if (!App.defaultCal('todo'))
      return (
        '<div class="nolist"><p>In deiner Nextcloud gibt es noch keine Aufgabenliste.</p>' +
        '<button type="button" class="primary" data-act="make-list">Aufgabenliste anlegen</button></div>'
      );
    return (
      '<form class="add" data-form="add-task" data-scope="' + scope + '"><label>' + svg(IC.plus, 22, 2.2) +
      '<input type="text" name="title" data-keep="add-' + scope + '" placeholder="Aufgabe hinzufügen" aria-label="Neue Aufgabe" autocomplete="off" enterkeyhint="done"></label>' +
      '<button type="submit">Anlegen</button></form>'
    );
  }
  function progress(list) {
    const n = list.filter((t) => t.done).length;
    const pct = list.length ? Math.round((n / list.length) * 100) : 0;
    return { text: list.length ? n + ' von ' + list.length + ' erledigt' : 'Noch keine Aufgaben', bar: '<div class="bar"><div style="width:' + pct + '%"></div></div>' };
  }

  // ---------- Termine ----------
  function eventRow(o, dayKey) {
    const day = App.fromKey(dayKey);
    const dayEnd = App.addDays(day, 1);
    const cal = calOf(o.m.cal);
    let time;
    if (o.m.allDay) time = '<span class="tall">Ganz&shy;tägig</span>';
    else {
      const a = o.start < day ? '…' : App.hhmm(o.start);
      const b = o.end > dayEnd ? '…' : App.hhmm(o.end);
      time = a + (+o.start === +o.end ? '' : '<br><span class="tend">' + b + '</span>');
    }
    return (
      '<button type="button" class="ev" data-act="event" data-href="' + esc(o.m.href) + '">' +
      '<span class="etime">' + time + '</span><span class="ebody"><span class="etitle">' + esc(o.title) + '</span>' +
      '<span class="emeta"><span class="dot" style="background:' + esc(cal.color) + '"></span><span>' + esc(cal.name) + (o.m.location ? ' · ' + esc(o.m.location) : '') + '</span></span></span></button>'
    );
  }

  function syncChip() {
    const n = S().queue.length;
    const st = App.sync.status;
    let t = 'Synchron';
    if (st === 'syncing') t = 'Abgleich …';
    else if (st === 'offline') t = 'Offline' + (n ? ' · ' + n : '');
    else if (st === 'auth') t = 'Anmeldung';
    else if (st === 'error') t = 'Fehler';
    else if (n) t = n + ' wartend';
    return '<button type="button" class="chip" data-act="sync" aria-label="Jetzt synchronisieren. Stand: ' + esc(t) + '">' + svg(IC.cloud, 18) + '<span>' + esc(t) + '</span></button>';
  }

  // ---------- Ansichten ----------
  function viewToday() {
    const now = new Date();
    const tk = App.dkey(now);
    const occs = App.dayOccs(tk);
    const all = todos().filter((m) => m.scope === 'day');
    const list = sortTasks(all.filter((m) => (!m.done && m.due && m.due <= tk) || (m.done && m.doneKey === tk)));
    const undated = sortTasks(all.filter((m) => !m.done && !m.due)).slice(0, 30);
    const p = progress(list);
    return (
      '<header class="head"><div><div class="kicker">' + App.DAYS[now.getDay()] + '</div><h1>' + fmtDay(now) + '</h1></div>' + syncChip() + '</header>' +
      '<div class="scroll">' +
      '<section><div class="h2row"><h2>Termine heute</h2>' + MINI + '</div><div class="card">' +
      (occs.length ? occs.map((o) => eventRow(o, tk)).join('<div class="sep"></div>') : '<p class="empty">Keine Termine heute.</p>') +
      '</div></section>' +
      '<section><div class="h2row"><h2>Heute zu erledigen</h2><span>' + p.text + '</span></div>' + p.bar +
      '<div class="card">' +
      list.map((m) => taskRow(m, !m.done && m.due < tk ? 'fällig seit ' + fmtShort(App.fromKey(m.due)) : '')).join('') +
      addForm('day') + '</div></section>' +
      (undated.length ? '<section><h2>Ohne Datum</h2><div class="card">' + undated.map((m) => taskRow(m, '')).join('') + '</div></section>' : '') +
      '</div>'
    );
  }

  function periodInfo() {
    if (ui.mode === 'week') {
      const mon = ui.weekRef;
      const sun = App.addDays(mon, 6);
      const sameMonth = mon.getMonth() === sun.getMonth();
      return {
        label: 'KW ' + App.isoWeek(mon),
        range: (sameMonth ? mon.getDate() + '.' : fmtDay(mon)) + ' – ' + fmtDay(sun),
        from: App.dkey(mon),
        to: App.dkey(sun),
        due: sun,
        tag: 'Woche',
        current: App.dkey(mon) === App.dkey(App.monday(new Date()))
      };
    }
    const first = ui.monthRef;
    const last = new Date(first.getFullYear(), first.getMonth() + 1, 0);
    const n = new Date();
    return {
      label: App.MONTHS[first.getMonth()],
      range: String(first.getFullYear()),
      from: App.dkey(first),
      to: App.dkey(last),
      due: last,
      tag: 'Monat',
      current: first.getFullYear() === n.getFullYear() && first.getMonth() === n.getMonth()
    };
  }
  function viewLists() {
    const pi = periodInfo();
    const scope = ui.mode;
    const list = sortTasks(todos().filter((m) => m.scope === scope && (m.due ? m.due >= pi.from && m.due <= pi.to : pi.current)));
    const p = progress(list);
    const cal = App.defaultCal('todo');
    return (
      '<header class="head col"><h1>Listen</h1>' +
      '<div class="seg"><button type="button" data-act="mode" data-mode="week" aria-pressed="' + (scope === 'week') + '">Woche</button>' +
      '<button type="button" data-act="mode" data-mode="month" aria-pressed="' + (scope === 'month') + '">Monat</button></div>' +
      '<div class="period"><button type="button" class="round" data-act="period" data-dir="-1" aria-label="Zurück">' + svg(IC.prev, 22, 2.2) + '</button>' +
      '<button type="button" class="plabel" data-act="period-now" aria-label="' + esc(pi.label + ', ' + pi.range) + '. Antippen für den aktuellen Zeitraum"><strong>' + esc(pi.label) + '</strong><span>' + esc(pi.range) + '</span></button>' +
      '<button type="button" class="round" data-act="period" data-dir="1" aria-label="Weiter">' + svg(IC.next, 22, 2.2) + '</button></div>' +
      '<div class="prog"><span>' + p.text + '</span>' + p.bar + '</div></header>' +
      '<div class="scroll"><div class="card">' + list.map((m) => taskRow(m, '')).join('') + addForm(scope) + '</div>' +
      '<p class="note">' +
      (cal
        ? 'Wird in „' + esc(cal.name) + '“ gespeichert, mit Schlagwort „' + pi.tag + '“ und fällig bis ' + App.DAYS[pi.due.getDay()] + ', ' + fmtDay(pi.due) + '.'
        : 'In der Nextcloud wurde keine beschreibbare Aufgabenliste gefunden.') +
      '</p></div>'
    );
  }

  function viewCalendar() {
    const y = ui.calY;
    const m = ui.calM;
    const first = new Date(y, m, 1);
    const offset = (first.getDay() + 6) % 7;
    const dim = new Date(y, m + 1, 0).getDate();
    const total = Math.ceil((offset + dim) / 7) * 7;
    const start = App.addDays(first, -offset);
    const idx = App.dayIndex(start, App.addDays(start, total));
    const tk = App.dkey(new Date());
    const dayTasks = {};
    todos().forEach((t) => {
      if (t.scope === 'day' && t.due) (dayTasks[t.due] = dayTasks[t.due] || []).push(t);
    });
    let cells = '';
    for (let i = 0; i < total; i++) {
      const d = App.addDays(start, i);
      const k = App.dkey(d);
      const has = !!(idx[k] && idx[k].length) || !!(dayTasks[k] && dayTasks[k].some((t) => !t.done));
      const cls = ['day'];
      if (d.getMonth() !== m) cls.push('out');
      if (k === tk) cls.push('today');
      if (k === ui.sel) cls.push('sel');
      cells +=
        '<button type="button" class="' + cls.join(' ') + '" data-act="pick" data-key="' + k + '" aria-pressed="' + (k === ui.sel) + '" aria-label="' +
        fmtDay(d) + ' ' + d.getFullYear() + (has ? ', mit Einträgen' : '') + '"><span>' + d.getDate() + '</span><i' + (has ? ' class="on"' : '') + '></i></button>';
    }
    const selDate = App.fromKey(ui.sel);
    const occs = App.dayOccs(ui.sel);
    const tasks = sortTasks((dayTasks[ui.sel] || []).slice());
    return (
      '<header class="head"><h1 class="mtitle">' + App.MONTHS[m] + ' ' + y + '</h1><div class="hbtns">' +
      '<button type="button" class="chip" data-act="cal-today">Heute</button>' +
      '<button type="button" class="round sm" data-act="cal-move" data-dir="-1" aria-label="Vorheriger Monat">' + svg(IC.prev, 22, 2.2) + '</button>' +
      '<button type="button" class="round sm" data-act="cal-move" data-dir="1" aria-label="Nächster Monat">' + svg(IC.next, 22, 2.2) + '</button></div></header>' +
      '<div class="grid wd"><div>Mo</div><div>Di</div><div>Mi</div><div>Do</div><div>Fr</div><div>Sa</div><div>So</div></div>' +
      '<div class="grid days">' + cells + '</div>' +
      '<div class="agenda"><div class="h2row arow"><h2 class="atitle">' + App.DAYS[selDate.getDay()] + ', ' + fmtDay(selDate) + '</h2>' + MINI + '</div>' +
      (occs.length || tasks.length ? '' : '<p class="empty">Keine Termine oder Aufgaben an diesem Tag.</p>') +
      occs.map((o) => eventRow(o, ui.sel)).join('<div class="sep"></div>') +
      (tasks.length ? '<div class="sep"></div>' + tasks.map((t) => taskRow(t, '')).join('') : '') +
      '</div>'
    );
  }

  function switchRow(act, c, on, square) {
    return (
      '<button type="button" class="sw" role="switch" aria-checked="' + on + '" data-act="' + act + '" data-url="' + esc(c.url) + '">' +
      '<span class="dot' + (square ? ' sq' : '') + '" style="background:' + esc(c.color) + '"></span><span class="swname">' + esc(c.name) + (c.readOnly ? ' <small>(nur lesen)</small>' : '') + '</span>' +
      '<span class="track"><span></span></span></button>'
    );
  }
  function viewSettings() {
    const acc = S().account;
    const st = S().settings;
    const sy = App.sync;
    const n = S().queue.length;
    const evCals = S().calendars.filter((c) => c.events);
    const tdCals = S().calendars.filter((c) => c.todos);
    let title = 'Verbunden';
    let line = S().lastSync ? 'Zuletzt synchronisiert: ' + fmtShort(new Date(S().lastSync)) + ', ' + App.hhmm(new Date(S().lastSync)) : 'Noch nicht synchronisiert';
    if (sy.status === 'syncing') line = 'Abgleich läuft …';
    if (sy.status === 'offline') { title = 'Offline'; line = 'Keine Verbindung zum Server' + (sy.detail ? ' (' + sy.detail + ')' : ''); }
    if (sy.status === 'auth') { title = 'Anmeldung nötig'; line = sy.detail; }
    if (sy.status === 'error') { title = 'Fehler beim Abgleich'; line = sy.detail; }
    const opts = (list, cur) => list.filter((c) => !c.readOnly).map((c) => '<option value="' + esc(c.url) + '"' + (c.url === cur ? ' selected' : '') + '>' + esc(c.name) + '</option>').join('');
    return (
      '<header class="head"><h1>Nextcloud</h1></header><div class="scroll">' +
      '<section class="card pad"><div class="conn"><span class="tile">' + svg(IC.cloud, 24) + '</span><div><strong>' + esc(title) + '</strong><span>' + esc(line) + '</span></div></div>' +
      '<dl><div><dt>Server</dt><dd>' + esc(acc.server.replace(/^https?:\/\//, '')) + '</dd></div><div><dt>Konto</dt><dd>' + esc(acc.user) + '</dd></div>' +
      '<div><dt>Wartende Änderungen</dt><dd>' + n + '</dd></div></dl>' +
      '<button type="button" class="primary" data-act="sync">Jetzt synchronisieren</button></section>' +
      '<section><h2>Kalender</h2><div class="card">' + (evCals.length ? evCals.map((c) => switchRow('tog-ev', c, !st.hiddenEv[c.url], false)).join('') : '<p class="empty">Noch keine Kalender geladen.</p>') + '</div></section>' +
      '<section><h2>Aufgabenlisten</h2><div class="card">' + (tdCals.length ? tdCals.map((c) => switchRow('tog-todo', c, !st.hiddenTodo[c.url], true)).join('') : '<p class="empty">Noch keine Aufgabenlisten geladen.</p>') + '</div></section>' +
      '<section><h2>Neue Einträge</h2><div class="card pad fields">' +
      '<label>Neue Termine in<select data-change="eventCal">' + opts(evCals, st.eventCal) + '</select></label>' +
      '<label>Neue Aufgaben in<select data-change="taskCal">' + opts(tdCals, st.taskCal) + '</select></label></div></section>' +
      '<p class="note">Abgleich über CalDAV mit Nextcloud Kalender und Nextcloud Tasks. Änderungen ohne Netz werden auf dem Gerät gespeichert und beim nächsten Abgleich übertragen.</p>' +
      '<button type="button" class="ghost" data-act="logout">Abmelden und lokale Daten löschen</button></div>'
    );
  }

  function viewLogin() {
    const l = ui.login;
    return (
      '<div class="scroll login"><h1>Kalender &amp; To-dos</h1><p class="lead">Verbinde die App mit deiner Nextcloud. Termine und Aufgaben werden auf dem Gerät gespeichert und abgeglichen, sobald Netz da ist.</p>' +
      (l.error ? '<p class="err" role="alert">' + esc(l.error) + '</p>' : '') +
      '<form class="card pad fields" data-form="login">' +
      '<label>Adresse der Nextcloud<input type="text" inputmode="url" name="server" data-keep="lg-server" placeholder="cloud.beispiel.de" autocomplete="url" autocapitalize="none" autocorrect="off" spellcheck="false" required></label>' +
      (l.flow
        ? '<p class="wait">Die Anmeldeseite wurde im Browser geöffnet. Melde dich dort an und erlaube den Zugriff, dann komm hierher zurück.</p><button type="button" class="ghost" data-act="flow-cancel">Abbrechen</button>'
        : '<button type="submit" class="primary" name="how" value="flow"' + (l.busy ? ' disabled' : '') + '>Mit Nextcloud anmelden</button>' +
          (l.manual
            ? '<label>Benutzername<input type="text" name="user" data-keep="lg-user" autocomplete="username" autocapitalize="none"></label>' +
              '<label>App-Passwort<input type="password" name="password" data-keep="lg-pass" autocomplete="current-password"></label>' +
              '<button type="submit" class="secondary" name="how" value="manual"' + (l.busy ? ' disabled' : '') + '>' + (l.busy ? 'Verbinde …' : 'Mit App-Passwort verbinden') + '</button>' +
              '<p class="hint">Ein App-Passwort erzeugst du in der Nextcloud unter Einstellungen › Sicherheit › Geräte &amp; Sitzungen.</p>'
            : '<button type="button" class="ghost" data-act="manual">Stattdessen App-Passwort eingeben</button>')) +
      '</form></div>'
    );
  }

  function navHtml() {
    const item = (v, label, icon) =>
      '<button type="button" data-act="nav" data-view="' + v + '"' + (ui.view === v ? ' aria-current="page"' : '') + '><span class="pill">' + svg(icon, 22) + '</span><span>' + label + '</span></button>';
    return item('today', 'Heute', IC.sun) + item('lists', 'Listen', IC.list) + item('calendar', 'Kalender', IC.cal) + item('settings', 'Nextcloud', IC.cloud);
  }

  App.render = function () {
    const screen = $('#screen');
    const keep = {};
    let focus = null;
    screen.querySelectorAll('[data-keep]').forEach((i) => {
      keep[i.dataset.keep] = i.value;
      if (document.activeElement === i) focus = { id: i.dataset.keep, a: i.selectionStart, b: i.selectionEnd };
    });
    const sc = screen.querySelector('.scroll, .agenda');
    const top = sc ? sc.scrollTop : 0;
    const prevView = screen.dataset.view;
    const view = S().account ? ui.view : 'login';
    screen.dataset.view = view;
    screen.innerHTML = view === 'login' ? viewLogin() : view === 'today' ? viewToday() : view === 'lists' ? viewLists() : view === 'calendar' ? viewCalendar() : viewSettings();
    $('#nav').hidden = view === 'login';
    $('#nav').innerHTML = view === 'login' ? '' : navHtml();
    screen.querySelectorAll('[data-keep]').forEach((i) => {
      if (keep[i.dataset.keep] != null) i.value = keep[i.dataset.keep];
      if (focus && focus.id === i.dataset.keep) {
        i.focus();
        try { i.setSelectionRange(focus.a, focus.b); } catch (e) {}
      }
    });
    const sc2 = screen.querySelector('.scroll, .agenda');
    if (sc2 && prevView === view) sc2.scrollTop = top;
  };

  let toastTimer = null;
  App.toast = function (msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (t.hidden = true), 5000);
  };

  // ---------- Formulare (Blatt von unten) ----------
  function openSheet(title, inner) {
    const sh = $('#sheet');
    sh.innerHTML = '<div class="backdrop" data-act="close-sheet"></div><div class="panel" role="dialog" aria-modal="true" aria-label="' + esc(title) + '"><h2>' + esc(title) + '</h2>' + inner + '</div>';
    sh.hidden = false;
    const f = sh.querySelector('input[type=text]');
    if (f && !f.value) f.focus();
  }
  function closeSheet() {
    $('#sheet').hidden = true;
    $('#sheet').innerHTML = '';
  }

  function taskSheet(href) {
    const m = App.models[href];
    if (!m) return;
    openSheet(
      'Aufgabe bearbeiten',
      '<form class="fields" data-form="task" data-href="' + esc(href) + '"><label>Titel<input type="text" name="title" value="' + esc(m.title) + '" required></label>' +
        (m.scope === 'day' ? '<label>Fällig am<input type="date" name="due" value="' + esc(m.due || '') + '"></label>' : '') +
        '<div class="btns"><button type="button" class="danger" data-act="del" data-href="' + esc(href) + '">Löschen</button><button type="button" class="ghost" data-act="close-sheet">Abbrechen</button><button type="submit" class="primary">Speichern</button></div></form>'
    );
  }

  function eventSheet(href) {
    const m = href ? App.models[href] : null;
    if (href && !m) return;
    const cal = m ? calOf(m.cal) : null;
    if (m && (m.recurring || cal.readOnly)) {
      const when = m.allDay ? 'Ganztägig' : App.hhmm(m.start) + ' – ' + App.hhmm(m.end);
      openSheet(
        m.title,
        '<dl class="info"><div><dt>Zeit</dt><dd>' + esc(when) + (m.recurring ? ' · Serientermin' : ', ' + fmtDay(m.start)) + '</dd></div>' +
          (m.location ? '<div><dt>Ort</dt><dd>' + esc(m.location) + '</dd></div>' : '') +
          '<div><dt>Kalender</dt><dd>' + esc(cal.name) + '</dd></div></dl>' +
          '<p class="hint">' + (m.recurring ? 'Serientermine lassen sich in dieser Version nur in der Nextcloud bearbeiten.' : 'Dieser Kalender ist schreibgeschützt.') + '</p>' +
          '<div class="btns"><button type="button" class="primary" data-act="close-sheet">Schließen</button></div>'
      );
      return;
    }
    let start;
    let end;
    let allDay = false;
    if (m) {
      start = m.start;
      end = m.allDay ? App.addDays(m.end, -1) : m.end;
      allDay = m.allDay;
    } else {
      const base = ui.view === 'calendar' ? App.fromKey(ui.sel) : new Date();
      const n = new Date();
      start = new Date(base.getFullYear(), base.getMonth(), base.getDate(), Math.min(n.getHours() + 1, 23), 0);
      end = new Date(+start + 3600000);
    }
    const cals = S().calendars.filter((c) => c.events && !c.readOnly);
    const def = App.defaultCal('event');
    if (!m && !def) {
      App.toast('In der Nextcloud wurde kein beschreibbarer Kalender gefunden.');
      return;
    }
    openSheet(
      m ? 'Termin bearbeiten' : 'Neuer Termin',
      '<form class="fields" data-form="event"' + (m ? ' data-href="' + esc(href) + '"' : '') + '>' +
        '<label>Titel<input type="text" name="title" value="' + esc(m ? m.title : '') + '" required></label>' +
        '<label class="chk"><input type="checkbox" name="allDay"' + (allDay ? ' checked' : '') + '> Ganztägig</label>' +
        '<div class="two"><label>Beginn<input type="date" name="d1" value="' + App.dkey(start) + '" required></label><label class="tm">Uhrzeit<input type="time" name="t1" value="' + App.hhmm(start) + '"></label></div>' +
        '<div class="two"><label>Ende<input type="date" name="d2" value="' + App.dkey(end) + '" required></label><label class="tm">Uhrzeit<input type="time" name="t2" value="' + App.hhmm(end) + '"></label></div>' +
        '<label>Ort<input type="text" name="location" value="' + esc(m ? m.location : '') + '"></label>' +
        (m ? '' : '<label>Kalender<select name="cal">' + cals.map((c) => '<option value="' + esc(c.url) + '"' + (c.url === def.url ? ' selected' : '') + '>' + esc(c.name) + '</option>').join('') + '</select></label>') +
        '<div class="btns">' + (m ? '<button type="button" class="danger" data-act="del" data-href="' + esc(href) + '">Löschen</button>' : '') +
        '<button type="button" class="ghost" data-act="close-sheet">Abbrechen</button><button type="submit" class="primary">Speichern</button></div></form>'
    );
    syncAllDay();
  }
  function syncAllDay() {
    const f = $('#sheet form[data-form=event]');
    if (f) f.classList.toggle('allday', f.elements.allDay.checked);
  }

  // ---------- Ereignisse ----------
  const actions = {
    nav: (b) => { ui.view = b.dataset.view; },
    sync: () => App.requestSync(0),
    toggle: (b) => App.toggleTask(b.dataset.href),
    'edit-task': (b) => taskSheet(b.dataset.href),
    event: (b) => eventSheet(b.dataset.href),
    'new-event': () => eventSheet(null),
    'close-sheet': () => closeSheet(),
    del: (b) => { App.deleteItem(b.dataset.href); closeSheet(); },
    mode: (b) => { ui.mode = b.dataset.mode; },
    period: (b) => {
      const dir = Number(b.dataset.dir);
      if (ui.mode === 'week') ui.weekRef = App.addDays(ui.weekRef, 7 * dir);
      else ui.monthRef = new Date(ui.monthRef.getFullYear(), ui.monthRef.getMonth() + dir, 1);
    },
    'period-now': () => {
      const n = new Date();
      ui.weekRef = App.monday(n);
      ui.monthRef = new Date(n.getFullYear(), n.getMonth(), 1);
    },
    pick: (b) => { ui.sel = b.dataset.key; },
    'cal-move': (b) => {
      const d = new Date(ui.calY, ui.calM + Number(b.dataset.dir), 1);
      ui.calY = d.getFullYear();
      ui.calM = d.getMonth();
    },
    'cal-today': () => {
      const n = new Date();
      ui.calY = n.getFullYear();
      ui.calM = n.getMonth();
      ui.sel = App.dkey(n);
    },
    'tog-ev': (b) => { const h = S().settings.hiddenEv; h[b.dataset.url] = !h[b.dataset.url]; App.rebuildModels(); App.save(); },
    'tog-todo': (b) => { const h = S().settings.hiddenTodo; h[b.dataset.url] = !h[b.dataset.url]; App.save(); },
    'make-list': async (b) => {
      b.disabled = true;
      try {
        await App.createTaskList();
        App.toast('Aufgabenliste „Aufgaben“ wurde angelegt.');
      } catch (err) {
        throw new Error(err.offline ? 'Dafür wird eine Verbindung zur Nextcloud gebraucht.' : err.message);
      }
    },
    manual: () => { ui.login.manual = true; },
    'flow-cancel': () => { App.cancelLoginFlow(); ui.login.flow = false; ui.login.busy = false; },
    logout: async () => {
      if (!confirm('Wirklich abmelden? Noch nicht übertragene Änderungen gehen verloren.')) return;
      await App.logout();
      ui.view = 'today';
      ui.login = { busy: false, error: '', flow: false, manual: false };
    }
  };

  document.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const fn = actions[b.dataset.act];
    if (!fn) return;
    try {
      await fn(b);
    } catch (err) {
      App.toast(err.message || String(err));
    }
    App.render();
  });

  document.addEventListener('change', (e) => {
    const t = e.target;
    if (t.name === 'allDay') syncAllDay();
    if (t.dataset && t.dataset.change) {
      S().settings[t.dataset.change] = t.value;
      App.save();
    }
  });

  async function doLogin(form, how) {
    const l = ui.login;
    const server = form.elements.server.value;
    l.error = '';
    l.busy = true;
    try {
      if (how === 'manual') {
        App.render();
        await App.connect(server, form.elements.user.value, form.elements.password.value);
      } else {
        App.normalizeServer(server);
        l.flow = true;
        App.render();
        const c = await App.loginFlow(server);
        await App.connect(c.server, c.user, c.password);
      }
      ui.view = 'today';
    } catch (err) {
      l.error = err.offline ? 'Server nicht erreichbar: ' + err.message : err.message || String(err);
    }
    l.busy = false;
    l.flow = false;
    App.render();
  }

  document.addEventListener('submit', (e) => {
    const f = e.target;
    const kind = f.dataset.form;
    if (!kind) return;
    e.preventDefault();
    try {
      if (kind === 'add-task') {
        const title = f.elements.title.value.trim();
        if (!title) return;
        const scope = f.dataset.scope;
        const pi = scope === 'day' ? null : periodInfo();
        App.addTask({ title, scope, due: scope === 'day' ? App.dkey(new Date()) : App.dkey(pi.due) });
        f.elements.title.value = '';
      } else if (kind === 'task') {
        const title = f.elements.title.value.trim();
        if (!title) return;
        App.updateTask(f.dataset.href, { title, due: f.elements.due ? f.elements.due.value || null : undefined });
        closeSheet();
      } else if (kind === 'event') {
        const el = f.elements;
        const title = el.title.value.trim();
        if (!title || !el.d1.value) return;
        const allDay = el.allDay.checked;
        let start = new Date(el.d1.value + 'T' + (allDay ? '00:00' : el.t1.value || '00:00'));
        let end = new Date((el.d2.value || el.d1.value) + 'T' + (allDay ? '00:00' : el.t2.value || el.t1.value || '00:00'));
        if (end < start) end = allDay ? start : new Date(+start + 3600000);
        App.saveEvent({ href: f.dataset.href || null, title, allDay, start, end, location: el.location.value.trim(), cal: el.cal ? el.cal.value : null });
        if (!f.dataset.href) {
          ui.sel = App.dkey(start);
          ui.calY = start.getFullYear();
          ui.calM = start.getMonth();
        }
        closeSheet();
      } else if (kind === 'login') {
        doLogin(f, (e.submitter && e.submitter.value === 'manual') || (f.elements.password && f.elements.password.value) ? 'manual' : 'flow');
        return;
      }
    } catch (err) {
      App.toast(err.message || String(err));
    }
    App.render();
  });

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      App.render();
      App.requestSync(0);
    }
  });
  window.addEventListener('online', () => App.requestSync(0));
  setInterval(() => { if (!document.hidden) App.requestSync(0); }, 5 * 60000);

  (async function start() {
    await App.load();
    App.rebuildModels();
    App.render();
    if (S().account) App.requestSync(0);
  })();
})();
