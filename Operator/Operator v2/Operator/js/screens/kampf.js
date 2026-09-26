/* Operator – Kampf (Bildschirm 'kampf')
   Gegner als Hologramm, HP-Balken, Satz-Eingabe (Schaden = Gewicht × Wiederholungen),
   Liste der Sätze, "Kampf beenden" und "Flucht".
   Wichtig: Nach einem Satz wird die Eingabe NICHT neu gebaut (Fokus bleibt im Feld) –
   es werden nur die Anzeigen (HP, Schaden, Liste, Knöpfe) aktualisiert. */
(function () {
  'use strict';
  const OP = window.OP;
  const U = OP.util, h = OP.h;

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

  function ico(name, cls) {
    return h('span', { class: 'kampf-i' + (cls ? ' ' + cls : ''), html: OP.ui.icon(name) });
  }

  /* Anzeige-Rundung: Rest-HP immer AUF-, Schaden immer ABrunden.
     So steht nie "HP 0" oder "Noch 0 bis zum Sieg", solange der Gegner noch lebt (alte Spielstände mit Komma-Schaden). */
  function fmtLeft(n) { return U.fmt(Math.ceil(n - 1e-9)); }
  function fmtDmg(n) { return U.fmt(Math.floor(n + 1e-9)); }
  /* Gewicht mit bis zu 2 Nachkommastellen: 32,25 kg / 100 kg */
  const KG_FMT = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 2 });

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

  /** Aktueller XP-Wert der Muskelgruppe dieses Kampfes */
  function currentXp(fight) {
    const m = OP.state.muscles && OP.state.muscles[fight.muscle];
    return m ? m.xp : (fight.startXp || 0);
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

  OP.screens.register('kampf', {
    title: 'Kampf', icon: 'swords', tone: 'red',
    mount: function (el) {
      const bag = OP.ui.cleanup();
      let alive = true;
      let busy = false;        // true beim Beenden/Flucht: dann nichts neu aufbauen
      let attacking = false;   // true, während ein Satz eingetragen wird (Effekte macht onAttack)
      let sig = null;          // welcher Kampf gerade angezeigt wird
      let v = null;            // Referenzen auf die Live-Anzeigen
      let enemyView = null;
      let raf = 0;
      const timers = [];

      bag.add(() => {
        alive = false;
        timers.forEach(clearTimeout);
        cancelAnimationFrame(raf);
        if (enemyView) { enemyView.destroy(); enemyView = null; }
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

      function backPath(pool) { return pool === 'arena' ? 'arena' : 'taverne/abenteuer'; }

      /* Animation neu starten (Klasse entfernen, Reflow, wieder setzen) */
      function replay(node, cls) {
        if (!node) return;
        node.classList.remove(cls);
        void node.offsetWidth;
        node.classList.add(cls);
      }

      /* ---------- Aufbau ---------- */

      function render() {
        if (enemyView) { enemyView.destroy(); enemyView = null; }
        cancelAnimationFrame(raf);
        v = null;
        el.innerHTML = '';
        sig = signature();
        let st = null;
        try { st = OP.game.fightStatus(); } catch (e) { console.error('[kampf] fightStatus', e); }
        if (!st) { renderEmpty(); return; }
        renderFight(st);
      }

      function renderEmpty() {
        OP.ui.setHeadExtra(null);
        el.appendChild(h('div', { class: 'screen__inner kampf kampf--empty' },
          h('div', { class: 'empty kampf-empty' },
            h('div', { class: 'empty__icon', html: OP.ui.icon('swords') }),
            h('h2', { class: 'kampf-empty__title', text: 'Kein Kampf aktiv' }),
            h('p', { text: 'Such dir in der Taverne oder in der Arena einen Gegner aus.' }),
            h('div', { class: 'kampf-empty__btns' },
              h('button', { class: 'btn btn--gold btn--lg', type: 'button', onclick: () => OP.ui.go('taverne/abenteuer') },
                ico('taverne'), 'Zur Taverne'),
              h('button', { class: 'btn btn--danger btn--lg', type: 'button', onclick: () => OP.ui.go('arena') },
                ico('arena'), 'Zur Arena')))));
      }

      function renderFight(st) {
        const f = st.fight;
        const enemy = enemyOf(st);
        const muscle = st.muscle || { id: f.muscle, name: 'Muskel', icon: 'body' };
        const diff = st.diff;
        const arena = f.pool === 'arena';

        OP.ui.setHeadExtra(h('span', { class: 'chip ' + (arena ? 'chip--err' : 'chip--gold') },
          ico(arena ? 'arena' : 'taverne'), arena ? 'Arena' : 'Abenteuer'));

        v = { defeatedView: false, shownHp: st.hpLeft };

        /* Bühne mit Gegner */
        v.holo = h('div', { class: 'kampf-stage__holo' });
        v.fx = h('div', { class: 'kampf-stage__fx', 'aria-hidden': 'true' });
        v.stage = h('section', { class: 'kampf-stage', style: { '--enemy': enemy.color }, 'aria-label': 'Gegner: ' + enemy.name },
          v.holo,
          h('div', { class: 'kampf-stage__corner kampf-stage__corner--l' },
            tierEl(enemy.tier),
            diff ? OP.ui.diffChip(diff) : null),
          h('div', { class: 'kampf-stage__corner kampf-stage__corner--r' },
            h('span', { class: 'chip kampf-chip-muscle' }, ico(muscle.icon), muscle.name),
            h('span', { class: 'chip kampf-chip-pct num' }, '+' + U.fmt1(f.pct) + ' %')),
          h('div', { class: 'kampf-stage__stamp', 'aria-hidden': 'true' }, ico('skull'), h('span', { text: 'Besiegt' })),
          v.fx);

        /* Namensschild + HP */
        v.hpBar = OP.ui.progress(st.hpPct * 100, { tone: 'hp', label: hpLabel(st.hpLeft, st.hp) });
        v.hpBar.classList.add('bar--lg', 'kampf-hp__bar');
        v.trail = h('div', { class: 'kampf-hp__trail', style: { width: (st.hpPct * 100) + '%' } });
        v.hpBar.insertBefore(v.trail, v.hpBar.firstChild);
        v.hpPct = h('span', { class: 'kampf-hp__pct num' });
        v.xpInfo = h('p', { class: 'kampf-hp__info' });
        v.total = h('div', { class: 'kampf-total__value num' });
        v.totalSub = h('div', { class: 'kampf-total__sub' });
        v.totalBox = h('div', { class: 'kampf-total' },
          h('div', { class: 'kampf-total__main' },
            h('div', { class: 'kampf-total__label', text: 'Schaden gesamt' }), v.total),
          v.totalSub);
        v.hpCard = h('section', { class: 'card card--danger kampf-hp' },
          h('div', { class: 'kampf-hp__head' },
            h('div', { class: 'kampf-hp__who' },
              h('div', { class: 'kampf-hp__adv', text: enemy.adventure }),
              h('h2', { class: 'kampf-hp__name', text: enemy.name }),
              h('div', { class: 'kampf-hp__weapon' }, ico(weaponIcon(enemy)), h('span', { text: enemy.weapon }))),
            v.hpPct),
          v.hpBar,
          v.xpInfo,
          v.totalBox);

        /* Sieg-Hinweis (sichtbar, sobald der Gegner besiegt ist) */
        v.win = h('section', { class: 'kampf-win', role: 'status', hidden: true },
          h('div', { class: 'kampf-win__icon', html: OP.ui.icon('trophy') }),
          h('div', { class: 'kampf-win__text' },
            h('div', { class: 'kampf-win__title', text: 'Gegner besiegt!' }),
            h('p', { text: 'Du kannst weiter Sätze machen – dein ganzer Schaden wird dein neuer XP-Wert.' })));

        /* Satz-Eingabe (wird nie neu gebaut, solange der Kampf läuft) */
        const entry = OP.ui.setEntry({ addLabel: 'Angriff!', addIcon: 'sword', unitLabel: 'Schaden', onAdd: onAttack });
        entry.el.classList.add('kampf-entry');

        /* Knöpfe */
        v.endBtn = h('button', { class: 'btn btn--lg btn--block', type: 'button', onclick: onFinish }, ico('flag'), 'Kampf beenden');
        v.fleeBtn = h('button', { class: 'btn btn--ghost btn--block kampf-flee', type: 'button', onclick: onFlee }, ico('run'), 'Flucht');
        v.actHint = h('p', { class: 'kampf-actions__hint' });
        const actions = h('div', { class: 'kampf-actions' }, v.endBtn, v.fleeBtn, v.actHint);

        const rules = h('p', { class: 'kampf-rules' }, ico('info'),
          h('span', { text: 'Schaden = Gewicht × Wiederholungen. Körpergewicht-Übungen: dein Körpergewicht zählt.' }));

        /* Sätze */
        v.setCount = h('span', { class: 'chip chip--muted' });
        v.sets = h('div', { class: 'kampf-sets__list' });
        const sets = h('section', { class: 'kampf-sets' },
          OP.ui.sectionTitle('Deine Angriffe', 'sword', v.setCount), v.sets);

        /* Gegner-Akte */
        const facts = [
          ['Art', KIND_NAMES[enemy.kind] || 'Unbekannt'],
          ['Stufe', enemy.tier + ' von 5'],
          ['Waffe', enemy.weapon],
          ['Abenteuer', enemy.adventure]
        ];
        const file = h('section', { class: 'card card--plain kampf-file' },
          h('div', { class: 'kampf-file__head' }, ico('scroll'), h('span', { text: 'Gegner-Akte' })),
          h('dl', { class: 'kampf-file__facts' }, facts.map((p) => [h('dt', { text: p[0] }), h('dd', { text: p[1] })])),
          enemy.lore ? h('p', { class: 'kampf-file__lore', text: enemy.lore }) : null);

        const grid = h('div', { class: 'kampf-grid' },
          h('div', { class: 'kampf-col kampf-col--stage' }, v.stage, v.hpCard, file),
          h('div', { class: 'kampf-col kampf-col--ctrl' }, v.win, entry.el, actions, rules, sets));
        el.appendChild(h('div', { class: 'screen__inner kampf' + (arena ? ' kampf--arena' : '') }, grid));

        // Gegner erst erzeugen, wenn der Container im DOM ist (braucht seine Größe)
        enemyView = createEnemyView(v.holo, enemy, st.hpPct);
        v.enemy = enemy;
        update(true);   // setzt alle Anzeigen; ist der Gegner schon besiegt, liegt er sofort am Boden
      }

      /* ---------- Live-Aktualisierung (ohne die Eingabe anzufassen) ---------- */

      function hpLabel(left, hp) { return 'HP ' + fmtLeft(left) + ' / ' + U.fmt(hp); }

      /** HP-Zahl im Balken weich herunterzählen */
      function tweenHp(target, hp) {
        cancelAnimationFrame(raf);
        const from = v.shownHp, t0 = performance.now(), dur = 600;
        const label = v.hpBar.querySelector('.bar__label');
        if (!label) return;
        if (from === target) { label.textContent = hpLabel(target, hp); return; }
        const step = (now) => {
          if (!alive || !v) return;
          const k = Math.min(1, (now - t0) / dur), ease = 1 - Math.pow(1 - k, 3);
          v.shownHp = k >= 1 ? target : from + (target - from) * ease;
          label.textContent = hpLabel(v.shownHp, hp);
          if (k < 1) raf = requestAnimationFrame(step);
        };
        raf = requestAnimationFrame(step);
      }

      /** Alle Anzeigen auf den aktuellen Stand bringen. instant = ohne Animation (erster Aufbau). */
      function update(instant) {
        if (!v) return;
        const st = OP.game.fightStatus();
        if (!st) return;
        const f = st.fight, pct = st.hpPct * 100;
        const xp = currentXp(f);
        const mName = st.muscle ? st.muscle.name : 'Muskel';

        // HP-Balken + "Schadens-Spur" (hellerer Rest, der verzögert nachläuft)
        OP.ui.setProgress(v.hpBar, pct);
        v.trail.style.width = pct + '%';
        if (instant) { v.shownHp = st.hpLeft; v.hpBar.querySelector('.bar__label').textContent = hpLabel(st.hpLeft, st.hp); }
        else tweenHp(st.hpLeft, st.hp);
        v.hpPct.textContent = st.defeated ? '0 %' : Math.max(1, Math.ceil(pct)) + ' %';

        v.xpInfo.textContent = 'Dein Wert (' + mName + '): ' + U.fmt(xp) + ' XP · Sieg ab ' + U.fmt(st.hp) + ' Schaden';

        // Schaden gesamt
        v.total.textContent = fmtDmg(st.total);
        if (!instant && v.lastTotal !== st.total) replay(v.total, 'is-bump');
        v.lastTotal = st.total;
        if (st.defeated) {
          // Sieg: ganzer Schaden wird der neue Wert (nie weniger als jetzt)
          const next = Math.max(st.total, xp), plus = Math.round(next - xp);
          v.totalSub.textContent = 'Neuer Wert: ' + fmtDmg(next) + ' XP' + (plus > 0 ? ' (+' + U.fmt(plus) + ')' : '');
        } else if (!f.sets.length) {
          v.totalSub.textContent = 'Trag deinen ersten Satz ein.';
        } else {
          v.totalSub.textContent = 'Noch ' + fmtLeft(st.hpLeft) + ' bis zum Sieg';
        }

        // Zustände
        v.stage.classList.toggle('is-defeated', st.defeated);
        v.totalBox.classList.toggle('is-won', st.defeated);
        v.hpCard.classList.toggle('is-won', st.defeated);
        v.win.hidden = !st.defeated;

        // Sätze
        const n = f.sets.length;
        v.setCount.textContent = n + (n === 1 ? ' Satz' : ' Sätze');
        v.sets.innerHTML = '';
        v.sets.appendChild(OP.ui.setList(f.sets, {
          onRemove: askRemove, unitLabel: 'Schaden',
          emptyText: 'Noch kein Angriff. Trag oben deinen ersten Satz ein.'
        }));

        // Knöpfe: ohne Sätze nur Flucht; besiegt = Beenden als Hauptknopf
        v.endBtn.hidden = n === 0;
        v.fleeBtn.hidden = n > 0;
        v.endBtn.className = 'btn btn--lg btn--block ' + (st.defeated ? 'btn--primary kampf-end--win' : 'kampf-end--risky');
        v.actHint.textContent = n === 0
          ? 'Flucht geht nur, solange du noch keinen Satz gemacht hast. Es passiert nichts.'
          : st.defeated
            ? 'Mach weiter, so lange du willst. Beende den Kampf, wenn du fertig bist.'
            : 'Beendest du jetzt, verlierst du den Kampf. Dein Wert bleibt gleich.';

        // Hologramm nachziehen (bei einem neuen Satz macht das onAttack mit Effekten)
        if (!attacking) syncEnemy(st);
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

      /* ---------- Treffer-Effekte ---------- */

      function showHit(dmg, st) {
        if (!v) return;
        const strength = U.clamp(dmg / Math.max(1, st.hp), 0.06, 1);
        const big = dmg / Math.max(1, st.hp) >= 0.2;
        // schwebende Schadenszahl über dem Gegner
        const num = h('div', {
          class: 'kampf-dmg' + (big ? ' kampf-dmg--big' : ''),
          style: { left: (50 + U.rand(-16, 16)) + '%', top: (38 + U.rand(-10, 8)) + '%' },
          text: '-' + fmtDmg(dmg)
        });
        v.fx.appendChild(num);
        later(() => { if (num.parentNode) num.parentNode.removeChild(num); }, 1300);
        replay(v.fx, 'is-flash');
        replay(v.stage, 'is-hit');
        if (enemyView) { enemyView.hit(strength); enemyView.update({ hpPct: st.hpPct }); }
        OP.ui.haptic(big ? [30, 40, 50] : [20, 30, 20]);
      }

      function showDefeat() {
        if (!v || !enemyView || v.defeatedView) return;
        const st = OP.game.fightStatus();
        if (!st || !st.defeated) return;   // inzwischen Satz gelöscht
        enemyView.defeat();
        v.defeatedView = true;
        replay(v.fx, 'is-gold');
        OP.ui.haptic([40, 60, 120]);
      }

      /* ---------- Aktionen ---------- */

      function onAttack(w, r) {
        let res;
        attacking = true;
        try { res = OP.game.addFightSet(w, r); } finally { attacking = false; }
        if (!res || !res.ok) return res || { ok: false, error: 'Das hat nicht geklappt.' };
        // HP-Balken, Summe und Liste hat die 'change'-Meldung schon aktualisiert
        const st = res.status || OP.game.fightStatus();
        if (st) showHit(res.dmg, st);
        if (res.justDefeated) later(showDefeat, 420);
        return res;
      }

      function askRemove(i) {
        const f = OP.state.fight;
        if (!f || !f.sets[i]) return;
        const s = f.sets[i];
        const what = KG_FMT.format(s.w) + ' kg × ' + s.r + ' = ' + U.fmt(s.dmg) + ' Schaden';
        OP.ui.confirm('Satz ' + (i + 1) + ' löschen? (' + what + ')', { title: 'Satz löschen?', okLabel: 'Löschen', danger: true })
          .then((ok) => {
            if (!ok || !alive) return;
            // Sicherheits-Check: ist es noch derselbe Satz?
            const cur = OP.state.fight;
            if (!cur || cur.sets[i] !== s) { OP.ui.toast('Die Liste hat sich geändert. Bitte noch mal.', { type: 'warn' }); return; }
            OP.game.removeFightSet(i);
            OP.ui.toast('Satz gelöscht.', { type: 'info', icon: 'trash' });
          });
      }

      function onFinish() {
        const st = OP.game.fightStatus();
        if (!st) { render(); return; }
        if (!st.fight.sets.length) { onFlee(); return; }
        const ask = st.defeated ? Promise.resolve(true)
          : OP.ui.confirm('Der Gegner lebt noch. Wenn du jetzt beendest, verlierst du den Kampf. Dein Wert bleibt ' +
              U.fmt(currentXp(st.fight)) + ' XP.', { title: 'Kampf beenden?', okLabel: 'Beenden', cancelLabel: 'Weiterkämpfen', danger: true });
        ask.then((ok) => {
          if (!ok || !alive) return;
          busy = true;
          let res;
          try { res = OP.game.finishFight(); } catch (e) { console.error('[kampf] finishFight', e); res = null; }
          if (!res || !res.ok) {
            busy = false;
            OP.ui.toast((res && res.error) || 'Der Kampf konnte nicht beendet werden.', { type: 'err' });
            render();
            return;
          }
          const back = backPath(res.pool || st.fight.pool);
          if (res.cancelled) { OP.ui.go(back); return; }
          const mName = res.muscle ? res.muscle.name : 'Dein Wert';
          const eName = (res.enemy && res.enemy.name) || (st.enemy && st.enemy.name) || '';
          const shown = res.won
            ? OP.ui.celebrate({
                kicker: eName ? eName + ' besiegt' : 'Gegner besiegt',
                title: 'SIEG!', icon: 'trophy', tone: 'gold', big: true,
                text: mName + ': ' + U.fmt(res.oldXp) + ' → ' + U.fmt(res.newXp) + ' XP'
              })
            : OP.ui.celebrate({
                kicker: eName ? 'Gegen ' + eName : null,
                title: 'NIEDERLAGE', icon: 'skull', tone: 'err',
                text: 'Loss Always Builds Strength. Dein Wert bleibt ' + U.fmt(res.oldXp) + ' XP.'
              });
          shown.then(() => {
            if (!alive) return;
            const cur = OP.ui.router.current();
            if (cur && cur.screenId === 'kampf') OP.ui.go(back);
          });
        });
      }

      function onFlee() {
        const st = OP.game.fightStatus();
        if (!st) { render(); return; }
        if (st.fight.sets.length) { OP.ui.toast('Flucht geht nur ohne Sätze. Beende den Kampf.', { type: 'warn' }); return; }
        const back = backPath(st.fight.pool);
        busy = true;
        if (!OP.game.cancelFight()) {
          busy = false;
          OP.ui.toast('Flucht geht gerade nicht.', { type: 'warn' });
          render();
          return;
        }
        OP.ui.toast('Du bist geflohen. Der Gegner wartet noch auf dich.', { type: 'info', icon: 'run' });
        OP.ui.go(back);
      }

      /* ---------- Start ---------- */

      render();

      bag.on('change', () => {
        if (busy || !alive) return;
        if (signature() !== sig) { render(); return; }   // anderer/kein Kampf mehr
        if (v) update(false);
      });

      return bag.run;
    }
  });
})();
