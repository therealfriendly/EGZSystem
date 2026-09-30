/* Operator – Taverne, Tab "Zirkus-Tänze" (Screen 'taverne/zirkus')
   Ein Zirkus-Tanz = alle 5 Bauch-Übungen zusammen: Plank, Seitlicher Plank links und rechts (Sekunden),
   Crunches und Sit-ups (Wiederholungen). Nach dem Start führt der Tanz durch alle Übungen (Punkte 1–5);
   jede Übung wird einmal eingetragen oder ausgelassen. Die Regeln stehen in OP.game.danceEnter:
   geschafft (>= angezeigtes Ziel) -> neues Ziel = besserer Wert (geschafft oder Ziel + Schritt), sonst bleibt das Ziel.
   Zirkus-Sperre: 2 Tage ohne Eintrag sperren Arena, Gym, Abenteuer und Schmuggler. Ein Eintrag entsperrt alles.
   Für die Zeit-Übungen gibt es eine Stoppuhr. Sie läuft beim Tab-Wechsel und Neuladen weiter (sessionStorage). */
(function () {
  'use strict';
  var OP = window.OP;
  var U = OP.util, h = OP.h, D = OP.data;

  var NF = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 2 });

  function isTime(ex) { return !!ex && ex.unit === 's'; }
  /** Sekunden immer als "90 s" (nie "1:30 min"). Zahl und Einheit mit geschütztem Leerzeichen (kein Umbruch dazwischen) */
  function sec(n) { return U.fmt(n) + ' s'; }
  /** Wert mit Einheit: "30 s" oder "11 Wdh." */
  function valText(ex, n) { return isTime(ex) ? sec(n) : U.fmt(n) + ' Wdh.'; }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function agoText(days) { return days <= 0 ? 'heute' : days === 1 ? 'gestern' : 'vor ' + days + ' Tagen'; }
  /** Nach einem Erfolg: "Neues Ziel: 16 Wdh." – oder, wenn die abgerundete Anzeige gleich bleibt
      (Crunches 15 -> 15,5 zeigt weiter 15): "Ziel +0,5 (angezeigt: 15 Wdh.)" */
  function newTargetText(ex, oldTarget, newTarget) {
    var shownNew = OP.game.absShown(ex, newTarget);
    if (shownNew !== OP.game.absShown(ex, oldTarget) || !(newTarget > oldTarget)) return 'Neues Ziel: ' + valText(ex, shownNew);
    return 'Ziel +' + NF.format(Math.round((newTarget - oldTarget) * 100) / 100) + ' (angezeigt: ' + valText(ex, shownNew) + ')';
  }
  /* Kurze Namen unter den Punkten 1–5 (müssen auch auf schmalen Handys ganz passen) */
  var STEP_LABELS = { plank: 'Plank', seitplank_l: 'Seite L', seitplank_r: 'Seite R', crunches: 'Crunches', situps: 'Sit-ups' };
  function stepLabel(ex) { return STEP_LABELS[ex.id] || ex.short || ex.name; }

  var NPC = { id: 'zirkus', name: 'Direktorin Madame Rune', role: 'Zirkus-Tänze', icon: 'zirkus' };
  var LINES = [
    'Manege frei! Fünf Übungen, ein Tanz. Zeig mir, was dein Bauch kann.',
    'Hier gibt es kein Limit, {name}. Nur deinen Körper.',
    'Das Publikum wartet. Schaffst du heute ein bisschen mehr als letztes Mal?',
    'Ein starker Bauch hält alles zusammen. Auf die Matte!'
  ];
  var LINES_LOCKED = [
    'Die Tore sind zu, {name}. Ein Tanz – und alles geht wieder auf.',
    'Ohne Tanz geht hier nichts. Ein einziger Eintrag reicht mir.'
  ];

  // Änderungen, bei denen sich die Anzeige ändern kann
  var RELEVANT = ['abs', 'dance-start', 'dance-skip', 'dance-end', 'edit-abs', 'decay', 'new-day',
    'import', 'reset', 'setup', 'sync'];

  /* ---------- Regeln als Text (Zahlen aus OP.data) ----------
     "Plank und seitliche Planks: +1 s pro Erfolg, −1 s alle 14 Tage. Crunches und Sit-ups: +0,5 pro Erfolg, −0,1 pro Tag. ..." */
  function groupLabel(g) {
    var ids = g.ids.join(',');
    if (ids === 'plank,seitplank_l,seitplank_r') return 'Plank und seitliche Planks';
    if (ids === 'crunches,situps') return 'Crunches und Sit-ups';
    return OP.tav.joinAnd(g.names);
  }
  function rulesText() {
    var groups = [];
    (D.ABS_EXERCISES || []).forEach(function (ex) {
      var dec = ex.decay || {};
      var key = ex.unit + '|' + ex.step + '|' + dec.amount + '|' + dec.everyDays;
      var g = null;
      groups.forEach(function (x) { if (x.key === key) g = x; });
      if (!g) { g = { key: key, ex: ex, ids: [], names: [] }; groups.push(g); }
      g.ids.push(ex.id); g.names.push(ex.name);
    });
    var parts = groups.map(function (g) {
      var ex = g.ex, dec = ex.decay || {}, u = isTime(ex) ? ' s' : '';
      var t = groupLabel(g) + ': +' + NF.format(ex.step) + u + ' pro Erfolg';
      if (dec.amount) t += ', −' + NF.format(dec.amount) + u + (dec.everyDays > 1 ? ' alle ' + dec.everyDays + ' Tage' : ' pro Tag');
      return t + '.';
    });
    parts.push('Angezeigt wird abgerundet. Schaffst du mehr als das Ziel, zählt der bessere Wert.');
    return parts.join(' ');
  }
  function lockRuleText() {
    var n = D.CIRCUS_LOCK_DAYS || 2;
    return 'Machst du ' + n + ' Tage keinen Tanz, werden ' + OP.tav.lockedAreaText() +
      ' gesperrt. Ein einziger Eintrag entsperrt alles – auch wenn du das Ziel nicht schaffst.';
  }

  /** Tag des letzten ECHTEN Zirkus-Eintrags (nicht der Start der Schonfrist nach Einrichtung/Update) oder null.
      li = OP.game.lockInfo(). Ältere Spielstände ohne lastEntryDay: im Protokoll nachsehen. */
  function lastEntryDay(li) {
    if (li.lastEntryDay) return li.lastEntryDay;
    return li.lastDay && dancedOn(li.lastDay) ? li.lastDay : null;
  }

  /* ---------- Aus dem Protokoll (OP.state.log, zeitlich sortiert) ---------- */

  /** Gab es an diesem Tag einen echten Zirkus-Eintrag? */
  function dancedOn(day) {
    var log = (OP.state && OP.state.log) || [];
    for (var i = log.length - 1; i >= 0; i--) {
      var e = log[i];
      if (!e || typeof e !== 'object') continue;
      if (e.day < day) break;
      if (e.day === day && e.type === 'abs') return true;
    }
    return false;
  }
  /** Heutige Ergebnisse je Übung (letzter Eintrag zählt) und letzter heutiger Tanz */
  function todayInfo() {
    var res = {}, dance = null, today = U.today(), log = (OP.state && OP.state.log) || [];
    for (var i = log.length - 1; i >= 0; i--) {
      var e = log[i];
      if (!e || typeof e !== 'object') continue;
      if (e.day < today) break;
      if (e.day !== today) continue;
      if (e.type === 'abs' && e.ex && !res[e.ex]) res[e.ex] = { value: Number(e.value) || 0, won: !!e.won };
      if (e.type === 'dance' && !dance && e.entered > 0) dance = { entered: e.entered, wins: e.wins || 0 };
    }
    // Ein offener Tanz von gestern wird heute beim Start geschlossen (Protokoll-Tag = heute) – das ist kein Tanz von heute
    if (!Object.keys(res).length) dance = null;
    return { results: res, dance: dance };
  }

  /* ---------- Stoppuhren (bleiben beim Tab-Wechsel erhalten, zusätzlich in sessionStorage) ----------
     watches[exId] = {start: Zeitstempel | null, value: gestoppte Sekunden | null, at: Zeitpunkt des Stopps, reached: bool} */
  var WATCH_KEY = 'op.zirkus.watches';
  var WATCH_MAX_AGE = 2 * 3600000;
  var watches = {};
  try { watches = JSON.parse(sessionStorage.getItem(WATCH_KEY) || '{}') || {}; } catch (e) { watches = {}; }
  if (!watches || typeof watches !== 'object') watches = {};
  /** Vergessene Uhren (älter als 2 Stunden) und alte Übungen (z. B. 'seitplank' aus Version 1) nicht wieder anzeigen */
  function pruneWatches() {
    var now = Date.now(), changed = false;
    function old(t) { return t && (now - t > WATCH_MAX_AGE || t > now); }
    for (var k in watches) {
      var w = watches[k];
      if (!w || typeof w !== 'object' || !isTime(D.absExercise(k)) || old(w.start) || old(w.at)) { delete watches[k]; changed = true; }
    }
    if (changed) saveWatches();
  }
  function saveWatches() { try { sessionStorage.setItem(WATCH_KEY, JSON.stringify(watches)); } catch (e) { /* egal */ } }
  pruneWatches();
  function running(id) { return !!(watches[id] && watches[id].start); }
  function anyRunning() { for (var k in watches) if (running(k)) return true; return false; }
  function elapsedMs(id) { return running(id) ? Math.max(0, Date.now() - watches[id].start) : 0; }
  /** Gestoppte Sekunden (> 0), die noch nicht eingetragen wurden, sonst 0 */
  function stoppedSecs(id) {
    var w = watches[id];
    return w && !w.start && w.value > 0 ? w.value : 0;
  }
  function resetWatch(id) { if (watches[id]) { delete watches[id]; saveWatches(); } }
  function clearWatches() { if (Object.keys(watches).length) { watches = {}; saveWatches(); } }

  /* Bildschirm anlassen, solange eine Stoppuhr läuft (wenn der Browser es kann) */
  var wake = null, wakePending = false, wakeWanted = false;
  function syncWakeLock(mounted) {
    var need = mounted && anyRunning();
    wakeWanted = need;
    try {
      if (need && !wake && !wakePending && navigator.wakeLock && navigator.wakeLock.request) {
        wakePending = true;
        navigator.wakeLock.request('screen').then(function (l) {
          wakePending = false; wake = l;
          l.addEventListener('release', function () { if (wake === l) wake = null; });
          // inzwischen nicht mehr gebraucht (Uhr gestoppt oder Bildschirm verlassen)? Sofort wieder freigeben
          if (!wakeWanted || !anyRunning()) { wake = null; l.release().catch(function () {}); }
        }).catch(function () { wakePending = false; });
      } else if (!need && wake) {
        var l = wake; wake = null;
        l.release().catch(function () {});
      }
    } catch (e) { /* egal */ }
  }

  /* Bleibt beim Tab-Wechsel erhalten: gewählte Übung im Tanz und das letzte Ergebnis ("Geschafft! ...") */
  var pickId = null;
  var flash = null;   // {kind:'ok'|'fail'|'skip', text, sub, t}

  OP.screens.register('taverne/zirkus', {
    title: 'Zirkus-Tänze', icon: 'zirkus', tone: 'gold',
    mount: function (el) {
      var bag = OP.ui.cleanup();
      var T = OP.tav;
      var ico = T.ico;
      var seed = Math.random();
      var alive = true;
      var cur = null;   // Verweise der aktuellen Übung für die Live-Anzeige

      function lockInfo() {
        try { return OP.game.lockInfo(); } catch (e) { return { locked: false, days: 0, lastDay: null, warn: false, text: D.LOCK_TEXT }; }
      }

      /* ---------- Stoppuhr ---------- */

      function startWatch(id) {
        watches[id] = { start: Date.now(), value: null, reached: false };
        saveWatches();
        OP.ui.haptic(15);
        syncWakeLock(alive);
        render();
      }

      /** Stoppt die Uhr und schreibt die Sekunden ins Eingabefeld. silent = ohne Neuzeichnen (beim Eintragen) */
      function stopWatch(id, silent) {
        if (!running(id)) return 0;
        var secs = Math.floor(elapsedMs(id) / 1000);
        watches[id] = { start: null, value: secs, at: Date.now(), reached: false };
        saveWatches();
        if (cur && cur.id === id && cur.input) cur.input.value = secs > 0 ? String(secs) : '';
        OP.ui.haptic(15);
        syncWakeLock(alive);
        if (!silent) render();
        return secs;
      }

      function setWatchFace(ms) {
        if (!cur || !cur.digits) return;
        var total = Math.floor(ms / 100);           // Zehntel
        var s = Math.floor(total / 10), need = cur.need;
        cur.digits.textContent = pad2(Math.floor(s / 60)) + ':' + pad2(s % 60);
        cur.tenths.textContent = ',' + (total % 10);
        var run = running(cur.id), reached = need > 0 && s >= need;
        var stopped = !run && watches[cur.id] && watches[cur.id].value != null;
        cur.watch.classList.toggle('is-reached', reached && (run || stopped));
        if (run) cur.hint.textContent = reached ? 'Ziel geschafft! Halte weiter oder stopp.' : 'Noch ' + sec(need - s) + ' bis zum Ziel';
        else if (stopped && stoppedSecs(cur.id)) cur.hint.textContent = 'Gestoppt. Jetzt Eintragen drücken.';
        else if (stopped) cur.hint.textContent = 'Unter 1 Sekunde. Starte neu.';
        else cur.hint.textContent = 'Starte die Uhr, wenn du in Position bist.';
      }

      /** Zahl, die gerade als "x von Ziel" gilt: laufende Uhr, sonst das Eingabefeld */
      function liveNumber() {
        if (!cur) return 0;
        if (cur.time && running(cur.id)) return Math.floor(elapsedMs(cur.id) / 1000);
        var v = U.parseNum(cur.input ? cur.input.value : '');
        return isFinite(v) && v > 0 ? Math.floor(v + 1e-9) : 0;
      }

      /** "Plank: 30 s / 12 von 30 s geschafft" bzw. "Crunches übrig: 3 / 8 von 11" und Balken aktualisieren */
      function updateLive() {
        if (!cur || !cur.bar) return;
        var n = liveNumber(), need = cur.need, reached = need > 0 && n >= need;
        cur.doneNum.textContent = U.fmt(n);
        cur.bigVal.textContent = cur.time ? sec(need) : U.fmt(Math.max(0, need - n));
        OP.ui.setProgress(cur.bar, need > 0 ? n / need * 100 : 0, null, reached ? 'ok' : 'gold');
        if (cur.root) cur.root.classList.toggle('is-reached', reached);
      }

      function tick() {
        if (!alive || !cur || !cur.time || !running(cur.id)) return;
        var ms = elapsedMs(cur.id);
        setWatchFace(ms);
        updateLive();
        // Ziel gerade erreicht: kurz vibrieren
        var w = watches[cur.id];
        if (w && !w.reached && cur.need > 0 && Math.floor(ms / 1000) >= cur.need) {
          w.reached = true; saveWatches();
          OP.ui.haptic([40, 60, 40]);
        }
      }

      /* ---------- Aktionen ---------- */

      /** Nach einer Aktion den Tanz zeigen. Niedriger Bildschirm (Handy quer): Ergebnis bzw. Punkte ganz nach oben. */
      function scrollToDance() {
        var card = el.querySelector('.tav-dance');
        if (!card) return;
        var short = el.clientHeight < 480;
        var target = short ? (el.querySelector('.tav-flash') || el.querySelector('.tav-steps') || card) : card;
        var top = target.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop - 10;
        if (short || top < el.scrollTop) el.scrollTop = Math.max(0, top);
      }

      function startDance() {
        try { OP.game.danceStart(); } catch (e) { OP.ui.toast('Der Tanz konnte nicht starten.', { type: 'err' }); return; }
        pickId = null; flash = null;
        OP.ui.haptic([15, 30, 15]);
        render();
        el.scrollTop = 0;
        if (el.clientHeight < 480) scrollToDance();
      }

      function unlockedCelebration() {
        OP.ui.celebrate({
          kicker: 'Zirkus-Sperre aufgehoben', title: 'Entsperrt!',
          text: T.lockedAreaText() + ' sind wieder frei.', icon: 'unlock', tone: 'ok'
        });
      }

      /** Zusammenfassung nach dem Tanz {list, entered, wins, total} */
      function showFinished(sum) {
        flash = null; pickId = null;
        clearWatches();
        syncWakeLock(alive);
        if (!sum) return;
        if (!sum.entered) { OP.ui.toast('Tanz beendet. Nichts eingetragen.', { type: 'info' }); return; }
        var skipped = Math.max(0, sum.total - sum.entered), perfect = sum.wins === sum.total;
        var skipText = skipped ? skipped + (skipped === 1 ? ' Übung' : ' Übungen') + ' ausgelassen. ' : '';
        OP.ui.celebrate({
          kicker: 'Tanz beendet',
          title: sum.wins + ' von ' + sum.total + ' geschafft',
          text: perfect ? 'Perfekter Tanz! Alle Ziele sind gestiegen.'
            : sum.wins > 0 ? skipText + 'Deine neuen Ziele stehen in der Übersicht.'
            : skipText + 'Die Ziele bleiben. Nächstes Mal packst du es.',
          tone: 'ok', icon: perfect ? 'trophy' : 'zirkus'
        });
      }

      function enter() {
        if (!cur) return;
        var c = cur, id = c.id, ex = c.ex;
        if (c.time && running(id)) stopWatch(id, true);   // Uhr läuft noch? Dann zählt die Zeit bis jetzt
        var raw = c.input ? String(c.input.value || '') : '';
        if (!raw.trim() && c.time && stoppedSecs(id)) raw = String(stoppedSecs(id));
        var v = U.parseNum(raw);
        if (!isFinite(v) || v <= 0) {
          OP.ui.toast(c.time ? 'Bitte Sekunden eingeben oder die Stoppuhr benutzen.' : 'Bitte die Anzahl Wiederholungen eingeben.', { type: 'warn' });
          if (c.time) render();
          try { if (cur && cur.input) cur.input.focus(); } catch (e) { /* egal */ }
          return;
        }
        var oldRank = OP.game.absRank();
        if (c.input) c.input.value = '';     // sonst stellt keepInputs den Wert beim Neuzeichnen wieder her
        var res = OP.game.danceEnter(id, v);
        if (!res || !res.ok) {
          if (c.input) c.input.value = raw;
          OP.ui.toast((res && res.error) || 'Eingabe prüfen.', { type: 'warn' });
          if (c.time) render(); else updateLive();
          return;
        }
        resetWatch(id);
        syncWakeLock(alive);
        pickId = null;
        OP.ui.haptic(res.success ? [30, 40, 60] : [20, 30, 20]);
        flash = {
          kind: res.success ? 'ok' : 'fail', t: Date.now(),
          text: res.success ? 'Geschafft! ' + newTargetText(ex, res.oldTarget, res.newTarget) : 'Nicht geschafft – Ziel bleibt ' + valText(ex, res.oldShown),
          sub: ex.name + ': ' + valText(ex, res.value) + ' eingetragen'
        };
        if (id === 'plank') {
          var nr = OP.game.absRank();
          if (nr.index > oldRank.index) flash.sub += ' · Neuer Bauch-Rang: ' + nr.rank.name;
        }
        if (res.unlocked) flash.sub += ' · Zirkus-Sperre aufgehoben';
        if (res.unlocked) unlockedCelebration();
        if (res.finished) { showFinished(res.finished); render(); el.scrollTop = 0; return; }
        render();
        scrollToDance();
      }

      function skip() {
        if (!cur) return;
        var c = cur, id = c.id;
        var res = OP.game.danceSkip(id);
        if (!res || !res.ok) { OP.ui.toast((res && res.error) || 'Geht gerade nicht.', { type: 'warn' }); render(); return; }
        resetWatch(id);
        syncWakeLock(alive);
        pickId = null;
        OP.ui.haptic(10);
        // Der Sperr-Satz wird erst beim Zeichnen angehängt (flashBox), damit er nach dem Entsperren sofort verschwindet
        flash = {
          kind: 'skip', t: Date.now(),
          text: c.ex.name + ' ausgelassen',
          sub: 'Keine Wertung, das Ziel bleibt ' + valText(c.ex, c.need) + '.'
        };
        if (res.finished) { showFinished(res.finished); render(); el.scrollTop = 0; return; }
        render();
        scrollToDance();
      }

      function finishEarly() {
        var ds = OP.game.danceStatus();
        if (!ds.active) { render(); return; }
        var open = ds.total - ds.doneCount;
        var timing = false;
        ds.list.forEach(function (it) { if (!it.entry && running(it.ex.id)) timing = true; });
        var text = (open === 1 ? 'Die offene Übung zählt als ausgelassen.' : 'Die ' + open + ' offenen Übungen zählen als ausgelassen.') +
          (ds.doneCount ? ' Deine Einträge bleiben gewertet.' : '') +
          (timing ? ' Die laufende Stoppuhr wird nicht eingetragen.' : '');
        OP.ui.confirm(text, { title: 'Tanz beenden?', okLabel: 'Tanz beenden', cancelLabel: 'Weitertanzen' }).then(function (yes) {
          if (!yes) return;
          var sum = OP.game.danceFinish();
          showFinished(sum);
          render();
          el.scrollTop = 0;
        });
      }

      /* ---------- Teile ---------- */

      function pill(label, value) {
        return h('span', { class: 'tav-pill' }, h('small', { text: label }), h('b', { class: 'num', text: value }));
      }

      /** Oben: gesperrt (stark), morgen gesperrt (Warnung) oder frei.
          Wird bei jeder Änderung neu gebaut – nach dem entsperrenden Eintrag steht hier sofort "frei". */
      function statusCard(li) {
        var entryDay = lastEntryDay(li);
        var last = entryDay ? 'Letzter Tanz: ' + agoText(Math.max(0, U.diffDays(entryDay, U.today()))) : '';
        if (li.locked) {
          return h('section', { class: 'card tav-card tav-zstatus tav-zstatus--locked', role: 'alert' },
            h('span', { class: 'tav-zstatus__icon' }, ico('lock')),
            h('div', { class: 'tav-zstatus__body' },
              h('b', { class: 'tav-zstatus__title', text: li.text || D.LOCK_TEXT }),
              h('p', { class: 'tav-zstatus__text', text: 'Ein einziger Eintrag entsperrt ' + T.lockedAreaText() + ' – das Ziel musst du nicht schaffen.' }),
              last ? h('p', { class: 'tav-zstatus__meta', text: last }) : null));
        }
        if (li.warn) {
          return h('section', { class: 'card tav-card tav-zstatus tav-zstatus--warn', role: 'status' },
            h('span', { class: 'tav-zstatus__icon' }, ico('warning')),
            h('div', { class: 'tav-zstatus__body' },
              h('b', { class: 'tav-zstatus__title', text: 'Morgen ist alles gesperrt, wenn du heute keinen Tanz machst.' }),
              h('p', { class: 'tav-zstatus__meta', text: (last ? last + '. ' : '') + 'Ein Eintrag heute reicht.' })));
        }
        // letzter Tag, an dem ein Tanz die Sperre noch verhindert
        var n = (D.CIRCUS_LOCK_DAYS || 2) - 1 - (li.days || 0);
        var when = n <= 0 ? 'heute' : n === 1 ? 'morgen' : n === 2 ? 'übermorgen' : 'in ' + n + ' Tagen';
        return h('section', { class: 'card tav-card tav-zstatus tav-zstatus--ok', role: 'status' },
          h('span', { class: 'tav-zstatus__icon' }, ico('unlock')),
          h('div', { class: 'tav-zstatus__body' },
            h('b', { class: 'tav-zstatus__title', text: last || 'Alles frei' }),
            li.lastDay ? h('p', { class: 'tav-zstatus__meta', text: (last ? 'Alles frei. Tanze spätestens ' + when + ' wieder.' : 'Tanze spätestens ' + when + '.') }) : null));
      }

      /** Kein Tanz läuft: die 5 Übungen mit Ziel und Bestwert, großer Start-Knopf */
      function overviewCard(li) {
        var list = [];
        try { list = OP.game.absStatus(); } catch (e) { list = []; }
        var today = todayInfo();
        var rows = list.map(function (it, i) {
          var r = today.results[it.ex.id];
          return h('li', { class: 'tav-zrow' },
            h('span', { class: 'tav-zrow__n num', text: String(i + 1) }),
            h('span', { class: 'tav-zrow__main' },
              h('b', { class: 'tav-zrow__name', text: it.ex.name }),
              h('span', { class: 'tav-zrow__meta' },
                h('span', { text: 'Bestwert: ' + (it.best ? valText(it.ex, it.best) : '–') }),
                r ? h('span', { class: 'tav-today ' + (r.won ? 'is-ok' : 'is-fail'), title: r.won ? 'Heute geschafft' : 'Heute nicht geschafft' },
                  ico(r.won ? 'check' : 'close'), 'Heute ' + valText(it.ex, r.value)) : null)),
            h('span', { class: 'tav-zrow__need' },
              h('small', { text: 'Ziel' }),
              h('b', { class: 'num', text: isTime(it.ex) ? sec(it.shown) : U.fmt(it.shown) })));
        });
        var total = list.length || (D.ABS_EXERCISES || []).length;
        // Start-Knopf vor der Liste: soll auch auf kleinen Handys ohne Scrollen sichtbar sein
        return h('section', { class: 'card card--gold tav-card tav-zover' },
          h('div', { class: 'tav-zover__head' },
            h('span', { class: 'tav-zover__badge' }, ico('zirkus')),
            h('div', { class: 'tav-zover__titles' },
              h('h3', { class: 'tav-zover__title', text: 'Zirkus-Tanz' }),
              h('span', { class: 'tav-zover__sub', text: total + ' Übungen in einem Tanz' }))),
          h('p', { class: 'tav-zover__text', text: 'Der Tanz führt dich durch alle Übungen. Jede trägst du einmal ein – oder lässt sie aus.' }),
          today.dance ? h('p', { class: 'tav-zover__last' }, ico('check'),
            h('span', { text: 'Heute getanzt: ' + today.dance.wins + ' von ' + total + ' geschafft. Noch eine Runde geht immer.' })) : null,
          h('button', { class: 'btn btn--gold btn--lg btn--block tav-zover__start', type: 'button', onclick: startDance }, ico('play'), 'Tanz starten'),
          li.locked ? h('p', { class: 'tav-zover__unlock' }, ico('unlock'), h('span', { text: 'Schon der erste Eintrag entsperrt alles.' })) : null,
          h('div', { class: 'tav-zover__label', text: 'Deine Ziele im Tanz' }),
          h('ol', { class: 'tav-zrows' }, rows));
      }

      /** Punkte 1–5: erledigt (geschafft / nicht geschafft / ausgelassen), jetzt dran, offen. Offene sind antippbar. */
      function stepsBar(list, curIt) {
        var NAMES = { ok: 'geschafft', fail: 'nicht geschafft', skip: 'ausgelassen', cur: 'jetzt dran', open: 'offen' };
        return h('ol', { class: 'tav-steps', 'aria-label': 'Übungen im Tanz' }, list.map(function (it, i) {
          var e = it.entry;
          var state = e ? (e.skipped ? 'skip' : e.success ? 'ok' : 'fail') : (it === curIt ? 'cur' : 'open');
          var timing = !e && running(it.ex.id);
          var dot = state === 'ok' ? ico('check') : state === 'fail' ? ico('close') : state === 'skip' ? ico('minus')
            : h('span', { class: 'num', text: String(i + 1) });
          return h('li', { class: 'tav-steps__item is-' + state },
            h('button', {
              class: 'tav-step is-' + state + (timing ? ' is-timing' : ''), type: 'button', disabled: !!e,
              'aria-label': (i + 1) + '. ' + it.ex.name + ': ' + NAMES[state] + (timing ? ' (Stoppuhr läuft)' : ''),
              'aria-current': state === 'cur' ? 'step' : null,
              onclick: function () { if (state === 'open') { pickId = it.ex.id; render(); scrollToDance(); } }
            },
              h('span', { class: 'tav-step__dot' }, dot),
              h('span', { class: 'tav-step__label', text: stepLabel(it.ex) })));
        }));
      }

      function flashBox(li) {
        if (!flash) return null;
        var k = flash.kind, fresh = Date.now() - (flash.t || 0) < 700;
        var sub = flash.sub || '';
        if (k === 'skip' && li.locked) sub += ' Zum Entsperren brauchst du einen Eintrag.';
        return h('div', { class: 'tav-flash tav-flash--' + k + (fresh ? ' is-new' : ''), role: 'status' },
          h('span', { class: 'tav-flash__icon' }, ico(k === 'ok' ? 'check' : k === 'fail' ? 'close' : 'next')),
          h('div', { class: 'tav-flash__body' },
            h('div', { class: 'tav-flash__title', text: flash.text }),
            sub ? h('div', { class: 'tav-flash__sub', text: sub }) : null));
      }

      function watchBlock(id) {
        var w = watches[id] || null, run = running(id);
        var digits = h('span', { class: 'tav-watch__main num' });
        var tenths = h('span', { class: 'tav-watch__tenth num' });
        var hint = h('div', { class: 'tav-watch__hint' });
        var btn = run
          ? h('button', { class: 'btn btn--danger btn--lg tav-watch__btn', type: 'button', onclick: function () { stopWatch(id); } }, ico('stop'), 'Stopp')
          : h('button', { class: 'btn btn--primary btn--lg tav-watch__btn', type: 'button',
              'aria-label': w && w.value != null ? 'Stoppuhr neu starten' : 'Stoppuhr starten',
              onclick: function () { startWatch(id); } }, ico('play'), 'Start');
        var box = h('div', { class: 'tav-watch' + (run ? ' is-running' : '') + (w && w.value != null && !run ? ' is-stopped' : '') },
          h('div', { class: 'tav-watch__face' }, ico('timer', 'tav-watch__ico'), h('span', { class: 'tav-watch__time' }, digits, tenths), hint),
          btn);
        cur.digits = digits; cur.tenths = tenths; cur.hint = hint; cur.watch = box;
        setWatchFace(run ? elapsedMs(id) : (w && w.value != null ? w.value * 1000 : 0));
        return box;
      }

      /** Die aktuelle Übung groß: "Plank: 30 s / 0 von 30 s geschafft" oder "Crunches übrig: 11 / 0 von 11" */
      function exerciseBlock(it, idx, total) {
        var ex = it.ex, id = ex.id, time = isTime(ex), need = it.shown;
        var run = running(id);
        cur = { id: id, ex: ex, need: need, time: time };

        var bigVal = h('b', { class: 'num' });
        var doneNum = h('b', { class: 'num', text: '0' });
        var bar = OP.ui.progress(0, { tone: 'gold' });
        cur.bigVal = bigVal; cur.doneNum = doneNum; cur.bar = bar;

        var f = OP.ui.numField({ label: time ? 'Sekunden' : 'Wiederholungen', suffix: time ? 's' : 'Wdh.', placeholder: 'z. B. ' + need, integer: true, enterkeyhint: 'done' });
        f.input.setAttribute('data-keep', 'dance-' + id);
        f.input.addEventListener('input', updateLive);
        cur.input = f.input;
        // Gestoppte Zeit nach Tab-Wechsel oder Neuladen wieder ins Feld (getippte Werte stellt keepInputs danach wieder her)
        if (time && !run && stoppedSecs(id)) f.input.value = String(stoppedSecs(id));

        var watch = time ? watchBlock(id) : null;

        var form = h('form', { class: 'tav-entry', onsubmit: function (e) { e.preventDefault(); enter(); } },
          f.el,
          h('button', { class: 'btn btn--gold tav-entry__btn', type: 'submit' }, ico('check'), 'Eintragen'));

        var actions = h('div', { class: 'tav-cur__actions' },
          time ? h('span', { class: 'tav-cur__tip', text: 'Stopp füllt das Feld aus.' })
            : h('button', { class: 'chip chip--btn tav-fill', type: 'button', title: 'Trägt ' + U.fmt(need) + ' Wiederholungen ein',
                onclick: function () { f.input.value = String(need); enter(); } }, ico('check'), 'Alle ' + U.fmt(need) + ' geschafft'),
          h('span', { class: 'spacer' }),
          h('button', { class: 'btn btn--ghost btn--sm tav-skipex', type: 'button', onclick: skip }, ico('next'), 'Auslassen'));

        // info = was verlangt ist, do = Stoppuhr und Eingabe (auf mittelbreiten Bildschirmen nebeneinander)
        var root = h('div', { class: 'tav-cur' + (run ? ' is-live' : ''), dataset: { ex: id } },
          h('div', { class: 'tav-cur__info' },
            h('div', { class: 'tav-cur__head' },
              h('span', { class: 'tav-cur__badge' }, ico('bauch')),
              h('span', { class: 'tav-cur__step', text: 'Übung ' + (idx + 1) + ' von ' + total }),
              h('span', { class: 'chip chip--muted tav-cur__unit', text: time ? 'Zeit' : 'Wdh.' })),
            h('div', { class: 'tav-cur__big' }, h('span', { text: ex.name + (time ? ':' : ' übrig:') }), ' ', bigVal),
            h('div', { class: 'tav-cur__sub' }, doneNum, time ? ' von ' + sec(need) + ' geschafft' : ' von ' + U.fmt(need)),
            bar),
          h('div', { class: 'tav-cur__do' }, watch, form, actions),
          ex.hint ? h('p', { class: 'tav-cur__hint' }, ico('info'), h('span', { text: ex.hint })) : null,
          h('div', { class: 'tav-cur__stats' },
            pill('Bestwert', it.best ? valText(ex, it.best) : '–'),
            pill('Erfolge', U.fmt(it.wins)),
            pill('Verfehlt', U.fmt(it.fails))));
        cur.root = root;
        return root;
      }

      /** Tanz läuft: Kopf, Punkte 1–5, letztes Ergebnis, aktuelle Übung */
      function danceCard(ds, li) {
        var list = ds.list, it = null;
        if (pickId) list.forEach(function (x) { if (x.ex.id === pickId && !x.entry) it = x; });
        if (!it) { it = ds.next; pickId = null; }
        var idx = list.indexOf(it);
        return h('section', { class: 'card card--gold tav-card tav-dance' },
          h('div', { class: 'tav-dance__head' },
            h('span', { class: 'tav-dance__pulse', 'aria-hidden': 'true' }),
            h('span', { class: 'tav-dance__kicker', text: 'Zirkus-Tanz läuft' }),
            h('span', { class: 'tav-dance__count num', text: ds.doneCount + ' / ' + ds.total + ' erledigt' })),
          stepsBar(list, it),
          flashBox(li),
          it ? exerciseBlock(it, idx, ds.total) : null);
      }

      /** Erledigte Übungen mit Ergebnis + "Tanz beenden" */
      function doneCard(ds) {
        var done = ds.list.filter(function (it) { return !!it.entry; });
        var rows = done.map(function (it) {
          var e = it.entry, ex = it.ex, k = e.skipped ? 'skip' : e.success ? 'ok' : 'fail';
          var res = e.skipped ? 'Ausgelassen'
            : e.success ? 'Geschafft · ' + newTargetText(ex, e.oldTarget, e.newTarget)
            : 'Nicht geschafft · Ziel bleibt ' + valText(ex, OP.game.absShown(ex, e.oldTarget));
          return h('li', { class: 'tav-done tav-done--' + k },
            h('span', { class: 'tav-done__icon' }, ico(k === 'ok' ? 'check' : k === 'fail' ? 'close' : 'minus')),
            h('span', { class: 'tav-done__name' }, h('b', { text: ex.name }), h('small', { text: res })),
            h('span', { class: 'tav-done__val num', text: e.skipped ? '–' : valText(ex, e.value) }));
        });
        return h('section', { class: 'card card--gold tav-card tav-donecard' },
          h('div', { class: 'card__title' }, ico('check'), h('span', { text: 'Erledigt' }),
            h('span', { class: 'chip chip--muted tav-donecard__n num', text: done.length + ' / ' + ds.total })),
          done.length ? h('ol', { class: 'tav-dones' }, rows)
            : h('p', { class: 'tav-donecard__empty', text: 'Noch nichts eingetragen. Deine Ergebnisse erscheinen hier.' }),
          h('button', { class: 'btn btn--ghost btn--block tav-finish', type: 'button', onclick: finishEarly }, ico('flag'), 'Tanz beenden'));
      }

      /** Bauch-Rang nach bester Plank-Zeit */
      function rankCard() {
        var rk = OP.game.absRank();
        var best = (OP.state.abs.plank && OP.state.abs.plank.best) || 0;
        return h('section', { class: 'card card--gold tav-card tav-zrank' },
          h('div', { class: 'tav-zrank__head' },
            h('span', { class: 'tav-zrank__label' }, ico('rank'), 'Bauch-Rang'),
            OP.ui.rankBadge(rk.rank)),
          h('div', { class: 'tav-zrank__best' }, h('span', { text: 'Beste Plank-Zeit' }), h('b', { class: 'num', text: sec(best) })),
          OP.ui.progress(rk.progress * 100, { tone: 'gold', thin: true }),
          h('div', { class: 'tav-zrank__next', text: rk.next ? 'Noch ' + sec(rk.toNext) + ' bis ' + rk.next.name : 'Höchster Rang erreicht' }));
      }

      function rulesBlock() {
        return h('div', { class: 'tav-rules' },
          T.infoLine(rulesText(), 'info'),
          T.infoLine(lockRuleText(), 'lock'));
      }

      /* ---------- Aufbau ---------- */

      function build() {
        cur = null;
        var li = lockInfo();
        var ds;
        try { ds = OP.game.danceStatus(); } catch (e) { ds = { active: false, list: [], total: 0, doneCount: 0, next: null }; }
        if (!ds.active) { clearWatches(); pickId = null; flash = null; }

        var inner = h('div', { class: 'screen__inner tav tav--zirkus' + (ds.active ? ' is-dancing' : '') }, statusCard(li));
        if (ds.active) {
          inner.appendChild(h('div', { class: 'tav-zlayout' },
            h('div', { class: 'tav-zmain' }, danceCard(ds, li)),
            h('div', { class: 'tav-zside' }, doneCard(ds), rankCard(), rulesBlock())));
        } else {
          inner.appendChild(T.merchant(NPC, T.greet(li.locked ? LINES_LOCKED : LINES, seed)));
          inner.appendChild(h('div', { class: 'tav-zlayout' },
            h('div', { class: 'tav-zmain' }, overviewCard(li)),
            h('div', { class: 'tav-zside' }, rankCard(), rulesBlock())));
        }
        el.innerHTML = '';
        el.appendChild(inner);
        updateLive();
      }

      function render() { if (alive) T.keepInputs(el, build); }

      pruneWatches();
      render();
      syncWakeLock(true);
      bag.interval(tick, 100);
      bag.on('change', function (e) {
        var reason = (e && e.reason) || '';
        if (alive && RELEVANT.indexOf(reason) >= 0) render();
      });
      // Nach dem Zurückkommen (Bildschirm war aus) Wake Lock neu holen
      function onVis() { if (!document.hidden) syncWakeLock(alive); }
      document.addEventListener('visibilitychange', onVis);
      bag.add(function () { document.removeEventListener('visibilitychange', onVis); });
      bag.add(function () { alive = false; cur = null; syncWakeLock(false); });
      return bag.run;
    }
  });
})();
