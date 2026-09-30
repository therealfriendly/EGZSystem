/* Operator – Haus › Gym (Bildschirm 'haus/gym') – Version 2
   Oben ein Umschalter mit zwei Bereichen:

   KRAFT – Training nach Gruppe: Push (Brust, Trizeps, Schultern), Pull (Rücken, Bizeps), Beine.
     - Jeder Muskel hat sein eigenes Ziel: aktueller Wert + 1 % (Regel-Wert OP.data.GYM_GOAL_PCT).
       Während des Trainings gilt immer OP.game.gymStatus().parts[i].target (kann steigen, wenn der Wert steigt).
     - Sätze werden je Muskel addiert (24 kg × 10 = 240 XP für den gewählten Muskel).
     - Beim Beenden bekommt jeder Muskel, der sein Ziel geschafft hat, seine Summe als neuen Wert.
       Die anderen bleiben gleich (OP.game.finishGym).

   AUSDAUER – zwei Lauf-Timer (Minuten, immer mit 2 Nachkommastellen: "8,59 Min."):
     - "Joggen am Stück" (steady): Start → laufen → Stopp. Geschafft = neuer Wert +1 bis 5 %
       (oder der bessere Lauf). Retention −0,1 % pro Tag, auch ohne Training.
     - "Laufzeit gesamt" (total): Start / Pause (Gehen zählt nicht) / Weiter / Stopp.
       Rekord = Höchstwert, Ziel = Rekord + 1 Minute.
     - Der laufende Timer steht in OP.state.run.active: er überlebt Neuladen und Seitenwechsel.
       Die Anzeige rechnet immer aus OP.game.runStatus().active.elapsedMs.
     - Mehr als 24 Stunden (Timer vergessen): OP.game.runStop trägt nichts ein ({tooLong}), der Timer läuft weiter.
       Die Karte bietet dann nur "Von Hand eintragen" (verwirft den Timer beim Speichern) und "Verwerfen".

   Beine hat nur einen Muskel: keine Muskel-Auswahl und kein doppelter Name ("Summe" statt "Beine").
   Zirkus-Sperre: Die Sperr-Zeile oben zeigt der Rahmen (ui.js). Ohne laufendes Training / laufenden Timer
   steht hier nur statt der Start-Knöpfe "Gesperrt – erst der Zirkus-Tanz".
   Links: #/haus/gym/push | pull | legs (auch ein Muskel, z. B. brust) wählt die Gruppe vor,
          #/haus/gym/ausdauer öffnet die Lauf-Timer (steady / total springt zum Timer). */
