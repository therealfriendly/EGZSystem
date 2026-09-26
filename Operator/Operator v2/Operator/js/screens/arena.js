/* Operator – Arena (Bildschirm 'arena')
   Harte Kämpfe (Hard + Insane) für Tage, an denen du dich gut fühlst.
   Zeigt den Arena-Meister, einen laufenden Kampf, die Arena-Statistik und die 3 Arena-Angebote.
   "Kämpfen" startet den Kampf und öffnet #/kampf, "Ablehnen" würfelt ein neues Angebot
   (OP.game.skipInfo: 1× pro Tag gratis, gilt für Taverne und Arena zusammen). */
(function () {
  'use strict';
  const OP = window.OP;
  const U = OP.util, h = OP.h, D = OP.data;

  /* Optionales Porträt: assets/sprites/npc-arena.png (fehlt es, bleibt das Icon im Rahmen) */
  const NPC_SPRITE = 'assets/sprites/npc-arena.png';
  let npcSprite = null;          // null = noch nicht geprüft, sonst true/false
  const npcWaiting = [];

  function probeNpcSprite(cb) {
    if (npcSprite !== null) { cb(npcSprite); return; }
    npcWaiting.push(cb);
    if (npcWaiting.length > 1) return;   // Prüfung läuft schon
    const img = new Image();
    const done = (ok) => {
      npcSprite = ok;
      npcWaiting.splice(0).forEach((f) => { try { f(ok); } catch (e) { /* egal */ } });
    };
    img.onload = () => done(img.naturalWidth > 0);
    img.onerror = () => done(false);
    img.src = NPC_SPRITE;
  }

  /** Icon als <span> */
  function ico(name, cls) {
    return h('span', { class: 'arena-i' + (cls ? ' ' + cls : ''), html: OP.ui.icon(name) });
  }

  /* Anzeige-Rundung wie im Kampf: Rest-HP auf-, Schaden abrunden (nie "0 HP", solange der Gegner lebt) */
  function fmtLeft(n) { return U.fmt(Math.ceil(n - 1e-9)); }
  function fmtDmg(n) { return U.fmt(Math.floor(n + 1e-9)); }

  /** Prozent-Spanne einer Schwierigkeit aus den Daten: "+3–4 %", "+5 %" */
  function pctRange(d) {
    const f = (n) => U.fmt1(n).replace(',0', '');
    return '+' + (d.min === d.max ? f(d.min) : f(d.min) + '–' + f(d.max)) + ' %';
  }

  /** Ablehnen-Regel (1× pro Tag gratis, gilt für Taverne und Arena zusammen) -> {free, used, left} */
  function skipInfo() {
    try {
      const s = OP.game.skipInfo();
      if (s && isFinite(s.left)) return s;
    } catch (e) { console.error('[arena] skipInfo', e); }
    return { free: 0, used: 0, left: 0 };
  }

  /** Gefahren-Anzeige: 5 Balken, gefüllt nach Schwierigkeit (Hard 4, Insane 5) */
  function threat(diffId) {
    let n = 1;
    D.DIFFICULTIES.forEach((d, i) => { if (d.id === diffId) n = i + 1; });
    const segs = [];
    for (let i = 0; i < 5; i++) segs.push(h('i', { class: 'arena-threat__seg' + (i < n ? ' is-on' : '') }));
    return h('span', { class: 'arena-threat', title: 'Gefahr ' + n + ' von 5' },
      h('span', { class: 'arena-threat__label', text: 'Gefahr' }), segs);
  }

  /* Änderungen, bei denen sich die Anzeige ändern kann */
  const RELEVANT = ['offers', 'reroll', 'fight-start', 'fight-set', 'fight-end', 'fight-cancel', 'gym-end',
    'edit-xp', 'thresholds', 'import', 'reset', 'setup', 'new-day', 'retention', 'player', 'achievement'];

  OP.screens.register('arena', {
    title: 'Arena', icon: 'arena', tone: 'red',
    mount: function (el) {
      const bag = OP.ui.cleanup();
      let ensuring = false;       // verhindert Schleifen: ensureOffers speichert und meldet 'change'
      let seenIds = null;         // Angebots-IDs der letzten Anzeige (für die "neu"-Animation)
      let alive = true;
      bag.add(() => { alive = false; });

      function safeEnsure() {
        if (ensuring) return;
        ensuring = true;
        try { OP.game.ensureOffers(); } catch (e) { console.error('[arena] ensureOffers', e); }
        ensuring = false;
      }

      /* ---------- Aktionen ---------- */

      function fight(offer) {
        const r = OP.game.startFight('arena', offer.id);
        if (!r || !r.ok) {
          OP.ui.toast((r && r.error) || 'Der Kampf konnte nicht starten.', { type: 'warn' });
          return;
        }
        OP.ui.haptic([25, 40, 25]);
        OP.ui.go('kampf');
      }

      function decline(offer) {
        if (skipInfo().left <= 0) {
          OP.ui.toast('Heute schon abgelehnt – morgen wieder.', { type: 'warn', icon: 'lock' });
          render();
          return;
        }
        const n = OP.game.rerollOffer('arena', offer.id);
        if (!n) {
          OP.ui.toast(skipInfo().left <= 0 ? 'Heute schon abgelehnt – morgen wieder.' : 'Dieser Kampf kann gerade nicht getauscht werden.', { type: 'warn' });
          return;
        }
        OP.ui.haptic(10);
        OP.ui.toast('Ein neuer Herausforderer betritt die Arena.' + (skipInfo().left <= 0 ? ' Ablehnen geht morgen wieder.' : ''),
          { type: 'info', icon: 'refresh' });
      }

      /* ---------- Teile ---------- */

      /** Kopf: Arena-Meister im Rahmen + Spruch */
      function hero() {
        const badgeInner = h('div', { class: 'arena-npc__inner' });
        const setIcon = () => { badgeInner.innerHTML = OP.ui.icon('arena'); };
        const setImg = () => {
          badgeInner.innerHTML = '';
          badgeInner.classList.add('arena-npc__inner--img');
          badgeInner.appendChild(h('img', { src: NPC_SPRITE, alt: '' }));
        };
        if (npcSprite === true) setImg(); else setIcon();
        if (npcSprite === null) probeNpcSprite((ok) => { if (ok && alive) setImg(); });

        return h('section', { class: 'card card--danger arena-hero' },
          h('div', { class: 'arena-hero__deco', 'aria-hidden': 'true' }),
          h('div', { class: 'arena-hero__stripes', 'aria-hidden': 'true' }),
          h('div', { class: 'arena-npc', 'aria-hidden': 'true' },
            h('div', { class: 'arena-npc__frame' }), badgeInner,
            h('div', { class: 'arena-npc__plate', text: 'Meister' })),
          h('div', { class: 'arena-hero__text' },
            h('div', { class: 'arena-hero__kicker', text: 'Arena-Meister' }),
            h('p', { class: 'arena-hero__quote', text: '„Die Arena ist für Tage, an denen du dich gut fühlst.“' }),
            h('p', { class: 'arena-hero__sub', text: 'Harte Gegner – meist Menschen, manchmal starke Fabelwesen.' }),
            h('div', { class: 'arena-hero__chips' },
              // Schwierigkeiten der Arena mit ihren Prozenten (aus OP.data.DIFFICULTIES)
              D.DIFFICULTIES.filter((d) => d.pool === 'arena').map((d) =>
                h('span', { class: 'chip chip--diff', style: { '--chip-color': d.color || 'var(--red)' } },
                  d.id === 'insane' ? ico('skull') : null, d.name + ' ' + pctRange(d))))));
      }

      /** Laufender Kampf (egal ob aus Arena oder Taverne) */
      function liveBanner(fs) {
        const enemy = fs.enemy || { name: 'Unbekannter Gegner' };
        const muscle = fs.muscle || { name: '?', icon: 'body' };
        const fromArena = fs.fight.pool === 'arena';
        const n = fs.fight.sets.length;
        return h('section', { class: 'card card--danger arena-live', role: 'status' },
          h('div', { class: 'arena-live__top' },
            h('span', { class: 'arena-live__dot', 'aria-hidden': 'true' }),
            h('span', { class: 'arena-live__kicker', text: fromArena ? 'Arena-Kampf läuft' : 'Kampf aus der Taverne läuft' }),
            fs.diff ? OP.ui.diffChip(fs.diff) : null),
          h('div', { class: 'arena-live__name', text: enemy.name }),
          h('div', { class: 'arena-live__meta' }, ico(muscle.icon),
            h('span', { text: muscle.name + ' · ' + n + (n === 1 ? ' Satz' : ' Sätze') + ' · ' + fmtDmg(fs.total) + ' Schaden' })),
          liveBar(fs),
          h('button', { class: 'btn btn--danger btn--lg arena-live__btn', type: 'button', onclick: () => OP.ui.go('kampf') },
            ico('swords'), 'Weiter kämpfen'));
      }

      function liveBar(fs) {
        const bar = OP.ui.progress(fs.hpPct * 100, { tone: 'hp', label: (fs.defeated ? 'Besiegt · ' : '') + fmtLeft(fs.hpLeft) + ' / ' + U.fmt(fs.hp) + ' HP' });
        bar.classList.add('bar--lg', 'arena-live__bar');
        return bar;
      }

      /** Arena-Statistik */
      function statsRow() {
        const st = OP.state.stats || {};
        return h('div', { class: 'arena-stats' },
          OP.ui.stat(U.fmt(st.arenaFights || 0), 'Arena-Kämpfe', { icon: 'arena' }),
          OP.ui.stat(U.fmt(st.arenaWins || 0), 'Siege', { icon: 'trophy', tone: 'gold' }),
          OP.ui.stat(U.fmt(st.insaneWins || 0), 'Insane-Siege', { icon: 'skull', tone: 'err' }));
      }

      /** Eine Angebots-Karte (Hard oder Insane) */
      function offerCard(offer, index, running, isNew, canSkip) {
        let d;
        try { d = OP.game.describeOffer(offer); } catch (e) { return null; }
        if (!d || !d.muscle || !d.diff) return null;
        const insane = offer.diff === 'insane';
        const mine = !!(running && running.offerId === offer.id);   // dieser Kampf läuft gerade
        const blocked = !!(running && !mine);

        let actions;
        if (mine) {
          actions = h('div', { class: 'arena-offer__actions arena-offer__actions--one' },
            h('button', { class: 'btn btn--danger btn--block', type: 'button', onclick: () => OP.ui.go('kampf') },
              ico('swords'), 'Weiter kämpfen'));
        } else {
          actions = h('div', { class: 'arena-offer__actions' },
            h('button', { class: 'btn btn--danger arena-offer__fight', type: 'button', disabled: blocked,
              onclick: () => fight(offer) }, ico('swords'), 'Kämpfen'),
            h('button', { class: 'btn btn--ghost arena-offer__skip', type: 'button', disabled: !canSkip,
              title: canSkip ? 'Kampf ablehnen und neuen Gegner ziehen' : 'Heute schon abgelehnt – morgen wieder',
              'aria-label': canSkip ? 'Kampf ablehnen und neuen Gegner ziehen' : 'Ablehnen: heute schon benutzt, morgen wieder',
              onclick: () => decline(offer) }, ico(canSkip ? 'refresh' : 'lock'), 'Ablehnen'));
        }

        return h('article', {
          class: 'card card--danger arena-offer' + (insane ? ' arena-offer--insane' : '') +
            (mine ? ' arena-offer--active' : '') + (isNew ? ' arena-offer--new' : ''),
          style: { '--diff': d.diff.color || 'var(--red)' }
        },
          insane ? h('span', { class: 'arena-offer__skull', 'aria-hidden': 'true', html: OP.ui.icon('skull') }) : null,
          h('div', { class: 'arena-offer__head' },
            h('span', { class: 'arena-offer__slot' },
              ico(insane ? 'skull' : 'swords'), h('span', { text: 'Kampf ' + (index + 1) })),
            threat(offer.diff)),
          h('h3', { class: 'arena-offer__title', text: d.title }),
          h('div', { class: 'arena-offer__chips' },
            h('span', { class: 'chip arena-chip-muscle' }, ico(d.muscle.icon), d.muscle.name),
            OP.ui.diffChip(d.diff),
            h('span', { class: 'chip arena-chip-pct num' }, '+' + U.fmt1(offer.pct) + ' %')),
          h('div', { class: 'arena-offer__foe', title: 'Gegner und HP siehst du erst im Kampf' },
            h('span', { class: 'arena-offer__foe-icon', 'aria-hidden': 'true', html: OP.ui.icon('ghost') }),
            h('span', { class: 'arena-offer__foe-text' }, 'Gegner: ', h('b', { text: '???' })),
            mine ? h('span', { class: 'chip chip--err arena-offer__live' }, ico('swords'), 'Läuft') : null),
          actions,
          blocked ? h('p', { class: 'arena-offer__hint' }, ico('lock'), h('span', { text: 'Erst den laufenden Kampf beenden.' })) : null);
      }

      /** Hinweis zur Ablehnen-Regel über den Angeboten */
      function skipLine(skip) {
        let text;
        if (skip.left > 0) {
          text = 'Ablehnen: ' + skip.free + '× pro Tag gratis' +
            (skip.free > 1 ? ', heute noch ' + skip.left + '×' : '') + ' (Taverne und Arena zusammen).';
        } else {
          text = skip.free > 0 ? 'Heute schon abgelehnt – morgen wieder.' : 'Ablehnen geht gerade nicht.';
        }
        return h('p', { class: 'arena-skip' + (skip.left > 0 ? '' : ' is-used') },
          ico(skip.left > 0 ? 'refresh' : 'lock'), h('span', { text: text }));
      }

      /* ---------- Aufbau ---------- */

      function render() {
        const s = OP.state;
        const offers = (s.offers && s.offers.arena) || [];
        let fs = null;
        try { fs = OP.game.fightStatus(); } catch (e) { fs = null; }
        const running = fs ? fs.fight : null;
        const skip = skipInfo();

        const cards = [], ids = {};
        offers.forEach((o, i) => {
          if (!o) return;
          ids[o.id] = true;
          const c = offerCard(o, i, running, !!(seenIds && !seenIds[o.id]), skip.left > 0);
          if (c) cards.push(c);
        });
        seenIds = ids;

        const inner = h('div', { class: 'screen__inner arena' },
          hero(),
          fs ? liveBanner(fs) : null,
          statsRow(),
          OP.ui.sectionTitle('Herausforderer', 'swords', h('span', { class: 'chip chip--err', text: cards.length + ' warten' })),
          cards.length ? skipLine(skip) : null,
          cards.length
            ? h('div', { class: 'arena-offers' }, cards)
            : h('div', { class: 'empty' }, h('div', { class: 'empty__icon', html: OP.ui.icon('arena') }),
                h('p', { text: 'Gerade keine Herausforderer. Schau gleich noch mal vorbei.' })),
          h('div', { class: 'arena-rules' },
            h('p', {}, ico('trophy', 'tone-gold'), h('span', { text: 'Sieg: Dein ganzer Schaden wird dein neuer XP-Wert.' })),
            h('p', {}, ico('shield'), h('span', { text: 'Niederlage: Alles bleibt, wie es war.' }))));

        const top = el.scrollTop;
        el.innerHTML = '';
        el.appendChild(inner);
        el.scrollTop = top;
      }

      safeEnsure();
      render();

      bag.on('change', (e) => {
        if (ensuring || !alive) return;
        const reason = (e && e.reason) || '';
        if (RELEVANT.indexOf(reason) < 0) return;
        if (reason === 'fight-end' || reason === 'import' || reason === 'reset' || reason === 'new-day' || reason === 'setup') safeEnsure();
        render();
      });
      return bag.run;
    }
  });
})();
