/* Operator – Profil (Haus → Profil): der Charakterbogen des Labs Runners.
   Zeigt Gesamtstaerke, Runner-Rang, Streak, Hologramm-Koerper in Rang-Farben,
   Muskel-Raenge nach Push / Pull / Bauch / Beine, Kalorienschulden (simuliertes Gewicht),
   Statistiken und Achievements.
   Aendert nichts am Spielstand – ausser dem Namen (ueber OP.game.setPlayer). */
(function () {
  'use strict';
  var OP = (window.OP = window.OP || {});
  var U = OP.util, h = OP.h, D = OP.data;
  var NB = '\u00a0';   // geschuetztes Leerzeichen zwischen Zahl und Einheit

  /* ---------- Einstellungen / feste Texte ---------- */

  var AVATAR_SRC = 'assets/sprites/avatar.png';
  var BAUCH_COLOR = '#b48cff';   // Farbe des Bauch-Abschnitts (Push/Pull/Beine haben ihre Farbe in OP.data.GROUPS)

  // Achievement-Kategorien: Anzeige-Namen und Reihenfolge der Filter-Chips (unbekannte kommen vor "Sonstiges")
  var ACH_NAMES = {
    kampf: 'Kampf', arena: 'Arena', gym: 'Gym', bauch: 'Bauch', zirkus: 'Zirkus', kardio: 'Kardio',
    ausdauer: 'Ausdauer', lauf: 'Laufen', quests: 'Quests', streak: 'Streak', kalorien: 'Kalorien', staerke: 'Stärke'
  };
  var ACH_ORDER = ['kampf', 'arena', 'gym', 'bauch', 'zirkus', 'kardio', 'ausdauer', 'lauf', 'quests', 'streak', 'kalorien', 'staerke'];

  // bleibt erhalten, wenn man den Tab wechselt und zurueckkommt
  var achFilter = 'alle';
  var showAllLocked = false;   // bei "Alle": alle gesperrten zeigen oder nur eine Vorschau
  var LOCKED_PREVIEW = 6;

  var NUM_WORDS = ['null', 'eins', 'zwei', 'drei', 'vier', 'fünf', 'sechs', 'sieben', 'acht', 'neun', 'zehn', 'elf', 'zwölf'];

  /* ---------- kleine Helfer ---------- */

  function icon(name) { return OP.ui.icon(name); }
  function num(v) { v = Number(v); return isFinite(v) ? v : 0; }
  function stats() { return (OP.state && OP.state.stats) || {}; }
  function days(n) { n = num(n); return n === 1 ? '1 Tag' : U.fmt(n) + ' Tage'; }
  function word(n) { return NUM_WORDS[n] || String(n); }

  /** Sekunden immer als reine Sekunden ("90 s", nie "1:30 min") */
  function secsText(s) { return U.fmt(Math.floor(num(s) + 1e-9)) + NB + 's'; }
  /** Minuten mit zwei Nachkommastellen ("8,59 Min.") */
  function minText(m) { return U.fmt2(num(m)) + NB + 'Min.'; }
  /** Kilo mit zwei Nachkommastellen ("125,00 kg") */
  function kgText(kg) { return U.fmt2(num(kg)) + NB + 'kg'; }

  /** Wert mit Einheit: XP, Sekunden (Bauch) oder Gesamtstaerke (ohne Einheit) */
  function unitText(v, unit) {
    if (unit === 's') return secsText(v);
    if (unit === 'gs') return U.fmt(v);
    return U.fmt(v) + NB + 'XP';
  }
  /** "2.400 XP" bzw. "Plank-Bestzeit 45 s" */
  function valueText(row) {
    if (row.unit === 's') return row.value > 0 ? 'Plank-Bestzeit ' + secsText(row.value) : 'Noch keine Plank-Zeit';
    // knapp unter einer Schwelle abrunden (2.799,6 soll nicht als "2.800" neben "noch 1 XP bis Gold" stehen)
    var v = num(row.value), r = row.rank;
    if (r && r.nextMin != null && Math.round(v) >= r.nextMin) v = Math.floor(v);
    return U.fmt(v) + NB + 'XP';
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

  /** Tastatur-Bedienung fuer Elemente mit role="button" */
  function onKeyActivate(fn) {
    return function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn(); } };
  }

  /** Farbe/Icon/Hinweis eines Profil-Abschnitts (Push, Pull, Bauch, Beine) */
  function sectionMeta(sec) {
    var g = D.group ? D.group(sec.id) : null;
    if (g) return { id: sec.id, name: g.name, icon: g.icon || sec.icon, color: g.color, hint: g.hint || '', group: g };
    // \u2011 = Bindestrich ohne Zeilenumbruch ("Sit-/ups" soll nicht getrennt werden)
    return { id: sec.id, name: sec.name, icon: sec.icon, color: BAUCH_COLOR, hint: 'Zirkus-Tanz: Planks, Crunches, Sit\u2011ups', group: null };
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
      Schrift so weit verkleinern, dass es passt (höchstens bis 14 px). Braucht das Element im DOM. */
  function fitName(n) {
    if (!n) return;
    n.style.fontSize = '';
    var cw = n.clientWidth, sw = n.scrollWidth;
    if (!cw || sw <= cw) return;
    var px = parseFloat(getComputedStyle(n).fontSize) || 27;
    n.style.fontSize = Math.max(14, Math.floor(px * (cw - 1) / sw * 10) / 10) + 'px';
  }

  function buildHero() {
    var s = OP.state, g = OP.game;
    var player = s.player || {};
    var runner = g.runnerRank();          // Schwellen und toNext in Gesamtstaerke
    var total = g.totalStrength();
    var streak = g.streakInfo();
    var nMuscles = (D.MUSCLE_IDS && D.MUSCLE_IDS.length) || 6;

    // Dossier-Nummer aus dem Erstelldatum (nur Deko)
    var created = num(s.created) || Date.now();
    var dossierId = 'OP-' + created.toString(36).toUpperCase().slice(-5);
    var since = U.dayLabel(U.dayKey(created));

    // "noch 3.600 Gesamtstärke bis Gold" – direkt aus runnerRank() (keine Umrechnung mehr)
    var runnerNext = 'Höchster Rang erreicht', runnerSub = 'Tippen für alle Ränge';
    if (runner.next) {
      runnerNext = 'noch ' + U.fmt(Math.max(1, Math.ceil(num(runner.toNext)))) + ' Gesamtstärke bis ' + runner.next.name;
      runnerSub = runner.next.name + ' ab ' + U.fmt(runner.nextMin) + ' · Tippen für alle Ränge';
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
          h('button', { class: 'prof-hero__rank', type: 'button', 'aria-label': 'Runner-Rang ' + runner.rank.name + '. Alle Runner-Ränge anzeigen',
            onclick: openRunnerModal },
            OP.ui.rankBadge(runner.rank),
            h('span', { class: 'prof-hero__ranklbl', text: 'Runner-Rang' })),
          h('div', { class: 'prof-hero__meta' },
            h('span', { text: 'Seit ' + since + ' im Einsatz' }),
            player.bodyweight ? h('span', { text: U.fmt1(player.bodyweight).replace(',0', '') + NB + 'kg' }) : null))),

      // Gesamtstaerke
      h('div', { class: 'prof-power' },
        h('div', { class: 'prof-power__label', text: 'Gesamtstärke' }),
        h('div', { class: 'prof-power__value num' }, h('span', { html: icon('staerke') }), h('span', { text: U.fmt(total) })),
        h('div', { class: 'prof-power__hint', text: 'alle ' + word(nMuscles) + ' XP-Werte zusammen' }),
        h('div', { class: 'prof-power__runner', role: 'button', tabindex: '0', style: { '--rank-color': (runner.next || runner.rank).color },
          'aria-label': runnerNext + '. Alle Runner-Ränge anzeigen', onclick: openRunnerModal, onkeydown: onKeyActivate(openRunnerModal) },
          OP.ui.progress(num(runner.progress) * 100, { thin: true, tone: 'gold' }),
          h('span', { class: 'prof-power__next' },
            h('span', { class: 'prof-power__togo', text: runnerNext }),
            h('span', { class: 'prof-power__per', text: runnerSub })))),

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

  /* ---------- Hologramm-Koerper (7 Gruppen: brust, trizeps, schultern, ruecken, bizeps, bauch, beine) ---------- */

  function holoGroups() { return (OP.holo && Array.isArray(OP.holo.GROUPS)) ? OP.holo.GROUPS : []; }
  /** Aeltere Hologramm-Version kennt nur "arme" statt Bizeps/Trizeps */
  function holoLegacy() { var g = holoGroups(); return g.indexOf('arme') >= 0 && g.indexOf('bizeps') < 0; }

  function rankColors(rows) {
    var c = {}, byId = {};
    rows.forEach(function (r) { c[r.id] = r.rank.rank.color; byId[r.id] = r; });
    if (holoLegacy() && byId.bizeps && byId.trizeps) {
      // Arme = der schwaechere Rang von Bizeps und Trizeps
      c.arme = (byId.bizeps.rank.index <= byId.trizeps.rank.index ? byId.bizeps : byId.trizeps).rank.rank.color;
    }
    return c;
  }
  function holoPart(id) { return holoLegacy() && (id === 'bizeps' || id === 'trizeps') ? 'arme' : id; }

  /** Einfacher 2D-Koerper (nur falls OP.holo fehlt): Vorderansicht, Ruecken und Trizeps als Schatten dahinter */
  function fallbackBody(container, colors) {
    function col(id) { return colors[id] || '#3ee6d0'; }
    function part(id, d) {
      return '<path class="prof-fb__part" data-group="' + id + '" d="' + d + '" style="--c:' + col(id) + '"/>';
    }
    var svg =
      '<svg class="prof-fb" viewBox="0 0 200 340" aria-hidden="true">' +
      // hinten: Ruecken (Latissimus hinter dem Oberkoerper) und Trizeps (hinter den Oberarmen)
      part('ruecken', 'M60 66 L140 66 L156 112 L132 172 L68 172 L44 112 Z') +
      part('trizeps', 'M40 84 Q54 81 60 90 L54 148 L35 148 Z') +
      part('trizeps', 'M160 84 Q146 81 140 90 L146 148 L165 148 Z') +
      // Kopf + Hals + Unterarme (neutral)
      '<circle class="prof-fb__head" cx="100" cy="30" r="17"/>' +
      '<path class="prof-fb__head" d="M92 46 L108 46 L110 58 L90 58 Z"/>' +
      '<path class="prof-fb__head" d="M42 152 L56 152 L50 206 L36 204 Z"/>' +
      '<path class="prof-fb__head" d="M158 152 L144 152 L150 206 L164 204 Z"/>' +
      // Schultern
      part('schultern', 'M50 64 Q64 54 80 62 L76 84 Q60 88 48 82 Z') +
      part('schultern', 'M150 64 Q136 54 120 62 L124 84 Q140 88 152 82 Z') +
      // Brust
      part('brust', 'M99 62 L81 63 Q74 84 80 104 Q92 108 99 104 Z') +
      part('brust', 'M101 62 L119 63 Q126 84 120 104 Q108 108 101 104 Z') +
      // Bizeps (vorne am Oberarm)
      part('bizeps', 'M48 88 Q58 91 62 93 L57 145 L45 145 Z') +
      part('bizeps', 'M152 88 Q142 91 138 93 L143 145 L155 145 Z') +
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

  function pulseHolo(holo, id) {
    if (holo && typeof holo.pulse === 'function') { try { holo.pulse(holoPart(id)); } catch (e) { /* egal */ } }
  }

  /* ---------- Rang-Leiter (Dialog) ---------- */

  /** Leiter: Legende oben, Holz unten. th = 8 Schwellen, cur = Index des aktuellen Rangs */
  function buildLadder(th, cur, unit, toNext) {
    var ranks = D.RANKS || [];
    var ladder = h('ol', { class: 'prof-ladder' });
    for (var i = ranks.length - 1; i >= 0; i--) {
      var rk = ranks[i], state = i < cur ? 'done' : (i === cur ? 'current' : 'locked');
      var extra = null;
      if (state === 'current') extra = h('span', { class: 'chip chip--gold prof-ladder__tag', text: 'Dein Rang' });
      else if (state === 'done') extra = h('span', { class: 'prof-ladder__ok', html: icon('check'), 'aria-label': 'geschafft' });
      else if (i === cur + 1) extra = h('span', { class: 'prof-ladder__togo small', text: 'noch ' + unitText(Math.max(1, Math.ceil(num(toNext))), unit) });
      ladder.appendChild(h('li', { class: 'prof-ladder__step is-' + state, style: { '--rank-color': rk.color } },
        h('span', { class: 'prof-ladder__gem' }),
        h('span', { class: 'prof-ladder__name', text: rk.name }),
        h('span', { class: 'prof-ladder__min num', text: 'ab ' + unitText(num(th[i]), unit) }),
        h('span', { class: 'prof-ladder__extra' }, extra)));
    }
    return ladder;
  }

  function modalHead(iconName, color, value, text) {
    return h('div', { class: 'prof-modal__head', style: { '--rank-color': color } },
      h('span', { class: 'prof-modal__ico', html: icon(iconName) }),
      h('div', null,
        h('div', { class: 'prof-modal__val num', text: value }),
        h('div', { class: 'small muted', text: text })));
  }

  function openRankModal(row, holo) {
    var isAbs = row.id === 'bauch';
    var th = isAbs ? (D.ABS_RANK_SECONDS || []) : OP.game.thresholds(row.id);   // Schwellen je Muskel
    var cur = row.rank ? row.rank.index : 0;
    var m = D.muscle(row.id) || { name: row.name, icon: row.id };
    var grp = !isAbs && D.groupOf ? D.group(D.groupOf(row.id)) : null;
    var overrides = OP.state.settings && OP.state.settings.rankOverrides;
    var custom = !isAbs && overrides && Array.isArray(overrides[row.id]);

    var body = h('div', { class: 'stack' },
      modalHead(m.icon || row.id, row.rank.rank.color, valueText(row), isAbs
        ? 'Der Bauch-Rang richtet sich nach deiner besten Plank-Zeit.'
        : 'Der Rang richtet sich nach deinem aktuellen XP-Wert' + (grp ? ' (Gruppe ' + grp.name + ').' : '.')),
      buildLadder(th, cur, row.unit, row.rank.toNext),
      h('p', { class: 'tiny faint', text: isAbs
        ? 'Neue Bestzeit? Trag sie beim Zirkus-Tanz in der Taverne ein.'
        : (custom ? 'Eigene Schwellen – eingestellt in der Zauberbude.' : 'Jeder Muskel hat eigene Schwellen. Anpassen kannst du sie in der Zauberbude.') }));

    pulseHolo(holo, row.id);

    var action;
    if (isAbs) {
      action = { label: 'Zum Zirkus', kind: 'primary', icon: 'zirkus', onClick: function () { OP.ui.go('taverne/zirkus'); } };
    } else {
      // Gym trainiert immer eine ganze Gruppe (Push, Pull oder Beine). Gesperrt? Der Router zeigt den Hinweis.
      var route = 'haus/gym' + (grp ? '/' + grp.id : '');
      var locked = !!(OP.ui.router.blocked && OP.ui.router.blocked(route));
      action = { label: grp ? 'Ins Gym (' + grp.name + ')' : 'Ins Gym', kind: 'primary', icon: locked ? 'lock' : 'gym',
        onClick: function () { OP.ui.go(route); } };
    }

    OP.ui.modal({
      title: row.name + ' – Ränge',
      body: body,
      actions: [{ label: 'Schließen', kind: 'ghost' }, action]
    });
  }

  /** Runner-Rang: Stufen in Gesamtstaerke (Summe der Muskel-Schwellen je Rang) */
  function openRunnerModal() {
    var g = OP.game, runner = g.runnerRank();
    var th = runner.thresholds || (g.runnerThresholds ? g.runnerThresholds() : []);
    var n = (D.MUSCLE_IDS && D.MUSCLE_IDS.length) || 6;
    var body = h('div', { class: 'stack' },
      modalHead('staerke', runner.rank.color, U.fmt(g.totalStrength()) + ' Gesamtstärke',
        'Der Runner-Rang richtet sich nach deiner Gesamtstärke: alle ' + word(n) + ' XP-Werte zusammen.'),
      buildLadder(th, runner.index, 'gs', runner.toNext),
      h('p', { class: 'tiny faint', text: 'Jede Stufe ist die Summe der Muskel-Schwellen. Je höher dein Runner-Rang, desto stärkere Gegner triffst du.' }));
    OP.ui.modal({ title: 'Runner-Rang', body: body, actions: [{ label: 'Schließen', kind: 'ghost' }] });
  }

  /* ---------- Muskel-Raenge nach Abschnitten ---------- */

  function buildRankRow(row, getHolo) {
    var m = D.muscle(row.id) || { name: row.name, icon: row.id };
    var r = row.rank;
    function open() { openRankModal(row, getHolo()); }
    return h('div', {
      class: 'prof-rank', role: 'button', tabindex: '0', style: { '--rank-color': r.rank.color },
      'aria-label': row.name + ': ' + r.rank.name + ', ' + valueText(row) + '. Alle Ränge anzeigen',
      onclick: open, onkeydown: onKeyActivate(open)
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

  /** Heute schon etwas im Zirkus eingetragen? (Nach der Einrichtung gilt der Tag nur als Schonfrist.) */
  function dancedToday() {
    var d = OP.state && OP.state.days ? OP.state.days[U.today()] : null;
    return !!(d && num(d.abs) > 0);
  }

  /** Zirkus-Status als Chip im Kopf des Bauch-Abschnitts */
  function circusChip(li) {
    if (!li || !li.lastDay) return null;
    if (li.locked) return h('span', { class: 'chip prof-chip-warn' }, h('span', { html: icon('lock') }), 'Gesperrt');
    if (dancedToday()) return h('span', { class: 'chip chip--ok' }, h('span', { html: icon('check') }), 'Heute getanzt');
    if (li.warn) return h('span', { class: 'chip prof-chip-warn' }, h('span', { html: icon('warning') }), 'Heute tanzen');
    if (li.days === 0) return h('span', { class: 'chip chip--muted' }, h('span', { html: icon('unlock') }), 'Alles offen');
    return h('span', { class: 'chip chip--muted', text: 'vor ' + days(li.days) });
  }

  /** Kompakte Liste der 5 Zirkus-Uebungen: verlangter Wert (abgerundet) und Bestwert */
  function buildDance() {
    var ds = OP.game.danceStatus(), li = OP.game.lockInfo();
    var list = h('div', { class: 'prof-dance__list', role: 'table', 'aria-label': 'Zirkus-Übungen' },
      h('div', { class: 'prof-dance__row prof-dance__row--head', role: 'row' },
        h('span', { class: 'prof-dance__name', role: 'columnheader', text: 'Übung' }),
        h('span', { class: 'prof-dance__goal', role: 'columnheader', text: 'Ziel' }),
        h('span', { class: 'prof-dance__best', role: 'columnheader', text: 'Bestwert' })));

    ds.list.forEach(function (it) {
      var ex = it.ex, unit = ex.unit === 's' ? 's' : 'Wdh.';
      var e = it.entry, state = e ? (e.skipped ? 'skip' : (e.success ? 'ok' : 'fail')) : '';
      var mark = null;
      if (state === 'ok') mark = h('span', { class: 'prof-dance__mark is-ok', html: icon('check'), title: 'Heute geschafft' });
      else if (state === 'fail') mark = h('span', { class: 'prof-dance__mark is-fail', html: icon('close'), title: 'Heute nicht geschafft' });
      else if (state === 'skip') mark = h('span', { class: 'prof-dance__mark is-skip', html: icon('minus'), title: 'Heute ausgelassen' });
      list.appendChild(h('div', { class: 'prof-dance__row' + (state ? ' is-' + state : ''), role: 'row' },
        h('span', { class: 'prof-dance__name', role: 'cell' },
          mark,
          h('span', { class: 'prof-dance__long', text: ex.name }),
          h('span', { class: 'prof-dance__short', text: ex.short || ex.name })),
        h('span', { class: 'prof-dance__goal num', role: 'cell', text: U.fmt(it.shown) + NB + unit }),
        h('span', { class: 'prof-dance__best num' + (it.best > 0 ? '' : ' is-none'), role: 'cell',
          text: it.best > 0 ? U.fmt(it.best) + NB + unit : '–' })));
    });

    // Status: laufender Tanz, Sperre oder Warnung
    var note = null;
    if (ds.active) {
      note = h('p', { class: 'prof-dance__note is-live' }, h('span', { html: icon('zirkus') }),
        'Tanz läuft: ' + ds.doneCount + ' von ' + ds.total + ' eingetragen.');
    } else if (li.locked) {
      note = h('p', { class: 'prof-dance__note is-warn' }, h('span', { html: icon('lock') }),
        'Arena, Gym, Abenteuer und Schmuggler sind gesperrt. Ein Eintrag im Zirkus öffnet alles wieder.');
    } else if (li.warn) {
      note = h('p', { class: 'prof-dance__note is-warn' }, h('span', { html: icon('warning') }),
        'Tanz heute noch – sonst sind morgen Arena, Gym, Abenteuer und Schmuggler gesperrt.');
    }

    return h('div', { class: 'prof-dance' },
      h('div', { class: 'prof-dance__head' },
        h('span', { class: 'prof-dance__title' }, h('span', { html: icon('zirkus') }), 'Zirkus-Tanz'),
        h('span', { class: 'prof-dance__hint', text: 'Ziel = so viel verlangt dein nächster Tanz' })),
      list,
      note,
      h('button', { class: 'btn btn--block prof-dance__btn' + (li.locked || li.warn || ds.active ? ' btn--gold' : ' btn--ghost'), type: 'button',
        onclick: function () { OP.ui.go('taverne/zirkus'); } },
        h('span', { html: icon('zirkus') }), ds.active ? 'Weiter tanzen' : 'Zum Zirkus'));
  }

  function buildSection(sec, rowsById, getHolo) {
    var meta = sectionMeta(sec);
    var right;
    if (meta.group) {
      right = h('div', { class: 'prof-sec__sum' },
        h('span', { class: 'prof-sec__sum-val num', text: U.fmt(OP.game.groupXp(meta.group.id)) }),
        h('span', { class: 'prof-sec__sum-lbl', text: 'XP gesamt' }));
    } else {
      right = circusChip(OP.game.lockInfo());
    }
    var rows = h('div', { class: 'prof-sec__rows' });
    (sec.rows || []).forEach(function (id) {
      if (rowsById[id]) rows.appendChild(buildRankRow(rowsById[id], getHolo));
    });
    if (sec.id === 'bauch') rows.appendChild(safe('Zirkus-Tanz', buildDance));

    return h('section', { class: 'prof-sec prof-sec--' + sec.id, style: { '--grp-color': meta.color }, 'aria-label': meta.name },
      h('div', { class: 'prof-sec__head' },
        h('span', { class: 'prof-sec__ico', html: icon(meta.icon) }),
        h('div', { class: 'prof-sec__titles' },
          h('h3', { class: 'prof-sec__name', text: meta.name }),
          meta.hint ? h('div', { class: 'prof-sec__hint', text: meta.hint }) : null),
        right),
      rows);
  }

  function buildRanks(rows, getHolo) {
    var byId = {};
    rows.forEach(function (r) { byId[r.id] = r; });
    var sections = D.PROFILE_SECTIONS || [{ id: 'alle', name: 'Muskeln', icon: 'body', rows: rows.map(function (r) { return r.id; }) }];
    var wrap = h('div', { class: 'prof-ranks' });
    sections.forEach(function (sec) { wrap.appendChild(safe(sec.name || 'Abschnitt', function () { return buildSection(sec, byId, getHolo); })); });
    return wrap;
  }

  /* ---------- Kalorienschulden: simuliertes Gewicht ---------- */

  /** Karte mit simuliertem Gewicht (nur mit Kalorien-Ziel). Tippen = zu den Kalorien. */
  function buildKcal() {
    var k = OP.game.kcalStatus();
    if (!k || !k.hasGoal) return null;
    function go() { OP.ui.go('haus/kalorien'); }
    var kgPaid = num(k.kgPaid);
    var delta = kgPaid > 0.004 ? '−' + kgText(kgPaid) + ' seit Start'
      : (kgPaid < -0.004 ? '+' + kgText(-kgPaid) + ' seit Start' : 'Noch unverändert');
    var pct = num(k.pctPaid);

    return h('section', { class: 'prof-kcal-box', 'aria-label': 'Kalorienschulden' },
      OP.ui.sectionTitle('Kalorienschulden', 'kcal', h('span', { class: 'tiny faint', text: 'Tippen = Kalorien öffnen' })),
      h('div', { class: 'card card--click prof-kcal' + (k.done ? ' is-done' : ''), role: 'button', tabindex: '0',
        'aria-label': 'Simuliertes Gewicht ' + kgText(k.simWeight) + '. Kalorien öffnen', onclick: go, onkeydown: onKeyActivate(go) },
        h('div', { class: 'prof-kcal__main' },
          h('div', { class: 'prof-kcal__label' }, h('span', { html: icon('scale') }), 'Simuliertes Gewicht'),
          h('div', { class: 'prof-kcal__value num', text: kgText(k.simWeight) }),
          h('div', { class: 'prof-kcal__delta', text: delta })),
        h('div', { class: 'prof-kcal__side' },
          h('div', { class: 'prof-kcal__path' },
            h('span', { class: 'prof-kcal__pt' }, h('small', { text: 'Start' }), h('b', { class: 'num', text: kgText(k.startWeight) })),
            h('span', { class: 'prof-kcal__arrow', html: icon('next') }),
            h('span', { class: 'prof-kcal__pt prof-kcal__pt--goal' }, h('small', { text: 'Ziel' }), h('b', { class: 'num', text: kgText(k.targetWeight) }))),
          OP.ui.progress(pct, { tone: k.done ? 'ok' : 'kcal', label: U.pct(pct) + ' bezahlt' }),
          h('div', { class: 'prof-kcal__rest' },
            k.done
              ? h('span', { class: 'tone-ok', text: 'Alle Schulden bezahlt – ICH BIN GESUND!' })
              : h('span', null, 'Noch offen: ', h('b', { class: 'num', text: U.fmt(k.remaining) + NB + 'kcal' })))),
        h('p', { class: 'prof-kcal__why' },
          h('span', { html: icon('info') }),
          h('span', { text: 'So viel wiegst du laut deinem Defizit. Wiegst du dich jeden Tag? Vergleiche deinen Wochen-Schnitt damit. ' +
            'Liegt er deutlich höher, ist dein Defizit kleiner als gedacht.' }))));
  }

  /* ---------- Statistiken ---------- */

  function isZero(v) { return v === '–' || /^0( |\u00a0|$)/.test(String(v)); }

  /** Statistik-Kachel wie OP.ui.stat, aber mit kleiner Einheit, Zusatzzeile und optionaler Gruppen-Farbe.
      o: {v, unit, l, icon, tone, sub, color} */
  function tile(o) {
    var tone = o.tone && !isZero(o.v) ? o.tone : null;   // eine rote 0 wirkt wie ein Fehler
    return h('div', { class: 'stat prof-stat' + (tone ? ' tone-' + tone : '') + (o.color ? ' prof-stat--grp' : ''),
      style: o.color ? { '--grp-color': o.color } : null },
      o.icon ? h('span', { class: 'stat__icon', html: icon(o.icon) }) : null,
      h('div', { class: 'stat__value num' }, String(o.v), o.unit ? ' ' : null, o.unit ? h('span', { class: 'prof-stat__unit', text: o.unit }) : null),
      h('div', { class: 'stat__label', text: o.l }),
      o.sub ? h('div', { class: 'prof-stat__sub' + (o.subWide ? ' prof-stat__sub--wide' : ''), text: o.sub }) : null);
  }

  function trainingDays() {
    var d = (OP.state && OP.state.days) || {}, n = 0;
    Object.keys(d).forEach(function (k) { if (d[k] && (num(d[k].train) > 0 || num(d[k].sets) > 0)) n++; });
    return n;
  }

  function buildStats() {
    var s = stats(), g = OP.game, streak = g.streakInfo();
    var enemyCount = (D.ENEMIES && D.ENEMIES.length) || 100;
    var distinct = 0, ed = s.enemiesDefeated || {};
    var known = D.ENEMIES && D.ENEMIES.length && typeof g.enemy === 'function';
    Object.keys(ed).forEach(function (k) {
      if (num(ed[k]) > 0 && (!known || g.enemy(k))) distinct++;   // nur echte Gegner zaehlen
    });
    var gw = s.groupWins || {};
    var run = g.runStatus ? g.runStatus() : null;

    var groups = [
      { title: 'Kampf', icon: 'swords', items: [
        { v: U.fmt(s.fightsTotal), l: 'Kämpfe gesamt', icon: 'swords', sub: num(s.fightsLost) ? U.fmt(s.fightsLost) + ' verloren' : null },
        { v: U.fmt(s.fightsWon), l: 'Siege', icon: 'trophy', tone: 'ok' },
        { v: U.fmt(s.arenaWins), l: 'Arena-Siege', icon: 'crown', tone: 'gold', sub: 'von ' + U.fmt(s.arenaFights) + ' Arena-Kämpfen' },
        { v: U.fmt(s.insaneWins), l: 'Insane-Siege', icon: 'skull', tone: 'err' },
        { v: U.fmt(s.closeWins), l: 'Knappe Siege', icon: 'heart', tone: 'warn', sub: 'mit höchstens 10' + NB + '% HP übrig' },
        { v: U.fmt(s.flawlessWins), l: 'Makellose Siege', icon: 'shield', tone: 'ok', sub: 'ohne getroffen zu werden' },
        { v: U.fmt(s.critsDealt), l: 'Kritische Treffer', icon: 'bolt', tone: 'gold', sub: 'von dir ausgeteilt' },
        { v: U.fmt(s.critsTaken), l: 'Kritisch getroffen', icon: 'warning', tone: 'err', sub: 'vom Monster kassiert' },
        { v: distinct + ' / ' + enemyCount, l: 'Verschiedene Gegner', icon: 'target' }
      ] },
      { title: 'Siege je Gruppe', icon: 'trophy', cls: 'prof-stats__grid--3', items: (D.GROUPS || []).map(function (gr) {
        var names = (gr.muscles || []).map(function (id) { var m = D.muscle(id); return m ? m.name : id; }).join(' · ');
        return { v: U.fmt(gw[gr.id]), l: gr.name, icon: gr.icon, color: gr.color, sub: names, subWide: true };
      }) },
      { title: 'Gym', icon: 'gym', items: [
        { v: U.fmt(s.gymSessions), l: 'Gym-Einheiten', icon: 'gym' },
        { v: U.fmt(s.gymWins), l: 'Ganz geschafft', icon: 'check', tone: 'ok', sub: 'alle Muskeln der Gruppe' },
        { v: U.fmt(s.gymPartWins), l: 'Muskel-Ziele', icon: 'target', tone: 'ok', sub: '+1' + NB + '% erreicht' },
        { v: U.fmt(s.setsLogged), l: 'Sätze', icon: 'flag' },
        { v: U.fmt(s.totalDamage), l: 'Bewegtes Gewicht', icon: 'bolt', tone: 'cyan', sub: 'kg × Wiederholungen' }
      ] },
      { title: 'Zirkus-Tänze', icon: 'zirkus', items: [
        { v: U.fmt(s.dances), l: 'Tänze', icon: 'zirkus' },
        { v: U.fmt(s.perfectDances), l: 'Perfekte Tänze', icon: 'star', tone: 'gold', sub: 'alle 5 Übungen geschafft' },
        { v: U.fmt(s.absWins), l: 'Übungen geschafft', icon: 'check', tone: 'ok', sub: 'von ' + U.fmt(s.absAttempts) + ' Versuchen' }
      ] },
      { title: 'Ausdauer', icon: 'run', items: run ? [
        { v: run.steady.target > 0 ? U.fmt2(run.steady.target) : '–', unit: run.steady.target > 0 ? 'Min.' : null,
          l: 'Joggen am Stück', icon: 'run', tone: 'cyan',
          sub: run.steady.best > 0 ? 'Bestwert ' + minText(run.steady.best) : 'Noch kein Lauf' },
        { v: run.total.record > 0 ? U.fmt2(run.total.record) : '–', unit: run.total.record > 0 ? 'Min.' : null,
          l: 'Laufzeit-Rekord', icon: 'timer', tone: 'cyan',
          sub: run.total.goal > 0 ? 'Nächstes Ziel ' + minText(run.total.goal) : 'Noch kein Lauf' },
        { v: U.fmt(num(run.steady.runs) + num(run.total.runs)), l: 'Läufe', icon: 'steps',
          sub: 'davon ' + U.fmt(num(run.steady.wins) + num(run.total.wins)) + ' geschafft' },
        { v: U.fmt(s.cardioWins), l: 'Schmuggler geschafft', icon: 'schmuggler', tone: 'ok',
          sub: num(s.cardioFails) ? U.fmt(s.cardioFails) + ' verloren' : null }
      ] : [
        { v: U.fmt(s.cardioWins), l: 'Schmuggler geschafft', icon: 'schmuggler', tone: 'ok' }
      ] },
      { title: 'Alltag', icon: 'quest', items: [
        { v: U.fmt(s.questsDone), l: 'Quests erledigt', icon: 'quest' },
        { v: U.fmt(trainingDays()), l: 'Trainingstage', icon: 'calendar' },
        { v: days(streak.longest), l: 'Längster Streak', icon: 'crown', tone: 'gold' },
        { v: U.fmt(s.kcalPaid), l: 'kcal abbezahlt', icon: 'kcal', sub: 'alle Defizite zusammen' }
      ] }
    ];

    var wrap = h('div', { class: 'prof-stats' });
    groups.forEach(function (gr) {
      if (!gr.items.length) return;
      var grid = h('div', { class: 'prof-stats__grid' + (gr.cls ? ' ' + gr.cls : '') });
      gr.items.forEach(function (it) { grid.appendChild(tile(it)); });
      wrap.appendChild(h('div', { class: 'prof-stats__group' },
        h('h3', { class: 'prof-stats__title' }, h('span', { html: icon(gr.icon) }), gr.title),
        grid));
    });
    return wrap;
  }

  /* ---------- Achievements ---------- */

  function achList() {
    var list = D.ACHIEVEMENTS;
    if (!Array.isArray(list)) return [];
    return list.filter(function (a) { return a && a.id; });
  }
  function achCat(a) { return a && a.cat ? String(a.cat) : 'sonstiges'; }
  function achCatName(id) {
    if (id === 'alle') return 'Alle';
    if (id === 'sonstiges') return 'Sonstiges';
    return ACH_NAMES[id] || (id.charAt(0).toUpperCase() + id.slice(1));
  }
  /** Filter-Chips: feste Reihenfolge, unbekannte Kategorien davor, "Sonstiges" am Ende */
  function achCats(list) {
    var seen = {}, out = ['alle'];
    list.forEach(function (a) { seen[achCat(a)] = 1; });
    ACH_ORDER.forEach(function (id) { if (seen[id]) out.push(id); });
    Object.keys(seen).forEach(function (id) { if (ACH_ORDER.indexOf(id) < 0 && id !== 'sonstiges') out.push(id); });
    if (seen.sonstiges) out.push('sonstiges');
    return out;
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
    var cats = achCats(list), counts = {};
    cats.forEach(function (c) { counts[c] = { all: 0, got: 0 }; });
    list.forEach(function (a) {
      var c = achCat(a), has = !!got[a.id];
      counts[c].all++; counts.alle.all++;
      if (has) { counts[c].got++; counts.alle.got++; }
    });
    if (!counts[achFilter] || !counts[achFilter].all) achFilter = 'alle';

    var chips = h('div', { class: 'prof-ach-filter', role: 'tablist', 'aria-label': 'Achievements filtern' });
    cats.forEach(function (c) {
      var on = c === achFilter;
      chips.appendChild(h('button', {
        class: 'chip chip--btn prof-ach-chip' + (on ? ' is-on' : ''), type: 'button', role: 'tab', 'aria-selected': on ? 'true' : 'false',
        onclick: function () { achFilter = c; buildAchievements(box); }
      }, achCatName(c), h('span', { class: 'prof-ach-chip__n num', text: counts[c].got + '/' + counts[c].all })));
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
      var kcalBox = h('div', { class: 'prof-slot' });
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
        kcalBox,
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

        kcalBox.innerHTML = '';
        var kc = safe('Kalorienschulden', buildKcal);
        if (kc) kcalBox.appendChild(kc);

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
