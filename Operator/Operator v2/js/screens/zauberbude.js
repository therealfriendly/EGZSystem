/* Operator – Zauberbude = Einstellungen (Bildschirm 'zauberbude')
   Abschnitte als aufklappbare Karten: Runner, XP-Werte (Push/Pull/Beine), Zirkus-Tänze (Bauch),
   Zirkus-Sperre (nur Info), Ausdauer (Lauf-Timer), Kalorienziel + Startgewicht, Rang-Schwellen (je Muskel),
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

  const RUN_MAX = 1440;                      // Minuten (wie OP.game.setRun)
  const AREA_NAMES = { arena: 'Arena', gym: 'Gym', abenteuer: 'Abenteuer', schmuggler: 'Schmuggler' };
  const NUM2 = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 2 });

  /* ---------- kleine Helfer ---------- */

  function icon(name, cls) { return OP.ui.icon(name, cls); }
  function ico(name) { return h('span', { class: 'zb-ico', html: icon(name) }); }
  function toast(msg, type, ms) { OP.ui.toast(msg, { type: type || 'info', ms: ms }); }

  /** Zahl für ein Eingabefeld: 82.5 -> "82,5" (Einlesen immer mit U.parseNum: "2.000" = 2000, "22,5" = 22.5) */
  function toInput(v) { return v == null ? '' : String(v).replace('.', ','); }
  function kgText(v) { return U.fmt1(v).replace(/,0$/, ''); }
  /** Zahl mit bis zu 2 Nachkommastellen: 11.6 -> "11,6", 12 -> "12" */
  function numText(v) { return NUM2.format(Number(v) || 0); }
  /** wie OP.game: auf zwei Nachkommastellen abrunden (8,593 -> 8,59) */
  function floor2(v) { return Math.floor(v * 100 + 1e-7) / 100; }
  function round2(v) { return Math.round(v * 100) / 100; }
  /** Minuten immer mit zwei Nachkommastellen: "8,59 Min." */
  function minText(v) { return U.fmt2(v) + ' Min.'; }   // geschütztes Leerzeichen: "8,59 Min." bricht nicht um
  /** Minuten für ein Eingabefeld ("8,50"); 0 = noch kein Wert = leeres Feld */
  function minInput(v) { return v > 0 ? floor2(v).toFixed(2).replace('.', ',') : ''; }
  /** Minuten lesen: "5,5" = 5,5 Minuten; "8:30" (Minuten:Sekunden) = 8,5 Minuten; leer = 0 */
  function parseMinutes(raw) {
    const s = String(raw == null ? '' : raw).trim();
    if (!s) return 0;
    const m = /^(\d{1,4}):([0-5]\d)$/.exec(s);
    if (m) return Number(m[1]) + Number(m[2]) / 60;
    return U.parseNum(s);
  }
  /** Sekunden immer als Sekunden ("90 s", nie "1:30 min") */
  function secText(v) { return U.fmt(v) + ' s'; }
  function absUnit(ex) { return ex.unit === 's' ? 's' : 'Wdh.'; }
  /** Retention einer Bauch-Übung in Worten: "−1 s alle 14 Tage" / "−0,1 pro Tag" */
  function decayText(ex) {
    const d = ex.decay;
    if (!d) return '';
    const amount = '−' + numText(d.amount) + (ex.unit === 's' ? ' s' : '');
    return d.everyDays <= 1 ? amount + ' pro Tag' : amount + ' alle ' + d.everyDays + ' Tage';
  }
  /** "Arena, Gym, Abenteuer und Schmuggler" */
  function areaList() {
    const names = (D.LOCKED_AREAS || []).map(function (a) { return AREA_NAMES[a] || a; });
    return names.length > 1 ? names.slice(0, -1).join(', ') + ' und ' + names[names.length - 1] : names.join('');
  }

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

  function intro(text) { return h('p', { class: 'zb-intro', text: text }); }

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
  /** Tag in der Vergangenheit in Worten: heute / gestern / vor 3 Tagen (27.09.2026) */
  function pastDay(day) {
    const d = U.diffDays(day, U.today());
    if (d <= 0) return 'heute';
    if (d === 1) return 'gestern';
    return 'vor ' + d + ' Tagen (' + U.dayLabel(day) + ')';
  }
  /** Tag in der Zukunft in Worten: morgen / übermorgen / am 02.10.2026 */
  function futureDay(day) {
    const d = U.diffDays(U.today(), day);
    if (d <= 0) return 'heute';
    if (d === 1) return 'morgen';
    if (d === 2) return 'übermorgen';
    return 'am ' + U.dayLabel(day);
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
    return {
      el: det, body: body,
      /** Kurztext unter dem Titel; tone optional ('warn', 'err', 'ok') */
      summary: function (t, tone) { sum.textContent = t; sum.className = 'zb-sec__sum' + (tone ? ' tone-' + tone : ''); }
    };
  }

  /** Kopf einer Trainings-Gruppe (Push / Pull / Beine) mit optionalem Wert rechts */
  function groupBox(g, extra) {
    const list = h('div', { class: 'zb-list' });
    const el = h('div', { class: 'zb-group', style: { '--grp': g.color } },
      h('div', { class: 'zb-group__head' },
        h('span', { class: 'zb-group__ico', html: icon(g.icon) }),
        h('span', { class: 'zb-group__titles' },
          h('span', { class: 'zb-group__name', text: g.name }),
          h('span', { class: 'zb-group__hint', text: g.hint })),
        extra || null),
      list);
    return { el: el, list: list };
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
      h('p', { class: 'field__hint', text: 'Das Körpergewicht zählt bei Übungen ohne Hantel, z. B. 27 Liegestütze × Körpergewicht. Dein Startgewicht bei den Kalorien ändert es nicht – das stellst du unter „Kalorienziel“ ein.' }),
      btn('Speichern', 'check', 'btn--violet btn--block zb-save', null, 'submit')));

    function update() {
      const p = OP.state.player;
      setIfClean(nameIn, p.name);
      setIfClean(bw.input, toInput(p.bodyweight));
      s.summary(p.name + ' · ' + kgText(p.bodyweight) + ' kg');
    }
    return { el: s.el, update: update };
  }

  /* ================= 2. XP-Werte anpassen (Push / Pull / Beine) ================= */

  function xpRow(m, list) {
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

    list.appendChild(h('form', { class: 'zb-row zb-scope', novalidate: true, onsubmit: save },
      h('div', { class: 'zb-row__head' },
        h('span', { class: 'zb-row__ico', html: icon(m.icon) }),
        h('span', { class: 'zb-row__name', text: m.name }),
        badge),
      h('div', { class: 'zb-row__ctrl' }, f.el, btn('Speichern', null, 'btn--violet zb-row__save zb-save', null, 'submit')),
      info));

    function update() {
      const mm = OP.state.muscles[m.id];
      const r = OP.game.rankFor(m.id);
      badge.innerHTML = '';
      badge.appendChild(OP.ui.rankBadge(r.rank, { small: true }));
      setIfClean(f.input, String(Math.round(mm.xp)));
      info.textContent = 'Aktuell ' + U.fmt(mm.xp) + ' · Start ' + U.fmt(mm.start) + ' · Bestwert ' + U.fmt(mm.peak);
    }
    return update;
  }

  function secXp(ctx) {
    const s = section('xp', 'staerke', 'XP-Werte anpassen', ctx.wide);
    s.body.appendChild(intro('Vertippt? Hier änderst du deine XP-Werte direkt. Normal steigen sie durch Gym und Kämpfe.'));
    const rows = [], sums = [];
    D.GROUPS.forEach(function (g) {
      const sum = h('span', { class: 'zb-group__sum num' });
      const box = groupBox(g, sum);
      g.muscles.forEach(function (id) { rows.push(xpRow(D.muscle(id), box.list)); });
      sums.push(function () { sum.textContent = U.fmt(OP.game.groupXp(g.id)) + ' XP'; });
      s.body.appendChild(box.el);
    });
    s.body.appendChild(h('p', { class: 'field__hint', text: 'Tipp: Bizeps und Trizeps sind kleine Muskeln – ihre Werte sind meist etwa halb so groß wie Brust oder Rücken. Aus einem alten Arme-Wert wurde je die Hälfte.' }));
    return {
      el: s.el,
      update: function () {
        rows.forEach(function (u) { u(); });
        sums.forEach(function (u) { u(); });
        s.summary('Gesamtstärke ' + U.fmt(OP.game.totalStrength()));
      }
    };
  }

  /* ================= 3. Zirkus-Tänze (Bauch) ================= */

  function absRow(ex, list) {
    const secs = ex.unit === 's';
    const unit = absUnit(ex);
    // Wiederholungs-Ziele dürfen Kommazahlen sein (11,6), Sekunden sind ganze Zahlen
    const tF = numField({ label: 'Ziel', suffix: unit, integer: secs, compact: true });
    const bF = numField({ label: 'Bestwert', suffix: unit, integer: true, compact: true });
    tF.input.setAttribute('aria-label', ex.name + ': Ziel');
    bF.input.setAttribute('aria-label', ex.name + ': Bestwert');
    const shownChip = h('span', { class: 'chip zb-chip--shown', hidden: true });
    const info = h('span', { class: 'zb-row__info' });

    function save(e) {
      e.preventDefault();
      const a = OP.state.abs[ex.id];
      let t = U.parseNum(tF.input.value), b = U.parseNum(bF.input.value);
      if (!isFinite(t) || t < D.ABS_MIN_TARGET || t > 36000) { invalid(tF.input); toast(ex.name + ': Ziel mindestens ' + D.ABS_MIN_TARGET + ' ' + unit + '.', 'warn'); return; }
      if (!isFinite(b) || b < 0 || b > 36000) { invalid(bF.input); toast(ex.name + ': Bestwert ab 0 eingeben.', 'warn'); return; }
      t = secs ? Math.round(t) : round2(t);
      b = Math.round(b);
      const changed = [];
      if (Math.abs(t - a.target) > 1e-9) changed.push(['target', t]);
      if (b !== Math.round(a.best || 0)) changed.push(['best', b]);
      if (!changed.length) { markClean([tF.input, bF.input]); update(); toast('Keine Änderung bei ' + ex.name + '.', 'info'); return; }
      for (let i = 0; i < changed.length; i++) {
        const res = OP.game.setAbs(ex.id, changed[i][0], changed[i][1]);
        if (!res || !res.ok) { toast((res && res.error) || 'Ging nicht.', 'err'); return; }
      }
      markClean([tF.input, bF.input]);
      update();
      const shown = OP.game.absShown(ex.id);
      const now = OP.state.abs[ex.id];
      const parts = changed.map(function (c) {
        return c[0] === 'target'
          ? 'Ziel ' + numText(now.target) + ' ' + unit + (shown !== now.target ? ' (verlangt ' + shown + ')' : '')
          : 'Bestwert ' + numText(now.best) + ' ' + unit;
      });
      toast(ex.name + ': ' + parts.join(' · ') + ' gespeichert.', 'ok');
    }

    list.appendChild(h('form', { class: 'zb-row zb-scope', novalidate: true, onsubmit: save },
      h('div', { class: 'zb-row__head' },
        h('span', { class: 'zb-row__ico', html: icon('bauch') }),
        h('span', { class: 'zb-row__name', text: ex.name }),
        shownChip),
      h('div', { class: 'zb-row__ctrl zb-row__ctrl--pair' }, tF.el, bF.el, btn('Speichern', null, 'btn--violet zb-row__save zb-save', null, 'submit')),
      info));

    function update() {
      const a = OP.state.abs[ex.id];
      const shown = OP.game.absShown(ex.id);
      setIfClean(tF.input, secs ? String(Math.round(a.target)) : toInput(round2(a.target)));
      setIfClean(bF.input, String(Math.round(a.best || 0)));
      // Kommazahl-Ziel: zeigen, was im Tanz wirklich verlangt wird (abgerundet)
      shownChip.hidden = secs || shown === a.target;
      shownChip.textContent = 'verlangt ' + shown + ' ' + unit;
      info.textContent = 'Geschafft ' + (a.wins || 0) + '× · Nicht geschafft ' + (a.fails || 0) + '× · Retention ' + decayText(ex);
    }
    return update;
  }

  function secAbs(ctx) {
    const s = section('abs', 'bauch', 'Zirkus-Tänze (Bauch)', ctx.wide);
    s.body.appendChild(intro('Ziel und Bestwert deiner 5 Übungen. Crunches und Sit-ups dürfen Kommazahlen haben (z. B. 11,6) – im Tanz verlangt wird abgerundet (11).'));
    const rows = [];
    [
      { unit: 's', title: 'Halten', hint: 'in Sekunden' },
      { unit: 'reps', title: 'Wiederholungen', hint: 'Kommazahlen erlaubt' }
    ].forEach(function (grp) {
      s.body.appendChild(h('div', { class: 'zb-sub' },
        h('span', { class: 'zb-sub__title', text: grp.title }), h('span', { class: 'zb-sub__hint', text: grp.hint })));
      const list = h('div', { class: 'zb-list' });
      D.ABS_EXERCISES.forEach(function (ex) { if (ex.unit === grp.unit) rows.push(absRow(ex, list)); });
      s.body.appendChild(list);
    });
    s.body.appendChild(h('p', { class: 'field__hint', text: 'Dein Bauch-Rang kommt von deiner besten Plank-Zeit.' }));

    return {
      el: s.el,
      update: function () {
        rows.forEach(function (u) { u(); });
        const p = OP.state.abs.plank;
        s.summary('Plank-Ziel ' + secText(Math.round(p.target)) + ' · Bestzeit ' + secText(p.best || 0));
      }
    };
  }

  /* ================= 4. Zirkus-Sperre (nur Info) ================= */

  function secLock(ctx) {
    const s = section('sperre', 'lock', 'Zirkus-Sperre', ctx.wide || OP.game.lockInfo().locked);
    const status = h('div', { class: 'zb-lock', role: 'status' });
    s.body.appendChild(status);

    function rule(iconName, html) {
      return h('li', null, h('span', { class: 'zb-rules__ico', html: icon(iconName) }), h('span', { html: html }));
    }
    s.body.appendChild(h('ul', { class: 'zb-rules' },
      rule('lock', '<b>' + D.CIRCUS_LOCK_DAYS + ' Tage ohne Zirkus-Eintrag</b> sperren ' + U.esc(areaList()) + '.'),
      rule('unlock', '<b>Entsperren:</b> im Zirkus einen Wert eintragen, z. B. 10 Sekunden Plank. Das Ziel musst du dafür nicht schaffen.'),
      rule('check', 'Nie gesperrt: die Taverne selbst und die Zirkus-Tänze.'),
      rule('timer', 'Schon gestartete Einheiten (Gym, Lauf-Timer, Schmuggler-Auftrag) kannst du auch gesperrt beenden.')));
    s.body.appendChild(btn('Zum Zirkus', 'zirkus', 'btn--gold btn--block', function () { OP.ui.go('taverne/zirkus'); }));

    function update() {
      const li = OP.game.lockInfo();
      let tone, iconName, title, text;
      if (li.locked) {
        tone = 'err'; iconName = 'lock'; title = 'Gesperrt';
        text = areaList() + ' sind zu. Trag im Zirkus einen Wert ein – dann ist sofort alles wieder frei.';
      } else if (li.warn) {
        tone = 'warn'; iconName = 'warning'; title = 'Morgen gesperrt';
        text = 'Trag heute noch etwas im Zirkus ein, dann bleibt alles frei.';
      } else {
        tone = 'ok'; iconName = 'unlock'; title = 'Alles frei';
        // lastDay = Sperr-Uhr (letzter Eintrag ODER Beginn der Schonfrist nach Einrichtung/Update)
        text = li.lastDay
          ? 'Gesperrt wird ' + futureDay(U.addDays(li.lastDay, D.CIRCUS_LOCK_DAYS)) + ', wenn du bis dahin nichts im Zirkus einträgst.'
          : 'Gesperrt wird erst nach ' + D.CIRCUS_LOCK_DAYS + ' Tagen ohne Zirkus-Eintrag.';
      }
      status.className = 'zb-lock zb-lock--' + tone;
      status.innerHTML = '';
      status.appendChild(h('span', { class: 'zb-lock__ico', html: icon(iconName) }));
      status.appendChild(h('div', { class: 'zb-lock__text' },
        h('strong', { text: title }),
        h('span', { text: text }),
        // nur ECHTE Einträge (nicht die Schonfrist nach Einrichtung oder Update)
        h('small', { text: 'Letzter Zirkus-Eintrag: ' + (li.lastEntryDay ? pastDay(li.lastEntryDay) : 'noch keiner') })));
      s.summary(li.locked ? 'Gesperrt – ab in den Zirkus!' : (li.warn ? 'Morgen gesperrt' : 'Alles frei'),
        li.locked ? 'err' : (li.warn ? 'warn' : null));
    }
    return { el: s.el, update: update };
  }

  /* ================= 5. Ausdauer (Lauf-Timer) ================= */

  function secRun(ctx) {
    const s = section('run', 'run', 'Ausdauer (Lauf-Timer)', ctx.wide);
    s.body.appendChild(intro('Deine Werte der beiden Lauf-Timer im Gym, in Minuten. Leer = noch kein Wert: Dann setzt dein nächster Lauf den Wert.'));
    const steadyDef = D.run('steady') || { name: 'Joggen am Stück', icon: 'run' };
    const totalDef = D.run('total') || { name: 'Laufzeit gesamt', icon: 'timer' };

    function checkMinutes(f, label) {
      const v = parseMinutes(f.input.value);
      if (!isFinite(v) || v < 0 || v > RUN_MAX) {
        invalid(f.input);
        toast(label + ': Bitte Minuten zwischen 0 und ' + U.fmt(RUN_MAX) + ' eingeben, z. B. 5,5.', 'warn');
        return null;
      }
      return floor2(v);
    }

    /* --- Joggen am Stück: nur das Ziel --- */
    const stF = numField({ label: 'Ziel', suffix: 'Min.', placeholder: 'kein Wert', compact: true });
    stF.input.setAttribute('aria-label', steadyDef.name + ': Ziel in Minuten');
    const stInfo = h('span', { class: 'zb-row__info' });

    function saveSteady(e) {
      e.preventDefault();
      const v = checkMinutes(stF, steadyDef.name);
      if (v == null) return;
      if (Math.abs(v - floor2(OP.state.run.steady.target)) < 1e-9) { markClean([stF.input]); update(); toast('Keine Änderung bei ' + steadyDef.name + '.', 'info'); return; }
      const res = OP.game.setRun('steady.target', v);
      if (!res || !res.ok) { toast((res && res.error) || 'Ging nicht.', 'err'); return; }
      markClean([stF.input]);
      update();
      toast(v > 0 ? steadyDef.name + ': Ziel ' + minText(v) : steadyDef.name + ': kein Wert – dein nächster Lauf setzt ihn.', 'ok');
    }

    const stBox = h('form', { class: 'zb-row zb-scope', novalidate: true, onsubmit: saveSteady },
      h('div', { class: 'zb-row__head' },
        h('span', { class: 'zb-row__ico zb-row__ico--run', html: icon(steadyDef.icon || 'run') }),
        h('span', { class: 'zb-row__name', text: steadyDef.name })),
      h('div', { class: 'zb-row__ctrl' }, stF.el, btn('Speichern', null, 'btn--violet zb-row__save zb-save', null, 'submit')),
      stInfo);

    /* --- Laufzeit gesamt: Rekord + Ziel --- */
    const recF = numField({ label: 'Rekord', suffix: 'Min.', placeholder: 'kein Wert', compact: true });
    const goalF = numField({ label: 'Ziel', suffix: 'Min.', placeholder: 'kein Wert', compact: true });
    recF.input.setAttribute('aria-label', totalDef.name + ': Rekord in Minuten');
    goalF.input.setAttribute('aria-label', totalDef.name + ': Ziel in Minuten');
    const ttInfo = h('span', { class: 'zb-row__info' });
    const ruleBtn = h('button', {
      class: 'chip chip--btn zb-chip--rule', type: 'button',
      onclick: function () {
        const r = parseMinutes(recF.input.value);
        if (!isFinite(r) || r <= 0) { invalid(recF.input); toast('Trag zuerst einen Rekord ein.', 'warn'); return; }
        goalF.input.value = minInput(round2(floor2(r) + D.RUN_TOTAL_STEP));
        goalF.input.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }, h('span', { html: icon('plus') }), 'Ziel = Rekord + ' + D.RUN_TOTAL_STEP + ' Min.');

    function saveTotal(e) {
      e.preventDefault();
      const r = checkMinutes(recF, 'Rekord');
      if (r == null) return;
      let g = checkMinutes(goalF, 'Ziel');
      if (g == null) return;
      let auto = false;
      if (r > 0 && !(g > 0)) { g = round2(r + D.RUN_TOTAL_STEP); auto = true; }   // Regel: Ziel = Rekord + 1 Minute
      const cur = OP.state.run.total;
      const recChanged = Math.abs(r - floor2(cur.record)) > 1e-9;
      const goalChanged = Math.abs(g - floor2(cur.goal)) > 1e-9;
      if (!recChanged && !goalChanged) { markClean([recF.input, goalF.input]); update(); toast('Keine Änderung bei ' + totalDef.name + '.', 'info'); return; }

      function apply() {
        if (recChanged) {
          const res = OP.game.setRun('total.record', r);
          if (!res || !res.ok) { toast((res && res.error) || 'Ging nicht.', 'err'); return; }
        }
        if (goalChanged) {
          const res2 = OP.game.setRun('total.goal', g);
          if (!res2 || !res2.ok) { toast((res2 && res2.error) || 'Ging nicht.', 'err'); return; }
        }
        markClean([recF.input, goalF.input]);
        update();
        if (!(r > 0) && !(g > 0)) toast(totalDef.name + ': kein Wert – dein nächster Lauf setzt ihn.', 'ok');
        else toast(totalDef.name + ': Rekord ' + minText(r) + ' · Ziel ' + minText(g) + (auto ? ' (Rekord + ' + D.RUN_TOTAL_STEP + ')' : ''), 'ok');
      }
      if (g > 0 && r > 0 && g < r) {
        OP.ui.confirm('Dein Ziel (' + minText(g) + ') ist kleiner als dein Rekord (' + minText(r) + '). Normal ist Rekord + ' + D.RUN_TOTAL_STEP + ' Minute. Trotzdem speichern?',
          { title: totalDef.name, okLabel: 'Speichern' })
          .then(function (ok) { if (ok) apply(); });
      } else apply();
    }

    const ttBox = h('form', { class: 'zb-row zb-scope', novalidate: true, onsubmit: saveTotal },
      h('div', { class: 'zb-row__head' },
        h('span', { class: 'zb-row__ico zb-row__ico--run', html: icon(totalDef.icon || 'timer') }),
        h('span', { class: 'zb-row__name', text: totalDef.name })),
      h('div', { class: 'zb-row__ctrl zb-row__ctrl--pair' }, recF.el, goalF.el,
        h('div', { class: 'zb-row__tools' }, ruleBtn),
        btn('Speichern', null, 'btn--violet zb-row__save zb-save', null, 'submit')),
      ttInfo);

    const activeNote = h('p', { class: 'zb-note', hidden: true });
    s.body.appendChild(h('div', { class: 'zb-list' }, stBox, ttBox));
    s.body.appendChild(activeNote);
    s.body.appendChild(h('p', { class: 'field__hint', text: 'Achtung: 8,50 Min. sind 8 Minuten 30 Sekunden (nicht 8,30).' }));

    function update() {
      const rs = OP.game.runStatus();
      setIfClean(stF.input, minInput(rs.steady.target));
      stInfo.textContent = (rs.steady.best > 0 ? 'Bestwert ' + minText(rs.steady.best) + ' · ' : '') +
        'Geschafft ' + rs.steady.wins + '× · Nicht geschafft ' + rs.steady.fails + '× · Retention −' +
        U.fmt1(D.RUN_STEADY_DECAY * 100) + ' % pro Tag (immer)';
      setIfClean(recF.input, minInput(rs.total.record));
      setIfClean(goalF.input, minInput(rs.total.goal));
      ttInfo.textContent = 'Läufe ' + rs.total.runs + ' · Geschafft ' + rs.total.wins + '× · Nicht geschafft ' + rs.total.fails + '×';
      if (rs.active) {
        const def = D.run(rs.active.kind), name = def ? def.name : 'Lauf';
        const tooLong = rs.active.minutes > RUN_MAX;   // vergessen: runStop wertet nichts über 24 Stunden
        activeNote.hidden = false;
        activeNote.classList.toggle('zb-note--warn', tooLong);
        activeNote.textContent = tooLong
          ? 'Der Timer (' + name + ') läuft schon über 24 Stunden und wird nicht mehr gewertet. Verwirf ihn im Gym und trag deine Zeit dort von Hand ein.'
          : 'Gerade läuft ein Timer (' + name + '). Beim Stoppen wird mit den Werten von dann gerechnet.';
      } else activeNote.hidden = true;
      const parts = [];
      if (rs.steady.target > 0) parts.push('Am Stück ' + minText(rs.steady.target));
      if (rs.total.record > 0) parts.push('Rekord ' + minText(rs.total.record));
      s.summary(parts.length ? parts.join(' · ') : 'Noch keine Läufe');
    }
    return { el: s.el, update: update };
  }

  /* ================= 6. Kalorienziel & Startgewicht ================= */

  function secKcal(ctx) {
    const s = section('kcal', 'kcal', 'Kalorienziel', ctx.wide);
    const f = numField({ label: 'Ziel', suffix: 'kg', placeholder: 'z. B. 20' });
    const sw = numField({ label: 'Startgewicht', suffix: 'kg', placeholder: 'z. B. 100' });
    f.input.setAttribute('aria-label', 'Ziel: Kilo Fett verlieren');
    sw.input.setAttribute('aria-label', 'Startgewicht in kg');
    const preview = h('div', { class: 'zb-kcal__value num' });
    const simVal = h('b', { class: 'num' });
    const goalVal = h('b', { class: 'num' });
    const sim = h('div', { class: 'zb-sim' },
      h('div', { class: 'zb-sim__cell' }, h('span', { text: 'Simuliertes Gewicht' }), simVal),
      h('span', { class: 'zb-sim__arrow', html: icon('next') }),
      h('div', { class: 'zb-sim__cell zb-sim__cell--goal' }, h('span', { text: 'Zielgewicht' }), goalVal));
    const info = h('p', { class: 'zb-row__info' });

    function readKg() { return f.input.value.trim() === '' ? 0 : U.parseNum(f.input.value); }

    /* Vorschau beim Tippen: Schulden in kcal, simuliertes Gewicht, Zielgewicht */
    function upd() {
      const st = OP.game.kcalStatus();
      const kg = readKg(), okKg = isFinite(kg) && kg >= 0 && kg <= 300;
      const w = U.parseNum(sw.input.value), okW = isFinite(w) && w >= 30 && w <= 400;
      preview.textContent = okKg ? '= ' + U.fmt(Math.round(kg * 10) / 10 * D.KCAL_PER_KG) + ' kcal Schulden' : 'Ziel: bitte 0 bis 300 kg';
      preview.classList.toggle('is-bad', !okKg);
      // neues Ziel nach "gesund": startet frisch, Abbezahltes zählt dann nicht mehr
      const paid = st.done && f.input.dataset.dirty && kg > 0 ? 0 : st.paid;
      simVal.textContent = okW ? U.fmt2(w - paid / D.KCAL_PER_KG) + ' kg' : '–';
      goalVal.textContent = okW && okKg && kg > 0 ? U.fmt2(w - Math.round(kg * 10) / 10) + ' kg' : '–';
      sim.classList.toggle('is-bad', !okW);
    }
    f.input.addEventListener('input', upd);
    sw.input.addEventListener('input', upd);

    /* Wie im Haus: Nach "ICH BIN GESUND!" startet ein neues Ziel frisch (kcalNewGoal, alte Einträge zählen nicht mehr).
       Während eines Ziels ändert sich nur die Größe (kcalSetGoal), Abbezahltes zählt weiter.
       Das Startgewicht (für das simulierte Gewicht) kommt aus kcalSetStartWeight. */
    function save(e) {
      e.preventDefault();
      const kg = readKg();
      if (!isFinite(kg) || kg < 0 || kg > 300) { invalid(f.input); toast('Bitte ein Ziel zwischen 0 und 300 kg.', 'warn'); return; }
      const w = U.parseNum(sw.input.value);
      if (!isFinite(w) || w < 30 || w > 400) { invalid(sw.input); toast('Startgewicht bitte zwischen 30 und 400 kg.', 'warn'); return; }
      const st = OP.game.kcalStatus();
      const kg1 = Math.round(kg * 10) / 10, w2 = round2(w);
      const goalChanged = kg1 !== st.goalKg || (st.done && !!f.input.dataset.dirty && kg1 > 0);
      const swChanged = Math.abs(w2 - st.startWeight) > 1e-9;
      if (!goalChanged && !swChanged) { markClean([f.input, sw.input]); update(); toast('Keine Änderung beim Kalorienziel.', 'info'); return; }
      const fresh = st.done && kg1 > 0 && goalChanged;

      function apply() {
        let res;
        if (fresh) {
          // Startgewicht: eingetippt – sonst dein Körpergewicht aus dem Profil
          res = OP.game.kcalNewGoal(kg1, swChanged || sw.input.dataset.dirty ? w2 : null);
          if (!res || !res.ok) { toast((res && res.error) || 'Ging nicht.', 'err'); return; }
        } else {
          if (goalChanged) {
            res = OP.game.kcalSetGoal(kg1);
            if (!res || !res.ok) { toast((res && res.error) || 'Ging nicht.', 'err'); return; }
          }
          if (swChanged) {
            res = OP.game.kcalSetStartWeight(w2);
            if (!res || !res.ok) { invalid(sw.input); toast((res && res.error) || 'Ging nicht.', 'err'); return; }
          }
        }
        markClean([f.input, sw.input]);
        update();
        const now = OP.game.kcalStatus();
        if (fresh) toast('Neues Ziel ab jetzt: ' + kgText(kg1) + ' kg · Start ' + kgText(now.startWeight) + ' kg', 'ok');
        else if (goalChanged && !now.hasGoal) toast('Kein Kalorienziel mehr.', 'ok');
        else if (goalChanged && now.done) toast('Ziel ' + kgText(kg1) + ' kg – schon abbezahlt!', 'ok');   // Feier kommt über das Achievement
        else if (goalChanged) toast((st.hasGoal ? 'Ziel geändert: ' : 'Ziel gesetzt: ') + kgText(kg1) + ' kg · noch ' + U.fmt(now.remaining) + ' kcal', 'ok');
        else toast('Startgewicht ' + kgText(now.startWeight) + ' kg · simuliert jetzt ' + U.fmt2(now.simWeight) + ' kg', 'ok');
      }
      if (!fresh && goalChanged && kg1 > 0 && !st.done && Math.round(kg1 * D.KCAL_PER_KG) <= st.paid) {
        OP.ui.confirm('Mit diesem Ziel sind deine Schulden sofort bezahlt. Speichern?', { title: 'Kalorienziel', okLabel: 'Speichern' })
          .then(function (ok) { if (ok) apply(); });
      } else apply();
    }

    s.body.appendChild(h('form', { class: 'stack zb-scope', novalidate: true, onsubmit: save },
      h('div', { class: 'zb-grid2 zb-grid2--even' }, f.el, sw.el),
      h('div', { class: 'zb-kcal' }, preview, h('span', { class: 'field__hint', text: 'Ziel = Kilo Fett, die du verlieren willst · 1 kg ≈ ' + U.fmt(D.KCAL_PER_KG) + ' kcal · 0 = kein Ziel' })),
      sim,
      h('p', { class: 'field__hint', text: 'Startgewicht = dein Gewicht, als dein Ziel begann. Simuliertes Gewicht = Startgewicht − Defizit ÷ ' + U.fmt(D.KCAL_PER_KG) + '. Wiegst du dich täglich, vergleich deinen Wochenschnitt damit: Liegt er nah dran, stimmt dein Defizit.' }),
      info,
      btn('Speichern', 'check', 'btn--violet btn--block zb-save', null, 'submit')));

    function update() {
      const st = OP.game.kcalStatus();
      setIfClean(f.input, toInput(st.goalKg));
      setIfClean(sw.input, toInput(st.startWeight));
      if (!f.input.dataset.dirty && !sw.input.dataset.dirty) upd();
      const since = st.baseT ? ' seit ' + U.dayLabel(U.dayKey(st.baseT)) : '';
      if (st.done) {
        info.textContent = 'Ziel geschafft! Ein neues Ziel startet frisch – deine alten Einträge zählen dann nicht mehr mit.';
      } else {
        info.textContent = 'Schon abbezahlt' + since + ': ' + U.fmt(Math.max(0, st.paid)) + ' kcal' +
          (st.hasGoal ? ' · Noch offen: ' + U.fmt(st.remaining) + ' kcal (' + U.pct(st.pctRemaining) + ')' : '') +
          '. Änderst du das Ziel, zählt das Abbezahlte weiter.';
      }
      s.summary(!st.hasGoal ? 'Kein Ziel gesetzt' : kgText(st.goalKg) + ' kg · ' + (st.done ? 'geschafft!' : 'simuliert ' + U.fmt2(st.simWeight) + ' kg'));
    }
    return { el: s.el, update: update };
  }

  /* ================= 7. Rang-Schwellen (je Muskel) ================= */

  function thEditor(m, list) {
    const key = 'th-' + m.id;
    const defaults = (D.RANK_DEFAULTS && D.RANK_DEFAULTS[m.id]) || D.RANK_THRESHOLDS;
    const chip = h('span', { class: 'chip zb-chip--custom', text: 'Eigene', hidden: true });
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
      const f = numField({ integer: true, placeholder: String(defaults[i]) });
      f.input.setAttribute('aria-label', m.name + ': ' + r.name + ' ab XP');
      if (i === 0) { f.input.value = '0'; f.input.disabled = true; }
      inputs.push(f.input);
      f.input.addEventListener('input', preview);
      grid.appendChild(h('div', { class: 'zb-th__cell', style: { '--rank-color': r.color } },
        h('span', { class: 'zb-th__label' }, h('span', { class: 'zb-th__gem' }), r.name),
        f.el));
    });
    const prev = h('div', { class: 'zb-th__prev' });
    const std = h('p', { class: 'zb-th__std', hidden: true });
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
      grid, prev, std, err,
      h('div', { class: 'zb-th__actions' },
        btn('Speichern', 'check', 'btn--violet zb-save', save),
        btn('Standard', 'refresh', 'btn--ghost', reset))));
    list.appendChild(det);

    function update() {
      const th = OP.game.thresholds(m.id);
      const custom = !!(OP.state.settings.rankOverrides && OP.state.settings.rankOverrides[m.id]);
      chip.hidden = !custom;   // Chip nur bei eigenen Werten (Standard ist der Normalfall)
      std.hidden = !custom;
      std.textContent = 'Standard: ' + defaults.slice(1).map(function (v) { return U.fmt(v); }).join(' · ');
      badge.innerHTML = '';
      badge.appendChild(OP.ui.rankBadge(OP.game.rankFor(m.id).rank, { small: true }));
      inputs.forEach(function (inp, i) { if (i > 0) setIfClean(inp, String(th[i])); });
      if (!inputs.some(function (i) { return i.dataset.dirty; })) preview();
    }
    return update;
  }

  function secRanks(ctx) {
    const s = section('ranks', 'rank', 'Rang-Schwellen', ctx.wide);
    s.body.appendChild(intro('Ab wie viel XP gilt welcher Rang? Jeder Muskel hat eigene Werte – Bizeps und Trizeps sind kleiner, darum sind ihre Schwellen niedriger. „Standard“ holt die Grundwerte zurück.'));
    const editors = [];
    D.GROUPS.forEach(function (g) {
      const box = groupBox(g);
      box.el.classList.add('zb-group--th');
      g.muscles.forEach(function (id) { editors.push(thEditor(D.muscle(id), box.list)); });
      s.body.appendChild(box.el);
    });
    const runnerLine = h('p', { class: 'field__hint' });
    s.body.appendChild(runnerLine);
    s.body.appendChild(h('p', { class: 'field__hint', text: 'Bauch-Rang (beste Plank-Zeit, fest): ' +
      D.RANKS.slice(1).map(function (r, i) { return r.name + ' ' + D.ABS_RANK_SECONDS[i + 1] + ' s'; }).join(' · ') }));

    return {
      el: s.el,
      update: function () {
        editors.forEach(function (u) { u(); });
        const o = OP.state.settings.rankOverrides || {};
        const names = D.MUSCLES.filter(function (m) { return o[m.id]; }).map(function (m) { return m.name; });
        s.summary(!names.length ? 'Standard für alle' : (names.length <= 2 ? names.join(' und ') : names.length + ' Muskeln') + ' angepasst');
        const rt = OP.game.runnerThresholds(), gold = D.RANKS.findIndex(function (r) { return r.id === 'gold'; });
        runnerLine.textContent = 'Dein Runner-Rang nutzt die Summe dieser Schwellen' +
          (gold > 0 ? ' (z. B. ' + D.RANKS[gold].name + ' ab ' + U.fmt(rt[gold]) + ' Gesamtstärke).' : '.');
      }
    };
  }

  /* ================= 8. Effekte & Vibration ================= */

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

  /* ================= 9. Spielstand sichern ================= */

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
     Der Speicher legt automatisch Kopien an: vor dem letzten Import, vor dem letzten Zurücksetzen,
     einmal vor dem Update auf Push/Pull/Beine (KEY + '.vor-v2', alter Stand der Version 1 – wird beim
     Zurückholen wieder umgestellt) und von beschädigten Spielständen (KEY + '.defekt.<Zeitstempel>', Rohtext,
     evtl. kein gültiges JSON).
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
    [['.vor-import', 'vor dem letzten Import'], ['.vor-reset', 'vor dem letzten Zurücksetzen'],
      ['.vor-v2', 'vor dem Update auf Push/Pull/Beine']].forEach(function (p) {
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

  /** Nach einem Import wie beim App-Start die Tage seit dem Sichern nachholen: Retention, Abbau von Bauch-/Lauf-Zielen,
      alten offenen Zirkus-Tanz schließen. (Die Update-Nachricht nach einem alten Spielstand zeigt app.js selbst.) */
  function catchUpDays() {
    let r = null;
    try { r = OP.game.onNewDayCheck(); } catch (e) { console.error('[zauberbude] Tagesprüfung', e); }
    if (r && r.days) {
      toast('Retention: ' + r.days + (r.days === 1 ? ' Tag' : ' Tage') + ' ohne Training → alle Werte −' +
        U.fmt2((1 - r.factor) * 100) + ' %', 'warn', 5200);
    }
  }

  function doImport(text, okMsg) {
    const res = OP.store.importText(text);
    if (!res || !res.ok) { toast((res && res.error) || 'Import ging nicht.', 'err', 5000); return res || { ok: false }; }
    importDraft = '';
    toast(okMsg || 'Spielstand geladen.', 'ok', 3500);
    catchUpDays();
    OP.ui.router.refresh();   // sofort neu aufbauen – danach wird nicht mehr navigiert (sonst ginge die Update-Nachricht zu)
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
      backupBox.appendChild(h('p', { class: 'field__hint', text: 'Automatische Kopien: vor dem letzten Import, vor dem letzten Zurücksetzen, vor dem Update auf Push/Pull/Beine und von beschädigten Spielständen. Zurückholen ersetzt deinen jetzigen Stand – vorher wird er selbst gesichert.' }));
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

  /* ================= 10. App ================= */

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
     IDs: runner, xp, abs, sperre, run, kcal, ranks, fx, save, app (z. B. aus der Hilfe: 'zauberbude/ranks') */
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
    const parts = [secRunner, secXp, secAbs, secLock, secRun, secKcal, secRanks, secFx, secSave, secApp].map(function (fn) {
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
