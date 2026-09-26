/* Operator – Hilfe (Bildschirm 'hilfe')
   Kurze Erklärungen in aufklappbaren Abschnitten. Alle Zahlen kommen aus OP.data / OP.game,
   damit die Hilfe stimmt, wenn sich Spielwerte ändern.
   Direkt-Link auf einen Abschnitt: #/hilfe/<id>, z. B. #/hilfe/kaempfe (öffnet und scrollt dorthin).
   IDs: worum, xp, gym, kaempfe, chancen, arena, zirkus, schmuggler, kalorien, quests, streak,
        retention, raenge, installieren, sichern */
(function () {
  'use strict';
  const OP = window.OP;
  if (!OP || !OP.screens || !OP.ui) return;
  const U = OP.util, D = OP.data, h = OP.h;

  const openState = { worum: true };   // welche Abschnitte offen sind (bleibt während der Sitzung)

  function icon(name) { return OP.ui.icon(name); }
  /** 2 -> "2", 2.5 -> "2,5" */
  function n(v) { return Math.abs(v - Math.round(v)) < 1e-9 ? U.fmt(v) : U.fmt1(v); }
  function b(text) { return '<b>' + U.esc(text) + '</b>'; }
  const NB = ' ';   // geschütztes Leerzeichen, damit "0,1 %" nicht umbricht
  /** Name des ersten Runner-Rangs, ab dem Gegner dieser Stufe (Tier) vorkommen können */
  function rankForTier(tier) {
    const caps = D.MAX_TIER_BY_RUNNER_RANK || [];
    for (let i = 0; i < caps.length; i++) if (caps[i] >= tier && D.RANKS[i]) return D.RANKS[i].name;
    return null;
  }
  /** Prozente so runden, dass sie zusammen genau 100 ergeben (größter Rest bekommt den Punkt) */
  function roundTo100(values) {
    const sum = values.reduce(function (a, v) { return a + v; }, 0) || 1;
    const raw = values.map(function (v) { return v / sum * 100; });
    const out = raw.map(Math.floor);
    let rest = 100 - out.reduce(function (a, v) { return a + v; }, 0);
    raw.map(function (v, i) { return { i: i, r: v - Math.floor(v) }; })
      .sort(function (a, b) { return b.r - a.r; })
      .forEach(function (x) { if (rest > 0) { out[x.i]++; rest--; } });
    return out;
  }
  /** aktuelles Bauch-Ziel des Spielers (oder Startwert) */
  function absTarget(ex) {
    const a = OP.state && OP.state.abs && OP.state.abs[ex.id];
    return a && a.target > 0 ? a.target : ex.start;
  }

  /* ---------- Bausteine ---------- */

  function para(html) { return h('p', { html: html }); }
  function list(items) { return h('ul', { class: 'hilfe-list' }, items.map(function (i) { return h('li', { html: i }); })); }
  function formula(label, html) {
    return h('div', { class: 'hilfe-formula' },
      label ? h('span', { class: 'hilfe-formula__label', text: label }) : null,
      h('span', { class: 'hilfe-formula__text num', html: html }));
  }
  function example(html) {
    return h('div', { class: 'hilfe-example' }, h('span', { class: 'hilfe-example__tag', text: 'Beispiel' }), h('span', { html: html }));
  }
  function flow(steps, noArrows) {
    const el = h('div', { class: 'hilfe-flow' });
    steps.forEach(function (s, i) {
      if (i && !noArrows) el.appendChild(h('span', { class: 'hilfe-flow__arrow', html: icon('next') }));
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
  function linkBtn(label, iconName, route) {
    return h('button', { class: 'btn btn--ghost btn--sm hilfe-link', type: 'button', onclick: function () { OP.ui.go(route); } },
      h('span', { html: icon(iconName) }), label);
  }

  /* ---------- Inhalte ---------- */

  function sections() {
    const muscles = D.MUSCLES.map(function (m) { return m.name; });
    const g = OP.game;
    const gymTo = g && g.gymTarget ? g.gymTarget(2000) : Math.ceil(2000 * (1 + D.GYM_GOAL_PCT / 100));
    const medium = D.difficulty('medium') || { min: 2, max: 2.9 };
    const exPct = Math.round((medium.min + medium.max) / 2 * 10) / 10;
    const exHp = g && g.enemyHp ? g.enemyHp(2000, exPct) : Math.ceil(2000 * (1 + exPct / 100));
    const bw = (OP.state && OP.state.player && OP.state.player.bodyweight) || D.DEFAULT_BODYWEIGHT || 80;
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
    const kcal20 = 20 * D.KCAL_PER_KG;
    const kcalLeft = kcal20 - 2000;
    const ret = D.RETENTION_PER_DAY;
    const ret4 = (1 - Math.pow(1 - ret, 28)) * 100;
    const ret12 = (1 - Math.pow(1 - ret, 84)) * 100;
    const arenaDiffs = D.DIFFICULTIES.filter(function (d) { return d.pool === 'arena'; });

    function pctText(d) { return d.min === d.max ? '+' + n(d.min) + NB + '%' : '+' + n(d.min) + '–' + n(d.max) + NB + '%'; }

    const out = [];

    out.push({
      id: 'worum', icon: 'portal', title: 'Worum geht\'s?', body: [
        para('Du bist ein ' + b('Labs Runner') + '. Dein Ziel: der stärkste Runner werden.'),
        formula('LABS', '<b>L</b>oss <b>A</b>lways <b>B</b>uilds <b>S</b>trength'),
        para('Jede Niederlage macht dich stärker. Und: ' + b('Das echte Leben bewegt das Spiel.') + ' Du trainierst wirklich, trägst es hier ein – und dein Runner wächst mit.'),
        para('Die Karte ist deine Welt. Jedes Gebäude hat eine Aufgabe:'),
        list([
          b('Taverne') + ' – Abenteuer-Kämpfe, Schmuggler (Kardio) und Zirkus-Tänze (Bauch)',
          b('Arena') + ' – die harten Kämpfe',
          b('Haus') + ' – Profil, Gym, Kalorienschulden und Tages-Quests',
          b('Zauberbude') + ' – Einstellungen und Spielstand sichern'
        ])
      ]
    });

    out.push({
      id: 'xp', icon: 'staerke', title: 'XP & Schaden', body: [
        para('Es gibt 5 Kampf-Muskelgruppen: ' + U.esc(muscles.join(', ')) + '. Bauch ist eine eigene Challenge.'),
        formula('Formel', 'XP = Gewicht × Wiederholungen'),
        para('Jeder Satz wird auf ganze XP gerundet, z. B. ' + U.esc(U.fmt1(setW)) + ' kg × ' + setR + ' = ' + U.esc(U.fmt1(setW * setR)) + ' → ' + b(U.fmt(Math.round(setW * setR)) + ' XP') + '.'),
        para('Alle Sätze einer Einheit werden zusammengezählt. ' + b('XP und HP sind dasselbe') + ': Im Gym sammelst du XP, im Kampf ist es dein Schaden.'),
        para('Welche Übung du machst, ist egal – es zählt nur die Muskelgruppe.'),
        para('Bei Übungen ohne Hantel zählt dein ' + b('Körpergewicht') + ' (bei dir gerade ' + U.esc(n(bw)) + ' kg).'),
        example('27 Liegestütze bei 100 kg = <b>2.700 XP</b>'),
        example('50 kg × 5 Wdh. = <b>250 Schaden</b>'),
        para(b('Gesamtstärke') + ' = alle 5 XP-Werte zusammen.')
      ]
    });

    out.push({
      id: 'gym', icon: 'gym', title: 'Gym', body: [
        para('Im Haus trainierst du eine Muskelgruppe mit deinem aktuellen Wert. Ziel: ' + b('+' + n(D.GYM_GOAL_PCT) + NB + '%') + '.'),
        flow([{ value: '2.000', label: 'jetzt' }, { value: U.fmt(gymTo), label: 'Ziel', tone: 'cyan' }, { value: U.fmt(gymTo + 1), label: 'geschafft', tone: 'ok' }]),
        list([
          'Trag deine Sätze ein (z. B. 24 kg × 10 = 240 XP). Sie werden addiert.',
          'Ziel nicht erreicht: nichts ändert sich.',
          'Ziel geschafft, z. B. ' + U.fmt(gymTo + 1) + ': ' + b('genau dieser Wert') + ' wird dein neuer XP-Wert.'
        ])
      ]
    });

    out.push({
      id: 'kaempfe', icon: 'swords', title: 'Kämpfe', body: [
        para('In der Taverne nimmst du Aufträge an, z. B. ' + b('„Reise ins Skelettland – Beine – Medium“') + '. Gegner und Muskelgruppe werden zufällig gezogen.'),
        formula('Gegner-HP', 'dein XP-Wert + Prozent der Schwierigkeit'),
        example('Beine 2.000 XP, Medium +' + n(exPct) + NB + '% → Gegner hat <b>' + U.fmt(exHp) + ' HP</b>'),
        list([
          'Du trägst Sätze ein wie im Gym. Jeder Satz ist Schaden.',
          b('Sieg') + ': dein ganzer Schaden wird dein neuer XP-Wert – auch der Überschuss.',
          b('Niederlage') + ': alles bleibt, wie es war.',
          'Kein Limit – kämpf so oft du willst.',
          'Auftrag passt nicht? ' + b('Ablehnen') + ' geht ' + freeSkips + '× pro Tag gratis (Taverne und Arena zusammen). Später kannst du mehr Ablehnungen mit Gold kaufen.',
          U.esc(monsterText)
        ]),
        table(['Schwierigkeit', 'Aufschlag', 'Wo?'], D.DIFFICULTIES.map(function (d) {
          return [OP.ui.diffChip(d), h('span', { class: 'num', text: pctText(d) }), d.pool === 'arena' ? 'Arena' : 'Taverne'];
        }))
      ]
    });

    const chanceBox = h('div', { class: 'hilfe-chances' });
    try {
      const ch = g.muscleChances();
      const shown = roundTo100(D.MUSCLES.map(function (m) { return ch[m.id] || 0; }));
      D.MUSCLES.forEach(function (m, i) {
        const p = (ch[m.id] || 0) * 100;
        chanceBox.appendChild(h('div', { class: 'hilfe-chance' },
          h('span', { class: 'hilfe-chance__name', text: m.name }),
          OP.ui.progress(p * 2.5, { thin: true }),
          h('span', { class: 'hilfe-chance__pct num', text: shown[i] + NB + '%' })));
      });
    } catch (e) { /* ohne Spielstand einfach weglassen */ }
    out.push({
      id: 'chancen', icon: 'dice', title: 'Muskel-Chancen', body: [
        para('Welche Muskelgruppe ein Auftrag braucht, wird ausgelost. Am Anfang hat jede ' + b(n(Math.round(1000 / D.MUSCLES.length) / 10) + NB + '%') + '.'),
        para('Was du in den letzten ' + D.MUSCLE_CHANCE_DAYS + ' Tagen oft trainiert hast, kommt seltener dran. So trainierst du automatisch alles.'),
        chanceBox.childNodes.length ? h('div', { class: 'hilfe-sub', text: 'Deine Chancen gerade:' }) : null,
        chanceBox.childNodes.length ? chanceBox : null,
        h('p', { class: 'hilfe-small', text: 'Rechnung: Gewicht = 1 ÷ (1 + Trainings in ' + D.MUSCLE_CHANCE_DAYS + ' Tagen).' })
      ]
    });

    out.push({
      id: 'arena', icon: 'arena', title: 'Arena', body: [
        para('Hier gibt es nur ' + arenaDiffs.map(function (d) { return b(d.name) + ' (' + pctText(d) + ')'; }).join(' und ') + '.'),
        para('Meist kämpfst du gegen Menschen, manchmal gegen starke Fabelwesen.'),
        para('Die Arena ist für Tage, an denen du dich richtig stark fühlst.'),
        para(U.esc(monsterText))
      ]
    });

    out.push({
      id: 'zirkus', icon: 'zirkus', title: 'Zirkus-Tänze (Bauch)', body: [
        para('Bauch ist keine Kampf-Gruppe, sondern eine Challenge in der Taverne. Hier zählt die genaue Übung.'),
        table(['Übung', 'Dein Ziel', 'Geschafft'], D.ABS_EXERCISES.map(function (ex) {
          const u = ex.unit === 's' ? ' s' : ' Wdh.';
          return [ex.name, h('span', { class: 'num', text: absTarget(ex) + u }), h('span', { class: 'num tone-ok', text: '+' + ex.step + u })];
        })),
        list([
          b('Zeit') + ' (Planks): ein Versuch, du trägst deine Sekunden ein.',
          b('Wiederholungen') + ' (Crunches, Sit-ups): werden gezählt, bis das Ziel erreicht ist.',
          'Kein Limit. Schaffst du z. B. 3 Minuten Plank nicht, kennst du dein Limit – dann kämpfst du gegen die Retention.',
          'Dein Bauch-Rang kommt von deiner besten Plank-Zeit.'
        ])
      ]
    });

    out.push({
      id: 'schmuggler', icon: 'schmuggler', title: 'Schmuggler (Kardio)', body: [
        para('Such dir einen von ' + cardioCount + ' Aufträgen aus: Schritte, Joggen, Sprints, Marsch und mehr. Es läuft immer nur einer.'),
        list([
          'Jeder Auftrag hat ein ' + b('Zeitlimit') + '. Geschafft? Dann tippst du auf „Geschafft“.',
          'Nicht in der Zeit geschafft = Auftrag verloren.',
          'Jeder Erfolg macht den Auftrag ' + b('+' + n(cardioPct) + NB + '%') + ' schwerer.',
          'Abbrechen ohne Wertung geht nur in den ersten ' + cancelMin + ' Minuten.'
        ]),
        example(U.fmt(stepsDef.base) + ' Schritte → nach einem Erfolg <b>' + U.fmt(stepsNext) + ' Schritte</b>')
      ]
    });

    out.push({
      id: 'kalorien', icon: 'kcal', title: 'Kalorienschulden', body: [
        para('Du legst fest, wie viel Kilo Fett du verlieren willst. Das sind deine Schulden.'),
        formula('Umrechnung', '1 kg Fett ≈ ' + U.fmt(D.KCAL_PER_KG) + ' kcal'),
        example('20 kg = <b>' + U.fmt(kcal20) + ' kcal</b>. Nach 2 Tagen −2.000 kcal: noch ' + U.fmt(kcalLeft) + ' kcal = <b>' + U.pct(kcalLeft / kcal20 * 100) + '</b> übrig'),
        list([
          'Jedes Kaloriendefizit zahlt ab.',
          'Ein Überschuss (mehr gegessen als verbraucht) kommt wieder drauf.',
          'Bei 0 kcal gibt es das Achievement ' + b('„ICH BIN GESUND!“') + '.',
          'Danach kannst du im Haus ein ' + b('neues Ziel') + ' setzen. Es startet frisch – alte Einträge zählen dann nicht mehr.'
        ])
      ]
    });

    out.push({
      id: 'quests', icon: 'quest', title: 'Tages-Quests', body: [
        para('Deine eigenen Aufgaben für jeden Tag, z. B. Lesen oder Bewerbung schreiben. Jeden Tag geht es von vorne los.'),
        list([
          b('Abhaken') + ' kannst du überall – auch direkt auf der Karte rechts oben.',
          'Aus Versehen abgehakt? ' + b('Zurücknehmen') + ' geht nur im Haus (Tab „Quests“).',
          'Neue Quests legst du im Haus an.'
        ]),
        h('div', { class: 'hilfe-sub', text: 'Kategorien' }),
        h('div', { class: 'hilfe-cats' }, D.QUEST_CATEGORIES.map(function (c) {
          return h('div', { class: 'hilfe-cat', style: { '--cat': c.color } },
            h('span', { class: 'hilfe-cat__ico', html: icon(c.icon) }),
            h('span', { class: 'hilfe-cat__text' }, h('b', { text: c.name }), h('small', { text: c.hint || '' })));
        }))
      ]
    });

    let streakLine = null;
    try {
      const si = g.streakInfo();
      streakLine = h('div', { class: 'hilfe-live' },
        h('span', { html: icon('streak') }),
        h('span', { text: 'Dein Streak: ' + si.current + (si.current === 1 ? ' Tag' : ' Tage') + ' · Rekord: ' + si.longest }));
    } catch (e) { /* egal */ }
    out.push({
      id: 'streak', icon: 'streak', title: 'Streak', body: [
        para(b('Streak') + ' = Tage in Folge, an denen du mindestens eine Sache gemacht hast:'),
        list(['Gym, Kampf oder Arena', 'Bauch-Challenge oder Schmuggler-Auftrag', 'eine abgehakte Tages-Quest']),
        para('Heute noch nichts gemacht? Dein Streak von gestern hält bis Mitternacht.'),
        streakLine,
        h('p', { class: 'hilfe-small', text: 'Ruhetage (mit Gold kaufen) kommen später.' })
      ]
    });

    out.push({
      id: 'retention', icon: 'clock', title: 'Retention', body: [
        para('Muskeln bauen ab, wenn du nichts tust: ' + b('Jeder Tag ohne Training') + ' senkt alle 5 XP-Werte um ' + b(U.fmt1(ret * 100) + NB + '%') + '.'),
        flow([{ value: '≈ −' + Math.round(ret4) + NB + '%', label: 'nach 4 Wochen', tone: 'warn' }, { value: '≈ −' + Math.round(ret12) + NB + '%', label: 'nach 12 Wochen', tone: 'err' }], true),
        example('2.000 XP nach 4 Wochen Pause: ≈ <b>' + U.fmt(2000 * Math.pow(1 - ret, 28)) + ' XP</b>'),
        para('Training heißt: Gym, Kampf, Arena, Bauch oder Schmuggler. Schon ein eingetragener Satz zählt. Quests zählen für den Streak, schützen aber nicht vor Retention.')
      ]
    });

    out.push({
      id: 'raenge', icon: 'rank', title: 'Ränge', body: [
        para('Jede Muskelgruppe hat einen Rang, je nach aktuellem XP-Wert. Der Bauch-Rang kommt von deiner besten Plank-Zeit.'),
        table(['Rang', 'XP ab', 'Bauch (Plank) ab'], D.RANKS.map(function (r, i) {
          const sec = D.ABS_RANK_SECONDS[i] || 0;
          return [OP.ui.rankBadge(r, { small: true }), h('span', { class: 'num', text: U.fmt(r.min) }),
            h('span', { class: 'num', text: i === 0 ? 'unter ' + D.ABS_RANK_SECONDS[1] + ' s' : sec + ' s' })];
        }), 'hilfe-table--ranks'),
        para(b('Runner-Rang') + ' = Rang deines Durchschnitts aus allen 5 XP-Werten.'),
        para('Die XP-Schwellen kannst du pro Muskelgruppe anpassen – z. B. höher für Beine, weil Hantel-Übungen mehr XP geben als Körpergewicht.'),
        linkBtn('Rang-Schwellen ändern', 'zauberbude', 'zauberbude/ranks')
      ]
    });

    out.push({
      id: 'installieren', icon: 'download', title: 'App installieren', body: [
        para('Als App auf dem Home-Bildschirm startet Operator wie eine echte App – ohne Adressleiste, auch offline.'),
        h('div', { class: 'hilfe-sub', text: 'iPhone (Safari)' }),
        steps(['Seite in ' + b('Safari') + ' öffnen', 'Unten auf ' + b('Teilen') + ' tippen (Quadrat mit Pfeil nach oben)', b('„Zum Home-Bildschirm“') + ' wählen', 'Oben rechts auf ' + b('Hinzufügen') + ' tippen']),
        h('div', { class: 'hilfe-sub', text: 'Android (Chrome)' }),
        steps(['Seite in ' + b('Chrome') + ' öffnen', 'Oben rechts das ' + b('Menü') + ' (drei Punkte) öffnen', b('„App installieren“') + ' (oder „Zum Startbildschirm hinzufügen“) tippen'])
      ]
    });

    out.push({
      id: 'sichern', icon: 'export', title: 'Spielstand sichern', body: [
        para('Dein Spielstand liegt ' + b('nur in diesem Browser') + ' auf diesem Gerät. Browser-Daten löschen = Spielstand weg.'),
        list([
          'Sichere regelmäßig in der Zauberbude: ' + b('Kopieren') + ' (z. B. in eine Notiz) oder ' + b('Als Datei speichern') + '.',
          'Neues Handy? Dort bei der Einrichtung „Ich habe schon einen Spielstand“ tippen – oder in der Zauberbude importieren.',
          'Vor jedem Import und Zurücksetzen merkt sich der Browser automatisch den alten Stand. Auch ein beschädigter Spielstand wird aufbewahrt. Alles findest du in der Zauberbude unter ' + b('„Notfall-Sicherungen“') + '.'
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
      h('p', { text: 'Kurz erklärt – tipp auf ein Thema. Alle Zahlen hier sind die echten Spielwerte.' })));

    const list = h('div', { class: 'hilfe-secs' });
    const dets = [];
    let data = [];
    try { data = sections(); } catch (e) { console.error('[hilfe]', e); }
    data.forEach(function (s) {
      const det = h('details', { class: 'hilfe-sec card card--plain', id: 'hilfe-' + s.id, open: !!openState[s.id], dataset: { sec: s.id } },
        h('summary', { class: 'hilfe-sec__head' },
          h('span', { class: 'hilfe-sec__ico', html: icon(s.icon) }),
          h('span', { class: 'hilfe-sec__title', text: s.title }),
          h('span', { class: 'hilfe-sec__chev', html: icon('down') })),
        h('div', { class: 'hilfe-sec__body' }, s.body));
      det.addEventListener('toggle', function () { openState[s.id] = det.open; syncToggle(); });
      dets.push(det);
      list.appendChild(det);
    });
    root.appendChild(list);
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
        const d = root.querySelector('#hilfe-' + target);
        if (d) { try { d.scrollIntoView({ block: 'start', behavior: 'smooth' }); } catch (e) { d.scrollIntoView(); } }
      }, 80);
      bag.add(function () { clearTimeout(t); });
    }
    return bag.run;
  }

  OP.screens.register('hilfe', { title: 'Hilfe', icon: 'hilfe', mount: mount });
})();
