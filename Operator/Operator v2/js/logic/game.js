/* Operator – Spielregeln (global: OP.game)
   Alle Funktionen, die etwas veraendern, speichern selbst (OP.store.save) und
   pruefen danach die Achievements. Rueckgabewerte sind einfache Objekte fuer die UI.

   Version 2: Training nach Push / Pull / Beine (6 Muskeln), Kampf mit Spieler-HP und
   verstecktem Satz-Limit, Zirkus-Tanz mit Sperre, Lauf-Timer im Gym, simuliertes Gewicht. */
(function () {
  'use strict';
  var OP = (window.OP = window.OP || {});
  var D = OP.data, U = OP.util;

  function S() { return OP.state; }
  function enemies() { return (D.ENEMIES || []); }
  function cardioDefs() { return (D.CARDIO || []); }
  function round2(v) { return Math.round(v * 100) / 100; }
  function floor2(v) { return Math.floor(v * 100 + 1e-7) / 100; }
  /** intern genau rechnen (Retention/Prozente), nur fuer die Anzeige auf 2 Stellen kuerzen */
  function round6(v) { return Math.round(v * 1e6) / 1e6; }

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

  function validSet(weight, reps) {
    var w = U.parseNum(weight), r = U.parseNum(reps);
    if (!isFinite(w) || !isFinite(r)) return { ok: false, error: 'Bitte Gewicht und Wiederholungen eingeben.' };
    if (w <= 0 || w > 1000) return { ok: false, error: 'Gewicht muss zwischen 0 und 1000 kg liegen.' };
    if (r <= 0 || r > 1000 || Math.floor(r) !== r) return { ok: false, error: 'Wiederholungen: ganze Zahl zwischen 1 und 1000.' };
    w = Math.round(w * 100) / 100;
    // Schaden/XP pro Satz als ganze Zahl (22,5 kg × 3 = 67,5 -> 68), damit Anzeige und Regel immer uebereinstimmen
    return { ok: true, w: w, r: r, dmg: Math.round(w * r) };
  }

  /** Standard-Normalverteilung (fuer die zufaelligen Schadens-Pools) */
  function normal() {
    var u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  var game = {};

  /* ================= Raenge & Staerke ================= */

  /** 8 Schwellen fuer einen Muskel (eigene aus der Zauberbude oder Standard je Muskel) */
  game.thresholds = function (muscleId) {
    var o = S().settings.rankOverrides && S().settings.rankOverrides[muscleId];
    if (Array.isArray(o) && o.length === D.RANKS.length) return o.slice();
    return (D.RANK_DEFAULTS[muscleId] || D.RANK_THRESHOLDS).slice();
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

  /** Rang eines Muskels nach aktuellem XP (oder uebergebenem Wert) */
  game.rankFor = function (muscleId, xp) {
    if (xp == null) xp = S().muscles[muscleId] ? S().muscles[muscleId].xp : 0;
    return rankFromThresholds(xp, game.thresholds(muscleId));
  };

  /** Bauch-Rang nach bester Plank-Zeit (Sekunden) */
  game.absRank = function (seconds) {
    if (seconds == null) seconds = S().abs.plank.best || 0;
    return rankFromThresholds(seconds, D.ABS_RANK_SECONDS);
  };

  /** Gesamtstaerke = Summe aller 6 XP-Werte (gerundet) */
  game.totalStrength = function () {
    var t = 0;
    D.MUSCLE_IDS.forEach(function (id) { t += S().muscles[id].xp; });
    return Math.round(t);
  };

  /** Schwellen des Runner-Rangs in Gesamtstaerke = Summe der Muskel-Schwellen je Rang */
  game.runnerThresholds = function () {
    var th = D.RANKS.map(function () { return 0; });
    D.MUSCLE_IDS.forEach(function (id) {
      game.thresholds(id).forEach(function (v, i) { th[i] += v; });
    });
    return th;
  };

  /** Runner-Rang nach Gesamtstaerke. toNext/nextMin sind in Gesamtstaerke ("noch 3.600 Gesamtstärke bis Gold"). */
  game.runnerRank = function () {
    var th = game.runnerThresholds();
    var r = rankFromThresholds(game.totalStrength(), th);
    r.thresholds = th;
    return r;
  };

  /** Profil-Zeilen in Anzeige-Reihenfolge (Push, Pull, Bauch, Beine) */
  game.profileRows = function () {
    return D.PROFILE_ORDER.map(function (id) {
      if (id === 'bauch') {
        var best = S().abs.plank.best || 0;
        return { id: 'bauch', name: 'Bauch', group: null, value: best, unit: 's', rank: game.absRank(best) };
      }
      var xp = S().muscles[id].xp;
      return { id: id, name: D.muscle(id).name, group: D.groupOf(id), value: xp, unit: 'xp', rank: game.rankFor(id, xp) };
    });
  };

  /** Summe der XP einer Gruppe */
  game.groupXp = function (groupId) {
    var g = D.group(groupId), t = 0;
    if (!g) return 0;
    g.muscles.forEach(function (id) { t += S().muscles[id].xp; });
    return Math.round(t);
  };

  /* ================= Gruppen-Chancen (Push / Pull / Beine) ================= */

  /** Gruppen eines Log-Eintrags (neue Eintraege haben group, alte muscle; alte 'arme' = Push und Pull) */
  function groupsOfLog(e) {
    if (e.group) return [e.group];
    if (e.muscle === 'arme') return ['push', 'pull'];
    var g = e.muscle ? D.groupOf(e.muscle) : null;
    return g ? [g] : [];
  }

  /** Wie oft wurde jede Gruppe in den letzten 14 Tagen trainiert (beendete Gym-Einheiten und Kaempfe mit Saetzen) */
  game.recentCounts = function () {
    var c = {}, from = U.addDays(U.today(), -(D.MUSCLE_CHANCE_DAYS - 1));
    D.GROUP_IDS.forEach(function (id) { c[id] = 0; });
    var log = S().log;
    for (var i = log.length - 1; i >= 0; i--) {
      var e = log[i];
      if (!e || typeof e !== 'object') continue;
      if (e.day < from) break;
      if ((e.type === 'gym' || e.type === 'fight') && e.sets > 0) {
        groupsOfLog(e).forEach(function (g) { if (c[g] != null) c[g]++; });
      }
    }
    return c;
  };

  /** Wahrscheinlichkeiten (Summe 1). Formel: Gewicht = 1 / (1 + Trainings der letzten 14 Tage) */
  game.groupChances = function () {
    var c = game.recentCounts(), w = {}, sum = 0;
    D.GROUP_IDS.forEach(function (id) { w[id] = 1 / (1 + c[id]); sum += w[id]; });
    D.GROUP_IDS.forEach(function (id) { w[id] = w[id] / sum; });
    return w;
  };
  game.muscleChances = game.groupChances;   // alter Name

  game.pickGroup = function () { return U.weightedPick(game.groupChances()); };

  /* ================= Zirkus-Sperre ================= */

  /** {locked, days (seit letztem Zirkus-Eintrag bzw. Schonfrist-Start), lastDay, lastEntryDay (letzter ECHTER Eintrag),
      enteredToday, warn (morgen gesperrt), text} */
  game.lockInfo = function () {
    var s = S(), c = s.circus || {};
    var entryDay = c.lastEntryDay || null, today = U.today();
    if (!s.setupDone || !c.lastDay) return { locked: false, days: 0, lastDay: null, lastEntryDay: entryDay, enteredToday: entryDay === today, warn: false, text: D.LOCK_TEXT };
    var days = Math.max(0, U.diffDays(c.lastDay, today));
    return {
      locked: days >= D.CIRCUS_LOCK_DAYS,
      days: days,
      lastDay: c.lastDay,
      lastEntryDay: entryDay,
      enteredToday: entryDay === today,
      warn: days === D.CIRCUS_LOCK_DAYS - 1,
      text: D.LOCK_TEXT
    };
  };

  /** Ist dieser Bereich gerade gesperrt? area: 'arena' | 'gym' | 'abenteuer' | 'schmuggler' */
  game.isLocked = function (area) {
    return D.LOCKED_AREAS.indexOf(area) >= 0 && game.lockInfo().locked;
  };

  function lockError() { return { ok: false, locked: true, error: D.LOCK_TEXT }; }

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

  /** Zufaelliger Prozent-Aufschlag mit zwei Nachkommastellen innerhalb der Stufe (z. B. 2,37) */
  game.rollPct = function (diffId) {
    var d = D.difficulty(diffId);
    return U.randInt(Math.round(d.min * 100), Math.round(d.max * 100)) / 100;
  };

  function makeOffer(pool, diffId, excludeIds) {
    var enemy = pickEnemy(pool, diffId, excludeIds || []);
    return {
      id: U.uid('o'),
      pool: pool,
      enemyId: enemy ? enemy.id : null,
      group: game.pickGroup(),
      diff: diffId,
      pct: game.rollPct(diffId),
      created: Date.now()
    };
  }

  /** Fuellt die Bretter auf (Taverne 4, Arena 3). Speichert nur, wenn etwas neu ist. */
  game.ensureOffers = function () {
    var s = S(), changed = false;
    var fightOffer = s.fight ? s.fight.offerId : null;
    ['abenteuer', 'arena'].forEach(function (pool) {
      var slots = D.OFFER_SLOTS[pool], list = s.offers[pool], i;
      // kaputte oder alte Angebote entfernen (z. B. Gegner-Liste geaendert, noch ohne Gruppe)
      for (i = list.length - 1; i >= 0; i--) {
        var bad = !list[i] || typeof list[i] !== 'object' || !D.difficulty(list[i].diff) || !D.group(list[i].group) ||
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

  /** Angebot + Gegner + Anzeige-Titel, z. B. "Reise ins Skelettland – Push – Medium" (ohne Prozent!) */
  game.describeOffer = function (offer) {
    var e = game.enemy(offer.enemyId) || { name: 'Unbekannt', adventure: 'Unbekannte Mission' };
    var g = D.group(offer.group) || D.GROUPS[0], d = D.difficulty(offer.diff);
    return {
      offer: offer, enemy: e, group: g, diff: d,
      muscles: g.muscles.map(function (id) { return D.muscle(id); }),
      title: e.adventure + ' – ' + g.name + ' – ' + d.name
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

  /** Skip-Regel: FREE_SKIPS_PER_DAY Ablehnungen pro Tag gratis (spaeter: weitere gegen Gold). -> {free, used, left} */
  game.skipInfo = function () {
    var st = S().stats, free = D.FREE_SKIPS_PER_DAY;
    var used = st.skipDay === U.today() ? (st.skipsToday || 0) : 0;
    return { free: free, used: used, left: Math.max(0, free - used) };
  };

  /** Angebot ablehnen / neu wuerfeln. -> neues Angebot oder null (z. B. heute keine Ablehnung mehr frei) */
  game.rerollOffer = function (pool, offerId) {
    var st = S().stats;
    if (S().fight && S().fight.offerId === offerId) return null;
    if (game.isLocked(pool === 'arena' ? 'arena' : 'abenteuer')) return null;
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

  /** HP eines Muskel-Teils = aktueller XP-Wert * (1 + Prozent/100), aufgerundet, mindestens 1 */
  game.enemyHp = function (xp, pct) { return Math.max(1, Math.ceil(xp * (1 + pct / 100) - 1e-9)); };

  /** Ist ein Treffer kritisch? (mehr als 10 % der Max-HP der getroffenen Seite) */
  game.isCrit = function (dmg, maxHp) { return maxHp > 0 && dmg > D.CRIT_SHARE * maxHp; };

  /** Teilt total in n zufaellige, ungleiche Pools (jeder mindestens 1, Summe exakt total) */
  game.splitPools = function (total, n) {
    total = Math.max(n, Math.round(total));
    var w = [], sum = 0, i;
    for (i = 0; i < n; i++) { var z = normal(); var x = z * z + 0.02; w.push(x); sum += x; }
    var rest = total - n, pools = [], acc = 0, rema = [];
    for (i = 0; i < n; i++) {
      var exact = rest * w[i] / sum, fl = Math.floor(exact);
      pools.push(1 + fl); acc += fl; rema.push({ i: i, r: exact - fl });
    }
    rema.sort(function (a, b) { return b.r - a.r; });
    for (i = 0; i < rest - acc; i++) pools[rema[i % n].i]++;
    return pools;
  };

  /** Startet einen Kampf aus einem Angebot. -> {ok, fight} oder {ok:false, error} */
  game.startFight = function (pool, offerId) {
    var s = S();
    if (s.fight) {
      if (s.fight.offerId === offerId) return { ok: true, fight: s.fight };
      return { ok: false, error: 'Es läuft schon ein Kampf. Beende ihn zuerst.' };
    }
    if (game.isLocked(pool === 'arena' ? 'arena' : 'abenteuer')) return lockError();
    var offer = null;
    s.offers[pool].forEach(function (o) { if (o.id === offerId) offer = o; });
    if (!offer) return { ok: false, error: 'Angebot nicht gefunden.' };
    var g = D.group(offer.group);
    if (!g) return { ok: false, error: 'Angebot ohne Gruppe.' };
    var parts = {}, xpSum = 0;
    g.muscles.forEach(function (id) {
      var xp = s.muscles[id].xp;
      xpSum += xp;
      parts[id] = { startXp: xp, hp: game.enemyHp(xp, offer.pct) };
    });
    var limit = U.randInt(D.FIGHT_SET_LIMIT.min, D.FIGHT_SET_LIMIT.max);
    // Mindest-HP unabhaengig vom Limit, damit das versteckte Limit nie als HP-Zahl sichtbar wird
    var playerHp = Math.max(Math.round(xpSum), D.PLAYER_MIN_HP || 300, limit);
    s.fight = {
      offerId: offer.id, pool: pool, enemyId: offer.enemyId, group: g.id,
      diff: offer.diff, pct: offer.pct, parts: parts,
      playerHp: playerHp, limit: limit, pools: game.splitPools(playerHp, limit),
      sets: [], started: Date.now()
    };
    OP.store.save('fight-start');
    return { ok: true, fight: s.fight };
  };

  /** Laufender Kampf mit berechneten Werten (oder null).
      Ablauf je Satz: Spieler trifft zuerst. Lebt das Monster danach noch, trifft es den Spieler mit dem naechsten Pool. */
  game.fightStatus = function () {
    var f = S().fight;
    if (!f) return null;
    var g = D.group(f.group);
    var parts = g.muscles.map(function (id) {
      var p = f.parts[id] || { startXp: 0, hp: 1 };
      var cur = S().muscles[id] ? S().muscles[id].xp : 0;
      // Steigt ein XP-Wert waehrend des Kampfes (z. B. Gym), steigen die HP mit
      return { id: id, muscle: D.muscle(id), startXp: p.startXp, hp: Math.max(p.hp, game.enemyHp(cur, f.pct)), dmg: 0, sets: 0 };
    });
    var byId = {};
    parts.forEach(function (p) { byId[p.id] = p; });
    var hpMax = 0;
    parts.forEach(function (p) { hpMax += p.hp; });
    function allDone() { for (var i = 0; i < parts.length; i++) if (parts[i].dmg < parts[i].hp) return false; return true; }

    var events = [], taken = 0, total = 0, critsDealt = 0, critsTaken = 0;
    f.sets.forEach(function (st, k) {
      var part = byId[st.m];
      var aliveBefore = !allDone();
      if (part) { part.dmg += st.dmg; part.sets++; }
      total += st.dmg;
      var crit = game.isCrit(st.dmg, hpMax);
      var aliveAfter = !allDone();
      var enemyDmg = 0, enemyCrit = false;
      if (aliveBefore && aliveAfter) {
        enemyDmg = f.pools[k] || 0;
        taken += enemyDmg;
        enemyCrit = game.isCrit(enemyDmg, f.playerHp);
      }
      if (crit) critsDealt++;
      if (enemyCrit) critsTaken++;
      events.push({ index: k, m: st.m, w: st.w, r: st.r, dmg: st.dmg, crit: crit, enemyDmg: enemyDmg, enemyCrit: enemyCrit, killing: aliveBefore && !aliveAfter });
    });
    var hpLeft = 0;
    parts.forEach(function (p) {
      p.left = Math.max(0, p.hp - p.dmg);
      p.done = p.dmg >= p.hp;
      p.pct = U.clamp(p.dmg / p.hp, 0, 1);
      hpLeft += p.left;
    });
    var defeated = allDone();
    var limitReached = f.sets.length >= f.limit;
    var playerHpLeft = Math.max(0, f.playerHp - taken);
    return {
      fight: f, enemy: game.enemy(f.enemyId), group: g, diff: D.difficulty(f.diff),
      parts: parts, events: events,
      total: total, hp: hpMax, hpLeft: hpLeft, hpPct: hpMax > 0 ? U.clamp(hpLeft / hpMax, 0, 1) : 0,
      defeated: defeated,
      playerHp: f.playerHp, playerHpLeft: playerHpLeft, playerPct: U.clamp(playerHpLeft / f.playerHp, 0, 1), taken: taken,
      critsDealt: critsDealt, critsTaken: critsTaken,
      setsDone: f.sets.length, limitReached: limitReached,
      dead: !defeated && (limitReached || playerHpLeft <= 0)
    };
  };

  /** Satz eintragen: Schaden = Gewicht * Wiederholungen auf den gewaehlten Muskel.
      -> {ok, dmg, crit, enemyDmg, enemyCrit, partDone, justDefeated, status, finished}
      finished ist gesetzt, wenn der Kampf dadurch automatisch endet (Satz-Limit erreicht / Spieler-HP 0). */
  game.addFightSet = function (muscleId, weight, reps) {
    var f = S().fight;
    if (!f) return { ok: false, error: 'Kein Kampf aktiv.' };
    var g = D.group(f.group);
    if (g.muscles.indexOf(muscleId) < 0) return { ok: false, error: 'Bitte einen Muskel dieser Gruppe wählen.' };
    var v = validSet(weight, reps);
    if (!v.ok) return v;
    var before = game.fightStatus();
    if (before.limitReached || before.dead) return { ok: false, error: 'Der Kampf ist vorbei.' };
    var partBefore = null;
    before.parts.forEach(function (p) { if (p.id === muscleId) partBefore = p; });
    f.sets.push({ m: muscleId, w: v.w, r: v.r, dmg: v.dmg, t: Date.now(), d: U.today() });
    touchDay(U.today(), 1);
    OP.store.save('fight-set');
    var st = game.fightStatus(), ev = st.events[st.events.length - 1], partAfter = null;
    st.parts.forEach(function (p) { if (p.id === muscleId) partAfter = p; });
    var res = {
      ok: true, dmg: v.dmg, muscle: D.muscle(muscleId),
      crit: ev.crit, enemyDmg: ev.enemyDmg, enemyCrit: ev.enemyCrit,
      partDone: !!(partAfter && partAfter.done && partBefore && !partBefore.done),
      justDefeated: !before.defeated && st.defeated,
      status: st, finished: null
    };
    if (st.limitReached || st.dead) res.finished = game.finishFight({ auto: true });
    return res;
  };

  game.removeFightSet = function (index) {
    var f = S().fight;
    if (!f || index < 0 || index >= f.sets.length) return false;
    var removed = f.sets.splice(index, 1)[0];
    touchDay(setDay(removed), -1);
    OP.store.save('fight-set');
    return true;
  };

  /** Kampf beenden. Gewonnen, wenn alle Muskel-Balken voll sind: der ganze Schaden je Muskel wird dessen neuer XP-Wert.
      Verloren (Spieler-HP 0 oder vorher beendet): alles bleibt. opts.auto = vom Satz-Limit beendet. */
  game.finishFight = function (opts) {
    opts = opts || {};
    var s = S(), st = game.fightStatus();
    if (!st) return { ok: false, error: 'Kein Kampf aktiv.' };
    var f = st.fight;
    if (!f.sets.length) {  // ohne Saetze = einfach abbrechen
      s.fight = null;
      OP.store.save('fight-cancel');
      return { ok: true, cancelled: true };
    }
    var won = st.defeated, arena = f.pool === 'arena';
    // zuerst das neue Angebot ziehen: klappt das nicht, darf nichts halb gezaehlt sein
    try { replaceOffer(f.pool, f.offerId); } catch (e) { console.error('[game] neues Angebot', e); }
    var parts = st.parts.map(function (p) {
      var m = s.muscles[p.id], oldXp = m.xp;
      // Sieg: ganzer Schaden wird neuer Wert (Sicherheitsnetz: ein Sieg senkt den Wert nie)
      if (won) { m.xp = Math.max(m.xp, p.dmg); m.peak = Math.max(m.peak || 0, m.xp); }
      return { id: p.id, name: p.muscle.name, hp: p.hp, dmg: p.dmg, done: p.done, oldXp: oldXp, newXp: m.xp };
    });
    var stt = s.stats;
    stt.fightsTotal++;
    if (won) stt.fightsWon++; else stt.fightsLost++;
    if (arena) { stt.arenaFights++; if (won) stt.arenaWins++; }
    if (won && f.diff === 'insane') stt.insaneWins++;
    if (won) {
      stt.enemiesDefeated[f.enemyId] = (stt.enemiesDefeated[f.enemyId] || 0) + 1;
      stt.defeatedTotal++;
      stt.groupWins[f.group] = (stt.groupWins[f.group] || 0) + 1;
      if (st.playerHpLeft <= f.playerHp * 0.1) stt.closeWins++;
      if (st.taken === 0) stt.flawlessWins++;
    }
    stt.critsDealt += st.critsDealt;
    stt.critsTaken += st.critsTaken;
    stt.setsLogged += f.sets.length;
    stt.totalDamage += st.total;
    markTraining(arena ? 'arena' : 'fight', sessionDay(f.sets));
    var logParts = {};
    parts.forEach(function (p) { logParts[p.id] = { hp: p.hp, dmg: p.dmg, oldXp: p.oldXp, newXp: p.newXp }; });
    logEntry('fight', {
      pool: f.pool, enemyId: f.enemyId, group: f.group, diff: f.diff, pct: f.pct,
      hp: st.hp, total: st.total, sets: f.sets.length, won: won, parts: logParts,
      playerHp: f.playerHp, taken: st.taken, crits: st.critsDealt, auto: !!opts.auto
    });
    s.fight = null;
    var unlocked = commit('fight-end');
    return {
      ok: true, won: won,
      reason: won ? 'win' : (st.dead ? 'dead' : 'retreat'),
      auto: !!opts.auto,
      enemy: st.enemy, group: st.group, diff: st.diff, pool: f.pool,
      hp: st.hp, total: st.total, playerHp: f.playerHp, playerHpLeft: st.playerHpLeft,
      critsDealt: st.critsDealt, critsTaken: st.critsTaken,
      parts: parts, achievements: unlocked
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

  /* ================= Gym (Kraft) ================= */

  /** Trainingsziel = aktueller Wert + 1 %, aufgerundet */
  game.gymTarget = function (xp) { return Math.max(1, Math.ceil(xp * (1 + D.GYM_GOAL_PCT / 100) - 1e-9)); };

  /** Gym-Einheit fuer eine Gruppe starten (Push, Pull oder Beine). Jeder Muskel bekommt sein eigenes +1 %-Ziel. */
  game.startGym = function (groupId) {
    var s = S(), g = D.group(groupId);
    if (!g) return { ok: false, error: 'Unbekannte Gruppe.' };
    if (s.gym) {
      if (s.gym.group === groupId) return { ok: true, gym: s.gym };
      return { ok: false, error: 'Es läuft schon ein Training (' + D.group(s.gym.group).name + ').' };
    }
    if (game.isLocked('gym')) return lockError();
    var parts = {};
    g.muscles.forEach(function (id) {
      var xp = s.muscles[id].xp;
      parts[id] = { startXp: xp, target: game.gymTarget(xp) };
    });
    s.gym = { group: groupId, parts: parts, sets: [], started: Date.now() };
    OP.store.save('gym-start');
    return { ok: true, gym: s.gym };
  };

  game.gymStatus = function () {
    var g = S().gym;
    if (!g) return null;
    var grp = D.group(g.group);
    var parts = grp.muscles.map(function (id) {
      var p = g.parts[id] || { startXp: 0, target: 1 };
      var cur = S().muscles[id] ? S().muscles[id].xp : 0;
      // Ziel = immer aktueller Wert + 1 % (falls der Wert waehrenddessen gestiegen ist)
      var target = Math.max(p.target, game.gymTarget(cur));
      var total = 0, n = 0;
      g.sets.forEach(function (st) { if (st.m === id) { total += st.dmg; n++; } });
      return {
        id: id, muscle: D.muscle(id), startXp: p.startXp, target: target, total: total, sets: n,
        left: Math.max(0, target - total), progress: U.clamp(total / target, 0, 1), reached: total >= target
      };
    });
    var total = 0, reachedCount = 0;
    parts.forEach(function (p) { total += p.total; if (p.reached) reachedCount++; });
    return {
      gym: g, group: grp, parts: parts, total: total,
      reached: reachedCount === parts.length, anyReached: reachedCount > 0, reachedCount: reachedCount
    };
  };

  /** Satz fuer einen Muskel der Gruppe. -> {ok, xp, justReached (dieser Muskel), justReachedAll, status} */
  game.addGymSet = function (muscleId, weight, reps) {
    var g = S().gym;
    if (!g) return { ok: false, error: 'Kein Training aktiv.' };
    if (D.group(g.group).muscles.indexOf(muscleId) < 0) return { ok: false, error: 'Bitte einen Muskel dieser Gruppe wählen.' };
    var v = validSet(weight, reps);
    if (!v.ok) return v;
    var before = game.gymStatus(), pb = null;
    before.parts.forEach(function (p) { if (p.id === muscleId) pb = p; });
    g.sets.push({ m: muscleId, w: v.w, r: v.r, dmg: v.dmg, t: Date.now(), d: U.today() });
    touchDay(U.today(), 1);
    OP.store.save('gym-set');
    var st = game.gymStatus(), pa = null;
    st.parts.forEach(function (p) { if (p.id === muscleId) pa = p; });
    return {
      ok: true, xp: v.dmg, muscle: D.muscle(muscleId), status: st,
      justReached: !!(pa && pa.reached && pb && !pb.reached),
      justReachedAll: !before.reached && st.reached
    };
  };

  game.removeGymSet = function (index) {
    var g = S().gym;
    if (!g || index < 0 || index >= g.sets.length) return false;
    var removed = g.sets.splice(index, 1)[0];
    touchDay(setDay(removed), -1);
    OP.store.save('gym-set');
    return true;
  };

  /** Training beenden: Jeder Muskel, der sein Ziel erreicht hat, bekommt seine Summe als neuen XP-Wert.
      Muskeln ohne erreichtes Ziel bleiben gleich. */
  game.finishGym = function () {
    var s = S(), st = game.gymStatus();
    if (!st) return { ok: false, error: 'Kein Training aktiv.' };
    var g = st.gym;
    if (!g.sets.length) { s.gym = null; OP.store.save('gym-cancel'); return { ok: true, cancelled: true }; }
    var parts = st.parts.map(function (p) {
      var m = s.muscles[p.id], oldXp = m.xp;
      if (p.reached) { m.xp = Math.max(m.xp, p.total); m.peak = Math.max(m.peak || 0, m.xp); }
      return { id: p.id, name: p.muscle.name, target: p.target, total: p.total, reached: p.reached, oldXp: oldXp, newXp: m.xp };
    });
    s.stats.gymSessions++;
    if (st.reached) s.stats.gymWins++;
    s.stats.gymPartWins += st.reachedCount;
    s.stats.setsLogged += g.sets.length;
    s.stats.totalDamage += st.total;
    markTraining('gym', sessionDay(g.sets));
    var logParts = {};
    parts.forEach(function (p) { logParts[p.id] = { target: p.target, total: p.total, reached: p.reached, oldXp: p.oldXp, newXp: p.newXp }; });
    logEntry('gym', { group: g.group, parts: logParts, total: st.total, sets: g.sets.length, won: st.reached, anyWon: st.anyReached });
    s.gym = null;
    var unlocked = commit('gym-end');
    return { ok: true, won: st.reached, anyReached: st.anyReached, group: st.group, parts: parts, total: st.total, achievements: unlocked };
  };

  game.cancelGym = function () {
    var g = S().gym;
    if (!g) return true;
    if (g.sets.length) return false;
    S().gym = null;
    OP.store.save('gym-cancel');
    return true;
  };

  /* ================= Gym (Ausdauer): Lauf-Timer ================= */

  /** Aktuelle Timer-Zeit in Millisekunden */
  function runElapsed(a) {
    if (!a) return 0;
    return a.acc + (a.running ? Math.max(0, Date.now() - a.segStart) : 0);
  }

  /** Status beider Timer: {steady, total, active: {kind, running, elapsedMs, minutes, segments} | null}
      steady.target ist auf 2 Stellen abgerundet (so wird es angezeigt und verlangt); intern rechnet der Wert genauer. */
  game.runStatus = function () {
    var r = S().run, a = r.active;
    return {
      steady: {
        target: floor2(r.steady.target), targetExact: r.steady.target, best: r.steady.best, wins: r.steady.wins, fails: r.steady.fails,
        runs: r.steady.runs, lastPct: r.steady.lastPct, first: !(r.steady.target > 0)
      },
      total: {
        record: r.total.record, goal: r.total.goal, wins: r.total.wins, fails: r.total.fails,
        runs: r.total.runs, first: !(r.total.record > 0 || r.total.goal > 0)
      },
      active: a ? {
        kind: a.kind, running: a.running, started: a.started, segments: a.segments,
        elapsedMs: runElapsed(a), minutes: floor2(runElapsed(a) / 60000)
      } : null
    };
  };

  /** Timer starten. kind: 'steady' (am Stueck) | 'total' (Laufzeit gesamt, mit Pausen) */
  game.runStart = function (kind) {
    var s = S();
    if (!D.run(kind)) return { ok: false, error: 'Unbekannter Timer.' };
    if (s.run.active) {
      if (s.run.active.kind === kind) return { ok: true, active: s.run.active };
      return { ok: false, error: 'Es läuft schon ein Timer.' };
    }
    if (game.isLocked('gym')) return lockError();
    var now = Date.now();
    s.run.active = { kind: kind, started: now, running: true, segStart: now, acc: 0, segments: 1 };
    OP.store.save('run-start');
    return { ok: true, active: s.run.active };
  };

  /** Pause (nur Laufzeit gesamt): Gehzeit zaehlt nicht */
  game.runPause = function () {
    var a = S().run.active;
    if (!a || !a.running) return false;
    if (a.kind !== 'total') return false;
    a.acc += Math.max(0, Date.now() - a.segStart);
    a.running = false;
    OP.store.save('run-pause');
    return true;
  };

  /** Weiter nach einer Pause */
  game.runResume = function () {
    var a = S().run.active;
    if (!a || a.running) return false;
    a.running = true;
    a.segStart = Date.now();
    a.segments++;
    OP.store.save('run-resume');
    return true;
  };

  /** Timer stoppen und die gelaufene Zeit eintragen */
  game.runStop = function () {
    var a = S().run.active;
    if (!a) return { ok: false, error: 'Kein Timer aktiv.' };
    var minutes = floor2(runElapsed(a) / 60000);
    var kind = a.kind;
    // Timer vergessen (mehr als 24 Stunden)? Nichts eintragen, Timer bleibt, bis er verworfen wird
    if (minutes > (D.RUN_MAX_MIN || 1440)) return { ok: false, tooLong: true, kind: kind, error: 'Mehr als 24 Stunden – bitte verwerfen und von Hand eintragen.' };
    S().run.active = null;
    if (minutes <= 0) { OP.store.save('run-cancel'); return { ok: true, cancelled: true, kind: kind, segments: a.segments }; }
    return game.runEnter(kind, minutes, { segments: a.segments, fromTimer: true });
  };

  /** Timer verwerfen, ohne Wertung */
  game.runCancel = function () {
    if (!S().run.active) return true;
    S().run.active = null;
    OP.store.save('run-cancel');
    return true;
  };

  /** Lauf eintragen (vom Timer oder von Hand). minutes mit zwei Nachkommastellen.
      Am Stueck: Ziel erreicht -> neuer Wert = max(gelaufen, Ziel + 1..5 %). Erster Lauf = Startwert.
      Gesamt: Rekord = Hoechstwert. Ziel erreicht -> neues Ziel = Rekord + 1 Minute. */
  game.runEnter = function (kind, minutes, extra) {
    var s = S(), r = s.run, v = U.parseNum(minutes);
    if (!D.run(kind)) return { ok: false, error: 'Unbekannter Timer.' };
    if (!isFinite(v) || v <= 0 || v > (D.RUN_MAX_MIN || 1440)) return { ok: false, error: 'Bitte Minuten zwischen 0 und 1.440 eingeben.' };
    if (game.isLocked('gym') && !(extra && extra.fromTimer)) return lockError();
    v = floor2(v);
    var res = { ok: true, kind: kind, value: v, success: false, segments: extra && extra.segments ? extra.segments : 0 };
    if (kind === 'steady') {
      var t = r.steady, oldT = t.target;
      t.runs++;
      s.stats.runsSteady++;
      t.best = Math.max(t.best, v);
      if (!(oldT > 0)) {                       // erster Lauf = Startwert
        t.target = v; res.success = true; res.first = true; res.pct = 0;
      } else if (v >= floor2(oldT)) {          // verlangt wird der angezeigte (abgerundete) Wert
        var pct = U.randInt(D.RUN_STEADY_PCT.min * 100, D.RUN_STEADY_PCT.max * 100) / 100;
        t.target = Math.max(v, round6(oldT * (1 + pct / 100)));
        res.success = true; res.pct = pct; t.lastPct = pct;
      }
      if (res.success) { t.wins++; s.stats.runWins++; } else t.fails++;
      res.oldTarget = floor2(oldT); res.newTarget = floor2(t.target); res.best = t.best;
    } else {
      var o = r.total, oldGoal = o.goal, oldRec = o.record;
      o.runs++;
      s.stats.runsTotal++;
      o.record = Math.max(o.record, v);        // Rekord = Hoechstwert, immer
      if (!(oldRec > 0) && !(oldGoal > 0)) {   // erster Lauf = Startwert
        o.goal = round2(o.record + D.RUN_TOTAL_STEP); res.success = true; res.first = true;
      } else if (v >= floor2(oldGoal)) {
        o.goal = round2(o.record + D.RUN_TOTAL_STEP); res.success = true;
      }
      if (res.success) { o.wins++; s.stats.runWins++; } else o.fails++;
      res.oldGoal = oldGoal; res.newGoal = o.goal; res.oldRecord = oldRec; res.record = o.record;
      res.newRecord = o.record > oldRec;
    }
    markTraining('run');
    logEntry('run', { kind: kind, value: v, won: res.success, pct: res.pct || 0, segments: extra && extra.segments || 0 });
    res.achievements = commit('run-end');
    return res;
  };

  /* ================= Zirkus-Tanz (Bauch) ================= */

  /** Verlangter (angezeigter) Wert: Wiederholungen abgerundet (11,6 -> 11), Sekunden gerundet */
  game.absShown = function (exOrId, target) {
    var ex = typeof exOrId === 'string' ? D.absExercise(exOrId) : exOrId;
    if (!ex) return 0;
    if (target == null) target = S().abs[ex.id].target;
    return ex.unit === 'reps' ? Math.floor(target + 1e-9) : Math.round(target);
  };

  /** Alle Uebungen mit Ziel, Anzeige-Ziel, Bestwert und (falls im laufenden Tanz eingetragen) dem Eintrag */
  game.absStatus = function () {
    var dance = S().dance;
    return D.ABS_EXERCISES.map(function (ex) {
      var a = S().abs[ex.id];
      return {
        ex: ex, target: a.target, shown: game.absShown(ex, a.target), best: a.best, wins: a.wins, fails: a.fails,
        entry: dance && dance.entries[ex.id] ? dance.entries[ex.id] : null
      };
    });
  };

  /** Stand des Tanzes: {active, started, list, next (naechste offene Uebung), doneCount, total, allDone} */
  game.danceStatus = function () {
    var d = S().dance, list = game.absStatus(), next = null, done = 0;
    list.forEach(function (it) { if (it.entry) done++; else if (!next) next = it; });
    return {
      active: !!d, started: d ? d.started : null, list: list, next: d ? next : null,
      doneCount: d ? done : 0, total: list.length, allDone: !!d && done === list.length
    };
  };

  /** Tanz starten (alle Uebungen laufen zusammen) */
  game.danceStart = function () {
    var s = S();
    if (!s.dance) {
      s.dance = { started: Date.now(), day: U.today(), entries: {} };
      OP.store.save('dance-start');
    }
    return game.danceStatus();
  };

  function danceClose(s) {
    var d = s.dance;
    if (!d) return null;
    var list = [], wins = 0, entered = 0;
    D.ABS_EXERCISES.forEach(function (ex) {
      var e = d.entries[ex.id];
      if (!e) return;
      list.push({ ex: ex, entry: e });
      if (!e.skipped) entered++;
      if (e.success) wins++;
    });
    if (entered > 0) s.stats.dances++;
    if (wins === D.ABS_EXERCISES.length) s.stats.perfectDances++;
    logEntry('dance', { entered: entered, wins: wins, day: d.day || U.today() });   // unter dem Tag des Tanzes
    s.dance = null;
    var total = D.ABS_EXERCISES.length;
    return { list: list, entered: entered, wins: wins, skipped: total - entered, total: total };
  }

  /** Wert einer Uebung im Tanz eintragen (Sekunden oder Wiederholungen).
      Geschafft (>= angezeigtes Ziel): neues Ziel = max(geschafft, Ziel + Schritt). Nicht geschafft: Ziel bleibt.
      Jeder Eintrag entsperrt Arena, Gym, Abenteuer und Schmuggler (auch ohne erreichtes Ziel).
      -> {ok, ex, value, success, oldTarget, newTarget, oldShown, newShown, best, unlocked, finished, achievements} */
  game.danceEnter = function (exId, amount) {
    var s = S(), ex = D.absExercise(exId), a = s.abs[exId];
    if (!ex || !a) return { ok: false, error: 'Unbekannte Übung.' };
    var v = U.parseNum(amount);
    if (!isFinite(v) || v <= 0 || v > 36000) return { ok: false, error: 'Bitte eine Zahl größer 0 eingeben.' };
    if (ex.unit === 'reps' && Math.floor(v) !== v) return { ok: false, error: 'Wiederholungen bitte als ganze Zahl.' };
    v = Math.floor(v + 1e-9);                  // Sekunden: angefangene Sekunde zaehlt nicht
    if (v <= 0) return { ok: false, error: 'Bitte mindestens 1 eintragen.' };
    if (!s.dance) game.danceStart();
    if (s.dance.entries[exId]) return { ok: false, error: 'Diese Übung ist in diesem Tanz schon eingetragen.' };
    var wasLocked = game.lockInfo().locked;
    var oldTarget = a.target, oldShown = game.absShown(ex, oldTarget);
    var success = v >= oldShown;
    a.best = Math.max(a.best || 0, v);
    if (success) {
      a.target = round2(Math.max(v, oldTarget + ex.step));
      a.wins++;
      s.stats.absWins++;
    } else {
      a.fails++;
    }
    s.stats.absAttempts++;
    s.dance.entries[exId] = { value: v, success: success, oldTarget: oldTarget, newTarget: a.target, t: Date.now() };
    s.circus.lastDay = U.today();
    s.circus.lastEntryDay = U.today();
    markTraining('abs');
    logEntry('abs', { ex: exId, value: v, target: oldTarget, won: success });
    var res = {
      ok: true, ex: ex, value: v, success: success, oldTarget: oldTarget, newTarget: a.target,
      oldShown: oldShown, newShown: game.absShown(ex, a.target), best: a.best,
      unlocked: wasLocked && !game.lockInfo().locked, finished: null
    };
    if (game.danceStatus().allDone) res.finished = danceClose(s);
    res.achievements = commit('abs');
    return res;
  };
  game.absEnter = game.danceEnter;   // alter Name

  /** Uebung im Tanz auslassen (keine Progression) */
  game.danceSkip = function (exId) {
    var s = S();
    if (!D.absExercise(exId)) return { ok: false, error: 'Unbekannte Übung.' };
    if (!s.dance) game.danceStart();
    if (s.dance.entries[exId]) return { ok: false, error: 'Schon eingetragen.' };
    s.dance.entries[exId] = { skipped: true, success: false, t: Date.now() };
    var res = { ok: true, finished: null };
    if (game.danceStatus().allDone) res.finished = danceClose(s);
    commit('dance-skip');
    return res;
  };

  /** Tanz beenden (offene Uebungen zaehlen als ausgelassen). -> Zusammenfassung oder null */
  game.danceFinish = function () {
    var s = S();
    if (!s.dance) return null;
    var sum = danceClose(s);
    commit('dance-end');
    return sum;
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
    if (game.isLocked('schmuggler')) return lockError();
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

  function bodyweight() { return Number(S().player.bodyweight) || D.DEFAULT_BODYWEIGHT; }

  game.kcalSetGoal = function (kg) {
    var v = U.parseNum(kg);
    if (!isFinite(v) || v < 0 || v > 300) return { ok: false, error: 'Bitte ein Ziel zwischen 0 und 300 kg eingeben.' };
    var k = S().kcal;
    k.goalKg = Math.round(v * 10) / 10;
    if (!(k.startWeight > 0)) k.startWeight = bodyweight();
    var st = game.kcalStatus();
    if (!st.done) k.healthyAt = null;
    else if (!k.healthyAt) k.healthyAt = Date.now();
    var unlocked = commit('kcal-goal');
    return { ok: true, achievements: unlocked };
  };

  /** Startgewicht fuer das simulierte Gewicht aendern (Gewicht beim Start des aktuellen Ziels) */
  game.kcalSetStartWeight = function (kg) {
    var v = U.parseNum(kg);
    if (!isFinite(v) || v < 30 || v > 400) return { ok: false, error: 'Startgewicht zwischen 30 und 400 kg.' };
    S().kcal.startWeight = round2(v);
    OP.store.save('kcal-start');
    return { ok: true };
  };

  /** Schulden-Stand. paid zaehlt nur Eintraege seit dem aktuellen Ziel (base = Summe davor, siehe kcalNewGoal).
      simWeight = Startgewicht - bezahlte kcal / 7.700 (zwei Nachkommastellen). */
  game.kcalStatus = function () {
    var k = S().kcal, total = Math.round((k.goalKg || 0) * D.KCAL_PER_KG), sum = 0;
    k.entries.forEach(function (e) { sum += e.kcal; });
    var paid = sum - (k.base || 0);
    var remaining = Math.max(0, total - paid);
    var startWeight = k.startWeight > 0 ? k.startWeight : bodyweight();
    return {
      goalKg: k.goalKg || 0, total: total, paid: paid, remaining: remaining,
      pctRemaining: total > 0 ? Math.min(100, remaining / total * 100) : 0,
      pctPaid: total > 0 ? U.clamp((1 - remaining / total) * 100, 0, 100) : 0,
      kgRemaining: remaining / D.KCAL_PER_KG,
      kgPaid: paid / D.KCAL_PER_KG,
      startWeight: startWeight,
      simWeight: round2(startWeight - paid / D.KCAL_PER_KG),
      targetWeight: round2(startWeight - (k.goalKg || 0)),
      hasGoal: total > 0, done: total > 0 && remaining <= 0, healthyAt: k.healthyAt,
      baseT: k.baseT || 0
    };
  };

  /** Neues Ziel ab jetzt (z. B. nach "ICH BIN GESUND!"): alte Eintraege zaehlen nicht mehr, neue Schulden = kg × 7.700.
      startWeight optional (Standard: Koerpergewicht aus dem Profil) */
  game.kcalNewGoal = function (kg, startWeight) {
    var v = U.parseNum(kg);
    if (!isFinite(v) || v <= 0 || v > 300) return { ok: false, error: 'Bitte ein Ziel zwischen 0,1 und 300 kg eingeben.' };
    var sw = startWeight == null || startWeight === '' ? bodyweight() : U.parseNum(startWeight);
    if (!isFinite(sw) || sw < 30 || sw > 400) return { ok: false, error: 'Startgewicht zwischen 30 und 400 kg.' };
    var k = S().kcal, sum = 0;
    k.entries.forEach(function (e) { sum += e.kcal; });
    k.base = sum;
    k.baseT = Date.now();
    k.goalKg = Math.round(v * 10) / 10;
    k.startWeight = round2(sw);
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
    if (!(k.startWeight > 0)) k.startWeight = bodyweight();
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

  /** Jeder volle Tag ohne Training (bis gestern) senkt alle 6 XP-Werte um 0,1 %.
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

  /** Retention, die IMMER laeuft (egal ob trainiert): Bauch-Ziele (Planks -1 s alle 14 Tage,
      Crunches/Sit-ups -0,1 pro Tag) und Joggen am Stueck (-0,1 % pro Tag).
      -> {days, abs: {exId: verlust}, steady: verlust} */
  game.applyDailyDecay = function () {
    var s = S(), today = U.today(), res = { days: 0, abs: {}, steady: 0 };
    if (!s.setupDone) return res;
    if (!s.decay.lastDay) { s.decay.lastDay = today; OP.store.save('decay'); return res; }
    var days = U.diffDays(s.decay.lastDay, today);
    if (!isFinite(days)) { s.decay.lastDay = today; OP.store.save('decay'); return res; }   // kaputtes Datum: neu anfangen
    if (days <= 0) return res;
    days = Math.min(days, 3650);
    D.ABS_EXERCISES.forEach(function (ex) {
      var a = s.abs[ex.id], dec = ex.decay;
      if (!a || !dec) return;
      var before = a.target;
      if (dec.everyDays <= 1) {
        a.target = Math.max(D.ABS_MIN_TARGET, round2(a.target - dec.amount * days));
      } else {
        a.decayCarry = (a.decayCarry || 0) + days;
        var steps = Math.floor(a.decayCarry / dec.everyDays);
        if (steps > 0) {
          a.target = Math.max(D.ABS_MIN_TARGET, round2(a.target - steps * dec.amount));
          a.decayCarry -= steps * dec.everyDays;
        }
      }
      if (a.target !== before) res.abs[ex.id] = round2(before - a.target);
    });
    var t = s.run.steady;
    if (t.target > 0) {
      // genau -0,1 % pro Tag (nicht auf 2 Stellen runden, sonst verliert man bei kleinen Werten viel mehr)
      var beforeT = t.target;
      t.target = round6(t.target * Math.pow(1 - D.RUN_STEADY_DECAY, days));
      res.steady = round6(beforeT - t.target);
    }
    s.decay.lastDay = today;
    res.days = days;
    logEntry('decay', { days: days, abs: res.abs, steady: res.steady });
    OP.store.save('decay');
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

  /** Ersteinrichtung. data: {name, bodyweight, muscles:{id:xp} (6), abs:{id:target} (5),
      run:{steady, total} (Minuten, optional), goalKg, quests:[{title,cat}]} */
  game.completeSetup = function (data) {
    var s = S(), today = U.today();
    if (data.name) s.player.name = String(data.name).trim().slice(0, 24) || 'Runner';
    var bw = U.parseNum(data.bodyweight);
    if (isFinite(bw) && bw >= 30 && bw <= 300) s.player.bodyweight = Math.round(bw * 10) / 10;
    D.MUSCLE_IDS.forEach(function (id) {
      var v = U.parseNum(data.muscles && data.muscles[id]);
      if (isFinite(v) && v >= 0) { s.muscles[id].xp = Math.round(v); s.muscles[id].start = Math.round(v); s.muscles[id].peak = Math.round(v); }
    });
    D.ABS_EXERCISES.forEach(function (ex) {
      var v = U.parseNum(data.abs && data.abs[ex.id]);
      if (isFinite(v) && v > 0) s.abs[ex.id].target = round2(v);
    });
    if (data.run) {
      var st = U.parseNum(data.run.steady), tt = U.parseNum(data.run.total);
      if (isFinite(st) && st > 0) s.run.steady.target = floor2(st);
      if (isFinite(tt) && tt > 0) { s.run.total.record = floor2(tt); s.run.total.goal = round2(floor2(tt) + D.RUN_TOTAL_STEP); }
    }
    var kg = U.parseNum(data.goalKg);
    if (isFinite(kg) && kg >= 0 && kg <= 300) s.kcal.goalKg = Math.round(kg * 10) / 10;
    s.kcal.startWeight = s.player.bodyweight;
    (data.quests || []).forEach(function (q) { if (q && q.title) game.questAdd(q.title, q.cat); });
    s.setupDone = true;
    s.retention.lastDay = U.addDays(today, -1);
    s.circus.lastDay = today;
    s.decay.lastDay = today;
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

  /** Bauch-Ziel oder Bestwert korrigieren. field: 'target' | 'best'. Ziele duerfen Nachkommastellen haben. */
  game.setAbs = function (exId, field, value) {
    var a = S().abs[exId], v = U.parseNum(value);
    if (!a || (field !== 'target' && field !== 'best') || !isFinite(v) || v < 0 || v > 36000) return { ok: false, error: 'Ungültiger Wert.' };
    if (field === 'target' && v < D.ABS_MIN_TARGET) return { ok: false, error: 'Ziel muss mindestens ' + D.ABS_MIN_TARGET + ' sein.' };
    a[field] = field === 'target' ? round2(v) : Math.round(v);
    commit('edit-abs');
    return { ok: true };
  };

  /** Lauf-Werte korrigieren. field: 'steady.target' | 'total.record' | 'total.goal' (Minuten, 0 = noch kein Wert) */
  game.setRun = function (field, value) {
    var v = U.parseNum(value), r = S().run;
    if (!isFinite(v) || v < 0 || v > 1440) return { ok: false, error: 'Bitte Minuten zwischen 0 und 1.440 eingeben.' };
    v = floor2(v);
    if (field === 'steady.target') r.steady.target = v;
    else if (field === 'total.record') r.total.record = v;
    else if (field === 'total.goal') r.total.goal = v;
    else return { ok: false, error: 'Unbekanntes Feld.' };
    commit('edit-run');
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

  /** Rang-Schwellen eines Muskels setzen (8 aufsteigende Zahlen, erste = 0) oder null = Standard */
  game.setThresholds = function (muscleId, arr) {
    var o = S().settings.rankOverrides || (S().settings.rankOverrides = {});
    if (!D.muscle(muscleId) || muscleId === 'bauch') return { ok: false, error: 'Unbekannter Muskel.' };
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

  /** Einmalige Nachricht nach einem Update abholen (und loeschen) */
  game.popNotice = function () {
    var n = S().notice;
    if (!n) return null;
    S().notice = null;
    OP.store.save('notice');
    return n;
  };

  /** Beim Start und bei Tageswechsel aufrufen. -> Retention-Ergebnis (+ decay) */
  game.onNewDayCheck = function () {
    var s = S();
    var r = game.applyRetention();
    try { r.decay = game.applyDailyDecay(); } catch (e) { console.error('[game] decay', e); }
    // ein offener Zirkus-Tanz von gestern wird geschlossen (Eintraege bleiben gewertet, Achievements werden geprueft)
    if (s.dance && s.dance.day !== U.today()) { danceClose(s); commit('dance-end'); }
    game.ensureOffers();
    updateLongestStreak();
    return r;
  };

  OP.game = game;
})();
