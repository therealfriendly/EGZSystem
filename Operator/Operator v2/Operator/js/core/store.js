/* Operator – Spielstand im Browser (localStorage), Export/Import als Text
   global: OP.store, OP.state (immer der aktuelle Spielstand) */
(function () {
  'use strict';
  var OP = (window.OP = window.OP || {});
  var D = OP.data, U = OP.util;

  var KEY = 'operator.save.v1';
  var EXPORT_PREFIX = 'OPERATOR-SAVE:1:';
  var SCHEMA = 1;

  function defaultMuscles() {
    var m = {};
    D.MUSCLE_IDS.forEach(function (id) { m[id] = { xp: 0, start: 0, peak: 0 }; });
    return m;
  }
  function defaultAbs() {
    var a = {};
    D.ABS_EXERCISES.forEach(function (ex) {
      a[ex.id] = { target: ex.start, best: 0, wins: 0, fails: 0, progress: 0 };
    });
    return a;
  }
  function defaultStats() {
    return {
      gymSessions: 0, gymWins: 0,
      fightsTotal: 0, fightsWon: 0, fightsLost: 0,
      arenaFights: 0, arenaWins: 0, insaneWins: 0,
      enemiesDefeated: {}, defeatedTotal: 0,
      absAttempts: 0, absWins: 0,
      cardioWins: 0, cardioFails: 0,
      questsDone: 0,
      setsLogged: 0, totalDamage: 0,
      kcalPaid: 0,
      skips: 0, skipDay: null, skipsToday: 0
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
      kcal: { goalKg: 0, entries: [], healthyAt: null, base: 0, baseT: 0 },
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
      settings: { effects: true, haptics: true, rankOverrides: {}, questsCollapsed: false }
    };
  }

  function isObj(o) { return !!o && typeof o === 'object' && !Array.isArray(o); }
  function num(v, def) { v = Number(v); return isFinite(v) ? v : def; }

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

  function migrate(s) {
    if (!isObj(s)) throw new Error('Kein gültiger Spielstand');
    if (!s.v) s.v = 1;
    // spaetere Versionen: if (s.v < 2) { ... s.v = 2; }
    fillDefaults(s, defaultState());
    // Muskeln/Bauch einzeln absichern (falls neue Gruppen/Uebungen dazukommen)
    D.MUSCLE_IDS.forEach(function (id) {
      if (!isObj(s.muscles[id])) s.muscles[id] = { xp: 0, start: 0, peak: 0 };
      var m = s.muscles[id];
      m.xp = Math.max(0, num(m.xp, 0)); m.start = num(m.start, 0); m.peak = Math.max(num(m.peak, 0), m.xp);
    });
    D.ABS_EXERCISES.forEach(function (ex) {
      if (!isObj(s.abs[ex.id])) s.abs[ex.id] = { target: ex.start, best: 0, wins: 0, fails: 0, progress: 0 };
      var a = s.abs[ex.id];
      a.target = Math.max(1, num(a.target, ex.start)); a.best = num(a.best, 0);
      a.wins = num(a.wins, 0); a.fails = num(a.fails, 0); a.progress = num(a.progress, 0);
    });
    s.kcal.entries = s.kcal.entries.filter(function (e) { return isObj(e) && isFinite(Number(e.kcal)); });
    s.kcal.entries.forEach(function (e) { e.kcal = Number(e.kcal); if (!e.id) e.id = U.uid('k'); });
    s.kcal.goalKg = Math.max(0, num(s.kcal.goalKg, 0));
    s.kcal.base = num(s.kcal.base, 0);
    s.quests.list = s.quests.list.filter(function (q) { return isObj(q) && q.id; });
    s.quests.list.forEach(function (q) { q.title = String(q.title == null ? '' : q.title); });
    Object.keys(s.quests.done).forEach(function (d) { if (!Array.isArray(s.quests.done[d])) delete s.quests.done[d]; });
    cleanObjMap(s.days);
    cleanObjMap(s.cardio.levels);
    Object.keys(s.stats).forEach(function (k) {
      if (k !== 'enemiesDefeated' && k !== 'skipDay' && typeof s.stats[k] !== 'number') s.stats[k] = num(s.stats[k], 0);
    });
    s.offers.abenteuer = s.offers.abenteuer.filter(isObj);
    s.offers.arena = s.offers.arena.filter(isObj);
    if (s.fight && (!isObj(s.fight) || !Array.isArray(s.fight.sets) || !s.muscles[s.fight.muscle])) s.fight = null;
    if (s.gym && (!isObj(s.gym) || !Array.isArray(s.gym.sets) || !s.muscles[s.gym.muscle])) s.gym = null;
    [s.fight, s.gym].forEach(function (x) {
      if (!x) return;
      x.sets = x.sets.filter(function (t) { return isObj(t) && isFinite(Number(t.dmg)); });
      x.sets.forEach(function (t) { t.dmg = Number(t.dmg); });
    });
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

    /** Laedt den Spielstand (oder erzeugt einen neuen) und setzt OP.state */
    load: function () {
      var raw = readRaw(), s = null;
      if (raw) {
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
      if (!s) return false;
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
      if (!raw || !OP.state) return false;
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
      if (e.key !== KEY || !e.newValue) return;
      try {
        OP.state = migrate(JSON.parse(e.newValue));
        OP.bus.emit('change', { reason: 'sync' });
        if (OP.ui && OP.ui.router && OP.ui.router.current()) OP.ui.router.refresh();
      } catch (x) { /* kaputter Stand im anderen Fenster: ignorieren */ }
    });
  } catch (e) { /* kein window (Tests) */ }

  OP.store = store;
})();
