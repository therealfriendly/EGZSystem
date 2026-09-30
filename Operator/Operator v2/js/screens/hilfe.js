/* Operator – Hilfe (Bildschirm 'hilfe') = das Regelbuch
   Kurze Erklärungen in aufklappbaren Abschnitten, sortiert in Kapitel. Alle Zahlen kommen aus OP.data / OP.game,
   damit die Hilfe stimmt, wenn sich Spielwerte ändern.
   Direkt-Link auf einen Abschnitt: #/hilfe/<id>, z. B. #/hilfe/kaempfe (öffnet und scrollt dorthin).
   IDs: worum, gruppen, xp, besser, gym, ausdauer, kaempfe, schwierigkeit, chancen, arena,
        zirkus, sperre, schmuggler, kalorien, quests, streak, retention, raenge, installieren, sichern
   Wichtig: Das versteckte Satz-Limit im Kampf wird NIE als Zahl genannt. */
(function () {
  'use strict';
  const OP = window.OP;
  if (!OP || !OP.screens || !OP.ui) return;
  const U = OP.util, D = OP.data, h = OP.h;

  const openState = { worum: true };   // welche Abschnitte offen sind (bleibt während der Sitzung)
  let rankPick = 'brust';               // Auswahl in der Rang-Tabelle (bleibt während der Sitzung)

  const CHAPTERS = [
    { id: 'grundlagen', name: 'Grundlagen' },
    { id: 'training', name: 'Training im Haus' },
    { id: 'kampf', name: 'Kämpfe' },
    { id: 'taverne', name: 'Taverne' },
    { id: 'haus', name: 'Haus' },
    { id: 'fortschritt', name: 'Fortschritt' },
    { id: 'app', name: 'App' }
  ];
  const AREA_NAMES = { arena: 'Arena', gym: 'Gym', abenteuer: 'Abenteuer', schmuggler: 'Schmuggler' };
  const WEEKDAYS = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];
  const NUM2 = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 2 });

  function icon(name) { return OP.ui.icon(name); }
  /** 2 -> "2", 2.5 -> "2,5", 0.81 -> "0,81" */
  function n(v) { return NUM2.format(Number(v) || 0); }
  function b(text) { return '<b>' + U.esc(text) + '</b>'; }
  const NB = ' ';   // geschütztes Leerzeichen, damit "0,1 %" nicht umbricht
  function round2(v) { return Math.round(v * 100) / 100; }
  function floor2(v) { return Math.floor(v * 100 + 1e-7) / 100; }
  /** Minuten immer mit zwei Nachkommastellen: "8,59 Min." */
  function minText(v) { return U.fmt2(v) + NB + 'Min.'; }
  /** "a, b und c" */
  function andList(names) { return names.length > 1 ? names.slice(0, -1).join(', ') + ' und ' + names[names.length - 1] : names.join(''); }
  /** Name des ersten Runner-Rangs, ab dem Gegner dieser Stufe (Tier) vorkommen können */
  function rankForTier(tier) {
    const caps = D.MAX_TIER_BY_RUNNER_RANK || [];
    for (let i = 0; i < caps.length; i++) if (caps[i] >= tier && D.RANKS[i]) return D.RANKS[i].name;
    return null;
  }
  /** Rang-Index für einen Wert (wie OP.game.rankFor) */
  function rankIndex(value, th) {
    let idx = 0;
    for (let i = 0; i < th.length; i++) if (value >= th[i]) idx = i;
    return idx;
  }
  /** Prozente so runden, dass sie zusammen genau 100 ergeben (größter Rest bekommt den Punkt) */
  function roundTo100(values) {
    const sum = values.reduce(function (a, v) { return a + v; }, 0) || 1;
    const raw = values.map(function (v) { return v / sum * 100; });
    const out = raw.map(Math.floor);
    let rest = 100 - out.reduce(function (a, v) { return a + v; }, 0);
    raw.map(function (v, i) { return { i: i, r: v - Math.floor(v) }; })
      .sort(function (a, c) { return c.r - a.r; })
      .forEach(function (x) { if (rest > 0) { out[x.i]++; rest--; } });
    return out;
  }
  /** Retention einer Bauch-Übung in Worten: "−1 s alle 14 Tage" / "−0,1 pro Tag" */
  function decayText(ex) {
    const d = ex.decay;
    if (!d) return '–';
    const amount = '−' + n(d.amount) + (ex.unit === 's' ? NB + 's' : '');
    return d.everyDays <= 1 ? amount + ' pro Tag' : amount + ' alle ' + d.everyDays + ' Tage';
  }
  function unitText(ex) { return ex.unit === 's' ? NB + 's' : NB + 'Wdh.'; }

  /* ---------- Bausteine ---------- */

  function para(html) { return h('p', { html: html }); }
  function list(items) { return h('ul', { class: 'hilfe-list' }, items.map(function (i) { return h('li', { html: i }); })); }
  function formula(label, html) {
    return h('div', { class: 'hilfe-formula' },
      label ? h('span', { class: 'hilfe-formula__label', text: label }) : null,
      h('span', { class: 'hilfe-formula__text num', html: html }));
  }
  function example(html, tag) {
    return h('div', { class: 'hilfe-example' }, h('span', { class: 'hilfe-example__tag', text: tag || 'Beispiel' }), h('span', { html: html }));
  }
  function flow(steps, noArrows) {
    const el = h('div', { class: 'hilfe-flow' });
    steps.forEach(function (s, i) {
      if (i && !noArrows) el.appendChild(h('span', { class: 'hilfe-flow__arrow', html: icon(s.arrow || 'next') }));
      el.appendChild(h('span', { class: 'hilfe-flow__step' + (s.tone ? ' tone-' + s.tone : '') },
        h('b', { class: 'num', text: s.value }), h('small', { text: s.label })));
    });
    return el;
  }
  function table(head, rows, cls) {
    return h('div', { class: 'hilfe-table-wrap' },
      h('table', { class: 'hilfe-table' + (cls ? ' ' + cls : '') },
        h('thead', null, h('tr', null, head.map(function (t) { return h('th', { text: t }); }))),
        h('tbody', null, rows.map(function (r) {
          return h('tr', null, r.map(function (c) { return h('td', null, c); }));
        }))));
  }
  function steps(items) {
    return h('ol', { class: 'hilfe-steps' }, items.map(function (i) { return h('li', { html: i }); }));
  }
  function sub(text) { return h('div', { class: 'hilfe-sub', text: text }); }
  function small(text) { return h('p', { class: 'hilfe-small', text: text }); }
  function linkBtn(label, iconName, route) {
    return h('button', { class: 'btn btn--ghost btn--sm hilfe-link', type: 'button', onclick: function () { OP.ui.go(route); } },
      h('span', { html: icon(iconName) }), label);
  }
  function live(iconName, text, tone) {
    return h('div', { class: 'hilfe-live' + (tone ? ' hilfe-live--' + tone : '') },
      h('span', { html: icon(iconName) }), h('span', { text: text }));
  }
  /** kleine Tabelle-Zelle mit Zahl */
  function num(text, cls) { return h('span', { class: 'num' + (cls ? ' ' + cls : ''), text: text }); }

  /* ---------- Live-Bausteine (mit echten Werten; fehlt etwas, einfach weglassen) ---------- */

  /** Die drei Gruppen mit deinen aktuellen XP-Werten */
  function groupCards() {
    const box = h('div', { class: 'hilfe-groups' });
    D.GROUPS.forEach(function (g) {
      const vals = g.muscles.map(function (id) {
        const m = D.muscle(id), xp = OP.state && OP.state.muscles[id] ? OP.state.muscles[id].xp : 0;
        return h('span', { class: 'hilfe-group__m' }, h('span', { text: m.name }), h('b', { class: 'num', text: U.fmt(xp) }));
      });
      box.appendChild(h('div', { class: 'hilfe-group', style: { '--grp': g.color } },
        h('div', { class: 'hilfe-group__head' },
          h('span', { class: 'hilfe-group__ico', html: icon(g.icon) }),
          h('span', { class: 'hilfe-group__titles' }, h('b', { text: g.name }), h('small', { text: g.hint }))),
        h('div', { class: 'hilfe-group__ms' }, vals)));
    });
    return box;
  }

  /** Beispiel-Kampf: Goblin (Push) mit einem Balken je Muskel + deine HP */
  function fightDemo(pct) {
    const g = OP.game, grp = D.group('push') || D.GROUPS[0];
    const xp = { brust: 2000, trizeps: 1000, schultern: 1000 };
    let playerHp = 0;
    grp.muscles.forEach(function (id) { playerHp += xp[id] || 1000; });
    // Stand mitten im Kampf: Brust voll, Trizeps halb, Schultern leer
    const fill = { brust: 1, trizeps: 0.55, schultern: 0 };
    const rows = grp.muscles.map(function (id) {
      const m = D.muscle(id), hp = g.enemyHp(xp[id] || 1000, pct), dmg = Math.round(hp * (fill[id] || 0));
      const done = dmg >= hp;
      return h('div', { class: 'hilfe-fight__row' + (done ? ' is-done' : '') },
        h('span', { class: 'hilfe-fight__name', text: m.name }),
        OP.ui.progress(dmg / hp * 100, { tone: done ? 'ok' : 'hp', thin: true }),
        h('span', { class: 'hilfe-fight__val num', text: U.fmt(dmg) + ' / ' + U.fmt(hp) }));
    });
    const left = Math.round(playerHp * 0.72);
    return h('div', { class: 'hilfe-fight' },
      h('div', { class: 'hilfe-fight__head' },
        h('span', { class: 'hilfe-fight__ico', html: icon('skull') }),
        h('b', { text: 'Goblin' }),
        // gleicher Gruppen-Chip wie in Taverne, Arena und Kampf
        h('span', { class: 'chip chip--group', style: { '--g': grp.color }, html: icon(grp.icon) + '<span>' + U.esc(grp.name) + '</span>' })),
      rows,
      h('div', { class: 'hilfe-fight__me' },
        h('span', { class: 'hilfe-fight__name', text: 'Deine HP' }),
        OP.ui.progress(left / playerHp * 100, { tone: 'ok', thin: true }),
        h('span', { class: 'hilfe-fight__val num', text: U.fmt(left) + ' / ' + U.fmt(playerHp) })),
      h('p', { class: 'hilfe-fight__note', text: 'Brust ist voll – der Goblin lebt aber noch. Erst wenn alle drei Balken voll sind, ist er besiegt.' }));
  }

  /** Gruppen-Chancen gerade (Push / Pull / Beine) */
  function chanceBars() {
    const ch = OP.game.groupChances();
    const shown = roundTo100(D.GROUPS.map(function (g) { return ch[g.id] || 0; }));
    return h('div', { class: 'hilfe-chances' }, D.GROUPS.map(function (g, i) {
      const p = (ch[g.id] || 0) * 100;
      return h('div', { class: 'hilfe-chance', style: { '--grp': g.color } },
        h('span', { class: 'hilfe-chance__name', text: g.name }),
        OP.ui.progress(Math.min(100, p * 2), { thin: true }),
        h('span', { class: 'hilfe-chance__pct num', text: shown[i] + NB + '%' }));
    }));
  }

  /** Rang-Tabelle mit Auswahl: je Muskel (eigene Schwellen), Bauch (Sekunden) oder Runner (Gesamtstärke) */
  function rankBox() {
    const g = OP.game, S = OP.state;
    const picks = D.MUSCLES.map(function (m) { return { id: m.id, name: m.name, icon: m.icon, kind: 'xp' }; })
      .concat([{ id: 'bauch', name: 'Bauch', icon: 'bauch', kind: 's' }, { id: 'runner', name: 'Runner', icon: 'rank', kind: 'total' }]);
    const bar = h('div', { class: 'hilfe-pick', role: 'group', 'aria-label': 'Ränge anzeigen für' });
    const out = h('div', { class: 'hilfe-rankbox__out' });

    function render() {
      const it = picks.filter(function (p) { return p.id === rankPick; })[0] || picks[0];
      bar.querySelectorAll('.hilfe-pick__btn').forEach(function (btn) {
        const on = btn.dataset.id === it.id;
        btn.classList.toggle('is-on', on);
        btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
      let th, value, unit, head, custom = false;
      if (it.kind === 'xp') {
        th = g.thresholds(it.id); value = S.muscles[it.id].xp; unit = 'XP'; head = 'ab XP';
        custom = !!(S.settings.rankOverrides && S.settings.rankOverrides[it.id]);
      } else if (it.kind === 's') {
        th = D.ABS_RANK_SECONDS; value = S.abs.plank.best || 0; unit = 's'; head = 'ab Sekunden (beste Plank)';
      } else {
        th = g.runnerThresholds(); value = g.totalStrength(); unit = 'Gesamtstärke'; head = 'ab Gesamtstärke';
      }
      const idx = rankIndex(value, th);
      const tbody = h('tbody', null, D.RANKS.map(function (r, i) {
        return h('tr', { class: i === idx ? 'is-me' : null },
          h('td', null, h('span', { class: 'hilfe-rankcell' }, OP.ui.rankBadge(r, { small: true }), i === idx ? h('span', { class: 'hilfe-me', text: 'du' }) : null)),
          h('td', null, num(U.fmt(th[i]) + (it.kind === 's' ? NB + 's' : ''))));
      }));
      out.innerHTML = '';
      out.appendChild(h('div', { class: 'hilfe-table-wrap' },
        h('table', { class: 'hilfe-table hilfe-table--ranks' },
          h('thead', null, h('tr', null, h('th', { text: 'Rang' }), h('th', { text: head }))),
          tbody)));
      out.appendChild(small('Du: ' + U.fmt(value) + NB + unit + ' → ' + D.RANKS[idx].name +
        (custom ? ' · eigene Schwellen aus der Zauberbude' : '')));
    }

    picks.forEach(function (p) {
      bar.appendChild(h('button', {
        class: 'hilfe-pick__btn', type: 'button', dataset: { id: p.id }, 'aria-pressed': 'false',
        onclick: function () { rankPick = p.id; render(); },
        html: icon(p.icon) + '<span>' + U.esc(p.name) + '</span>'
      }));
    });
    render();
    return h('div', { class: 'hilfe-rankbox' }, bar, out);
  }

  /* ---------- Inhalte ---------- */

  function sections() {
    const g = OP.game;
    const S = OP.state;
    const groupNames = D.GROUPS.map(function (x) { return x.name; });
    const gymTo = g.gymTarget(2000), gymTo1 = g.gymTarget(1000);
    const medium = D.difficulty('medium') || { min: 2.01, max: 2.9, name: 'Medium' };
    const exPct = Math.round((medium.min + medium.max) * 50) / 100;   // Mitte von Medium, zwei Nachkommastellen
    const exHp = g.enemyHp(2000, exPct);
    const bw = (S && S.player && S.player.bodyweight) || D.DEFAULT_BODYWEIGHT || 80;
    const cardioPct = Math.round((D.CARDIO_STEP - 1) * 1000) / 10;
    const cardioCount = (D.CARDIO && D.CARDIO.length) || 50;
    const cancelMin = D.CARDIO_CANCEL_MIN || 5;   // wie game.cardioCancel
    // Beispiel wie im Spiel: erster Schritte-Auftrag, nach einem Erfolg +5 % (gerundet, mindestens eine Stufe mehr)
    const stepsDef = (D.CARDIO || []).filter(function (c) { return c.unit === 'schritte'; })[0] || { base: 3000, round: 50, limitMin: 60 };
    const stepR = stepsDef.round || 1;
    const stepsNext = Math.max(Math.round(stepsDef.base * D.CARDIO_STEP / stepR) * stepR, Math.round(stepsDef.base / stepR) * stepR + stepR);
    const freeSkips = D.FREE_SKIPS_PER_DAY != null ? D.FREE_SKIPS_PER_DAY : 1;
    const trollRank = rankForTier(4), dragonRank = rankForTier(5);   // wie game.js: Trolle ab Stufe 4, Drachen ab Stufe 5
    const monsterText = 'Trolle und Drachen triffst du erst, wenn du stark genug bist' +
      (trollRank && dragonRank ? ': Trolle ab Runner-Rang ' + trollRank + ', Drachen ab ' + dragonRank + '.' : '.');
    const setW = 22.5, setR = 7;   // Beispiel für das Runden pro Satz
    const kcal20 = 20 * D.KCAL_PER_KG, kcalLeft = kcal20 - 2000;
    const ret = D.RETENTION_PER_DAY;
    const ret4 = (1 - Math.pow(1 - ret, 28)) * 100, ret12 = (1 - Math.pow(1 - ret, 84)) * 100;
    const arenaDiffs = D.DIFFICULTIES.filter(function (d) { return d.pool === 'arena'; });
    const critPct = Math.round(D.CRIT_SHARE * 100);
    const critHp = 1500, critAt = critHp * D.CRIT_SHARE;
    const lockAreas = andList((D.LOCKED_AREAS || []).map(function (a) { return AREA_NAMES[a] || a; }));
    const lockDays = D.CIRCUS_LOCK_DAYS;
    const steadyPct = D.RUN_STEADY_PCT, steadyDecay = U.fmt1(D.RUN_STEADY_DECAY * 100);
    const runStep = D.RUN_TOTAL_STEP;
    const steadyName = (D.run('steady') || {}).name || 'Joggen am Stück';
    const totalName = (D.run('total') || {}).name || 'Laufzeit gesamt';
    // Beispiel Joggen am Stück: Ziel 5,00, gelaufen 5,10, +3 %
    const stEx = { target: 5, run: 5.1, pct: 3 };
    const stNew = Math.max(stEx.run, floor2(stEx.target * (1 + stEx.pct / 100)));
    // Beispiel Zirkus: Crunches 11,6
    const crEx = D.absExercise('crunches') || { step: 0.5, unit: 'reps' };
    const crOld = 11.6, crNew = round2(crOld + crEx.step);
    // Beispiel simuliertes Gewicht (aus der Anfrage des Nutzers): 135 kg, Ziel 35 kg, Defizit 77.000
    const simStart = 135, simGoal = 35, simPaid = 77000;
    const simDebt = simGoal * D.KCAL_PER_KG, simW = round2(simStart - simPaid / D.KCAL_PER_KG);
    // Retention, die immer läuft: Übungen mit gleicher Regel zusammenfassen
    const decayGroups = [];
    D.ABS_EXERCISES.forEach(function (ex) {
      const t = decayText(ex), found = decayGroups.filter(function (x) { return x.text === t; })[0];
      const name = ex.name.replace('Seitlicher Plank', 'Seitplank');
      if (found) found.names.push(name); else decayGroups.push({ text: t, names: [name] });
    });

    function pctText(d) { return '+' + U.fmt2(d.min) + '–' + U.fmt2(d.max) + NB + '%'; }

    const out = [];

    /* ===== Grundlagen ===== */

    out.push({
      id: 'worum', ch: 'grundlagen', icon: 'portal', title: 'Worum geht\'s?', body: [
        para('Du bist ein ' + b('Labs Runner') + '. Dein Ziel: der stärkste Runner werden.'),
        formula('LABS', '<b>L</b>oss <b>A</b>lways <b>B</b>uilds <b>S</b>trength'),
        para('Jede Niederlage macht dich stärker. Und: ' + b('Das echte Leben bewegt das Spiel.') + ' Du trainierst wirklich, trägst es hier ein – und dein Runner wächst mit.'),
        para('Die Karte ist deine Welt. Jedes Gebäude hat eine Aufgabe:'),
        list([
          b('Taverne') + ' – Abenteuer (Kämpfe), Schmuggler (Kardio) und Zirkus-Tänze (Bauch)',
          b('Arena') + ' – die harten Kämpfe',
          b('Haus') + ' – Profil, Gym (Kraft und Ausdauer), Kalorienschulden und Tages-Quests',
          b('Zauberbude') + ' – Einstellungen und Spielstand sichern'
        ])
      ]
    });

    out.push({
      id: 'gruppen', ch: 'grundlagen', icon: 'push', title: 'Push, Pull & Beine', body: [
        para('Du trainierst in ' + b(D.GROUPS.length + ' Gruppen') + ': ' + U.esc(andList(groupNames)) + '. Jeder Muskel darin hat seinen eigenen XP-Wert:'),
        S ? groupCards() : null,
        list([
          'Kämpfe und Gym-Einheiten gelten immer einer ' + b('ganzen Gruppe') + ', z. B. „Goblin (Push)“. So trainierst du viele Muskeln auf einmal.',
          'Am besten trainierst du jede Gruppe 2–3× pro Woche.',
          'Bauch ist keine Gruppe – dafür gibt es den Zirkus-Tanz in der Taverne.'
        ])
      ]
    });

    out.push({
      id: 'xp', ch: 'grundlagen', icon: 'staerke', title: 'XP & Schaden', body: [
        formula('Formel', 'XP = Gewicht × Wiederholungen'),
        para('Jeder Satz wird auf ganze XP gerundet, z. B. ' + U.esc(n(setW)) + ' kg × ' + setR + ' = ' + U.esc(n(setW * setR)) + ' → ' + b(U.fmt(Math.round(setW * setR)) + ' XP') + '.'),
        para('Alle Sätze einer Einheit werden je Muskel zusammengezählt. ' + b('XP und HP sind dasselbe') + ': Im Gym sammelst du XP, im Kampf ist es dein Schaden.'),
        para('Bei jedem Satz wählst du den Muskel, z. B. Bankdrücken → Brust, Dips → Trizeps, Rudern → Rücken. Welche Übung du machst, ist egal – es zählt der Muskel.'),
        para('Bei Übungen ohne Hantel zählt dein ' + b('Körpergewicht') + ' (bei dir gerade ' + U.esc(n(bw)) + ' kg).'),
        example('27 Liegestütze bei 100 kg = <b>2.700 XP</b>'),
        para(b('Gesamtstärke') + ' = alle ' + D.MUSCLES.length + ' XP-Werte zusammen.')
      ]
    });

    out.push({
      id: 'besser', ch: 'grundlagen', icon: 'medal', title: 'Der bessere Wert zählt', body: [
        para('Progression gibt es immer, wenn du dein Ziel ' + b('erreichst oder übertriffst') + '. Dann gilt der bessere (höhere) Wert:'),
        list([
          b('Gym') + ': Ziel ' + U.fmt(gymTo) + ', geschafft 2.100 → neuer Wert ' + b('2.100'),
          b('Kampf') + ': Dein ganzer Schaden je Muskel zählt – auch der Überschuss.',
          b('Zirkus') + ': Ziel 21' + NB + 's, geschafft 27' + NB + 's → neues Ziel ' + b('27' + NB + 's'),
          b(steadyName) + ': Ziel ' + minText(5) + ', gelaufen ' + minText(7) + ' → neues Ziel ' + b(minText(7)),
          b(totalName) + ': Rekord ' + minText(10) + ', neu ' + minText(12) + ' → Rekord ' + b(minText(12)) + ', Ziel ' + b(minText(12 + runStep))
        ]),
        para('Nicht geschafft? Dann bleibt alles, wie es war. Eine Niederlage kostet dich nichts.')
      ]
    });

    /* ===== Training im Haus ===== */

    out.push({
      id: 'gym', ch: 'training', icon: 'gym', title: 'Gym: Kraft', body: [
        para('Im Haus wählst du eine Gruppe: ' + U.esc(andList(groupNames)) + '. ' + b('Jeder Muskel') + ' bekommt sein eigenes Ziel: ' + b('+' + n(D.GYM_GOAL_PCT) + NB + '%') + '.'),
        table(['Push', 'Jetzt', 'Ziel', 'Sätze', 'Neu'], [
          ['Brust', num('2.000'), num(U.fmt(gymTo)), num('2.100'), num('2.100', 'tone-ok')],
          ['Trizeps', num('1.000'), num(U.fmt(gymTo1)), num('800'), num('1.000', 'tone-err')],
          ['Schultern', num('1.000'), num(U.fmt(gymTo1)), num(U.fmt(gymTo1)), num(U.fmt(gymTo1), 'tone-ok')]
        ], 'hilfe-table--compact'),
        list([
          'Trag deine Sätze ein und wähl bei jedem Satz den Muskel. Die Sätze werden je Muskel addiert.',
          'Ziel erreicht: Die Summe wird der neue XP-Wert des Muskels – auch wenn sie höher ist.',
          'Ziel nicht erreicht: Der Muskel bleibt, wie er war.',
          'Jeder Muskel zählt für sich – du musst nicht alle schaffen.'
        ])
      ]
    });

    out.push({
      id: 'ausdauer', ch: 'training', icon: 'run', title: 'Gym: Ausdauer', body: [
        para('Im Gym gibt es zwei Lauf-Timer. Zeiten stehen in Minuten mit zwei Nachkommastellen da: ' + b(minText(8.59)) + ' statt 8,593. Achtung: ' + minText(8.5) + ' sind 8 Minuten 30 Sekunden.'),
        sub(steadyName),
        list([
          'Timer an, laufen ohne Pause, Timer aus.',
          'Dein erster Lauf setzt den Wert.',
          'Ziel erreicht: Das neue Ziel ist ' + b('+' + steadyPct.min + ' bis ' + steadyPct.max + NB + '%') + ' höher (zufällig) – oder deine Zeit, wenn sie besser ist.',
          'Ziel nicht erreicht: Das Ziel bleibt.',
          b('Retention:') + ' Das Ziel sinkt jeden Tag um ' + steadyDecay + NB + '% – auch wenn du trainierst. Bleib dran!'
        ]),
        example('Ziel ' + minText(stEx.target) + ', du läufst ' + minText(stEx.run) + ' → neues Ziel z. B. <b>' + minText(stNew) + '</b> (+' + stEx.pct + NB + '%). Läufst du ' + minText(7) + ', ist <b>' + minText(7) + '</b> dein neues Ziel.'),
        sub(totalName),
        para('Für alle, die noch nicht lange am Stück laufen können: Start, laufen, ' + b('Pause') + ' beim Gehen, weiter … Stopp. Nur die Laufzeit zählt.'),
        flow([
          { value: minText(4), label: 'laufen', tone: 'ok' },
          { value: 'Pause', label: 'Gehen zählt nicht' },
          { value: minText(4), label: 'laufen', tone: 'ok' },
          { value: minText(8), label: 'gesamt', tone: 'cyan' }
        ]),
        list([
          b('Rekord') + ' = dein bester Wert. Bisher ' + minText(8) + ', jetzt ' + minText(10.16) + ' → ' + b(minText(10.16)) + ' ist dein neuer Rekord.',
          b('Ziel') + ' = Rekord + ' + runStep + ' Minute. Geschafft: neues Ziel = neuer Rekord + ' + runStep + '.',
          'Nicht geschafft: Das Ziel bleibt. Dein Rekord kann trotzdem steigen.'
        ]),
        small('Timer vergessen? Nach mehr als 24 Stunden wird nichts gewertet: Verwirf den Timer und trag deine Zeit von Hand ein.')
      ]
    });

    /* ===== Kämpfe ===== */

    out.push({
      id: 'kaempfe', ch: 'kampf', icon: 'swords', title: 'Kämpfe', body: [
        para('In der Taverne nimmst du Aufträge an, z. B. ' + b('„Reise ins Skelettland – Push – Medium“') + '. Gegner, Gruppe und Schwierigkeit werden zufällig gezogen.'),
        fightDemo(exPct),
        list([
          b('Gegner-Balken:') + ' Der Gegner hat einen Balken je Muskel der Gruppe. Seine HP = dein XP-Wert + Aufschlag der Schwierigkeit.',
          'Bei jedem Satz wählst du den Muskel. Schaden = Gewicht × Wiederholungen auf diesen Balken.',
          'Besiegt ist der Gegner erst, wenn ' + b('alle Balken voll') + ' sind.'
        ]),
        sub('Deine HP'),
        list([
          'Du hast auch HP: die Summe deiner XP-Werte der Gruppe (im Beispiel Push: 4.000 HP), mindestens ' + U.fmt(D.PLAYER_MIN_HP || 300) + '.',
          'Nach jedem Satz schlägt der Gegner zurück – mal wenig, mal richtig viel.',
          'Jeder Kampf hat ' + b('begrenzte Sätze') + '. Wie viele, siehst du nicht – nur deine HP. Lebt der Gegner nach deinem letzten erlaubten Satz noch, stehst du bei 0 HP.',
          'Darum: lieber mehr Gewicht als viele leichte Sätze.',
          'Ist der Gegner besiegt, schlägt er nicht mehr zurück. Du kannst noch weitere Sätze machen (mehr XP).'
        ]),
        sub('Kritisch'),
        para('Ein Treffer ist ' + b('kritisch') + ', wenn er mehr als ' + critPct + NB + '% der Max-HP der getroffenen Seite ausmacht. Das gilt für dich und den Gegner.'),
        example('Beide haben ' + U.fmt(critHp) + ' HP: Mehr als <b>' + U.fmt(critAt) + ' Schaden</b> auf einmal = Kritisch.'),
        sub('Ende'),
        list([
          b('Sieg:') + ' Der ganze Schaden je Muskel wird dessen neuer XP-Wert – auch der Überschuss.',
          b('Niederlage:') + ' Alles bleibt, wie es war.',
          'Auftrag passt nicht? ' + b('Ablehnen') + ' geht ' + freeSkips + '× pro Tag gratis (Taverne und Arena zusammen). Später kannst du mehr Ablehnungen mit Gold kaufen.',
          U.esc(monsterText)
        ])
      ]
    });

    out.push({
      id: 'schwierigkeit', ch: 'kampf', icon: 'target', title: 'Schwierigkeiten', body: [
        para('In Taverne und Arena siehst du nur den ' + b('Namen') + ' der Schwierigkeit. Dahinter steckt ein zufälliger Aufschlag auf deine XP-Werte, immer mit zwei Nachkommastellen:'),
        table(['Schwierigkeit', 'Aufschlag', 'Wo?'], D.DIFFICULTIES.map(function (d) {
          return [OP.ui.diffChip(d), num(pctText(d)), d.pool === 'arena' ? 'Arena' : 'Taverne'];
        }), 'hilfe-table--compact'),
        example('Brust 2.000 XP, ' + U.esc(medium.name) + ' mit z. B. +' + U.fmt2(exPct) + NB + '% → Gegner-Balken <b>' + U.fmt(exHp) + ' HP</b>'),
        para('Den genauen Wert siehst du im Spiel nicht – so wirken die Balken zufälliger.')
      ]
    });

    let chances = null;
    try { chances = chanceBars(); } catch (e) { /* ohne Spielstand einfach weglassen */ }
    out.push({
      id: 'chancen', ch: 'kampf', icon: 'dice', title: 'Gruppen-Chancen', body: [
        para('Welche Gruppe ein Auftrag braucht, wird ausgelost. Am Anfang hat jede Gruppe ' + b(n(Math.round(1000 / D.GROUPS.length) / 10) + NB + '%') + '.'),
        para('Was du in den letzten ' + D.MUSCLE_CHANCE_DAYS + ' Tagen oft trainiert hast, kommt seltener dran. So trainierst du automatisch alles.'),
        chances ? sub('Deine Chancen gerade') : null,
        chances,
        small('Rechnung: Gewicht = 1 ÷ (1 + Trainings der Gruppe in ' + D.MUSCLE_CHANCE_DAYS + ' Tagen).')
      ]
    });

    out.push({
      id: 'arena', ch: 'kampf', icon: 'arena', title: 'Arena', body: [
        para('Hier gibt es nur ' + andList(arenaDiffs.map(function (d) { return b(d.name); })) + '.'),
        para('Meist kämpfst du gegen Menschen, manchmal gegen starke Fabelwesen.'),
        para('Die Arena ist für Tage, an denen du dich richtig stark fühlst.'),
        para(U.esc(monsterText))
      ]
    });

    /* ===== Taverne ===== */

    out.push({
      id: 'zirkus', ch: 'taverne', icon: 'zirkus', title: 'Zirkus-Tänze (Bauch)', body: [
        para('Bauch trainierst du im Zirkus (Taverne). Alle ' + D.ABS_EXERCISES.length + ' Übungen laufen zusammen in ' + b('einem Tanz') + ': Du trägst jede einmal ein – oder lässt sie aus.'),
        table(['Übung', 'Dein Ziel', 'Geschafft'], D.ABS_EXERCISES.map(function (ex) {
          const shown = S ? g.absShown(ex) : ex.start;
          return [ex.name, num(shown + unitText(ex)), num('+' + n(ex.step) + unitText(ex), 'tone-ok')];
        })),
        list([
          'Ziel erreicht: Das Ziel steigt. Mehr geschafft? Dann ist dein besserer Wert das neue Ziel.',
          'Ziel nicht erreicht: keine Progression.',
          'Crunches und Sit-ups rechnen intern mit Kommazahlen. Angezeigt und verlangt wird ' + b('abgerundet') + ': 11,6 → 11, 12,1 → 12.',
          'Sekunden zählen nur ganz: 44,7 s → 44 s.',
          b('Retention') + ' – läuft jeden Tag, auch wenn du trainierst: ' +
            decayGroups.map(function (x) { return U.esc(andList(x.names)) + ' ' + b(x.text); }).join(' · ') + '. Nie unter ' + D.ABS_MIN_TARGET + '.',
          'Dein Bauch-Rang kommt von deiner besten Plank-Zeit.'
        ]),
        example('Crunches: Ziel ' + n(crOld) + ' (verlangt ' + Math.floor(crOld) + '). Du schaffst ' + Math.floor(crOld) + ' → neues Ziel ' + n(crNew) + ' (verlangt <b>' + Math.floor(crNew + 1e-9) + '</b>).')
      ]
    });

    let lockLine = null;
    try {
      const li = g.lockInfo();
      lockLine = li.locked
        ? live('lock', 'Gerade: gesperrt. Trag im Zirkus einen Wert ein.', 'err')
        : (li.warn ? live('warning', 'Gerade: frei – aber morgen gesperrt, wenn du heute nichts im Zirkus einträgst.', 'warn')
          : live('unlock', 'Gerade: alles frei.', 'ok'));
    } catch (e) { /* egal */ }
    const lockEx = lockDays >= 1 && lockDays < WEEKDAYS.length
      ? 'Letzter Zirkus-Eintrag am ' + WEEKDAYS[0] + (lockDays > 1 ? ' → am ' + WEEKDAYS[lockDays - 1] + ' ist noch alles frei' : '') +
        ' → ab ' + WEEKDAYS[lockDays] + ' ist gesperrt, bis du wieder etwas einträgst.'
      : null;
    out.push({
      id: 'sperre', ch: 'taverne', icon: 'lock', title: 'Zirkus-Sperre', body: [
        lockLine,
        para('Warst du ' + b(lockDays + ' Tage') + ' nicht im Zirkus, werden gesperrt: ' + b(lockAreas) + '.'),
        list([
          'Nicht gesperrt: die Taverne selbst und die Zirkus-Tänze – sonst kämst du ja nicht mehr in den Zirkus.',
          'Solange gesperrt ist, steht oben ein Hinweis mit dem Grund – auf der Karte und in jedem Bereich. Tippst du auf Arena, Gym, Abenteuer oder Schmuggler, erinnert er dich noch einmal daran.',
          b('Entsperren:') + ' Öffne den Zirkus und trag mindestens einen Wert ein, z. B. 10 Sekunden Plank. Das Ziel musst du dafür nicht schaffen.',
          'Schon gestartete Einheiten (Gym, Lauf-Timer, Schmuggler-Auftrag) kannst du auch gesperrt beenden.'
        ]),
        lockEx ? example(U.esc(lockEx)) : null,
        linkBtn('Zum Zirkus', 'zirkus', 'taverne/zirkus')
      ]
    });

    out.push({
      id: 'schmuggler', ch: 'taverne', icon: 'schmuggler', title: 'Schmuggler (Kardio)', body: [
        para('Such dir einen von ' + cardioCount + ' Aufträgen aus: Schritte, Joggen, Sprints, Marsch und mehr. Es läuft immer nur einer.'),
        list([
          'Jeder Auftrag hat ein ' + b('Zeitlimit') + '. Geschafft? Dann tippst du auf „Geschafft“.',
          'Nicht in der Zeit geschafft = Auftrag verloren.',
          'Jeder Erfolg macht den Auftrag ' + b('+' + n(cardioPct) + NB + '%') + ' schwerer.',
          'Abbrechen ohne Wertung geht nur in den ersten ' + cancelMin + ' Minuten.',
          'Bei der Zirkus-Sperre ist auch der Schmuggler zu.'
        ]),
        example(U.fmt(stepsDef.base) + ' Schritte → nach einem Erfolg <b>' + U.fmt(stepsNext) + ' Schritte</b>')
      ]
    });

    /* ===== Haus ===== */

    out.push({
      id: 'kalorien', ch: 'haus', icon: 'kcal', title: 'Kalorienschulden', body: [
        para('Du legst fest, wie viel Kilo Fett du verlieren willst. Das sind deine Schulden.'),
        formula('Umrechnung', '1 kg Fett ≈ ' + U.fmt(D.KCAL_PER_KG) + ' kcal'),
        example('20 kg = <b>' + U.fmt(kcal20) + ' kcal</b>. Nach 2 Tagen −2.000 kcal: noch ' + U.fmt(kcalLeft) + ' kcal = <b>' + U.pct(kcalLeft / kcal20 * 100) + '</b> übrig'),
        list([
          'Jedes Kaloriendefizit zahlt ab.',
          'Ein Überschuss (mehr gegessen als verbraucht) kommt wieder drauf.',
          'Bei 0 kcal gibt es das Achievement ' + b('„ICH BIN GESUND!“') + '.',
          'Danach kannst du im Haus ein ' + b('neues Ziel') + ' setzen. Es startet frisch – alte Einträge zählen dann nicht mehr.'
        ]),
        sub('Simuliertes Gewicht'),
        formula('Rechnung', 'Startgewicht − Defizit ÷ ' + U.fmt(D.KCAL_PER_KG)),
        example('Profil ' + simStart + ' kg, Ziel ' + simGoal + ' kg = ' + simGoal + ' × ' + U.fmt(D.KCAL_PER_KG) + ' = ' + U.fmt(simDebt) + ' kcal. Nach ' + U.fmt(simPaid) + ' kcal Defizit: ' +
          simStart + ' − ' + U.fmt(simPaid) + ' ÷ ' + U.fmt(D.KCAL_PER_KG) + ' = <b>' + U.fmt2(simW) + ' kg</b>'),
        para(b('Wofür?') + ' Wiegst du dich jeden Tag und bildest den Wochenschnitt, vergleich ihn mit dem simulierten Gewicht: Liegt er nah dran, stimmt dein Defizit. Liegt er deutlich darüber, verrechnest du dich irgendwo.'),
        para(b('Startgewicht') + ' = dein Gewicht, als das Ziel begann. Änderst du später dein Körpergewicht im Profil, bleibt es gleich. Anpassen kannst du es im Haus (Kalorien) oder in der Zauberbude.'),
        linkBtn('Zu den Kalorien', 'kcal', 'haus/kalorien')
      ]
    });

    out.push({
      id: 'quests', ch: 'haus', icon: 'quest', title: 'Tages-Quests', body: [
        para('Deine eigenen Aufgaben für jeden Tag, z. B. Lesen oder Bewerbung schreiben. Jeden Tag geht es von vorne los.'),
        list([
          b('Abhaken') + ' kannst du überall – auch direkt auf der Karte.',
          'Aus Versehen abgehakt? ' + b('Zurücknehmen') + ' geht nur im Haus (Tab „Quests“).',
          'Neue Quests legst du im Haus an.'
        ]),
        sub('Kategorien'),
        h('div', { class: 'hilfe-cats' }, D.QUEST_CATEGORIES.map(function (c) {
          return h('div', { class: 'hilfe-cat', style: { '--cat': c.color } },
            h('span', { class: 'hilfe-cat__ico', html: icon(c.icon) }),
            h('span', { class: 'hilfe-cat__text' }, h('b', { text: c.name }), h('small', { text: c.hint || '' })));
        }))
      ]
    });

    /* ===== Fortschritt ===== */

    let streakLine = null;
    try {
      const si = g.streakInfo();
      streakLine = live('streak', 'Dein Streak: ' + si.current + (si.current === 1 ? ' Tag' : ' Tage') + ' · Rekord: ' + si.longest);
    } catch (e) { /* egal */ }
    out.push({
      id: 'streak', ch: 'fortschritt', icon: 'streak', title: 'Streak', body: [
        para(b('Streak') + ' = Tage in Folge, an denen du mindestens eine Sache gemacht hast:'),
        list(['Gym (Kraft oder Lauf), Kampf oder Arena', 'Zirkus-Tanz oder Schmuggler-Auftrag', 'eine abgehakte Tages-Quest']),
        para('Heute noch nichts gemacht? Dein Streak von gestern hält bis Mitternacht.'),
        streakLine,
        small('Ruhetage (mit Gold kaufen) kommen später.')
      ]
    });

    out.push({
      id: 'retention', ch: 'fortschritt', icon: 'clock', title: 'Retention', body: [
        para('Muskeln bauen ab, wenn du nichts tust: ' + b('Jeder Tag ohne Training') + ' senkt alle ' + D.MUSCLES.length + ' XP-Werte um ' + b(U.fmt1(ret * 100) + NB + '%') + '.'),
        flow([{ value: '≈ −' + Math.round(ret4) + NB + '%', label: 'nach 4 Wochen', tone: 'warn' }, { value: '≈ −' + Math.round(ret12) + NB + '%', label: 'nach 12 Wochen', tone: 'err' }], true),
        example('2.000 XP nach 4 Wochen Pause: ≈ <b>' + U.fmt(2000 * Math.pow(1 - ret, 28)) + ' XP</b>'),
        para('Training heißt: Gym (Kraft oder Lauf), Kampf, Arena, Zirkus-Tanz oder Schmuggler. Schon ein eingetragener Satz zählt. Quests zählen für den Streak, schützen aber nicht vor Retention.'),
        sub('Läuft immer – auch wenn du trainierst'),
        list(decayGroups.map(function (x) { return U.esc(andList(x.names)) + ': ' + b(x.text); })
          .concat([U.esc(steadyName) + ': ' + b('−' + steadyDecay + NB + '% pro Tag'), 'Nie unter ' + D.ABS_MIN_TARGET + '.'])),
        para('Darum: regelmäßig tanzen und laufen.')
      ]
    });

    let ranks = null;
    try { ranks = rankBox(); } catch (e) { console.error('[hilfe] Ränge', e); }
    out.push({
      id: 'raenge', ch: 'fortschritt', icon: 'rank', title: 'Ränge', body: [
        para('Jeder Muskel hat einen Rang, je nach XP-Wert. Die Schwellen sind ' + b('je Muskel verschieden') + ': Bizeps und Trizeps sind kleine Muskeln und brauchen weniger XP. Der Bauch-Rang kommt von deiner besten Plank-Zeit.'),
        ranks,
        para(b('Runner-Rang') + ' = Rang deiner Gesamtstärke. Seine Schwellen sind die Summe der Muskel-Schwellen.'),
        para('Die Schwellen kannst du je Muskel in der Zauberbude anpassen.'),
        linkBtn('Rang-Schwellen ändern', 'zauberbude', 'zauberbude/ranks')
      ]
    });

    /* ===== App ===== */

    out.push({
      id: 'installieren', ch: 'app', icon: 'download', title: 'App installieren', body: [
        para('Als App auf dem Home-Bildschirm startet Operator wie eine echte App – ohne Adressleiste, auch offline.'),
        sub('iPhone (Safari)'),
        steps(['Seite in ' + b('Safari') + ' öffnen', 'Unten auf ' + b('Teilen') + ' tippen (Quadrat mit Pfeil nach oben)', b('„Zum Home-Bildschirm“') + ' wählen', 'Oben rechts auf ' + b('Hinzufügen') + ' tippen']),
        sub('Android (Chrome)'),
        steps(['Seite in ' + b('Chrome') + ' öffnen', 'Oben rechts das ' + b('Menü') + ' (drei Punkte) öffnen', b('„App installieren“') + ' (oder „Zum Startbildschirm hinzufügen“) tippen'])
      ]
    });

    out.push({
      id: 'sichern', ch: 'app', icon: 'export', title: 'Spielstand sichern', body: [
        para('Dein Spielstand liegt ' + b('nur in diesem Browser') + ' auf diesem Gerät. Browser-Daten löschen = Spielstand weg.'),
        list([
          'Sichere regelmäßig in der Zauberbude: ' + b('Kopieren') + ' (z. B. in eine Notiz) oder ' + b('Als Datei speichern') + '.',
          'Neues Handy? Dort bei der Einrichtung „Ich habe schon einen Spielstand“ tippen – oder in der Zauberbude importieren.',
          'Vor jedem Import und Zurücksetzen merkt sich der Browser automatisch den alten Stand – ebenso einmal vor dem Update auf Push/Pull/Beine. Auch ein beschädigter Spielstand wird aufbewahrt. Alles findest du in der Zauberbude unter ' + b('„Notfall-Sicherungen“') + '.'
        ]),
        linkBtn('Spielstand sichern', 'zauberbude', 'zauberbude/save')
      ]
    });

    return out;
  }

  /* ================= Bildschirm ================= */

  function mount(el, params) {
    const bag = OP.ui.cleanup();
    const target = params && params[0] ? String(params[0]) : null;
    if (target) openState[target] = true;

    const root = h('div', { class: 'screen__inner hilfe' });
    root.appendChild(h('div', { class: 'hilfe-intro' },
      h('span', { class: 'hilfe-intro__ico', html: icon('hilfe') }),
      h('p', { text: 'Das Regelbuch – kurz erklärt. Tipp auf ein Thema. Alle Zahlen hier sind die echten Spielwerte.' })));

    const listEl = h('div', { class: 'hilfe-secs' });
    const dets = [];
    let data = [];
    try { data = sections(); } catch (e) { console.error('[hilfe]', e); }
    let lastCh = null;
    data.forEach(function (s) {
      if (s.ch !== lastCh) {
        lastCh = s.ch;
        const chap = CHAPTERS.filter(function (c) { return c.id === s.ch; })[0];
        if (chap) listEl.appendChild(h('h2', { class: 'hilfe-chapter', text: chap.name }));
      }
      const det = h('details', { class: 'hilfe-sec card card--plain', id: 'hilfe-' + s.id, open: !!openState[s.id], dataset: { sec: s.id } },
        h('summary', { class: 'hilfe-sec__head' },
          h('span', { class: 'hilfe-sec__ico', html: icon(s.icon) }),
          h('span', { class: 'hilfe-sec__title', text: s.title }),
          h('span', { class: 'hilfe-sec__chev', html: icon('down') })),
        h('div', { class: 'hilfe-sec__body' }, s.body));
      det.addEventListener('toggle', function () { openState[s.id] = det.open; syncToggle(); });
      dets.push(det);
      listEl.appendChild(det);
    });
    root.appendChild(listEl);
    root.appendChild(h('p', { class: 'hilfe-foot', text: 'Operator ' + (D.VERSION ? 'v' + D.VERSION : '') + ' · Loss Always Builds Strength' }));
    el.appendChild(root);

    /* Kopf: alle auf-/zuklappen */
    const toggleBtn = h('button', { class: 'btn btn--ghost btn--sm hilfe-toggle', type: 'button', onclick: function () {
      const openAll = !dets.every(function (d) { return d.open; });
      dets.forEach(function (d) { d.open = openAll; });
      syncToggle();
    } });
    function syncToggle() {
      const all = dets.length && dets.every(function (d) { return d.open; });
      toggleBtn.innerHTML = icon(all ? 'minus' : 'plus') + '<span>' + (all ? 'Alle zu' : 'Alle auf') + '</span>';
    }
    syncToggle();
    OP.ui.setHeadExtra(toggleBtn);

    /* Direkt-Link: zum Abschnitt scrollen */
    if (target) {
      const t = setTimeout(function () {
        const d = root.querySelector('#hilfe-' + target.replace(/[^a-z0-9_-]/gi, ''));
        if (d) { try { d.scrollIntoView({ block: 'start', behavior: 'smooth' }); } catch (e) { d.scrollIntoView(); } }
      }, 80);
      bag.add(function () { clearTimeout(t); });
    }
    return bag.run;
  }

  OP.screens.register('hilfe', { title: 'Hilfe', icon: 'hilfe', mount: mount });
})();
