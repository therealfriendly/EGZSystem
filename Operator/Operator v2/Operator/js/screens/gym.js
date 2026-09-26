/* Operator – Haus › Gym (Bildschirm 'haus/gym')
   Regel aus der Spielidee:
   - "Training beginnen" = Wert um genau 1 % steigern (Regel-Wert: OP.data.GYM_GOAL_PCT).
   - Muskelgruppe wählen -> aktueller XP (z. B. 2.000) -> Ziel 2.020 (OP.game.gymTarget).
     Während des Trainings gilt immer OP.game.gymStatus().target (kann steigen, wenn der Wert steigt).
   - Sätze eintragen (24 kg × 10 = 240 XP). Die Sätze werden addiert, bis man fertig ist.
   - Ziel nicht erreicht: nichts ändert sich. Darüber (z. B. 2.021): genau das wird der neue XP-Wert.
   Alle Änderungen laufen über OP.game (startGym, addGymSet, removeGymSet, finishGym, cancelGym).
   #/haus/gym/arme markiert eine Muskelgruppe vor. */
(function () {
  'use strict';
  var OP = window.OP;
  if (!OP || !OP.screens) return;
  var U = OP.util, h = OP.h, D = OP.data;

  var NB = '\u00a0';   // geschütztes Leerzeichen: Zahl und Einheit bleiben in einer Zeile
  // Ziel-Aufschlag aus den Regeln (D.GYM_GOAL_PCT), z. B. "+1 %"
  var GOAL_PCT = Number(D.GYM_GOAL_PCT) || 1;
  var GOAL_TXT = '+' + U.fmt1(GOAL_PCT).replace(/,0$/, '') + NB + '%';

  /* ---------- kleine Helfer ---------- */

  function icon(name) { return OP.ui.icon(name); }
  function kgText(w) { return U.fmt1(w).replace(/,0$/, ''); }
  function xpText(n) { return U.fmt(n) + NB + 'XP'; }

  function muscleXp(id) {
    var m = OP.state && OP.state.muscles && OP.state.muscles[id];
    return m && isFinite(Number(m.xp)) ? Number(m.xp) : 0;
  }

  /** Letzter Trainingstag je Muskelgruppe (Gym oder Kampf mit Sätzen) -> {muskelId: 'YYYY-MM-DD'} */
  function lastTrainingDays() {
    var res = {}, log = OP.state && Array.isArray(OP.state.log) ? OP.state.log : [];
    for (var i = log.length - 1; i >= 0; i--) {
      var e = log[i];
      if (!e || !e.muscle || res[e.muscle]) continue;
      if ((e.type === 'gym' || e.type === 'fight') && e.sets > 0 && e.day) res[e.muscle] = e.day;
    }
    return res;
  }

  function agoText(day) {
    if (!day) return 'Noch nicht trainiert';
    var n = U.diffDays(day, U.today());
    if (!isFinite(n)) return '';
    if (n <= 0) return 'Zuletzt: heute';
    if (n === 1) return 'Zuletzt: gestern';
    return 'Zuletzt: vor ' + n + ' Tagen';
  }

  /** Methode am Hologramm sicher aufrufen (Handle kann fehlen oder ein Ersatz sein) */
  function safe(handle, fn, arg) {
    if (!handle || typeof handle[fn] !== 'function') return;
    try { handle[fn](arg); } catch (e) { console.error('[gym] holo.' + fn, e); }
  }

  /* ---------- Hologramm-Körper ---------- */

  /** three.js-Körper im Fokus-Modus. Fehlt OP.holo, gibt es einen einfachen Ersatz mit gleichem API. */
  function createBody(box, focus) {
    if (OP.holo && typeof OP.holo.body === 'function') {
      try {
        var hd = OP.holo.body(box, { mode: 'focus', focus: focus || null, autoRotate: true, interactive: true });
        if (hd) return hd;
      } catch (e) {
        console.error('[gym] Hologramm', e);
        box.innerHTML = '';
      }
    }
    return fallbackBody(box, focus);
  }

  /** Ersatz ohne three.js: Scanner-Ring mit dem Muskel-Icon */
  function fallbackBody(box, focus) {
    var ico = h('div', { class: 'gym-scan__icon' });
    var label = h('div', { class: 'gym-scan__label' });
    var wrap = h('div', { class: 'gym-scan' }, h('div', { class: 'gym-scan__ring' }, ico), label);
    box.appendChild(wrap);
    function show(id) {
      var m = id ? D.muscle(id) : null;
      ico.innerHTML = icon(m ? m.icon : 'body');
      label.textContent = m ? m.name : 'Körper-Scan';
      wrap.classList.toggle('is-focus', !!m);
    }
    show(focus);
    return {
      update: function (o) { if (o && Object.prototype.hasOwnProperty.call(o, 'focus')) show(o.focus); },
      pulse: function () { wrap.classList.remove('is-pulse'); void wrap.offsetWidth; wrap.classList.add('is-pulse'); },
      destroy: function () { if (wrap.parentNode) wrap.parentNode.removeChild(wrap); }
    };
  }

  /* ================= Bildschirm ================= */

  OP.screens.register('haus/gym', {
    title: 'Gym', icon: 'gym',
    mount: function (el, params) {
      var bag = OP.ui.cleanup();
      var wanted = params && params[0] ? String(params[0]).toLowerCase() : null;
      if (wanted && !D.muscle(wanted)) wanted = null;

      var viewKey = null;   // 'pick' oder 'session:<muskel>:<start>'
      var view = null;      // {root, after(), refresh()}
      var viewBag = null;   // Aufräumen der aktuellen Ansicht (Hologramm, Timer)

      function keyNow() {
        var g = OP.state && OP.state.gym;
        return g ? 'session:' + g.muscle + ':' + g.started : 'pick';
      }

      function render() {
        if (viewBag) viewBag.run();
        viewBag = OP.ui.cleanup();
        el.innerHTML = '';
        viewKey = keyNow();
        view = viewKey === 'pick' ? buildPick(viewBag) : buildSession(viewBag);
        el.appendChild(view.root);
        if (view.after) view.after();
      }

      /* ---------- Ansicht 1: Muskelgruppe wählen ---------- */
      function buildPick(vb) {
        var selected = wanted;
        var body = null;
        var holoBox = h('div', { class: 'gym-holo' });
        var cards = h('div', { class: 'gym-cards' });

        function focusBody(id) { safe(body, 'update', { focus: id || null }); }

        function select(id) {
          selected = id;
          cards.querySelectorAll('.gym-card').forEach(function (c) {
            c.classList.toggle('is-selected', c.dataset.muscle === id);
          });
          focusBody(id);
        }

        function start(id) {
          var res = OP.game.startGym(id);
          if (!res || !res.ok) {
            OP.ui.toast((res && res.error) || 'Training konnte nicht starten.', { type: 'warn' });
            return;
          }
          wanted = null;
          OP.ui.haptic(20);
          // Das 'change'-Event baut die Trainings-Ansicht auf.
        }

        // Hover / Fokus / Antippen lässt die Muskelgruppe im Hologramm leuchten
        function cardEvents(id) {
          return {
            onmouseenter: function () { focusBody(id); },
            onmouseleave: function () { focusBody(selected); },
            onfocusin: function () { focusBody(id); },
            onclick: function (e) { if (!e.target.closest('button')) select(id); }
          };
        }

        function muscleCard(m, lastDay) {
          var xp = muscleXp(m.id), r = OP.game.rankFor(m.id), target = OP.game.gymTarget(xp);
          var rankLine = r.next
            ? h('div', { class: 'gym-card__rank' },
                OP.ui.progress(r.progress * 100, { thin: true, tone: 'gold' }),
                h('span', { class: 'tiny faint', text: 'Noch ' + xpText(r.toNext) + ' bis ' + r.next.name }))
            : h('div', { class: 'gym-card__rank tiny tone-gold', text: 'Höchster Rang erreicht' });
          return h('article', Object.assign({
            class: 'gym-card card' + (selected === m.id ? ' is-selected' : ''),
            dataset: { muscle: m.id }
          }, cardEvents(m.id)),
            h('div', { class: 'gym-card__head' },
              h('span', { class: 'gym-card__icon', html: icon(m.icon) }),
              h('div', { class: 'gym-card__name' },
                h('h3', { text: m.name }),
                h('div', { class: 'tiny faint', text: agoText(lastDay) })),
              OP.ui.rankBadge(r.rank, { small: true })),
            h('div', { class: 'gym-card__main' },
              h('div', { class: 'gym-card__xp num' }, U.fmt(xp), h('small', { text: 'XP' })),
              h('div', { class: 'gym-card__goal' },
                h('span', { class: 'gym-card__goal-label', text: 'Ziel heute' }),
                h('span', { class: 'gym-card__goal-val num' }, xpText(target) + ' ', h('small', { text: '(' + GOAL_TXT + ')' })))),
            rankLine,
            h('button', { class: 'btn btn--primary btn--block', type: 'button', onclick: function () { start(m.id); } },
              h('span', { html: icon('play') }), 'Training beginnen'));
        }

        // Bauch ist keine Gym-Gruppe, sondern eine Challenge in der Taverne
        function bauchCard() {
          var ar = OP.game.absRank();
          var p = OP.state.abs && OP.state.abs.plank ? OP.state.abs.plank : {};
          var plank = Number(p.best) || 0, plankTarget = Number(p.target) || 0;
          return h('article', Object.assign({
            class: 'gym-card gym-card--bauch card card--gold' + (selected === 'bauch' ? ' is-selected' : ''),
            dataset: { muscle: 'bauch' }
          }, cardEvents('bauch')),
            h('div', { class: 'gym-card__head' },
              h('span', { class: 'gym-card__icon', html: icon('bauch') }),
              h('div', { class: 'gym-card__name' },
                h('h3', { text: 'Bauch' }),
                h('div', { class: 'tiny faint', text: 'Challenge statt Gym' })),
              OP.ui.rankBadge(ar.rank, { small: true })),
            h('p', { class: 'gym-card__text small muted',
              text: 'Den Bauch trainierst du nicht hier. Er ist eine Challenge: Plank, seitliche Planks, Crunches und Sit-ups bei den Zirkus-Tänzen in der Taverne.' }),
            h('div', { class: 'gym-card__main' },
              h('div', { class: 'gym-card__goal gym-card__goal--left' },
                h('span', { class: 'gym-card__goal-label', text: 'Beste Plank' }),
                h('span', { class: 'gym-card__goal-val num', text: U.secs(plank) })),
              plankTarget ? h('div', { class: 'gym-card__goal' },
                h('span', { class: 'gym-card__goal-label', text: 'Nächstes Ziel' }),
                h('span', { class: 'gym-card__goal-val num', text: U.secs(plankTarget) })) : null),
            h('button', { class: 'btn btn--gold btn--block', type: 'button', onclick: function () { OP.ui.go('taverne/zirkus'); } },
              h('span', { html: icon('zirkus') }), 'Zu den Zirkus-Tänzen'));
        }

        function fillCards() {
          cards.innerHTML = '';
          var last = lastTrainingDays();
          D.MUSCLES.forEach(function (m) { cards.appendChild(muscleCard(m, last[m.id])); });
          cards.appendChild(bauchCard());
        }
        fillCards();

        var hero = h('section', { class: 'gym-hero card card--plain' },
          holoBox,
          h('div', { class: 'gym-hero__text' },
            h('div', { class: 'gym-kicker', text: 'Gym · ' + GOAL_TXT + ' pro Training' }),
            h('h2', { class: 'gym-hero__title', text: 'Was trainierst du heute?' }),
            h('p', { class: 'small muted', text: 'Dein Ziel ist immer genau ' + GOAL_TXT + '. Deine Sätze werden addiert. Schaffst du das Ziel, wird die Summe dein neuer Wert. Sonst bleibt alles, wie es ist.' }),
            h('ol', { class: 'gym-steps' },
              h('li', {}, h('b', { text: '1' }), 'Muskel wählen'),
              h('li', {}, h('b', { text: '2' }), 'Sätze eintragen'),
              h('li', {}, h('b', { text: '3' }), 'Ziel knacken'))));

        var root = h('div', { class: 'screen__inner gym' }, h('div', { class: 'gym-pick' }, hero, cards));

        return {
          root: root,
          refresh: fillCards,
          after: function () {
            body = createBody(holoBox, selected);
            vb.add(function () { safe(body, 'destroy'); body = null; });
            if (selected) {
              var c = cards.querySelector('[data-muscle="' + selected + '"]');
              if (c && c.scrollIntoView) {
                requestAnimationFrame(function () {
                  try { c.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) { /* alter Browser */ }
                });
              }
            }
          }
        };
      }

      /* ---------- Ansicht 2: Training läuft ---------- */
      function buildSession(vb) {
        var g = OP.state.gym;
        var mid = g.muscle;
        var m = D.muscle(mid) || { id: mid, name: 'Unbekannt', icon: 'gym' };
        var body = null;

        // Start und Ziel kommen immer aus OP.game.gymStatus(): Steigt der Wert während des Trainings
        // (z. B. Kampf gewonnen), steigt auch das Ziel mit.
        function startOf(st) { return Math.max(Number(st.gym.startXp) || 0, muscleXp(mid)); }

        var holoBox = h('div', { class: 'gym-holo gym-holo--live' });
        var totalEl = h('span', { class: 'gym-live__total num', text: '0' });
        var ofEl = h('span', { class: 'gym-live__of num' });
        var bigEl = h('div', { class: 'gym-live__big' }, totalEl, ofEl);
        var startEl = h('b', { class: 'num' });
        var goalEl = h('b', { class: 'num' });
        var rankBox = h('span', { class: 'gym-live__rank' });
        var bar = OP.ui.progress(0, { label: ' ' });
        bar.classList.add('bar--lg');
        var hintEl = h('p', { class: 'gym-live__hint small' });
        var listBox = h('div', { class: 'gym-sets__list' });
        var countEl = h('span', { class: 'chip chip--muted', text: '0 Sätze' });
        var actions = h('div', { class: 'gym-actions' });
        var entry = OP.ui.setEntry({ onAdd: addSet, addLabel: 'Satz eintragen', unitLabel: 'XP' });

        var live = h('section', { class: 'gym-live card card--glow' },
          h('div', { class: 'gym-live__head' },
            h('span', { class: 'gym-card__icon', html: icon(m.icon) }),
            h('div', { class: 'gym-card__name' },
              h('div', { class: 'gym-kicker', text: 'Training läuft' }),
              h('h2', { class: 'gym-live__title', text: m.name })),
            rankBox),
          h('div', { class: 'gym-live__route' },
            h('span', { class: 'gym-live__step' }, h('small', { text: 'Start' }), startEl),
            h('span', { class: 'gym-live__arrow', html: icon('next') }),
            h('span', { class: 'gym-live__step gym-live__step--goal' }, h('small', { text: 'Ziel (' + GOAL_TXT + ')' }), goalEl)),
          h('div', { class: 'gym-live__grid' },
            holoBox,
            h('div', { class: 'gym-live__nums' },
              h('div', { class: 'gym-kicker gym-kicker--dim', text: 'Summe deiner Sätze' }),
              bigEl, bar, hintEl)));

        var setsSec = h('section', { class: 'gym-sets' },
          OP.ui.sectionTitle('Deine Sätze', 'gym', countEl), listBox);

        var root = h('div', { class: 'screen__inner gym' },
          h('div', { class: 'gym-session' },
            h('div', { class: 'gym-session__a' }, live),
            h('div', { class: 'gym-session__b' }, entry.el, setsSec, actions)));

        // Dauer im Kopf der Seite
        var timeEl = h('span', { text: '' });
        var chip = h('span', { class: 'chip gym-chip', title: 'Trainingsdauer' }, h('span', { html: icon('timer') }), timeEl);
        function tick() {
          var min = Math.max(0, Math.floor((Date.now() - (Number(g.started) || Date.now())) / 60000));
          timeEl.textContent = min < 1 ? '< 1 min' : (min < 60 ? min + ' min' : Math.floor(min / 60) + ' h ' + (min % 60) + ' min');
        }

        function addSet(w, r) {
          var res = OP.game.addGymSet(w, r);
          if (!res || !res.ok) return res || { ok: false, error: 'Satz konnte nicht gespeichert werden.' };
          floatGain(res.xp);
          safe(body, 'pulse', mid);
          if (res.justReached) {
            OP.ui.toast('Ziel erreicht! Jeder weitere Satz zählt mit.', { type: 'ok', icon: 'check' });
            OP.ui.haptic([20, 40, 30]);
            live.classList.remove('is-flash'); void live.offsetWidth; live.classList.add('is-flash');
          }
          return res;
        }

        // kleine "+240 XP"-Animation über der großen Zahl
        function floatGain(xp) {
          var f = h('span', { class: 'gym-float num', text: '+' + xpText(xp) });
          bigEl.appendChild(f);
          setTimeout(function () { if (f.parentNode) f.parentNode.removeChild(f); }, 1100);
        }

        function removeSet(i) {
          var gym = OP.state.gym;
          if (!gym || !gym.sets || !gym.sets[i]) return;
          var s = gym.sets[i];
          OP.ui.confirm('Satz ' + (i + 1) + ' löschen? ' + kgText(s.w) + NB + 'kg × ' + s.r + ' = ' + xpText(s.dmg),
            { title: 'Satz löschen', okLabel: 'Löschen', danger: true }).then(function (ok) {
            if (!ok || !OP.state.gym) return;
            var idx = OP.state.gym.sets.indexOf(s);   // Index kann sich inzwischen verschoben haben
            if (idx >= 0) OP.game.removeGymSet(idx);
          });
        }

        function cancel() {
          if (!OP.game.cancelGym()) {
            OP.ui.toast('Es gibt schon Sätze. Beende das Training stattdessen.', { type: 'warn' });
            return;
          }
          OP.ui.toast('Training abgebrochen. Nichts hat sich geändert.', { type: 'info' });
        }

        function finish() {
          var st = OP.game.gymStatus();
          if (!st) return;
          if (!st.gym.sets.length) { cancel(); return; }
          if (st.reached) { showResult(OP.game.finishGym()); return; }
          OP.ui.confirm('Ziel nicht erreicht. Dein Wert bleibt ' + xpText(muscleXp(mid)) + '. Trotzdem beenden?',
            { title: 'Training beenden?', okLabel: 'Beenden', cancelLabel: 'Weiter trainieren' }).then(function (ok) {
            if (!ok || !OP.state.gym) return;
            showResult(OP.game.finishGym());
          });
        }

        function showResult(res) {
          if (!res || !res.ok) { OP.ui.toast((res && res.error) || 'Beenden hat nicht geklappt.', { type: 'err' }); return; }
          if (res.cancelled) return;
          var name = (res.muscle && res.muscle.name) || m.name;
          if (res.won) {
            var text = name + ': ' + U.fmt(res.oldXp) + ' → ' + xpText(res.newXp);
            var pct = res.oldXp > 0 ? (res.newXp / res.oldXp - 1) * 100 : 0;
            if (pct >= GOAL_PCT + 0.05) text += ' (+' + U.fmt1(pct) + NB + '%)';   // mehr als das Ziel geschafft
            var r0 = OP.game.rankFor(mid, res.oldXp), r1 = OP.game.rankFor(mid, res.newXp);
            if (r1.index > r0.index) text += '. Neuer Rang: ' + r1.rank.name + '!';
            OP.ui.celebrate({ kicker: 'Gym', title: GOAL_TXT + ' geschafft!', text: text, icon: m.icon || 'gym', tone: 'ok' });
          } else {
            OP.ui.toast('Training beendet. ' + name + ' bleibt bei ' + xpText(res.newXp) + '.', { type: 'info' });
          }
        }

        function fillActions(st) {
          actions.innerHTML = '';
          if (!st.gym.sets.length) {
            actions.appendChild(h('button', { class: 'btn btn--ghost btn--block', type: 'button', onclick: cancel },
              h('span', { html: icon('close') }), 'Abbrechen'));
            actions.appendChild(h('p', { class: 'tiny faint center', text: 'Ohne Satz kannst du einfach abbrechen. Es ändert sich nichts.' }));
            return;
          }
          actions.appendChild(h('button', {
            class: 'btn btn--lg btn--block ' + (st.reached ? 'btn--ok' : 'btn--ghost'), type: 'button', onclick: finish
          }, h('span', { html: icon(st.reached ? 'check' : 'stop') }), 'Training beenden'));
        }

        // Nur Anzeige-Teile auffrischen – das Eingabe-Formular bleibt stehen (flüssiges Tippen)
        var shownStart = null;
        function refresh() {
          var st = OP.game.gymStatus();
          if (!st) return;
          var over = st.total - st.target, n = st.gym.sets.length, start = startOf(st);
          // Start/Ziel/Rang nur neu zeichnen, wenn sich der Wert geändert hat
          if (start !== shownStart) {
            shownStart = start;
            startEl.textContent = xpText(start);
            rankBox.innerHTML = '';
            rankBox.appendChild(OP.ui.rankBadge(OP.game.rankFor(mid, start).rank, { small: true }));
          }
          goalEl.textContent = xpText(st.target);
          ofEl.textContent = '/' + NB + xpText(st.target);
          // Summen sind ganze Zahlen (Satz = gerundet). Alte Sätze mit Komma: nie "1.818 / 1.818" zeigen, solange es nicht reicht.
          totalEl.textContent = U.fmt(st.reached ? st.total : Math.floor(st.total));
          OP.ui.setProgress(bar, st.progress * 100, st.reached
            ? (over >= 0.5 ? 'Ziel erreicht · +' + xpText(over) + ' drüber' : 'Ziel erreicht')
            : 'Noch ' + xpText(Math.ceil(st.left)));
          bar.classList.toggle('bar--ok', st.reached);
          live.classList.toggle('is-reached', st.reached);
          if (st.reached) hintEl.textContent = 'Beim Beenden wird ' + xpText(st.total) + ' dein neuer Wert.';
          else if (n) hintEl.textContent = 'Noch nicht geschafft. Beendest du jetzt, bleibt dein Wert bei ' + xpText(muscleXp(mid)) + '.';
          else hintEl.textContent = 'Trag deinen ersten Satz ein: Gewicht × Wiederholungen = XP.';
          listBox.innerHTML = '';
          listBox.appendChild(OP.ui.setList(st.gym.sets, {
            onRemove: removeSet, unitLabel: 'XP', emptyText: 'Noch keine Sätze. Leg los!'
          }));
          countEl.textContent = n + (n === 1 ? ' Satz' : ' Sätze');
          fillActions(st);
        }
        refresh();

        return {
          root: root,
          refresh: refresh,
          after: function () {
            body = createBody(holoBox, mid);
            vb.add(function () { safe(body, 'destroy'); body = null; });
            OP.ui.setHeadExtra(chip);
            tick();
            vb.interval(tick, 20000);
            vb.add(function () { OP.ui.setHeadExtra(null); });
          }
        };
      }

      /* ---------- Start ---------- */
      render();

      // Link auf eine andere Muskelgruppe, während schon ein Training läuft
      if (wanted && OP.state.gym && OP.state.gym.muscle !== wanted) {
        var running = D.muscle(OP.state.gym.muscle);
        OP.ui.toast('Es läuft schon ein Training' + (running ? ' (' + running.name + ')' : '') + '. Beende es zuerst.', { type: 'info' });
      }

      bag.on('change', function () {
        if (keyNow() !== viewKey) render();
        else if (view && view.refresh) view.refresh();
      });
      bag.add(function () { if (viewBag) viewBag.run(); viewBag = null; });
      return bag.run;
    }
  });
})();
