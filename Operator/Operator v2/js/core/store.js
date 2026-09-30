/* Operator – Spielstand im Browser (localStorage), Export/Import als Text
   global: OP.store, OP.state (immer der aktuelle Spielstand) */
(function () {
  'use strict';
  var OP = (window.OP = window.OP || {});
  var D = OP.data, U = OP.util;

  var KEY = 'operator.save.v1';          // Schluessel bleibt gleich, die Version steht im Spielstand (v)
  var EXPORT_PREFIX = 'OPERATOR-SAVE:1:';
  var SCHEMA = 2;

  function defaultMuscles() {
    var m = {};
    D.MUSCLE_IDS.forEach(function (id) { m[id] = { xp: 0, start: 0, peak: 0 }; });
    return m;
  }
  function defaultAbs() {
    var a = {};
    D.ABS_EXERCISES.forEach(function (ex) {
      a[ex.id] = { target: ex.start, best: 0, wins: 0, fails: 0, decayCarry: 0 };
    });
    return a;
  }
  function defaultStats() {
    return {
      gymSessions: 0, gymWins: 0, gymPartWins: 0,
      fightsTotal: 0, fightsWon: 0, fightsLost: 0,
      arenaFights: 0, arenaWins: 0, insaneWins: 0,
      enemiesDefeated: {}, defeatedTotal: 0, groupWins: {},
      critsDealt: 0, critsTaken: 0, closeWins: 0, flawlessWins: 0,
      absAttempts: 0, absWins: 0, dances: 0, perfectDances: 0,
      cardioWins: 0, cardioFails: 0,
      runsSteady: 0, runsTotal: 0, runWins: 0,
      questsDone: 0,
      setsLogged: 0, totalDamage: 0,
      kcalPaid: 0,
      skips: 0, skipDay: null, skipsToday: 0
    };
  }
  function defaultRun() {
    return {
      steady: { target: 0, best: 0, wins: 0, fails: 0, runs: 0, lastPct: 0 },   // Joggen am Stueck (Minuten)
      total: { record: 0, goal: 0, wins: 0, fails: 0, runs: 0 },                // Laufzeit gesamt (Minuten)
      active: null     // laufender Timer {kind, started, running, segStart, acc, segments}
    };
  }

  function defaultState() {
    var now = Date.now();
    return {
      v: SCHEMA,
      created: now,
      updated: now,
      setupDone: false,
      player: { name: 'Runner', bodyweight: D.DEFAULT_BODYWEIGHT },
      muscles: defaultMuscles(),
      abs: defaultAbs(),
      dance: null,                                   // laufender Zirkus-Tanz {started, day, entries}
      circus: { lastDay: null, lastEntryDay: null }, // lastDay: Sperr-Uhr (Eintrag oder Schonfrist), lastEntryDay: letzter echter Eintrag
      run: defaultRun(),
      decay: { lastDay: null },                      // Retention, die immer laeuft (Bauch, Joggen am Stueck)
      kcal: { goalKg: 0, entries: [], healthyAt: null, base: 0, baseT: 0, startWeight: 0 },
      quests: { list: [], done: {} },
      offers: { abenteuer: [], arena: [] },
      fight: null,
      gym: null,
      cardio: { levels: {}, active: null },
      stats: defaultStats(),
      days: {},
      streak: { longest: 0 },
      retention: { lastDay: null, lostDays: 0 },
      achievements: {},
      log: [],
      notice: null,                                  // einmalige Nachricht nach einem Update
      settings: { effects: true, haptics: true, rankOverrides: {}, questsCollapsed: false }
    };
  }

  function isObj(o) { return !!o && typeof o === 'object' && !Array.isArray(o); }
  function num(v, def) { v = Number(v); return isFinite(v) ? v : def; }

  /** Passt die geladene Datendatei zu diesem Code (Version 2: Gruppen, Bizeps, Lauf-Timer)? */
  function dataOk() {
    return !!(D && typeof D.group === 'function' && D.GROUPS && D.GROUPS.length && typeof D.muscle === 'function' &&
      D.muscle('bizeps') && D.RUNS && D.ABS_EXERCISES && D.absExercise && D.absExercise('seitplank_l'));
  }

  /* Fehlende oder kaputte Felder aus den Standardwerten ergaenzen (tief).
     Ist der Standard ein Objekt, der gespeicherte Wert aber keins (z. B. null), wird der Standard genommen.
     Felder mit Standard null (fight, gym, cardio.active, ...) duerfen null bleiben. */
  function fillDefaults(target, defaults) {
    for (var k in defaults) {
      if (!Object.prototype.hasOwnProperty.call(defaults, k)) continue;
      var dv = defaults[k];
      if (!(k in target) || target[k] === undefined ||
          (isObj(dv) && !isObj(target[k])) || (Array.isArray(dv) && !Array.isArray(target[k]))) {
        target[k] = U.clone(dv === undefined ? null : dv);
      } else if (isObj(dv)) {
        fillDefaults(target[k], dv);
      }
    }
    return target;
  }

  /** Map {schluessel: Objekt} saeubern: nur Objekt-Werte behalten */
  function cleanObjMap(map) {
    Object.keys(map).forEach(function (k) { if (!isObj(map[k])) delete map[k]; });
  }

  /** Version 1 -> 2: Push/Pull/Beine statt 5 Muskeln, Zirkus-Tanz, Lauf-Timer, simuliertes Gewicht */
  function migrateV1toV2(s) {
    var today = U.today(), notes = [];
    if (isObj(s.muscles) && isObj(s.muscles.arme)) {
      var a = s.muscles.arme, half = Math.round(num(a.xp, 0) / 2);
      ['bizeps', 'trizeps'].forEach(function (id) {
        // leer oder 0 (z. B. von einem halb geladenen Update angelegt): mit der Haelfte von Arme fuellen
        if (!isObj(s.muscles[id]) || !(num(s.muscles[id].xp, 0) > 0)) {
          s.muscles[id] = { xp: half, start: Math.round(num(a.start, 0) / 2), peak: Math.round(num(a.peak, 0) / 2) };
        }
      });
      notes.push('Dein alter Arme-Wert (' + U.fmt(a.xp) + ' XP) ist jetzt je zur Hälfte Bizeps und Trizeps (je ' + U.fmt(half) + ' XP).');
      delete s.muscles.arme;
    }
    if (isObj(s.abs)) {
      if (isObj(s.abs.seitplank)) {
        s.abs.seitplank_l = U.clone(s.abs.seitplank);
        s.abs.seitplank_r = U.clone(s.abs.seitplank);
        delete s.abs.seitplank;
        notes.push('Seitliche Planks gibt es jetzt links und rechts getrennt, beide mit deinem bisherigen Wert.');
      }
      Object.keys(s.abs).forEach(function (k) { if (isObj(s.abs[k])) delete s.abs[k].progress; });
    }
    // laufende Einheiten im alten Format koennen nicht weiterlaufen
    if (s.fight && !(isObj(s.fight) && s.fight.group)) { s.fight = null; notes.push('Ein offener Kampf wurde beendet (ohne Wertung).'); }
    if (s.gym && !(isObj(s.gym) && s.gym.group)) { s.gym = null; notes.push('Ein offenes Gym-Training wurde beendet (ohne Wertung).'); }
    s.offers = { abenteuer: [], arena: [] };       // neue Angebote mit Push/Pull/Beine
    // v1 zaehlte pro Gym-Einheit genau ein erreichtes Muskel-Ziel -> in v2 heisst das gymPartWins
    if (isObj(s.stats) && !(num(s.stats.gymPartWins, 0) > 0)) s.stats.gymPartWins = num(s.stats.gymWins, 0);
    if (isObj(s.settings) && isObj(s.settings.rankOverrides)) delete s.settings.rankOverrides.arme;
    // Zirkus-Sperre startet mit Schonfrist, Retention (Bauch/Lauf) ab heute.
    // Letzter echter Bauch-Eintrag aus v1 bleibt als "letzter Zirkus-Eintrag" erhalten.
    var lastAbs = null;
    if (Array.isArray(s.log)) {
      for (var li = s.log.length - 1; li >= 0; li--) {
        var le = s.log[li];
        if (isObj(le) && le.type === 'abs' && typeof le.day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(le.day)) { lastAbs = le.day; break; }
      }
    }
    s.circus = { lastDay: today, lastEntryDay: lastAbs };
    s.decay = { lastDay: today };
    if (isObj(s.kcal) && num(s.kcal.goalKg, 0) > 0 && !num(s.kcal.startWeight, 0)) {
      s.kcal.startWeight = num(isObj(s.player) ? s.player.bodyweight : 0, D.DEFAULT_BODYWEIGHT);
    }
    if (s.setupDone) {
      s.notice = {
        id: 'v2', title: 'Neu: Push, Pull, Beine',
        text: 'Training und Kämpfe laufen jetzt nach Push (Brust, Trizeps, Schultern), Pull (Rücken, Bizeps) und Beine. ' +
          notes.join(' ') + ' Passt ein Wert nicht, ändere ihn in der Zauberbude.'
      };
    }
    s.v = 2;
  }

  function migrate(s) {
    if (!isObj(s)) throw new Error('Kein gültiger Spielstand');
    if (!s.v) s.v = 1;
    if (s.v < 2) migrateV1toV2(s);
    fillDefaults(s, defaultState());
    // Muskeln/Bauch einzeln absichern (falls neue Gruppen/Uebungen dazukommen); unbekannte entfernen
    Object.keys(s.muscles).forEach(function (k) { if (!D.muscle(k) || k === 'bauch') delete s.muscles[k]; });
    Object.keys(s.abs).forEach(function (k) { if (!D.absExercise(k)) delete s.abs[k]; });
    D.MUSCLE_IDS.forEach(function (id) {
      if (!isObj(s.muscles[id])) s.muscles[id] = { xp: 0, start: 0, peak: 0 };
      var m = s.muscles[id];
      m.xp = Math.max(0, num(m.xp, 0)); m.start = num(m.start, 0); m.peak = Math.max(num(m.peak, 0), m.xp);
    });
    D.ABS_EXERCISES.forEach(function (ex) {
      if (!isObj(s.abs[ex.id])) s.abs[ex.id] = { target: ex.start, best: 0, wins: 0, fails: 0, decayCarry: 0 };
      var a = s.abs[ex.id];
      a.target = Math.max(D.ABS_MIN_TARGET, num(a.target, ex.start)); a.best = num(a.best, 0);
      a.wins = num(a.wins, 0); a.fails = num(a.fails, 0); a.decayCarry = num(a.decayCarry, 0);
    });
    // Zirkus-Tanz
    if (s.dance && (!isObj(s.dance) || !isObj(s.dance.entries))) s.dance = null;
    if (s.dance) {
      Object.keys(s.dance.entries).forEach(function (k) {
        if (!D.absExercise(k) || !isObj(s.dance.entries[k])) delete s.dance.entries[k];
      });
    }
    // Lauf-Timer
    ['steady', 'total'].forEach(function (k) {
      var r = s.run[k];
      Object.keys(r).forEach(function (f) { r[f] = Math.max(0, num(r[f], 0)); });
    });
    if (s.run.active && (!isObj(s.run.active) || !D.run(s.run.active.kind))) s.run.active = null;
    if (s.run.active) {
      var ra = s.run.active;
      ra.acc = Math.max(0, num(ra.acc, 0)); ra.segStart = num(ra.segStart, Date.now());
      ra.started = num(ra.started, Date.now()); ra.running = !!ra.running; ra.segments = Math.max(1, num(ra.segments, 1));
    }
    if (!isObj(s.stats.groupWins)) s.stats.groupWins = {};
    s.kcal.startWeight = Math.max(0, num(s.kcal.startWeight, 0));
    s.kcal.entries = s.kcal.entries.filter(function (e) { return isObj(e) && isFinite(Number(e.kcal)); });
    s.kcal.entries.forEach(function (e) { e.kcal = Number(e.kcal); if (!e.id) e.id = U.uid('k'); });
    s.kcal.goalKg = Math.max(0, num(s.kcal.goalKg, 0));
    s.kcal.base = num(s.kcal.base, 0);
    s.quests.list = s.quests.list.filter(function (q) { return isObj(q) && q.id; });
    s.quests.list.forEach(function (q) { q.title = String(q.title == null ? '' : q.title); });
    Object.keys(s.quests.done).forEach(function (d) { if (!Array.isArray(s.quests.done[d])) delete s.quests.done[d]; });
    cleanObjMap(s.days);
    cleanObjMap(s.cardio.levels);
    Object.keys(s.cardio.levels).forEach(function (k) {
      var l = s.cardio.levels[k];
      l.wins = Math.max(0, Math.floor(num(l.wins, 0)));
      l.fails = Math.max(0, Math.floor(num(l.fails, 0)));
    });
    Object.keys(s.stats).forEach(function (k) {
      if (k !== 'enemiesDefeated' && k !== 'groupWins' && k !== 'skipDay' && typeof s.stats[k] !== 'number') s.stats[k] = num(s.stats[k], 0);
    });
    s.offers.abenteuer = s.offers.abenteuer.filter(isObj);
    s.offers.arena = s.offers.arena.filter(isObj);
    // laufender Kampf / Gym: Gruppe, Teile und Saetze muessen stimmen, sonst verwerfen
    function sessionOk(x, needPools) {
      if (!isObj(x) || !D.group(x.group) || !isObj(x.parts) || !Array.isArray(x.sets)) return false;
      var g = D.group(x.group);
      for (var i = 0; i < g.muscles.length; i++) if (!isObj(x.parts[g.muscles[i]])) return false;
      if (needPools && (!Array.isArray(x.pools) || !x.pools.length || !(num(x.limit, 0) > 0))) return false;
      return true;
    }
    if (s.fight && !sessionOk(s.fight, true)) s.fight = null;
    if (s.gym && !sessionOk(s.gym, false)) s.gym = null;
    [s.fight, s.gym].forEach(function (x) {
      if (!x) return;
      var g = D.group(x.group);
      x.sets = x.sets.filter(function (t) {
        return isObj(t) && t.dmg != null && isFinite(Number(t.dmg)) && g.muscles.indexOf(t.m) >= 0 &&
          Number(t.w) > 0 && isFinite(Number(t.w)) && Number(t.r) > 0 && isFinite(Number(t.r));
      });
      x.sets.forEach(function (t) { t.dmg = Number(t.dmg); t.w = Number(t.w); t.r = Number(t.r); });
    });
    if (s.fight) {
      var f = s.fight, fd = D.difficulty(f.diff);
      if (!fd) s.fight = null;
      else {
        var fp = Number(f.pct);
        if (!isFinite(fp) || fp < 0 || fp > 100) f.pct = Math.round((fd.min + fd.max) * 50) / 100;
        D.group(f.group).muscles.forEach(function (id) {
          var p = f.parts[id];
          if (!isFinite(Number(p.startXp))) p.startXp = s.muscles[id].xp;
          p.startXp = Number(p.startXp);
          if (!(Number(p.hp) >= 1)) p.hp = Math.max(1, Math.ceil(p.startXp * (1 + f.pct / 100) - 1e-9));
          p.hp = Number(p.hp);
        });
        // Summe der Pools = Spieler-HP, Anzahl der Pools = verstecktes Satz-Limit
        f.pools = f.pools.map(function (p) { return Math.max(1, Math.round(num(p, 1))); });
        f.playerHp = f.pools.reduce(function (a, b) { return a + b; }, 0);
        f.limit = f.pools.length;
        if (f.sets.length > f.limit) f.sets = f.sets.slice(0, f.limit);
      }
    }
    if (s.gym) {
      D.group(s.gym.group).muscles.forEach(function (id) {
        var p = s.gym.parts[id];
        if (!isFinite(Number(p.startXp))) p.startXp = s.muscles[id].xp;
        p.startXp = Number(p.startXp);
        if (!(Number(p.target) >= 1)) p.target = Math.max(1, Math.ceil(p.startXp * (1 + D.GYM_GOAL_PCT / 100) - 1e-9));
        p.target = Number(p.target);
      });
    }
    // Schmuggler-Auftrag nur behalten, wenn alle Zahlen stimmen (sonst zeigt der Countdown NaN)
    var ca = s.cardio.active;
    if (ca && !(isObj(ca) && typeof ca.id === 'string' && isFinite(Number(ca.startedAt)) && isFinite(Number(ca.deadline)) &&
        isFinite(Number(ca.limitMin)) && (!D.CARDIO || D.CARDIO.some(function (c) { return c.id === ca.id; })))) {
      s.cardio.active = null;
    }
    // Datums-Schluessel pruefen ("YYYY-MM-DD"); kaputte Werte sicher ersetzen
    var DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
    function dayOk(v) { return typeof v === 'string' && DAY_RE.test(v); }
    var today = U.today();
    if (s.decay.lastDay != null && !dayOk(s.decay.lastDay)) s.decay.lastDay = s.setupDone ? today : null;
    if (s.setupDone && !dayOk(s.circus.lastDay)) s.circus.lastDay = today;          // Schonfrist
    if (s.circus.lastEntryDay != null && !dayOk(s.circus.lastEntryDay)) s.circus.lastEntryDay = null;
    if (s.retention.lastDay != null && !dayOk(s.retention.lastDay)) s.retention.lastDay = U.addDays(today, -1);
    if (s.dance && !dayOk(s.dance.day)) s.dance.day = today;
    if (s.stats.skipDay != null && !dayOk(s.stats.skipDay)) s.stats.skipDay = null;
    if (s.cardio.active && !isObj(s.cardio.active)) s.cardio.active = null;
    if (!isObj(s.settings.rankOverrides)) s.settings.rankOverrides = {};
    if (!Array.isArray(s.log)) s.log = [];
    s.log = s.log.filter(isObj);
    Object.keys(s.quests.done).forEach(function (d) {
      s.quests.done[d] = s.quests.done[d].filter(function (id) { return typeof id === 'string'; });
    });
    s.player.name = String(s.player.name == null ? 'Runner' : s.player.name).slice(0, 24);
    s.player.bodyweight = num(s.player.bodyweight, D.DEFAULT_BODYWEIGHT);
    return s;
  }

  /** Text (Export-Zeile oder JSON) lesen und pruefen, OHNE etwas zu aendern. -> {ok, state} oder {ok:false, error} */
  function parseImport(text) {
    var t = String(text || '').trim();
    if (!t) return { ok: false, error: 'Das Feld ist leer.' };
    var json;
    try {
      if (t.indexOf(EXPORT_PREFIX) === 0) {
        var b64 = t.slice(EXPORT_PREFIX.length).replace(/\s/g, '');
        json = decodeURIComponent(escape(atob(b64)));
      } else if (t.charAt(0) === '{') {
        json = t;
      } else {
        return { ok: false, error: 'Das ist kein Operator-Spielstand.' };
      }
    } catch (e) {
      return { ok: false, error: 'Der Text ist beschädigt oder unvollständig. Bitte den ganzen Text kopieren.' };
    }
    var raw;
    try { raw = JSON.parse(json); }
    catch (e) { return { ok: false, error: 'Der Text ist beschädigt oder unvollständig. Bitte den ganzen Text kopieren.' }; }
    // Grundpruefung VOR dem Ergaenzen: ein echter Spielstand hat Spieler und Muskelwerte
    if (!isObj(raw) || !isObj(raw.player) || !isObj(raw.muscles)) {
      return { ok: false, error: 'Das ist kein vollständiger Operator-Spielstand.' };
    }
    try { return { ok: true, state: migrate(raw) }; }
    catch (e) { return { ok: false, error: 'Der Spielstand konnte nicht gelesen werden.' }; }
  }

  var storageOk = true;
  function readRaw() {
    try { return localStorage.getItem(KEY); } catch (e) { storageOk = false; return null; }
  }

  var store = {
    KEY: KEY,
    defaultState: defaultState,

    /** Schluessel der Kopie eines beschaedigten Spielstands (falls beim Laden einer gefunden wurde) */
    corruptKey: null,

    /** true, wenn die Datendatei (constants.js) nicht zu diesem Spielstand-Code passt
        (z. B. halb geladenes Update: alte und neue Dateien gemischt). Dann wird NICHTS umgestellt oder gespeichert. */
    mismatch: false,

    /** Laedt den Spielstand (oder erzeugt einen neuen) und setzt OP.state */
    load: function () {
      var raw = readRaw(), s = null;
      store.mismatch = !dataOk();
      if (store.mismatch) {
        console.error('[store] Dateien passen nicht zusammen (halbes Update) – Spielstand bleibt unangetastet');
        try { OP.state = defaultState(); } catch (e) { OP.state = null; }   // Datendatei fehlt ganz? Dann gar kein Stand
        return OP.state;
      }
      if (raw) {
        // vor einer Versions-Umstellung eine Sicherung anlegen (einmal pro Version)
        try {
          var peek = JSON.parse(raw);
          if (isObj(peek) && (Number(peek.v) || 1) < SCHEMA) {
            var bk = KEY + '.vor-v' + SCHEMA;
            if (!localStorage.getItem(bk)) localStorage.setItem(bk, raw);
          }
        } catch (e) { /* kaputter Stand: wird unten behandelt */ }
        try { s = migrate(JSON.parse(raw)); }
        catch (e) {
          console.error('[store] Spielstand defekt, Sicherung angelegt', e);
          store.corruptKey = KEY + '.defekt.' + Date.now();
          try { localStorage.setItem(store.corruptKey, raw); } catch (e2) { /* egal */ }
          s = null;
        }
      }
      OP.state = s || defaultState();
      return OP.state;
    },

    /** Speichert sofort. reason landet im 'change'-Event. Bei Fehler zusaetzlich Event 'save-error'. */
    save: function (reason) {
      var s = OP.state;
      if (!s || store.mismatch) return false;   // halbes Update: nichts ueberschreiben
      s.updated = Date.now();
      if (s.log.length > 5000) s.log.splice(0, s.log.length - 5000);
      var ok = true;
      try { localStorage.setItem(KEY, JSON.stringify(s)); storageOk = true; }
      catch (e) { ok = false; storageOk = false; console.error('[store] Speichern fehlgeschlagen', e); }
      OP.bus.emit('change', { reason: reason || 'save' });
      if (!ok) OP.bus.emit('save-error', { reason: reason });
      return ok;
    },

    /** Neuerer Stand im Speicher (anderes Fenster/Tab)? Dann uebernehmen. -> true, wenn neu geladen */
    syncFromStorage: function () {
      var raw = readRaw();
      if (!raw || !OP.state || store.mismatch) return false;
      try {
        var s = JSON.parse(raw);
        if (!s || !(Number(s.updated) > Number(OP.state.updated))) return false;
        OP.state = migrate(s);
        OP.bus.emit('change', { reason: 'sync' });
        return true;
      } catch (e) { return false; }
    },

    /** true, wenn localStorage nutzbar ist (z. B. nicht im privaten Modus gesperrt) */
    storageOk: function () { return storageOk; },

    /** Spielstand als eine Textzeile (zum Kopieren/Sichern) */
    exportText: function () {
      var json = JSON.stringify(OP.state);
      var b64 = btoa(unescape(encodeURIComponent(json)));
      return EXPORT_PREFIX + b64;
    },

    /** Nur pruefen (vor dem "Wirklich ersetzen?"-Dialog). -> {ok, error, name} */
    checkImport: function (text) {
      var r = parseImport(text);
      return r.ok ? { ok: true, name: r.state.player.name, setupDone: !!r.state.setupDone } : r;
    },

    /** Liest Text aus exportText() oder reines JSON. Ersetzt den Spielstand. -> {ok, error} */
    importText: function (text) {
      var r = parseImport(text);
      if (!r.ok) return r;
      // alte Sicherung behalten
      try { var old = readRaw(); if (old) localStorage.setItem(KEY + '.vor-import', old); } catch (e) { /* egal */ }
      OP.state = r.state;
      store.save('import');
      return { ok: true };
    },

    /** Alles loeschen (Sicherung bleibt unter KEY + '.vor-reset') */
    reset: function () {
      try { var old = readRaw(); if (old) localStorage.setItem(KEY + '.vor-reset', old); } catch (e) { /* egal */ }
      OP.state = defaultState();
      store.save('reset');
    }
  };

  // Zwei offene Fenster (z. B. App + Browser-Tab): Aenderungen des anderen sofort uebernehmen,
  // damit sich die beiden nicht gegenseitig ueberschreiben.
  try {
    window.addEventListener('storage', function (e) {
      if (e.key !== KEY || !e.newValue || store.mismatch) return;
      try {
        OP.state = migrate(JSON.parse(e.newValue));
        OP.bus.emit('change', { reason: 'sync' });
        if (OP.ui && OP.ui.router && OP.ui.router.current()) OP.ui.router.refresh();
      } catch (x) { /* kaputter Stand im anderen Fenster: ignorieren */ }
    });
  } catch (e) { /* kein window (Tests) */ }

  OP.store = store;
})();
