/* Operator – Spielregeln (global: OP.game)
   Alle Funktionen, die etwas veraendern, speichern selbst (OP.store.save) und
   pruefen danach die Achievements. Rueckgabewerte sind einfache Objekte fuer die UI. */
(function () {
  'use strict';
  var OP = (window.OP = window.OP || {});
  var D = OP.data, U = OP.util;

  function S() { return OP.state; }
  function enemies() { return (D.ENEMIES || []); }
  function cardioDefs() { return (D.CARDIO || []); }

  /* ================= Hilfen ================= */

  function logEntry(type, data) {
    var e = { t: Date.now(), day: U.today(), type: type };
    for (var k in data) e[k] = data[k];
    S().log.push(e);
    return e;
  }

  /** Trainingstag markieren (zaehlt fuer Streak und schuetzt vor Retention). day optional (Standard: heute) */
  function markTraining(kind, day) {
    day = day || U.today();
    var s = S();
    var d = s.days[day] || (s.days[day] = { train: 0 });
    d.train = (d.train || 0) + 1;
    d[kind] = (d[kind] || 0) + 1;
  }

  /** Jeder eingetragene Satz zaehlt sofort als Training fuer seinen Tag
      (auch wenn die Einheit erst nach Mitternacht beendet wird). delta -1 = Satz geloescht. */
  function touchDay(day, delta) {
    var s = S();
    var d = s.days[day] || (s.days[day] = { train: 0 });
    d.sets = Math.max(0, (d.sets || 0) + (delta || 1));
    if (!d.sets && !d.train && Object.keys(d).length <= 2) delete s.days[day];
  }

  /** Tag eines Satzes (neue Saetze haben .d, alte nur den Zeitstempel .t) */
  function setDay(set) { return (set && set.d) || U.dayKey(set && set.t ? set.t : Date.now()); }

  /** Training einer Einheit dem Tag des letzten Satzes zuschreiben (nicht dem Tag des Beendens) */
  function sessionDay(sets) { return sets.length ? setDay(sets[sets.length - 1]) : U.today(); }

  /** Wurde an diesem Tag trainiert? */
  function dayTrained(d) { return !!(d && (d.train > 0 || d.sets > 0)); }

  /** Nach jeder Aktion: Streak, Achievements, speichern. silent = ohne Feier (z. B. bei der Einrichtung) */
  function commit(reason, silent) {
    updateLongestStreak();
    var unlocked = game.checkAchievements(true, silent);
    OP.store.save(reason);
    return unlocked;
  }

  function sumSets(sets) {
    var t = 0;
    for (var i = 0; i < sets.length; i++) t += sets[i].dmg;
    return Math.round(t * 100) / 100;
  }

  function validSet(weight, reps) {
    var w = U.parseNum(weight), r = U.parseNum(reps);
    if (!isFinite(w) || !isFinite(r)) return { ok: false, error: 'Bitte Gewicht und Wiederholungen eingeben.' };
    if (w <= 0 || w > 1000) return { ok: false, error: 'Gewicht muss zwischen 0 und 1000 kg liegen.' };
    if (r <= 0 || r > 1000 || Math.floor(r) !== r) return { ok: false, error: 'Wiederholungen: ganze Zahl zwischen 1 und 1000.' };
    w = Math.round(w * 100) / 100;
    // Schaden/XP pro Satz als ganze Zahl (22,5 kg × 3 = 67,5 -> 68), damit Anzeige und Regel immer uebereinstimmen
    return { ok: true, w: w, r: r, dmg: Math.round(w * r) };
  }

  var game = {};

  /* ================= Raenge & Staerke ================= */

  /** 8 Schwellen fuer eine Muskelgruppe (Standard oder aus der Zauberbude) */
  game.thresholds = function (muscleId) {
    var o = S().settings.rankOverrides && S().settings.rankOverrides[muscleId];
    if (Array.isArray(o) && o.length === D.RANKS.length) return o.slice();
    return D.RANK_THRESHOLDS.slice();
  };

  function rankFromThresholds(value, th) {
    var idx = 0;
    for (var i = 0; i < th.length; i++) if (value >= th[i]) idx = i;
    var next = idx + 1 < th.length ? idx + 1 : -1;
    var from = th[idx], to = next >= 0 ? th[next] : null;
    return {
      index: idx,
      rank: D.RANKS[idx],
      next: next >= 0 ? D.RANKS[next] : null,
      nextMin: to,
      toNext: to != null ? Math.max(0, to - value) : 0,
      progress: to != null ? U.clamp((value - from) / (to - from), 0, 1) : 1
    };
  }

  /** Rang einer Kampf-Muskelgruppe nach aktuellem XP (oder uebergebenem Wert) */
  game.rankFor = function (muscleId, xp) {
    if (xp == null) xp = S().muscles[muscleId] ? S().muscles[muscleId].xp : 0;
    return rankFromThresholds(xp, game.thresholds(muscleId));
  };

  /** Bauch-Rang nach bester Plank-Zeit (Sekunden) */
  game.absRank = function (seconds) {
    if (seconds == null) seconds = S().abs.plank.best || 0;
    return rankFromThresholds(seconds, D.ABS_RANK_SECONDS);
  };

  /** Gesamtstaerke = Summe der 5 XP-Werte (gerundet) */
  game.totalStrength = function () {
    var t = 0;
    D.MUSCLE_IDS.forEach(function (id) { t += S().muscles[id].xp; });
    return Math.round(t);
  };

  /** Runner-Rang: Durchschnitt der 5 XP-Werte gegen die Standard-Schwellen */
  game.runnerRank = function () {
    return rankFromThresholds(game.totalStrength() / D.MUSCLE_IDS.length, D.RANK_THRESHOLDS);
  };

  /** Alle 6 Profil-Zeilen in Koerper-Reihenfolge */
  game.profileRows = function () {
    return D.PROFILE_ORDER.map(function (id) {
      if (id === 'bauch') {
        var best = S().abs.plank.best || 0;
        return { id: 'bauch', name: 'Bauch', value: best, unit: 's', rank: game.absRank(best) };
      }
      var xp = S().muscles[id].xp;
      return { id: id, name: D.muscle(id).name, value: xp, unit: 'xp', rank: game.rankFor(id, xp) };
    });
  };

  /* ================= Muskel-Chancen ================= */

  /** Wie oft wurde jede Muskelgruppe in den letzten 14 Tagen trainiert (Gym + Kaempfe mit Saetzen) */
  game.recentCounts = function () {
    var c = {}, from = U.addDays(U.today(), -(D.MUSCLE_CHANCE_DAYS - 1));
    D.MUSCLE_IDS.forEach(function (id) { c[id] = 0; });
    var log = S().log;
    for (var i = log.length - 1; i >= 0; i--) {
      var e = log[i];
      if (!e || typeof e !== 'object') continue;
      if (e.day < from) break;
      if ((e.type === 'gym' || e.type === 'fight') && e.muscle && e.sets > 0 && c[e.muscle] != null) c[e.muscle]++;
    }
    // gezaehlt werden nur beendete Einheiten (Gym oder Kampf mit mindestens einem Satz)
    return c;
  };

  /** Wahrscheinlichkeiten (Summe 1). Formel: Gewicht = 1 / (1 + Trainings der letzten 14 Tage) */
  game.muscleChances = function () {
    var c = game.recentCounts(), w = {}, sum = 0;
    D.MUSCLE_IDS.forEach(function (id) { w[id] = 1 / (1 + c[id]); sum += w[id]; });
    D.MUSCLE_IDS.forEach(function (id) { w[id] = w[id] / sum; });
    return w;
  };

  game.pickMuscle = function () { return U.weightedPick(game.muscleChances()); };

  /* ================= Angebote (Taverne / Arena) ================= */

  game.enemy = function (id) {
    var list = enemies();
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  };

  function pickEnemy(pool, diffId, excludeIds) {
    var diff = D.difficulty(diffId);
    var list = enemies();
    if (!list.length) return null;
    var maxByRank = D.MAX_TIER_BY_RUNNER_RANK[game.runnerRank().index];
    var lo = diff.tiers[0], hi = Math.min(diff.tiers[1], Math.max(lo, maxByRank));
    function inPool(e) { return e.pool === 'beide' || e.pool === pool; }
    // Trolle und Drachen sind High Level: erst ab passendem Runner-Rang
    function levelOk(e) {
      var need = D.HIGH_LEVEL_TIER && D.HIGH_LEVEL_TIER[e.kind];
      return !need || maxByRank >= need;
    }
    var cands = list.filter(function (e) {
      return inPool(e) && e.tier >= lo && e.tier <= hi && levelOk(e) && excludeIds.indexOf(e.id) < 0;
    });
    if (!cands.length) cands = list.filter(function (e) {
      return inPool(e) && e.tier >= lo && e.tier <= hi && excludeIds.indexOf(e.id) < 0;
    });
    if (pool === 'arena' && cands.length) {
      // Arena: meist Menschen, manchmal starke Fabelwesen (25 %)
      var humans = cands.filter(function (e) { return e.kind === 'mensch'; });
      var beasts = cands.filter(function (e) { return e.kind !== 'mensch'; });
      if (humans.length && beasts.length) cands = Math.random() < 0.75 ? humans : beasts;
    }
    if (!cands.length) cands = list.filter(function (e) { return inPool(e) && excludeIds.indexOf(e.id) < 0; });
    if (!cands.length) cands = list;
    return U.pick(cands);
  }

  function makeOffer(pool, diffId, excludeIds) {
    var diff = D.difficulty(diffId);
    var enemy = pickEnemy(pool, diffId, excludeIds || []);
    var pct = diff.min === diff.max ? diff.min : Math.round(U.rand(diff.min, diff.max) * 10) / 10;
    return {
      id: U.uid('o'),
      pool: pool,
      enemyId: enemy ? enemy.id : null,
      muscle: game.pickMuscle(),
      diff: diffId,
      pct: pct,
      created: Date.now()
    };
  }

  /** Fuellt die Bretter auf (Taverne 4, Arena 3). Speichert nur, wenn etwas neu ist. */
  game.ensureOffers = function () {
    var s = S(), changed = false;
    var fightOffer = s.fight ? s.fight.offerId : null;
    ['abenteuer', 'arena'].forEach(function (pool) {
      var slots = D.OFFER_SLOTS[pool], list = s.offers[pool], i;
      // kaputte Angebote entfernen (z. B. Gegner-Liste geaendert)
      for (i = list.length - 1; i >= 0; i--) {
        var bad = !list[i] || typeof list[i] !== 'object' || !D.difficulty(list[i].diff) || !D.muscle(list[i].muscle) ||
          (enemies().length && !game.enemy(list[i].enemyId));
        if (bad && !(list[i] && list[i].id === fightOffer)) { list.splice(i, 1); changed = true; }
      }
      // zu viele Angebote (OFFER_SLOTS verkleinert)? Ueberzaehlige weg, das laufende Kampf-Angebot bleibt
      for (i = list.length - 1; i >= slots.length; i--) {
        if (list[i].id !== fightOffer) { list.splice(i, 1); changed = true; }
      }
      // Slots neu sortiert? Angebot mit falscher Stufe ersetzen
      for (i = 0; i < list.length && i < slots.length; i++) {
        if (list[i].diff !== slots[i] && list[i].id !== fightOffer) {
          list[i] = makeOffer(pool, slots[i], list.map(function (o) { return o.enemyId; }));
          changed = true;
        }
      }
      while (list.length < slots.length) {
        var used = list.map(function (o) { return o.enemyId; });
        list.push(makeOffer(pool, slots[list.length], used));
        changed = true;
      }
    });
    if (changed) OP.store.save('offers');
    return s.offers;
  };

  /** Angebot + Gegner + Anzeige-Titel, z. B. "Reise ins Skelettland – Beine – Medium" */
  game.describeOffer = function (offer) {
    var e = game.enemy(offer.enemyId) || { name: 'Unbekannt', adventure: 'Unbekannte Mission' };
    var m = D.muscle(offer.muscle), d = D.difficulty(offer.diff);
    return {
      offer: offer, enemy: e, muscle: m, diff: d,
      title: e.adventure + ' – ' + m.name + ' – ' + d.name
    };
  };

  function replaceOffer(pool, offerId) {
    var list = S().offers[pool];
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === offerId) {
        var diffId = list[i].diff;
        var used = list.map(function (o) { return o.enemyId; });
        list[i] = makeOffer(pool, diffId, used);
        return list[i];
      }
    }
    return null;
  }

  /** Skip-Regel: FREE_SKIPS_PER_DAY Ablehnungen pro Tag gratis (spaeter: weitere gegen Gold).
      -> {free, used, left} */
  game.skipInfo = function () {
    var st = S().stats, free = D.FREE_SKIPS_PER_DAY;
    var used = st.skipDay === U.today() ? (st.skipsToday || 0) : 0;
    return { free: free, used: used, left: Math.max(0, free - used) };
  };

  /** Angebot ablehnen / neu wuerfeln. -> neues Angebot oder null (z. B. heute keine Ablehnung mehr frei) */
  game.rerollOffer = function (pool, offerId) {
    var st = S().stats;
    if (S().fight && S().fight.offerId === offerId) return null;
    if (game.skipInfo().left <= 0) return null;
    var o = replaceOffer(pool, offerId);
    if (o) {
      if (st.skipDay !== U.today()) { st.skipDay = U.today(); st.skipsToday = 0; }
      st.skipsToday = (st.skipsToday || 0) + 1;
      st.skips++;
      OP.store.save('reroll');
    }
    return o;
  };

  /* ================= Kampf ================= */

  /** HP = aktueller XP-Wert * (1 + Prozent/100), aufgerundet, mindestens 1 */
  game.enemyHp = function (xp, pct) { return Math.max(1, Math.ceil(xp * (1 + pct / 100) - 1e-9)); };

  /** Startet einen Kampf aus einem Angebot. -> {ok, fight} oder {ok:false, error} */
  game.startFight = function (pool, offerId) {
    var s = S();
    if (s.fight) {
      if (s.fight.offerId === offerId) return { ok: true, fight: s.fight };
      return { ok: false, error: 'Es läuft schon ein Kampf. Beende ihn zuerst.' };
    }
    var offer = null;
    s.offers[pool].forEach(function (o) { if (o.id === offerId) offer = o; });
    if (!offer) return { ok: false, error: 'Angebot nicht gefunden.' };
    var xp = s.muscles[offer.muscle].xp;
    s.fight = {
      offerId: offer.id, pool: pool, enemyId: offer.enemyId, muscle: offer.muscle,
      diff: offer.diff, pct: offer.pct,
      startXp: xp, hp: game.enemyHp(xp, offer.pct),
      sets: [], started: Date.now()
    };
    OP.store.save('fight-start');
    return { ok: true, fight: s.fight };
  };

  /** Laufender Kampf mit berechneten Werten (oder null) */
  game.fightStatus = function () {
    var f = S().fight;
    if (!f) return null;
    var total = sumSets(f.sets);
    // Steigt der XP-Wert waehrend des Kampfes (z. B. Gym), steigen die HP mit: HP = immer aktueller Wert + Prozent
    var m = S().muscles[f.muscle];
    var hp = Math.max(f.hp, game.enemyHp(m ? m.xp : 0, f.pct));
    return {
      fight: f, enemy: game.enemy(f.enemyId), muscle: D.muscle(f.muscle), diff: D.difficulty(f.diff),
      total: total, hp: hp, hpLeft: Math.max(0, hp - total),
      hpPct: U.clamp(1 - total / hp, 0, 1), defeated: total >= hp
    };
  };

  /** Satz eintragen: Schaden = Gewicht * Wiederholungen */
  game.addFightSet = function (weight, reps) {
    var f = S().fight;
    if (!f) return { ok: false, error: 'Kein Kampf aktiv.' };
    var v = validSet(weight, reps);
    if (!v.ok) return v;
    var before = game.fightStatus().defeated;
    f.sets.push({ w: v.w, r: v.r, dmg: v.dmg, t: Date.now(), d: U.today() });
    touchDay(U.today(), 1);
    OP.store.save('fight-set');
    var st = game.fightStatus();
    return { ok: true, dmg: v.dmg, status: st, justDefeated: !before && st.defeated };
  };

  game.removeFightSet = function (index) {
    var f = S().fight;
    if (!f || index < 0 || index >= f.sets.length) return false;
    var removed = f.sets.splice(index, 1)[0];
    touchDay(setDay(removed), -1);
    OP.store.save('fight-set');
    return true;
  };

  /** Kampf beenden. Gewonnen, wenn Schaden >= HP: ganzer Schaden wird neuer XP-Wert. */
  game.finishFight = function () {
    var s = S(), st = game.fightStatus();
    if (!st) return { ok: false, error: 'Kein Kampf aktiv.' };
    var f = st.fight;
    if (!f.sets.length) {  // ohne Saetze = einfach abbrechen
      s.fight = null;
      OP.store.save('fight-cancel');
      return { ok: true, cancelled: true };
    }
    var m = s.muscles[f.muscle], oldXp = m.xp, won = st.defeated, arena = f.pool === 'arena';
    f.hp = st.hp;
    // zuerst das neue Angebot ziehen: klappt das nicht, darf nichts halb gezaehlt sein
    try { replaceOffer(f.pool, f.offerId); } catch (e) { console.error('[game] neues Angebot', e); }
    // Sieg: ganzer Schaden wird neuer Wert (Sicherheitsnetz: ein Sieg senkt den Wert nie)
    if (won) { m.xp = Math.max(m.xp, st.total); m.peak = Math.max(m.peak || 0, m.xp); }
    var stt = s.stats;
    stt.fightsTotal++;
    if (won) stt.fightsWon++; else stt.fightsLost++;
    if (arena) { stt.arenaFights++; if (won) stt.arenaWins++; }
    if (won && f.diff === 'insane') stt.insaneWins++;
    if (won) {
      stt.enemiesDefeated[f.enemyId] = (stt.enemiesDefeated[f.enemyId] || 0) + 1;
      stt.defeatedTotal++;
    }
    stt.setsLogged += f.sets.length;
    stt.totalDamage += st.total;
    markTraining(arena ? 'arena' : 'fight', sessionDay(f.sets));
    logEntry('fight', {
      pool: f.pool, enemyId: f.enemyId, muscle: f.muscle, diff: f.diff, pct: f.pct,
      hp: f.hp, total: st.total, sets: f.sets.length, won: won, oldXp: oldXp, newXp: m.xp
    });
    s.fight = null;
    var unlocked = commit('fight-end');
    return {
      ok: true, won: won, enemy: st.enemy, muscle: st.muscle, diff: st.diff,
      hp: f.hp, total: st.total, oldXp: oldXp, newXp: m.xp, pool: f.pool, achievements: unlocked
    };
  };

  /** Laufenden Kampf verwerfen, ohne Wertung (nur solange noch kein Satz eingetragen ist) */
  game.cancelFight = function () {
    var f = S().fight;
    if (!f) return true;
    if (f.sets.length) return false;
    S().fight = null;
    OP.store.save('fight-cancel');
    return true;
  };

  /* ================= Gym ================= */

  /** Trainingsziel = aktueller Wert + 1 %, aufgerundet */
  game.gymTarget = function (xp) { return Math.max(1, Math.ceil(xp * (1 + D.GYM_GOAL_PCT / 100) - 1e-9)); };

  game.startGym = function (muscleId) {
    var s = S();
    if (!s.muscles[muscleId]) return { ok: false, error: 'Unbekannte Muskelgruppe.' };
    if (s.gym) {
      if (s.gym.muscle === muscleId) return { ok: true, gym: s.gym };
      return { ok: false, error: 'Es läuft schon ein Training (' + D.muscle(s.gym.muscle).name + ').' };
    }
    var xp = s.muscles[muscleId].xp;
    s.gym = { muscle: muscleId, startXp: xp, target: game.gymTarget(xp), sets: [], started: Date.now() };
    OP.store.save('gym-start');
    return { ok: true, gym: s.gym };
  };

  game.gymStatus = function () {
    var g = S().gym;
    if (!g) return null;
    var total = sumSets(g.sets);
    // Ziel = immer aktueller Wert + 1 % (falls der Wert waehrenddessen gestiegen ist)
    var m = S().muscles[g.muscle];
    var target = Math.max(g.target, game.gymTarget(m ? m.xp : 0));
    return {
      gym: g, muscle: D.muscle(g.muscle), total: total, target: target,
      left: Math.max(0, target - total), progress: U.clamp(total / target, 0, 1), reached: total >= target
    };
  };

  game.addGymSet = function (weight, reps) {
    var g = S().gym;
    if (!g) return { ok: false, error: 'Kein Training aktiv.' };
    var v = validSet(weight, reps);
    if (!v.ok) return v;
    var before = game.gymStatus().reached;
    g.sets.push({ w: v.w, r: v.r, dmg: v.dmg, t: Date.now(), d: U.today() });
    touchDay(U.today(), 1);
    OP.store.save('gym-set');
    var st = game.gymStatus();
    return { ok: true, xp: v.dmg, status: st, justReached: !before && st.reached };
  };

  game.removeGymSet = function (index) {
    var g = S().gym;
    if (!g || index < 0 || index >= g.sets.length) return false;
    var removed = g.sets.splice(index, 1)[0];
    touchDay(setDay(removed), -1);
    OP.store.save('gym-set');
    return true;
  };

  /** Training beenden: Ziel erreicht -> Summe wird neuer XP-Wert, sonst bleibt alles gleich */
  game.finishGym = function () {
    var s = S(), st = game.gymStatus();
    if (!st) return { ok: false, error: 'Kein Training aktiv.' };
    var g = st.gym;
    if (!g.sets.length) { s.gym = null; OP.store.save('gym-cancel'); return { ok: true, cancelled: true }; }
    var m = s.muscles[g.muscle], oldXp = m.xp, won = st.reached;
    g.target = st.target;
    if (won) { m.xp = Math.max(m.xp, st.total); m.peak = Math.max(m.peak || 0, m.xp); }
    s.stats.gymSessions++;
    if (won) s.stats.gymWins++;
    s.stats.setsLogged += g.sets.length;
    s.stats.totalDamage += st.total;
    markTraining('gym', sessionDay(g.sets));
    logEntry('gym', { muscle: g.muscle, target: st.target, total: st.total, sets: g.sets.length, won: won, oldXp: oldXp, newXp: m.xp });
    s.gym = null;
    var unlocked = commit('gym-end');
    return { ok: true, won: won, muscle: D.muscle(g.muscle), target: st.target, total: st.total, oldXp: oldXp, newXp: m.xp, achievements: unlocked };
  };

  game.cancelGym = function () {
    var g = S().gym;
    if (!g) return true;
    if (g.sets.length) return false;
    S().gym = null;
    OP.store.save('gym-cancel');
    return true;
  };

  /* ================= Bauch-Challenges ("Zirkus-Taenze") ================= */

  game.absStatus = function () {
    return D.ABS_EXERCISES.map(function (ex) {
      var a = S().abs[ex.id];
      return {
        ex: ex, target: a.target, best: a.best, wins: a.wins, fails: a.fails,
        progress: a.progress || 0, left: Math.max(0, a.target - (a.progress || 0))
      };
    });
  };

  function absWin(ex, a, value) {
    var old = a.target;
    a.wins++;
    a.target = old + ex.step;
    a.progress = 0;
    S().stats.absWins++;
    return old;
  }

  /** Wert eintragen. Zeit-Uebungen: ein Versuch (Sekunden). Wiederholungen: werden bis zum Ziel addiert. */
  game.absEnter = function (exId, amount) {
    var ex = D.absExercise(exId), a = S().abs[exId];
    if (!ex || !a) return { ok: false, error: 'Unbekannte Übung.' };
    var v = U.parseNum(amount);
    if (!isFinite(v) || v <= 0 || v > 36000) return { ok: false, error: 'Bitte eine Zahl größer 0 eingeben.' };
    v = Math.round(v);
    var res = { ok: true, ex: ex, value: v, oldTarget: a.target };
    if (ex.unit === 's') {
      S().stats.absAttempts++;
      a.best = Math.max(a.best || 0, v);
      if (v >= a.target) { absWin(ex, a, v); res.success = true; }
      else { a.fails++; res.success = false; }
      res.done = true;
    } else {
      a.progress = (a.progress || 0) + v;
      a.best = Math.max(a.best || 0, a.progress);
      if (a.progress >= a.target) {
        S().stats.absAttempts++;
        var reached = a.progress;
        absWin(ex, a, reached);
        res.success = true; res.done = true; res.value = reached;
      } else {
        res.success = false; res.done = false; res.left = a.target - a.progress;
      }
    }
    res.newTarget = a.target;
    res.best = a.best;
    markTraining('abs');
    if (res.done) logEntry('abs', { ex: exId, value: res.value, target: res.oldTarget, won: res.success });
    res.achievements = commit('abs');
    return res;
  };

  /** Wiederholungs-Challenge aufgeben (Fortschritt weg, zaehlt als nicht geschafft) */
  game.absGiveUp = function (exId) {
    var a = S().abs[exId], ex = D.absExercise(exId);
    if (!a || !ex || ex.unit === 's' || !a.progress) return false;
    logEntry('abs', { ex: exId, value: a.progress, target: a.target, won: false });
    a.fails++;
    S().stats.absAttempts++;
    a.progress = 0;
    commit('abs');
    return true;
  };

  /* ================= Schmuggler (Kardio) ================= */

  var KM_FMT = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 2 });

  function roundCardio(v, step) {
    step = step || 1;
    var r = Math.round(v / step) * step;
    return Math.round(r * 1000) / 1000;
  }

  /** Aktuelle Werte einer Kardio-Challenge: Wert und Zeitlimit wachsen um 5 % pro Erfolg */
  game.cardioInfo = function (def) {
    if (typeof def === 'string') def = game.cardioDef(def);
    if (!def) return null;
    var lv = S().cardio.levels[def.id] || { wins: 0, fails: 0 };
    var f = Math.pow(D.CARDIO_STEP, lv.wins);
    // jeder Erfolg: +5 %, aber mindestens eine Rundungsstufe mehr als vorher
    var value = roundCardio(def.base, def.round);
    for (var n = 1; n <= lv.wins; n++) {
      value = Math.max(roundCardio(def.base * Math.pow(D.CARDIO_STEP, n), def.round), roundCardio(value + (def.round || 1), def.round));
    }
    var limit = def.limitScale ? Math.ceil(def.limitMin * f) : def.limitMin;
    return { def: def, wins: lv.wins, fails: lv.fails, value: value, limitMin: limit, text: game.cardioText(def, value, limit) };
  };

  game.cardioDef = function (id) {
    var list = cardioDefs();
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  };

  /** Anzeige-Text, z. B. "3.000 Schritte in 60 Minuten" */
  game.cardioValueText = function (def, value) {
    switch (def.unit) {
      case 'schritte': return U.fmt(value) + ' Schritte';
      case 'km': return KM_FMT.format(value) + ' km';
      case 'sek': return value % 60 === 0 ? U.fmt(value / 60) + ' Minuten' : U.secs(value).replace(/\s?min$/, ' Minuten');
      case 'min': return U.fmt(value) + ' Minuten';
      case 'wdh': return U.fmt(value) + ' Wdh.';
      case 'hm': return U.fmt(value) + ' Höhenmeter';
      case 'stufen': return U.fmt(value) + ' Stufen';
      case 'intervall': return (def.sets || 1) + ' × ' + U.fmt(value) + ' s';
      default: return U.fmt(value) + ' ' + (def.unit || '');
    }
  };
  /** Zeit-Aufgaben (am Stueck / Intervalle) bekommen ein "Zeitfenster", Mengen-Aufgaben ein "in X Minuten" */
  game.cardioText = function (def, value, limitMin) {
    var v = game.cardioValueText(def, value);
    if (def.unit === 'sek' || def.unit === 'min') return v + ' am Stück · Zeitfenster ' + U.fmt(limitMin) + ' Minuten';
    if (def.unit === 'intervall') return v + ' · Zeitfenster ' + U.fmt(limitMin) + ' Minuten';
    return v + ' in ' + U.fmt(limitMin) + ' Minuten';
  };

  game.cardioList = function () { return cardioDefs().map(function (d) { return game.cardioInfo(d); }); };

  game.cardioStart = function (id) {
    var s = S();
    if (s.cardio.active) return { ok: false, error: 'Es läuft schon ein Schmuggler-Auftrag.' };
    var info = game.cardioInfo(id);
    if (!info) return { ok: false, error: 'Auftrag nicht gefunden.' };
    var now = Date.now();
    s.cardio.active = {
      id: id, value: info.value, limitMin: info.limitMin, text: info.text,
      startedAt: now, deadline: now + info.limitMin * 60000
    };
    OP.store.save('cardio-start');
    return { ok: true, active: s.cardio.active };
  };

  game.cardioStatus = function () {
    var a = S().cardio.active;
    if (!a) return null;
    var now = Date.now();
    return { active: a, def: game.cardioDef(a.id), msLeft: Math.max(0, a.deadline - now), expired: now > a.deadline };
  };

  /** Auftrag abschliessen: success true = geschafft (+5 % schwerer), false = verloren */
  game.cardioResolve = function (success) {
    var s = S(), a = s.cardio.active;
    if (!a) return { ok: false, error: 'Kein Auftrag aktiv.' };
    var lv = s.cardio.levels[a.id] || (s.cardio.levels[a.id] = { wins: 0, fails: 0 });
    if (success) { lv.wins++; s.stats.cardioWins++; } else { lv.fails++; s.stats.cardioFails++; }
    markTraining('cardio');
    logEntry('cardio', { id: a.id, value: a.value, limitMin: a.limitMin, won: !!success });
    s.cardio.active = null;
    var unlocked = commit('cardio-end');
    var next = game.cardioInfo(a.id);
    return { ok: true, won: !!success, def: game.cardioDef(a.id), next: next, achievements: unlocked };
  };

  /** Abbrechen ohne Wertung (innerhalb der ersten 5 Minuten) */
  game.cardioCancel = function () {
    var a = S().cardio.active;
    if (!a) return true;
    if (Date.now() - a.startedAt > D.CARDIO_CANCEL_MIN * 60000) return false;
    S().cardio.active = null;
    OP.store.save('cardio-cancel');
    return true;
  };

  /* ================= Kalorienschulden ================= */

  game.kcalSetGoal = function (kg) {
    var v = U.parseNum(kg);
    if (!isFinite(v) || v < 0 || v > 300) return { ok: false, error: 'Bitte ein Ziel zwischen 0 und 300 kg eingeben.' };
    var k = S().kcal;
    k.goalKg = Math.round(v * 10) / 10;
    var st = game.kcalStatus();
    if (!st.done) k.healthyAt = null;
    else if (!k.healthyAt) k.healthyAt = Date.now();
    var unlocked = commit('kcal-goal');
    return { ok: true, achievements: unlocked };
  };

  /** Schulden-Stand. paid zaehlt nur Eintraege seit dem aktuellen Ziel (base = Summe davor, siehe kcalNewGoal). */
  game.kcalStatus = function () {
    var k = S().kcal, total = Math.round((k.goalKg || 0) * D.KCAL_PER_KG), sum = 0;
    k.entries.forEach(function (e) { sum += e.kcal; });
    var paid = sum - (k.base || 0);
    var remaining = Math.max(0, total - paid);
    return {
      goalKg: k.goalKg || 0, total: total, paid: paid, remaining: remaining,
      pctRemaining: total > 0 ? Math.min(100, remaining / total * 100) : 0,
      pctPaid: total > 0 ? U.clamp((1 - remaining / total) * 100, 0, 100) : 0,
      kgRemaining: remaining / D.KCAL_PER_KG,
      hasGoal: total > 0, done: total > 0 && remaining <= 0, healthyAt: k.healthyAt,
      baseT: k.baseT || 0
    };
  };

  /** Neues Ziel ab jetzt (z. B. nach "ICH BIN GESUND!"): alte Eintraege zaehlen nicht mehr, neue Schulden = kg × 7.700 */
  game.kcalNewGoal = function (kg) {
    var v = U.parseNum(kg);
    if (!isFinite(v) || v <= 0 || v > 300) return { ok: false, error: 'Bitte ein Ziel zwischen 0,1 und 300 kg eingeben.' };
    var k = S().kcal, sum = 0;
    k.entries.forEach(function (e) { sum += e.kcal; });
    k.base = sum;
    k.baseT = Date.now();
    k.goalKg = Math.round(v * 10) / 10;
    k.healthyAt = null;
    var unlocked = commit('kcal-goal');
    return { ok: true, achievements: unlocked };
  };

  /** kcal > 0: Defizit (zahlt ab). kcal < 0: Ueberschuss (neue Schulden). */
  game.kcalAdd = function (kcal, note, day) {
    var v = U.parseNum(kcal);
    if (!isFinite(v) || v === 0) return { ok: false, error: 'Bitte eine kcal-Zahl eingeben (nicht 0).' };
    if (Math.abs(v) > 100000) return { ok: false, error: 'Maximal 100.000 kcal pro Eintrag.' };
    var k = S().kcal, wasDone = game.kcalStatus().done;
    var e = { id: U.uid('k'), day: day || U.today(), kcal: Math.round(v), note: String(note || '').slice(0, 80), t: Date.now() };
    k.entries.push(e);
    if (v > 0) S().stats.kcalPaid += Math.round(v);
    logEntry('kcal', { kcal: e.kcal, note: e.note });
    var st = game.kcalStatus();
    var justHealthy = false;
    if (st.done && !k.healthyAt) { k.healthyAt = Date.now(); justHealthy = true; }
    if (!st.done) k.healthyAt = null;
    var unlocked = commit('kcal');
    return { ok: true, entry: e, status: game.kcalStatus(), justHealthy: justHealthy && !wasDone, achievements: unlocked };
  };

  /** Eintrag loeschen. -> {ok, justHealthy, achievements} oder false */
  game.kcalRemove = function (entryId) {
    var k = S().kcal;
    for (var i = 0; i < k.entries.length; i++) {
      if (k.entries[i].id === entryId) {
        var e = k.entries[i];
        if (e.kcal > 0) S().stats.kcalPaid = Math.max(0, S().stats.kcalPaid - e.kcal);
        // Eintrag von vor dem aktuellen Ziel? Dann Basis mit anpassen, damit der Stand gleich bleibt
        if (k.baseT && (e.t || 0) <= k.baseT) k.base = (k.base || 0) - e.kcal;
        k.entries.splice(i, 1);
        var st = game.kcalStatus(), justHealthy = false;
        if (st.done && !k.healthyAt) { k.healthyAt = Date.now(); justHealthy = true; }
        if (!st.done) k.healthyAt = null;
        var unlocked = commit('kcal');
        return { ok: true, justHealthy: justHealthy, achievements: unlocked };
      }
    }
    return false;
  };

  /* ================= Tages-Quests ================= */

  game.questAdd = function (title, cat) {
    var t = String(title || '').trim();
    if (!t) return { ok: false, error: 'Bitte einen Namen eingeben.' };
    var q = { id: U.uid('q'), title: t.slice(0, 60), cat: D.questCategory(cat).id, created: Date.now(), archived: false };
    S().quests.list.push(q);
    OP.store.save('quest-add');
    return { ok: true, quest: q };
  };

  game.questEdit = function (id, data) {
    var q = game.quest(id);
    if (!q) return { ok: false, error: 'Quest nicht gefunden.' };
    if (data.title != null) { var t = String(data.title).trim(); if (!t) return { ok: false, error: 'Name fehlt.' }; q.title = t.slice(0, 60); }
    if (data.cat != null) q.cat = D.questCategory(data.cat).id;
    OP.store.save('quest-edit');
    return { ok: true, quest: q };
  };

  /** Quest entfernen (wird archiviert, damit die Historie stimmt) */
  game.questRemove = function (id) {
    var q = game.quest(id);
    if (!q) return false;
    q.archived = true;
    OP.store.save('quest-remove');
    return true;
  };

  /** Reihenfolge aendern: dir = -1 (hoch) oder +1 (runter) */
  game.questMove = function (id, dir) {
    var list = S().quests.list, i = -1;
    for (var k = 0; k < list.length; k++) if (list[k].id === id) i = k;
    if (i < 0) return false;
    var j = i + dir;
    while (j >= 0 && j < list.length && list[j].archived) j += dir;
    if (j < 0 || j >= list.length) return false;
    var tmp = list[i]; list[i] = list[j]; list[j] = tmp;
    OP.store.save('quest-move');
    return true;
  };

  game.quest = function (id) {
    var list = S().quests.list;
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  };

  /** Heutige Quests: [{quest, cat, done}] (nur aktive) */
  game.questsToday = function () {
    var done = S().quests.done[U.today()] || [];
    return S().quests.list.filter(function (q) { return !q.archived; }).map(function (q) {
      return { quest: q, cat: D.questCategory(q.cat), done: done.indexOf(q.id) >= 0 };
    });
  };

  /** Abhaken (ueberall erlaubt, auch auf der Karte) */
  game.questCheck = function (id) {
    var day = U.today(), s = S();
    if (!game.quest(id)) return { ok: false };
    var list = s.quests.done[day] || (s.quests.done[day] = []);
    if (list.indexOf(id) >= 0) return { ok: true, already: true };
    list.push(id);
    s.stats.questsDone++;
    logEntry('quest', { id: id, done: true });
    var unlocked = commit('quest-check');
    return { ok: true, achievements: unlocked };
  };

  /** Zuruecknehmen (nur im Haus anbieten!) */
  game.questUncheck = function (id) {
    var day = U.today(), s = S(), list = s.quests.done[day];
    if (!list) return false;
    var i = list.indexOf(id);
    if (i < 0) return false;
    list.splice(i, 1);
    if (!list.length) delete s.quests.done[day];
    s.stats.questsDone = Math.max(0, s.stats.questsDone - 1);
    logEntry('quest', { id: id, done: false });
    commit('quest-uncheck');
    return true;
  };

  /* ================= Streak ================= */

  game.isActiveDay = function (day) {
    var s = S();
    return !!(dayTrained(s.days[day]) || (s.quests.done[day] && s.quests.done[day].length));
  };

  function activeDayList() {
    var s = S(), set = {};
    Object.keys(s.days).forEach(function (d) { if (dayTrained(s.days[d])) set[d] = 1; });
    Object.keys(s.quests.done).forEach(function (d) { if (s.quests.done[d] && s.quests.done[d].length) set[d] = 1; });
    return Object.keys(set).sort();
  }

  /** {current, longest, todayActive}. Heute noch nicht aktiv? Streak von gestern laeuft weiter bis Mitternacht. */
  game.streakInfo = function () {
    var today = U.today(), todayActive = game.isActiveDay(today);
    var d = todayActive ? today : U.addDays(today, -1), cur = 0;
    while (game.isActiveDay(d)) { cur++; d = U.addDays(d, -1); }
    var longest = 0, run = 0, prev = null;
    activeDayList().forEach(function (day) {
      run = prev && U.diffDays(prev, day) === 1 ? run + 1 : 1;
      if (run > longest) longest = run;
      prev = day;
    });
    return { current: cur, longest: Math.max(longest, cur), todayActive: todayActive };
  };

  function updateLongestStreak() {
    var info = game.streakInfo();
    S().streak.longest = info.longest;
    return info;
  }

  /* ================= Retention ================= */

  /** Jeder volle Tag ohne Training (bis gestern) senkt alle 5 XP-Werte um 0,1 %.
      -> {days, factor, lost: {muscle: xpVerlust}} ; days = 0, wenn nichts passiert ist */
  game.applyRetention = function () {
    var s = S(), today = U.today(), yesterday = U.addDays(today, -1);
    var res = { days: 0, factor: 1, lost: {} };
    if (!s.setupDone) return res;
    if (!s.retention.lastDay) { s.retention.lastDay = yesterday; OP.store.save('retention'); return res; }
    if (s.retention.lastDay >= yesterday) return res;
    var d = U.addDays(s.retention.lastDay, 1), n = 0, guard = 0;
    while (d <= yesterday && guard++ < 5000) {
      if (!dayTrained(s.days[d])) n++;
      d = U.addDays(d, 1);
    }
    s.retention.lastDay = yesterday;
    if (n > 0) {
      var f = Math.pow(1 - D.RETENTION_PER_DAY, n);
      D.MUSCLE_IDS.forEach(function (id) {
        var m = s.muscles[id], before = m.xp;
        m.xp = Math.round(m.xp * f * 100) / 100;
        res.lost[id] = before - m.xp;
      });
      s.retention.lostDays = (s.retention.lostDays || 0) + n;
      res.days = n; res.factor = f;
      logEntry('retention', { days: n, factor: f });
    }
    OP.store.save('retention');
    return res;
  };

  /* ================= Achievements ================= */

  /** Prueft alle Achievements. Neue werden gespeichert, per 'achievement'-Event gemeldet und zurueckgegeben. */
  game.checkAchievements = function (noSave, silent) {
    var s = S(), list = D.ACHIEVEMENTS || [], fresh = [];
    for (var i = 0; i < list.length; i++) {
      var a = list[i];
      if (s.achievements[a.id]) continue;
      var ok = false;
      try { ok = !!a.check(s, game); } catch (e) { ok = false; }
      if (ok) { s.achievements[a.id] = Date.now(); fresh.push(a); }
    }
    if (fresh.length) {
      fresh.forEach(function (a) { logEntry('achievement', { id: a.id }); });
      if (!noSave) OP.store.save('achievement');
      if (!silent) setTimeout(function () { fresh.forEach(function (a) { OP.bus.emit('achievement', a); }); }, 0);
    }
    return fresh;
  };

  game.achievementProgress = function () {
    var list = D.ACHIEVEMENTS || [], got = 0;
    list.forEach(function (a) { if (S().achievements[a.id]) got++; });
    return { got: got, total: list.length };
  };

  /* ================= Einrichtung & Zauberbude ================= */

  /** Ersteinrichtung. data: {name, bodyweight, muscles:{id:xp}, abs:{id:target}, goalKg, quests:[{title,cat}]} */
  game.completeSetup = function (data) {
    var s = S();
    if (data.name) s.player.name = String(data.name).trim().slice(0, 24) || 'Runner';
    var bw = U.parseNum(data.bodyweight);
    if (isFinite(bw) && bw >= 30 && bw <= 300) s.player.bodyweight = Math.round(bw * 10) / 10;
    D.MUSCLE_IDS.forEach(function (id) {
      var v = U.parseNum(data.muscles && data.muscles[id]);
      if (isFinite(v) && v >= 0) { s.muscles[id].xp = Math.round(v); s.muscles[id].start = Math.round(v); s.muscles[id].peak = Math.round(v); }
    });
    D.ABS_EXERCISES.forEach(function (ex) {
      var v = U.parseNum(data.abs && data.abs[ex.id]);
      if (isFinite(v) && v > 0) s.abs[ex.id].target = Math.round(v);
    });
    var kg = U.parseNum(data.goalKg);
    if (isFinite(kg) && kg >= 0 && kg <= 300) s.kcal.goalKg = Math.round(kg * 10) / 10;
    (data.quests || []).forEach(function (q) { if (q && q.title) game.questAdd(q.title, q.cat); });
    s.setupDone = true;
    s.retention.lastDay = U.addDays(U.today(), -1);
    game.ensureOffers();
    // Achievements, die schon durch die geschaetzten Startwerte gelten, still freischalten (keine Pop-up-Flut)
    var unlocked = commit('setup', true);
    return { ok: true, achievements: unlocked };
  };

  /** XP-Wert korrigieren (Zauberbude) */
  game.setMuscleXp = function (id, xp) {
    var v = U.parseNum(xp), m = S().muscles[id];
    if (!m || !isFinite(v) || v < 0 || v > 1000000) return { ok: false, error: 'Bitte eine Zahl ab 0 eingeben.' };
    var old = m.xp;
    m.xp = Math.round(v * 100) / 100;
    m.peak = Math.max(m.peak || 0, m.xp);
    logEntry('edit', { muscle: id, oldXp: old, newXp: m.xp });
    commit('edit-xp');
    return { ok: true };
  };

  /** Bauch-Ziel oder Bestzeit korrigieren. field: 'target' | 'best' */
  game.setAbs = function (exId, field, value) {
    var a = S().abs[exId], v = U.parseNum(value);
    if (!a || (field !== 'target' && field !== 'best') || !isFinite(v) || v < 0 || v > 36000) return { ok: false, error: 'Ungültiger Wert.' };
    if (field === 'target' && v < 1) return { ok: false, error: 'Ziel muss mindestens 1 sein.' };
    a[field] = Math.round(v);
    if (field === 'target') a.progress = Math.min(a.progress || 0, a.target - 1 < 0 ? 0 : a.target - 1);
    commit('edit-abs');
    return { ok: true };
  };

  game.setPlayer = function (data) {
    var p = S().player, bw = null;
    if (data.bodyweight != null) {   // erst pruefen, dann speichern
      bw = U.parseNum(data.bodyweight);
      if (!isFinite(bw) || bw < 30 || bw > 300) return { ok: false, error: 'Körpergewicht zwischen 30 und 300 kg.' };
    }
    if (data.name != null) p.name = String(data.name).trim().slice(0, 24) || 'Runner';
    if (bw != null) p.bodyweight = Math.round(bw * 10) / 10;
    OP.store.save('player');
    return { ok: true };
  };

  /** Rang-Schwellen einer Muskelgruppe setzen (8 aufsteigende Zahlen, erste = 0) oder null = Standard */
  game.setThresholds = function (muscleId, arr) {
    var o = S().settings.rankOverrides || (S().settings.rankOverrides = {});
    if (arr == null) { delete o[muscleId]; OP.store.save('thresholds'); return { ok: true }; }
    if (!Array.isArray(arr) || arr.length !== D.RANKS.length) return { ok: false, error: 'Es braucht 8 Werte.' };
    var nums = arr.map(function (x) { return Math.round(U.parseNum(x)); });
    for (var i = 0; i < nums.length; i++) {
      if (!isFinite(nums[i]) || nums[i] < 0) return { ok: false, error: 'Nur Zahlen ab 0.' };
      if (i > 0 && nums[i] <= nums[i - 1]) return { ok: false, error: 'Jeder Rang muss höher sein als der davor.' };
    }
    nums[0] = 0;
    o[muscleId] = nums;
    OP.store.save('thresholds');
    return { ok: true };
  };

  game.setSetting = function (key, value) {
    S().settings[key] = value;
    OP.store.save('settings');
  };

  /** Beim Start und bei Tageswechsel aufrufen */
  game.onNewDayCheck = function () {
    var r = game.applyRetention();
    game.ensureOffers();
    updateLongestStreak();
    return r;
  };

  OP.game = game;
})();