(function () {
  'use strict';
  var OP = window.OP;
  if (!OP || !OP.screens) return;
  var U = OP.util, h = OP.h, D = OP.data;

  var NB = ' ';                      // geschütztes Leerzeichen: Zahl und Einheit bleiben zusammen
  var GOAL_PCT = Number(D.GYM_GOAL_PCT) || 1;
  var GOAL_TXT = '+' + U.fmt1(GOAL_PCT).replace(/,0$/, '') + NB + '%';
  var SECTION_KEY = 'op.gym.bereich';     // zuletzt offener Bereich (nur für diese Sitzung)
  var TICK_MS = 250;                      // so oft wird die Timer-Anzeige aufgefrischt
  var LONG_RUN_MIN = 180;                 // länger gelaufen? Beim Stopp nachfragen (Timer vergessen?)
  var MAX_RUN_MIN = 1440;                 // mehr nimmt OP.game.runEnter nicht an (24 Stunden)
  var KG_FMT = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 2 });

  var INFO_STEADY = 'Jeder Erfolg: +1 bis 5 %. Schaffst du mehr, zählt der bessere Wert. ' +
    'Retention: −0,1 % pro Tag – jeden Tag, auch wenn du läufst.';
  var INFO_TOTAL = 'Für alle, die noch nicht lange am Stück laufen können (Kondition, Knie): ' +
    'Lauf ein Stück, drück Pause und geh. Dann lauf weiter. Nur die Laufzeit zählt. Neues Ziel: Rekord + 1 Minute.';

  // "Ziel geschafft"-Meldung während eines Laufs nur einmal pro Timer (auch nach Seitenwechsel)
  var goalNoticed = {};

  /* ---------- kleine Helfer ---------- */

  function icon(name) { return OP.ui.icon(name); }
  function xpText(n) { return U.fmt(n) + NB + 'XP'; }
  function kgText(w) { return KG_FMT.format(Number(w) || 0) + NB + 'kg'; }
  function minText(v) { return U.fmt2(v) + NB + 'Min.'; }
  function pctText(p) { return U.fmt2(p) + NB + '%'; }
  function floor2(v) { return Math.floor(v * 100 + 1e-7) / 100; }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  /** Millisekunden -> "04:27" (ab einer Stunde "1:04:27") */
  function clock(ms) {
    var s = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
    var hh = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60), ss = s % 60;
    return (hh ? hh + ':' + pad2(mm) : pad2(mm)) + ':' + pad2(ss);
  }

  /** Trainingsdauer für den Kopf-Chip: "< 1 min", "12 min", "1 h 5 min" */
  function durationText(started) {
    var min = Math.max(0, Math.floor((Date.now() - (Number(started) || Date.now())) / 60000));
    if (min < 1) return '< 1 min';
    return min < 60 ? min + ' min' : Math.floor(min / 60) + ' h ' + (min % 60) + ' min';
  }

  /** Läuft der Timer länger als 24 Stunden (vergessen)? Dann kann er nicht mehr eingetragen werden. */
  function isStale(a) { return !!a && a.minutes > MAX_RUN_MIN; }

  function muscleXp(id) {
    var m = OP.state && OP.state.muscles && OP.state.muscles[id];
    return m && isFinite(Number(m.xp)) ? Number(m.xp) : 0;
  }

  function isTouch() {
    try { return window.matchMedia('(pointer: coarse)').matches; } catch (e) { return false; }
  }

  /** Methode am Hologramm sicher aufrufen (Handle kann fehlen oder ein Ersatz sein) */
  function safe(handle, fn, arg) {
    if (!handle || typeof handle[fn] !== 'function') return;
    try { handle[fn](arg); } catch (e) { console.error('[gym] holo.' + fn, e); }
  }

  function readSection() {
    try { var v = sessionStorage.getItem(SECTION_KEY); return v === 'kraft' || v === 'ausdauer' ? v : null; } catch (e) { return null; }
  }
  function saveSection(v) {
    try { sessionStorage.setItem(SECTION_KEY, v); } catch (e) { /* egal */ }
  }

  /** Link-Teil nach #/haus/gym/ auswerten -> {section, group, bauch, run} */
  function parseLink(p) {
    var v = p ? String(p).toLowerCase() : '';
    if (!v) return {};
    if (D.group(v)) return { section: 'kraft', group: v };
    if (v === 'bauch') return { section: 'kraft', bauch: true };
    var m = D.muscle(v);
    if (m && m.group) return { section: 'kraft', group: m.group };
    if (v === 'kraft' || v === 'arme') return { section: 'kraft' };
    if (v === 'steady' || v === 'total') return { section: 'ausdauer', run: v };
    if (['ausdauer', 'cardio', 'lauf', 'laufen', 'run', 'timer', 'joggen'].indexOf(v) >= 0) return { section: 'ausdauer' };
    return {};
  }

  /** Letzter Trainingstag je Gruppe (Gym oder Kampf mit Sätzen) -> {push: 'YYYY-MM-DD', ...} */
  function lastGroupDays() {
    var res = {}, log = OP.state && Array.isArray(OP.state.log) ? OP.state.log : [];
    for (var i = log.length - 1; i >= 0; i--) {
      var e = log[i];
      if (!e || !(e.type === 'gym' || e.type === 'fight') || !(e.sets > 0) || !e.day) continue;
      // neue Einträge haben group, alte nur muscle ('arme' war Push und Pull)
      var gs = e.group ? [e.group] : (e.muscle === 'arme' ? ['push', 'pull'] : (D.groupOf(e.muscle) ? [D.groupOf(e.muscle)] : []));
      gs.forEach(function (g) { if (!res[g]) res[g] = e.day; });
      if (res.push && res.pull && res.legs) break;
    }
    return res;
  }

  function agoText(day) {
    if (!day) return 'noch nicht trainiert';
    var n = U.diffDays(day, U.today());
    if (!isFinite(n)) return '';
    if (n <= 0) return 'zuletzt heute';
    if (n === 1) return 'zuletzt gestern';
    return 'zuletzt vor ' + n + ' Tagen';
  }

  /** "Drücken: Brust, …" -> "Drücken" (kurzer Untertitel der Gruppe) */
  function groupVerb(g) { return String(g.hint || '').split(':')[0]; }

  /** Minuten-Eingabe: "8,5" / "8.5" / "8:30" (Minuten:Sekunden) -> Zahl oder NaN */
  function parseMinutes(text) {
    var s = String(text == null ? '' : text).trim();
    var m = /^(\d{1,4}):([0-5]?\d)$/.exec(s);
    if (m) return floor2(Number(m[1]) + Number(m[2]) / 60);
    return U.parseNum(s);
  }

  /* ---------- Hologramm-Körper ---------- */

  /** three.js-Körper im Fokus-Modus (focus = Gruppe 'push' | 'pull' | 'legs'). Fehlt OP.holo: Ersatz mit gleichem API. */
  function createBody(box, focus) {
    if (OP.holo && typeof OP.holo.body === 'function') {
      try {
        var hd = OP.holo.body(box, { mode: 'focus', focus: focus || null, autoRotate: true, interactive: true });
        if (hd) return hd;
      } catch (e) {
        console.error('[gym] Hologramm', e);
        box.innerHTML = '';
      }
    }
    return fallbackBody(box, focus);
  }

  /** Ersatz ohne three.js: Scanner-Ring mit dem Gruppen-Icon */
  function fallbackBody(box, focus) {
    var ico = h('div', { class: 'gym-scan__icon' });
    var label = h('div', { class: 'gym-scan__label' });
    var wrap = h('div', { class: 'gym-scan' }, h('div', { class: 'gym-scan__ring' }, ico), label);
    box.appendChild(wrap);
    function show(id) {
      var g = id ? D.group(id) : null;
      ico.innerHTML = icon(g ? g.icon : 'body');
      label.textContent = g ? g.name : 'Körper-Scan';
      wrap.classList.toggle('is-focus', !!g);
    }
    show(focus);
    return {
      update: function (o) { if (o && Object.prototype.hasOwnProperty.call(o, 'focus')) show(o.focus); },
      pulse: function () { wrap.classList.remove('is-pulse'); void wrap.offsetWidth; wrap.classList.add('is-pulse'); },
      destroy: function () { if (wrap.parentNode) wrap.parentNode.removeChild(wrap); }
    };
  }

  /** Statt eines Start-Knopfs, solange die Zirkus-Sperre gilt (die Sperr-Zeile oben zeigt der Rahmen) */
  function lockedNote() {
    return h('div', { class: 'gym-grp__locked small' }, h('span', { html: icon('lock') }), 'Gesperrt – erst der Zirkus-Tanz');
  }

  /* ---------- Lauf-Ergebnis anzeigen (Timer-Stopp oder Eintrag von Hand) ---------- */

  function showRunResult(res, extra) {
    extra = extra || {};
    if (!res) return;
    if (res.ok === false) { OP.ui.toast(res.error || 'Das hat nicht geklappt.', { type: 'warn' }); return; }
    if (res.cancelled) { OP.ui.toast('Timer gestoppt – unter einer Sekunde, nichts eingetragen.', { type: 'info' }); return; }
    var def = D.run(res.kind) || { name: 'Lauf', icon: 'run' };
    var segs = extra.segments > 1 ? ' (' + extra.segments + ' Etappen)' : '';
    // Feier-Text: eine Aussage pro Zeile (Zeilenumbrüche werden angezeigt)
    if (res.kind === 'steady') {
      if (res.first) {
        OP.ui.celebrate({ kicker: def.name, title: 'Startwert gesetzt', icon: 'run', tone: 'cyan',
          text: 'Dein Wert: ' + minText(res.newTarget) + '\nSchaffst du ihn beim nächsten Lauf, steigt er um 1 bis 5 %.' });
      } else if (res.success) {
        var text;
        if (res.newTarget > res.value + 1e-9) {
          // normale Steigerung: Ziel + 1 bis 5 %
          text = 'Neuer Wert: ' + minText(res.newTarget) + ' (+' + pctText(res.pct) + ')\nGelaufen: ' + minText(res.value);
        } else {
          // länger gelaufen als die Steigerung: der bessere Wert zählt
          var up = res.oldTarget > 0 ? (res.newTarget / res.oldTarget - 1) * 100 : 0;
          text = 'Neuer Wert: ' + minText(res.newTarget) + ' (+' + pctText(up) + ')\nDu bist länger gelaufen als nötig – der bessere Wert zählt.';
        }
        OP.ui.celebrate({ kicker: def.name, title: 'Ziel geschafft!', text: text, icon: 'run', tone: 'ok' });
      } else {
        OP.ui.toast('Ziel ' + minText(res.oldTarget) + ' nicht erreicht (' + minText(res.value) + ') – dein Wert bleibt.',
          { type: 'warn', icon: 'run', ms: 4600 });
      }
      return;
    }
    // Laufzeit gesamt
    if (res.first) {
      OP.ui.celebrate({ kicker: def.name, title: 'Startwert gesetzt', icon: 'timer', tone: 'cyan',
        text: 'Rekord: ' + minText(res.record) + segs + '\nNächstes Ziel: ' + minText(res.newGoal) });
    } else if (res.success) {
      OP.ui.celebrate({ kicker: def.name, title: 'Ziel geschafft!', icon: 'timer', tone: 'ok',
        text: (res.newRecord ? 'Neuer Rekord: ' : 'Gelaufen: ') + minText(res.value) + segs +
          '\nNächstes Ziel: ' + minText(res.newGoal) });
    } else if (res.newRecord) {
      OP.ui.toast('Neuer Rekord: ' + minText(res.record) + ' – das Ziel ' + minText(res.oldGoal) + ' ist noch nicht erreicht, es bleibt.',
        { type: 'gold', icon: 'trophy', ms: 5200 });
    } else {
      OP.ui.toast('Ziel ' + minText(res.oldGoal) + ' nicht erreicht (' + minText(res.value) + ') – dein Ziel bleibt.',
        { type: 'warn', icon: 'timer', ms: 4600 });
    }
  }

  /** Lauf ohne Timer eintragen: Minuten (auch mit Komma oder "8:30") + Sekunden (optional).
      opts.replaceTimer: Ersatz für einen vergessenen Timer (über 24 h) – der wird erst verworfen,
      wenn der Eintrag gespeichert ist (Abbrechen lässt ihn stehen). */
  function manualEntry(kind, opts) {
    opts = opts || {};
    var def = D.run(kind) || { name: 'Lauf' };
    var rs = OP.game.runStatus();
    var goal = kind === 'steady' ? rs.steady.target : rs.total.goal;
    var first = kind === 'steady' ? rs.steady.first : rs.total.first;
    var fm = OP.ui.numField({ label: 'Minuten', suffix: 'Min.', placeholder: 'z. B. 8', enterkeyhint: 'next' });
    var fs = OP.ui.numField({ label: 'Sekunden', suffix: 's', placeholder: '0', integer: true, enterkeyhint: 'done' });
    var preview = h('div', { class: 'gym-manual__preview num' });

    /** Eingabe -> Minuten (2 Nachkommastellen) oder NaN */
    function value() {
      var m = parseMinutes(fm.input.value);
      var sRaw = String(fs.input.value || '').trim(), s = sRaw ? U.parseNum(sRaw) : 0;
      if (!isFinite(m) && sRaw && isFinite(s)) m = 0;   // nur Sekunden eingetragen
      if (!isFinite(m) || m < 0 || !isFinite(s) || s < 0 || s >= 60 || Math.floor(s) !== s) return NaN;
      return floor2(m + s / 60);
    }
    function upd() {
      var v = value();
      if (!(v > 0)) {
        preview.textContent = first ? 'Dein erster Lauf wird dein Startwert.' : 'Ziel: ' + minText(goal);
        preview.className = 'gym-manual__preview num';
        return;
      }
      if (v > MAX_RUN_MIN) {
        preview.textContent = 'Höchstens 24 Stunden (' + U.fmt(MAX_RUN_MIN) + NB + 'Min.).';
        preview.className = 'gym-manual__preview num tone-warn';
        return;
      }
      var ok = first || v >= floor2(goal);
      preview.textContent = '= ' + minText(v) + (first ? ' · Startwert' : (ok ? ' · Ziel geschafft' : ' · Ziel ' + minText(goal) + ' nicht erreicht'));
      preview.className = 'gym-manual__preview num ' + (ok ? 'tone-ok' : 'tone-warn');
    }
    fm.input.addEventListener('input', upd);
    fs.input.addEventListener('input', upd);
    fm.input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); fs.input.focus(); } });
    upd();
    var form = h('form', { class: 'stack', novalidate: true, onsubmit: function (e) { e.preventDefault(); save(); } },
      h('p', { class: 'small muted', text: opts.replaceTimer
        ? 'Der vergessene Timer zählt nicht. Trag deine echte Laufzeit ein, z. B. 8 Minuten 30 Sekunden. Beim Eintragen wird der Timer verworfen.'
        : 'Für Läufe ohne Timer. Trag die reine Laufzeit ein, z. B. 8 Minuten 30 Sekunden.' }),
      h('div', { class: 'gym-manual__row' }, fm.el, fs.el),
      preview);
    var dlg = OP.ui.modal({
      title: def.name, body: form,
      actions: [
        { label: 'Abbrechen', kind: 'ghost' },
        { label: 'Eintragen', kind: 'primary', icon: 'check', onClick: function () { return save(); } }
      ]
    });
    function save() {
      var v = value();
      if (!(v > 0) || v > MAX_RUN_MIN) {
        OP.ui.toast(v > MAX_RUN_MIN ? 'Höchstens 24 Stunden (' + U.fmt(MAX_RUN_MIN) + NB + 'Minuten) pro Lauf.'
          : 'Bitte eine Zeit größer 0 eingeben (Sekunden: 0 bis 59).', { type: 'warn' });
        fm.input.focus();
        return false;   // Dialog bleibt offen
      }
      dlg.close();
      var go = function () {
        var res = OP.game.runEnter(kind, floor2(v));
        if (res && res.ok && opts.replaceTimer) {
          // erst jetzt den vergessenen Timer verwerfen (nur, wenn er noch da ist)
          var a = OP.game.runStatus().active;
          if (a && a.kind === kind && isStale(a)) OP.game.runCancel();
        }
        showRunResult(res);
      };
      if (v > LONG_RUN_MIN) {   // Tippfehler abfangen (z. B. 850 statt 8,50)
        OP.ui.confirm(minText(floor2(v)) + ' sind sehr viel. Stimmt die Zahl?', { title: 'Große Zahl', okLabel: 'Ja, eintragen', cancelLabel: 'Korrigieren' })
          .then(function (ok) { if (ok) go(); });
      } else go();
      return undefined;
    }
  }

  /* ================= Bildschirm ================= */

  OP.screens.register('haus/gym', {
    title: 'Gym', icon: 'gym',
    mount: function (el, params) {
      var bag = OP.ui.cleanup();
      var link = parseLink(params && params[0]);
      var section = initialSection();
      var view = null;       // {root, refresh(), tick(rs), after()}
      var viewKey = null;
      var viewBag = null;    // Aufräumen der aktuellen Ansicht (Hologramm, Zeitgeber)

      function initialSection() {
        if (link.section) return link.section;
        var s = OP.state, gymOn = !!(s && s.gym), runOn = !!(s && s.run && s.run.active);
        if (runOn && !gymOn) return 'ausdauer';
        if (gymOn && !runOn) return 'kraft';
        return readSection() || 'kraft';
      }

      /* ---------- Umschalter Kraft | Ausdauer ---------- */
      var segBtns = {};
      function segBtn(id, ico, label, sub) {
        var b = h('button', {
          class: 'seg__btn gym-seg__btn', type: 'button', role: 'tab', dataset: { s: id },
          onclick: function () { setSection(id); }
        },
          h('span', { class: 'gym-seg__ico', html: icon(ico) }),
          h('span', { class: 'gym-seg__txt' }, h('b', { text: label }), h('small', { text: sub })),
          h('span', { class: 'gym-seg__dot', 'aria-hidden': 'true' }));
        segBtns[id] = b;
        return b;
      }
      var seg = h('div', { class: 'seg gym-seg', role: 'tablist', 'aria-label': 'Bereich' },
        segBtn('kraft', 'gym', 'Kraft', 'Push · Pull · Beine'),
        segBtn('ausdauer', 'run', 'Ausdauer', 'Lauf-Timer'));
      var box = h('div', { class: 'gym-section' });
      el.appendChild(h('div', { class: 'screen__inner gym' }, seg, box));

      function markSeg() {
        var s = OP.state, rs = OP.game.runStatus();
        Object.keys(segBtns).forEach(function (id) {
          var b = segBtns[id], on = id === section;
          b.classList.toggle('is-on', on);
          b.setAttribute('aria-selected', on ? 'true' : 'false');
        });
        // Punkt = hier läuft gerade etwas (Training / Timer); gelb = Pause oder Timer vergessen (über 24 h)
        segBtns.kraft.classList.toggle('is-live', !!s.gym);
        segBtns.ausdauer.classList.toggle('is-live', !!rs.active);
        segBtns.ausdauer.classList.toggle('is-paused', !!(rs.active && (!rs.active.running || isStale(rs.active))));
      }

      function setSection(id) {
        if (id === section) return;
        section = id;
        saveSection(id);
        render();
        el.scrollTop = 0;
      }

      /** Welche Ansicht gehört gerade auf den Schirm? Ändert er sich, wird neu aufgebaut. */
      function keyNow() {
        var s = OP.state;
        if (section === 'kraft') return s.gym ? 'k:session:' + s.gym.group + ':' + s.gym.started : 'k:pick:' + OP.game.lockInfo().locked;
        return 'a';   // Ausdauer frischt sich selbst auf (Karten bauen ihre Knöpfe je nach Zustand neu)
      }

      /** Kurzer Fingerabdruck des Zustands: Ansicht, Training, Timer (läuft / Pause / über 24 h), Sperre */
      function stateSig() {
        var rs = OP.game.runStatus(), a = rs.active;
        return keyNow() + '|' + (OP.state.gym ? 'g' : '-') + '|' +
          (a ? a.kind + (a.running ? ':r' : ':p') + (isStale(a) ? ':alt' : '') : '-') + '|' + OP.game.lockInfo().locked;
      }
      var shownSig = null;

      /** Alles auf den aktuellen Stand bringen (nach 'change' – oder wenn sich etwas ohne Event geändert hat) */
      function sync() {
        if (keyNow() !== viewKey) render();
        else if (view && view.refresh) view.refresh();
        markSeg();
        updateHeadChip();
        shownSig = stateSig();
      }

      function render() {
        if (viewBag) viewBag.run();
        viewBag = OP.ui.cleanup();
        box.innerHTML = '';
        viewKey = keyNow();
        if (section === 'kraft') view = OP.state.gym ? buildSession(viewBag) : buildPick(viewBag);
        else view = buildRuns(viewBag);
        box.appendChild(view.root);
        if (view.after) view.after();
        markSeg();
        updateHeadChip();
        shownSig = stateSig();
      }

      /* ---------- Kopf-Chip: laufender Timer (live) oder Trainingsdauer ---------- */
      var chipIco = h('span', { class: 'gym-chip__ico' });
      var chipTxt = h('span', { class: 'gym-chip__txt num' });
      var chip = h('button', { class: 'chip chip--btn gym-chip', type: 'button', onclick: onChip }, chipIco, chipTxt);
      var chipIcoName = null, chipOn = false;

      function updateHeadChip(rs) {
        rs = rs || OP.game.runStatus();
        var a = rs.active, g = OP.state.gym, mode = null, ico = '', text = '', label = '';
        if (a) {
          var name = D.run(a.kind) ? D.run(a.kind).name : 'Timer';
          text = clock(a.elapsedMs);
          if (isStale(a)) {   // vergessen: gelb mit Warnzeichen
            mode = 'pause'; ico = 'warning';
            label = name + ' läuft seit über 24 Stunden – vergessen? ' + text;
          } else {
            mode = a.running ? 'run' : 'pause';
            ico = a.running ? (a.kind === 'steady' ? 'run' : 'timer') : 'pause';
            label = name + (a.running ? ' läuft: ' : ' pausiert: ') + text;
          }
        } else if (g) {
          mode = 'gym'; ico = 'timer'; text = durationText(g.started);
          label = 'Training läuft seit ' + text;
        }
        if (!mode) {
          if (chipOn) { OP.ui.setHeadExtra(null); chipOn = false; }
          return;
        }
        if (chipIcoName !== ico) { chipIco.innerHTML = icon(ico); chipIcoName = ico; }
        if (chipTxt.textContent !== text) chipTxt.textContent = text;
        var cls = 'chip chip--btn gym-chip gym-chip--' + mode;
        if (chip.className !== cls) chip.className = cls;
        chip.setAttribute('aria-label', label);
        chip.title = label;
        if (!chipOn || !chip.isConnected) { OP.ui.setHeadExtra(chip); chipOn = true; }
      }

      function onChip() {
        var rs = OP.game.runStatus();
        if (rs.active) {
          link.run = rs.active.kind;
          if (section !== 'ausdauer') setSection('ausdauer');
          else if (view && view.reveal) view.reveal(rs.active.kind);
        } else if (OP.state.gym) setSection('kraft');
      }

      /* ======================= KRAFT: Gruppe wählen ======================= */
      function buildPick(vb) {
        var locked = OP.game.lockInfo().locked;
        var selected = link.group || (link.bauch ? 'bauch' : null);
        var body = null;
        var holoBox = h('div', { class: 'gym-holo' });
        var cards = h('div', { class: 'gym-grps' });

        function focusBody(id) { safe(body, 'update', { focus: id && D.group(id) ? id : null }); }

        function select(id) {
          selected = id;
          cards.querySelectorAll('.gym-grp').forEach(function (c) { c.classList.toggle('is-selected', c.dataset.g === id); });
          focusBody(id);
        }

        function start(gid) {
          var res = OP.game.startGym(gid);
          if (!res || !res.ok) {
            OP.ui.toast((res && res.error) || 'Training konnte nicht starten.', { type: 'warn' });
            return;
          }
          link = {};   // Vorauswahl ist verbraucht
          OP.ui.haptic(20);
          // Das 'change'-Event baut die Trainings-Ansicht auf.
        }

        /** Zeile je Muskel. Gruppe mit nur einem Muskel (Beine): "Dein Wert" statt den Namen zu wiederholen. */
        function muscleRow(id, single) {
          var m = D.muscle(id), xp = muscleXp(id), r = OP.game.rankFor(id);
          return h('li', { class: 'gym-mrow' },
            h('span', { class: 'gym-mrow__icon', html: icon(m.icon) }),
            h('div', { class: 'gym-mrow__main' },
              h('span', { class: 'gym-mrow__name', text: single ? 'Dein Wert' : m.name }),
              OP.ui.rankBadge(r.rank, { small: true })),
            h('div', { class: 'gym-mrow__vals' },
              h('span', { class: 'gym-mrow__xp num', text: xpText(xp) }),
              h('span', { class: 'gym-mrow__goal num', text: 'Ziel ' + U.fmt(OP.game.gymTarget(xp)) })));
        }

        function groupCard(g, lastDay) {
          var single = g.muscles.length === 1;
          var foot = locked ? lockedNote()
            : h('button', { class: 'btn btn--primary btn--block', type: 'button', onclick: function () { start(g.id); } },
                h('span', { html: icon('play') }), 'Training beginnen');
          return h('article', {
            class: 'gym-grp card' + (selected === g.id ? ' is-selected' : ''), dataset: { g: g.id },
            style: { '--grp': g.color },
            // Zeigen / Antippen lässt die Gruppe im Hologramm leuchten
            onmouseenter: function () { focusBody(g.id); },
            onmouseleave: function () { focusBody(selected); },
            onfocusin: function () { focusBody(g.id); },
            onclick: function (e) { if (!e.target.closest('button')) select(g.id); }
          },
            h('div', { class: 'gym-grp__head' },
              h('span', { class: 'gym-grp__icon', html: icon(g.icon) }),
              h('div', { class: 'gym-grp__name' },
                h('h3', { text: g.name }),
                h('div', { class: 'tiny faint', text: groupVerb(g) + ' · ' + agoText(lastDay) })),
              h('span', { class: 'chip chip--muted gym-grp__goal', text: (single ? '' : 'je ') + GOAL_TXT })),
            h('ul', { class: 'gym-mlist' }, g.muscles.map(function (id) { return muscleRow(id, single); })),
            foot);
        }

        // Bauch ist keine Gym-Gruppe, sondern eine Challenge in der Taverne
        function bauchCard() {
          var ar = OP.game.absRank();
          var best = OP.state.abs && OP.state.abs.plank ? Math.round(Number(OP.state.abs.plank.best) || 0) : 0;
          return h('article', {
            class: 'gym-grp gym-grp--bauch card card--gold' + (selected === 'bauch' ? ' is-selected' : ''), dataset: { g: 'bauch' },
            onmouseenter: function () { focusBody(null); }
          },
            h('div', { class: 'gym-grp__head' },
              h('span', { class: 'gym-grp__icon', html: icon('bauch') }),
              h('div', { class: 'gym-grp__name' },
                h('h3', { text: 'Bauch' }),
                h('div', { class: 'tiny faint', text: 'Challenge statt Gym' })),
              OP.ui.rankBadge(ar.rank, { small: true })),
            h('p', { class: 'small muted gym-grp__text',
              text: 'Den Bauch trainierst du bei den Zirkus-Tänzen in der Taverne: Plank, seitliche Planks, Crunches und Sit-ups in einem Tanz.' }),
            best ? h('div', { class: 'gym-grp__stat small' }, 'Beste Plank: ', h('b', { class: 'num', text: best + NB + 's' })) : null,
            h('button', { class: 'btn btn--gold btn--block', type: 'button', onclick: function () { OP.ui.go('taverne/zirkus'); } },
              h('span', { html: icon('zirkus') }), 'Zu den Zirkus-Tänzen'));
        }

        function fillCards() {
          cards.innerHTML = '';
          var last = lastGroupDays();
          D.GROUPS.forEach(function (g) { cards.appendChild(groupCard(g, last[g.id])); });
          cards.appendChild(bauchCard());
        }
        fillCards();

        var hero = h('section', { class: 'gym-hero card card--plain' },
          holoBox,
          h('div', { class: 'gym-hero__text' },
            h('div', { class: 'gym-kicker', text: 'Kraft · ' + GOAL_TXT + ' je Muskel' }),
            h('h2', { class: 'gym-hero__title', text: 'Was trainierst du heute?' }),
            h('p', { class: 'small muted', text: 'Jeder Muskel hat sein eigenes Ziel (' + GOAL_TXT +
              '). Schafft er es, wird seine Summe sein neuer Wert – sonst bleibt er gleich.' })),
          h('ol', { class: 'gym-steps' },
            h('li', {}, h('b', { text: '1' }), 'Gruppe wählen'),
            h('li', {}, h('b', { text: '2' }), 'Sätze je Muskel'),
            h('li', {}, h('b', { text: '3' }), 'Ziele knacken')));

        // Sperre: die Sperr-Zeile oben zeigt der Rahmen; statt der Start-Knöpfe steht in den Karten "Gesperrt"
        var root = h('div', { class: 'gym-pick' }, hero, h('div', { class: 'gym-pick__main' }, cards));

        return {
          root: root,
          refresh: fillCards,
          after: function () {
            body = createBody(holoBox, selected && D.group(selected) ? selected : null);
            vb.add(function () { safe(body, 'destroy'); body = null; });
            if (selected) {
              var c = cards.querySelector('[data-g="' + selected + '"]');
              if (c && c.scrollIntoView) {
                requestAnimationFrame(function () {
                  try { c.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) { /* alter Browser */ }
                });
              }
            }
          }
        };
      }

      /* ======================= KRAFT: Training läuft ======================= */
      function buildSession(vb) {
        var st0 = OP.game.gymStatus();
        var g = st0.group;
        var body = null, alive = true;
        vb.add(function () { alive = false; });
        var muscles = g.muscles.map(function (id) { var m = D.muscle(id); return { id: id, name: m.name, icon: m.icon }; });
        var single = muscles.length === 1;   // Beine: nur ein Muskel

        function firstOpen(st, afterId) {
          var ids = st.parts.map(function (p) { return p.id; });
          var start = afterId ? ids.indexOf(afterId) + 1 : 0;
          for (var k = 0; k < ids.length; k++) {
            var p = st.parts[(start + k) % ids.length];
            if (!p.reached) return p.id;
          }
          return null;
        }

        var holoBox = h('div', { class: 'gym-holo gym-holo--live' });
        var countChip = h('span', { class: 'chip gym-live__count' });
        var hintEl = h('p', { class: 'gym-live__hint small' });
        var listBox = h('div', { class: 'gym-sets__list' });
        var setsChip = h('span', { class: 'chip chip--muted', text: '0 Sätze' });
        var actions = h('div', { class: 'gym-actions' });

        // Eine Zeile je Muskel: Summe / Ziel mit Balken. Antippen = nächster Satz für diesen Muskel.
        // Beine (nur ein Muskel): nichts zu wählen – die Zeile heißt "Summe", der Name steht schon im Kopf.
        var rows = {};
        var partsList = h('ul', { class: 'gym-parts' }, muscles.map(function (m) {
          var val = h('span', { class: 'gym-part__val num' });
          var bar = OP.ui.progress(0, { thin: true });
          var goal = h('span', { class: 'gym-part__goal num' });
          var left = h('span', { class: 'gym-part__left num' });
          var btn = h(single ? 'div' : 'button', {
            class: 'gym-part', type: single ? null : 'button', dataset: { m: m.id },
            'aria-label': single ? null : m.name + ' für den nächsten Satz wählen',
            onclick: single ? null : function () { choose(m.id, true); }
          },
            h('span', { class: 'gym-part__head' },
              h('span', { class: 'gym-part__icon', html: icon(m.icon) }),
              h('span', { class: 'gym-part__name', text: single ? 'Summe' : m.name }),
              h('span', { class: 'gym-part__check', html: icon('check') }),
              val),
            bar,
            h('span', { class: 'gym-part__foot' }, goal, left));
          rows[m.id] = { btn: btn, val: val, bar: bar, goal: goal, left: left };
          return h('li', {}, btn);
        }));

        var entry = OP.ui.setEntry({
          muscles: muscles, selected: firstOpen(st0) || muscles[0].id,
          onSelect: function (id) { mark(id); },
          onAdd: addSet, addLabel: 'Satz eintragen', unitLabel: 'XP'
        });

        var live = h('section', { class: 'gym-live card card--glow', style: { '--grp': g.color } },
          h('div', { class: 'gym-live__head' },
            h('span', { class: 'gym-grp__icon', html: icon(g.icon) }),
            h('div', { class: 'gym-live__name' },
              h('div', { class: 'gym-kicker', text: 'Training läuft' }),
              h('h2', { class: 'gym-live__title', text: g.name })),
            countChip),
          h('div', { class: 'gym-live__grid' },
            holoBox,
            h('div', { class: 'gym-live__parts' }, partsList, hintEl)));

        var setsSec = h('section', { class: 'gym-sets' }, OP.ui.sectionTitle('Deine Sätze', 'gym', setsChip), listBox);
        var root = h('div', { class: 'gym-session' + (single ? ' gym-session--single' : '') },
          h('div', { class: 'gym-session__a' }, live),
          h('div', { class: 'gym-session__b' }, entry.el, setsSec, actions));

        /** Muskel-Zeile hervorheben (= Ziel des nächsten Satzes) */
        function mark(id) {
          if (single) return;   // nur ein Muskel: nichts zu wählen
          Object.keys(rows).forEach(function (k) {
            rows[k].btn.classList.toggle('is-selected', k === id);
            rows[k].btn.setAttribute('aria-pressed', k === id ? 'true' : 'false');
          });
        }
        /** Muskel für den nächsten Satz wählen (Zeile angetippt oder automatisch) */
        function choose(id, byUser) {
          entry.select(id);
          mark(id);
          if (!byUser) return;
          safe(body, 'pulse', id);
          if (!isTouch()) entry.focus();
          else if (entry.el.scrollIntoView) {
            try { entry.el.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch (e) { /* alt */ }
          }
        }

        function addSet(mid, w, r) {
          var res = OP.game.addGymSet(mid, w, r);
          if (!res || !res.ok) return res || { ok: false, error: 'Satz konnte nicht gespeichert werden.' };
          floatGain(mid, res.xp);
          safe(body, 'pulse', mid);
          if (res.justReachedAll) {
            OP.ui.toast(res.status.parts.length > 1 ? 'Alle Ziele erreicht! Beende das Training, damit es zählt.' : 'Ziel erreicht! Beende das Training, damit es zählt.',
              { type: 'ok', icon: 'trophy', ms: 3600 });
            OP.ui.haptic([20, 40, 60]);
            flash();
          } else if (res.justReached) {
            OP.ui.toast(res.muscle.name + ': Ziel erreicht! Jeder weitere Satz zählt mit.', { type: 'ok', icon: 'check' });
            OP.ui.haptic([20, 40, 30]);
            flash();
            // nächsten offenen Muskel vorwählen – erst nach dem Speichern des Satzes (setEntry merkt sich das Gewicht je Muskel)
            var next = firstOpen(res.status, mid);
            if (next) setTimeout(function () { if (alive) choose(next, false); }, 0);
          }
          return res;
        }

        function flash() { live.classList.remove('is-flash'); void live.offsetWidth; live.classList.add('is-flash'); }

        // kleine "+240 XP"-Animation an der Muskel-Zeile
        function floatGain(mid, xp) {
          var row = rows[mid];
          if (!row) return;
          var f = h('span', { class: 'gym-float num', text: '+' + xpText(xp) });
          row.btn.appendChild(f);
          setTimeout(function () { if (f.parentNode) f.parentNode.removeChild(f); }, 1100);
        }

        function removeSet(i) {
          var gym = OP.state.gym;
          if (!gym || !gym.sets || !gym.sets[i]) return;
          var s = gym.sets[i], m = single ? null : D.muscle(s.m);
          OP.ui.confirm('Satz ' + (i + 1) + ' löschen? ' + (m ? m.name + ': ' : '') + kgText(s.w) + ' × ' + s.r + ' = ' + xpText(s.dmg),
            { title: 'Satz löschen', okLabel: 'Löschen', danger: true }).then(function (ok) {
            if (!ok || !OP.state.gym) return;
            var idx = OP.state.gym.sets.indexOf(s);   // Index kann sich inzwischen verschoben haben
            if (idx >= 0) OP.game.removeGymSet(idx);
          });
        }

        function cancel() {
          if (!OP.game.cancelGym()) {
            OP.ui.toast('Es gibt schon Sätze. Beende das Training stattdessen.', { type: 'warn' });
            return;
          }
          OP.ui.toast('Training abgebrochen. Nichts hat sich geändert.', { type: 'info' });
        }

        function finish() {
          var st = OP.game.gymStatus();
          if (!st) return;
          if (!st.gym.sets.length) { cancel(); return; }
          if (st.reached) { showResult(OP.game.finishGym()); return; }
          var text;
          if (!st.anyReached) {
            text = single ? 'Ziel nicht erreicht. Dein Wert bleibt gleich. Trotzdem beenden?'
              : 'Kein Ziel erreicht. Alle Werte bleiben gleich. Trotzdem beenden?';
          } else {
            var open = st.parts.filter(function (p) { return !p.reached; }).map(function (p) {
              return p.muscle.name + ' (noch ' + xpText(Math.ceil(p.left)) + ')';
            });
            text = 'Noch offen: ' + open.join(', ') + '. ' + (open.length === 1 ? 'Dieser Wert bleibt' : 'Diese Werte bleiben') + ' gleich. Jetzt beenden?';
          }
          OP.ui.confirm(text, { title: 'Training beenden?', okLabel: 'Beenden', cancelLabel: 'Weiter trainieren' }).then(function (ok) {
            if (!ok || !OP.state.gym) return;
            showResult(OP.game.finishGym());
          });
        }

        /** Ergebnis: Feier mit einer Zeile je Muskel ("Brust 2.000 → 2.021 XP ✓"; Beine: "Dein Wert: 3.100 → 3.131 XP ✓") */
        function showResult(res) {
          if (!res || !res.ok) { OP.ui.toast((res && res.error) || 'Beenden hat nicht geklappt.', { type: 'err' }); return; }
          if (res.cancelled) { OP.ui.toast('Training abgebrochen. Nichts hat sich geändert.', { type: 'info' }); return; }
          var parts = res.parts || [];
          var one = parts.length === 1;
          var won = parts.filter(function (p) { return p.reached; });
          if (!won.length) {
            OP.ui.toast(one ? 'Training beendet. Ziel nicht erreicht – dein Wert bleibt gleich.'
              : 'Training beendet. Kein Ziel erreicht – deine Werte bleiben gleich.', { type: 'info', ms: 4200 });
            return;
          }
          var lines = parts.map(function (p) {
            if (!p.reached) return p.name + ': Ziel nicht erreicht – bleibt ' + xpText(p.oldXp);
            var line = (one ? 'Dein Wert: ' : p.name + ' ') + U.fmt(p.oldXp) + ' → ' + xpText(p.newXp) + ' ✓';
            var r0 = OP.game.rankFor(p.id, p.oldXp), r1 = OP.game.rankFor(p.id, p.newXp);
            if (r1.index > r0.index) line += ' · Rang ' + r1.rank.name + '!';
            return line;
          });
          var title = res.won ? (parts.length > 1 ? 'Alle Ziele geschafft!' : 'Ziel geschafft!')
            : won.length + ' von ' + parts.length + ' Zielen geschafft';
          OP.ui.celebrate({
            kicker: 'Gym · ' + (res.group ? res.group.name : g.name),
            title: title, text: lines.join('\n'),
            icon: res.won ? 'trophy' : 'gym', tone: res.won ? 'ok' : 'cyan'
          });
        }

        function fillActions(st) {
          actions.innerHTML = '';
          if (!st.gym.sets.length) {
            actions.appendChild(h('button', { class: 'btn btn--ghost btn--block', type: 'button', onclick: cancel },
              h('span', { html: icon('close') }), 'Abbrechen'));
            actions.appendChild(h('p', { class: 'tiny faint center', text: 'Ohne Satz kannst du einfach abbrechen. Es ändert sich nichts.' }));
            return;
          }
          var cls = st.reached ? 'btn--ok' : (st.anyReached ? 'btn--primary' : 'btn--ghost');
          actions.appendChild(h('button', { class: 'btn btn--lg btn--block ' + cls, type: 'button', onclick: finish },
            h('span', { html: icon(st.reached ? 'check' : 'stop') }), 'Training beenden'));
        }

        // Nur Anzeige-Teile auffrischen – das Eingabe-Formular bleibt stehen (flüssiges Tippen)
        function refresh() {
          var st = OP.game.gymStatus();
          if (!st) return;
          st.parts.forEach(function (p) {
            var row = rows[p.id];
            if (!row) return;
            // Summen sind ganze Zahlen; nie "2.020 / 2.020" zeigen, solange es nicht reicht
            row.val.textContent = U.fmt(p.reached ? p.total : Math.min(Math.floor(p.total), p.target - 1));
            row.goal.textContent = 'Ziel ' + xpText(p.target);
            var over = p.total - p.target;
            row.left.textContent = p.reached ? (over >= 0.5 ? '+' + xpText(over) + ' drüber' : 'geschafft') : 'noch ' + xpText(Math.ceil(p.left));
            OP.ui.setProgress(row.bar, p.progress * 100, null, p.reached ? 'ok' : '');
            row.btn.classList.toggle('is-reached', p.reached);
          });
          countChip.textContent = st.reachedCount + '/' + st.parts.length + (st.parts.length === 1 ? ' Ziel' : ' Ziele');
          countChip.className = 'chip gym-live__count' + (st.reached ? ' chip--ok' : (st.anyReached ? ' is-some' : ''));
          live.classList.toggle('is-reached', st.reached);

          var n = st.gym.sets.length;
          if (st.reached) {
            hintEl.textContent = st.parts.length > 1 ? 'Alle Ziele erreicht! Beende das Training, damit es zählt.' : 'Ziel erreicht! Beende das Training, damit es zählt.';
          } else if (st.anyReached) {
            var ok = st.parts.filter(function (p) { return p.reached; }).map(function (p) { return p.muscle.name; });
            hintEl.textContent = 'Beim Beenden bekommt ' + ok.join(' und ') + ' die Summe als neuen Wert. Der Rest bleibt gleich.';
          } else if (n) {
            hintEl.textContent = single ? 'Noch nicht geschafft. Beendest du jetzt, bleibt dein Wert gleich.'
              : 'Noch kein Ziel erreicht. Beendest du jetzt, bleiben alle Werte gleich.';
          } else {
            hintEl.textContent = single ? 'Satz eintragen: Gewicht × Wiederholungen = XP.'
              : 'Muskel wählen, Satz eintragen: Gewicht × Wiederholungen = XP für diesen Muskel.';
          }
          hintEl.classList.toggle('tone-ok', st.reached);
          // Haken in der Muskel-Auswahl: dieser Muskel hat sein Ziel schon (weitere Sätze zählen trotzdem)
          if (entry.markDone) entry.markDone(st.parts.filter(function (p) { return p.reached; }).map(function (p) { return p.id; }));

          listBox.innerHTML = '';
          // Beine: kein Muskel-Etikett an jedem Satz (es gibt nur den einen)
          var sets = single ? st.gym.sets.map(function (s) { return { w: s.w, r: s.r, dmg: s.dmg }; }) : st.gym.sets;
          listBox.appendChild(OP.ui.setList(sets, { onRemove: removeSet, unitLabel: 'XP', emptyText: 'Noch keine Sätze. Leg los!' }));
          setsChip.textContent = n + (n === 1 ? ' Satz' : ' Sätze');
          fillActions(st);
        }
        refresh();
        mark(entry.selected());

        return {
          root: root,
          refresh: refresh,
          after: function () {
            body = createBody(holoBox, g.id);
            vb.add(function () { safe(body, 'destroy'); body = null; });
          }
        };
      }

      /* ======================= AUSDAUER: zwei Lauf-Timer ======================= */
      function buildRuns(vb) {
        var cards = { steady: runCard('steady'), total: runCard('total') };

        // Sperre: die Sperr-Zeile oben zeigt der Rahmen; die Karten zeigen statt "Start" den Sperr-Hinweis
        var root = h('div', { class: 'gym-runs' },
          h('div', { class: 'gym-runs__intro' },
            h('span', { class: 'gym-runs__icon', html: icon('run') }),
            h('div', {},
              h('div', { class: 'gym-kicker', text: 'Ausdauer · Lauf-Timer' }),
              h('p', { class: 'small muted', text: 'Immer nur ein Timer zur Zeit. Er läuft weiter, auch wenn du die App schließt.' }))),
          h('div', { class: 'gym-runs__grid' }, cards.steady.el, cards.total.el));

        function refresh() {
          var rs = OP.game.runStatus();
          cards.steady.refresh(rs);
          cards.total.refresh(rs);
        }
        function reveal(kind) {
          var c = cards[kind];
          if (!c || !c.el.scrollIntoView) return;
          try { c.el.scrollIntoView({ block: 'start', behavior: 'smooth' }); } catch (e) { /* alt */ }
        }
        refresh();

        return {
          root: root, refresh: refresh, reveal: reveal,
          tick: function (rs) { cards.steady.tick(rs); cards.total.tick(rs); },
          after: function () {
            // laufenden (oder verlinkten) Timer sichtbar machen
            var rs = OP.game.runStatus();
            var want = rs.active ? rs.active.kind : link.run;
            if (want === 'total' || (want === 'steady' && link.run === 'steady')) requestAnimationFrame(function () { reveal(want); });
          }
        };

        /** Eine Timer-Karte (steady | total). Baut Knöpfe nur neu, wenn sich der Zustand ändert. */
        function runCard(kind) {
          var def = D.run(kind) || { name: kind, icon: 'run', hint: '' };
          var steady = kind === 'steady';
          var stateChip = h('span', { class: 'chip gym-run__state' });
          var statsBox = h('div', { class: 'gym-run__stats' });
          var clockEl = h('div', { class: 'gym-timer__clock num', text: '00:00' });
          var minEl = h('div', { class: 'gym-timer__min num' });
          var bar = OP.ui.progress(0, { label: ' ' });
          var subEl = h('div', { class: 'gym-timer__sub small' });
          var timerEl = h('div', { class: 'gym-timer', 'aria-live': 'off' }, clockEl, minEl, bar, subEl);
          var controls = h('div', { class: 'gym-run__controls' });
          var card = h('section', { class: 'gym-run card', dataset: { kind: kind } },
            h('div', { class: 'gym-run__head' },
              h('span', { class: 'gym-run__icon', html: icon(def.icon) }),
              h('div', { class: 'gym-run__name' }, h('h3', { text: def.name }), h('p', { class: 'tiny faint', text: def.hint })),
              stateChip),
            statsBox, timerEl, controls,
            h('p', { class: 'gym-run__info' }, h('span', { html: icon('info') }), h('span', { text: steady ? INFO_STEADY : INFO_TOTAL })));
          var modeShown = null, statsShown = null;

          function goalOf(rs) { return steady ? rs.steady.target : rs.total.goal; }
          function isFirst(rs) { return steady ? rs.steady.first : rs.total.first; }
          function mine(rs) { return rs.active && rs.active.kind === kind ? rs.active : null; }

          function modeOf(rs) {
            var a = rs.active;
            if (a && a.kind === kind) {
              // vergessen (über 24 h): nicht mehr eintragbar. Von Hand eintragen geht nur ohne Zirkus-Sperre.
              if (isStale(a)) return OP.game.lockInfo().locked ? 'stale-locked' : 'stale';
              return a.running ? 'running' : 'paused';
            }
            if (a) return 'other';
            return OP.game.lockInfo().locked ? 'locked' : 'idle';
          }

          function tile(label, value, cls) {
            return h('div', { class: 'gym-run__stat' + (cls ? ' ' + cls : '') },
              h('span', { class: 'gym-run__stat-label', text: label }),
              h('b', { class: 'gym-run__stat-val num', text: value }));
          }

          function fillStats(rs) {
            var r = steady ? rs.steady : rs.total;
            var key = JSON.stringify(r);
            if (key === statsShown) return;
            statsShown = key;
            statsBox.innerHTML = '';
            if (isFirst(rs)) {
              statsBox.appendChild(h('div', { class: 'gym-run__first' },
                h('span', { html: icon('flag') }),
                h('span', { text: 'Noch kein Wert – dein erster Lauf ist dein Startwert.' })));
              return;
            }
            var grid = h('div', { class: 'gym-run__tiles' });
            if (steady) {
              grid.appendChild(tile('Dein Wert', minText(r.target), 'is-main'));
              grid.appendChild(tile('Bestwert', r.best > 0 ? minText(r.best) : '–'));
              grid.appendChild(tile('Erfolge', U.fmt(r.wins)));
            } else {
              grid.appendChild(tile('Rekord', r.record > 0 ? minText(r.record) : '–'));
              grid.appendChild(tile('Ziel', minText(r.goal), 'is-main'));
              grid.appendChild(tile('Erfolge', U.fmt(r.wins)));
            }
            statsBox.appendChild(grid);
          }

          function btn(cls, ico, label, fn, extra) {
            return h('button', Object.assign({ class: 'btn ' + cls, type: 'button', onclick: fn }, extra || {}),
              h('span', { html: icon(ico) }), label);
          }

          function fillControls(mode, rs) {
            controls.innerHTML = '';
            var small = h('div', { class: 'gym-run__small' });
            if (mode === 'idle') {
              controls.appendChild(btn('btn--primary btn--lg btn--block', 'play', 'Start', function () { startRun(); }));
              small.appendChild(btn('btn--ghost btn--sm', 'edit', 'Von Hand eintragen', function () { manualEntry(kind); }));
            } else if (mode === 'running' && steady) {
              controls.appendChild(btn('btn--primary btn--lg btn--block gym-run__stop', 'stop', 'Stopp & eintragen', stop));
              small.appendChild(btn('btn--ghost btn--sm', 'close', 'Verwerfen', discard));
            } else if (mode === 'running') {
              // Pause ist die Hauptaktion unterwegs; Stopp bewusst schlichter (nicht aus Versehen beenden)
              controls.appendChild(h('div', { class: 'gym-run__pair' },
                btn('btn--gold btn--lg gym-run__pause', 'pause', 'Pause', pause),
                btn('btn--ghost btn--lg gym-run__stop', 'stop', 'Stopp', stop)));
              small.appendChild(h('span', { class: 'tiny faint', text: 'Gehen? Drück Pause – die Gehzeit zählt nicht.' }));
              small.appendChild(btn('btn--ghost btn--sm', 'close', 'Verwerfen', discard));
            } else if (mode === 'paused') {
              controls.appendChild(h('div', { class: 'gym-run__pair' },
                btn('btn--primary btn--lg gym-run__resume', 'play', 'Weiter', resume),
                btn('btn--ghost btn--lg gym-run__stop', 'stop', 'Stopp', stop)));
              small.appendChild(btn('btn--ghost btn--sm', 'close', 'Verwerfen', discard));
            } else if (mode === 'stale') {
              // Timer vergessen (über 24 h): kein "Eintragen" – die echte Zeit von Hand eintragen oder verwerfen
              controls.appendChild(btn('btn--primary btn--lg btn--block gym-run__manual', 'edit', 'Von Hand eintragen',
                function () { manualEntry(kind, { replaceTimer: true }); }));
              small.appendChild(btn('btn--ghost btn--sm gym-run__drop', 'close', 'Timer verwerfen', dropTimer));
            } else if (mode === 'stale-locked') {
              // …und gesperrt: von Hand eintragen geht erst nach dem Zirkus-Tanz
              controls.appendChild(btn('btn--primary btn--lg btn--block gym-run__drop', 'close', 'Timer verwerfen', dropTimer));
              small.appendChild(h('span', { class: 'tiny faint', text: 'Von Hand eintragen kannst du nach deinem Zirkus-Tanz.' }));
            } else if (mode === 'other') {
              var otherKind = rs.active.kind, other = D.run(otherKind);
              controls.appendChild(btn('btn--primary btn--lg btn--block', 'play', 'Start', function () {}, { disabled: true }));
              small.appendChild(h('span', { class: 'gym-run__busy small' },
                h('span', { html: icon('timer') }),
                'Es läuft schon: „' + (other ? other.name : 'Timer') + '“.'));
              small.appendChild(btn('btn--ghost btn--sm', 'next', 'Zum Timer', function () { reveal(otherKind); }));
            } else {   // gesperrt
              controls.appendChild(lockedNote());
            }
            if (small.childNodes.length) controls.appendChild(small);
          }

          function startRun() {
            var res = OP.game.runStart(kind);
            if (!res || !res.ok) { OP.ui.toast((res && res.error) || 'Timer konnte nicht starten.', { type: 'warn' }); return; }
            OP.ui.haptic([15, 30, 15]);
          }
          function pause() {
            var a = OP.game.runStatus().active;
            if (!OP.game.runPause()) return;
            OP.ui.haptic(15);
            // Erklärung nur bei der ersten Pause eines Laufs
            if (a && a.segments === 1) OP.ui.toast('Pause – Gehzeit zählt nicht. Drück „Weiter“, wenn du wieder läufst.', { type: 'info', icon: 'pause' });
          }
          function resume() {
            if (OP.game.runResume()) OP.ui.haptic(15);
          }
          function stop() {
            var a = OP.game.runStatus().active;
            if (!a || a.kind !== kind) return;
            if (isStale(a)) { staleNotice(); return; }
            if (a.minutes > LONG_RUN_MIN) { askForgotten(a); return; }
            doStop();
          }
          function doStop() {
            var a = OP.game.runStatus().active;
            if (!a || a.kind !== kind) return;
            var segs = a.segments;
            var res = OP.game.runStop();
            // über 24 h (z. B. während "Timer vergessen?" offen war): nichts eingetragen, der Timer läuft weiter
            if (res && res.tooLong) { staleNotice(); return; }
            OP.ui.haptic([20, 40, 20]);
            showRunResult(res, { segments: segs });
            sync();   // Karte sofort auf den neuen Stand (nie "Läuft" ohne Timer)
          }
          /** Timer über 24 h: erklären und die Karte gleich auf "Von Hand eintragen / Verwerfen" umstellen */
          function staleNotice() {
            OP.ui.toast('Über 24 Stunden – das zählt nicht als Lauf. Trag deine Zeit von Hand ein oder verwirf den Timer.',
              { type: 'warn', icon: 'warning', ms: 5200 });
            sync();
          }
          /** Timer ohne Rückfrage verwerfen (vergessener Timer oder aus "Timer vergessen?") */
          function dropTimer() {
            var a = OP.game.runStatus().active;
            if (!a || a.kind !== kind) return;
            OP.game.runCancel();
            OP.ui.toast(OP.game.lockInfo().locked ? 'Timer verworfen. Von Hand eintragen kannst du nach deinem Zirkus-Tanz.'
              : 'Timer verworfen. Du kannst den Lauf „Von Hand eintragen“.', { type: 'info', ms: 4200 });
          }
          // Läuft der Timer seit Stunden, wurde er vermutlich vergessen: nachfragen statt einen Riesen-Wert einzutragen
          function askForgotten(a) {
            OP.ui.modal({
              title: 'Timer vergessen?',
              body: h('p', { text: 'Der Timer zeigt ' + clock(a.elapsedMs) + ' (' + minText(a.minutes) + '). ' +
                'Bist du wirklich so lange gelaufen, oder hast du vergessen, ihn zu stoppen?' }),
              actions: [
                { label: 'Zurück', kind: 'ghost' },
                { label: 'Verwerfen', kind: 'danger', onClick: dropTimer },
                // nur bis 24 Stunden (länger nimmt OP.game.runStop nicht an – dann zeigt die Karte andere Knöpfe)
                { label: 'Eintragen', kind: 'primary', onClick: doStop }
              ]
            });
          }
          function discard() {
            OP.ui.confirm('Timer verwerfen? Die Zeit wird nicht gezählt.', { title: 'Verwerfen?', okLabel: 'Verwerfen', danger: true })
              .then(function (ok) {
                if (!ok) return;
                var a = OP.game.runStatus().active;
                if (!a || a.kind !== kind) return;
                OP.game.runCancel();
                OP.ui.toast('Timer verworfen. Nichts wurde eingetragen.', { type: 'info' });
              });
          }

          /** Live-Anzeige (alle 250 ms) */
          function tick(rs) {
            var a = mine(rs), goal = goalOf(rs), first = isFirst(rs);
            var ms = a ? a.elapsedMs : 0, mins = a ? a.minutes : 0;
            var c = clock(ms);
            if (clockEl.textContent !== c) clockEl.textContent = c;
            var mt = minText(mins);
            if (minEl.textContent !== mt) minEl.textContent = mt;
            var stale = isStale(a);
            var reached = !!a && !stale && !first && goal > 0 && mins >= floor2(goal);
            var sub;
            if (!a) {
              // gesperrt: hier trotzdem das Ziel – den Sperr-Hinweis zeigen Knopf-Zeile und Rahmen
              if (modeShown === 'other') sub = 'Nur ein Timer zur Zeit.';
              else if (first) sub = 'Dein erster Lauf wird dein Startwert.';
              else sub = steady ? 'Schaffe ' + minText(goal) + ' am Stück.' : 'Ziel: ' + minText(goal) + ' reine Laufzeit.';
            } else if (stale) {
              sub = 'Läuft seit über 24 Stunden – vermutlich vergessen. Diese Zeit zählt nicht als Lauf.';
            } else {
              var pre = steady ? '' : 'Etappe ' + a.segments + ' · ';
              if (!a.running) pre = 'Pause – Gehzeit zählt nicht · ' + a.segments + (a.segments === 1 ? ' Etappe' : ' Etappen') + ' · ';
              if (first) sub = pre + (steady ? 'Lauf, so lange du kannst.' : 'Alles zählt als Startwert.');
              else if (reached) sub = pre + 'Ziel geschafft! Lauf weiter, wenn du kannst – der bessere Wert zählt.';
              else sub = pre + 'noch ' + minText(Math.max(0, floor2(goal) - mins)) + ' bis zum Ziel.';
            }
            if (subEl.textContent !== sub) subEl.textContent = sub;
            subEl.classList.toggle('tone-ok', reached);
            subEl.classList.toggle('tone-warn', stale);
            var showBar = !!a && !stale && !first && goal > 0;
            bar.hidden = !showBar;
            if (showBar) {
              var pct = Math.min(100, mins / goal * 100);
              OP.ui.setProgress(bar, pct, reached ? 'Ziel geschafft' : Math.floor(pct) + NB + '%', reached ? 'ok' : '');
            }
            card.classList.toggle('is-goal', reached);
            // einmalige Meldung, sobald das Ziel während des Laufs erreicht ist
            // (nur kurz nach dem Erreichen – nicht, wenn man viel später wieder hereinschaut)
            if (reached && a.running && !goalNoticed[a.started]) {
              goalNoticed[a.started] = true;
              if (mins - floor2(goal) < 1) {
                OP.ui.toast('Ziel geschafft! Lauf weiter, wenn du kannst – jede Minute mehr zählt.', { type: 'ok', icon: 'check', ms: 4000 });
                OP.ui.haptic([30, 50, 30, 50, 60]);
              }
            }
          }

          function refresh(rs) {
            var mode = modeOf(rs);
            fillStats(rs);
            if (mode !== modeShown) {
              modeShown = mode;
              fillControls(mode, rs);
              var stale = mode === 'stale' || mode === 'stale-locked';
              card.classList.toggle('is-running', mode === 'running');
              card.classList.toggle('is-paused', mode === 'paused');
              card.classList.toggle('is-stale', stale);
              card.classList.toggle('is-other', mode === 'other');
              stateChip.hidden = !(mode === 'running' || mode === 'paused' || stale);
              stateChip.innerHTML = '';
              if (mode === 'running') {
                stateChip.className = 'chip gym-run__state is-running';
                stateChip.appendChild(h('span', { class: 'gym-run__led' }));
                stateChip.appendChild(document.createTextNode('Läuft'));
              } else if (mode === 'paused') {
                stateChip.className = 'chip gym-run__state is-paused';
                stateChip.appendChild(h('span', { html: icon('pause') }));
                stateChip.appendChild(document.createTextNode('Pause'));
              } else if (stale) {
                stateChip.className = 'chip gym-run__state is-stale';
                stateChip.appendChild(h('span', { html: icon('warning') }));
                stateChip.appendChild(document.createTextNode('Über 24' + NB + 'h'));
              }
            }
            tick(rs);
          }

          return { el: card, refresh: refresh, tick: tick };
        }
      }

      /* ---------- Start ---------- */
      render();

      // Link auf eine andere Gruppe, während schon ein Training läuft
      if (link.group && OP.state.gym && OP.state.gym.group !== link.group) {
        var running = D.group(OP.state.gym.group);
        OP.ui.toast('Es läuft schon ein Training' + (running ? ' (' + running.name + ')' : '') + '. Beende es zuerst.', { type: 'info' });
      }

      bag.on('change', sync);
      bag.interval(function () {
        // Selbstheilung: Hat sich etwas ohne 'change' geändert (Timer über 24 h, Tageswechsel/Sperre, Timer weg),
        // wird neu gezeichnet – eine Karte bleibt so nie auf "Läuft 00:00" ohne Timer stehen.
        if (stateSig() !== shownSig) sync();
        var rs = OP.game.runStatus();
        updateHeadChip(rs);
        if (view && view.tick) view.tick(rs);
      }, TICK_MS);
      bag.add(function () { if (viewBag) viewBag.run(); viewBag = null; OP.ui.setHeadExtra(null); });
      return bag.run;
    }
  });
})();
