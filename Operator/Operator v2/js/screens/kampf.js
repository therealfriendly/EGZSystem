/* Operator – Kampf (Bildschirm 'kampf'), Version 2
   Ein Kampf gilt einer Trainings-Gruppe (Push, Pull oder Beine). Das Monster hat einen Balken je Muskel,
   z. B. "Brust 0 / 1.000 · Trizeps 0 / 500 · Schultern 0 / 500". Erst wenn ALLE Balken voll sind, ist es besiegt.
   Ablauf je Satz: Du triffst zuerst (Schaden = Gewicht × Wiederholungen auf den gewählten Muskel).
   Lebt das Monster danach noch, schlägt es zurück und nimmt dir HP.
   Das versteckte Satz-Limit wird NIE angezeigt – der Spieler sieht nur seine HP.
   Wichtig: Nach einem Satz wird die Eingabe NICHT neu gebaut (Fokus bleibt im Feld) –
   es werden nur die Anzeigen (Balken, Schlagabtausch, Liste, Knöpfe) aktualisiert. */
(function () {
  'use strict';
  const OP = window.OP;
  const U = OP.util, h = OP.h, D = OP.data;

  /* Anzeige-Namen für die Gegner-Art */
  const KIND_NAMES = {
    mensch: 'Mensch', untot: 'Untot', bestie: 'Bestie', troll: 'Troll',
    drache: 'Drache', maschine: 'Maschine', magie: 'Magie', mutant: 'Mutant'
  };
  /* Icon für die 2D-Ersatzanzeige, falls es (noch) kein Hologramm gibt */
  const ARCHETYPE_ICONS = {
    soldat: 'gun', scharfschuetze: 'target', schwer: 'shield', forscher: 'flask', skelett: 'skull',
    goblin: 'troll', bestie: 'wolf', spinne: 'spider', geist: 'ghost', golem: 'hammer',
    troll: 'troll', drache: 'dragon', drohne: 'drone', magier: 'potion'
  };
  /* Platzhalter, falls die Gegner-Daten fehlen */
  const UNKNOWN_ENEMY = {
    name: 'Unbekannter Gegner', adventure: 'Unbekannte Mission', kind: '', archetype: 'soldat',
    tier: 3, weapon: 'Unbekannte Waffe', color: '#ff3d57', lore: ''
  };
  /* Gewicht mit bis zu 2 Nachkommastellen: 32,25 kg / 100 kg */
  const KG_FMT = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 2 });
  const MINUS = '−';   // echtes Minuszeichen: −312

  function ico(name, cls) {
    return h('span', { class: 'kampf-i' + (cls ? ' ' + cls : ''), html: OP.ui.icon(name) });
  }
  function minus(n) { return MINUS + U.fmt(n); }
  function reducedMotion() {
    try { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); }
    catch (e) { return false; }
  }

  /** Gegner-Daten mit Platzhaltern für fehlende Felder */
  function enemyOf(st) {
    const e = (st && st.enemy) || {};
    const out = {};
    Object.keys(UNKNOWN_ENEMY).forEach((k) => {
      out[k] = (e[k] != null && e[k] !== '') ? e[k] : UNKNOWN_ENEMY[k];
    });
    out.tier = U.clamp(Math.round(Number(out.tier) || 3), 1, 5);
    if (!/^#[0-9a-f]{3,8}$/i.test(String(out.color))) out.color = UNKNOWN_ENEMY.color;
    return out;
  }

  /* Waffen-Icon nach Stichwörtern im Waffen-Text. Die Reihenfolge ist wichtig:
     "Taser-Pistole" ist Strom, "Säbelzähne" sind Zähne, "Giftbiss" ist Gift, "Ritualdolch" ist eine Klinge. */
  const WEAPON_ICONS = [
    [/schock|taser|blitz|funken/, 'bolt'],
    [/gift|säure|saeure|serum|injektor/, 'flask'],
    [/feuer|flamm|glut|lava|plasma|pulver/, 'streak'],
    [/atem|frost/, 'bolt'],
    [/zahn|zähne|zaehne|biss|klaue|kralle|hauer|stachel|schwanz/, 'wolf'],
    [/pistole|flinte|gewehr|karabiner|\bmg\b|\bmp|uzi|glock|eagle|minigun|werfer|railgun|kanone|magazin|\bak-|\bm4|\bm700|svd|\bsv-|sks|scar|\bhk\b|\bsa-|rpk|ash-|\.338/, 'gun'],
    [/dolch|messer|klinge|schwert|säbel|axt|hellebarde|lanze/, 'sword'],
    [/faust|fäuste|faeuste|schlagring/, 'staerke'],
    [/hammer|keule|hacke|stamm|brocken|greifarm/, 'hammer'],
    [/bogen|pfeil/, 'target'],
    [/ritual|zauber|fluch/, 'potion'],
    [/stab|licht|schrei|seele/, 'bolt'],
    [/akten|ordner|buch/, 'book']
  ];
  /* Passt kein Stichwort, entscheidet die Gegner-Art */
  const KIND_WEAPON_ICONS = {
    mensch: 'gun', maschine: 'gun', magie: 'bolt', drache: 'streak',
    troll: 'hammer', bestie: 'wolf', mutant: 'wolf', untot: 'sword'
  };

  function weaponIcon(enemy) {
    const text = String(enemy.weapon || '').toLowerCase();
    for (let i = 0; i < WEAPON_ICONS.length; i++) {
      if (WEAPON_ICONS[i][0].test(text)) return WEAPON_ICONS[i][1];
    }
    return KIND_WEAPON_ICONS[enemy.kind] || 'sword';
  }

  /** Stufe 1–5 als Totenköpfe */
  function tierEl(tier) {
    const pips = [];
    for (let i = 1; i <= 5; i++) {
      pips.push(h('span', { class: 'kampf-tier__pip' + (i <= tier ? ' is-on' : ''), html: OP.ui.icon('skull') }));
    }
    return h('span', { class: 'kampf-tier', title: 'Stufe ' + tier + ' von 5', 'aria-label': 'Stufe ' + tier + ' von 5' }, pips);
  }

  /** Chip der Trainings-Gruppe (Push / Pull / Beine) – gemeinsamer Stil .chip--group (wie in Taverne und Arena) */
  function groupChip(g) {
    if (!g) return null;
    return h('span', { class: 'chip chip--group', style: { '--g': g.color || 'var(--cyan)' },
      html: OP.ui.icon(g.icon || 'body') + '<span>' + U.esc(g.name) + '</span>' });
  }

  /** "Kritisch"-Abzeichen. foe = Treffer gegen dich (rot), sonst dein Treffer (gold) */
  function critBadge(foe) {
    return h('span', { class: 'kampf-crit' + (foe ? ' kampf-crit--foe' : '') }, ico('bolt'), 'Kritisch');
  }

  /** Nächster Muskel (in Gruppen-Reihenfolge), dessen Balken noch nicht voll ist */
  function nextOpen(st, fromId) {
    const n = st.parts.length;
    let start = 0;
    st.parts.forEach((p, i) => { if (p.id === fromId) start = i; });
    for (let k = 1; k <= n; k++) {
      const p = st.parts[(start + k) % n];
      if (!p.done) return p;
    }
    return null;
  }

  /* ---------- Gegner-Anzeige (Hologramm oder einfache Ersatzanzeige) ---------- */

  /** Einfache 2D-Anzeige mit derselben Schnittstelle wie OP.holo.enemy */
  function fallbackEnemy(container, opts) {
    container.classList.add('kampf-fb');
    container.style.setProperty('--enemy', opts.color || '#ff3d57');
    container.innerHTML =
      '<div class="kampf-fb__ring"></div><div class="kampf-fb__ring kampf-fb__ring--2"></div>' +
      '<div class="kampf-fb__fig">' + OP.ui.icon(ARCHETYPE_ICONS[opts.archetype] || 'skull') + '</div>';
    const fig = container.querySelector('.kampf-fb__fig');
    return {
      update: function () { /* nichts zu tun */ },
      hit: function () { fig.classList.remove('is-hit'); void fig.offsetWidth; fig.classList.add('is-hit'); },
      defeat: function () { container.classList.add('is-defeated'); },
      destroy: function () { container.innerHTML = ''; container.classList.remove('kampf-fb', 'is-defeated'); }
    };
  }

  /** Fehler im Hologramm dürfen den Kampf nie kaputt machen */
  function safeHandle(hd) {
    function call(fn, arg) {
      try { if (hd && typeof hd[fn] === 'function') hd[fn](arg); } catch (e) { console.error('[kampf] holo.' + fn, e); }
    }
    return {
      update: (o) => call('update', o),
      hit: (s) => call('hit', s),
      defeat: () => call('defeat'),
      destroy: () => call('destroy')
    };
  }

  function createEnemyView(container, enemy, hpPct) {
    const opts = { archetype: enemy.archetype, color: enemy.color, tier: enemy.tier, hpPct: hpPct };
    if (OP.holo && typeof OP.holo.enemy === 'function') {
      try {
        const hd = OP.holo.enemy(container, opts);
        if (hd) return safeHandle(hd);
      } catch (e) {
        console.error('[kampf] holo.enemy', e);
        container.innerHTML = '';
      }
    }
    return fallbackEnemy(container, opts);
  }

  /* ================= Bildschirm ================= */

  let memSel = null;   // zuletzt gewählter Muskel {sig, id} – bleibt beim Neuaufbau / Wiederkommen erhalten

  OP.screens.register('kampf', {
    title: 'Kampf', icon: 'swords', tone: 'red',
    mount: function (el) {
      const bag = OP.ui.cleanup();
      let alive = true;
      let busy = false;        // Kampf wird gerade beendet: nichts mehr neu aufbauen
      let attacking = false;   // Satz wird gerade eingetragen (die Anzeigen macht playExchange)
      let holdMe = false;      // Spieler-HP, Schlagabtausch und Liste warten auf den Gegenangriff
      let seq = 0;             // Nummer des letzten Angriffs (Gegenangriff gehört zum richtigen Satz)
      let sig = null;          // welcher Kampf gerade angezeigt wird
      let v = null;            // Referenzen auf die Live-Anzeigen
      let enemyView = null;
      let entry = null;        // Satz-Eingabe (OP.ui.setEntry)
      let observer = null;     // blendet die kleine HP-Leiste oben ein, wenn die Balken weggescrollt sind
      let pendingFin = null;   // Kampf ist automatisch zu Ende, die Feier kommt gleich (nach dem letzten Schlagabtausch)
      let emptyLocked = null;  // "Kein Kampf aktiv": war die Arena beim Aufbau gesperrt?
      let raf = 0;
      const timers = [];

      // Roter Rand-Blitz über den ganzen Bildschirm (kritischer Treffer gegen dich)
      const frame = el.closest('.screen') || el.parentNode || el;
      const flash = h('div', { class: 'kampf-flash', 'aria-hidden': 'true' });
      frame.appendChild(flash);

      /* Die kleine HP-Leiste liegt im Rahmen direkt unter dem Kopf (nicht im scrollenden Inhalt),
         so steht sie auf jedem Gerät genau oben – unabhängig davon, wie weit gescrollt ist. */
      let hudWrap = null;
      function mountHud(node) {
        unmountHud();
        hudWrap = node;
        if (frame !== el && el.parentNode === frame) frame.insertBefore(node, el);
        else el.insertBefore(node, el.firstChild);
      }
      function unmountHud() {
        if (hudWrap && hudWrap.parentNode) hudWrap.parentNode.removeChild(hudWrap);
        hudWrap = null;
      }

      bag.add(() => {
        alive = false;
        timers.forEach(clearTimeout);
        timers.length = 0;
        cancelAnimationFrame(raf);
        if (observer) { observer.disconnect(); observer = null; }
        if (enemyView) { enemyView.destroy(); enemyView = null; }
        if (flash.parentNode) flash.parentNode.removeChild(flash);
        unmountHud();
        // Bildschirm verlassen, bevor die Sieg-/Niederlage-Feier kam: Ergebnis trotzdem zeigen
        if (pendingFin) {
          const fin = pendingFin;
          pendingFin = null;
          try { finishFlow(fin); } catch (e) { console.error('[kampf] Ergebnis', e); }
        }
      });

      function later(fn, ms) {
        const id = setTimeout(() => {
          const i = timers.indexOf(id);
          if (i >= 0) timers.splice(i, 1);
          if (alive) fn();
        }, ms);
        timers.push(id);
      }

      function signature() {
        const f = OP.state.fight;
        return f ? f.offerId + ':' + f.started : '';
      }

      function boardPath(pool) { return pool === 'arena' ? 'arena' : 'taverne/abenteuer'; }

      /** Zurück zum Brett. Ist es gesperrt (Zirkus-Sperre): Taverne-Kämpfe in die Taverne (die öffnet dann
          die Zirkus-Tänze – die Taverne selbst ist nie gesperrt), Arena-Kämpfe zur Karte (dort steht der Sperr-Hinweis). */
      function goBoard(path) {
        if (!OP.ui.router.blocked(path)) { OP.ui.go(path); return; }
        OP.ui.go(path.indexOf('taverne') === 0 ? 'taverne' : '');
      }

      /* Animation neu starten (Klasse entfernen, Reflow, wieder setzen) */
      function replay(node, cls) {
        if (!node) return;
        node.classList.remove(cls);
        void node.offsetWidth;
        node.classList.add(cls);
      }

      /* ---------- Aufbau ---------- */

      function render() {
        // laufende Effekte der alten Ansicht abbrechen (ein Ergebnis, das noch kommen sollte, sofort zeigen)
        timers.forEach(clearTimeout);
        timers.length = 0;
        seq++;
        if (pendingFin) { const fin = pendingFin; pendingFin = null; finishFlow(fin); }
        if (enemyView) { enemyView.destroy(); enemyView = null; }
        if (observer) { observer.disconnect(); observer = null; }
        cancelAnimationFrame(raf);
        unmountHud();
        v = null;
        entry = null;
        holdMe = false;
        el.innerHTML = '';
        sig = signature();
        let st = null;
        try { st = OP.game.fightStatus(); } catch (e) { console.error('[kampf] fightStatus', e); }
        if (!st) { renderEmpty(); return; }
        renderFight(st);
      }

      /** Knopf zu einem Brett. Gesperrt (Zirkus-Sperre) = Schloss; Antippen zeigt dann den Sperr-Hinweis (Router). */
      function boardBtn(path, cls, iconName, label) {
        const g = OP.ui.router.blocked(path);
        return h('button', { class: 'btn btn--lg ' + cls + (g ? ' kampf-btn--locked' : ''), type: 'button',
          title: g ? (g.message || D.LOCK_TEXT) : null,
          onclick: () => OP.ui.go(path) }, ico(g ? 'lock' : iconName), label);
      }

      function renderEmpty() {
        OP.ui.setHeadExtra(null);
        emptyLocked = !!OP.ui.router.blocked('arena');
        el.appendChild(h('div', { class: 'screen__inner kampf kampf--empty' },
          h('div', { class: 'empty kampf-empty' },
            h('div', { class: 'empty__icon', html: OP.ui.icon('swords') }),
            h('h2', { class: 'kampf-empty__title', text: 'Kein Kampf aktiv' }),
            h('p', { text: 'Such dir in der Taverne oder in der Arena einen Gegner aus.' }),
            h('div', { class: 'kampf-empty__btns' },
              // 'taverne' (nicht 'taverne/abenteuer'): die Taverne ist nie gesperrt – bei Sperre öffnet sie die Zirkus-Tänze
              boardBtn('taverne', 'btn--gold', 'taverne', 'Zur Taverne'),
              boardBtn('arena', 'btn--danger', 'arena', 'Zur Arena')))));
      }

      /** Welcher Muskel ist beim Öffnen gewählt? Gemerkter, sonst der letzte offene, sonst der erste offene */
      function initialMuscle(st) {
        const ids = st.parts.map((p) => p.id);
        if (memSel && memSel.sig === sig && ids.indexOf(memSel.id) >= 0) return memSel.id;
        const sets = st.fight.sets;
        const last = sets.length ? sets[sets.length - 1].m : null;
        let pick = null;
        st.parts.forEach((p) => { if (p.id === last && !p.done) pick = p.id; });
        if (!pick) st.parts.forEach((p) => { if (!pick && !p.done) pick = p.id; });
        return pick || ids[0];
      }

      /** Zeile "Brust 1.200 / 2.050" mit Balken – antippen wählt den Muskel für den nächsten Satz */
      function partRow(p) {
        const r = { id: p.id, icon: (p.muscle && p.muscle.icon) || 'body', done: null, iconName: null };
        r.iconEl = h('span', { class: 'kampf-part__icon' });
        r.num = h('span', { class: 'kampf-part__num num' });
        r.fill = h('span', { class: 'kampf-part__fill' });
        r.row = h('button', {
          class: 'kampf-part', type: 'button', dataset: { m: p.id }, 'aria-pressed': 'false',
          onclick: () => pickPart(p.id)
        },
          r.iconEl,
          h('span', { class: 'kampf-part__name', text: p.muscle ? p.muscle.name : p.id }),
          r.num,
          h('span', { class: 'kampf-part__bar', 'aria-hidden': 'true' }, r.fill));
        v.parts[p.id] = r;
        return r.row;
      }

      function renderFight(st) {
        const f = st.fight;
        const enemy = enemyOf(st);
        const group = st.group;
        const arena = f.pool === 'arena';
        const single = st.parts.length === 1;   // nur ein Muskel (Beine): nichts zu wählen, Namen nicht doppelt

        OP.ui.setHeadExtra(h('span', { class: 'chip ' + (arena ? 'chip--err' : 'chip--gold') },
          ico(arena ? 'arena' : 'taverne'), arena ? 'Arena' : 'Abenteuer'));

        v = { enemy: enemy, st: st, parts: {}, sel: null, defeatedView: false, shownHp: st.hpLeft, listCount: -1 };

        /* Kleine HP-Leiste oben (nur sichtbar, wenn die großen Balken weggescrollt sind) */
        v.hudFoeFill = h('span', { class: 'kampf-hud__fill' });
        v.hudFoeNum = h('span', { class: 'kampf-hud__num num' });
        v.hudFoeFx = h('span', { class: 'kampf-hud__fx' });
        v.hudMeFill = h('span', { class: 'kampf-hud__fill' });
        v.hudMeNum = h('span', { class: 'kampf-hud__num num' });
        v.hudMeFx = h('span', { class: 'kampf-hud__fx' });
        v.hudMe = h('span', { class: 'kampf-hud__side kampf-hud__side--me' },
          h('span', { class: 'kampf-hud__icon', html: OP.ui.icon('heart') }),
          h('span', { class: 'kampf-hud__main' },
            h('span', { class: 'kampf-hud__row' }, h('span', { class: 'kampf-hud__who', text: 'Du' }), v.hudMeNum),
            h('span', { class: 'kampf-hud__bar' }, v.hudMeFill)),
          v.hudMeFx);
        v.hud = h('div', { class: 'kampf-hud', 'aria-hidden': 'true' },
          h('button', { class: 'kampf-hud__panel', type: 'button', tabindex: '-1', onclick: scrollToStage },
            h('span', { class: 'kampf-hud__side kampf-hud__side--foe' },
              h('span', { class: 'kampf-hud__icon', html: OP.ui.icon('skull') }),
              h('span', { class: 'kampf-hud__main' },
                h('span', { class: 'kampf-hud__row' }, h('span', { class: 'kampf-hud__who', text: enemy.name }), v.hudFoeNum),
                h('span', { class: 'kampf-hud__bar' }, v.hudFoeFill)),
              v.hudFoeFx),
            h('span', { class: 'kampf-hud__vs', text: 'VS' }),
            v.hudMe));

        /* Bühne mit Gegner */
        v.holo = h('div', { class: 'kampf-stage__holo' });
        v.fx = h('div', { class: 'kampf-stage__fx', 'aria-hidden': 'true' });
        v.stage = h('section', { class: 'kampf-stage', style: { '--enemy': enemy.color }, 'aria-label': 'Gegner: ' + enemy.name },
          v.holo,
          h('div', { class: 'kampf-stage__corner kampf-stage__corner--l' },
            tierEl(enemy.tier),
            st.diff ? OP.ui.diffChip(st.diff) : null),
          h('div', { class: 'kampf-stage__corner kampf-stage__corner--r' }, groupChip(group)),
          h('div', { class: 'kampf-stage__stamp', 'aria-hidden': 'true' }, ico('skull'), h('span', { text: 'Besiegt' })),
          v.fx);

        /* Monster: Name, Gesamt-HP und ein Balken je Muskel */
        v.hpBar = OP.ui.progress(st.hpPct * 100, { tone: 'hp', label: hpLabel(st.hpLeft, st.hp) });
        v.hpBar.classList.add('bar--lg', 'kampf-hp__bar');
        v.trail = h('div', { class: 'kampf-hp__trail', style: { width: (st.hpPct * 100) + '%' } });
        v.hpBar.insertBefore(v.trail, v.hpBar.firstChild);
        v.foe = h('section', { class: 'card card--danger kampf-hp', 'aria-label': 'Monster-HP' },
          h('div', { class: 'kampf-hp__head' },
            h('div', { class: 'kampf-hp__who' },
              h('div', { class: 'kampf-hp__adv', text: enemy.adventure }),
              h('h2', { class: 'kampf-hp__name', text: enemy.name }),
              h('div', { class: 'kampf-hp__weapon' }, ico(weaponIcon(enemy)), h('span', { text: enemy.weapon })))),
          v.hpBar,
          h('div', { class: 'kampf-parts__head' },
            h('span', { class: 'kampf-parts__title', text: single ? 'Dein Schaden' : 'Schaden je Muskel' }),
            single ? null : h('span', { class: 'kampf-parts__tip', text: 'Antippen = Muskel wählen' })),
          h('div', { class: 'kampf-parts' }, st.parts.map(partRow)));

        /* Sieg-Hinweis (sichtbar, sobald der Gegner besiegt ist) */
        v.winVals = h('div', { class: 'kampf-win__vals' });
        v.win = h('section', { class: 'kampf-win', role: 'status', hidden: true },
          h('div', { class: 'kampf-win__icon', html: OP.ui.icon('trophy') }),
          h('div', { class: 'kampf-win__text' },
            h('div', { class: 'kampf-win__title', text: 'Gegner besiegt!' }),
            h('p', { text: 'Weitere Sätze zählen noch als XP – bis deine Kraft aufgebraucht ist.' }),
            v.winVals));

        /* Spieler: eigene HP + letzte Runde (Schlagabtausch) */
        v.pBar = OP.ui.progress(st.playerPct * 100, { tone: 'ok' });
        v.pBar.classList.add('kampf-me__bar');
        v.pNum = h('span', { class: 'kampf-me__num num' });
        v.meFx = h('div', { class: 'kampf-me__fx', 'aria-hidden': 'true' });
        v.exYou = h('div', { class: 'kampf-ex__row kampf-ex__row--you' });
        v.exFoe = h('div', { class: 'kampf-ex__row kampf-ex__row--foe' });
        v.me = h('section', { class: 'card kampf-me', 'aria-label': 'Deine HP' },
          h('div', { class: 'kampf-me__head' },
            h('span', { class: 'kampf-me__heart', html: OP.ui.icon('heart') }),
            h('span', { class: 'kampf-me__title', text: 'Deine HP' }),
            v.pNum),
          h('div', { class: 'kampf-me__barwrap' }, v.pBar, v.meFx),
          h('div', { class: 'kampf-ex', 'aria-live': 'polite' },
            h('div', { class: 'kampf-ex__title', text: 'Letzte Runde' }),
            v.exYou, v.exFoe));

        /* Satz-Eingabe mit Muskel-Auswahl (wird nie neu gebaut, solange der Kampf läuft) */
        entry = OP.ui.setEntry({
          muscles: st.parts.map((p) => ({ id: p.id, name: p.muscle ? p.muscle.name : p.id, icon: p.muscle ? p.muscle.icon : 'body' })),
          selected: initialMuscle(st),
          onSelect: (id) => { memSel = { sig: sig, id: id }; markSelected(id); schedulePreview(); },
          onAdd: onAttack,
          addLabel: 'Angriff!', addIcon: 'sword', unitLabel: 'Schaden'
        });
        entry.el.classList.add('kampf-entry');   // (nur ein Muskel, z. B. Beine: setEntry zeigt gar keine Auswahl)
        // Haken für volle Balken: ersetzt im Knopf das Muskel-Icon (statt angehängt), damit "Schultern" ganz hineinpasst
        entry.el.querySelectorAll('.set-entry__muscles .seg__btn').forEach((b) => {
          b.insertAdjacentHTML('afterbegin', OP.ui.icon('check', 'kampf-seg__check'));
        });
        v.preview = entry.preview || entry.el.querySelector('.set-entry__preview');
        entry.el.addEventListener('input', schedulePreview);
        entry.el.addEventListener('click', schedulePreview);

        /* Knöpfe */
        v.endLabel = h('span', { text: 'Kampf beenden' });
        v.endBtn = h('button', { class: 'btn btn--lg btn--block', type: 'button', onclick: onFinish }, ico('flag'), v.endLabel);
        v.fleeBtn = h('button', { class: 'btn btn--ghost btn--block kampf-flee', type: 'button', onclick: onFlee }, ico('run'), 'Flucht');
        v.actHint = h('p', { class: 'kampf-actions__hint' });
        const actions = h('div', { class: 'kampf-actions' }, v.endBtn, v.fleeBtn, v.actHint);

        const rules = h('p', { class: 'kampf-rules' }, ico('info'),
          h('span', { text: 'Schaden = Gewicht × Wiederholungen. ' +
            (single ? 'Ist der Balken voll, ist der Gegner besiegt.' : 'Alle Balken füllen, dann ist der Gegner besiegt.') +
            ' Jeder Satz kostet dich HP.' }));

        /* Sätze (mit dem Gegentreffer darunter) */
        v.setCount = h('span', { class: 'chip chip--muted' });
        v.sets = h('div', { class: 'kampf-sets__list' });
        const sets = h('section', { class: 'kampf-sets' },
          OP.ui.sectionTitle('Schlagabtausch', 'swords', v.setCount), v.sets);

        /* Gegner-Akte */
        const facts = [
          ['Art', KIND_NAMES[enemy.kind] || 'Unbekannt'],
          ['Stufe', enemy.tier + ' von 5'],
          ['Waffe', enemy.weapon],
          // "Push (Brust, Trizeps, Schultern)" – bei nur einem Muskel nur "Beine" (nicht "Beine (Beine)")
          ['Gruppe', group.name + (single ? '' : ' (' + st.parts.map((p) => (p.muscle ? p.muscle.name : p.id)).join(', ') + ')')],
          ['Abenteuer', enemy.adventure]
        ];
        const file = h('section', { class: 'card card--plain kampf-file' },
          h('div', { class: 'kampf-file__head' }, ico('scroll'), h('span', { text: 'Gegner-Akte' })),
          h('dl', { class: 'kampf-file__facts' }, facts.map((p) => [h('dt', { text: p[0] }), h('dd', { text: p[1] })])),
          enemy.lore ? h('p', { class: 'kampf-file__lore', text: enemy.lore }) : null);

        const grid = h('div', { class: 'kampf-grid' },
          h('div', { class: 'kampf-col kampf-col--stage' }, v.stage, v.foe, file),
          h('div', { class: 'kampf-col kampf-col--ctrl' }, v.win, v.me, entry.el, actions, rules, sets));
        v.root = h('div', { class: 'screen__inner kampf' + (arena ? ' kampf--arena' : '') }, grid);
        el.appendChild(v.root);
        mountHud(v.hud);

        // Gegner erst erzeugen, wenn der Container im DOM ist (braucht seine Größe)
        enemyView = createEnemyView(v.holo, enemy, st.hpPct);
        markSelected(entry.selected());
        updateAll(st, true);   // ist der Gegner schon besiegt, liegt er sofort am Boden
        watchHud();
      }

      /* ---------- Live-Aktualisierung (ohne die Eingabe anzufassen) ---------- */

      function hpLabel(left, hp) { return 'HP ' + U.fmt(left) + ' / ' + U.fmt(hp); }

      function setHpLabel(left, hp) {
        const label = v.hpBar.querySelector('.bar__label');
        if (label) label.textContent = hpLabel(left, hp);
      }

      /** Monster-HP im Balken weich herunterzählen */
      function tweenHp(target, hp) {
        cancelAnimationFrame(raf);
        const from = v.shownHp, t0 = performance.now(), dur = reducedMotion() ? 0 : 600;
        if (from === target || !dur) { v.shownHp = target; setHpLabel(target, hp); return; }
        const step = (now) => {
          if (!alive || !v) return;
          const k = Math.min(1, (now - t0) / dur), ease = 1 - Math.pow(1 - k, 3);
          v.shownHp = k >= 1 ? target : from + (target - from) * ease;
          setHpLabel(v.shownHp, hp);
          if (k < 1) raf = requestAnimationFrame(step);
        };
        raf = requestAnimationFrame(step);
      }

      /** Alles auf den Stand bringen. instant = ohne Animation (erster Aufbau). */
      function updateAll(st, instant) {
        if (!v || !st) return;
        updateFoe(st, instant, false);
        if (!holdMe) { updateMe(st); setExchange(st); updateList(st); }
        updateState(st);
      }

      /** Monster: Gesamt-HP, Muskel-Balken, Haken in der Muskel-Auswahl, kleine Leiste, Hologramm */
      function updateFoe(st, instant, fx) {
        v.st = st;
        const pct = st.hpPct * 100;
        OP.ui.setProgress(v.hpBar, pct);
        v.trail.style.width = pct + '%';
        if (instant) { v.shownHp = st.hpLeft; setHpLabel(st.hpLeft, st.hp); }
        else tweenHp(st.hpLeft, st.hp);

        const choice = st.parts.length > 1;
        st.parts.forEach((p) => {
          const r = v.parts[p.id];
          if (!r) return;
          r.num.textContent = U.fmt(p.dmg) + ' / ' + U.fmt(p.hp);
          r.fill.style.width = (p.pct * 100) + '%';
          if (r.done !== p.done) {
            r.done = p.done;
            r.row.classList.toggle('is-done', p.done);
            setPartIcon(r);
          }
          r.row.setAttribute('aria-label', (p.muscle ? p.muscle.name : p.id) + ': ' + U.fmt(p.dmg) + ' von ' + U.fmt(p.hp) +
            ' Schaden' + (p.done ? ', voll' : '') + (choice ? '. Antippen, um diesen Muskel anzugreifen.' : '.'));
        });
        // Muskel-Auswahl: volle Balken bekommen statt des Muskel-Icons einen Haken (CSS)
        if (entry) entry.markDone(st.parts.filter((p) => p.done).map((p) => p.id));

        v.hudFoeFill.style.width = pct + '%';
        v.hudFoeNum.textContent = U.fmt(st.hpLeft);

        v.stage.classList.toggle('is-defeated', st.defeated);
        v.foe.classList.toggle('is-won', st.defeated);
        v.hud.classList.toggle('is-won', st.defeated);
        if (!fx) syncEnemy(st);
      }

      /** Spieler-HP: grün, ab der Hälfte gelb, im letzten Viertel rot */
      function updateMe(st) {
        const pct = st.playerPct * 100;
        const tone = pct <= 25 ? 'err' : (pct <= 50 ? 'warn' : 'ok');
        OP.ui.setProgress(v.pBar, pct, null, tone);
        v.pNum.textContent = U.fmt(st.playerHpLeft) + ' / ' + U.fmt(st.playerHp);
        v.me.classList.toggle('is-warn', tone === 'warn');
        v.me.classList.toggle('is-low', tone === 'err');
        v.hudMeFill.style.width = pct + '%';
        v.hudMeNum.textContent = U.fmt(st.playerHpLeft);
        v.hudMe.classList.toggle('is-warn', tone === 'warn');
        v.hudMe.classList.toggle('is-low', tone === 'err');
      }

      /* Letzte Runde: zwei Zeilen – dein Treffer und die Antwort des Gegners.
         parts[0] = Icon, der Rest (Text, Zahl, "Kritisch") fließt als ein Satz daneben und bricht dort um –
         so steht das Icon nie allein in einer Zeile (lange Gegner-Namen). */
      function txt(text, cls) { return h('span', { class: 'kampf-ex__text' + (cls ? ' ' + cls : ''), text: text }); }
      function fill(row, parts, mod) {
        row.innerHTML = '';
        row.className = row.className.replace(/\s*\bis-(hit|calm|wait|idle|crit)\b/g, '');
        if (mod) mod.split(' ').forEach((c) => row.classList.add(c));
        const line = h('span', { class: 'kampf-ex__line' });
        parts.slice(1).forEach((p) => {
          if (!p) return;
          if (line.firstChild) line.appendChild(document.createTextNode(' '));
          line.appendChild(p);
        });
        if (parts[0]) row.appendChild(parts[0]);
        row.appendChild(line);
      }
      function exYou(ev) {
        if (!ev) return fill(v.exYou, [ico('sword'), txt('Du greifst zuerst an.')], 'is-idle');
        const m = D.muscle(ev.m);
        fill(v.exYou, [ico('sword'), txt('Du triffst ' + (m ? m.name : 'den Gegner') + ':'),
          h('span', { class: 'kampf-ex__num num', text: minus(ev.dmg) }), ev.crit ? critBadge(false) : null],
        ev.crit ? 'is-crit' : '');
      }
      function exFoe(ev, pending) {
        const name = v.enemy.name;
        if (!ev) return fill(v.exFoe, [ico('skull'), txt('Danach schlägt ' + name + ' zurück.')], 'is-idle');
        if (ev.enemyDmg > 0) {
          if (pending) return fill(v.exFoe, [ico('skull'), txt(name + ' holt aus …')], 'is-wait');
          return fill(v.exFoe, [ico('skull'), txt(name + ' trifft dich:'),
            h('span', { class: 'kampf-ex__num num', text: minus(ev.enemyDmg) }), ev.enemyCrit ? critBadge(true) : null],
          'is-hit' + (ev.enemyCrit ? ' is-crit' : ''));
        }
        if (ev.killing) return fill(v.exFoe, [ico('trophy'), txt('Todesstoß! ' + name + ' ist besiegt.')], 'is-calm');
        fill(v.exFoe, [ico('shield'), txt(name + ' ist besiegt und greift nicht mehr an.')], 'is-calm');
      }
      function setExchange(st) {
        const ev = st.events.length ? st.events[st.events.length - 1] : null;
        exYou(ev);
        exFoe(ev, false);
      }

      /** Icon + ein Satz daneben (Text, Zahl, "Kritisch" im Fließtext – bricht neben dem Icon um) */
      function slPart(cls, iconName, parts) {
        const line = h('span', { class: 'kampf-sl__line' });
        parts.forEach((p) => {
          if (!p) return;
          if (line.firstChild) line.appendChild(document.createTextNode(' '));
          line.appendChild(p);
        });
        return h('span', { class: cls }, ico(iconName), line);
      }

      /** Zeile unter jedem Satz: kritisch? und was der Gegner danach gemacht hat */
      function setExtra(ev) {
        if (!ev) return null;
        const name = v.enemy.name;
        let foe;
        if (ev.enemyDmg > 0) {
          foe = slPart('kampf-sl__foe' + (ev.enemyCrit ? ' is-crit' : ''), 'skull', [
            h('span', { text: name + ' trifft dich:' }), h('b', { class: 'num', text: minus(ev.enemyDmg) }),
            ev.enemyCrit ? critBadge(true) : null]);
        } else if (ev.killing) {
          foe = slPart('kampf-sl__kill', 'trophy', [h('span', { text: 'Todesstoß – Gegner besiegt' })]);
        } else {
          foe = slPart('kampf-sl__calm', 'shield', [h('span', { text: 'Kein Gegenangriff' })]);
        }
        return h('div', { class: 'set-list__extra kampf-sl' }, ev.crit ? critBadge(false) : null, foe);
      }

      function updateList(st) {
        const sets = st.fight.sets;
        const grew = v.listCount >= 0 && sets.length > v.listCount;
        const ol = OP.ui.setList(sets, {
          onRemove: askRemove, unitLabel: 'Schaden',
          emptyText: 'Noch kein Angriff. Trag oben deinen ersten Satz ein.',
          extra: (i) => setExtra(st.events[i]),
          itemClass: (i) => {
            const ev = st.events[i];
            return [ev && ev.crit ? 'is-crit' : '', grew && i === sets.length - 1 ? 'is-new' : ''].join(' ').trim();
          }
        });
        v.listCount = sets.length;
        v.sets.innerHTML = '';
        v.sets.appendChild(ol);
      }

      /** Sieg-Hinweis, Knöpfe, Zähler */
      function updateState(st) {
        const n = st.fight.sets.length;
        const over = st.limitReached || st.dead;   // (nur Sicherheitsnetz – endet normalerweise automatisch)
        v.win.hidden = !st.defeated;
        if (st.defeated) renderWinValues(st);
        v.setCount.textContent = n + (n === 1 ? ' Satz' : ' Sätze');

        v.endBtn.hidden = n === 0;
        v.fleeBtn.hidden = n > 0;
        v.endBtn.className = 'btn btn--lg btn--block ' + (st.defeated ? 'btn--primary kampf-end--win' : 'kampf-end--risky');
        v.endLabel.textContent = over ? 'Ergebnis ansehen' : 'Kampf beenden';
        v.endBtn.disabled = busy;
        v.fleeBtn.disabled = busy;
        v.actHint.textContent = n === 0
          ? 'Flucht geht nur, solange du noch keinen Satz gemacht hast. Es passiert nichts.'
          : over
            ? 'Der Kampf ist vorbei.'
            : st.defeated
              ? 'Beende den Kampf, wenn du fertig bist – oder mach weiter für mehr XP.'
              : 'Beendest du jetzt, verlierst du den Kampf. Deine Werte bleiben gleich.';
        if (over || busy) lockEntry();
      }

      /** Neue Werte, die ein Sieg jetzt bringen würde (ganzer Schaden je Muskel, nie weniger als jetzt) */
      function renderWinValues(st) {
        v.winVals.innerHTML = '';
        st.parts.forEach((p) => {
          const m = OP.state.muscles[p.id];
          const cur = m ? m.xp : p.startXp;
          const next = Math.max(cur, p.dmg), plus = Math.round(next - cur);
          v.winVals.appendChild(h('span', { class: 'kampf-win__val' },
            h('b', { text: p.muscle ? p.muscle.name : p.id }),
            h('span', { class: 'num', text: U.fmt(next) + ' XP' }),
            plus > 0 ? h('i', { class: 'num', text: '+' + U.fmt(plus) }) : null));
        });
      }

      /** Hologramm an den Stand anpassen (z. B. nach dem Löschen eines Satzes) */
      function syncEnemy(st) {
        if (!enemyView) return;
        if (!st.defeated && v.defeatedView) {
          // Satz gelöscht, Gegner lebt wieder: Hologramm neu aufbauen
          enemyView.destroy();
          enemyView = createEnemyView(v.holo, v.enemy, st.hpPct);
          v.defeatedView = false;
          return;
        }
        enemyView.update({ hpPct: st.hpPct });
        if (st.defeated && !v.defeatedView) { enemyView.defeat(); v.defeatedView = true; }
      }

      /* ---------- Muskel-Auswahl ---------- */

      function setPartIcon(r) {
        const name = r.done ? 'check' : (r.id === v.sel ? 'target' : r.icon);
        if (r.iconName !== name) { r.iconEl.innerHTML = OP.ui.icon(name); r.iconName = name; }
      }

      function markSelected(id) {
        if (!v) return;
        v.sel = id;
        Object.keys(v.parts).forEach((k) => {
          const r = v.parts[k], on = k === id;
          r.row.classList.toggle('is-sel', on);
          r.row.setAttribute('aria-pressed', on ? 'true' : 'false');
          setPartIcon(r);
        });
      }

      /** Muskel-Zeile angetippt: Muskel in der Eingabe wählen und die Eingabe zeigen */
      function pickPart(id) {
        if (!entry || !v || busy) return;
        entry.select(id);
        memSel = { sig: sig, id: id };
        markSelected(id);
        schedulePreview();
        OP.ui.haptic(8);
        const btn = entry.el.querySelector('.set-entry__muscles .seg__btn[data-m="' + id + '"]');
        if (btn) replay(btn, 'is-picked');
        try { entry.el.scrollIntoView({ block: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' }); } catch (e) { /* alt */ }
      }

      /** Nach einem vollen Balken: automatisch zum nächsten offenen Muskel */
      function autoNext(doneId) {
        if (!entry || !v || busy) return;
        const st = OP.game.fightStatus();
        if (!st || st.defeated) return;
        const next = nextOpen(st, doneId);
        if (!next) return;
        if (entry.selected() === doneId) {
          entry.select(next.id);
          memSel = { sig: sig, id: next.id };
          markSelected(next.id);
          schedulePreview();
        }
        const done = D.muscle(doneId);
        OP.ui.toast((done ? done.name : 'Der Muskel') + ' ist voll! Weiter mit ' + (next.muscle ? next.muscle.name : next.id) + '.',
          { type: 'ok', icon: 'check' });
      }

      /* Vorschau "= 600 Schaden" wird gold mit "Kritisch!", wenn der Satz ein kritischer Treffer wäre */
      function schedulePreview() { later(checkPreview, 0); }
      function checkPreview() {
        if (!v || !v.preview || !entry || !v.st) return;
        const val = entry.values(), w = val.w, r = val.r;
        const dmg = isFinite(w) && isFinite(r) && w > 0 && r > 0 ? Math.round(w * r) : 0;
        v.preview.classList.toggle('kampf-preview--crit', dmg > 0 && OP.game.isCrit(dmg, v.st.hp));
      }

      function lockEntry() {
        if (v && v.root) v.root.classList.add('is-over');
        if (!entry) return;
        entry.el.classList.add('is-over');
        entry.el.setAttribute('inert', '');
        const a = document.activeElement;
        if (a && entry.el.contains(a) && a.blur) a.blur();
      }

      /* ---------- Treffer-Effekte ---------- */

      /** Schwebende Zahl ("−600", bei kritisch mit "Kritisch!" darüber) */
      function floatAt(box, amount, crit, side, left, top) {
        if (!box) return;
        const node = h('div', {
          class: 'kampf-float kampf-float--' + side + (crit ? ' is-crit' : ''),
          style: { left: left + '%', top: top + '%' }
        },
          crit ? h('span', { class: 'kampf-float__crit', text: 'Kritisch!' }) : null,
          h('span', { class: 'kampf-float__num num', text: minus(amount) }));
        box.appendChild(node);
        later(() => { if (node.parentNode) node.parentNode.removeChild(node); }, crit ? 1700 : 1300);
      }

      function hudOn() { return !!(v && v.hud.classList.contains('is-on')); }

      /** Dein Treffer: Zahl über dem Gegner, Blitz, Hologramm zuckt */
      function hitFx(res, st) {
        const share = res.dmg / Math.max(1, st.hp);
        floatAt(v.fx, res.dmg, res.crit, 'foe', 50 + U.rand(-14, 14), 42 + U.rand(-8, 6));
        if (hudOn()) floatAt(v.hudFoeFx, res.dmg, false, 'hud', 50, 50);
        replay(v.fx, res.crit ? 'is-crit' : 'is-flash');
        replay(v.stage, 'is-hit');
        const r = v.parts[res.muscle && res.muscle.id];
        if (r) replay(r.row, 'is-hit');
        if (enemyView) {
          enemyView.hit(res.crit ? Math.max(0.75, U.clamp(share * 5, 0, 1)) : U.clamp(share * 5, 0.12, 0.7));
          enemyView.update({ hpPct: st.hpPct });
        }
        OP.ui.haptic(res.crit ? [30, 40, 60] : [18, 24, 18]);
      }

      /** Gegenangriff: Zahl über deinem HP-Balken; kritisch = roter Blitz und Wackeln */
      function counterFx(res, pctBefore) {
        floatAt(v.meFx, res.enemyDmg, res.enemyCrit, 'me', U.clamp(pctBefore * 100, 18, 82), 50);
        if (hudOn()) floatAt(v.hudMeFx, res.enemyDmg, false, 'hud', 50, 50);
        if (res.enemyCrit) {
          if (reducedMotion()) {
            flash.classList.add('is-static');
            later(() => flash.classList.remove('is-static'), 380);
          } else {
            replay(flash, 'is-on');
          }
          replay(v.me, 'is-shake');
          OP.ui.haptic([50, 30, 90]);
        } else {
          replay(v.me, 'is-hit');
          OP.ui.haptic(25);
        }
      }

      function showDefeat() {
        if (!v || !enemyView || v.defeatedView) return;
        const st = OP.game.fightStatus() || v.st;
        if (!st || !st.defeated) return;   // inzwischen Satz gelöscht
        enemyView.defeat();
        v.defeatedView = true;
        replay(v.fx, 'is-gold');
        OP.ui.haptic([40, 60, 120]);
      }

      /** Ein Satz ist eingetragen: erst dein Treffer, kurz danach die Antwort des Gegners */
      function playExchange(res, before) {
        const st = res.status;
        const fin = res.finished;
        const rm = reducedMotion();
        const my = ++seq;
        const ev = st.events[st.events.length - 1];
        const pctBefore = before ? before.playerPct : 1;
        if (fin) { busy = true; lockEntry(); }

        // 1) dein Treffer: Monster-Anzeigen sofort, Spieler-Anzeigen warten
        holdMe = true;
        updateFoe(st, false, true);
        updateState(st);
        exYou(ev);
        exFoe(ev, true);
        hitFx(res, st);
        if (res.justDefeated) later(showDefeat, rm ? 120 : 420);

        // Neue Achievements: Ergebnis sofort zeigen, damit es vor den Achievement-Feiern kommt
        const resultNow = !!(fin && fin.achievements && fin.achievements.length);
        if (resultNow) finishFlow(fin);
        else if (fin) pendingFin = fin;

        // 2) Antwort des Gegners (lebt er nicht mehr, gibt es keinen Gegenangriff)
        const delay = res.enemyDmg > 0 ? (rm ? 320 : 620) : (rm ? 60 : 260);
        later(() => {
          if (!v) return;
          if (res.enemyDmg > 0) counterFx(res, pctBefore);
          if (my === seq) {
            // letzter Angriff: alles auf den neuesten Stand
            holdMe = false;
            const cur = fin ? st : (OP.game.fightStatus() || st);
            updateMe(cur);
            setExchange(cur);
            updateList(cur);
            updateState(cur);
          } else {
            // inzwischen kam schon der nächste Satz: nur den HP-Balken dieser Runde zeigen
            updateMe(st);
          }
          if (fin && !resultNow) {
            later(() => {
              if (pendingFin !== fin) return;
              pendingFin = null;
              finishFlow(fin);
            }, rm ? 450 : (fin.won ? 900 : 1100));
          }
        }, delay);

        // 3) Muskel voll? Nach dem Eintragen (Formular speichert erst noch das Gewicht) zum nächsten offenen
        if (res.partDone && !res.justDefeated && !fin) later(() => autoNext(res.muscle.id), 0);
      }

      /* ---------- Aktionen ---------- */

      function onAttack(m, w, r) {
        if (busy) return { ok: false, error: 'Der Kampf ist vorbei.' };
        let before = null, res;
        try { before = OP.game.fightStatus(); } catch (e) { before = null; }
        attacking = true;
        try { res = OP.game.addFightSet(m, w, r); }
        catch (e) { console.error('[kampf] addFightSet', e); res = { ok: false, error: 'Das hat nicht geklappt.' }; }
        finally { attacking = false; }
        if (!res || !res.ok) {
          // Kampf inzwischen vorbei / weg? Dann neu aufbauen
          if (signature() !== sig) later(render, 0);
          return res || { ok: false, error: 'Das hat nicht geklappt.' };
        }
        if (!v) return res;
        playExchange(res, before);
        return res;
      }

      function askRemove(i) {
        if (busy) return;
        const f = OP.state.fight;
        if (!f || !f.sets[i]) return;
        const s = f.sets[i];
        const m = D.muscle(s.m);
        const what = (m ? m.name + ': ' : '') + KG_FMT.format(s.w) + ' kg × ' + s.r + ' = ' + U.fmt(s.dmg) + ' Schaden';
        OP.ui.confirm('Satz ' + (i + 1) + ' löschen? (' + what + ') Danach wird alles neu berechnet – auch die Treffer des Gegners.',
          { title: 'Satz löschen?', okLabel: 'Löschen', danger: true })
          .then((ok) => {
            if (!ok || !alive || busy) return;
            // Sicherheits-Check: ist es noch derselbe Satz?
            const cur = OP.state.fight;
            if (!cur || cur.sets[i] !== s) { OP.ui.toast('Die Liste hat sich geändert. Bitte noch mal.', { type: 'warn' }); return; }
            OP.game.removeFightSet(i);
            OP.ui.toast('Satz gelöscht.', { type: 'info', icon: 'trash' });
          });
      }

      /** Sieg oder Niederlage feiern, danach zurück zum Brett (Arena oder Taverne) */
      function finishFlow(res) {
        const back = boardPath(res.pool);
        const eName = (res.enemy && res.enemy.name) || (v && v.enemy && v.enemy.name) || 'Gegner';
        let shown;
        if (res.won) {
          const lines = [];
          if (res.auto) lines.push('Deine Kraft ist aufgebraucht – der Kampf ist vorbei.');
          (res.parts || []).forEach((p) => {
            const plus = Math.round(p.newXp - p.oldXp);
            lines.push(p.name + ': ' + U.fmt(p.oldXp) + ' → ' + U.fmt(p.newXp) + ' XP' + (plus > 0 ? ' (+' + U.fmt(plus) + ')' : ''));
          });
          if (res.playerHp > 0 && res.playerHpLeft >= res.playerHp) lines.push('Ohne einen Kratzer!');
          else if (res.playerHp > 0 && res.playerHpLeft <= res.playerHp * 0.1) lines.push('Knapp! Nur noch ' + U.fmt(res.playerHpLeft) + ' HP übrig.');
          shown = OP.ui.celebrate({
            kicker: eName + ' besiegt', title: 'SIEG!', icon: 'trophy', tone: 'gold', big: true,
            text: lines.join('\n')
          });
        } else {
          shown = OP.ui.celebrate({
            kicker: 'Gegen ' + eName, title: 'NIEDERLAGE', icon: 'skull', tone: 'err',
            text: res.reason === 'dead'
              ? 'Deine HP sind auf 0. Loss Always Builds Strength. Deine Werte bleiben.'
              : 'Du hast den Kampf beendet. Loss Always Builds Strength. Deine Werte bleiben.'
          });
        }
        shown.then(() => {
          if (!alive) return;
          const cur = OP.ui.router.current();
          if (cur && cur.screenId === 'kampf') goBoard(back);
        });
      }

      function onFinish() {
        if (busy) return;
        const st = OP.game.fightStatus();
        if (!st) { render(); return; }
        if (!st.fight.sets.length) { onFlee(); return; }
        const over = st.limitReached || st.dead;
        const ask = st.defeated || over ? Promise.resolve(true)
          : OP.ui.confirm('Der Gegner lebt noch. Du verlierst den Kampf, deine Werte bleiben.',
            { title: 'Kampf beenden?', okLabel: 'Beenden', cancelLabel: 'Weiterkämpfen', danger: true });
        ask.then((ok) => {
          if (!ok || !alive || busy) return;
          busy = true;
          let res;
          try { res = OP.game.finishFight(over ? { auto: true } : undefined); }
          catch (e) { console.error('[kampf] finishFight', e); res = null; }
          if (!res || !res.ok) {
            busy = false;
            OP.ui.toast((res && res.error) || 'Der Kampf konnte nicht beendet werden.', { type: 'err' });
            render();
            return;
          }
          if (res.cancelled) { goBoard(boardPath(st.fight.pool)); return; }
          if (v) updateState(v.st || st);
          finishFlow(res);
        });
      }

      function onFlee() {
        if (busy) return;
        const st = OP.game.fightStatus();
        if (!st) { render(); return; }
        if (st.fight.sets.length) { OP.ui.toast('Flucht geht nur ohne Sätze. Beende den Kampf.', { type: 'warn' }); return; }
        const back = boardPath(st.fight.pool);
        busy = true;
        if (!OP.game.cancelFight()) {
          busy = false;
          OP.ui.toast('Flucht geht gerade nicht.', { type: 'warn' });
          render();
          return;
        }
        OP.ui.toast('Du bist geflohen. Der Gegner wartet noch auf dich.', { type: 'info', icon: 'run' });
        goBoard(back);
      }

      /* ---------- Kleine HP-Leiste oben ---------- */

      function scrollToStage() {
        try { el.scrollTo({ top: 0, behavior: reducedMotion() ? 'auto' : 'smooth' }); } catch (e) { el.scrollTop = 0; }
      }

      /** Leiste zeigen, sobald der Monster- oder dein HP-Balken nach oben aus dem Bild gescrollt ist */
      function watchHud() {
        if (!v || typeof window.IntersectionObserver !== 'function') return;
        const out = new Map();
        observer = new IntersectionObserver((entries) => {
          entries.forEach((e) => {
            const rb = e.rootBounds;
            out.set(e.target, !e.isIntersecting && !!rb && e.boundingClientRect.bottom <= rb.top + 1);
          });
          let on = false;
          out.forEach((x) => { if (x) on = true; });
          if (v) v.hud.classList.toggle('is-on', on);
        }, { root: el, threshold: 0 });
        observer.observe(v.hpBar);
        observer.observe(v.pBar);
      }

      /* ---------- Start ---------- */

      render();

      bag.on('change', () => {
        if (busy || attacking || !alive) return;
        if (signature() !== sig) { render(); return; }   // anderer/kein Kampf mehr
        if (!v) {
          // "Kein Kampf aktiv": Schloss am Arena-Knopf aktuell halten (Sperre beginnt/endet, z. B. neuer Tag)
          if (!sig && emptyLocked !== !!OP.ui.router.blocked('arena')) render();
          return;
        }
        let st = null;
        try { st = OP.game.fightStatus(); } catch (e) { console.error('[kampf] fightStatus', e); }
        if (st) updateAll(st, false);
      });

      return bag.run;
    }
  });
})();
