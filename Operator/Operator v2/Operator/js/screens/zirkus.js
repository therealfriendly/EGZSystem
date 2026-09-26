/* Operator – Taverne, Tab "Zirkus-Tänze" (Screen 'taverne/zirkus')
   Bauch-Challenges: Plank und seitliche Planks (Sekunden, ein Versuch) sowie Crunches und Sit-ups
   (Wiederholungen, werden bis zum Ziel zusammengezählt). Kein Limit: jeder Erfolg erhöht das Ziel.
   Für die Zeit-Übungen gibt es eine eingebaute Stoppuhr. */
(function () {
  'use strict';
  var OP = window.OP;
  var U = OP.util, h = OP.h, D = OP.data;

  /** Sekunden immer als "90 s" (nie "1:30 min"), passend zum Eingabefeld und zur Anzeige "14 von 14 s" */
  function sec(n) { return U.fmt(n) + ' s'; }

  /** Regel-Text aus OP.data: "Plank/Seitliche Planks +5 s, Crunches/Sit-ups +1 Wdh." */
  function stepRules() {
    var groups = [];
    (D.ABS_EXERCISES || []).forEach(function (ex) {
      var g = null;
      groups.forEach(function (x) { if (x.unit === ex.unit && x.step === ex.step) g = x; });
      if (!g) { g = { unit: ex.unit, step: ex.step, names: [] }; groups.push(g); }
      g.names.push(ex.name);
    });
    return groups.map(function (g) {
      return g.names.join('/') + ' +' + (g.unit === 's' ? sec(g.step) : U.fmt(g.step) + ' Wdh.');
    }).join(', ');
  }

  var NPC = { id: 'zirkus', name: 'Direktorin Madame Rune', role: 'Zirkus-Tänze', icon: 'zirkus' };
  var LINES = [
    'Manege frei! Zeig mir, was dein Bauch kann.',
    'Hier gibt es kein Limit, {name}. Nur deinen Körper.',
    'Das Publikum wartet. Noch ein paar Sekunden mehr als letztes Mal?',
    'Ein starker Bauch hält alles zusammen. Auf die Matte!'
  ];

  var RELEVANT = ['abs', 'edit-abs', 'import', 'reset', 'setup'];

  /* ---------- Stoppuhren (bleiben beim Tab-Wechsel erhalten, zusätzlich in sessionStorage) ----------
     watches[exId] = {start: Zeitstempel | null, value: gestoppte Sekunden | null, at: Zeitpunkt des Stopps, reached: bool} */
  var WATCH_KEY = 'op.zirkus.watches';
  var WATCH_MAX_AGE = 2 * 3600000;
  var watches = {};
  try { watches = JSON.parse(sessionStorage.getItem(WATCH_KEY) || '{}') || {}; } catch (e) { watches = {}; }
  // Vergessene Uhren (älter als 2 Stunden, laufend oder gestoppt) nicht wieder anzeigen
  (function () {
    var now = Date.now();
    function old(t) { return t && (now - t > WATCH_MAX_AGE || t > now); }
    for (var k in watches) {
      var w = watches[k];
      if (!w || typeof w !== 'object' || old(w.start) || old(w.at)) delete watches[k];
    }
  })();
  /** Gestoppte Sekunden (> 0), die noch nicht eingetragen wurden, sonst 0 */
  function stoppedSecs(id) {
    var w = watches[id];
    return w && !w.start && w.value > 0 ? w.value : 0;
  }
  function saveWatches() { try { sessionStorage.setItem(WATCH_KEY, JSON.stringify(watches)); } catch (e) { /* egal */ } }
  function running(id) { return !!(watches[id] && watches[id].start); }
  function anyRunning() { for (var k in watches) if (running(k)) return true; return false; }
  function elapsedMs(id) { return running(id) ? Math.max(0, Date.now() - watches[id].start) : 0; }

  /* Letzter Versuch pro Zeit-Übung (nur für die Anzeige "12 von 15 s geschafft") */
  var lastTry = {};

  /* Bildschirm anlassen, solange eine Stoppuhr läuft (wenn der Browser es kann) */
  var wake = null, wakePending = false;
  function syncWakeLock(mounted) {
    var need = mounted && anyRunning();
    try {
      if (need && !wake && !wakePending && navigator.wakeLock && navigator.wakeLock.request) {
        wakePending = true;
        navigator.wakeLock.request('screen').then(function (l) {
          wakePending = false; wake = l;
          l.addEventListener('release', function () { if (wake === l) wake = null; });
          if (!anyRunning()) { wake = null; l.release().catch(function () {}); }
        }).catch(function () { wakePending = false; });
      } else if (!need && wake) {
        var l = wake; wake = null;
        l.release().catch(function () {});
      }
    } catch (e) { /* egal */ }
  }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  OP.screens.register('taverne/zirkus', {
    title: 'Zirkus-Tänze', icon: 'zirkus', tone: 'gold',
    mount: function (el) {
      var bag = OP.ui.cleanup();
      var T = OP.tav;
      var ico = T.ico;
      var seed = Math.random();
      var refs = {};        // exId -> Verweise für die Live-Anzeige der Stoppuhr
      var mounted = true;

      /* ---------- Stoppuhr ---------- */

      function startWatch(id) {
        watches[id] = { start: Date.now(), value: null, reached: false };
        saveWatches();
        OP.ui.haptic(15);
        syncWakeLock(mounted);
        render();
      }

      /** Stoppt die Uhr und schreibt die Sekunden ins Eingabefeld */
      function stopWatch(id) {
        if (!running(id)) return null;
        var secs = Math.floor(elapsedMs(id) / 1000);
        watches[id] = { start: null, value: secs, at: Date.now(), reached: false };
        saveWatches();
        var r = refs[id];
        if (r && r.input) r.input.value = secs > 0 ? String(secs) : '';
        OP.ui.haptic(15);
        syncWakeLock(mounted);
        render();
        return secs;
      }

      function resetWatch(id) {
        delete watches[id];
        saveWatches();
        syncWakeLock(mounted);
      }

      /* ---------- Eintragen ---------- */

      function enterTime(st) {
        var id = st.ex.id, r = refs[id];
        if (running(id)) stopWatch(id);
        r = refs[id];
        var raw = r && r.input ? r.input.value : '';
        // Feld leer, aber die Stoppuhr hat eine Zeit? Dann zählt die gestoppte Zeit ("Jetzt Eintragen drücken")
        if (!String(raw).trim() && stoppedSecs(id)) raw = String(stoppedSecs(id));
        var v = U.parseNum(raw);
        if (!isFinite(v) || v <= 0) {
          OP.ui.toast('Bitte Sekunden eingeben oder die Stoppuhr benutzen.', { type: 'warn' });
          if (r && r.input) r.input.focus();
          return;
        }
        var oldRank = OP.game.absRank();
        var target = (OP.state.abs[id] && OP.state.abs[id].target) || st.target;
        if (r && r.input) r.input.value = '';
        resetWatch(id);
        // Anzeige "12 von 15 s geschafft" nur nach einem Fehlversuch (vor absEnter setzen, weil dabei neu gezeichnet wird)
        if (Math.round(v) < target) lastTry[id] = Math.round(v); else delete lastTry[id];
        var res = OP.game.absEnter(id, v);
        if (!res || !res.ok) {
          delete lastTry[id];
          if (refs[id] && refs[id].input) refs[id].input.value = raw;
          render();
          OP.ui.toast((res && res.error) || 'Eingabe prüfen.', { type: 'warn' });
          return;
        }
        if (res.success) {
          var text = 'Neues Ziel: ' + sec(res.newTarget);
          if (id === 'plank') {
            var nr = OP.game.absRank();
            if (nr.index > oldRank.index) text += ' · Neuer Bauch-Rang: ' + nr.rank.name;
          }
          OP.ui.celebrate({ kicker: st.ex.name + ' · ' + sec(res.value), title: 'Geschafft!', text: text, tone: 'ok', icon: 'bauch' });
        } else {
          OP.ui.toast('Nicht geschafft – Ziel bleibt ' + sec(res.oldTarget) + '. Bestzeit: ' + sec(res.best), { type: 'warn', ms: 4200 });
        }
      }

      function enterReps(st) {
        var id = st.ex.id, r = refs[id];
        var raw = r && r.input ? r.input.value : '';
        var v = U.parseNum(raw);
        if (!isFinite(v) || v <= 0) {
          OP.ui.toast('Bitte die Anzahl Wiederholungen eingeben.', { type: 'warn' });
          if (r && r.input) r.input.focus();
          return;
        }
        if (r && r.input) r.input.value = '';
        var res = OP.game.absEnter(id, v);
        if (!res || !res.ok) {
          if (refs[id] && refs[id].input) refs[id].input.value = raw;
          OP.ui.toast((res && res.error) || 'Eingabe prüfen.', { type: 'warn' });
          return;
        }
        if (res.success) {
          OP.ui.celebrate({ kicker: st.ex.name + ' · ' + U.fmt(res.value) + ' Wdh.', title: 'Geschafft!',
            text: 'Neues Ziel: ' + U.fmt(res.newTarget) + ' Wiederholungen', tone: 'ok', icon: 'bauch' });
        } else {
          OP.ui.haptic(12);
          OP.ui.toast('+' + U.fmt(Math.round(v)) + ' ' + st.ex.name + ' – noch ' + U.fmt(res.left) + ' übrig', { type: 'ok', icon: 'plus' });
        }
      }

      function giveUp(st) {
        OP.ui.confirm('Dein Fortschritt (' + U.fmt(st.progress) + ' von ' + U.fmt(st.target) + ') geht verloren und zählt als nicht geschafft. Das Ziel bleibt ' + U.fmt(st.target) + '.', {
          title: st.ex.name + ' aufgeben?', okLabel: 'Aufgeben', cancelLabel: 'Weitermachen', danger: true
        }).then(function (yes) {
          if (!yes) return;
          if (OP.game.absGiveUp(st.ex.id)) OP.ui.toast('Aufgegeben. Nächstes Mal packst du es.', { type: 'warn' });
        });
      }

      /* ---------- Karten ---------- */

      function entryForm(st, suffix, placeholder, onSubmit, extra) {
        var f = OP.ui.numField({ label: st.ex.unit === 's' ? 'Sekunden' : 'Wiederholungen', suffix: suffix, placeholder: placeholder, integer: true, enterkeyhint: 'done' });
        f.input.setAttribute('data-keep', 'abs-' + st.ex.id);
        var form = h('form', { class: 'tav-entry', onsubmit: function (e) { e.preventDefault(); onSubmit(st); } },
          f.el,
          h('button', { class: 'btn btn--gold tav-entry__btn', type: 'submit' }, ico('check'), 'Eintragen'));
        refs[st.ex.id].input = f.input;
        return h('div', { class: 'tav-entry-wrap' }, form, extra || null);
      }

      function statPill(label, value) {
        return h('span', { class: 'tav-pill' }, h('small', { text: label }), h('b', { class: 'num', text: value }));
      }

      function timeCard(st) {
        var id = st.ex.id;
        var w = watches[id] || null;
        var run = running(id);
        refs[id] = { st: st };

        // Anzeige "x von Ziel s geschafft": laufende Uhr > gestoppte Uhr > letzter Versuch > 0
        var shownSecs = run ? Math.floor(elapsedMs(id) / 1000) : (w && w.value != null ? w.value : (lastTry[id] || 0));
        var reachedNow = st.target > 0 && shownSecs >= st.target;
        var done = h('span', { class: 'num', text: U.fmt(shownSecs) });
        var bar = OP.ui.progress(st.target ? shownSecs / st.target * 100 : 0, { tone: reachedNow ? 'ok' : 'gold' });

        // Stoppuhr
        var ms = run ? elapsedMs(id) : (w && w.value != null ? w.value * 1000 : 0);
        var digits = h('span', { class: 'tav-watch__main num' });
        var tenths = h('span', { class: 'tav-watch__tenth num' });
        var watchBtn = run
          ? h('button', { class: 'btn btn--danger btn--lg tav-watch__btn', type: 'button', onclick: function () { stopWatch(id); } }, ico('stop'), 'Stopp')
          : h('button', { class: 'btn btn--primary btn--lg tav-watch__btn', type: 'button', 'aria-label': w && w.value != null ? 'Stoppuhr neu starten' : 'Stoppuhr starten',
              onclick: function () { startWatch(id); } }, ico('play'), 'Start');
        var watchHint = h('div', { class: 'tav-watch__hint' });
        var watch = h('div', { class: 'tav-watch' + (run ? ' is-running' : '') + (w && w.value != null && !run ? ' is-stopped' : '') },
          h('div', { class: 'tav-watch__face' }, ico('timer', 'tav-watch__ico'), h('span', { class: 'tav-watch__time' }, digits, tenths), watchHint),
          watchBtn);

        refs[id].digits = digits; refs[id].tenths = tenths; refs[id].done = done; refs[id].bar = bar;
        refs[id].hint = watchHint; refs[id].watch = watch;
        setWatchFace(id, ms, st.target);

        // Plank: Bauch-Rang
        var rankRow = null;
        if (id === 'plank') {
          var rk = OP.game.absRank();
          rankRow = h('div', { class: 'tav-abs__rank' },
            h('span', { class: 'small muted', text: 'Bauch-Rang' }),
            OP.ui.rankBadge(rk.rank, { small: true }),
            h('span', { class: 'small muted', text: rk.next ? 'noch ' + sec(rk.toNext) + ' bis ' + rk.next.name : 'Höchster Rang erreicht' }));
        }

        var form = entryForm(st, 's', 'z. B. ' + st.target, enterTime);
        // Gestoppte Zeit nach Tab-Wechsel oder Neuladen wieder ins Feld (getippte Werte stellt keepInputs danach wieder her)
        if (!run && stoppedSecs(id) && refs[id].input) refs[id].input.value = String(stoppedSecs(id));

        return h('article', { class: 'card card--gold tav-card tav-abs tav-abs--time' + (run ? ' is-live' : ''), dataset: { ex: id } },
          h('div', { class: 'tav-abs__head' },
            h('span', { class: 'tav-abs__badge' }, ico('bauch')),
            h('h3', { class: 'tav-abs__name', text: st.ex.name }),
            h('span', { class: 'chip chip--muted tav-abs__unit', text: 'Zeit' })),
          h('div', { class: 'tav-abs__big' }, h('span', { text: st.ex.name + ':' }), ' ', h('b', { class: 'num', text: sec(st.target) })),
          h('div', { class: 'tav-abs__sub' }, done, ' von ' + sec(st.target) + ' geschafft'),
          bar,
          watch,
          form,
          h('div', { class: 'tav-abs__stats' },
            statPill('Bestzeit', st.best ? sec(st.best) : '–'),
            statPill('Erfolge', U.fmt(st.wins)),
            statPill('Verfehlt', U.fmt(st.fails))),
          rankRow,
          st.ex.hint ? h('p', { class: 'tav-abs__hint', text: st.ex.hint }) : null);
      }

      function repsCard(st) {
        var id = st.ex.id;
        refs[id] = { st: st };
        var pct = st.target ? st.progress / st.target * 100 : 0;

        var restChip = st.left > 0
          ? h('button', { class: 'chip chip--btn tav-rest', type: 'button', onclick: function () {
              var r = refs[id]; if (r && r.input) { r.input.value = String(st.left); r.input.focus(); }
            } }, ico('plus'), (st.progress > 0 ? 'Rest: ' : 'Alle ') + U.fmt(st.left))
          : null;
        var giveUpBtn = st.progress > 0
          ? h('button', { class: 'btn btn--ghost btn--sm tav-giveup', type: 'button', onclick: function () { giveUp(st); } }, ico('flag'), 'Aufgeben')
          : null;

        return h('article', { class: 'card card--gold tav-card tav-abs tav-abs--reps', dataset: { ex: id } },
          h('div', { class: 'tav-abs__head' },
            h('span', { class: 'tav-abs__badge' }, ico('bauch')),
            h('h3', { class: 'tav-abs__name', text: st.ex.name }),
            h('span', { class: 'chip chip--muted tav-abs__unit', text: 'Wdh.' })),
          h('div', { class: 'tav-abs__big' }, h('span', { text: st.ex.name + ' übrig:' }), ' ', h('b', { class: 'num', text: U.fmt(st.left) })),
          h('div', { class: 'tav-abs__sub' }, h('span', { class: 'num', text: U.fmt(st.progress) }), ' von ' + U.fmt(st.target)),
          OP.ui.progress(pct, { tone: 'gold' }),
          entryForm(st, 'Wdh.', 'z. B. ' + Math.min(st.left || st.target, 10), enterReps,
            (restChip || giveUpBtn) ? h('div', { class: 'tav-entry__extra' }, restChip, h('span', { class: 'spacer' }), giveUpBtn) : null),
          h('div', { class: 'tav-abs__stats' },
            statPill('Bestwert', st.best ? U.fmt(st.best) : '–'),
            statPill('Erfolge', U.fmt(st.wins)),
            statPill('Aufgegeben', U.fmt(st.fails))),
          st.ex.hint ? h('p', { class: 'tav-abs__hint', text: st.ex.hint }) : null);
      }

      /* ---------- Live-Anzeige der Stoppuhr ---------- */

      function setWatchFace(id, ms, target) {
        var r = refs[id];
        if (!r || !r.digits) return;
        var total = Math.floor(ms / 100);           // Zehntel
        var s = Math.floor(total / 10);
        r.digits.textContent = pad2(Math.floor(s / 60)) + ':' + pad2(s % 60);
        r.tenths.textContent = ',' + (total % 10);
        var run = running(id), reached = s >= target && target > 0;
        var stopped = !run && watches[id] && watches[id].value != null;
        r.watch.classList.toggle('is-reached', reached && (run || stopped));
        if (run) r.hint.textContent = reached ? 'Ziel geschafft! Halte weiter oder stopp.' : 'Noch ' + sec(target - s) + ' bis zum Ziel';
        else if (stopped && stoppedSecs(id)) r.hint.textContent = 'Gestoppt. Jetzt Eintragen drücken.';
        else if (stopped) r.hint.textContent = 'Unter 1 Sekunde. Starte neu.';
        else r.hint.textContent = 'Stoppuhr starten, wenn du in Position bist.';
      }

      function tick() {
        if (!anyRunning()) return;
        Object.keys(refs).forEach(function (id) {
          var r = refs[id];
          if (!r || !r.digits || !running(id)) return;
          var target = r.st.target, ms = elapsedMs(id), s = Math.floor(ms / 1000);
          setWatchFace(id, ms, target);
          r.done.textContent = U.fmt(s);
          OP.ui.setProgress(r.bar, target ? s / target * 100 : 0, null, s >= target ? 'ok' : 'gold');
          // Ziel gerade erreicht: kurz vibrieren
          var w = watches[id];
          if (s >= target && w && !w.reached) {
            w.reached = true; saveWatches();
            OP.ui.haptic([40, 60, 40]);
          }
        });
      }

      /* ---------- Aufbau ---------- */

      function build() {
        refs = {};
        var list = [];
        try { list = OP.game.absStatus(); } catch (e) { list = []; }
        var cards = list.map(function (st) {
          if (!st || !st.ex) return null;
          return st.ex.unit === 's' ? timeCard(st) : repsCard(st);
        });

        var inner = h('div', { class: 'screen__inner tav tav--zirkus' },
          T.merchant(NPC, T.greet(LINES, seed)),
          T.infoLine(('Kein Limit. Das Limit ist dein Körper. Jeder Erfolg erhöht das Ziel: ' + stepRules() + '.').replace(/\.\.$/, '.'), 'info'),
          OP.ui.sectionTitle('Bauch-Challenges', 'bauch'),
          h('div', { class: 'tav-grid tav-abs-grid' }, cards));

        el.innerHTML = '';
        el.appendChild(inner);
      }

      function render() { T.keepInputs(el, build); }

      render();
      syncWakeLock(true);
      bag.interval(tick, 100);
      bag.on('change', function (e) {
        var reason = (e && e.reason) || '';
        if (RELEVANT.indexOf(reason) >= 0) render();
      });
      // Nach dem Zurückkommen (Bildschirm war aus) Wake Lock neu holen
      function onVis() { if (!document.hidden) syncWakeLock(mounted); }
      document.addEventListener('visibilitychange', onVis);
      bag.add(function () { document.removeEventListener('visibilitychange', onVis); });
      bag.add(function () { mounted = false; syncWakeLock(false); });
      return bag.run;
    }
  });
})();
