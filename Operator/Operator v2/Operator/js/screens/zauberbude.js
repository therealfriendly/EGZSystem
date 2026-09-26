/* Operator – Zauberbude = Einstellungen (Bildschirm 'zauberbude')
   Abschnitte als aufklappbare Karten: Runner, XP-Werte, Bauch, Kalorienziel, Rang-Schwellen,
   Effekte, Spielstand sichern, App. Änderungen laufen nur über OP.game / OP.store.
   Bei 'change' werden nur Anzeigen aktualisiert – Felder, in die gerade getippt wird, bleiben unberührt. */
(function () {
  'use strict';
  const OP = window.OP;
  if (!OP || !OP.screens || !OP.ui) return;
  const U = OP.util, D = OP.data, h = OP.h;

  const LAST_BACKUP_KEY = 'op.lastBackup';   // wann zuletzt exportiert (nur Erinnerung, pro Browser)
  const openState = {};                      // welche Abschnitte offen sind (bleibt während der Sitzung)
  let importDraft = '';                      // Text im Import-Feld (überlebt Neuaufbau)

  /* ---------- kleine Helfer ---------- */

  function icon(name, cls) { return OP.ui.icon(name, cls); }
  function ico(name) { return h('span', { class: 'zb-ico', html: icon(name) }); }
  function toast(msg, type, ms) { OP.ui.toast(msg, { type: type || 'info', ms: ms }); }

  /** Zahl für ein Eingabefeld: 82.5 -> "82,5" (Einlesen immer mit U.parseNum: "2.000" = 2000, "22,5" = 22.5) */
  function toInput(v) { return v == null ? '' : String(v).replace('.', ','); }
  function kgText(v) { return U.fmt1(v).replace(/,0$/, ''); }

  /* Eingabefelder: "dirty" = der Nutzer hat getippt und noch nicht gespeichert -> nicht überschreiben */
  /* Der umgebende Block (.zb-scope) bekommt .is-dirty -> sein "Speichern"-Knopf leuchtet auf */
  function track(input) {
    input.addEventListener('input', function () {
      input.dataset.dirty = '1';
      input.classList.remove('is-invalid');
      const scope = input.closest('.zb-scope');
      if (scope) scope.classList.add('is-dirty');
    });
    return input;
  }
  function setIfClean(input, value) {
    if (input.dataset.dirty || document.activeElement === input) return;
    input.value = value;
  }
  function markClean(inputs) {
    inputs.forEach(function (i) {
      delete i.dataset.dirty;
      i.classList.remove('is-invalid');
      const scope = i.closest('.zb-scope');
      if (scope) scope.classList.remove('is-dirty');
    });
  }
  function invalid(input) {
    input.classList.add('is-invalid');
    try { input.focus(); } catch (e) { /* egal */ }
    OP.ui.haptic([20, 30, 20]);
  }
  function shake(node) { node.classList.remove('is-shake'); void node.offsetWidth; node.classList.add('is-shake'); }

  function numField(opts) {
    const f = OP.ui.numField(opts);
    track(f.input);
    return f;
  }

  function btn(label, iconName, cls, onClick, type) {
    return h('button', { class: 'btn ' + (cls || ''), type: type || 'button', onclick: onClick },
      iconName ? h('span', { html: icon(iconName) }) : null, label);
  }

  function readLastBackup() {
    try { const t = Number(localStorage.getItem(LAST_BACKUP_KEY)); return t > 0 ? t : 0; } catch (e) { return 0; }
  }
  function noteBackup() {
    try { localStorage.setItem(LAST_BACKUP_KEY, String(Date.now())); } catch (e) { /* egal */ }
  }
  function whenText(t) {
    if (!t) return 'noch nie';
    const days = U.diffDays(U.dayKey(t), U.today());
    if (days <= 0) return 'heute, ' + U.timeLabel(t);
    if (days === 1) return 'gestern';
    return 'vor ' + days + ' Tagen (' + U.dayLabel(U.dayKey(t)) + ')';
  }

  /* ---------- Aufklappbarer Abschnitt ---------- */

  function section(id, iconName, title, defaultOpen) {
    const open = openState[id] != null ? openState[id] : defaultOpen;
    const sum = h('span', { class: 'zb-sec__sum' });
    const det = h('details', { class: 'zb-sec card card--violet', open: !!open, dataset: { sec: id } },
      h('summary', { class: 'zb-sec__head' },
        h('span', { class: 'zb-sec__ico', html: icon(iconName) }),
        h('span', { class: 'zb-sec__titles' }, h('span', { class: 'zb-sec__title', text: title }), sum),
        h('span', { class: 'zb-sec__chev', html: icon('down') })));
    const body = h('div', { class: 'zb-sec__body' });
    det.appendChild(body);
    det.addEventListener('toggle', function () { openState[id] = det.open; });
    return { el: det, body: body, summary: function (t) { sum.textContent = t; } };
  }

  /* ================= 1. Runner ================= */

  function secRunner(ctx) {
    const s = section('runner', 'profil', 'Runner', ctx.wide);
    const nameIn = track(h('input', { class: 'input', type: 'text', maxlength: '24', autocomplete: 'off', autocapitalize: 'words', spellcheck: 'false', 'aria-label': 'Name' }));
    const bw = numField({ label: 'Körpergewicht', suffix: 'kg', placeholder: 'z. B. 80' });

    function save(e) {
      e.preventDefault();
      const v = U.parseNum(bw.input.value);
      if (!isFinite(v) || v < 30 || v > 300) { invalid(bw.input); toast('Körpergewicht bitte zwischen 30 und 300 kg.', 'warn'); return; }
      const res = OP.game.setPlayer({ name: nameIn.value, bodyweight: v });
      if (!res || !res.ok) { toast((res && res.error) || 'Speichern ging nicht.', 'err'); return; }
      markClean([nameIn, bw.input]);
      nameIn.blur(); bw.input.blur();
      update();
      toast('Gespeichert, ' + OP.state.player.name + '.', 'ok');
    }

    s.body.appendChild(h('form', { class: 'stack zb-scope', novalidate: true, onsubmit: save },
      h('div', { class: 'zb-grid2' },
        h('label', { class: 'field' }, h('span', { class: 'field__label', text: 'Name' }), nameIn),
        bw.el),
      h('p', { class: 'field__hint', text: 'Das Körpergewicht zählt bei Übungen ohne Hantel, z. B. 27 Liegestütze × Körpergewicht.' }),
      btn('Speichern', 'check', 'btn--violet btn--block zb-save', null, 'submit')));

    function update() {
      const p = OP.state.player;
      setIfClean(nameIn, p.name);
      setIfClean(bw.input, toInput(p.bodyweight));
      s.summary(p.name + ' · ' + kgText(p.bodyweight) + ' kg');
    }
    return { el: s.el, update: update };
  }

  /* ================= 2. XP-Werte anpassen ================= */

  function secXp(ctx) {
    const s = section('xp', 'staerke', 'XP-Werte anpassen', ctx.wide);
    s.body.appendChild(h('p', { class: 'zb-intro', text: 'Vertippt? Hier änderst du deine XP-Werte direkt. Normal steigen sie durch Gym und Kämpfe.' }));
    const rows = [];
    const list = h('div', { class: 'zb-list' });

    D.MUSCLES.forEach(function (m) {
      const badge = h('span', { class: 'zb-row__badge' });
      const info = h('span', { class: 'zb-row__info' });
      const f = numField({ suffix: 'XP', integer: true, placeholder: '0' });
      f.input.setAttribute('aria-label', m.name + ' in XP');
      f.input.setAttribute('enterkeyhint', 'done');

      function save(e) {
        e.preventDefault();
        const old = OP.state.muscles[m.id].xp;
        const v = U.parseNum(f.input.value);
        if (!isFinite(v) || v < 0 || v > 1000000) { invalid(f.input); toast('Bitte eine Zahl ab 0 eingeben (z. B. 2400).', 'warn'); return; }
        if (Math.round(v) === Math.round(old) && Math.abs(v - Math.round(v)) < 1e-9) {
          markClean([f.input]); update(); toast('Keine Änderung bei ' + m.name + '.', 'info'); return;
        }
        OP.ui.confirm(m.name + ': ' + U.fmt(old) + ' → ' + U.fmt(v) + ' XP. Wirklich ändern?', { title: 'XP ändern', okLabel: 'Ändern' })
          .then(function (ok) {
            if (!ok) return;
            const res = OP.game.setMuscleXp(m.id, v);
            if (!res || !res.ok) { toast((res && res.error) || 'Ging nicht.', 'err'); return; }
            markClean([f.input]);
            update();
            toast(m.name + ': jetzt ' + U.fmt(OP.state.muscles[m.id].xp) + ' XP', 'ok');
          });
      }

      const row = h('form', { class: 'zb-row zb-scope', novalidate: true, onsubmit: save },
        h('div', { class: 'zb-row__head' },
          h('span', { class: 'zb-row__ico', html: icon(m.icon) }),
          h('span', { class: 'zb-row__name', text: m.name }),
          badge),
        h('div', { class: 'zb-row__ctrl' }, f.el, btn('Speichern', null, 'btn--violet zb-row__save zb-save', null, 'submit')),
        info);
      list.appendChild(row);

      function update() {
        const mm = OP.state.muscles[m.id];
        const r = OP.game.rankFor(m.id);
        badge.innerHTML = '';
        badge.appendChild(OP.ui.rankBadge(r.rank, { small: true }));
        setIfClean(f.input, String(Math.round(mm.xp)));
        info.textContent = 'Aktuell ' + U.fmt(mm.xp) + ' · Start ' + U.fmt(mm.start) + ' · Bestwert ' + U.fmt(mm.peak);
      }
      rows.push(update);
    });
    s.body.appendChild(list);

    return {
      el: s.el,
      update: function () {
        rows.forEach(function (u) { u(); });
        s.summary('Gesamtstärke ' + U.fmt(OP.game.totalStrength()));
      }
    };
  }

  /* ================= 3. Bauch-Challenges ================= */

  function secAbs(ctx) {
    const s = section('abs', 'bauch', 'Bauch-Challenges', ctx.wide);
    s.body.appendChild(h('p', { class: 'zb-intro', text: 'Ziel und Bestwert der Zirkus-Tänze. Dein Bauch-Rang kommt von deiner besten Plank-Zeit.' }));
    const rows = [];
    const list = h('div', { class: 'zb-list' });

    D.ABS_EXERCISES.forEach(function (ex) {
      const unit = ex.unit === 's' ? 's' : 'Wdh.';
      const tF = numField({ label: 'Ziel', suffix: unit, integer: true, compact: true });
      const bF = numField({ label: 'Bestwert', suffix: unit, integer: true, compact: true });
      const info = h('span', { class: 'zb-row__info' });

      function save(e) {
        e.preventDefault();
        const a = OP.state.abs[ex.id];
        const t = U.parseNum(tF.input.value), b = U.parseNum(bF.input.value);
        if (!isFinite(t) || t < 1 || t > 36000) { invalid(tF.input); toast(ex.name + ': Ziel mindestens 1 ' + unit, 'warn'); return; }
        if (!isFinite(b) || b < 0 || b > 36000) { invalid(bF.input); toast(ex.name + ': Bestwert ab 0 eingeben.', 'warn'); return; }
        const changed = [];
        if (Math.round(t) !== a.target) changed.push(['target', t]);
        if (Math.round(b) !== (a.best || 0)) changed.push(['best', b]);
        if (!changed.length) { markClean([tF.input, bF.input]); update(); toast('Keine Änderung bei ' + ex.name + '.', 'info'); return; }
        for (let i = 0; i < changed.length; i++) {
          const res = OP.game.setAbs(ex.id, changed[i][0], changed[i][1]);
          if (!res || !res.ok) { toast((res && res.error) || 'Ging nicht.', 'err'); return; }
        }
        markClean([tF.input, bF.input]);
        update();
        toast(ex.name + ' gespeichert.', 'ok');
      }

      list.appendChild(h('form', { class: 'zb-row zb-scope', novalidate: true, onsubmit: save },
        h('div', { class: 'zb-row__head' },
          h('span', { class: 'zb-row__ico', html: icon('bauch') }),
          h('span', { class: 'zb-row__name', text: ex.name })),
        h('div', { class: 'zb-row__ctrl zb-row__ctrl--abs' }, tF.el, bF.el, btn('Speichern', null, 'btn--violet zb-row__save zb-save', null, 'submit')),
        info));

      function update() {
        const a = OP.state.abs[ex.id];
        setIfClean(tF.input, String(a.target));
        setIfClean(bF.input, String(a.best || 0));
        info.textContent = 'Geschafft ' + (a.wins || 0) + '× · Nicht geschafft ' + (a.fails || 0) + '×' +
          // Wiederholungen werden gesammelt, bis das Ziel erreicht ist (nicht pro Tag)
          (ex.unit !== 's' && a.progress ? ' · Stand: ' + a.progress + ' von ' + a.target + ' Wdh.' : '');
      }
      rows.push(update);
    });
    s.body.appendChild(list);

    return {
      el: s.el,
      update: function () {
        rows.forEach(function (u) { u(); });
        const p = OP.state.abs.plank;
        s.summary('Plank-Ziel ' + U.secs(p.target) + ' · Bestzeit ' + U.secs(p.best || 0));
      }
    };
  }

  /* ================= 4. Kalorienziel ================= */

  function secKcal(ctx) {
    const s = section('kcal', 'kcal', 'Kalorienziel', ctx.wide);
    const f = numField({ label: 'Ziel: Kilo Fett verlieren', suffix: 'kg', placeholder: 'z. B. 20' });
    const preview = h('div', { class: 'zb-kcal__value num' });
    const info = h('p', { class: 'zb-row__info' });

    function upd() {
      const kg = f.input.value.trim() === '' ? 0 : U.parseNum(f.input.value);
      const ok = isFinite(kg) && kg >= 0 && kg <= 300;
      preview.textContent = ok ? '= ' + U.fmt(Math.round(kg * 10) / 10 * D.KCAL_PER_KG) + ' kcal Schulden' : 'Bitte 0 bis 300 kg';
      preview.classList.toggle('is-bad', !ok);
    }
    f.input.addEventListener('input', upd);

    /* Wie im Haus: Nach "ICH BIN GESUND!" startet ein neues Ziel frisch (kcalNewGoal, alte Einträge zählen nicht mehr).
       Während eines Ziels ändert sich nur die Größe (kcalSetGoal), Abbezahltes zählt weiter. */
    function save(e) {
      e.preventDefault();
      const kg = f.input.value.trim() === '' ? 0 : U.parseNum(f.input.value);
      if (!isFinite(kg) || kg < 0 || kg > 300) { invalid(f.input); toast('Bitte ein Ziel zwischen 0 und 300 kg.', 'warn'); return; }
      const st = OP.game.kcalStatus();
      const kg1 = Math.round(kg * 10) / 10;
      // gleicher Wert = keine Änderung (außer nach "gesund": dann bewusst neu eingetippt = frischer Start)
      if (kg1 === st.goalKg && (!st.done || !f.input.dataset.dirty)) { markClean([f.input]); update(); toast('Keine Änderung beim Kalorienziel.', 'info'); return; }
      const fresh = st.done && kg1 > 0;

      function apply() {
        const res = fresh ? OP.game.kcalNewGoal(kg1) : OP.game.kcalSetGoal(kg1);
        if (!res || !res.ok) { toast((res && res.error) || 'Ging nicht.', 'err'); return; }
        markClean([f.input]);
        update();
        const now = OP.game.kcalStatus();
        if (!now.hasGoal) toast('Kein Kalorienziel mehr.', 'ok');
        else if (now.done) toast('Ziel ' + kgText(kg1) + ' kg – schon abbezahlt!', 'ok');   // Feier kommt über das Achievement
        else toast((fresh ? 'Neues Ziel ab jetzt: ' : (st.hasGoal ? 'Ziel geändert: ' : 'Ziel gesetzt: ')) + kgText(kg1) + ' kg · noch ' + U.fmt(now.remaining) + ' kcal', 'ok');
      }
      if (!fresh && kg1 > 0 && !st.done && Math.round(kg1 * D.KCAL_PER_KG) <= st.paid) {
        OP.ui.confirm('Mit diesem Ziel sind deine Schulden sofort bezahlt. Speichern?', { title: 'Kalorienziel', okLabel: 'Speichern' })
          .then(function (ok) { if (ok) apply(); });
      } else apply();
    }

    s.body.appendChild(h('form', { class: 'stack zb-scope', novalidate: true, onsubmit: save },
      f.el,
      h('div', { class: 'zb-kcal' }, preview, h('span', { class: 'field__hint', text: '1 kg Fett ≈ ' + U.fmt(D.KCAL_PER_KG) + ' kcal · 0 = kein Ziel' })),
      info,
      btn('Speichern', 'check', 'btn--violet btn--block zb-save', null, 'submit')));

    function update() {
      const st = OP.game.kcalStatus();
      setIfClean(f.input, toInput(st.goalKg));
      if (!f.input.dataset.dirty) upd();
      const since = st.baseT ? ' seit ' + U.dayLabel(U.dayKey(st.baseT)) : '';
      if (st.done) {
        info.textContent = 'Ziel geschafft! Ein neues Ziel startet frisch – deine alten Einträge zählen dann nicht mehr mit.';
      } else {
        info.textContent = 'Schon abbezahlt' + since + ': ' + U.fmt(Math.max(0, st.paid)) + ' kcal' +
          (st.hasGoal ? ' · Noch offen: ' + U.fmt(st.remaining) + ' kcal (' + U.pct(st.pctRemaining) + ')' : '') +
          '. Änderst du das Ziel, zählt das Abbezahlte weiter.';
      }
      s.summary(!st.hasGoal ? 'Kein Ziel gesetzt' : kgText(st.goalKg) + ' kg · ' + (st.done ? 'geschafft!' : 'noch ' + U.fmt(st.remaining) + ' kcal'));
    }
    return { el: s.el, update: update };
  }

  /* ================= 5. Rang-Schwellen ================= */

  function secRanks(ctx) {
    const s = section('ranks', 'rank', 'Rang-Schwellen', ctx.wide);
    s.body.appendChild(h('p', { class: 'zb-intro', text: 'Ab wie viel XP gilt welcher Rang? Stell es pro Muskelgruppe ein. Hantel-Übungen geben mehr XP als Körpergewicht – für Beine lohnen sich z. B. höhere Schwellen.' }));
    const editors = [];
    const list = h('div', { class: 'zb-th-list' });

    D.MUSCLES.forEach(function (m) {
      const key = 'th-' + m.id;
      const chip = h('span', { class: 'chip' });
      const badge = h('span', { class: 'zb-th__badge' });
      const det = h('details', { class: 'zb-th zb-scope', open: !!openState[key] },
        h('summary', { class: 'zb-th__head' },
          h('span', { class: 'zb-row__ico', html: icon(m.icon) }),
          h('span', { class: 'zb-row__name', text: m.name }),
          chip, badge,
          h('span', { class: 'zb-sec__chev', html: icon('down') })));
      det.addEventListener('toggle', function () { openState[key] = det.open; });

      const inputs = [];
      const grid = h('div', { class: 'zb-th__grid' });
      D.RANKS.forEach(function (r, i) {
        const f = numField({ integer: true, placeholder: '0' });
        f.input.setAttribute('aria-label', r.name + ' ab XP');
        if (i === 0) { f.input.value = '0'; f.input.disabled = true; }
        inputs.push(f.input);
        f.input.addEventListener('input', preview);
        grid.appendChild(h('div', { class: 'zb-th__cell', style: { '--rank-color': r.color } },
          h('span', { class: 'zb-th__label' }, h('span', { class: 'zb-th__gem' }), r.name),
          f.el));
      });
      const prev = h('div', { class: 'zb-th__prev' });
      const err = h('p', { class: 'zb-err', role: 'alert', hidden: true });

      function values() { return inputs.map(function (inp, i) { return i === 0 ? 0 : U.parseNum(inp.value); }); }

      /* Vorschau: welcher Rang ergibt sich mit den eingetippten Werten? */
      function preview() {
        const xp = OP.state.muscles[m.id].xp, th = values();
        let idx = 0;
        for (let i = 0; i < th.length; i++) if (isFinite(th[i]) && xp >= th[i]) idx = i;
        prev.innerHTML = '';
        prev.appendChild(h('span', { text: 'Dein Rang damit (' + U.fmt(xp) + ' XP):' }));
        prev.appendChild(OP.ui.rankBadge(D.RANKS[idx], { small: true }));
        err.hidden = true;
      }

      function save() {
        const vals = values();
        // Fehlerstelle selbst finden, damit das richtige Feld rot wird
        for (let i = 1; i < vals.length; i++) {
          if (!isFinite(vals[i]) || vals[i] < 0 || vals[i] <= vals[i - 1]) { inputs[i].classList.add('is-invalid'); break; }
        }
        const res = OP.game.setThresholds(m.id, vals);
        if (!res || !res.ok) {
          err.textContent = (res && res.error) || 'Ungültige Werte.';
          err.hidden = false;
          shake(err);
          OP.ui.haptic([20, 30, 20]);
          return;
        }
        err.hidden = true;
        markClean(inputs);
        update();
        toast('Rang-Schwellen für ' + m.name + ' gespeichert.', 'ok');
      }
      function reset() {
        if (!OP.state.settings.rankOverrides || !OP.state.settings.rankOverrides[m.id]) {
          markClean(inputs); update(); toast(m.name + ' nutzt schon die Standard-Werte.', 'info'); return;
        }
        OP.ui.confirm('Standard-Schwellen für ' + m.name + ' wiederherstellen?', { title: 'Standard', okLabel: 'Ja, Standard' }).then(function (ok) {
          if (!ok) return;
          OP.game.setThresholds(m.id, null);
          markClean(inputs);
          err.hidden = true;
          update();
          toast(m.name + ': Standard-Schwellen aktiv.', 'ok');
        });
      }

      det.appendChild(h('div', { class: 'zb-th__body' },
        grid, prev, err,
        h('div', { class: 'zb-th__actions' },
          btn('Speichern', 'check', 'btn--violet zb-save', save),
          btn('Standard', 'refresh', 'btn--ghost', reset))));
      list.appendChild(det);

      function update() {
        const th = OP.game.thresholds(m.id);
        const custom = !!(OP.state.settings.rankOverrides && OP.state.settings.rankOverrides[m.id]);
        // Chip nur bei eigenen Werten (Standard ist der Normalfall)
        chip.className = 'chip zb-chip--custom';
        chip.textContent = 'Eigene';
        chip.hidden = !custom;
        badge.innerHTML = '';
        badge.appendChild(OP.ui.rankBadge(OP.game.rankFor(m.id).rank, { small: true }));
        inputs.forEach(function (inp, i) { if (i > 0) setIfClean(inp, String(th[i])); });
        if (!inputs.some(function (i) { return i.dataset.dirty; })) preview();
      }
      editors.push(update);
    });
    s.body.appendChild(list);

    return {
      el: s.el,
      update: function () {
        editors.forEach(function (u) { u(); });
        const o = OP.state.settings.rankOverrides || {};
        const n = D.MUSCLE_IDS.filter(function (id) { return o[id]; }).length;
        s.summary(n ? n + (n === 1 ? ' Muskelgruppe' : ' Muskelgruppen') + ' angepasst' : 'Standard für alle');
      }
    };
  }

  /* ================= 6. Effekte & Vibration ================= */

  function secFx(ctx) {
    const s = section('fx', 'bolt', 'Effekte & Vibration', ctx.wide);

    function switchRow(key, title, hint, onMsg, offMsg) {
      const cb = h('input', { type: 'checkbox' });
      cb.addEventListener('change', function () {
        OP.game.setSetting(key, cb.checked);
        if (key === 'haptics' && cb.checked) OP.ui.haptic(30);
        toast(cb.checked ? onMsg : offMsg, 'ok');
      });
      const row = h('label', { class: 'switch zb-switch' }, cb, h('span', { class: 'switch__track' }),
        h('span', { class: 'zb-switch__text' }, h('strong', { text: title }), h('small', { text: hint })));
      return { el: row, update: function () { cb.checked = OP.state.settings[key] !== false; } };
    }

    const fx = switchRow('effects', '3D-Hologramme',
      'Körper und Gegner in 3D. Aus = schneller und spart Akku. Wirkt, sobald du einen Bildschirm neu öffnest.',
      '3D-Hologramme an – wirkt beim nächsten Öffnen.', '3D-Hologramme aus – wirkt beim nächsten Öffnen.');
    const hap = switchRow('haptics', 'Vibration',
      'Kurzes Brummen bei Treffern und Erfolgen. Klappt nicht auf jedem Gerät (z. B. nicht im iPhone-Browser).',
      'Vibration an.', 'Vibration aus.');
    s.body.appendChild(h('div', { class: 'zb-switches' }, fx.el, hap.el));

    return {
      el: s.el,
      update: function () {
        fx.update(); hap.update();
        const st = OP.state.settings;
        s.summary('3D ' + (st.effects !== false ? 'an' : 'aus') + ' · Vibration ' + (st.haptics !== false ? 'an' : 'aus'));
      }
    };
  }

  /* ================= 7. Spielstand sichern ================= */

  /** Text als .txt-Datei herunterladen -> true, wenn es geklappt hat */
  function saveTextFile(text, fileName) {
    try {
      const blob = new Blob([text + '\n'], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = h('a', { href: url, download: fileName, style: 'display:none' });
      document.body.appendChild(a);
      a.click();
      setTimeout(function () { URL.revokeObjectURL(url); if (a.parentNode) a.parentNode.removeChild(a); }, 1500);
      return true;
    } catch (e) {
      console.error('[zauberbude] download', e);
      return false;
    }
  }

  /* ---------- Notfall-Sicherungen ----------
     Der Speicher legt automatisch Kopien an: vor dem letzten Import, vor dem letzten Zurücksetzen
     und von beschädigten Spielständen (KEY + '.defekt.<Zeitstempel>', Rohtext, evtl. kein gültiges JSON).
     Auch die Einrichtung nutzt diese Liste (OP.backups), damit man dort einen alten Stand zurückholen kann. */

  function dateTime(t) { return t ? U.dayLabel(U.dayKey(t)) + ', ' + U.timeLabel(t) : 'unbekannt'; }

  /** Eine Sicherung lesen -> {key, kind, raw, t, ok (lässt sich zurückholen), name, done, title, sub} oder null */
  function readBackup(key, kind, why, keyTime) {
    let raw = null;
    try { raw = localStorage.getItem(key); } catch (e) { return null; }
    if (!raw) return null;
    const chk = OP.store.checkImport(raw);
    let t = keyTime || 0;
    if (!t) { try { t = Number(JSON.parse(raw).updated) || 0; } catch (e) { /* kein JSON */ } }
    const name = chk.ok ? (chk.name || 'Runner') : '';
    const b = { key: key, kind: kind, raw: raw, t: t, ok: !!chk.ok, name: name, done: !!(chk.ok && chk.setupDone) };
    if (kind === 'defekt') {
      b.title = 'Beschädigter Stand vom ' + (t ? U.dayLabel(U.dayKey(t)) : 'unbekannt');
      b.sub = b.ok ? name + ' · lässt sich zurückholen' : 'Nicht lesbar – du kannst ihn als Datei speichern.';
    } else if (b.ok) {
      b.title = name + (b.done ? '' : ' (nicht eingerichtet)');
      b.sub = dateTime(t) + ' · ' + why;
    } else {
      b.title = 'Nicht lesbare Sicherung';
      b.sub = why + ' · du kannst sie als Datei speichern.';
    }
    return b;
  }

  /** Alle Notfall-Sicherungen, neueste zuerst */
  function listBackups() {
    const key = OP.store && OP.store.KEY, out = [];
    if (!key || !OP.store.checkImport) return out;
    [['.vor-import', 'vor dem letzten Import'], ['.vor-reset', 'vor dem letzten Zurücksetzen']].forEach(function (p) {
      const b = readBackup(key + p[0], p[0].slice(1), p[1], 0);
      if (b) out.push(b);
    });
    const prefix = key + '.defekt.';
    const keys = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.indexOf(prefix) === 0) keys.push(k);
      }
    } catch (e) { /* Speicher gesperrt */ }
    keys.forEach(function (k) {
      const b = readBackup(k, 'defekt', '', Number(k.slice(prefix.length)) || 0);
      if (b) out.push(b);
    });
    out.sort(function (a, b) { return b.t - a.t; });
    return out;
  }

  /** Rohtext einer Sicherung als Datei speichern (z. B. um einen kaputten Stand zu retten) */
  function saveBackupFile(b) {
    const day = b.t ? U.dayKey(b.t) : U.today();
    const ok = saveTextFile(b.raw, 'operator-' + (b.kind === 'defekt' ? 'beschaedigt' : 'sicherung') + '-' + day + '.txt');
    if (ok) toast('Datei wird gespeichert.', 'ok');
    else toast('Speichern als Datei ging nicht.', 'warn');
    return ok;
  }

  function removeBackup(b) {
    try { localStorage.removeItem(b.key); return true; } catch (e) { return false; }
  }

  OP.backups = { list: listBackups, saveFile: saveBackupFile, remove: removeBackup };

  function doImport(text, okMsg) {
    const res = OP.store.importText(text);
    if (!res || !res.ok) { toast((res && res.error) || 'Import ging nicht.', 'err', 5000); return res || { ok: false }; }
    importDraft = '';
    toast(okMsg || 'Spielstand geladen.', 'ok', 3500);
    OP.ui.router.refresh();
    return res;
  }

  /** Erst prüfen, dann fragen: "Spielstand von X laden?" (ungültiger Text bekommt keinen Dialog) */
  function askAndImport(text, title, okLabel) {
    const chk = OP.store.checkImport(text);
    if (!chk.ok) return chk;
    const name = chk.name || 'Runner';
    OP.ui.confirm('Spielstand von ' + name + ' laden? Dein aktueller Stand wird ersetzt.' +
      (chk.setupDone ? '' : ' (Die Einrichtung ist dort noch nicht fertig.)'),
    { title: title, okLabel: okLabel, danger: true })
      .then(function (ok) { if (ok) doImport(text, 'Spielstand von ' + name + ' geladen. Willkommen zurück!'); });
    return chk;
  }

  function secSave(ctx) {
    // Wurde beim Start ein beschädigter Spielstand gefunden, diesen Bereich gleich offen zeigen
    const s = section('save', 'export', 'Spielstand sichern', ctx.wide || !!(OP.store && OP.store.corruptKey));
    const last = h('span', { class: 'zb-save__last' });

    s.body.appendChild(h('div', { class: 'zb-hint' },
      h('span', { class: 'zb-hint__ico', html: icon('warning') }),
      h('div', null,
        h('strong', { text: 'Sichere regelmäßig – der Spielstand liegt nur in diesem Browser.' }),
        h('div', { class: 'zb-hint__sub' }, 'Zuletzt gesichert: ', last))));

    /* --- Export --- */
    const out = h('textarea', { class: 'input textarea zb-code', rows: '3', readonly: true, spellcheck: 'false', 'aria-label': 'Spielstand als Text' });
    out.addEventListener('focus', function () { try { out.select(); } catch (e) { /* egal */ } });
    let stale = true;
    function refreshExport() {
      if (!s.el.open) { stale = true; return; }
      try { out.value = OP.store.exportText(); stale = false; } catch (e) { out.value = ''; console.error('[zauberbude] export', e); }
    }
    s.el.addEventListener('toggle', function () { if (s.el.open && stale) refreshExport(); });

    function copy() {
      refreshExport();
      const text = out.value;
      function fallback() {
        let ok = false;
        try {
          out.focus(); out.select(); out.setSelectionRange(0, text.length);
          ok = document.execCommand('copy');
        } catch (e) { ok = false; }
        if (ok) { noteBackup(); updateLast(); toast('Kopiert! Füg es z. B. in eine Notiz ein.', 'ok'); }
        else toast('Kopieren ging nicht. Markier den Text und kopier ihn selbst.', 'warn', 4500);
      }
      if (navigator.clipboard && navigator.clipboard.writeText && window.isSecureContext !== false) {
        navigator.clipboard.writeText(text).then(function () {
          noteBackup(); updateLast(); toast('Kopiert! Füg es z. B. in eine Notiz ein.', 'ok');
        }, fallback);
      } else fallback();
    }

    function download() {
      refreshExport();
      if (saveTextFile(out.value, 'operator-spielstand-' + U.today() + '.txt')) {
        noteBackup(); updateLast();
        toast('Datei wird gespeichert.', 'ok');
      } else toast('Speichern als Datei ging nicht. Nutz „Kopieren“.', 'warn');
    }

    s.body.appendChild(h('div', { class: 'zb-block' },
      h('div', { class: 'zb-block__title' }, ico('export'), 'Export'),
      out,
      h('div', { class: 'zb-btns' },
        btn('Kopieren', 'copy', 'btn--violet zb-copy', copy),
        btn('Als Datei speichern', 'download', 'btn--ghost zb-download', download))));

    /* --- Import --- */
    const inp = h('textarea', { class: 'input textarea zb-code', rows: '3', spellcheck: 'false', autocapitalize: 'off', autocomplete: 'off',
      placeholder: 'Spielstand hier einfügen …', 'aria-label': 'Spielstand zum Importieren' });
    inp.value = importDraft;
    const err = h('p', { class: 'zb-err', role: 'alert', hidden: true });
    inp.addEventListener('input', function () { importDraft = inp.value; err.hidden = true; });
    const fileIn = h('input', { type: 'file', accept: '.txt,.json,text/plain,application/json', class: 'sr-only', tabindex: '-1' });
    fileIn.addEventListener('change', function () {
      const file = fileIn.files && fileIn.files[0];
      if (!file) return;
      const rd = new FileReader();
      rd.onload = function () { inp.value = importDraft = String(rd.result || '').trim(); err.hidden = true; toast('Datei geladen. Tipp jetzt auf „Importieren“.', 'info'); };
      rd.onerror = function () { toast('Die Datei konnte nicht gelesen werden.', 'err'); };
      rd.readAsText(file);
      fileIn.value = '';
    });

    function showErr(msg) { err.textContent = msg; err.hidden = false; shake(err); OP.ui.haptic([20, 30, 20]); }

    function runImport() {
      const text = inp.value.trim();
      if (!text) { showErr('Das Feld ist leer. Füge zuerst deinen Spielstand ein.'); return; }
      const chk = askAndImport(text, 'Spielstand laden?', 'Laden');
      if (!chk.ok) {
        const hint = text.indexOf('OPERATOR-SAVE:') !== 0 && text.charAt(0) !== '{' ? ' Ein Spielstand beginnt mit „OPERATOR-SAVE:“.' : '';
        showErr((chk.error || 'Das ist kein Operator-Spielstand.') + hint);
      }
    }

    s.body.appendChild(h('div', { class: 'zb-block' },
      h('div', { class: 'zb-block__title' }, ico('import'), 'Import'),
      inp, err,
      h('div', { class: 'zb-btns' },
        btn('Datei öffnen', 'upload', 'btn--ghost', function () { fileIn.click(); }),
        fileIn,
        btn('Importieren', 'import', 'btn--primary zb-import', runImport))));

    /* --- Notfall-Sicherungen (vor Import/Reset, beschädigte Stände) --- */
    const backupBox = h('div', { class: 'zb-block zb-backups' });
    s.body.appendChild(backupBox);

    function backupRow(b) {
      const actions = h('div', { class: 'zb-backup__btns' });
      if (b.ok) {
        actions.appendChild(btn('Zurückholen', 'refresh', 'btn--ghost btn--sm', function () {
          askAndImport(b.raw, 'Sicherung zurückholen?', 'Zurückholen');
        }));
      } else {
        actions.appendChild(btn('Als Datei speichern', 'download', 'btn--ghost btn--sm', function () { saveBackupFile(b); }));
      }
      if (b.kind === 'defekt') {
        actions.appendChild(h('button', {
          class: 'icon-btn icon-btn--sm icon-btn--ghost', type: 'button', 'aria-label': 'Kopie löschen', html: icon('trash'),
          onclick: function () {
            OP.ui.confirm('Diese Kopie des beschädigten Spielstands löschen? Speicher sie vorher als Datei, wenn du unsicher bist.',
              { title: 'Kopie löschen?', okLabel: 'Löschen', danger: true })
              .then(function (ok) {
                if (!ok) return;
                if (removeBackup(b)) { toast('Kopie gelöscht.', 'ok'); renderBackups(); }
                else toast('Löschen ging nicht.', 'err');
              });
          }
        }));
      }
      return h('div', { class: 'zb-backup' + (b.kind === 'defekt' ? ' zb-backup--bad' : '') },
        h('div', { class: 'zb-backup__text' },
          h('strong', { text: b.title }),
          h('span', { text: b.sub })),
        actions);
    }

    function renderBackups() {
      const list = listBackups();
      backupBox.innerHTML = '';
      backupBox.hidden = !list.length;
      if (!list.length) return;
      backupBox.appendChild(h('div', { class: 'zb-block__title' }, ico('refresh'), 'Notfall-Sicherungen'));
      backupBox.appendChild(h('p', { class: 'field__hint', text: 'Automatische Kopien: vor dem letzten Import, vor dem letzten Zurücksetzen und von beschädigten Spielständen.' }));
      list.forEach(function (b) { backupBox.appendChild(backupRow(b)); });
    }
    renderBackups();   // ändert sich nur bei Import/Reset (dann wird der Bildschirm neu aufgebaut) oder beim Löschen

    function updateLast() {
      const t = readLastBackup();
      last.textContent = whenText(t);
      const old = !t || U.diffDays(U.dayKey(t), U.today()) >= 7;
      last.classList.toggle('tone-warn', old);
      s.summary('Zuletzt gesichert: ' + whenText(t));
    }

    return {
      el: s.el,
      update: function () { updateLast(); refreshExport(); }
    };
  }

  /* ================= 8. App ================= */

  function updateApp(button) {
    if (button) button.disabled = true;
    toast('App wird aktualisiert … Dein Spielstand bleibt.', 'info');
    const jobs = [];
    try {
      if (window.caches && caches.keys) {
        jobs.push(caches.keys().then(function (keys) { return Promise.all(keys.map(function (k) { return caches.delete(k); })); }));
      }
    } catch (e) { /* egal */ }
    try {
      if (navigator.serviceWorker && navigator.serviceWorker.getRegistrations) {
        jobs.push(navigator.serviceWorker.getRegistrations().then(function (regs) { return Promise.all(regs.map(function (r) { return r.unregister(); })); }));
      }
    } catch (e) { /* egal */ }
    Promise.all(jobs.map(function (p) { return p.catch(function () { return null; }); }))
      .then(function () { setTimeout(function () { location.reload(); }, 400); });
  }

  function resetAll() {
    OP.ui.confirm('Alle Werte, Quests, Kämpfe und Achievements werden gelöscht. Sichere vorher deinen Spielstand!',
      { title: 'Alles zurücksetzen?', okLabel: 'Weiter', danger: true })
      .then(function (ok) {
        if (!ok) return null;
        return OP.ui.prompt('Zum Bestätigen RESET eintippen', { placeholder: 'RESET', label: 'Sicherheitsabfrage', okLabel: 'Endgültig löschen', danger: true });
      })
      .then(function (v) {
        if (v == null) return;
        if (String(v).trim().toUpperCase() !== 'RESET') { toast('Nicht zurückgesetzt – dafür musst du RESET eintippen.', 'warn'); return; }
        OP.store.reset();   // alter Entwurf der Einrichtung gehört zum alten Stand und wird dort automatisch verworfen
        OP.ui.go('setup');
        toast('Alles zurückgesetzt. Neuer Start, Runner!', 'info', 3500);
      });
  }

  function secApp(ctx) {
    const s = section('app', 'settings', 'App', ctx.wide);
    const facts = h('dl', { class: 'zb-facts' });
    const upBtn = btn('App aktualisieren', 'refresh', 'btn--ghost', function () { updateApp(upBtn); });

    s.body.appendChild(facts);
    s.body.appendChild(h('div', { class: 'zb-btns' },
      upBtn,
      btn('Hilfe', 'hilfe', 'btn--ghost', function () { OP.ui.go('hilfe'); })));
    s.body.appendChild(h('p', { class: 'field__hint', text: '„App aktualisieren“ holt die neueste Version. Dein Spielstand bleibt dabei erhalten.' }));
    s.body.appendChild(h('div', { class: 'zb-danger' },
      h('div', { class: 'zb-danger__text' },
        h('strong', { text: 'Gefahrenzone' }),
        h('span', { text: 'Löscht alle Werte, Quests und Erfolge. Du startest wieder bei der Einrichtung.' })),
      btn('Alles zurücksetzen', 'trash', 'btn--danger zb-reset', resetAll)));

    function fact(label, value, tone) {
      return [h('dt', { text: label }), h('dd', { class: tone ? 'tone-' + tone : null, text: value })];
    }
    return {
      el: s.el,
      update: function () {
        const st = OP.state;
        let size = 0;
        try { size = (localStorage.getItem(OP.store.KEY) || '').length; } catch (e) { /* egal */ }
        facts.innerHTML = '';
        [fact('Version', D.VERSION || '–'),
          fact('Speichern', OP.store.storageOk() ? 'klappt' : 'gesperrt!', OP.store.storageOk() ? 'ok' : 'err'),
          fact('Spielstand', size ? U.fmt1(size / 1024) + ' KB' : '–'),
          fact('Runner seit', st.created ? U.dayLabel(U.dayKey(st.created)) : '–')
        ].forEach(function (pair) { pair.forEach(function (n) { facts.appendChild(n); }); });
        s.summary('Version ' + (D.VERSION || '–'));
      }
    };
  }

  /* ================= Bildschirm ================= */

  /* Direkt-Link auf einen Abschnitt: #/zauberbude/<id> öffnet ihn und scrollt hin
     IDs: runner, xp, abs, kcal, ranks, fx, save, app (z. B. aus der Hilfe: 'zauberbude/ranks') */
  function mount(el, params) {
    const bag = OP.ui.cleanup();
    const wide = !!(window.matchMedia && window.matchMedia('(min-width: 900px)').matches);
    const ctx = { wide: wide };
    const target = params && /^[a-z]+$/.test(String(params[0] || '')) ? String(params[0]) : null;
    if (target) openState[target] = true;

    const root = h('div', { class: 'screen__inner zb' });
    root.appendChild(h('div', { class: 'zb-hero' },
      h('div', { class: 'zb-hero__orb', 'aria-hidden': 'true', html: icon('zauberbude') }),
      h('div', { class: 'zb-hero__text' },
        h('div', { class: 'zb-hero__kicker', text: 'Einstellungen' }),
        h('p', { text: 'Hier stellst du alles ein und sicherst deinen Spielstand. Tipp auf einen Bereich, um ihn zu öffnen.' }))));

    const cols = h('div', { class: 'zb-cols' });
    const parts = [secRunner, secXp, secAbs, secKcal, secRanks, secFx, secSave, secApp].map(function (fn) {
      const p = fn(ctx);
      cols.appendChild(p.el);
      return p;
    });
    root.appendChild(cols);
    el.appendChild(root);

    function updateAll() {
      parts.forEach(function (p) {
        try { if (p.update) p.update(); } catch (e) { console.error('[zauberbude]', e); }
      });
    }
    updateAll();

    if (target) {
      const tm = setTimeout(function () {
        const d = root.querySelector('details.zb-sec[data-sec="' + target + '"]');
        if (!d) return;
        try { d.scrollIntoView({ block: 'start', behavior: 'smooth' }); } catch (e) { d.scrollIntoView(); }
      }, 80);
      bag.add(function () { clearTimeout(tm); });
    }

    // Spielstand geändert (auch von woanders) -> nur Anzeigen auffrischen
    bag.on('change', function (e) {
      if (e && e.reason === 'reset') return;   // Reset führt sowieso zur Einrichtung
      updateAll();
    });
    return bag.run;
  }

  OP.screens.register('zauberbude', { title: 'Zauberbude', icon: 'zauberbude', tone: 'violet', mount: mount });
})();
