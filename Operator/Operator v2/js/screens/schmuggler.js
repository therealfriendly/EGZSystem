/* Operator – Taverne, Tab "Schmuggler" (Screen 'taverne/schmuggler')
   Kardio-Aufträge: selbst einen aussuchen, Timer läuft sofort. Jeder Erfolg macht den Auftrag schwerer (OP.data.CARDIO_STEP).
   Oben der laufende Auftrag mit großem Countdown, darunter Filter und die Liste aller Aufträge.
   Zirkus-Sperre: Neue Aufträge gehen erst nach einem Zirkus-Tanz. Ein laufender Auftrag bleibt immer abschließbar. */
(function () {
  'use strict';
  var OP = window.OP;
  var U = OP.util, h = OP.h, D = OP.data;

  var NPC = { id: 'schmuggler', name: 'Kurier Grau', role: 'Schmuggler', icon: 'schmuggler' };
  var LINES = [
    'Ich hab Pakete, die schnell wohin müssen. Du bist doch fit, oder?',
    'Keine Fragen, keine Ausreden. Nur Beine und eine Uhr.',
    'Pünktlich liefern, {name}. Das ist alles, was zählt.',
    'Such dir eine Route aus. Der Timer startet, sobald du Ja sagst.'
  ];
  var LINES_ACTIVE = [
    'Die Uhr läuft, {name}. Beweg dich!',
    'Die Ware muss pünktlich ankommen. Lauf!'
  ];
  var LINES_EXPIRED = ['Die Zeit ist um. Und? Ist die Ware angekommen?'];

  /* Lesbare Namen und Icons für die Auftrags-Arten (type aus OP.data.CARDIO).
     Unbekannte Arten bekommen automatisch einen Namen aus dem type-Text. */
  var TYPE_LABELS = {
    schritte: 'Schritte', gehen: 'Gehen', spazieren: 'Spazieren', marsch: 'Marsch', wandern: 'Wandern',
    joggen: 'Joggen', joggen_zeit: 'Joggen (Zeit)', joggen_distanz: 'Joggen (Strecke)', lauf: 'Laufen', laufen: 'Laufen',
    sprint: 'Sprints', sprints: 'Sprints', intervall: 'Intervalle', intervalle: 'Intervalle', hiit: 'HIIT',
    rad: 'Radfahren', radfahren: 'Radfahren', fahrrad: 'Radfahren', schwimmen: 'Schwimmen', rudern: 'Rudern',
    treppen: 'Treppen', stufen: 'Treppen', seil: 'Seilspringen', seilspringen: 'Seilspringen',
    berg: 'Bergauf', hoehenmeter: 'Höhenmeter', huegel: 'Hügel', zirkel: 'Zirkel', kraft: 'Kraft-Ausdauer',
    burpees: 'Burpees', tanzen: 'Tanzen', crosstrainer: 'Crosstrainer', hampelmann: 'Hampelmann',
    rucking: 'Rucksack-Marsch', sonstiges: 'Sonstiges'
  };
  var TYPE_ICONS = {
    schritte: 'steps', gehen: 'steps', spazieren: 'steps', marsch: 'flag', wandern: 'mountain',
    joggen: 'run', joggen_zeit: 'timer', joggen_distanz: 'run', lauf: 'run', laufen: 'run',
    sprint: 'sprint', sprints: 'sprint', intervall: 'sprint', intervalle: 'sprint', hiit: 'bolt',
    rad: 'bike', radfahren: 'bike', fahrrad: 'bike', schwimmen: 'swim', rudern: 'swim',
    treppen: 'stairs', stufen: 'stairs', seil: 'rope', seilspringen: 'rope',
    berg: 'mountain', hoehenmeter: 'mountain', huegel: 'mountain', burpees: 'bolt',
    crosstrainer: 'run', hampelmann: 'body', rucking: 'briefcase', tanzen: 'star'
  };
  var UNIT_ICONS = { schritte: 'steps', km: 'run', sek: 'timer', min: 'clock', wdh: 'rope', hm: 'mountain', stufen: 'stairs', intervall: 'sprint' };

  function typeLabel(type) {
    if (!type) return 'Sonstiges';
    var k = String(type).toLowerCase();
    if (TYPE_LABELS[k]) return TYPE_LABELS[k];
    var t = k.replace(/[_-]+/g, ' ').replace(/ae/g, 'ä').replace(/oe/g, 'ö').replace(/ue/g, 'ü');
    return t.charAt(0).toUpperCase() + t.slice(1);
  }
  function jobIcon(def) {
    if (!def) return 'schmuggler';
    return TYPE_ICONS[String(def.type || '').toLowerCase()] || UNIT_ICONS[def.unit] || 'run';
  }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  /** Millisekunden -> "mm:ss" (Minuten dürfen über 59 gehen, z. B. "63:00") */
  function clock(ms) {
    var s = Math.max(0, Math.ceil(ms / 1000));
    return pad2(Math.floor(s / 60)) + ':' + pad2(s % 60);
  }

  // Abbrechen ohne Wertung nur in den ersten Minuten (Regel aus game.cardioCancel; 5, bis es OP.data.CARDIO_CANCEL_MIN gibt)
  var CANCEL_MIN = D.CARDIO_CANCEL_MIN || 5;
  var CANCEL_MS = CANCEL_MIN * 60000;
  // "+5 %" pro Erfolg, aus OP.data.CARDIO_STEP (1.05)
  var STEP_PCT = String(Math.round(((D.CARDIO_STEP || 1.05) - 1) * 1000) / 10).replace('.', ',') + ' %';
  var RING_R = 52, RING_C = 2 * Math.PI * RING_R;
  var filterType = 'alle';             // bleibt beim Tab-Wechsel erhalten

  var RELEVANT = ['cardio-start', 'cardio-end', 'cardio-cancel', 'import', 'reset', 'setup', 'player', 'sync', 'new-day',
    'abs', 'dance-start', 'dance-skip', 'dance-end'];

  OP.screens.register('taverne/schmuggler', {
    title: 'Schmuggler', icon: 'schmuggler', tone: 'gold',
    mount: function (el) {
      var bag = OP.ui.cleanup();
      var T = OP.tav;
      var ico = T.ico;
      var seed = Math.random();
      var alive = true;
      var live = null;   // Verweise auf die Countdown-Elemente des laufenden Auftrags

      /* ---------- Aktionen ---------- */

      function askStart(info) {
        var def = info.def;
        var body = h('div', { class: 'stack tav-ask' },
          def.text ? h('p', { class: 'tav-ask__story', text: def.text }) : null,
          h('div', { class: 'tav-ask__req' }, ico(jobIcon(def)), h('span', { class: 'num', text: info.text })),
          def.how ? h('p', { class: 'muted small', text: def.how }) : null,
          h('p', { class: 'tav-ask__warn' }, ico('timer'),
            h('span', { text: 'Der Timer läuft sofort. Schaffst du es nicht in der Zeit, ist der Auftrag verloren. Sei ehrlich zu dir.' })));
        OP.ui.modal({
          title: def.name || 'Auftrag', body: body,
          actions: [
            { label: 'Abbrechen', kind: 'ghost' },
            { label: 'Timer starten', kind: 'gold', icon: 'play', onClick: function () { start(def.id); } }
          ]
        });
      }

      function start(id) {
        var r = OP.game.cardioStart(id);
        if (r && r.locked) { OP.ui.lockHint(r.error || D.LOCK_TEXT); render(); return; }
        if (!r || !r.ok) { OP.ui.toast((r && r.error) || 'Auftrag konnte nicht starten.', { type: 'warn' }); return; }
        OP.ui.haptic([20, 40, 20]);
        OP.ui.toast('Timer läuft. Viel Erfolg!', { type: 'gold', icon: 'timer' });
        try { el.scrollTo({ top: 0, behavior: 'smooth' }); } catch (e) { el.scrollTop = 0; }
      }

      function resolve(success) {
        var st = OP.game.cardioStatus();
        var name = (st && st.def && st.def.name) || 'Auftrag';
        var r = OP.game.cardioResolve(success);
        if (!r || !r.ok) { OP.ui.toast((r && r.error) || 'Kein Auftrag aktiv.', { type: 'warn' }); return; }
        if (r.won) {
          var next = r.next;
          OP.ui.celebrate({
            kicker: name, title: 'Lieferung zugestellt!', tone: 'ok', icon: 'schmuggler',
            text: next ? 'Nächste Stufe ' + (next.wins + 1) + ': ' + next.text : 'Stark gemacht!'
          });
        } else {
          OP.ui.celebrate({
            kicker: name, title: 'Auftrag verloren', tone: 'err', icon: 'skull',
            text: 'Loss Always Builds Strength. Versuch es wieder.', button: 'Okay'
          });
        }
      }

      function askFail() {
        OP.ui.confirm('Der Auftrag zählt dann als verloren. Die Stufe bleibt gleich.', {
          title: 'Nicht geschafft?', okLabel: 'Ja, verloren', danger: true
        }).then(function (yes) { if (yes) resolve(false); });
      }

      function cancel() {
        OP.ui.confirm('Der Auftrag wird ohne Wertung beendet. Das geht nur in den ersten ' + CANCEL_MIN + ' Minuten.', {
          title: 'Auftrag abbrechen?', okLabel: 'Ja, abbrechen', cancelLabel: 'Weiterlaufen', danger: true
        }).then(function (yes) {
          if (!yes) return;
          if (OP.game.cardioCancel()) OP.ui.toast('Auftrag abgebrochen.', { type: 'info' });
          else OP.ui.toast('Die ' + CANCEL_MIN + ' Minuten sind vorbei. Jetzt nur noch Geschafft oder Nicht geschafft.', { type: 'warn' });
        });
      }

      /* ---------- Laufender Auftrag ---------- */

      function activeCard(st) {
        var a = st.active, def = st.def || {};
        var ring = h('div', { class: 'tav-ring', html:
          '<svg viewBox="0 0 120 120" aria-hidden="true">' +
          '<circle class="tav-ring__track" cx="60" cy="60" r="' + RING_R + '"/>' +
          '<circle class="tav-ring__ticks" cx="60" cy="60" r="' + (RING_R - 9) + '"/>' +
          '<circle class="tav-ring__fill" cx="60" cy="60" r="' + RING_R + '" stroke-dasharray="' + RING_C.toFixed(2) + '" stroke-dashoffset="' + RING_C.toFixed(2) + '"/>' +
          '</svg>' });
        var time = h('div', { class: 'tav-ring__time num', text: clock(st.msLeft) });
        var label = h('div', { class: 'tav-ring__label', text: st.expired ? 'Zeit abgelaufen' : 'übrig' });
        ring.appendChild(h('div', { class: 'tav-ring__center' }, time, label));

        var cancelBtn = h('button', { class: 'btn btn--ghost btn--sm tav-run__cancel', type: 'button', onclick: cancel }, ico('close'), 'Abbrechen');
        var cancelWrap = h('div', { class: 'tav-run__cancel-wrap' }, cancelBtn);

        var question = st.expired
          ? h('p', { class: 'tav-run__ask' }, ico('warning'), h('span', { text: 'Hast du es rechtzeitig geschafft?' }))
          : null;

        var card = h('section', { class: 'card card--gold tav-card tav-run' + (st.expired ? ' is-expired' : '') },
          h('div', { class: 'tav-run__kicker' },
            h('span', { class: 'tav-run__pulse', 'aria-hidden': 'true' }),
            h('span', { text: st.expired ? 'Auftrag wartet auf Antwort' : 'Laufender Auftrag' })),
          h('div', { class: 'tav-run__main' },
            ring,
            h('div', { class: 'tav-run__info' },
              h('div', { class: 'tav-run__type' }, ico(jobIcon(def)), h('span', { text: typeLabel(def.type) })),
              h('h3', { class: 'tav-run__name', text: def.name || 'Auftrag' }),
              h('div', { class: 'tav-run__req num', text: a.text || '' }),
              h('div', { class: 'tav-run__times small muted' },
                'Start ' + U.timeLabel(a.startedAt) + ' · Ende ' + U.timeLabel(a.deadline) + ' Uhr'),
              def.how ? h('p', { class: 'tav-run__how', text: def.how }) : null)),
          question,
          h('div', { class: 'tav-run__actions' },
            h('button', { class: 'btn btn--ok btn--lg', type: 'button', onclick: function () { resolve(true); } }, ico('check'), 'Geschafft'),
            h('button', { class: 'btn btn--ghost btn--lg tav-run__fail', type: 'button', onclick: askFail }, ico('close'), 'Nicht geschafft')),
          cancelWrap);

        live = { card: card, time: time, label: label, fill: ring.querySelector('.tav-ring__fill'), cancelWrap: cancelWrap, cancelBtn: cancelBtn, expired: st.expired };
        updateLive(st);
        return card;
      }

      /** Countdown, Ring und Abbrechen-Knopf aktualisieren (jede Sekunde) */
      function updateLive(st) {
        if (!live) return;
        var a = st.active, now = Date.now();
        var total = Math.max(1, a.deadline - a.startedAt);
        var frac = U.clamp((now - a.startedAt) / total, 0, 1);
        live.time.textContent = clock(st.msLeft);
        if (live.fill) live.fill.setAttribute('stroke-dashoffset', (RING_C * (1 - frac)).toFixed(2));
        live.card.classList.toggle('is-late', !st.expired && (st.msLeft < 60000 || frac > 0.9));
        var since = now - a.startedAt;
        var canCancel = since < CANCEL_MS && !st.expired;
        live.cancelWrap.hidden = !canCancel;
        if (canCancel) live.cancelBtn.lastChild.textContent = 'Abbrechen (noch ' + clock(CANCEL_MS - since).replace(/^0/, '') + ')';
      }

      function tick() {
        if (!alive) return;
        var st = null;
        try { st = OP.game.cardioStatus(); } catch (e) { st = null; }
        if (!st) { if (live) render(); return; }
        if (!live || live.expired !== st.expired) { render(); return; }
        updateLive(st);
      }

      /* ---------- Liste ---------- */

      function jobItem(info, active, locked) {
        var def = info.def;
        var running = !!(active && active.id === def.id);
        var busy = !!active || !!locked;
        var record = (info.wins || info.fails)
          ? h('span', { class: 'tav-job__record' },
              h('span', { class: 'tone-ok' }, ico('check'), String(info.wins)),
              h('span', { class: 'tone-err' }, ico('close'), String(info.fails)))
          : h('span', { class: 'tav-job__record faint', text: 'Noch nie versucht' });
        return h('article', { class: 'card card--plain tav-job' + (running ? ' tav-job--running' : '') },
          h('div', { class: 'tav-job__head' },
            h('span', { class: 'tav-job__badge' }, ico(jobIcon(def))),
            h('div', { class: 'tav-job__names' },
              h('h3', { class: 'tav-job__name', text: def.name || def.id }),
              h('span', { class: 'tav-job__type', text: typeLabel(def.type) })),
            h('span', { class: 'chip chip--gold tav-job__lvl num', text: 'Stufe ' + (info.wins + 1) })),
          h('div', { class: 'tav-job__req num', text: info.text }),
          def.how ? h('p', { class: 'tav-job__how', text: def.how }) : null,
          h('div', { class: 'tav-job__foot' },
            record,
            running
              ? h('span', { class: 'chip chip--gold' }, ico('timer'), 'Läuft')
              : h('button', { class: 'btn btn--gold btn--sm tav-job__accept', type: 'button', disabled: busy,
                  'aria-label': locked ? 'Annehmen (gesperrt)' : null,
                  onclick: function () { askStart(info); } }, locked ? ico('lock') : null, 'Annehmen')));
      }

      /* ---------- Aufbau ---------- */

      function build() {
        live = null;
        var st = null, list = [];
        try { st = OP.game.cardioStatus(); } catch (e) { st = null; }
        try { list = OP.game.cardioList().filter(function (i) { return i && i.def; }); } catch (e) { list = []; }
        var active = st ? st.active : null;
        // Zirkus-Sperre gilt nur ohne laufenden Auftrag (der muss immer abschließbar bleiben)
        var lockOn = T.isLocked('schmuggler');
        var locked = !active && lockOn;

        // Arten mit Anzahl (Reihenfolge wie in den Daten)
        var types = [], counts = {};
        list.forEach(function (i) {
          var t = i.def.type || 'sonstiges';
          if (!counts[t]) { counts[t] = 0; types.push(t); }
          counts[t]++;
        });
        if (filterType !== 'alle' && !counts[filterType]) filterType = 'alle';

        function chip(id, label, n) {
          return h('button', {
            class: 'chip chip--btn tav-filter' + (filterType === id ? ' is-on' : ''), type: 'button',
            'aria-pressed': filterType === id ? 'true' : 'false',
            onclick: function () { filterType = id; render(); }
          }, label, h('span', { class: 'tav-filter__n', text: String(n) }));
        }
        var chips = [chip('alle', 'Alle', list.length)].concat(types.map(function (t) { return chip(t, typeLabel(t), counts[t]); }));
        var shown = list.filter(function (i) { return filterType === 'alle' || (i.def.type || 'sonstiges') === filterType; });

        var inner = h('div', { class: 'screen__inner tav tav--schmuggler' },
          locked ? T.lockCard('Ein einziger Eintrag im Zirkus entsperrt die Aufträge wieder – das Ziel musst du nicht schaffen.') : null,
          // Sperre, während noch ein Auftrag läuft: der Auftrag bleibt abschließbar, danach ist der Schmuggler zu
          active && lockOn ? T.infoLine(D.LOCK_TEXT + ' Deinen laufenden Auftrag kannst du noch abschließen.', 'lock', 'tav-info--lock') : null,
          T.merchant(NPC, T.greet(st ? (st.expired ? LINES_EXPIRED : LINES_ACTIVE) : LINES, seed)),
          st ? activeCard(st) : null,
          T.infoLine('Jeder Erfolg macht den Auftrag ' + STEP_PCT + ' schwerer. Nicht in der Zeit geschafft = Auftrag verloren.', 'info'),
          OP.ui.sectionTitle('Aufträge', 'schmuggler', h('span', { class: 'chip chip--muted', text: list.length + ' Routen' })),
          list.length ? h('div', { class: 'tav-filters', role: 'group', 'aria-label': 'Nach Art filtern' }, chips) : null,
          active ? T.infoLine('Es läuft schon ein Auftrag. Schließ ihn erst ab, dann kannst du den nächsten annehmen.', 'lock', 'tav-info--warn') : null,
          list.length
            ? h('div', { class: 'tav-grid tav-jobs' }, shown.map(function (i) { return jobItem(i, active, locked); }))
            : h('div', { class: 'empty' }, h('div', { class: 'empty__icon', html: OP.ui.icon('schmuggler') }),
                h('p', { text: 'Noch keine Aufträge da. Die Kardio-Liste fehlt.' })));

        el.innerHTML = '';
        el.appendChild(inner);
      }

      function render() {
        if (!alive) return;
        // horizontale Position der Filter-Leiste (Handy) behalten
        var fl = el.querySelector('.tav-filters'), sl = fl ? fl.scrollLeft : 0;
        T.keepInputs(el, build);
        fl = el.querySelector('.tav-filters');
        if (fl && sl) fl.scrollLeft = sl;
      }

      render();
      bag.interval(tick, 1000);
      bag.on('change', function (e) {
        var reason = (e && e.reason) || '';
        if (alive && RELEVANT.indexOf(reason) >= 0) render();
      });
      bag.add(function () { alive = false; });
      return bag.run;
    }
  });
})();
