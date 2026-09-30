/* Operator – feste Spielwerte (global: OP.data) */
(function () {
  'use strict';
  var OP = (window.OP = window.OP || {});
  var D = (OP.data = OP.data || {});

  D.VERSION = '2.0.0';

  /* 6 Kampf-Muskeln mit eigenem XP-Wert, sortiert nach Trainings-Gruppe (Push, Pull, Beine) */
  D.MUSCLES = [
    { id: 'brust', name: 'Brust', group: 'push', icon: 'brust' },
    { id: 'trizeps', name: 'Trizeps', group: 'push', icon: 'trizeps' },
    { id: 'schultern', name: 'Schultern', group: 'push', icon: 'schultern' },
    { id: 'ruecken', name: 'Rücken', group: 'pull', icon: 'ruecken' },
    { id: 'bizeps', name: 'Bizeps', group: 'pull', icon: 'bizeps' },
    { id: 'beine', name: 'Beine', group: 'legs', icon: 'beine' }
  ];
  D.MUSCLE_IDS = D.MUSCLES.map(function (m) { return m.id; });
  D.muscle = function (id) {
    if (id === 'bauch') return { id: 'bauch', name: 'Bauch', icon: 'bauch' };
    for (var i = 0; i < D.MUSCLES.length; i++) if (D.MUSCLES[i].id === id) return D.MUSCLES[i];
    return null;
  };

  /* Trainings-Gruppen: Kaempfe und Gym-Einheiten gelten immer einer ganzen Gruppe */
  D.GROUPS = [
    { id: 'push', name: 'Push', icon: 'push', color: '#ff8a3d', muscles: ['brust', 'trizeps', 'schultern'], hint: 'Drücken: Brust, Trizeps, Schultern' },
    { id: 'pull', name: 'Pull', icon: 'pull', color: '#7cb8ff', muscles: ['ruecken', 'bizeps'], hint: 'Ziehen: Rücken, Bizeps' },
    { id: 'legs', name: 'Beine', icon: 'beine', color: '#a6ff4d', muscles: ['beine'], hint: 'Beine und Po' }
  ];
  D.GROUP_IDS = D.GROUPS.map(function (g) { return g.id; });
  D.group = function (id) {
    for (var i = 0; i < D.GROUPS.length; i++) if (D.GROUPS[i].id === id) return D.GROUPS[i];
    return null;
  };
  /** Gruppe eines Muskels ('brust' -> 'push'). Alte Speicherstaende: 'arme' gehoerte zu Push und Pull. */
  D.groupOf = function (muscleId) {
    var m = D.muscle(muscleId);
    return m && m.group ? m.group : null;
  };

  /* Profil: Zeilen nach Gruppe, Bauch (Challenge) steht wie am Koerper vor den Beinen */
  D.PROFILE_ORDER = ['brust', 'trizeps', 'schultern', 'ruecken', 'bizeps', 'bauch', 'beine'];
  D.PROFILE_SECTIONS = [
    { id: 'push', name: 'Push', icon: 'push', rows: ['brust', 'trizeps', 'schultern'] },
    { id: 'pull', name: 'Pull', icon: 'pull', rows: ['ruecken', 'bizeps'] },
    { id: 'bauch', name: 'Bauch', icon: 'bauch', rows: ['bauch'] },
    { id: 'legs', name: 'Beine', icon: 'beine', rows: ['beine'] }
  ];

  /* Raenge (Namen und Farben). Die Schwellen stehen pro Muskel in RANK_DEFAULTS,
     weil Bizeps/Trizeps viel weniger XP pro Einheit bringen als Brust, Ruecken oder Beine.
     Alles in der Zauberbude pro Muskel anpassbar. */
  D.RANKS = [
    { id: 'holz', name: 'Holz', min: 0, color: '#a0703f' },
    { id: 'eisen', name: 'Eisen', min: 500, color: '#8e9aa6' },
    { id: 'bronze', name: 'Bronze', min: 1000, color: '#d08a4a' },
    { id: 'silber', name: 'Silber', min: 1600, color: '#d6e0e8' },
    { id: 'gold', name: 'Gold', min: 2800, color: '#f2c14e' },
    { id: 'platin', name: 'Platin', min: 4500, color: '#5fe8d6' },
    { id: 'diamant', name: 'Diamant', min: 6500, color: '#7cb8ff' },
    { id: 'legende', name: 'Legende', min: 8000, color: '#ff5c8a' }
  ];
  D.RANK_THRESHOLDS = D.RANKS.map(function (r) { return r.min; });
  D.RANK_DEFAULTS = {
    brust: [0, 500, 1000, 1600, 2800, 4500, 6500, 8000],
    trizeps: [0, 250, 500, 800, 1400, 2250, 3250, 4000],
    schultern: [0, 300, 600, 1000, 1700, 2700, 3900, 4800],
    ruecken: [0, 500, 1000, 1600, 2800, 4500, 6500, 8000],
    bizeps: [0, 250, 500, 800, 1400, 2250, 3250, 4000],
    beine: [0, 600, 1250, 2000, 3500, 5600, 8100, 10000]
  };
  /* Bauch-Rang nach bester Plank-Zeit in Sekunden */
  D.ABS_RANK_SECONDS = [0, 20, 40, 60, 90, 120, 150, 180];

  /* Schwierigkeiten: Prozent-Aufschlag auf den aktuellen XP-Wert = Gegner-HP.
     Immer zwei Nachkommastellen, jede Stufe beginnt 0,01 ueber der Stufe darunter.
     Die Prozente werden in der Taverne/Arena NICHT angezeigt, nur der Name. */
  D.DIFFICULTIES = [
    { id: 'sehr_einfach', name: 'Sehr einfach', min: 0.81, max: 1.20, pool: 'abenteuer', tiers: [1, 2], color: '#7fd1ff' },
    { id: 'easy', name: 'Einfach', min: 1.21, max: 2.00, pool: 'abenteuer', tiers: [1, 3], color: '#a6ff4d' },
    { id: 'medium', name: 'Medium', min: 2.01, max: 2.90, pool: 'abenteuer', tiers: [2, 4], color: '#ffb53d' },
    { id: 'hard', name: 'Hard', min: 2.91, max: 4.00, pool: 'arena', tiers: [3, 5], color: '#ff6b3d' },
    { id: 'insane', name: 'Insane', min: 4.01, max: 5.00, pool: 'arena', tiers: [4, 5], color: '#ff3d57' }
  ];
  D.difficulty = function (id) {
    for (var i = 0; i < D.DIFFICULTIES.length; i++) if (D.DIFFICULTIES[i].id === id) return D.DIFFICULTIES[i];
    return null;
  };
  /* Feste Slots auf den Brettern. Nach jedem Kampf kommt in den Slot ein neues Angebot gleicher Stufe. */
  D.OFFER_SLOTS = {
    abenteuer: ['sehr_einfach', 'easy', 'medium', 'easy'],
    arena: ['hard', 'hard', 'insane']
  };
  /* Hoechste Gegner-Stufe (Tier 1-5) je Runner-Rang-Index (0 = Holz ... 7 = Legende) */
  D.MAX_TIER_BY_RUNNER_RANK = [2, 2, 3, 3, 4, 4, 5, 5];

  /* Kampf: verstecktes Satz-Limit (zufaellig pro Kampf) und Kritisch-Regel */
  D.FIGHT_SET_LIMIT = { min: 25, max: 30 };
  D.CRIT_SHARE = 0.10;           // Treffer > 10 % der Max-HP der getroffenen Seite = kritisch
  D.PLAYER_MIN_HP = 300;         // Spieler-HP mindestens so hoch (sonst waere bei 0 XP das Satz-Limit sichtbar)

  /* Zirkus-Taenze (Bauch). Alle Uebungen laufen zusammen in einem Tanz.
     step = Progression pro geschaffter Uebung. decay = Retention, laeuft immer (egal ob trainiert).
     Wiederholungen intern mit Nachkommastellen, angezeigt und verlangt wird abgerundet (11,6 -> 11). */
  D.ABS_EXERCISES = [
    { id: 'plank', name: 'Plank', short: 'Plank', unit: 's', step: 1, start: 15,
      decay: { amount: 1, everyDays: 14 }, hint: 'Unterarmstütz, Körper gerade halten.' },
    { id: 'seitplank_l', name: 'Seitlicher Plank links', short: 'Seitplank L', unit: 's', step: 1, start: 10,
      decay: { amount: 1, everyDays: 14 }, hint: 'Auf dem linken Unterarm, Hüfte oben.' },
    { id: 'seitplank_r', name: 'Seitlicher Plank rechts', short: 'Seitplank R', unit: 's', step: 1, start: 10,
      decay: { amount: 1, everyDays: 14 }, hint: 'Auf dem rechten Unterarm, Hüfte oben.' },
    { id: 'crunches', name: 'Crunches', short: 'Crunches', unit: 'reps', step: 0.5, start: 10,
      decay: { amount: 0.1, everyDays: 1 }, hint: 'Sauber und kontrolliert.' },
    { id: 'situps', name: 'Sit-ups', short: 'Sit-ups', unit: 'reps', step: 0.5, start: 10,
      decay: { amount: 0.1, everyDays: 1 }, hint: 'Ganz hoch, ganz runter.' }
  ];
  D.absExercise = function (id) {
    for (var i = 0; i < D.ABS_EXERCISES.length; i++) if (D.ABS_EXERCISES[i].id === id) return D.ABS_EXERCISES[i];
    return null;
  };
  D.ABS_MIN_TARGET = 1;          // Retention senkt nie unter diesen Wert

  /* Zirkus-Sperre: so viele Tage ohne Zirkus-Eintrag, dann sind diese Bereiche gesperrt */
  D.CIRCUS_LOCK_DAYS = 2;
  D.LOCKED_AREAS = ['arena', 'gym', 'abenteuer', 'schmuggler'];
  D.LOCK_TEXT = 'Gesperrt: Erledige zuerst deinen Zirkus-Tanz.';
  D.LOCK_WARN_TEXT = 'Morgen gesperrt: Heute einen Zirkus-Tanz machen.';

  /* Gym-Ausdauer: zwei Lauf-Timer (Werte in Minuten, zwei Nachkommastellen) */
  D.RUNS = [
    { id: 'steady', name: 'Joggen am Stück', icon: 'run',
      hint: 'Timer an, laufen ohne Pause, Timer aus.' },
    { id: 'total', name: 'Laufzeit gesamt', icon: 'timer',
      hint: 'Laufen, Pause beim Gehen, weiter laufen. Nur die Laufzeit zählt.' }
  ];
  D.run = function (id) {
    for (var i = 0; i < D.RUNS.length; i++) if (D.RUNS[i].id === id) return D.RUNS[i];
    return null;
  };
  D.RUN_STEADY_PCT = { min: 1, max: 5 };   // Progression am Stueck: +1 bis 5 % (zufaellig) bei Erfolg
  D.RUN_STEADY_DECAY = 0.001;              // Retention am Stueck: -0,1 % pro Tag, immer
  D.RUN_TOTAL_STEP = 1;                    // Laufzeit gesamt: naechstes Ziel = Rekord + 1 Minute
  D.RUN_MAX_MIN = 1440;                    // mehr als 24 Stunden = Timer vergessen

  /* Tages-Quest-Kategorien */
  D.QUEST_CATEGORIES = [
    { id: 'lernen', name: 'Lernen', icon: 'book', color: '#7cb8ff', hint: 'Studieren, Lesen, Hacken, Kurse' },
    { id: 'training', name: 'Training', icon: 'gym', color: '#3ee6d0', hint: 'Sport, Dehnen, Spazieren' },
    { id: 'arbeit', name: 'Arbeit', icon: 'briefcase', color: '#ffb53d', hint: 'Job, Bewerbungen, E-Mails' },
    { id: 'projekte', name: 'Projekte', icon: 'hammer', color: '#a97bff', hint: 'Eigene Projekte, Coding, Basteln' },
    { id: 'gesundheit', name: 'Gesundheit', icon: 'heart', color: '#a6ff4d', hint: 'Wasser, Schlaf, Ernährung' },
    { id: 'haushalt', name: 'Haushalt', icon: 'home', color: '#d6e0e8', hint: 'Putzen, Einkaufen, Wäsche' },
    { id: 'soziales', name: 'Soziales', icon: 'users', color: '#ff5c8a', hint: 'Familie, Freunde, Anrufe' },
    { id: 'sonstiges', name: 'Sonstiges', icon: 'dots', color: '#8aa0ad', hint: 'Alles andere' }
  ];
  D.questCategory = function (id) {
    for (var i = 0; i < D.QUEST_CATEGORIES.length; i++) if (D.QUEST_CATEGORIES[i].id === id) return D.QUEST_CATEGORIES[i];
    return D.QUEST_CATEGORIES[D.QUEST_CATEGORIES.length - 1];
  };

  D.KCAL_PER_KG = 7700;
  D.RETENTION_PER_DAY = 0.001;   // 0,1 % pro Tag ohne Training (alle 6 XP-Werte)
  D.GYM_GOAL_PCT = 1;            // Gym: +1 %
  D.CARDIO_STEP = 1.05;          // Schmuggler: +5 % pro Erfolg
  D.MUSCLE_CHANCE_DAYS = 14;     // Fenster fuer die Gruppen-Chancen (Push/Pull/Beine)
  D.FREE_SKIPS_PER_DAY = 1;      // Angebote ablehnen: so oft pro Tag gratis (spaeter mehr gegen Gold)
  D.CARDIO_CANCEL_MIN = 5;       // Schmuggler: ohne Wertung abbrechen nur in den ersten N Minuten
  D.HIGH_LEVEL_TIER = { troll: 4, drache: 5 };  // Trolle/Drachen erst, wenn der Runner-Rang diese Gegner-Stufe erlaubt
  D.DEFAULT_BODYWEIGHT = 80;
})();
