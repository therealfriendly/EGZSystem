/* Operator – Achievements (global: OP.data.ACHIEVEMENTS)

   Aufbau: { id, name, desc, icon, cat, check: function (s, g) { return true/false; } }
   s = Spielstand (OP.state), g = Spielregeln (OP.game).
   OP.game.checkAchievements() prueft nach jeder Aenderung alle noch nicht freigeschalteten.
   check muss schnell sein und darf nie abstuerzen: fehlende Felder immer abfangen
   (dafuer gibt es die Helfer unten). Einmal freigeschaltet bleibt ein Achievement fuer immer.
   cat: kampf | arena | gym | staerke | bauch | kardio | quests | streak | kalorien | sonstiges */
(function () {
  'use strict';
  var OP = (window.OP = window.OP || {});
  var D = (OP.data = OP.data || {});

  /* ================= Helfer ================= */

  /** Zahl oder 0 (nie NaN) */
  function num(v) { v = Number(v); return isFinite(v) ? v : 0; }
  /** Fuehrt fn aus; bei einem Fehler kommt fallback zurueck */
  function safe(fn, fallback) { try { return fn(); } catch (e) { return fallback; } }
  /** Statistik-Wert aus s.stats (0, wenn er fehlt) */
  function stat(s, key) { return num(s && s.stats && s.stats[key]); }
  /** check-Funktion: Statistik-Wert >= Ziel */
  function statMin(key, goal) { return function (s) { return stat(s, key) >= goal; }; }

  /** Anzahl verschiedener besiegter Gegner (nur gueltige Ids), optional nur einer Art (kind) */
  function defeatedCount(s, g, kind) {
    var d = s && s.stats && s.stats.enemiesDefeated, count = 0;
    if (!d || typeof d !== 'object' || !g || typeof g.enemy !== 'function') return 0;
    for (var id in d) {
      if (!Object.prototype.hasOwnProperty.call(d, id) || !(num(d[id]) > 0)) continue;
      var e = safe(function () { return g.enemy(id); }, null);
      if (e && (!kind || e.kind === kind)) count++;
    }
    return count;
  }

  /** Position eines Rangs in OP.data.RANKS (holz 0 ... legende 7), -1 wenn unbekannt */
  function rankIndex(rankId) {
    var list = D.RANKS || [];
    for (var i = 0; i < list.length; i++) if (list[i].id === rankId) return i;
    return -1;
  }
  /** Rang-Index jeder der 5 Kampf-Muskelgruppen (nach aktuellem XP) */
  function muscleRankIndexes(s, g) {
    return (D.MUSCLE_IDS || []).map(function (id) {
      var m = s && s.muscles && s.muscles[id];
      return safe(function () { return g.rankFor(id, m ? num(m.xp) : 0).index; }, 0);
    });
  }
  /** check-Funktion: mindestens eine Muskelgruppe hat diesen Rang (oder hoeher) */
  function anyMuscleRank(rankId) {
    return function (s, g) {
      var need = rankIndex(rankId);
      if (need <= 0) return false;
      return muscleRankIndexes(s, g).some(function (i) { return i >= need; });
    };
  }
  /** check-Funktion: alle 5 Muskelgruppen haben mindestens diesen Rang */
  function allMusclesRank(rankId) {
    return function (s, g) {
      var need = rankIndex(rankId), list = muscleRankIndexes(s, g);
      if (need <= 0 || !list.length) return false;
      return list.every(function (i) { return i >= need; });
    };
  }

  /** Gesamtstaerke = Summe der 5 XP-Werte */
  function strength(s, g) {
    return safe(function () { return num(g.totalStrength()); }, 0);
  }
  function strengthMin(goal) { return function (s, g) { return strength(s, g) >= goal; }; }

  /** Beste Plank-Zeit in Sekunden */
  function plankBest(s) { return num(s && s.abs && s.abs.plank && s.abs.plank.best); }
  function plankMin(sec) { return function (s) { return plankBest(s) >= sec; }; }

  /** check-Funktion: laengster Streak (Tage in Folge) >= days */
  function streakMin(days) {
    return function (s, g) {
      var saved = num(s && s.streak && s.streak.longest);
      if (saved >= days) return true;
      var live = safe(function () { return num(g.streakInfo().longest); }, 0);
      return Math.max(saved, live) >= days;
    };
  }

  var ENEMY_COUNT = (D.ENEMIES && D.ENEMIES.length) || 100;

  /* ================= Liste ================= */

  D.ACHIEVEMENTS = [
    /* ---------- Kampf ---------- */
    { id: 'kampf_1', cat: 'kampf', icon: 'sword', name: 'Erstes Blut',
      desc: 'Gewinne deinen ersten Kampf.', check: statMin('fightsWon', 1) },
    { id: 'kampf_10', cat: 'kampf', icon: 'swords', name: 'Kampferprobt',
      desc: 'Gewinne 10 Kämpfe.', check: statMin('fightsWon', 10) },
    { id: 'kampf_50', cat: 'kampf', icon: 'shield', name: 'Veteran der Labs',
      desc: 'Gewinne 50 Kämpfe.', check: statMin('fightsWon', 50) },
    { id: 'kampf_100', cat: 'kampf', icon: 'skull', name: 'Schrecken der Sektoren',
      desc: 'Gewinne 100 Kämpfe.', check: statMin('fightsWon', 100) },
    { id: 'kampf_250', cat: 'kampf', icon: 'crown', name: 'Legende der Labs',
      desc: 'Gewinne 250 Kämpfe.', check: statMin('fightsWon', 250) },
    { id: 'gegner_25', cat: 'kampf', icon: 'scroll', name: 'Steckbrief-Sammler',
      desc: 'Besiege 25 verschiedene Gegner.',
      check: function (s, g) { return defeatedCount(s, g) >= 25; } },
    { id: 'gegner_alle', cat: 'kampf', icon: 'book', name: 'Bestiarium komplett',
      desc: 'Besiege alle ' + ENEMY_COUNT + ' Gegner mindestens einmal.',
      check: function (s, g) {
        var total = (D.ENEMIES && D.ENEMIES.length) || 0;
        return total > 0 && defeatedCount(s, g) >= total;
      } },
    { id: 'troll_1', cat: 'kampf', icon: 'troll', name: 'Trolljäger',
      desc: 'Besiege einen Troll.',
      check: function (s, g) { return defeatedCount(s, g, 'troll') >= 1; } },
    { id: 'drache_1', cat: 'kampf', icon: 'dragon', name: 'Drachentöter',
      desc: 'Besiege einen Drachen.',
      check: function (s, g) { return defeatedCount(s, g, 'drache') >= 1; } },

    /* ---------- Arena ---------- */
    { id: 'arena_1', cat: 'arena', icon: 'arena', name: 'Arena-Debüt',
      desc: 'Kämpfe zum ersten Mal in der Arena.', check: statMin('arenaFights', 1) },
    { id: 'arena_10', cat: 'arena', icon: 'trophy', name: 'Liebling der Menge',
      desc: 'Gewinne 10 Arena-Kämpfe.', check: statMin('arenaWins', 10) },
    { id: 'insane_1', cat: 'arena', icon: 'bolt', name: 'Völlig wahnsinnig',
      desc: 'Gewinne einen Insane-Kampf.', check: statMin('insaneWins', 1) },
    { id: 'insane_10', cat: 'arena', icon: 'star', name: 'Herr des Wahnsinns',
      desc: 'Gewinne 10 Insane-Kämpfe.', check: statMin('insaneWins', 10) },

    /* ---------- Gym ---------- */
    { id: 'gym_1', cat: 'gym', icon: 'gym', name: 'Plus ein Prozent',
      desc: 'Schaffe dein erstes Gym-Ziel (+1 %).', check: statMin('gymWins', 1) },
    { id: 'gym_10', cat: 'gym', icon: 'gym', name: 'Stammgast im Gym',
      desc: 'Schaffe 10 Gym-Ziele.', check: statMin('gymWins', 10) },
    { id: 'gym_50', cat: 'gym', icon: 'hammer', name: 'Eisenfresser',
      desc: 'Schaffe 50 Gym-Ziele.', check: statMin('gymWins', 50) },
    { id: 'gym_100', cat: 'gym', icon: 'medal', name: 'Hantel-Meister',
      desc: 'Schaffe 100 Gym-Ziele.', check: statMin('gymWins', 100) },

    /* ---------- Staerke & Raenge ---------- */
    { id: 'staerke_10k', cat: 'staerke', icon: 'staerke', name: 'Kraftpaket',
      desc: 'Erreiche 10.000 Gesamtstärke.', check: strengthMin(10000) },
    { id: 'staerke_20k', cat: 'staerke', icon: 'staerke', name: 'Stahlkoloss',
      desc: 'Erreiche 20.000 Gesamtstärke.', check: strengthMin(20000) },
    { id: 'staerke_40k', cat: 'staerke', icon: 'crown', name: 'Titan der Labs',
      desc: 'Erreiche 40.000 Gesamtstärke.', check: strengthMin(40000) },
    { id: 'rang_gold', cat: 'staerke', icon: 'rank', name: 'Goldader',
      desc: 'Bring eine Muskelgruppe auf Rang Gold.', check: anyMuscleRank('gold') },
    { id: 'rang_platin', cat: 'staerke', icon: 'rank', name: 'Platin-Status',
      desc: 'Bring eine Muskelgruppe auf Rang Platin.', check: anyMuscleRank('platin') },
    { id: 'rang_diamant', cat: 'staerke', icon: 'rank', name: 'Hart wie Diamant',
      desc: 'Bring eine Muskelgruppe auf Rang Diamant.', check: anyMuscleRank('diamant') },
    { id: 'rang_legende', cat: 'staerke', icon: 'crown', name: 'Lebende Legende',
      desc: 'Bring eine Muskelgruppe auf Rang Legende.', check: anyMuscleRank('legende') },
    { id: 'alle_silber', cat: 'staerke', icon: 'body', name: 'Rundum stark',
      desc: 'Bring alle fünf Muskelgruppen mindestens auf Silber.', check: allMusclesRank('silber') },

    /* ---------- Bauch (Zirkus-Taenze) ---------- */
    { id: 'plank_60', cat: 'bauch', icon: 'bauch', name: 'Eiserne Mitte',
      desc: 'Halte die Plank 60 Sekunden.', check: plankMin(60) },
    { id: 'plank_120', cat: 'bauch', icon: 'bauch', name: 'Brett aus Stahl',
      desc: 'Halte die Plank 2 Minuten.', check: plankMin(120) },
    { id: 'bauch_legende', cat: 'bauch', icon: 'crown', name: 'Unerschütterlich',
      desc: 'Halte die Plank 3 Minuten: Bauch-Rang Legende.',
      check: function (s, g) {
        var idx = safe(function () { return g.absRank(plankBest(s)).index; }, null);
        if (idx == null) return plankBest(s) >= 180;   // Notfall ohne OP.game
        return idx >= rankIndex('legende');
      } },
    { id: 'bauch_10', cat: 'bauch', icon: 'zirkus', name: 'Zirkus-Artist',
      desc: 'Schaffe 10 Bauch-Challenges.', check: statMin('absWins', 10) },
    { id: 'bauch_50', cat: 'bauch', icon: 'star', name: 'Star der Manege',
      desc: 'Schaffe 50 Bauch-Challenges.', check: statMin('absWins', 50) },

    /* ---------- Kardio (Schmuggler) ---------- */
    { id: 'kardio_1', cat: 'kardio', icon: 'schmuggler', name: 'Erste Lieferung',
      desc: 'Schaffe deinen ersten Schmuggler-Auftrag.', check: statMin('cardioWins', 1) },
    { id: 'kardio_10', cat: 'kardio', icon: 'run', name: 'Zuverlässiger Kurier',
      desc: 'Schaffe 10 Schmuggler-Aufträge.', check: statMin('cardioWins', 10) },
    { id: 'kardio_50', cat: 'kardio', icon: 'briefcase', name: 'Meisterschmuggler',
      desc: 'Schaffe 50 Schmuggler-Aufträge.', check: statMin('cardioWins', 50) },
    { id: 'kardio_100', cat: 'kardio', icon: 'ghost', name: 'Phantom der Grenze',
      desc: 'Schaffe 100 Schmuggler-Aufträge.', check: statMin('cardioWins', 100) },

    /* ---------- Quests ---------- */
    { id: 'quest_1', cat: 'quests', icon: 'check', name: 'Erster Haken',
      desc: 'Hake deine erste Quest ab.', check: statMin('questsDone', 1) },
    { id: 'quest_10', cat: 'quests', icon: 'quest', name: 'Pflichtbewusst',
      desc: 'Erledige 10 Quests.', check: statMin('questsDone', 10) },
    { id: 'quest_100', cat: 'quests', icon: 'scroll', name: 'Macher',
      desc: 'Erledige 100 Quests.', check: statMin('questsDone', 100) },
    { id: 'quest_500', cat: 'quests', icon: 'crown', name: 'Unermüdlich',
      desc: 'Erledige 500 Quests.', check: statMin('questsDone', 500) },
    { id: 'quest_tag', cat: 'quests', icon: 'star', name: 'Tagwerk vollbracht',
      desc: 'Hake an einem Tag alle deine Quests ab (mindestens 3).',
      check: function (s, g) {
        var list = safe(function () { return g.questsToday(); }, null);
        if (!Array.isArray(list) || list.length < 3) return false;
        return list.every(function (q) { return q && q.done; });
      } },

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
        var list = s && s.kcal && s.kcal.entries;
        return Array.isArray(list) && list.some(function (e) { return e && num(e.kcal) > 0; });
      } },
    { id: 'kcal_10k', cat: 'kalorien', icon: 'kcal', name: 'Zehntausend weg',
      desc: 'Zahle insgesamt 10.000 kcal Schulden ab.', check: statMin('kcalPaid', 10000) },
    { id: 'kcal_50k', cat: 'kalorien', icon: 'scale', name: 'Schuldenfresser',
      desc: 'Zahle insgesamt 50.000 kcal Schulden ab.', check: statMin('kcalPaid', 50000) },
    { id: 'kcal_halb', cat: 'kalorien', icon: 'flag', name: 'Halbzeit',
      desc: 'Zahle die Hälfte deiner Kalorienschulden ab.',
      check: function (s, g) {
        var st = safe(function () { return g.kcalStatus(); }, null);
        return !!(st && st.hasGoal && num(st.pctPaid) >= 50);
      } },
    { id: 'ich_bin_gesund', cat: 'kalorien', icon: 'heart', name: 'ICH BIN GESUND!',
      desc: 'Alle Kalorienschulden sind bezahlt.',
      check: function (s) { return !!(s && s.kcal && s.kcal.healthyAt); } },

    /* ---------- Sonstiges ---------- */
    { id: 'labs', cat: 'sonstiges', icon: 'flask', name: 'Loss Always Builds Strength',
      desc: 'Verliere deinen ersten Kampf. Aus Niederlagen wirst du stark.', check: statMin('fightsLost', 1) },
    { id: 'nicht_aufgeben', cat: 'sonstiges', icon: 'shield', name: 'Nicht aufgeben',
      desc: 'Verliere 10 Kämpfe – und mach trotzdem weiter.', check: statMin('fightsLost', 10) },
    { id: 'saetze_100', cat: 'sonstiges', icon: 'target', name: 'Satz für Satz',
      desc: 'Trag 100 Sätze ein (Gym und Kampf).', check: statMin('setsLogged', 100) },
    { id: 'saetze_1000', cat: 'sonstiges', icon: 'medal', name: 'Tausend Sätze',
      desc: 'Trag 1.000 Sätze ein.', check: statMin('setsLogged', 1000) },
    { id: 'schaden_100k', cat: 'sonstiges', icon: 'bolt', name: 'Abrissbirne',
      desc: 'Mach insgesamt 100.000 Schaden (Gym und Kampf).', check: statMin('totalDamage', 100000) },
    { id: 'schaden_1m', cat: 'sonstiges', icon: 'star', name: 'Millionen-Wucht',
      desc: 'Mach insgesamt 1.000.000 Schaden.', check: statMin('totalDamage', 1000000) }
  ];
})();
