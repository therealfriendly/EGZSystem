/* Operator – Achievements (global: OP.data.ACHIEVEMENTS)

   Aufbau: { id, name, desc, icon, cat, check: function (s, g) { return true/false; } }
   s = Spielstand (OP.state), g = Spielregeln (OP.game).
   OP.game.checkAchievements() prueft nach jeder Aenderung alle noch nicht freigeschalteten.
   check muss schnell sein und darf nie abstuerzen: fehlende Felder immer abfangen
   (dafuer gibt es die Helfer unten). Einmal freigeschaltet bleibt ein Achievement fuer immer.
   cat: kampf | arena | gym | staerke | bauch | kardio | quests | streak | kalorien | sonstiges
   Reihenfolge je Kategorie: leicht -> schwer (das Profil zeigt die ersten offenen als "Naechste Ziele").

   Version 2: sechs Muskeln (Push / Pull / Beine) mit eigenen Rang-Schwellen, Kampf mit Kritisch,
   Zirkus-Tanz (5 Uebungen), Lauf-Timer im Gym, simuliertes Gewicht. Die ids aus Version 1 bleiben,
   damit freigeschaltete Achievements freigeschaltet bleiben. Hoechstens 75 Achievements. */
(function () {
  'use strict';
  var OP = (window.OP = window.OP || {});
  var D = (OP.data = OP.data || {});

  /* ================= Helfer ================= */

  /** Zahl oder 0 (nie NaN) */
  function num(v) { v = Number(v); return isFinite(v) ? v : 0; }
  /** Fuehrt fn aus; bei einem Fehler kommt fallback zurueck */
  function safe(fn, fallback) { try { return fn(); } catch (e) { return fallback; } }
  /** Objekt (kein Array, nicht null)? */
  function isObj(o) { return !!o && typeof o === 'object' && !Array.isArray(o); }
  /** Statistik-Wert aus s.stats (0, wenn er fehlt) */
  function stat(s, key) { return num(s && isObj(s.stats) ? s.stats[key] : 0); }
  /** check-Funktion: Statistik-Wert >= Ziel */
  function statMin(key, goal) { return function (s) { return stat(s, key) >= goal; }; }
  /** Zahl mit deutschem Tausenderpunkt (77000 -> "77.000") */
  function fmt(n) { return String(Math.round(num(n))).replace(/\B(?=(\d{3})+(?!\d))/g, '.'); }

  /* ---------- Kampf ---------- */

  /** Gegner nach Id. Die Gegner-Liste aendert sich im Spiel nicht, darum einmal als Verzeichnis gebaut
      (statt 100-mal die Liste zu durchsuchen). Ohne Liste: OP.game.enemy. */
  var enemyIndex = { list: null, size: 0, byId: {} };
  function enemyById(g, id) {
    var list = D.ENEMIES;
    if (Array.isArray(list) && list.length) {
      if (enemyIndex.list !== list || enemyIndex.size !== list.length) {
        enemyIndex = { list: list, size: list.length, byId: {} };
        list.forEach(function (e) { if (e && e.id) enemyIndex.byId[e.id] = e; });
      }
      return Object.prototype.hasOwnProperty.call(enemyIndex.byId, id) ? enemyIndex.byId[id] : null;
    }
    return g && typeof g.enemy === 'function' ? safe(function () { return g.enemy(id); }, null) : null;
  }

  /** Anzahl verschiedener besiegter Gegner (nur gueltige Ids), optional nur einer Art (kind) */
  function defeatedCount(s, g, kind) {
    var d = s && isObj(s.stats) ? s.stats.enemiesDefeated : null, count = 0;
    if (!isObj(d)) return 0;
    for (var id in d) {
      if (!Object.prototype.hasOwnProperty.call(d, id) || !(num(d[id]) > 0)) continue;
      var e = enemyById(g, id);
      if (e && (!kind || e.kind === kind)) count++;
    }
    return count;
  }

  /** Gewonnene Kaempfe einer Trainings-Gruppe ('push' | 'pull' | 'legs') */
  function groupWins(s, groupId) {
    var gw = s && isObj(s.stats) ? s.stats.groupWins : null;
    return isObj(gw) ? num(gw[groupId]) : 0;
  }
  function groupWinMin(groupId) { return function (s) { return groupWins(s, groupId) >= 1; }; }
  /** Gruppen-Ids aus den Daten (Notfall: die drei bekannten) */
  function groupIds() { return D.GROUP_IDS && D.GROUP_IDS.length ? D.GROUP_IDS : ['push', 'pull', 'legs']; }

  /* ---------- Gym ---------- */

  /** Geschaffte Gym-Ziele (+1 % bei einem Muskel). In Version 1 hatte jedes Training genau einen Muskel,
      dort zaehlte gymWins diese Ziele. Das Maximum sorgt dafuer, dass alte Spielstaende nichts verlieren. */
  function gymGoals(s) { return Math.max(stat(s, 'gymPartWins'), stat(s, 'gymWins')); }
  function gymGoalsMin(goal) { return function (s) { return gymGoals(s) >= goal; }; }

  /** Ein Gym-Training (Version 2, Push/Pull/Beine), in dem jeder Muskel der Gruppe +1 % geschafft hat.
      Steht nur im Log (alte Eintraege aus Version 1 haben keine Gruppe und zaehlen hier nicht). */
  function fullGroupGym(s) {
    if (!(stat(s, 'gymWins') > 0)) return false;          // schneller Ausstieg: noch nie ein ganzes Training geschafft
    var log = s && Array.isArray(s.log) ? s.log : null;
    if (!log) return false;
    for (var i = log.length - 1; i >= 0; i--) {
      var e = log[i];
      if (e && e.type === 'gym' && e.group && e.won === true) return true;
    }
    return false;
  }

  /* ---------- Staerke & Raenge ---------- */

  /** Position eines Rangs in OP.data.RANKS (holz 0 ... legende 7), -1 wenn unbekannt */
  function rankIndex(rankId) {
    var list = D.RANKS || [];
    for (var i = 0; i < list.length; i++) if (list[i].id === rankId) return i;
    return -1;
  }
  /** Rang-Index eines Muskels nach aktuellem XP. Schwellen je Muskel (Bizeps/Trizeps kleiner, Beine groesser)
      kommen aus OP.game.rankFor (inkl. eigener Werte aus der Zauberbude). */
  function muscleRankIndex(s, g, id) {
    var m = s && isObj(s.muscles) ? s.muscles[id] : null, xp = isObj(m) ? num(m.xp) : 0;
    var idx = safe(function () { return g.rankFor(id, xp).index; }, null);
    if (typeof idx === 'number' && isFinite(idx)) return idx;
    // Notfall ohne OP.game: Standard-Schwellen dieses Muskels
    var th = (D.RANK_DEFAULTS && D.RANK_DEFAULTS[id]) || D.RANK_THRESHOLDS || [];
    var found = 0;
    for (var k = 0; k < th.length; k++) if (xp >= num(th[k])) found = k;
    return found;
  }
  /** Rang-Index jedes der sechs Kampf-Muskeln */
  function muscleRankIndexes(s, g) {
    return (D.MUSCLE_IDS || []).map(function (id) { return muscleRankIndex(s, g, id); });
  }
  /** check-Funktion: mindestens ein Muskel hat diesen Rang (oder hoeher) */
  function anyMuscleRank(rankId) {
    return function (s, g) {
      var need = rankIndex(rankId);
      if (need <= 0) return false;
      return muscleRankIndexes(s, g).some(function (i) { return i >= need; });
    };
  }
  /** check-Funktion: alle sechs Muskeln haben mindestens diesen Rang */
  function allMusclesRank(rankId) {
    return function (s, g) {
      var need = rankIndex(rankId), list = muscleRankIndexes(s, g);
      if (need <= 0 || !list.length) return false;
      return list.every(function (i) { return i >= need; });
    };
  }

  /** Gesamtstaerke = Summe der sechs XP-Werte */
  function strength(s, g) {
    var t = safe(function () { return num(g.totalStrength()); }, null);
    if (t != null) return t;
    var sum = 0;
    (D.MUSCLE_IDS || []).forEach(function (id) {
      var m = s && isObj(s.muscles) ? s.muscles[id] : null;
      if (isObj(m)) sum += num(m.xp);
    });
    return sum;
  }
  function strengthMin(goal) { return function (s, g) { return strength(s, g) >= goal; }; }

  /* ---------- Bauch (Zirkus-Tanz) ---------- */

  /** Beste Plank-Zeit in Sekunden */
  function plankBest(s) { return num(s && isObj(s.abs) && isObj(s.abs.plank) ? s.abs.plank.best : 0); }
  function plankMin(sec) { return function (s) { return plankBest(s) >= sec; }; }
  var LEGEND_PLANK = (D.ABS_RANK_SECONDS && D.ABS_RANK_SECONDS[D.ABS_RANK_SECONDS.length - 1]) || 180;

  /* ---------- Ausdauer (Lauf-Timer im Gym) ---------- */

  /** Wert eines Lauf-Timers, z. B. runValue(s, 'steady', 'best') oder runValue(s, 'total', 'record') (Minuten) */
  function runValue(s, kind, field) {
    var r = s && isObj(s.run) ? s.run[kind] : null;
    return isObj(r) ? num(r[field]) : 0;
  }
  /** Anzahl eingetragener Laeufe (beide Timer) */
  function runsDone(s) {
    return Math.max(stat(s, 'runsSteady') + stat(s, 'runsTotal'), runValue(s, 'steady', 'runs') + runValue(s, 'total', 'runs'));
  }
  /** Joggen am Stueck: bester Lauf (nur echte Laeufe, keine Schaetzung) */
  function steadyMin(minutes) { return function (s) { return runValue(s, 'steady', 'best') >= minutes; }; }
  /** Laufzeit gesamt: Rekord (reine Laufzeit einer Einheit, Gehpausen zaehlen nicht) */
  function totalMin(minutes) { return function (s) { return runValue(s, 'total', 'record') >= minutes; }; }

  /* ---------- Streak ---------- */

  /** check-Funktion: laengster Streak (Tage in Folge) >= days.
      s.streak.longest ist immer aktuell: OP.game rechnet ihn direkt vor jeder Achievement-Pruefung neu
      (commit -> updateLongestStreak). OP.game.streakInfo() hier NICHT aufrufen – das ist bei langer
      Historie teuer (alle aktiven Tage) und liefe sonst bei jeder Aktion fuenfmal. */
  function streakMin(days) {
    return function (s) { return num(s && isObj(s.streak) ? s.streak.longest : 0) >= days; };
  }

  /* ---------- Kalorien ---------- */

  function kcalStatus(g) { return safe(function () { return g.kcalStatus(); }, null); }
  var KCAL_PER_KG = num(D.KCAL_PER_KG) || 7700;

  var ENEMY_COUNT = (D.ENEMIES && D.ENEMIES.length) || 100;

  /* ================= Liste ================= */

  D.ACHIEVEMENTS = [
    /* ---------- Kampf ---------- */
    { id: 'kampf_1', cat: 'kampf', icon: 'sword', name: 'Erstes Blut',
      desc: 'Gewinne deinen ersten Kampf.', check: statMin('fightsWon', 1) },
    { id: 'krit_1', cat: 'kampf', icon: 'target', name: 'Kritischer Treffer',
      desc: 'Nimm dem Gegner mit einem Satz mehr als 10 % seiner HP.', check: statMin('critsDealt', 1) },
    { id: 'push_1', cat: 'kampf', icon: 'push', name: 'Push-Tag',
      desc: 'Gewinne einen Push-Kampf (Brust, Trizeps, Schultern).', check: groupWinMin('push') },
    { id: 'pull_1', cat: 'kampf', icon: 'pull', name: 'Pull-Tag',
      desc: 'Gewinne einen Pull-Kampf (Rücken, Bizeps).', check: groupWinMin('pull') },
    { id: 'legs_1', cat: 'kampf', icon: 'beine', name: 'Leg Day',
      desc: 'Gewinne einen Beine-Kampf. Nie den Beintag auslassen!', check: groupWinMin('legs') },
    { id: 'gruppen_alle', cat: 'kampf', icon: 'body', name: 'Volles Programm',
      desc: 'Gewinne je einen Kampf mit Push, Pull und Beine.',
      check: function (s) { return groupIds().every(function (id) { return groupWins(s, id) >= 1; }); } },
    { id: 'knapp', cat: 'kampf', icon: 'warning', name: 'Knapp!',
      desc: 'Gewinne einen Kampf mit höchstens 10 % deiner HP übrig.', check: statMin('closeWins', 1) },
    { id: 'kampf_10', cat: 'kampf', icon: 'swords', name: 'Kampferprobt',
      desc: 'Gewinne 10 Kämpfe.', check: statMin('fightsWon', 10) },
    { id: 'gegner_25', cat: 'kampf', icon: 'scroll', name: 'Steckbrief-Sammler',
      desc: 'Besiege 25 verschiedene Gegner.',
      check: function (s, g) { return defeatedCount(s, g) >= 25; } },
    { id: 'unberuehrt', cat: 'kampf', icon: 'shield', name: 'Unberührt',
      desc: 'Gewinne einen Kampf, ohne getroffen zu werden.', check: statMin('flawlessWins', 1) },
    { id: 'krit_50', cat: 'kampf', icon: 'bolt', name: 'Kritische Masse',
      desc: 'Triff 50-mal kritisch.', check: statMin('critsDealt', 50) },
    { id: 'kampf_50', cat: 'kampf', icon: 'medal', name: 'Veteran der Labs',
      desc: 'Gewinne 50 Kämpfe.', check: statMin('fightsWon', 50) },
    { id: 'troll_1', cat: 'kampf', icon: 'troll', name: 'Trolljäger',
      desc: 'Besiege einen Troll.',
      check: function (s, g) { return defeatedCount(s, g, 'troll') >= 1; } },
    { id: 'kampf_100', cat: 'kampf', icon: 'skull', name: 'Schrecken der Sektoren',
      desc: 'Gewinne 100 Kämpfe.', check: statMin('fightsWon', 100) },
    { id: 'drache_1', cat: 'kampf', icon: 'dragon', name: 'Drachentöter',
      desc: 'Besiege einen Drachen.',
      check: function (s, g) { return defeatedCount(s, g, 'drache') >= 1; } },
    { id: 'kampf_250', cat: 'kampf', icon: 'crown', name: 'Legende der Labs',
      desc: 'Gewinne 250 Kämpfe.', check: statMin('fightsWon', 250) },
    { id: 'gegner_alle', cat: 'kampf', icon: 'book', name: 'Bestiarium komplett',
      desc: 'Besiege alle ' + ENEMY_COUNT + ' Gegner mindestens einmal.',
      check: function (s, g) {
        var total = (D.ENEMIES && D.ENEMIES.length) || 0;
        return total > 0 && defeatedCount(s, g) >= total;
      } },

    /* ---------- Arena ---------- */
    { id: 'arena_1', cat: 'arena', icon: 'arena', name: 'Arena-Debüt',
      desc: 'Kämpfe zum ersten Mal in der Arena.', check: statMin('arenaFights', 1) },
    { id: 'arena_10', cat: 'arena', icon: 'trophy', name: 'Liebling der Menge',
      desc: 'Gewinne 10 Arena-Kämpfe.', check: statMin('arenaWins', 10) },
    { id: 'insane_1', cat: 'arena', icon: 'bolt', name: 'Völlig wahnsinnig',
      desc: 'Gewinne einen Insane-Kampf.', check: statMin('insaneWins', 1) },
    { id: 'insane_10', cat: 'arena', icon: 'star', name: 'Herr des Wahnsinns',
      desc: 'Gewinne 10 Insane-Kämpfe.', check: statMin('insaneWins', 10) },

    /* ---------- Gym (Kraft) ---------- */
    { id: 'gym_1', cat: 'gym', icon: 'gym', name: 'Plus ein Prozent',
      desc: 'Bring im Gym einen Muskel auf +1 %.', check: gymGoalsMin(1) },
    { id: 'gym_gruppe', cat: 'gym', icon: 'staerke', name: 'Ganze Gruppe',
      desc: 'Schaffe in einem Gym-Training +1 % bei jedem Muskel.', check: fullGroupGym },
    { id: 'gym_10', cat: 'gym', icon: 'gym', name: 'Stammgast im Gym',
      desc: 'Schaffe im Gym 10-mal +1 % bei einem Muskel.', check: gymGoalsMin(10) },
    { id: 'gym_50', cat: 'gym', icon: 'hammer', name: 'Eisenfresser',
      desc: 'Schaffe im Gym 50-mal +1 % bei einem Muskel.', check: gymGoalsMin(50) },
    { id: 'gym_100', cat: 'gym', icon: 'medal', name: 'Hantel-Meister',
      desc: 'Schaffe im Gym 100-mal +1 % bei einem Muskel.', check: gymGoalsMin(100) },

    /* ---------- Staerke & Raenge (Schwellen je Muskel) ---------- */
    { id: 'staerke_10k', cat: 'staerke', icon: 'staerke', name: 'Kraftpaket',
      desc: 'Erreiche 10.000 Gesamtstärke.', check: strengthMin(10000) },
    { id: 'rang_gold', cat: 'staerke', icon: 'rank', name: 'Goldader',
      desc: 'Bring einen Muskel auf Rang Gold.', check: anyMuscleRank('gold') },
    { id: 'alle_silber', cat: 'staerke', icon: 'body', name: 'Rundum stark',
      desc: 'Bring alle sechs Muskeln mindestens auf Rang Silber.', check: allMusclesRank('silber') },
    { id: 'rang_platin', cat: 'staerke', icon: 'rank', name: 'Platin-Status',
      desc: 'Bring einen Muskel auf Rang Platin.', check: anyMuscleRank('platin') },
    { id: 'alle_gold', cat: 'staerke', icon: 'gold', name: 'Ganz in Gold',
      desc: 'Bring alle sechs Muskeln mindestens auf Rang Gold.', check: allMusclesRank('gold') },
    { id: 'staerke_20k', cat: 'staerke', icon: 'staerke', name: 'Stahlkoloss',
      desc: 'Erreiche 20.000 Gesamtstärke.', check: strengthMin(20000) },
    { id: 'rang_diamant', cat: 'staerke', icon: 'rank', name: 'Hart wie Diamant',
      desc: 'Bring einen Muskel auf Rang Diamant.', check: anyMuscleRank('diamant') },
    { id: 'staerke_40k', cat: 'staerke', icon: 'crown', name: 'Titan der Labs',
      desc: 'Erreiche 40.000 Gesamtstärke.', check: strengthMin(40000) },
    { id: 'rang_legende', cat: 'staerke', icon: 'crown', name: 'Lebende Legende',
      desc: 'Bring einen Muskel auf Rang Legende.', check: anyMuscleRank('legende') },

    /* ---------- Bauch (Zirkus-Tanz) ---------- */
    { id: 'tanz_1', cat: 'bauch', icon: 'zirkus', name: 'Erster Tanz',
      desc: 'Beende deinen ersten Zirkus-Tanz.', check: statMin('dances', 1) },
    { id: 'bauch_10', cat: 'bauch', icon: 'zirkus', name: 'Zirkus-Artist',
      desc: 'Schaffe 10 Übungen im Zirkus-Tanz.', check: statMin('absWins', 10) },
    { id: 'plank_60', cat: 'bauch', icon: 'bauch', name: 'Eiserne Mitte',
      desc: 'Halte die Plank 60 Sekunden.', check: plankMin(60) },
    { id: 'tanz_perfekt', cat: 'bauch', icon: 'star', name: 'Perfekter Tanz',
      desc: 'Schaffe in einem Tanz alle fünf Übungen.', check: statMin('perfectDances', 1) },
    { id: 'tanz_10', cat: 'bauch', icon: 'clock', name: 'Im Takt',
      desc: 'Beende 10 Zirkus-Tänze.', check: statMin('dances', 10) },
    { id: 'bauch_50', cat: 'bauch', icon: 'star', name: 'Star der Manege',
      desc: 'Schaffe 50 Übungen im Zirkus-Tanz.', check: statMin('absWins', 50) },
    { id: 'plank_120', cat: 'bauch', icon: 'bauch', name: 'Brett aus Stahl',
      desc: 'Halte die Plank 120 Sekunden.', check: plankMin(120) },
    { id: 'tanz_50', cat: 'bauch', icon: 'trophy', name: 'Zirkusdirektor',
      desc: 'Beende 50 Zirkus-Tänze.', check: statMin('dances', 50) },
    { id: 'bauch_legende', cat: 'bauch', icon: 'crown', name: 'Unerschütterlich',
      desc: 'Halte die Plank ' + LEGEND_PLANK + ' Sekunden: Bauch-Rang Legende.',
      check: function (s, g) {
        var idx = safe(function () { return g.absRank(plankBest(s)).index; }, null);
        if (typeof idx !== 'number') return plankBest(s) >= LEGEND_PLANK;   // Notfall ohne OP.game
        return idx >= rankIndex('legende');
      } },

    /* ---------- Kardio: Lauf-Timer (Gym) und Schmuggler ---------- */
    { id: 'lauf_1', cat: 'kardio', icon: 'run', name: 'Erster Lauf',
      desc: 'Trag im Gym deinen ersten Lauf ein.', check: function (s) { return runsDone(s) >= 1; } },
    { id: 'kardio_1', cat: 'kardio', icon: 'schmuggler', name: 'Erste Lieferung',
      desc: 'Schaffe deinen ersten Schmuggler-Auftrag.', check: statMin('cardioWins', 1) },
    { id: 'lauf_10', cat: 'kardio', icon: 'timer', name: '10 Minuten am Stück',
      desc: 'Jogge 10 Minuten ohne Pause.', check: steadyMin(10) },
    { id: 'laufzeit_20', cat: 'kardio', icon: 'steps', name: 'Laufzeit 20 Minuten',
      desc: 'Lauf in einer Einheit 20 Minuten. Gehpausen zählen nicht.', check: totalMin(20) },
    { id: 'kardio_10', cat: 'kardio', icon: 'run', name: 'Zuverlässiger Kurier',
      desc: 'Schaffe 10 Schmuggler-Aufträge.', check: statMin('cardioWins', 10) },
    { id: 'lauf_30', cat: 'kardio', icon: 'sprint', name: '30 Minuten am Stück',
      desc: 'Jogge 30 Minuten ohne Pause.', check: steadyMin(30) },
    { id: 'laufzeit_60', cat: 'kardio', icon: 'mountain', name: 'Laufzeit 60 Minuten',
      desc: 'Lauf in einer Einheit 60 Minuten. Gehpausen zählen nicht.', check: totalMin(60) },
    { id: 'kardio_50', cat: 'kardio', icon: 'briefcase', name: 'Meisterschmuggler',
      desc: 'Schaffe 50 Schmuggler-Aufträge.', check: statMin('cardioWins', 50) },
    { id: 'kardio_100', cat: 'kardio', icon: 'ghost', name: 'Phantom der Grenze',
      desc: 'Schaffe 100 Schmuggler-Aufträge.', check: statMin('cardioWins', 100) },

    /* ---------- Quests ---------- */
    { id: 'quest_1', cat: 'quests', icon: 'check', name: 'Erster Haken',
      desc: 'Hake deine erste Quest ab.', check: statMin('questsDone', 1) },
    { id: 'quest_tag', cat: 'quests', icon: 'star', name: 'Tagwerk vollbracht',
      desc: 'Hake an einem Tag alle deine Quests ab (mindestens 3).',
      check: function (s, g) {
        var list = safe(function () { return g.questsToday(); }, null);
        if (!Array.isArray(list) || list.length < 3) return false;
        return list.every(function (q) { return q && q.done; });
      } },
    { id: 'quest_10', cat: 'quests', icon: 'quest', name: 'Pflichtbewusst',
      desc: 'Erledige 10 Quests.', check: statMin('questsDone', 10) },
    { id: 'quest_100', cat: 'quests', icon: 'scroll', name: 'Macher',
      desc: 'Erledige 100 Quests.', check: statMin('questsDone', 100) },
    { id: 'quest_500', cat: 'quests', icon: 'crown', name: 'Unermüdlich',
      desc: 'Erledige 500 Quests.', check: statMin('questsDone', 500) },

    /* ---------- Streak ---------- */
    { id: 'streak_3', cat: 'streak', icon: 'streak', name: 'Warmgelaufen',
      desc: 'Sei 3 Tage in Folge aktiv (Training oder Quest).', check: streakMin(3) },
    { id: 'streak_7', cat: 'streak', icon: 'streak', name: 'Eine Woche Feuer',
      desc: 'Sei 7 Tage in Folge aktiv.', check: streakMin(7) },
    { id: 'streak_14', cat: 'streak', icon: 'streak', name: 'Zwei Wochen Glut',
      desc: 'Sei 14 Tage in Folge aktiv.', check: streakMin(14) },
    { id: 'streak_30', cat: 'streak', icon: 'streak', name: 'Monatsflamme',
      desc: 'Sei 30 Tage in Folge aktiv.', check: streakMin(30) },
    { id: 'streak_100', cat: 'streak', icon: 'crown', name: 'Ewiges Feuer',
      desc: 'Sei 100 Tage in Folge aktiv.', check: streakMin(100) },

    /* ---------- Kalorienschulden ---------- */
    { id: 'kcal_1', cat: 'kalorien', icon: 'kcal', name: 'Erste Rate',
      desc: 'Trag dein erstes Kaloriendefizit ein.',
      check: function (s) {
        if (stat(s, 'kcalPaid') > 0) return true;
        var list = s && isObj(s.kcal) ? s.kcal.entries : null;
        return Array.isArray(list) && list.some(function (e) { return e && num(e.kcal) > 0; });
      } },
    { id: 'kcal_10k', cat: 'kalorien', icon: 'kcal', name: 'Zehntausend weg',
      desc: 'Zahle insgesamt 10.000 kcal Schulden ab.', check: statMin('kcalPaid', 10000) },
    { id: 'kcal_50k', cat: 'kalorien', icon: 'kcal', name: 'Schuldenfresser',
      desc: 'Zahle insgesamt 50.000 kcal Schulden ab.', check: statMin('kcalPaid', 50000) },
    { id: 'kcal_sim_10', cat: 'kalorien', icon: 'scale', name: 'Minus 10 kg simuliert',
      desc: 'Dein simuliertes Gewicht ist um 10 kg gesunken (' + fmt(10 * KCAL_PER_KG) + ' kcal).',
      check: function (s, g) {
        var st = kcalStatus(g);
        return !!(st && st.hasGoal && num(st.kgPaid) >= 10);
      } },
    { id: 'kcal_halb', cat: 'kalorien', icon: 'flag', name: 'Halbzeit',
      desc: 'Zahle die Hälfte deiner Kalorienschulden ab.',
      check: function (s, g) {
        var st = kcalStatus(g);
        return !!(st && st.hasGoal && num(st.pctPaid) >= 50);
      } },
    { id: 'ich_bin_gesund', cat: 'kalorien', icon: 'heart', name: 'ICH BIN GESUND!',
      desc: 'Alle Kalorienschulden sind bezahlt.',
      check: function (s) { return !!(s && isObj(s.kcal) && s.kcal.healthyAt); } },

    /* ---------- Sonstiges ---------- */
    { id: 'labs', cat: 'sonstiges', icon: 'flask', name: 'Loss Always Builds Strength',
      desc: 'Verliere deinen ersten Kampf. Aus Niederlagen wirst du stark.', check: statMin('fightsLost', 1) },
    { id: 'saetze_100', cat: 'sonstiges', icon: 'target', name: 'Satz für Satz',
      desc: 'Trag 100 Sätze ein (Gym und Kampf).', check: statMin('setsLogged', 100) },
    { id: 'nicht_aufgeben', cat: 'sonstiges', icon: 'shield', name: 'Nicht aufgeben',
      desc: 'Verliere 10 Kämpfe – und mach trotzdem weiter.', check: statMin('fightsLost', 10) },
    { id: 'schaden_100k', cat: 'sonstiges', icon: 'bolt', name: 'Abrissbirne',
      desc: 'Mach insgesamt 100.000 Schaden (Gym und Kampf).', check: statMin('totalDamage', 100000) },
    { id: 'saetze_1000', cat: 'sonstiges', icon: 'medal', name: 'Tausend Sätze',
      desc: 'Trag 1.000 Sätze ein.', check: statMin('setsLogged', 1000) },
    { id: 'schaden_1m', cat: 'sonstiges', icon: 'star', name: 'Millionen-Wucht',
      desc: 'Mach insgesamt 1.000.000 Schaden.', check: statMin('totalDamage', 1000000) }
  ];
})();
