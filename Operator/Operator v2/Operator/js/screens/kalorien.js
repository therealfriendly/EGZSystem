/* Operator – Haus › Kalorienschulden (Bildschirm 'haus/kalorien')
   Regel aus der Spielidee:
   - Ziel in Kilo eingeben. 1 kg Fett = 7.700 kcal -> 20 kg = 154.000 kcal Schulden.
   - Jedes Defizit zahlt ab (−2.000 kcal -> noch 152.000 kcal = 98,7 % übrig). Ein Überschuss macht neue Schulden.
   - Bei 0 kcal: Achievement "ICH BIN GESUND!" (app.js feiert das beim ersten Mal, danach feiert dieser Bildschirm).
   - "Neues Ziel" nach dem Abbezahlen startet frisch (OP.game.kcalNewGoal): nur Einträge danach zählen.
     "Ziel ändern" während eines Ziels ändert nur die Größe (OP.game.kcalSetGoal).
   Intern (OP.state.kcal.entries): kcal > 0 = Defizit, kcal < 0 = Überschuss.
   Anzeige so, wie man es sagt: Defizit = "−2.000 kcal", Überschuss = "+500 kcal". */
(function () {
  'use strict';
  var OP = window.OP;
  if (!OP || !OP.screens) return;
  var U = OP.util, h = OP.h, D = OP.data;

  var KPK = D.KCAL_PER_KG || 7700;   // kcal pro kg Fett
  var MINUS = String.fromCharCode(0x2212);   // echtes Minuszeichen
  var NB = '\u00a0';                 // geschütztes Leerzeichen: Zahl und Einheit bleiben in einer Zeile
  var MAX_ENTRY = 100000;            // so viel nimmt OP.game.kcalAdd pro Eintrag an
  var WEEKDAYS = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
  var HISTORY_DAYS = 10;             // so viele Tage zeigt der Verlauf zuerst
  var QUICK = [300, 500, 1000];      // Schnell-Knöpfe fürs kcal-Feld

  /* ---------- kleine Helfer ---------- */

  function icon(n) { return OP.ui.icon(n); }
  function validDay(d) { return typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d); }
  function kgNum(kg) { return U.fmt1(kg).replace(/,0$/, ''); }
  function kgText(kg) { return kgNum(kg) + NB + 'kg'; }
  function kcalText(n) { return U.fmt(n) + NB + 'kcal'; }
  function pctText(p) { return p > 0 && p < 0.1 ? '<' + NB + '0,1' + NB + '%' : U.fmt1(p) + NB + '%'; }

  /** Kilo-Eingabe prüfen (0,1 bis 300 kg, auf 0,1 gerundet) -> Zahl oder NaN */
  function validKg(v) {
    var kg = Math.round(U.parseNum(v) * 10) / 10;
    return isFinite(kg) && kg >= 0.1 && kg <= 300 ? kg : NaN;
  }

  /** Alle gültigen Einträge (robust gegen kaputte Daten) */
  function entries() {
    var k = OP.state && OP.state.kcal;
    if (!k || !Array.isArray(k.entries)) return [];
    return k.entries.filter(function (e) { return e && isFinite(Number(e.kcal)) && Number(e.kcal) !== 0; });
  }

  /** Zählt der Eintrag zum aktuellen Ziel? (gleiche Regel wie OP.game: Einträge bis zum Zielstart baseT zählen nicht) */
  function isCurrent(e, baseT) { return !baseT || (Number(e.t) || 0) > baseT; }

  /** Nur die Einträge seit dem aktuellen Ziel */
  function currentEntries(baseT) {
    return entries().filter(function (e) { return isCurrent(e, baseT); });
  }

  /** "ICH BIN GESUND!" feiern, wenn gerade abbezahlt. app.js feiert nur das frisch freigeschaltete Achievement. */
  function celebrateHealthy(res) {
    if (!res || !res.justHealthy) return false;
    var viaApp = (res.achievements || []).some(function (a) { return a && a.id === 'ich_bin_gesund'; });
    if (!viaApp) {
      OP.ui.celebrate({ kicker: 'Kalorienschulden bezahlt', title: 'ICH BIN GESUND!', text: 'Alle Schulden sind abbezahlt. Stark!', icon: 'trophy', tone: 'ok', big: true });
    }
    return true;
  }

  /** Vorzeichen wie im Alltag: Defizit (intern +) = "−2.000", Überschuss (intern −) = "+500" */
  function signedNum(kcal) {
    var v = Math.round(Number(kcal) || 0);
    if (v === 0) return '0';
    return (v > 0 ? MINUS : '+') + U.fmt(Math.abs(v));
  }

  function dayTitle(day) {
    if (!validDay(day)) return 'Ohne Datum';
    var t = U.today();
    if (day === t) return 'Heute';
    if (day === U.addDays(t, -1)) return 'Gestern';
    return WEEKDAYS[U.parseDay(day).getDay()] + ', ' + U.dayLabel(day);
  }

  function safe(handle, fn, arg) {
    if (!handle || typeof handle[fn] !== 'function') return;
    try { handle[fn](arg); } catch (e) { console.error('[kalorien] holo.' + fn, e); }
  }

  /** Kleine Statistik: Tage mit Eintrag, Schnitt, heute, Tempo pro Kalendertag */
  function calcStats(list) {
    var byDay = {}, today = U.today();
    list.forEach(function (e) { if (validDay(e.day)) byDay[e.day] = (byDay[e.day] || 0) + Number(e.kcal); });
    var days = Object.keys(byDay).sort();
    var net = 0;
    days.forEach(function (d) { net += byDay[d]; });
    var res = { days: days.length, net: net, avg: days.length ? net / days.length : 0, today: byDay[today] || 0, pace: null, since: days[0] || null };
    if (days.length >= 3) {
      // Tempo = Netto-Defizit pro Kalendertag seit dem ersten Eintrag (heute zählt erst mit, wenn schon eingetragen)
      var end = byDay[today] != null ? today : U.addDays(today, -1);
      if (end < days[days.length - 1]) end = days[days.length - 1];
      res.pace = net / Math.max(1, U.diffDays(days[0], end) + 1);
    }
    return res;
  }

  /** Große Zahlen in den Tempo-Kacheln nie abschneiden ("−154.0…"): alle Werte gleich weit verkleinern,
      bis der längste ganz hineinpasst (wie die Spieler-Kacheln auf der Karte). Braucht das Element im DOM. */
  function fitStatValues(box) {
    var vals = Array.prototype.slice.call(box.querySelectorAll('.stat__value'));
    var scale = 1, px = 0;
    vals.forEach(function (v) { v.style.fontSize = ''; });
    vals.forEach(function (v) {
      var cw = v.clientWidth;
      if (!cw) return;
      var range = document.createRange();   // Textbreite genau messen (scrollWidth ist gerundet)
      range.selectNodeContents(v);
      var tw = range.getBoundingClientRect().width;
      if (tw > cw) scale = Math.min(scale, (cw - 1) / tw);
      px = parseFloat(getComputedStyle(v).fontSize) || 20;
    });
    if (scale >= 1) return;
    var size = Math.max(11, Math.floor(px * scale * 10) / 10) + 'px';
    vals.forEach(function (v) { v.style.fontSize = size; });
  }

  /** Prognose-Text für "fertig in ~N Tagen" */
  function etaInfo(st, s) {
    if (st.done) return null;
    if (s.pace == null) {
      return { icon: 'info', tone: '', text: 'Prognose ab 3 Tagen', sub: 'Nach 3 Tagen mit Einträgen siehst du hier, wann du fertig bist.' };
    }
    if (s.pace <= 0) {
      return { icon: 'warning', tone: 'warn', text: 'Gerade wachsen die Schulden', sub: 'Ein paar Tage mit Defizit, und die Prognose ist wieder da.' };
    }
    var n = Math.ceil(st.remaining / s.pace);
    if (n > 3650) {
      return { icon: 'flag', tone: '', text: 'Bei diesem Tempo: über 10 Jahre', sub: 'Jedes Defizit macht es kürzer. Du schaffst das.' };
    }
    return {
      icon: 'flag', tone: 'ok',
      text: 'Bei diesem Tempo: fertig in ~' + U.fmt(n) + NB + (n === 1 ? 'Tag' : 'Tagen'),
      sub: 'Etwa am ' + U.dayLabel(U.addDays(U.today(), n)) + ' · Schnitt seit ' + U.dayLabel(s.since).slice(0, 6) + ': ' + kcalText(s.pace) + ' pro Tag'
    };
  }

  /* ---------- Körper: Hologramm oder SVG-Ersatz ---------- */

  // Einfache Körper-Silhouette (viewBox 0 0 200 400) für den Ersatz ohne three.js
  var SHAPES =
    '<ellipse cx="100" cy="36" rx="21" ry="26"/>' +
    '<rect x="89" y="56" width="22" height="24" rx="7"/>' +
    '<path d="M58 80 Q100 70 142 80 Q158 84 154 106 L140 198 Q137 220 136 238 L64 238 Q63 220 60 198 L46 106 Q42 84 58 80Z"/>' +
    '<rect x="31" y="84" width="22" height="148" rx="11" transform="rotate(9 42 90)"/>' +
    '<rect x="147" y="84" width="22" height="148" rx="11" transform="rotate(-9 158 90)"/>' +
    '<rect x="66" y="226" width="32" height="164" rx="15"/>' +
    '<rect x="102" y="226" width="32" height="164" rx="15"/>';
  var BODY_TOP = 10, BODY_H = 380;
  // Welle an der Oberfläche der "Schulden-Füllung" (Periode 100, wird seitlich verschoben)
  var WAVE = (function () {
    var d = 'M-200 0 Q-175 -5 -150 0';
    for (var x = -100; x <= 400; x += 50) d += ' T' + x + ' 0';
    return d + ' V420 H-200 Z';
  })();

  function createBody(box, fill) {
    fill = U.clamp(Number(fill) || 0, 0, 1);
    if (OP.holo && typeof OP.holo.body === 'function') {
      try {
        var hd = OP.holo.body(box, { mode: 'kcal', fill: fill, autoRotate: true, interactive: true });
        if (hd) return hd;
      } catch (e) {
        console.error('[kalorien] Hologramm', e);
        box.innerHTML = '';
      }
    }
    return silhouette(box, fill);
  }

  /** Ersatz ohne three.js: Silhouette, die von unten mit "Schulden" gefüllt ist */
  function silhouette(box, fill) {
    var id = U.uid('kalb');
    box.classList.add('kal-sil-box');
    box.insertAdjacentHTML('beforeend',
      '<svg class="kal-sil" viewBox="0 0 200 400" preserveAspectRatio="xMidYMid meet" aria-hidden="true">' +
        '<defs>' +
          '<clipPath id="' + id + 'c">' + SHAPES + '</clipPath>' +
          '<linearGradient id="' + id + 'g" x1="0" y1="0" x2="0" y2="1">' +
            '<stop offset="0" stop-color="#ffc861" stop-opacity=".95"/>' +
            '<stop offset=".45" stop-color="#ff8a3d" stop-opacity=".85"/>' +
            '<stop offset="1" stop-color="#ff3d57" stop-opacity=".8"/>' +
          '</linearGradient>' +
          '<pattern id="' + id + 's" width="4" height="4" patternUnits="userSpaceOnUse"><rect width="4" height="1.1" fill="rgba(255,255,255,.13)"/></pattern>' +
          '<filter id="' + id + 'o" x="-20%" y="-10%" width="140%" height="120%">' +
            '<feMorphology in="SourceAlpha" operator="dilate" radius="1.6" result="dil"/>' +
            '<feComposite in="dil" in2="SourceAlpha" operator="out" result="ring"/>' +
            '<feFlood class="kal-sil__glow" flood-color="#3ee6d0" result="col"/>' +
            '<feComposite in="col" in2="ring" operator="in" result="line"/>' +
            '<feGaussianBlur in="line" stdDeviation="3.2" result="blur"/>' +
            '<feMerge><feMergeNode in="blur"/><feMergeNode in="line"/></feMerge>' +
          '</filter>' +
        '</defs>' +
        '<g class="kal-sil__shell">' + SHAPES + '</g>' +
        '<g clip-path="url(#' + id + 'c)">' +
          '<g class="kal-sil__level"><g class="kal-sil__wave"><path d="' + WAVE + '" fill="url(#' + id + 'g)"/></g></g>' +
          '<rect width="200" height="400" fill="url(#' + id + 's)"/>' +
        '</g>' +
        '<g class="kal-sil__outline" filter="url(#' + id + 'o)">' + SHAPES + '</g>' +
      '</svg>');
    var svg = box.lastElementChild;
    var level = svg.querySelector('.kal-sil__level');
    function set(f) {
      f = U.clamp(Number(f) || 0, 0, 1);
      level.style.transform = 'translateY(' + (BODY_TOP + (1 - f) * BODY_H + (f > 0 ? 0 : 12)) + 'px)';
      box.classList.toggle('is-empty', f <= 0);
    }
    set(fill);
    return {
      update: function (o) { if (o && o.fill != null) set(o.fill); },
      pulse: function () { svg.classList.remove('is-pulse'); void svg.getBoundingClientRect(); svg.classList.add('is-pulse'); },
      destroy: function () {
        if (svg.parentNode) svg.parentNode.removeChild(svg);
        box.classList.remove('kal-sil-box', 'is-empty');
      }
    };
  }

  /* ================= Bildschirm ================= */

  OP.screens.register('haus/kalorien', {
    title: 'Kalorien', icon: 'kcal',
    mount: function (el) {
      var bag = OP.ui.cleanup();
      var mode = null;       // 'setup' | 'goal' | 'done'
      var view = null;       // {root, refresh(), after()}
      var viewBag = null;
      var showAll = false;   // Verlauf: alle Tage zeigen?

      function modeOf(st) { return !st.hasGoal ? 'setup' : (st.done ? 'done' : 'goal'); }

      function render() {
        if (viewBag) viewBag.run();
        viewBag = OP.ui.cleanup();
        el.innerHTML = '';
        mode = modeOf(OP.game.kcalStatus());
        view = mode === 'setup' ? buildSetup(viewBag) : buildMain(viewBag, mode);
        el.appendChild(view.root);
        if (view.after) view.after();
      }

      /* ---------- Ziel ändern / neues Ziel ---------- */
      // Dialog mit denselben Bausteinen wie beim ersten Ziel: kg-Feld, Schnell-Knöpfe, kcal-Vorschau
      function changeGoal() {
        var st = OP.game.kcalStatus();
        // Nach "ICH BIN GESUND!": neues Ziel startet frisch (alte Einträge zählen nicht mehr).
        // Während eines Ziels: nur die Größe ändern, Abbezahltes zählt weiter.
        var fresh = st.done;
        var kg = OP.ui.numField({ label: 'Dein Ziel', suffix: 'kg', placeholder: 'z. B. 5', value: fresh ? '' : kgNum(st.goalKg), enterkeyhint: 'done' });
        var preview = h('div', { class: 'kal-setup__preview' });
        var restEl = fresh ? null : h('div', { class: 'small muted' });

        function upd() {
          var v = validKg(kg.input.value);
          preview.classList.toggle('is-on', isFinite(v));
          if (!isFinite(v)) {
            preview.textContent = '1' + NB + 'kg Fett = ' + kcalText(KPK);
            if (restEl) restEl.textContent = '';
            return;
          }
          var total = Math.round(v * KPK);
          preview.innerHTML = '= <b class="num">' + U.fmt(total) + '</b>' + NB + 'kcal Schulden';
          if (restEl) {
            var rest = total - OP.game.kcalStatus().paid;
            restEl.textContent = rest > 0 ? 'Noch zu zahlen: ' + kcalText(rest) : 'Damit sind deine Schulden sofort bezahlt.';
          }
        }
        kg.input.addEventListener('input', upd);
        upd();

        var chips = h('div', { class: 'kal-chips' }, [5, 10, 20].map(function (n) {
          return h('button', { type: 'button', class: 'chip chip--btn kal-chip', onclick: function () { kg.set(n); upd(); } }, n + NB + 'kg');
        }));
        var form = h('form', { class: 'stack', novalidate: true, onsubmit: function (e) { e.preventDefault(); save(); } },
          h('p', { class: 'small muted', text: fresh
            ? 'Wie viel Kilo Fett willst du jetzt verlieren? Du startest frisch: Nur neue Einträge zählen.'
            : 'Wie viel Kilo Fett willst du insgesamt verlieren? Was du schon abbezahlt hast, zählt weiter.' }),
          kg.el, chips, preview, restEl);

        var dlg = OP.ui.modal({
          title: fresh ? 'Neues Ziel' : 'Ziel ändern', body: form,
          actions: [
            { label: 'Abbrechen', kind: 'ghost' },
            { label: 'Speichern', kind: 'primary', onClick: save }
          ]
        });

        function save() {
          var v = validKg(kg.input.value);
          if (!isFinite(v)) {
            OP.ui.toast('Bitte eine Zahl zwischen 0,1 und 300 kg eingeben.', { type: 'warn' });
            kg.input.focus();
            return false;   // Dialog bleibt offen
          }
          dlg.close();
          if (!fresh && Math.round(v * KPK) <= OP.game.kcalStatus().paid) {
            OP.ui.confirm('Mit diesem Ziel sind deine Schulden sofort bezahlt. Speichern?', { title: 'Ziel ändern', okLabel: 'Speichern' })
              .then(function (ok) { if (ok) apply(v); });
          } else apply(v);
        }

        function apply(v) {
          var wasDone = OP.game.kcalStatus().done;
          var res = fresh ? OP.game.kcalNewGoal(v) : OP.game.kcalSetGoal(v);
          if (!res || !res.ok) { OP.ui.toast((res && res.error) || 'Ziel konnte nicht gespeichert werden.', { type: 'warn' }); return; }
          var now = OP.game.kcalStatus();
          if (now.done) {
            // kleineres Ziel = sofort bezahlt
            celebrateHealthy({ justHealthy: !wasDone, achievements: res.achievements });
            return;
          }
          OP.ui.toast((fresh ? 'Neues Ziel: ' : 'Ziel geändert: ') + kcalText(now.remaining) + ' Schulden.', { type: 'ok', icon: 'target' });
        }
      }

      /* ---------- Ansicht 1: noch kein Ziel ---------- */
      function buildSetup(vb) {
        var body = null;
        var holoBox = h('div', { class: 'kal-holo kal-holo--setup' });
        var kg = OP.ui.numField({ label: 'Dein Ziel', suffix: 'kg', placeholder: 'z. B. 20', enterkeyhint: 'done' });
        var preview = h('div', { class: 'kal-setup__preview' });

        function upd() {
          var v = validKg(kg.input.value);
          if (isFinite(v)) {
            preview.innerHTML = '= <b class="num">' + U.fmt(v * KPK) + '</b>' + NB + 'kcal Schulden';
            preview.classList.add('is-on');
          } else {
            preview.textContent = '1' + NB + 'kg Fett = ' + kcalText(KPK);
            preview.classList.remove('is-on');
          }
        }
        kg.input.addEventListener('input', upd);
        upd();

        function submit(e) {
          e.preventDefault();
          var v = validKg(kg.input.value);
          if (!isFinite(v)) {
            OP.ui.toast('Bitte ein Ziel zwischen 0,1 und 300 kg eingeben.', { type: 'warn' });
            kg.input.focus();
            return;
          }
          // Neues Ziel = frische Schulden (v × 7.700), genau wie in der Vorschau – auch wenn es alte Einträge gibt
          var res = OP.game.kcalNewGoal(v);
          if (!res || !res.ok) { OP.ui.toast((res && res.error) || 'Ziel konnte nicht gespeichert werden.', { type: 'warn' }); return; }
          OP.ui.toast('Ziel gesetzt: ' + kcalText(OP.game.kcalStatus().remaining) + ' Schulden. Los geht\'s!', { type: 'ok', icon: 'target' });
          // 'change' baut die Hauptansicht auf
        }

        var chips = h('div', { class: 'kal-chips' }, [5, 10, 20].map(function (n) {
          return h('button', { type: 'button', class: 'chip chip--btn kal-chip', onclick: function () { kg.set(n); upd(); } }, n + NB + 'kg');
        }));

        var form = h('form', { class: 'kal-setup card card--glow', onsubmit: submit, novalidate: true },
          h('div', { class: 'kal-setup__grid' },
            holoBox,
            h('div', { class: 'kal-setup__main' },
              h('div', { class: 'kal-kicker', text: 'Kalorienschulden' }),
              h('h2', { class: 'kal-setup__title', text: 'Wie viel Kilo Fett willst du verlieren?' }),
              h('p', { class: 'small muted', text: 'Dein Ziel wird zu Kalorienschulden. Jedes Defizit zahlt ab – bis du bei 0 bist.' }),
              kg.el, chips, preview,
              h('button', { class: 'btn btn--primary btn--lg btn--block', type: 'submit' },
                h('span', { html: icon('target') }), 'Ziel setzen'))),
          h('ol', { class: 'kal-steps' },
            h('li', {}, h('b', { text: '1' }), h('div', {}, h('strong', { text: 'Ziel setzen' }), h('span', { text: kgText(20) + ' = ' + kcalText(20 * KPK) + ' Schulden' }))),
            h('li', {}, h('b', { text: '2' }), h('div', {}, h('strong', { text: 'Defizit eintragen' }), h('span', { text: 'Weniger gegessen als verbraucht? Das zahlt ab.' }))),
            h('li', {}, h('b', { text: '3' }), h('div', {}, h('strong', { text: 'Bei 0' + NB + 'kcal' }), h('span', { text: 'Achievement: ICH BIN GESUND!' })))));

        var histBox = h('section', { class: 'kal-hist' });
        var root = h('div', { class: 'screen__inner kal kal--setup' }, form, histBox);
        function refresh() {
          if (entries().length) fillHistory(histBox); else histBox.innerHTML = '';
        }
        refresh();

        return {
          root: root,
          refresh: refresh,
          after: function () {
            body = createBody(holoBox, 1);
            vb.add(function () { safe(body, 'destroy'); body = null; });
          }
        };
      }

      /* ---------- Ansicht 2: Schulden abbezahlen (auch "ICH BIN GESUND!") ---------- */
      function buildMain(vb, mode) {
        var done = mode === 'done';
        var body = null, lastFill = null;
        var holoBox = h('div', { class: 'kal-holo' });
        var info = h('div', { class: 'kal-hero__info' });
        var hero = h('section', { class: 'kal-hero card card--glow' + (done ? ' is-done' : '') },
          h('div', { class: 'kal-hero__body' }, holoBox), info);
        var heroRefs = done ? buildDoneInfo(info) : buildDebtInfo(info);
        var statsBox = h('section', { class: 'kal-stats card' });
        var histBox = h('section', { class: 'kal-hist' });
        var form = buildForm(function () { return body; });

        var root = h('div', { class: 'screen__inner kal' },
          h('div', { class: 'kal-layout' },
            h('div', { class: 'kal-col kal-col--a' }, hero, statsBox),
            h('div', { class: 'kal-col kal-col--b' }, form.el, histBox)));

        function fillOf(st) { return done ? 0 : U.clamp(st.pctRemaining / 100, 0, 1); }

        function refresh() {
          var st = OP.game.kcalStatus();
          heroRefs.update(st);
          var f = fillOf(st);
          if (f !== lastFill) { lastFill = f; safe(body, 'update', { fill: f }); }
          fillStats(statsBox, st);
          fillHistory(histBox);
          form.refresh(st);
        }
        refresh();

        return {
          root: root,
          refresh: refresh,
          after: function () {
            body = createBody(holoBox, fillOf(OP.game.kcalStatus()));
            vb.add(function () { safe(body, 'destroy'); body = null; });
            // Tempo-Kacheln: erst jetzt messbar; neu anpassen, wenn Schrift geladen / Fenster gedreht
            function refit() { fitStatValues(statsBox); }
            refit();
            if (document.fonts && document.fonts.ready) document.fonts.ready.then(refit, function () {});
            window.addEventListener('resize', refit);
            vb.add(function () { window.removeEventListener('resize', refit); });
          }
        };
      }

      /** Rechte Seite im Kopf-Bereich: große Restschuld */
      function buildDebtInfo(info) {
        var remEl = h('span', { class: 'kal-big__num num' });
        var pctEl = h('b', { class: 'num' });
        var kgEl = h('b', { class: 'num' });
        var bar = OP.ui.progress(0, { tone: 'kcal', label: ' ' });
        bar.classList.add('bar--lg');
        var paidEl = h('div', { class: 'kal-hero__paid' });
        var goalEl = h('span', { class: 'kal-hero__goal-text' });
        info.appendChild(h('div', { class: 'kal-kicker', text: 'Noch zu zahlen' }));
        info.appendChild(h('div', { class: 'kal-big' }, remEl, h('span', { class: 'kal-big__unit', text: 'kcal' })));
        info.appendChild(h('div', { class: 'kal-hero__sub' }, pctEl, ' übrig', h('span', { class: 'kal-dot', text: '·' }), kgEl));
        info.appendChild(bar);
        info.appendChild(paidEl);
        info.appendChild(h('div', { class: 'kal-hero__goal' }, goalEl,
          h('button', { class: 'btn btn--ghost btn--sm', type: 'button', onclick: changeGoal },
            h('span', { html: icon('edit') }), 'Ziel ändern')));
        return {
          update: function (st) {
            remEl.textContent = U.fmt(st.remaining);
            pctEl.textContent = pctText(st.pctRemaining);
            kgEl.textContent = '≈' + NB + kgText(st.kgRemaining);
            OP.ui.setProgress(bar, Math.max(0, st.pctPaid), U.fmt1(Math.max(0, st.pctPaid)) + NB + '% bezahlt');
            paidEl.innerHTML = '';
            if (st.paid >= 0) {
              paidEl.appendChild(h('span', { class: 'tone-ok num', text: kcalText(st.paid) }));
              paidEl.appendChild(document.createTextNode(' abbezahlt' + (st.paid >= KPK / 10 ? ' (≈' + NB + kgText(st.paid / KPK) + ')' : '')));
            } else {
              paidEl.appendChild(h('span', { class: 'tone-warn num', text: '+' + kcalText(-st.paid) }));
              paidEl.appendChild(document.createTextNode(' mehr Schulden als am Start'));
            }
            goalEl.textContent = 'Ziel: ' + kgText(st.goalKg) + ' = ' + kcalText(st.total) +
              (st.baseT ? ' · seit' + NB + U.dayLabel(U.dayKey(st.baseT)) : '');
          }
        };
      }

      /** Stolzer Zustand nach dem Abbezahlen */
      function buildDoneInfo(info) {
        var textEl = h('p', { class: 'kal-proud__text' });
        var extraEl = h('p', { class: 'tiny muted' });
        info.appendChild(h('div', { class: 'kal-proud__icon', html: icon('trophy') }));
        info.appendChild(h('div', { class: 'kal-kicker kal-kicker--ok', text: 'Kalorienschulden bezahlt' }));
        info.appendChild(h('h2', { class: 'kal-proud__title', text: 'ICH BIN GESUND!' }));
        info.appendChild(textEl);
        info.appendChild(extraEl);
        info.appendChild(h('button', { class: 'btn btn--gold btn--block kal-proud__btn', type: 'button', onclick: changeGoal },
          h('span', { html: icon('target') }), 'Neues Ziel setzen'));
        return {
          update: function (st) {
            var when = st.healthyAt ? ' am ' + U.dayLabel(U.dayKey(st.healthyAt)) : '';
            textEl.textContent = 'Alle ' + kcalText(st.total) + ' (' + kgText(st.goalKg) + ') abbezahlt' + when + '.';
            extraEl.textContent = st.paid > st.total ? 'Dazu ' + kcalText(st.paid - st.total) + ' extra. Stark!' : 'Du hast es durchgezogen. Stark!';
          }
        };
      }

      /* ---------- Eintragen ---------- */
      function buildForm(getBody) {
        var sign = 1;   // +1 = Defizit (zahlt ab), −1 = Überschuss (neue Schulden)
        var today = U.today();
        var amount = OP.ui.numField({ label: 'Kalorien', suffix: 'kcal', placeholder: 'z. B. 500', integer: true, enterkeyhint: 'done' });

        function segBtn(s, cls, ico, title, sub) {
          return h('button', { type: 'button', class: 'seg__btn kal-seg__btn ' + cls, 'aria-pressed': 'false', onclick: function () { setSign(s); } },
            h('span', { class: 'kal-seg__ico', html: icon(ico) }),
            h('span', { class: 'kal-seg__txt' }, h('b', { text: title }), h('small', { text: sub })));
        }
        var btnDef = segBtn(1, 'kal-seg__btn--def', 'down', 'Defizit', 'zahlt ab');
        var btnSur = segBtn(-1, 'kal-seg__btn--sur', 'up', 'Überschuss', 'neue Schulden');

        var chips = h('div', { class: 'kal-chips' }, QUICK.map(function (n) {
          return h('button', { type: 'button', class: 'chip chip--btn kal-chip', onclick: function () {
            var v = amount.value();
            amount.set(Math.round((isFinite(v) && v > 0 ? v : 0) + n));
            upd();
          } }, '+' + U.fmt(n));
        }));

        var note = h('input', { class: 'input', type: 'text', maxlength: '80', placeholder: 'z. B. Wanderung', autocomplete: 'off', enterkeyhint: 'done' });
        var date = h('input', { class: 'input kal-date', type: 'date', value: today, max: today });
        var preview = h('div', { class: 'kal-form__preview' });
        var submit = h('button', { type: 'submit', class: 'btn btn--primary btn--lg btn--block kal-submit' });

        var el = h('form', { class: 'kal-form card', onsubmit: onSubmit, novalidate: true },
          h('div', { class: 'kal-form__head' },
            h('div', { class: 'kal-kicker', text: 'Eintragen' }),
            h('span', { class: 'tiny faint', text: kgText(1) + ' = ' + kcalText(KPK) })),
          h('div', { class: 'seg kal-seg', role: 'group', 'aria-label': 'Art des Eintrags' }, btnDef, btnSur),
          amount.el,
          chips,
          h('div', { class: 'kal-form__row' },
            h('label', { class: 'field' }, h('span', { class: 'field__label', text: 'Notiz (optional)' }), note),
            h('label', { class: 'field' }, h('span', { class: 'field__label', text: 'Tag' }), date)),
          preview,
          submit,
          h('p', { class: 'kal-form__hint' },
            h('span', { html: icon('info') }),
            h('span', { text: 'Defizit = weniger gegessen als verbraucht. Beispiel: Wanderung + Defizit = ' + MINUS + kcalText(2000) + '.' })));

        function setSign(s) {
          sign = s;
          btnDef.classList.toggle('is-on', s > 0);
          btnSur.classList.toggle('is-on', s < 0);
          btnDef.setAttribute('aria-pressed', s > 0 ? 'true' : 'false');
          btnSur.setAttribute('aria-pressed', s < 0 ? 'true' : 'false');
          submit.innerHTML = '';
          submit.appendChild(h('span', { html: icon(s > 0 ? 'check' : 'plus') }));
          submit.appendChild(document.createTextNode(s > 0 ? 'Abzahlen' : 'Schulden eintragen'));
          submit.classList.toggle('kal-submit--sur', s < 0);
          upd();
        }

        // Vorschau: was passiert nach dem Eintragen?
        function upd(st) {
          st = st || OP.game.kcalStatus();
          var v = amount.value();
          var dayFor = date.value && date.value !== U.today() ? 'für ' + dayTitle(date.value) : '';
          preview.classList.remove('is-ok', 'is-warn');
          if (isFinite(v) && Math.round(v) > MAX_ENTRY) {
            preview.textContent = 'Höchstens ' + kcalText(MAX_ENTRY) + ' pro Eintrag.';
            preview.classList.add('is-warn');
          } else if (isFinite(v) && Math.round(v) >= 1) {
            var after = Math.max(0, st.total - (st.paid + sign * Math.round(v)));
            var pct = st.total > 0 ? after / st.total * 100 : 0;
            preview.textContent = (sign > 0 ? MINUS : '+') + kcalText(v) + ' → danach ' +
              (after > 0 ? 'noch ' + kcalText(after) + ' (' + pctText(pct) + ')' : '0' + NB + 'kcal. Geschafft!') + (dayFor ? ' · ' + dayFor : '');
            preview.classList.add(sign > 0 ? 'is-ok' : 'is-warn');
          } else {
            // ohne Zahl nur zeigen, wenn ein anderer Tag gewählt ist
            preview.textContent = dayFor ? 'Eintrag ' + dayFor : '';
          }
          preview.hidden = !preview.textContent;
        }
        amount.input.addEventListener('input', function () { upd(); });
        date.addEventListener('change', function () { upd(); });
        date.addEventListener('input', function () { upd(); });

        function onSubmit(e) {
          e.preventDefault();
          var v = Math.round(amount.value());
          if (!isFinite(v) || v < 1) {
            OP.ui.toast('Bitte eine kcal-Zahl größer 0 eingeben.', { type: 'warn' });
            amount.input.focus();
            return;
          }
          // Grenze von OP.game.kcalAdd schon hier prüfen – nicht erst nach der Rückfrage
          if (v > MAX_ENTRY) {
            OP.ui.toast('Höchstens ' + kcalText(MAX_ENTRY) + ' pro Eintrag. Teil es auf mehrere Einträge auf.', { type: 'warn' });
            amount.input.focus();
            return;
          }
          var day = date.value || U.today();
          if (!validDay(day) || day > U.today()) {
            OP.ui.toast('Bitte einen Tag bis heute wählen.', { type: 'warn' });
            return;
          }
          if (v >= 10000) {   // Tippfehler abfangen (z. B. 20000 statt 2000)
            OP.ui.confirm(kcalText(v) + ' an einem Tag sind sehr viel. Stimmt die Zahl?',
              { title: 'Große Zahl', okLabel: 'Ja, eintragen', cancelLabel: 'Korrigieren' })
              .then(function (ok) { if (ok) save(v, day); else amount.input.focus(); });
            return;
          }
          save(v, day);
        }

        function save(v, day) {
          var s = sign;
          var res = OP.game.kcalAdd(v * s, note.value.trim(), day);
          if (!res || !res.ok) { OP.ui.toast((res && res.error) || 'Speichern hat nicht geklappt.', { type: 'warn' }); return; }
          amount.set('');
          note.value = '';
          upd();
          OP.ui.haptic(15);
          safe(getBody(), 'pulse');
          if (celebrateHealthy(res)) return;
          var st = res.status || OP.game.kcalStatus();
          var rest = st.done ? 'Du bleibst gesund!' : 'Noch ' + kcalText(st.remaining) + '.';
          if (s > 0) OP.ui.toast(MINUS + kcalText(v) + ' abbezahlt. ' + rest, { type: 'ok', icon: 'check' });
          else OP.ui.toast('+' + kcalText(v) + ' Überschuss eingetragen. ' + rest, { type: 'warn', icon: 'plus' });
        }

        // App bleibt über Mitternacht offen: "heute" im Datumsfeld nachziehen
        function syncToday() {
          var t = U.today();
          if (date.max === t) return;
          if (date.value === date.max) date.value = t;
          date.max = t;
        }

        setSign(1);
        return { el: el, refresh: function (st) { syncToday(); upd(st); } };
      }

      /* ---------- Tempo / Statistik ---------- */
      function fillStats(box, st) {
        box.innerHTML = '';
        var s = calcStats(currentEntries(st.baseT));   // nur seit dem aktuellen Ziel
        function tone(v) { return v > 0 ? 'ok' : (v < 0 ? 'warn' : null); }
        box.appendChild(OP.ui.sectionTitle('Dein Tempo', 'bolt'));
        box.appendChild(h('div', { class: 'grid-3 kal-stats__grid' },
          OP.ui.stat(signedNum(s.today), 'kcal heute', { tone: tone(s.today) }),
          OP.ui.stat(s.days ? signedNum(s.avg) : '–', 'Ø kcal je Tag mit Eintrag', { tone: tone(s.avg) }),
          OP.ui.stat(U.fmt(s.days), s.days === 1 ? 'Tag mit Eintrag' : 'Tage mit Eintrag')));
        fitStatValues(box);   // beim ersten Aufbau noch nicht im DOM -> after() passt an
        var eta = etaInfo(st, s);
        if (eta) {
          box.appendChild(h('div', { class: 'kal-eta' + (eta.tone ? ' kal-eta--' + eta.tone : '') },
            h('span', { class: 'kal-eta__icon', html: icon(eta.icon) }),
            h('div', { class: 'kal-eta__main' },
              h('div', { class: 'kal-eta__text', text: eta.text }),
              eta.sub ? h('div', { class: 'tiny muted', text: eta.sub }) : null)));
        }
      }

      /* ---------- Verlauf (neueste zuerst, nach Tagen gruppiert) ---------- */
      function removeEntry(e) {
        var what = signedNum(e.kcal) + NB + 'kcal' + (e.note ? ' (' + e.note + ')' : '') + (validDay(e.day) ? ' vom ' + U.dayLabel(e.day) : '');
        OP.ui.confirm('Eintrag löschen? ' + what, { title: 'Eintrag löschen', okLabel: 'Löschen', danger: true }).then(function (ok) {
          if (!ok) return;
          var res = OP.game.kcalRemove(e.id);   // -> {ok, justHealthy, achievements} oder false
          if (!res) { OP.ui.toast('Eintrag nicht gefunden.', { type: 'warn' }); return; }
          // z. B. falsch getippten Überschuss gelöscht -> Schulden sind jetzt bezahlt
          if (celebrateHealthy(res)) return;
          OP.ui.toast('Eintrag gelöscht.', { type: 'info', icon: 'trash' });
        });
      }

      function entryRow(e) {
        var def = Number(e.kcal) > 0;
        var time = e.t && U.dayKey(e.t) === e.day ? U.timeLabel(e.t) : '';
        var type = def ? 'Defizit' : 'Überschuss';
        return h('li', { class: 'kal-entry ' + (def ? 'is-def' : 'is-sur') },
          h('span', { class: 'kal-entry__icon', html: icon(def ? 'down' : 'up') }),
          h('div', { class: 'kal-entry__main' },
            h('div', { class: 'kal-entry__title', text: e.note ? String(e.note) : type }),   // Notiz = Nutzertext -> nur als Text
            h('div', { class: 'kal-entry__meta tiny faint', text: (e.note ? type : (def ? 'zahlt ab' : 'neue Schulden')) + (time ? ' · ' + time : '') })),
          h('span', { class: 'kal-entry__amount num', text: signedNum(e.kcal) }),
          h('button', { class: 'icon-btn icon-btn--ghost kal-entry__del', type: 'button', 'aria-label': 'Eintrag löschen', html: icon('trash'),
            onclick: function () { removeEntry(e); } }));
      }

      /** Einträge nach Tagen gruppieren (Liste ist schon sortiert, neueste zuerst) */
      function groupByDay(list) {
        var groups = [], byDay = {};
        list.forEach(function (e) {
          var d = validDay(e.day) ? e.day : '?';
          if (!byDay[d]) { byDay[d] = { day: d, items: [], net: 0 }; groups.push(byDay[d]); }
          byDay[d].items.push(e);
          byDay[d].net += Number(e.kcal);
        });
        return groups;
      }

      function dayBox(g, old) {
        var tone = g.net > 0 ? 'tone-ok' : (g.net < 0 ? 'tone-warn' : 'muted');
        return h('div', { class: 'kal-day' + (old ? ' is-old' : '') },
          h('div', { class: 'kal-day__head' },
            h('span', { class: 'kal-day__title', text: dayTitle(g.day) }),
            h('span', { class: 'kal-day__sum num ' + tone, text: signedNum(g.net) + NB + 'kcal' })),
          h('ul', { class: 'kal-day__list' }, g.items.map(entryRow)));
      }

      function fillHistory(box) {
        box.innerHTML = '';
        var baseT = OP.game.kcalStatus().baseT;
        var list = entries().slice().sort(function (a, b) {
          var da = validDay(a.day) ? a.day : '', db = validDay(b.day) ? b.day : '';
          if (da !== db) return da < db ? 1 : -1;
          return (Number(b.t) || 0) - (Number(a.t) || 0);
        });
        // Seit einem neuen Ziel: oben die Einträge, die zählen, unter dem Trenner die alten
        var cur = groupByDay(list.filter(function (e) { return isCurrent(e, baseT); }));
        var old = baseT ? groupByDay(list.filter(function (e) { return !isCurrent(e, baseT); })) : [];

        box.appendChild(OP.ui.sectionTitle('Verlauf', 'calendar', list.length
          ? h('span', { class: 'chip chip--muted', text: list.length + (list.length === 1 ? ' Eintrag' : ' Einträge') }) : null));

        if (!list.length) {
          box.appendChild(h('div', { class: 'kal-empty' },
            h('span', { class: 'kal-empty__icon', html: icon('kcal') }),
            h('p', { text: 'Noch keine Einträge. Trag dein erstes Defizit ein – jeder Tag zählt.' })));
          return;
        }

        var limit = showAll ? Infinity : HISTORY_DAYS, shown = 0;
        var wrap = h('div', { class: 'kal-days' });
        cur.forEach(function (g) { if (shown < limit) { wrap.appendChild(dayBox(g, false)); shown++; } });
        if (old.length && shown < limit) {
          if (!cur.length) wrap.appendChild(h('p', { class: 'kal-hist__none small muted', text: 'Seit dem neuen Ziel noch kein Eintrag.' }));
          wrap.appendChild(h('div', { class: 'kal-goalline', role: 'separator' },
            h('span', { class: 'kal-goalline__label' },
              h('span', { html: icon('flag') }),
              h('b', { text: 'Neues Ziel seit ' + U.dayLabel(U.dayKey(baseT)) })),
            h('span', { class: 'kal-goalline__sub tiny faint', text: 'Ältere Einträge zählen nicht mehr mit.' })));
          old.forEach(function (g) { if (shown < limit) { wrap.appendChild(dayBox(g, true)); shown++; } });
        }
        box.appendChild(wrap);
        var more = cur.length + old.length - shown;
        if (more > 0) {
          box.appendChild(h('button', { class: 'btn btn--ghost btn--block kal-more', type: 'button',
            onclick: function () { showAll = true; fillHistory(box); } },
            'Ältere anzeigen (' + more + (more === 1 ? ' Tag)' : ' Tage)')));
        }
      }

      /* ---------- Start ---------- */
      render();
      bag.on('change', function () {
        if (modeOf(OP.game.kcalStatus()) !== mode) render();
        else if (view && view.refresh) view.refresh();
      });
      bag.add(function () { if (viewBag) viewBag.run(); viewBag = null; });
      return bag.run;
    }
  });
})();
