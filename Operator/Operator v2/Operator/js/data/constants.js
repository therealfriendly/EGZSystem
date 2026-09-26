/* Operator – feste Spielwerte (global: OP.data) */
(function () {
  'use strict';
  var OP = (window.OP = window.OP || {});
  var D = (OP.data = OP.data || {});

  D.VERSION = '1.0.0';

  /* 5 Kampf-Muskelgruppen, Reihenfolge wie am Koerper von oben nach unten */
  D.MUSCLES = [
    { id: 'ruecken', name: 'Rücken', icon: 'ruecken' },
    { id: 'brust', name: 'Brust', icon: 'brust' },
    { id: 'arme', name: 'Arme', icon: 'arme' },
    { id: 'schultern', name: 'Schultern', icon: 'schultern' },
    { id: 'beine', name: 'Beine', icon: 'beine' }
  ];
  D.MUSCLE_IDS = D.MUSCLES.map(function (m) { return m.id; });
  D.muscle = function (id) {
    if (id === 'bauch') return { id: 'bauch', name: 'Bauch', icon: 'bauch' };
    for (var i = 0; i < D.MUSCLES.length; i++) if (D.MUSCLES[i].id === id) return D.MUSCLES[i];
    return null;
  };
  /* Reihenfolge im Profil (Bauch ist Challenge, steht aber am Koerper zwischen Schultern und Beinen) */
  D.PROFILE_ORDER = ['ruecken', 'brust', 'arme', 'schultern', 'bauch', 'beine'];

  /* Raenge. min = XP pro Trainingseinheit (Summe aller Saetze). Pro Muskel in der Zauberbude anpassbar. */
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
  /* Bauch-Rang nach bester Plank-Zeit in Sekunden */
  D.ABS_RANK_SECONDS = [0, 20, 40, 60, 90, 120, 150, 180];

  /* Schwierigkeiten: Prozent-Aufschlag auf den aktuellen XP-Wert = Gegner-HP */
  D.DIFFICULTIES = [
    { id: 'sehr_einfach', name: 'Sehr einfach', min: 0.8, max: 1.2, pool: 'abenteuer', tiers: [1, 2], color: '#7fd1ff' },
    { id: 'easy', name: 'Easy', min: 1.2, max: 2.0, pool: 'abenteuer', tiers: [1, 3], color: '#a6ff4d' },
    { id: 'medium', name: 'Medium', min: 2.0, max: 2.9, pool: 'abenteuer', tiers: [2, 4], color: '#ffb53d' },
    { id: 'hard', name: 'Hard', min: 3.0, max: 4.0, pool: 'arena', tiers: [3, 5], color: '#ff6b3d' },
    { id: 'insane', name: 'Insane', min: 5.0, max: 5.0, pool: 'arena', tiers: [4, 5], color: '#ff3d57' }
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

  /* Bauch-Challenges ("Zirkus-Taenze") */
  D.ABS_EXERCISES = [
    { id: 'plank', name: 'Plank', unit: 's', step: 5, start: 15, hint: 'Unterarmstütz, Körper gerade halten.' },
    { id: 'seitplank', name: 'Seitliche Planks', unit: 's', step: 5, start: 10, hint: 'Pro Seite. Trag die Zeit der schwächeren Seite ein.' },
    { id: 'crunches', name: 'Crunches', unit: 'reps', step: 1, start: 10, hint: 'Sauber und kontrolliert.' },
    { id: 'situps', name: 'Sit-ups', unit: 'reps', step: 1, start: 10, hint: 'Ganz hoch, ganz runter.' }
  ];
  D.absExercise = function (id) {
    for (var i = 0; i < D.ABS_EXERCISES.length; i++) if (D.ABS_EXERCISES[i].id === id) return D.ABS_EXERCISES[i];
    return null;
  };

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
  D.RETENTION_PER_DAY = 0.001;   // 0,1 % pro Tag ohne Training
  D.GYM_GOAL_PCT = 1;            // Gym: +1 %
  D.CARDIO_STEP = 1.05;          // Schmuggler: +5 % pro Erfolg
  D.MUSCLE_CHANCE_DAYS = 14;     // Fenster fuer die Muskel-Chancen
  D.FREE_SKIPS_PER_DAY = 1;      // Angebote ablehnen: so oft pro Tag gratis (spaeter mehr gegen Gold)
  D.CARDIO_CANCEL_MIN = 5;       // Schmuggler: ohne Wertung abbrechen nur in den ersten N Minuten
  D.HIGH_LEVEL_TIER = { troll: 4, drache: 5 };  // Trolle/Drachen erst, wenn der Runner-Rang diese Gegner-Stufe erlaubt
  D.DEFAULT_BODYWEIGHT = 80;
})();
