/* Operator – Taverne, Tab "Abenteuer" (Screen 'taverne/abenteuer')
   Die Abenteuer-Händlerin zeigt 4 Kampf-Aufträge. Jeder Auftrag gilt einer Trainings-Gruppe
   (Push, Pull oder Beine). Annehmen startet den Kampf (#/kampf).
   Die Schwierigkeit steht nur als Name da – die Prozente laufen intern und werden nie angezeigt.

   Außerdem stehen hier kleine gemeinsame Bausteine für alle drei Taverne-Tabs (OP.tav):
   Händler-Kopf mit Porträt, Eingaben beim Neuzeichnen behalten, Icon-Helfer, Gruppen-Chip, Sperr-Karte.
   schmuggler.js und zirkus.js werden danach geladen und benutzen OP.tav. */
(function () {
  'use strict';
  var OP = window.OP;
  var U = OP.util, h = OP.h, D = OP.data;

  /* ================= Gemeinsame Bausteine (OP.tav) ================= */

  /** Icon als <span> (für Chips, Knöpfe, Abzeichen) */
  function ico(name, cls) {
    return h('span', { class: 'tav-i' + (cls ? ' ' + cls : ''), html: OP.ui.icon(name) });
  }

  /* Porträt-Bilder (optional): assets/sprites/npc-<id>.png
     Wird einmal pro Sitzung geprüft. Fehlt das Bild, bleibt das Icon im Rahmen. */
  var spriteState = {};   // src -> 'ok' | 'fail' | [wartende Callbacks]
  function probeSprite(src, cb) {
    var st = spriteState[src];
    if (st === 'ok' || st === 'fail') { cb(st === 'ok'); return; }
    if (Array.isArray(st)) { st.push(cb); return; }
    spriteState[src] = [cb];
    function done(ok) {
      var list = spriteState[src];
      spriteState[src] = ok ? 'ok' : 'fail';
      if (Array.isArray(list)) list.forEach(function (f) { try { f(ok); } catch (e) { /* egal */ } });
    }
    var img = new Image();
    img.onload = function () { done(img.naturalWidth > 0); };
    img.onerror = function () { done(false); };
    img.src = src;
  }

  /** Händler-Kopf: Porträt im Rahmen + Rolle + Name + Begrüßung.
      npc: {id, name, role, icon}, say: Text */
  function merchant(npc, say) {
    var portrait = h('div', { class: 'tav-portrait', 'aria-hidden': 'true' },
      h('div', { class: 'tav-portrait__icon', html: OP.ui.icon(npc.icon || 'taverne') }));
    var src = 'assets/sprites/npc-' + npc.id + '.png';
    probeSprite(src, function (ok) {
      if (!ok) return;
      portrait.innerHTML = '';
      portrait.classList.add('tav-portrait--img');
      portrait.appendChild(h('img', { src: src, alt: '' }));
    });
    return h('section', { class: 'card card--gold tav-card tav-merchant' },
      portrait,
      h('div', { class: 'tav-merchant__text' },
        h('div', { class: 'tav-merchant__role', text: npc.role }),
        h('div', { class: 'tav-merchant__name', text: npc.name }),
        h('p', { class: 'tav-merchant__say', text: say || '' })));
  }

  /** Begrüßung aussuchen. seed (0..1) bleibt pro Besuch gleich, damit der Text nicht springt.
      {name} wird durch den Spielernamen ersetzt (als Text eingesetzt, nie als HTML). */
  function greet(lines, seed) {
    if (!lines || !lines.length) return '';
    var line = lines[Math.floor((seed || 0) * lines.length) % lines.length];
    var name = (OP.state && OP.state.player && OP.state.player.name) || 'Runner';
    return String(line).replace(/\{name\}/g, name);
  }

  /** Inhalt neu bauen, ohne getippte Eingaben zu verlieren.
      Eingaben mit data-keep="<schlüssel>" behalten Wert, Fokus und Cursor. Scroll-Position bleibt. */
  function keepInputs(root, build) {
    var vals = {}, focusKey = null, selA = null, selB = null;
    root.querySelectorAll('[data-keep]').forEach(function (inp) { vals[inp.getAttribute('data-keep')] = inp.value; });
    var ae = document.activeElement;
    if (ae && root.contains(ae) && ae.getAttribute && ae.getAttribute('data-keep')) {
      focusKey = ae.getAttribute('data-keep');
      try { selA = ae.selectionStart; selB = ae.selectionEnd; } catch (e) { /* egal */ }
    }
    var top = root.scrollTop;
    build();
    root.querySelectorAll('[data-keep]').forEach(function (inp) {
      var k = inp.getAttribute('data-keep');
      if (Object.prototype.hasOwnProperty.call(vals, k)) {
        inp.value = vals[k];
        try { inp.dispatchEvent(new Event('input')); } catch (e) { /* alt */ }   // Live-Anzeigen mitziehen
      }
      if (k === focusKey) {
        try { inp.focus({ preventScroll: true }); } catch (e) { inp.focus(); }
        try { if (selA != null) inp.setSelectionRange(selA, selB); } catch (e) { /* egal */ }
      }
    });
    root.scrollTop = top;
  }

  /** Kleine Info-Zeile mit Icon */
  function infoLine(text, iconName, cls) {
    return h('p', { class: 'tav-info' + (cls ? ' ' + cls : '') }, ico(iconName || 'info'), h('span', { text: text }));
  }

  /** Chip einer Trainings-Gruppe (Push / Pull / Beine) in ihrer Farbe.
      Gemeinsamer Stil .chip--group (base.css), damit Taverne, Arena und Kampf gleich aussehen. */
  function groupChip(g) {
    if (!g) return null;
    return h('span', { class: 'chip chip--group', style: g.color ? { '--g': g.color } : null,
      html: OP.ui.icon(g.icon || 'body') + '<span>' + U.esc(g.name) + '</span>' });
  }

  /** "Brust · Trizeps · Schultern" */
  function muscleNames(g) {
    if (!g || !g.muscles) return '';
    return g.muscles.map(function (id) { var m = D.muscle(id); return m ? m.name : id; }).join(' · ');
  }

  /** Namen der Bereiche, die die Zirkus-Sperre sperrt: "Arena, Gym, Abenteuer und Schmuggler" */
  var AREA_NAMES = { arena: 'Arena', gym: 'Gym', abenteuer: 'Abenteuer', schmuggler: 'Schmuggler' };
  function lockedAreas() {
    return (D.LOCKED_AREAS || ['arena', 'gym', 'abenteuer', 'schmuggler']).map(function (id) {
      return { id: id, name: AREA_NAMES[id] || id, icon: id };
    });
  }
  function joinAnd(list) {
    if (list.length < 2) return list.join('');
    return list.slice(0, -1).join(', ') + ' und ' + list[list.length - 1];
  }
  function lockedAreaText() { return joinAnd(lockedAreas().map(function (a) { return a.name; })); }

  /** Sperr-Karte (Zirkus-Sperre) mit Knopf zum Zirkus. text = zweite Zeile (optional) */
  function lockCard(text) {
    var li = null;
    try { li = OP.game.lockInfo(); } catch (e) { li = null; }
    return h('section', { class: 'card tav-card tav-lock', role: 'alert' },
      h('span', { class: 'tav-lock__icon' }, ico('lock')),
      h('div', { class: 'tav-lock__text' },
        h('b', { text: (li && li.text) || D.LOCK_TEXT || 'Gesperrt: Erledige zuerst deinen Zirkus-Tanz.' }),
        h('span', { text: text || 'Ein einziger Eintrag im Zirkus entsperrt alles wieder – das Ziel musst du nicht schaffen.' })),
      h('button', { class: 'btn btn--gold tav-lock__btn', type: 'button', onclick: function () { OP.ui.go('taverne/zirkus'); } },
        ico('zirkus'), 'Zum Zirkus'));
  }

  function isLocked(area) {
    try { return !!OP.game.isLocked(area); } catch (e) { return false; }
  }

  OP.tav = {
    ico: ico, merchant: merchant, greet: greet, keepInputs: keepInputs, infoLine: infoLine, probeSprite: probeSprite,
    groupChip: groupChip, muscleNames: muscleNames, lockCard: lockCard, lockedAreas: lockedAreas,
    lockedAreaText: lockedAreaText, joinAnd: joinAnd, isLocked: isLocked
  };

  /* ================= Abenteuer-Händlerin ================= */

  var NPC = { id: 'abenteuer', name: 'Quartiermeisterin Vex', role: 'Abenteuer-Händlerin', icon: 'abenteuer' };
  var LINES = [
    'Frische Aufträge, {name}. Push, Pull oder Beine – such dir einen aus.',
    'Die Gegner werden nicht von allein schwächer. Du aber schon, wenn du nur rumsitzt.',
    'Jeder Sieg macht dich stärker. Jede Niederlage auch. Also los.',
    'Loss Always Builds Strength. Welcher Auftrag darf es sein?',
    'Ich hab da ein paar Leute, die Ärger machen. Kümmerst du dich?'
  ];
  var LINES_FIGHT = [
    'Dein Gegner wartet noch auf dich. Bring es zu Ende, {name}.',
    'Erst den laufenden Kampf beenden. Dann reden wir weiter.'
  ];
  var LINES_LOCKED = [
    'Ohne Zirkus-Tanz keine Aufträge, {name}. Madame Rune wartet schon.',
    'Erst tanzen, dann kämpfen. So sind die Regeln hier.'
  ];

  // Änderungen, bei denen sich die Anzeige ändern kann (alles andere ignorieren wir)
  var RELEVANT = ['offers', 'reroll', 'fight-start', 'fight-set', 'fight-end', 'fight-cancel', 'gym-end',
    'edit-xp', 'thresholds', 'import', 'reset', 'setup', 'new-day', 'retention', 'player', 'sync',
    'abs', 'dance-start', 'dance-skip', 'dance-end'];

  /** Chancen (0..1) als ganze Prozente, die zusammen genau 100 ergeben (größte Reste bekommen die fehlenden Prozente) */
  function wholePercents(ids, probs) {
    var out = {}, rest = [], sum = 0, raw = 0;
    ids.forEach(function (id, i) {
      var v = (Number(probs[id]) || 0) * 100;
      raw += v;
      out[id] = Math.floor(v + 1e-9);
      sum += out[id];
      rest.push({ id: id, r: v - out[id], i: i });
    });
    if (raw < 99.5) return out;   // keine gültigen Chancen: einfach abrunden
    rest.sort(function (a, b) { return Math.abs(b.r - a.r) > 1e-9 ? b.r - a.r : a.i - b.i; });
    for (var k = 0; sum < 100 && k < rest.length; k++) { out[rest[k].id]++; sum++; }
    return out;
  }
  OP.tav.wholePercents = wholePercents;

  OP.screens.register('taverne/abenteuer', {
    title: 'Abenteuer', icon: 'abenteuer', tone: 'gold',
    mount: function (el) {
      var bag = OP.ui.cleanup();
      var alive = true;
      var seed = Math.random();
      var seenIds = null;     // Angebots-IDs der letzten Anzeige (für die "neu"-Animation)
      var busy = false;

      function safeEnsure() {
        if (busy) return;
        busy = true;
        try { OP.game.ensureOffers(); } catch (e) { console.error('[taverne] ensureOffers', e); }
        busy = false;
      }

      function accept(offer) {
        if (isLocked('abenteuer')) { OP.ui.lockHint(D.LOCK_TEXT); render(); return; }
        var r = OP.game.startFight('abenteuer', offer.id);
        if (!r || !r.ok) {
          if (r && r.locked) { OP.ui.lockHint(r.error || D.LOCK_TEXT); render(); return; }
          OP.ui.toast((r && r.error) || 'Der Kampf konnte nicht starten.', { type: 'warn' });
          return;
        }
        OP.ui.haptic([20, 30, 20]);
        OP.ui.go('kampf');
      }

      /** Skip-Regel: wie oft darf heute noch gratis abgelehnt werden? {free, used, left} */
      function skipState() {
        try { return OP.game.skipInfo(); } catch (e) { return { free: D.FREE_SKIPS_PER_DAY || 1, used: 0, left: 0 }; }
      }

      function reroll(offer) {
        var n = OP.game.rerollOffer('abenteuer', offer.id);
        if (!n) {
          // Sperre über den Hinweis des Routers (verschwindet beim Entsperren sofort), sonst ein kurzer Toast
          if (isLocked('abenteuer')) OP.ui.lockHint(D.LOCK_TEXT);
          else OP.ui.toast(skipState().left <= 0 ? 'Heute schon abgelehnt – morgen wieder.' : 'Dieser Auftrag kann gerade nicht getauscht werden.', { type: 'warn' });
          render();
          return;
        }
        OP.ui.haptic(10);
      }

      /* ---------- Teile ---------- */

      function fightBanner(fs) {
        var enemy = fs.enemy || { name: 'Unbekannter Gegner' };
        var arena = fs.fight.pool === 'arena';
        // "Brust · Trizeps · Schultern" neben dem Chip – nicht bei Beine (Chip "Beine" + "Beine" wäre doppelt)
        var names = muscleNames(fs.group);
        if (fs.group && names === fs.group.name) names = '';
        return h('section', { class: 'card card--danger tav-fight' },
          h('div', { class: 'tav-fight__top' },
            h('span', { class: 'tav-fight__pulse', 'aria-hidden': 'true' }),
            h('span', { class: 'tav-fight__kicker', text: arena ? 'Arena-Kampf läuft' : 'Kampf läuft' }),
            fs.diff ? OP.ui.diffChip(fs.diff) : null),
          h('div', { class: 'tav-fight__name', text: enemy.name }),
          h('div', { class: 'tav-fight__meta' },
            groupChip(fs.group),
            names ? h('span', { class: 'tav-fight__muscles', text: names }) : null,
            fs.defeated ? h('span', { class: 'chip chip--ok tav-fight__won' }, ico('check'), 'Besiegt') : null),
          OP.ui.progress(fs.hpPct * 100, { tone: 'hp', label: 'Gegner ' + U.fmt(fs.hpLeft) + ' / ' + U.fmt(fs.hp) + ' HP' }),
          fs.playerHp ? h('div', { class: 'tav-fight__you' }, ico('heart'),
            h('span', { text: 'Deine HP: ' }), h('b', { class: 'num', text: U.fmt(fs.playerHpLeft) + ' / ' + U.fmt(fs.playerHp) })) : null,
          h('button', { class: 'btn btn--danger btn--block btn--lg', type: 'button', onclick: function () { OP.ui.go('kampf'); } },
            ico('swords'), 'Weiter kämpfen'));
      }

      function offerCard(offer, index, fight, isNew, skip, locked) {
        var d;
        try { d = OP.game.describeOffer(offer); } catch (e) { return null; }
        if (!d || !d.group || !d.diff) return null;
        var mine = !!(fight && fight.offerId === offer.id);   // dieser Auftrag läuft gerade
        var blocked = !!(fight && !mine);

        var actions;
        if (mine) {
          actions = h('div', { class: 'tav-offer__actions tav-offer__actions--live' },
            h('span', { class: 'chip chip--err' }, ico('swords'), 'Läuft gerade'),
            h('button', { class: 'btn tav-offer__resume', type: 'button', onclick: function () { OP.ui.go('kampf'); } }, ico('next'), 'Weiter kämpfen'));
        } else {
          // Ablehnen: nur so oft wie heute noch gratis (Zahl im Knopf), sonst gesperrt
          var canSkip = skip.left > 0 && !locked;
          var skipLabel = locked ? D.LOCK_TEXT
            : canSkip ? 'Auftrag ablehnen und neuen ziehen. Heute noch ' + skip.left + '× gratis.'
            : 'Heute schon abgelehnt – morgen wieder.';
          actions = h('div', { class: 'tav-offer__actions' },
            h('button', { class: 'btn btn--ghost btn--sm tav-offer__skip', type: 'button', disabled: !canSkip,
              'aria-label': skipLabel, title: skipLabel,
              onclick: function () { reroll(offer); } },
              ico(canSkip ? 'refresh' : 'lock'), 'Ablehnen',
              canSkip ? h('span', { class: 'tav-offer__skip-n num', 'aria-hidden': 'true', text: skip.left + '×' }) : null),
            h('button', { class: 'btn btn--gold tav-offer__accept', type: 'button', disabled: blocked || locked,
              onclick: function () { accept(offer); } }, ico(locked ? 'lock' : 'sword'), 'Annehmen'));
        }

        return h('article', {
          class: 'card card--gold tav-card tav-offer' + (mine ? ' tav-offer--active' : '') + (isNew ? ' tav-offer--new' : ''),
          style: { '--d': d.diff.color || 'var(--gold)', '--g': d.group.color || 'var(--gold)' }
        },
          h('span', { class: 'tav-offer__stripe', 'aria-hidden': 'true' }),
          h('div', { class: 'tav-offer__kicker' },
            ico('scroll'), h('span', { text: 'Auftrag ' + (index + 1) }),
            h('span', { class: 'tav-offer__tier', 'aria-hidden': 'true' }, diffPips(d.diff.id))),
          h('h3', { class: 'tav-offer__title', text: d.title }),
          h('div', { class: 'tav-offer__chips' },
            groupChip(d.group),
            OP.ui.diffChip(d.diff),
            h('span', { class: 'chip chip--muted tav-chip-enemy', title: 'Gegner und HP siehst du erst im Kampf' }, ico('skull'), 'Gegner: ???')),
          // Muskel-Zeile nur bei Gruppen mit mehreren Muskeln (bei "Beine" sagt der Chip schon alles)
          d.group.muscles.length > 1 ? h('div', { class: 'tav-offer__muscles' }, ico('target'),
            h('span', { class: 'tav-offer__muscles-label', text: 'Muskeln:' }),
            h('span', { text: muscleNames(d.group) })) : null,
          actions,
          blocked ? h('p', { class: 'tav-offer__hint' }, ico('lock'), 'Erst den laufenden Kampf beenden.') : null);
      }

      /* Kleine Punkte für die Stufe (1–3 im Abenteuer) */
      function diffPips(diffId) {
        var n = { sehr_einfach: 1, easy: 2, medium: 3, hard: 4, insane: 5 }[diffId] || 1;
        var max = n > 3 ? 5 : 3, out = [];
        for (var i = 0; i < max; i++) out.push(h('i', { class: i < n ? 'is-on' : '' }));
        return out;
      }

      /** Gruppen-Chancen: Push / Pull / Beine mit Balken und ganzen Prozenten (Summe 100) */
      function chancesCard() {
        var ch = {}, counts = {};
        try { ch = OP.game.groupChances(); counts = OP.game.recentCounts(); } catch (e) { /* egal */ }
        var pcts = wholePercents(D.GROUP_IDS, ch);
        var rows = D.GROUPS.map(function (g) {
          var pct = pcts[g.id] || 0, n = counts[g.id] || 0;
          return h('li', { class: 'tav-chance', style: { '--g': g.color || 'var(--gold)' } },
            h('span', { class: 'tav-chance__icon' }, ico(g.icon || 'body')),
            h('span', { class: 'tav-chance__name' },
              h('b', { text: g.name }),
              h('small', { text: n === 1 ? '1 Training' : U.fmt(n) + ' Trainings' })),
            h('span', { class: 'tav-chance__bar' }, OP.ui.progress(pct, { thin: true })),
            h('span', { class: 'tav-chance__pct num', text: pct + ' %' }));
        });
        return h('section', { class: 'card card--gold tav-card tav-chances' },
          h('div', { class: 'card__title' }, ico('dice'), 'Gruppen-Chancen'),
          h('ul', { class: 'tav-chances__list' }, rows),
          h('p', { class: 'tav-chances__note' },
            h('b', { text: 'Was du oft trainierst, kommt seltener.' }),
            ' Gezählt werden Gym und Kämpfe der letzten ' + D.MUSCLE_CHANCE_DAYS + ' Tage. So kommen Push, Pull und Beine alle dran.'));
      }

      function arenaCard() {
        var lockedArena = !!OP.ui.router.blocked('arena');
        function go() { OP.ui.go('arena'); }   // gesperrt? Dann zeigt der Router den Hinweis
        return h('section', {
          class: 'card card--danger card--click tav-arena' + (lockedArena ? ' is-locked' : ''), role: 'button', tabindex: '0',
          'aria-label': lockedArena ? 'Arena (gesperrt)' : 'Zur Arena',
          onclick: go, onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } }
        },
          h('span', { class: 'tav-arena__badge' }, ico('arena'), lockedArena ? h('span', { class: 'tav-arena__lock' }, ico('lock')) : null),
          h('span', { class: 'tav-arena__text' },
            h('b', { text: 'Heute stark?' }),
            h('span', { text: lockedArena ? 'Die Arena ist gesperrt, bis du im Zirkus getanzt hast.' : 'Hard- und Insane-Kämpfe in der Arena' })),
          h('span', { class: 'tav-arena__go' }, ico(lockedArena ? 'lock' : 'next')));
      }

      /* ---------- Aufbau ---------- */

      function build() {
        var s = OP.state;
        var offers = (s.offers && s.offers.abenteuer) || [];
        var fs = null;
        try { fs = OP.game.fightStatus(); } catch (e) { fs = null; }
        var fight = fs ? fs.fight : null;
        var skip = skipState();
        var locked = isLocked('abenteuer');

        var cards = [], ids = {};
        offers.forEach(function (o, i) {
          if (!o) return;
          ids[o.id] = true;
          var isNew = !!(seenIds && !seenIds[o.id]);
          var c = offerCard(o, i, fight, isNew, skip, locked);
          if (c) cards.push(c);
        });
        seenIds = ids;

        // Skip-Regel kurz erklären (gilt für Taverne und Arena zusammen)
        var skipLine = skip.left > 0
          ? infoLine('Ablehnen: ' + skip.free + '× pro Tag gratis (Taverne + Arena). Heute noch ' + skip.left + '× frei.', 'refresh', 'tav-skip')
          : infoLine('Heute schon abgelehnt – morgen wieder. Ablehnen: ' + skip.free + '× pro Tag gratis.', 'lock', 'tav-skip tav-skip--none');

        var inner = h('div', { class: 'screen__inner tav tav--abenteuer' },
          locked ? lockCard('Ein einziger Eintrag im Zirkus entsperrt die Aufträge wieder – das Ziel musst du nicht schaffen.') : null,
          OP.tav.merchant(NPC, greet(fight ? LINES_FIGHT : locked ? LINES_LOCKED : LINES, seed)),
          fs ? fightBanner(fs) : null,
          OP.ui.sectionTitle('Aufträge', 'scroll', h('span', { class: 'chip chip--muted', text: cards.length + ' offen' })),
          cards.length && !locked ? skipLine : null,
          cards.length ? h('div', { class: 'tav-grid tav-offers' + (locked ? ' is-locked' : '') }, cards)
            : h('div', { class: 'empty' }, h('div', { class: 'empty__icon', html: OP.ui.icon('scroll') }),
                h('p', { text: 'Gerade keine Aufträge. Schau gleich noch mal vorbei.' })),
          h('div', { class: 'tav-grid tav-side' }, chancesCard(), arenaCard()));

        el.innerHTML = '';
        el.appendChild(inner);
      }

      function render() { if (alive) keepInputs(el, build); }

      safeEnsure();
      render();

      bag.on('change', function (e) {
        if (!alive || busy) return;
        var reason = (e && e.reason) || '';
        if (RELEVANT.indexOf(reason) < 0) return;
        if (reason === 'fight-end' || reason === 'import' || reason === 'reset' || reason === 'new-day' || reason === 'setup' || reason === 'sync') safeEnsure();
        render();
      });
      bag.add(function () { alive = false; });
      return bag.run;
    }
  });
})();
