/* Operator – Profil (Haus → Profil): der Charakterbogen des Labs Runners.
   Zeigt Gesamtstaerke, Runner-Rang, Streak, Hologramm-Koerper in Rang-Farben,
   Muskel-Raenge, Statistiken und Achievements.
   Aendert nichts am Spielstand – ausser dem Namen (ueber OP.game.setPlayer). */
(function () {
  'use strict';
  var OP = (window.OP = window.OP || {});
  var U = OP.util, h = OP.h;

  /* ---------- Einstellungen / feste Texte ---------- */

  var AVATAR_SRC = 'assets/sprites/avatar.png';

  // Filter-Chips fuer Achievements (Reihenfolge = Anzeige)
  var ACH_CATS = [
    { id: 'alle', name: 'Alle' },
    { id: 'kampf', name: 'Kampf' },
    { id: 'arena', name: 'Arena' },
    { id: 'gym', name: 'Gym' },
    { id: 'bauch', name: 'Bauch' },
    { id: 'kardio', name: 'Kardio' },
    { id: 'quests', name: 'Quests' },
    { id: 'streak', name: 'Streak' },
    { id: 'kalorien', name: 'Kalorien' },
    { id: 'staerke', name: 'Stärke' },
    { id: 'sonstiges', name: 'Sonstiges' }
  ];

  // bleibt erhalten, wenn man den Tab wechselt und zurueckkommt
  var achFilter = 'alle';
  var showAllLocked = false;   // bei "Alle": alle gesperrten zeigen oder nur eine Vorschau
  var LOCKED_PREVIEW = 6;

  /* ---------- kleine Helfer ---------- */

  function icon(name) { return OP.ui.icon(name); }
  function num(v) { v = Number(v); return isFinite(v) ? v : 0; }
  function stats() { return (OP.state && OP.state.stats) || {}; }
  function days(n) { n = num(n); return n === 1 ? '1 Tag' : U.fmt(n) + ' Tage'; }

  /** Wert mit Einheit: XP oder Sekunden (Bauch) */
  function unitText(v, unit) {
    return unit === 's' ? U.secs(v) : U.fmt(v) + ' XP';
  }
  /** "2.400 XP" bzw. "Plank-Bestzeit 45 s" */
  function valueText(row) {
    if (row.unit === 's') return row.value > 0 ? 'Plank-Bestzeit ' + U.secs(row.value) : 'Noch keine Plank-Zeit';
    // knapp unter einer Schwelle abrunden (2.799,6 soll nicht als "2.800" neben "noch 1 XP bis Gold" stehen)
    var v = num(row.value), r = row.rank;
    if (r && r.nextMin != null && Math.round(v) >= r.nextMin) v = Math.floor(v);
    return U.fmt(v) + ' XP';
  }
  /** "noch 400 XP bis Gold" bzw. "Höchster Rang erreicht" */
  function nextText(row) {
    var r = row.rank;
    if (!r || !r.next) return 'Höchster Rang erreicht';
    // aufrunden, damit bei krummen XP (Retention) nie "noch 0 XP" dasteht
    return 'noch ' + unitText(Math.max(1, Math.ceil(num(r.toNext))), row.unit) + ' bis ' + r.next.name;
  }

  /** Baut einen Abschnitt; wenn etwas schiefgeht, steht dort ein Hinweis statt einer leeren Seite */
  function safe(label, fn) {
    try { return fn(); }
    catch (e) { console.error('[profil] ' + label, e); return errorNote(label); }
  }
  function errorNote(label) {
    return h('div', { class: 'prof-error small' },
      h('span', { html: icon('warning') }), label + ' konnte nicht geladen werden.');
  }

  /* ---------- Avatar (Bild wird einmal gesucht, sonst Icon im Sechseck) ---------- */

  var avatarState = 'unknown';   // unknown | loading | ok | missing
  var avatarWaiters = [];
  function probeAvatar(cb) {
    if (avatarState === 'ok' || avatarState === 'missing') { cb(avatarState === 'ok'); return; }
    avatarWaiters.push(cb);
    if (avatarState === 'loading') return;
    avatarState = 'loading';
    var img = new Image();
    function done(ok) {
      avatarState = ok ? 'ok' : 'missing';
      var list = avatarWaiters; avatarWaiters = [];
      list.forEach(function (f) { try { f(ok); } catch (e) { /* egal */ } });
    }
    img.onload = function () { done(true); };
    img.onerror = function () { done(false); };
    img.src = AVATAR_SRC;
  }

  function buildAvatar(rank) {
    var inner = h('div', { class: 'prof-avatar__inner', html: OP.ui.icon('profil') });
    var wrap = h('div', { class: 'prof-avatar', style: { '--rank-color': rank.color } },
      h('div', { class: 'prof-avatar__hex' }, inner),
      h('span', { class: 'prof-avatar__gem', title: rank.name }));
    probeAvatar(function (ok) {
      if (!ok) return;
      inner.innerHTML = '';
      inner.appendChild(h('img', { class: 'prof-avatar__img', src: AVATAR_SRC, alt: 'Avatar', draggable: 'false' }));
      wrap.classList.add('has-img');
    });
    return wrap;
  }

  /* ---------- Held-Bereich (Dossier) ---------- */

  function editName() {
    var cur = (OP.state && OP.state.player && OP.state.player.name) || '';
    OP.ui.prompt('Name ändern', { value: cur, label: 'Dein Runner-Name', placeholder: 'z. B. Artur', okLabel: 'Speichern' })
      .then(function (v) {
        if (v == null) return;
        var res = OP.game.setPlayer({ name: v });
        if (res && res.ok === false) OP.ui.toast(res.error || 'Name wurde nicht gespeichert.', { type: 'warn' });
        else OP.ui.toast('Name gespeichert.', { type: 'ok' });
      });
  }

  /** Eigenen Namen nie abschneiden ("MAXIMIL…"): passt ein Wort nicht in die Zeile,
      Schrift so weit verkleinern, dass es passt (höchstens bis 16 px). Braucht das Element im DOM. */
  function fitName(n) {
    if (!n) return;
    n.style.fontSize = '';
    var cw = n.clientWidth, sw = n.scrollWidth;
    if (!cw || sw <= cw) return;
    var px = parseFloat(getComputedStyle(n).fontSize) || 27;
    n.style.fontSize = Math.max(16, Math.floor(px * (cw - 1) / sw * 10) / 10) + 'px';
  }

  function buildHero() {
    var s = OP.state, g = OP.game;
    var player = s.player || {};
    var runner = g.runnerRank();
    var total = g.totalStrength();
    var streak = g.streakInfo();
    var nMuscles = (OP.data.MUSCLE_IDS && OP.data.MUSCLE_IDS.length) || 5;

    // Dossier-Nummer aus dem Erstelldatum (nur Deko)
    var created = num(s.created) || Date.now();
    var dossierId = 'OP-' + created.toString(36).toUpperCase().slice(-5);
    var since = U.dayLabel(U.dayKey(created));

    // Runner-Rang = Durchschnitt der 5 Gruppen. Fehlende Gesamtstaerke wie in der Seitenleiste der Karte:
    // (Schwelle des naechsten Rangs x 5) - Gesamtstaerke. Dazu im Schnitt pro Gruppe.
    var runnerNext = 'Höchster Rang erreicht', runnerSub = null;
    if (runner.next) {
      var missing = Math.max(1, Math.ceil(num(runner.nextMin) * nMuscles - total));
      runnerNext = 'noch ' + U.fmt(missing) + ' Gesamtstärke bis ' + runner.next.name;
      runnerSub = '(Ø ' + U.fmt(Math.max(1, Math.ceil(missing / nMuscles))) + ' XP mehr je Gruppe)';
    }

    // Streak-Hinweis
    var streakHint;
    if (streak.todayActive) streakHint = 'Heute schon aktiv – dein Streak ist sicher.';
    else if (streak.current > 0) streakHint = 'Heute noch offen: Training oder eine Quest hält ihn am Leben.';
    else streakHint = 'Starte heute einen neuen Streak.';

    var hero = h('section', { class: 'card card--gold prof-hero', 'aria-label': 'Dein Runner' },
      h('div', { class: 'prof-hero__fx', 'aria-hidden': 'true' }, h('span', { class: 'prof-hero__wm', text: 'LABS' })),

      // Kopfzeile des Dossiers
      h('div', { class: 'prof-hero__top' },
        h('span', { class: 'prof-hero__kicker' }, h('span', { html: icon('shield') }), 'Runner-Dossier'),
        h('span', { class: 'prof-hero__id num', text: dossierId }),
        h('button', { class: 'icon-btn icon-btn--sm prof-hero__gear', type: 'button', 'aria-label': 'Einstellungen (Zauberbude)',
          title: 'Einstellungen (Zauberbude)', html: icon('settings'), onclick: function () { OP.ui.go('zauberbude'); } })),

      // Avatar + Name + Runner-Rang
      h('div', { class: 'prof-hero__who' },
        buildAvatar(runner.rank),
        h('div', { class: 'prof-hero__ident' },
          h('div', { class: 'prof-hero__namebar' },
            h('h2', { class: 'prof-hero__name', text: player.name || 'Runner' }),
            h('button', { class: 'icon-btn icon-btn--sm icon-btn--ghost prof-hero__edit', type: 'button',
              'aria-label': 'Namen ändern', title: 'Namen ändern', html: icon('edit'), onclick: editName })),
          h('div', { class: 'prof-hero__role', text: 'Labs Runner' }),
          h('div', { class: 'prof-hero__rank' },
            OP.ui.rankBadge(runner.rank),
            h('span', { class: 'prof-hero__ranklbl', text: 'Runner-Rang' })),
          h('div', { class: 'prof-hero__meta' },
            h('span', { text: 'Seit ' + since + ' im Einsatz' }),
            player.bodyweight ? h('span', { text: U.fmt1(player.bodyweight).replace(',0', '') + ' kg' }) : null))),

      // Gesamtstaerke
      h('div', { class: 'prof-power' },
        h('div', { class: 'prof-power__label', text: 'Gesamtstärke' }),
        h('div', { class: 'prof-power__value num' }, h('span', { html: icon('staerke') }), h('span', { text: U.fmt(total) })),
        h('div', { class: 'prof-power__hint', text: 'alle fünf XP-Werte zusammen' }),
        h('div', { class: 'prof-power__runner', style: { '--rank-color': (runner.next || runner.rank).color } },
          OP.ui.progress(num(runner.progress) * 100, { thin: true, tone: 'gold' }),
          h('span', { class: 'prof-power__next' },
            h('span', { class: 'prof-power__togo', text: runnerNext }),
            runnerSub ? ' ' : null,
            runnerSub ? h('span', { class: 'prof-power__per', text: runnerSub }) : null))),

      // Streak
      h('div', { class: 'prof-streak' },
        h('div', { class: 'prof-streak__tile prof-streak__tile--now' + (streak.todayActive ? ' is-live' : '') },
          h('span', { class: 'prof-streak__ico', html: icon('streak') }),
          h('span', { class: 'prof-streak__val num', text: U.fmt(streak.current) }),
          h('span', { class: 'prof-streak__lbl', text: streak.current === 1 ? 'Tag Streak' : 'Tage Streak' })),
        h('div', { class: 'prof-streak__tile prof-streak__tile--best' },
          h('span', { class: 'prof-streak__ico', html: icon('crown') }),
          h('span', { class: 'prof-streak__val num', text: U.fmt(streak.longest) }),
          h('span', { class: 'prof-streak__lbl', text: 'Längster Streak' })),
        h('p', { class: 'prof-streak__hint', text: streakHint }))
    );
    return hero;
  }

  /* ---------- Hologramm-Koerper ---------- */

  function rankColors(rows) {
    var c = {};
    rows.forEach(function (r) { c[r.id] = r.rank.rank.color; });
    return c;
  }

  /** Einfacher 2D-Koerper (nur falls OP.holo fehlt): Vorderansicht, Ruecken als Schatten dahinter */
  function fallbackBody(container, colors) {
    function col(id) { return colors[id] || '#3ee6d0'; }
    function part(id, d) {
      return '<path class="prof-fb__part" data-group="' + id + '" d="' + d + '" style="--c:' + col(id) + '"/>';
    }
    var svg =
      '<svg class="prof-fb" viewBox="0 0 200 340" aria-hidden="true">' +
      // Ruecken (Latissimus hinter dem Oberkoerper)
      part('ruecken', 'M60 66 L140 66 L156 112 L132 172 L68 172 L44 112 Z') +
      // Kopf + Hals (neutral)
      '<circle class="prof-fb__head" cx="100" cy="30" r="17"/>' +
      '<path class="prof-fb__head" d="M92 46 L108 46 L110 58 L90 58 Z"/>' +
      // Schultern
      part('schultern', 'M50 64 Q64 54 80 62 L76 84 Q60 88 48 82 Z') +
      part('schultern', 'M150 64 Q136 54 120 62 L124 84 Q140 88 152 82 Z') +
      // Brust
      part('brust', 'M99 62 L81 63 Q74 84 80 104 Q92 108 99 104 Z') +
      part('brust', 'M101 62 L119 63 Q126 84 120 104 Q108 108 101 104 Z') +
      // Arme
      part('arme', 'M47 86 Q58 90 62 92 L56 146 L42 146 Z') +
      part('arme', 'M42 150 L56 150 L50 206 L36 204 Z') +
      part('arme', 'M153 86 Q142 90 138 92 L144 146 L158 146 Z') +
      part('arme', 'M158 150 L144 150 L150 206 L164 204 Z') +
      // Bauch (Sixpack)
      part('bauch', 'M82 108 L118 108 L116 168 L84 168 Z') +
      '<path class="prof-fb__line" d="M100 110 L100 166 M84 128 L116 128 M84 148 L116 148"/>' +
      // Beine
      part('beine', 'M82 174 L99 174 L97 254 L78 254 Z') +
      part('beine', 'M118 174 L101 174 L103 254 L122 254 Z') +
      part('beine', 'M79 258 L96 258 L94 326 L82 326 Z') +
      part('beine', 'M121 258 L104 258 L106 326 L118 326 Z') +
      '</svg>';
    container.classList.add('prof-holo--fallback');
    container.innerHTML = svg + '<div class="prof-fb__scan"></div>';
    return {
      update: function (o) {
        if (!o || !o.colors) return;
        colors = o.colors;
        container.querySelectorAll('.prof-fb__part').forEach(function (p) { p.style.setProperty('--c', col(p.getAttribute('data-group'))); });
      },
      pulse: function (id) {
        container.querySelectorAll('.prof-fb__part').forEach(function (p) {
          if (id && p.getAttribute('data-group') !== id) return;
          p.classList.remove('is-pulse'); void p.getBoundingClientRect(); p.classList.add('is-pulse');
        });
      },
      destroy: function () { container.innerHTML = ''; }
    };
  }

  function createHolo(container, rows) {
    var colors = rankColors(rows);
    if (OP.holo && typeof OP.holo.body === 'function') {
      try {
        var hd = OP.holo.body(container, { mode: 'ranks', colors: colors, autoRotate: true, interactive: true });
        if (hd) return hd;
      } catch (e) {
        console.error('[profil] Hologramm', e);
        container.innerHTML = '';
      }
    }
    return fallbackBody(container, colors);
  }

  /* ---------- Muskel-Raenge ---------- */

  function openRankModal(row, holo) {
    var D = OP.data, isAbs = row.id === 'bauch';
    var th = isAbs ? (D.ABS_RANK_SECONDS || []) : OP.game.thresholds(row.id);
    var ranks = D.RANKS || [];
    var cur = row.rank ? row.rank.index : 0;
    var m = D.muscle(row.id) || { name: row.name, icon: row.id };
    var overrides = OP.state.settings && OP.state.settings.rankOverrides;
    var custom = !isAbs && overrides && Array.isArray(overrides[row.id]);

    // Leiter: Legende oben, Holz unten
    var ladder = h('ol', { class: 'prof-ladder' });
    for (var i = ranks.length - 1; i >= 0; i--) {
      var rk = ranks[i], state = i < cur ? 'done' : (i === cur ? 'current' : 'locked');
      var extra = null;
      if (state === 'current') extra = h('span', { class: 'chip chip--gold prof-ladder__tag', text: 'Dein Rang' });
      else if (state === 'done') extra = h('span', { class: 'prof-ladder__ok', html: icon('check'), 'aria-label': 'geschafft' });
      else if (i === cur + 1) extra = h('span', { class: 'prof-ladder__togo small', text: 'noch ' + unitText(Math.max(1, Math.ceil(num(row.rank.toNext))), row.unit) });
      ladder.appendChild(h('li', { class: 'prof-ladder__step is-' + state, style: { '--rank-color': rk.color } },
        h('span', { class: 'prof-ladder__gem' }),
        h('span', { class: 'prof-ladder__name', text: rk.name }),
        h('span', { class: 'prof-ladder__min num', text: 'ab ' + unitText(num(th[i]), row.unit) }),
        h('span', { class: 'prof-ladder__extra' }, extra)));
    }

    var body = h('div', { class: 'stack' },
      h('div', { class: 'prof-modal__head', style: { '--rank-color': row.rank.rank.color } },
        h('span', { class: 'prof-modal__ico', html: icon(m.icon || row.id) }),
        h('div', null,
          h('div', { class: 'prof-modal__val num', text: valueText(row) }),
          h('div', { class: 'small muted', text: isAbs
            ? 'Der Bauch-Rang richtet sich nach deiner besten Plank-Zeit.'
            : 'Der Rang richtet sich nach deinem aktuellen XP-Wert.' }))),
      ladder,
      h('p', { class: 'tiny faint', text: isAbs
        ? 'Neue Bestzeit? Trag sie bei den Zirkus-Tänzen in der Taverne ein.'
        : (custom ? 'Eigene Schwellen – eingestellt in der Zauberbude.' : 'Die Schwellen kannst du in der Zauberbude anpassen.') }));

    if (holo && typeof holo.pulse === 'function') { try { holo.pulse(row.id); } catch (e) { /* egal */ } }

    OP.ui.modal({
      title: row.name + ' – Ränge',
      body: body,
      actions: [
        { label: 'Schließen', kind: 'ghost' },
        isAbs
          ? { label: 'Zum Zirkus', kind: 'primary', icon: 'zirkus', onClick: function () { OP.ui.go('taverne/zirkus'); } }
          : { label: 'Ins Gym', kind: 'primary', icon: 'gym', onClick: function () { OP.ui.go('haus/gym/' + row.id); } }
      ]
    });
  }

  function buildRankRow(row, getHolo) {
    var m = OP.data.muscle(row.id) || { name: row.name, icon: row.id };
    var r = row.rank;
    function open() { openRankModal(row, getHolo()); }
    return h('div', {
      class: 'prof-rank', role: 'button', tabindex: '0', style: { '--rank-color': r.rank.color },
      'aria-label': row.name + ': ' + r.rank.name + ', ' + valueText(row) + '. Alle Ränge anzeigen',
      onclick: open,
      onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } }
    },
      h('span', { class: 'prof-rank__icon', html: icon(m.icon || row.id) }),
      h('div', { class: 'prof-rank__main' },
        h('div', { class: 'prof-rank__top' },
          h('span', { class: 'prof-rank__name', text: row.name }),
          OP.ui.rankBadge(r.rank, { small: true })),
        h('div', { class: 'prof-rank__value num', text: valueText(row) }),
        OP.ui.progress(num(r.progress) * 100, { thin: true }),
        h('div', { class: 'prof-rank__next' + (r.next ? '' : ' is-max'), text: nextText(row) })),
      h('span', { class: 'prof-rank__chev', html: icon('next') }));
  }

  function buildRanks(rows, getHolo) {
    var list = h('div', { class: 'prof-ranks' });
    rows.forEach(function (row) { list.appendChild(buildRankRow(row, getHolo)); });
    return list;
  }

  /* ---------- Statistiken ---------- */

  function buildStats() {
    var s = stats(), streak = OP.game.streakInfo();
    var enemyCount = (OP.data.ENEMIES && OP.data.ENEMIES.length) || 100;
    var distinct = 0, ed = s.enemiesDefeated || {};
    var known = OP.data.ENEMIES && OP.data.ENEMIES.length && typeof OP.game.enemy === 'function';
    Object.keys(ed).forEach(function (k) {
      if (num(ed[k]) > 0 && (!known || OP.game.enemy(k))) distinct++;   // nur echte Gegner zaehlen
    });

    // [Wert, Beschriftung, Icon, Farbe]
    var groups = [
      { title: 'Kampf', icon: 'swords', items: [
        [U.fmt(s.fightsTotal), 'Kämpfe gesamt', 'swords'],
        [U.fmt(s.fightsWon), 'Siege', 'trophy', 'ok'],
        [U.fmt(s.arenaFights), 'Arena-Kämpfe', 'arena'],
        [U.fmt(s.arenaWins), 'Arena-Siege', 'crown', 'gold'],
        [U.fmt(s.insaneWins), 'Insane-Siege', 'skull', 'err'],
        [U.fmt(s.defeatedTotal), 'Besiegte Gegner', 'skull'],
        [distinct + ' / ' + enemyCount, 'Verschiedene Gegner', 'target']
      ] },
      { title: 'Training', icon: 'gym', items: [
        [U.fmt(s.gymSessions), 'Gym-Einheiten', 'gym'],
        [U.fmt(s.gymWins), 'Gym geschafft', 'check', 'ok'],
        [U.fmt(s.absWins), 'Bauch-Challenges geschafft', 'bauch'],
        [U.fmt(s.cardioWins), 'Schmuggler geschafft', 'schmuggler', 'ok'],
        [U.fmt(s.cardioFails), 'Schmuggler verloren', 'timer'],
        [U.fmt(s.setsLogged), 'Sätze', 'flag'],
        [U.fmt(s.totalDamage), 'Bewegtes Gewicht (kg × Wdh.)', 'bolt', 'cyan']
      ] },
      { title: 'Alltag', icon: 'quest', items: [
        [U.fmt(s.questsDone), 'Quests erledigt', 'quest'],
        [days(streak.current), 'Aktueller Streak', 'streak'],
        [days(streak.longest), 'Längster Streak', 'crown', 'gold'],
        [U.fmt(s.kcalPaid), 'kcal abbezahlt', 'kcal']
      ] }
    ];

    var wrap = h('div', { class: 'prof-stats' });
    groups.forEach(function (gr) {
      var grid = h('div', { class: 'prof-stats__grid' });
      gr.items.forEach(function (it) {
        // Farbe nur, wenn schon etwas erreicht ist (eine rote 0 wirkt wie ein Fehler)
        var tone = it[3] && !/^0( |$)/.test(String(it[0])) ? it[3] : null;
        grid.appendChild(OP.ui.stat(it[0], it[1], { icon: it[2], tone: tone }));
      });
      wrap.appendChild(h('div', { class: 'prof-stats__group' },
        h('h3', { class: 'prof-stats__title' }, h('span', { html: icon(gr.icon) }), gr.title),
        grid));
    });
    return wrap;
  }

  /* ---------- Achievements ---------- */

  function achList() {
    var list = OP.data.ACHIEVEMENTS;
    if (!Array.isArray(list)) return [];
    return list.filter(function (a) { return a && a.id; });
  }
  function achCat(a) {
    for (var i = 1; i < ACH_CATS.length; i++) if (ACH_CATS[i].id === a.cat) return a.cat;
    return 'sonstiges';
  }
  function achDate(ts) {
    var t = num(ts);
    if (!t) return 'Freigeschaltet';
    return U.dayLabel(U.dayKey(t));
  }

  function buildAchievements(box) {
    var list = achList();
    var got = (OP.state && OP.state.achievements) || {};
    var prog = OP.game.achievementProgress();
    box.innerHTML = '';

    box.appendChild(OP.ui.sectionTitle('Achievements', 'trophy',
      h('span', { class: 'prof-ach-count num' }, h('b', { text: U.fmt(prog.got) }), ' / ' + U.fmt(prog.total))));

    if (!list.length) {
      box.appendChild(h('div', { class: 'card card--plain empty' },
        h('div', { class: 'empty__icon', html: icon('trophy') }),
        h('p', { text: 'Noch keine Achievements geladen.' })));
      return;
    }

    box.appendChild(OP.ui.progress(prog.total ? prog.got / prog.total * 100 : 0, { tone: 'gold', thin: true }));

    // Zaehler je Kategorie (leere Kategorien bekommen keinen Chip)
    var counts = {};
    ACH_CATS.forEach(function (c) { counts[c.id] = { all: 0, got: 0 }; });
    list.forEach(function (a) {
      var c = achCat(a), has = !!got[a.id];
      counts[c].all++; counts.alle.all++;
      if (has) { counts[c].got++; counts.alle.got++; }
    });
    if (!counts[achFilter] || !counts[achFilter].all) achFilter = 'alle';

    var chips = h('div', { class: 'prof-ach-filter', role: 'tablist', 'aria-label': 'Achievements filtern' });
    ACH_CATS.forEach(function (c) {
      if (!counts[c.id].all) return;
      var on = c.id === achFilter;
      chips.appendChild(h('button', {
        class: 'chip chip--btn prof-ach-chip' + (on ? ' is-on' : ''), type: 'button', role: 'tab', 'aria-selected': on ? 'true' : 'false',
        onclick: function () { achFilter = c.id; buildAchievements(box); }
      }, c.name, h('span', { class: 'prof-ach-chip__n num', text: counts[c.id].got + '/' + counts[c.id].all })));
    });
    box.appendChild(chips);

    // Freigeschaltete zuerst, sonst Reihenfolge der Daten
    var shown = list.filter(function (a) { return achFilter === 'alle' || achCat(a) === achFilter; });
    var unlocked = shown.filter(function (a) { return !!got[a.id]; });
    var locked = shown.filter(function (a) { return !got[a.id]; });

    // Bei "Alle" nur eine Vorschau der gesperrten zeigen (je Kategorie das erste), sonst wird die Seite sehr lang
    var lockedShown = locked, hidden = 0, limit = previewCount(box);
    var canCollapse = achFilter === 'alle' && locked.length > limit;
    if (canCollapse && !showAllLocked) {
      lockedShown = previewLocked(locked, limit);
      hidden = locked.length - lockedShown.length;
    }

    var grid = h('div', { class: 'prof-ach-grid' });
    if (unlocked.length) {
      grid.appendChild(h('div', { class: 'prof-ach-sub' }, h('span', { html: icon('star') }), 'Freigeschaltet · ' + unlocked.length));
      unlocked.forEach(function (a) { grid.appendChild(achTile(a, got[a.id])); });
    }
    if (locked.length) {
      grid.appendChild(h('div', { class: 'prof-ach-sub prof-ach-sub--locked' }, h('span', { html: icon('lock') }),
        (hidden ? 'Nächste Ziele · ' : 'Noch offen · ') + locked.length));
      lockedShown.forEach(function (a) { grid.appendChild(achTile(a, null)); });
    }
    if (!unlocked.length && !locked.length) grid.appendChild(h('p', { class: 'muted small', text: 'Hier gibt es noch nichts.' }));
    box.appendChild(grid);

    if (canCollapse) {
      box.appendChild(h('button', {
        class: 'btn btn--ghost btn--block prof-ach-more', type: 'button',
        onclick: function () {
          showAllLocked = !showAllLocked;
          buildAchievements(box);
          if (!showAllLocked && box.scrollIntoView) { try { box.scrollIntoView({ block: 'start' }); } catch (e) { /* alt */ } }
        }
      }, h('span', { html: icon(showAllLocked ? 'up' : 'down') }),
        showAllLocked ? 'Weniger zeigen' : 'Alle ' + hidden + ' weiteren zeigen'));
    }
  }

  /** Vorschau: reihum je Kategorie das naechste gesperrte Achievement (bunte Mischung statt nur "Kampf") */
  function previewLocked(locked, limit) {
    var byCat = {}, order = [], out = [];
    locked.forEach(function (a) {
      var c = achCat(a);
      if (!byCat[c]) { byCat[c] = []; order.push(c); }
      byCat[c].push(a);
    });
    for (var round = 0; out.length < limit; round++) {
      var added = false;
      for (var i = 0; i < order.length && out.length < limit; i++) {
        var a = byCat[order[i]][round];
        if (a) { out.push(a); added = true; }
      }
      if (!added) break;
    }
    // in Daten-Reihenfolge anzeigen
    return locked.filter(function (a) { return out.indexOf(a) >= 0; });
  }

  /** Vorschau-Menge so, dass volle Reihen entstehen (158 = Mindestbreite einer Kachel in profil.css, 8 = Abstand) */
  function previewCount(box) {
    var w = box.clientWidth || 0;
    var cols = Math.max(1, Math.floor((w + 8) / (158 + 8)));
    return cols * Math.max(1, Math.ceil(LOCKED_PREVIEW / cols));
  }

  function achTile(a, ts) {
    var has = !!ts;
    return h('div', { class: 'prof-ach ' + (has ? 'is-got' : 'is-locked') },
      h('span', { class: 'prof-ach__medal', html: icon(a.icon || 'trophy') },
        has ? null : h('span', { class: 'prof-ach__lock', html: icon('lock') })),
      h('span', { class: 'prof-ach__name', text: a.name || a.id }),
      h('span', { class: 'prof-ach__desc', text: a.desc || '' }),
      h('span', { class: 'prof-ach__date' },
        h('span', { html: icon(has ? 'star' : 'lock') }),
        has ? achDate(ts) : 'Noch gesperrt'));
  }

  /* ---------- Bildschirm ---------- */

  OP.screens.register('haus/profil', {
    title: 'Profil', icon: 'profil',
    mount: function (el) {
      var bag = OP.ui.cleanup();
      var holo = null;

      // Grundgeruest einmal bauen – das Hologramm bleibt beim Neuzeichnen stehen
      var heroBox = h('div', { class: 'prof-slot' });
      var holoEl = h('div', { class: 'prof-holo', role: 'img', 'aria-label': 'Hologramm deines Körpers in Rang-Farben' });
      var ranksBox = h('div', { class: 'prof-slot' });
      var statsBox = h('div', { class: 'prof-slot' });
      var achBox = h('section', { class: 'prof-ach-box', 'aria-label': 'Achievements' });

      var root = h('div', { class: 'screen__inner prof' },
        heroBox,
        h('div', { class: 'prof-body' },
          h('section', { class: 'card prof-holo-card', 'aria-label': 'Hologramm' },
            h('div', { class: 'prof-holo-card__label' }, h('span', { html: icon('body') }), 'Rang-Scan'),
            holoEl,
            h('p', { class: 'prof-holo-card__hint tiny faint', text: 'Jede Muskelgruppe leuchtet in ihrer Rang-Farbe.' })),
          h('section', { class: 'prof-ranks-box', 'aria-label': 'Muskel-Ränge' },
            OP.ui.sectionTitle('Muskel-Ränge', 'rank', h('span', { class: 'tiny faint', text: 'Tippen für alle Ränge' })),
            ranksBox)),
        h('section', { 'aria-label': 'Statistiken' },
          OP.ui.sectionTitle('Statistiken', 'bolt'),
          statsBox),
        achBox,
        h('div', { class: 'prof-links' },
          h('button', { class: 'btn btn--violet btn--lg', type: 'button', onclick: function () { OP.ui.go('zauberbude'); } },
            h('span', { html: icon('zauberbude') }), 'Einstellungen (Zauberbude)'),
          h('button', { class: 'btn btn--ghost btn--lg', type: 'button', onclick: function () { OP.ui.go('hilfe'); } },
            h('span', { html: icon('hilfe') }), 'Hilfe'))
      );
      el.innerHTML = '';
      el.appendChild(root);

      function getHolo() { return holo; }
      function refitName() { fitName(heroBox.querySelector('.prof-hero__name')); }

      function render() {
        var rows = null;
        try { rows = OP.game.profileRows(); } catch (e) { console.error('[profil] profileRows', e); rows = []; }

        heroBox.innerHTML = '';
        heroBox.appendChild(safe('Profil', buildHero));
        refitName();

        ranksBox.innerHTML = '';
        ranksBox.appendChild(safe('Muskel-Ränge', function () { return buildRanks(rows, getHolo); }));

        statsBox.innerHTML = '';
        statsBox.appendChild(safe('Statistiken', buildStats));

        try { buildAchievements(achBox); }
        catch (e) { console.error('[profil] Achievements', e); achBox.innerHTML = ''; achBox.appendChild(errorNote('Achievements')); }

        // Hologramm: beim ersten Mal erzeugen, danach nur die Farben aktualisieren
        if (rows.length) {
          if (!holo) holo = createHolo(holoEl, rows);
          else if (typeof holo.update === 'function') {
            try { holo.update({ colors: rankColors(rows) }); } catch (e) { console.error('[profil] holo.update', e); }
          }
        }
      }

      render();
      bag.on('change', function () { render(); });
      // Name neu anpassen, wenn die Schrift fertig geladen ist oder das Handy gedreht wird
      if (document.fonts && document.fonts.ready) document.fonts.ready.then(refitName, function () {});
      window.addEventListener('resize', refitName);
      bag.add(function () { window.removeEventListener('resize', refitName); });
      bag.add(function () {
        if (holo && typeof holo.destroy === 'function') { try { holo.destroy(); } catch (e) { console.error(e); } }
        holo = null;
      });
      return bag.run;
    }
  });
})();
