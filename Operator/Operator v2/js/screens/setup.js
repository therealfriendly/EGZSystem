/* Operator – Ersteinrichtung (Bildschirm 'setup')
   Assistent in 7 Schritten: Name → Körpergewicht → Startwerte (Push/Pull/Beine) → Bauch → Ausdauer → Kalorien → Quests.
   Der Router zeigt diesen Bildschirm, solange OP.state.setupDone false ist.
   Alle Eingaben liegen im Modul-Zustand W (zusätzlich als Entwurf in localStorage),
   damit beim Neuaufbau, Neuladen oder Schließen der App nichts verloren geht.
   Der Entwurf gehört zu genau einem Spielstand (stateId = OP.state.created): nach einem Reset
   oder Import wird ein alter Entwurf automatisch verworfen. Entwürfe der Version 1 ("Arme",
   ein seitlicher Plank, 6 Schritte) werden beim Laden umgerechnet.
   Zahlen immer mit U.parseNum lesen ("2.000" = 2000, "22,5" = 22.5). */
(function () {
  'use strict';
  const OP = window.OP;
  if (!OP || !OP.screens || !OP.ui) return;
  const U = OP.util, D = OP.data, h = OP.h;

  const DRAFT_KEY = 'op.setupDraft';
  const DRAFT_V = 2;        // Version des Entwurfs (ohne v = Version 1)

  const STEPS = [
    { id: 'name', label: 'Name', icon: 'portal' },
    { id: 'gewicht', label: 'Gewicht', icon: 'scale' },
    { id: 'staerke', label: 'Stärke', icon: 'staerke' },
    { id: 'bauch', label: 'Bauch', icon: 'bauch' },
    { id: 'ausdauer', label: 'Ausdauer', icon: 'run' },
    { id: 'kalorien', label: 'Kalorien', icon: 'kcal' },
    { id: 'quests', label: 'Quests', icon: 'quest' }
  ];
  /* Schritte der Version 1 – nur zum Umrechnen alter Entwürfe */
  const OLD_STEPS = ['name', 'gewicht', 'staerke', 'bauch', 'kalorien', 'quests'];

  /* Vorschläge für die ersten Tages-Quests (vorausgewählt, per Tipp abwählbar) */
  const SUGGESTIONS = [
    { title: '5 Std. Lernen', cat: 'lernen' },
    { title: 'Training', cat: 'training' },
    { title: 'Bewerbung schreiben', cat: 'arbeit' },
    { title: 'Lesen', cat: 'lernen' },
    { title: 'Wasser trinken', cat: 'gesundheit' }
  ];

  /* Texte zu den beiden Lauf-Timern (Namen kommen aus OP.data.RUNS) */
  const RUN_TEXT = {
    steady: { icon: 'run', ask: 'Wie lange kannst du am Stück joggen, ohne Pause?' },
    total: { icon: 'timer', ask: 'Mit Gehpausen: Wie viele Minuten Laufen schaffst du insgesamt? Die Gehzeit zählt nicht.' }
  };

  const XP_MAX = 1000000;
  const RUN_MAX = 1440;     // Minuten (wie OP.game.setRun)

  /* ---------- kleine Helfer ---------- */

  function icon(name, cls) { return OP.ui.icon(name, cls); }

  /** Zahl für ein Eingabefeld: 82.5 -> "82,5" */
  function toInput(v) { return v == null ? '' : String(v).replace('.', ','); }

  /** "82,5 kg" / "80 kg" */
  function kgText(v) { return U.fmt1(v).replace(/,0$/, ''); }

  /** Minuten immer mit zwei Nachkommastellen: 8.59 -> "8,59 Min." */
  function minText(v) { return U.fmt2(v) + ' Min.'; }   // geschütztes Leerzeichen: "8,59 Min." bricht nicht um

  /** Minuten lesen: "5,5" = 5,5 Minuten; "8:30" (Minuten:Sekunden) = 8,5 Minuten */
  function parseMinutes(raw) {
    const s = String(raw == null ? '' : raw).trim();
    const m = /^(\d{1,4}):([0-5]\d)$/.exec(s);
    if (m) return Number(m[1]) + Number(m[2]) / 60;
    return U.parseNum(s);
  }
  /** wie OP.game: auf zwei Nachkommastellen abrunden (8,593 -> 8,59) */
  function floor2(v) { return Math.floor(v * 100 + 1e-7) / 100; }

  function isBlank(v) { return String(v == null ? '' : v).trim() === ''; }

  function stepIndex(id) {
    for (let i = 0; i < STEPS.length; i++) if (STEPS[i].id === id) return i;
    return -1;
  }

  /** Rang-Index für einen Wert (wie OP.game.rankFor, aber mit beliebigen Schwellen) */
  function rankIndex(value, th) {
    let idx = 0;
    for (let i = 0; i < th.length; i++) if (value >= th[i]) idx = i;
    return idx;
  }

  /* ---------- Assistent-Zustand ---------- */

  let W = null;

  /** Zu welchem Spielstand gehört der Entwurf? */
  function stateId() { return (OP.state && OP.state.created) || 0; }

  /** Gespeicherter Name – "Runner" ist nur der Standard und wird als Platzhalter gezeigt, nicht als Text im Feld */
  function realName(p) { return p && p.name && p.name !== 'Runner' ? p.name : ''; }

  function freshWizard() {
    const p = (OP.state && OP.state.player) || {};
    const w = {
      v: DRAFT_V,
      stateId: stateId(),
      step: 0, maxStep: 0,
      name: realName(p),
      bodyweight: '',
      muscles: {}, abs: {}, run: { steady: '', total: '' }, goalKg: '',
      picks: {}, custom: [], newTitle: '', newCat: 'lernen'
    };
    D.MUSCLE_IDS.forEach(function (id) { w.muscles[id] = ''; });
    D.ABS_EXERCISES.forEach(function (ex) { w.abs[ex.id] = toInput(ex.start); });
    SUGGESTIONS.forEach(function (s, i) { w.picks[i] = true; });
    return w;
  }

  /** Minuten für ein Eingabefeld: 8.5 -> "8,50" (leer = noch kein Wert) */
  function minInput(v) { return v > 0 ? floor2(v).toFixed(2).replace('.', ',') : ''; }

  /** Werte aus einem (unfertigen) importierten Spielstand übernehmen */
  function prefillFromState(w) {
    const s = OP.state;
    if (!s) return w;
    if (s.player) {
      w.name = realName(s.player);
      if (s.player.bodyweight) w.bodyweight = toInput(s.player.bodyweight);
    }
    D.MUSCLE_IDS.forEach(function (id) {
      const m = s.muscles && s.muscles[id];
      if (m && m.xp > 0) w.muscles[id] = String(Math.round(m.xp));
    });
    D.ABS_EXERCISES.forEach(function (ex) {
      const a = s.abs && s.abs[ex.id];
      if (a && a.target > 0) w.abs[ex.id] = toInput(a.target);
    });
    if (s.run) {
      if (s.run.steady && s.run.steady.target > 0) w.run.steady = minInput(s.run.steady.target);
      if (s.run.total && s.run.total.record > 0) w.run.total = minInput(s.run.total.record);
    }
    if (s.kcal && s.kcal.goalKg > 0) w.goalKg = toInput(s.kcal.goalKg);
    // Hat der Spielstand schon Quests, keine Vorschläge doppelt anlegen
    const hasQuests = s.quests && s.quests.list && s.quests.list.some(function (q) { return !q.archived; });
    if (hasQuests) SUGGESTIONS.forEach(function (q, i) { w.picks[i] = false; });
    return w;
  }

  /** Entwurf der Version 1 umrechnen: "Arme" je zur Hälfte Bizeps/Trizeps, ein seitlicher Plank für links und rechts,
      Schritt-Nummern über die Schritt-Namen (der Ausdauer-Schritt ist neu) */
  function convertV1Draft(d) {
    const m = d.muscles && typeof d.muscles === 'object' ? d.muscles : null;
    if (m && typeof m.arme === 'string' && !isBlank(m.arme)) {
      const v = U.parseNum(m.arme);
      if (isFinite(v) && v >= 0) {
        const half = String(Math.round(v / 2));
        if (typeof m.bizeps !== 'string' || isBlank(m.bizeps)) m.bizeps = half;
        if (typeof m.trizeps !== 'string' || isBlank(m.trizeps)) m.trizeps = half;
      }
    }
    const a = d.abs && typeof d.abs === 'object' ? d.abs : null;
    if (a && typeof a.seitplank === 'string') {
      if (typeof a.seitplank_l !== 'string') a.seitplank_l = a.seitplank;
      if (typeof a.seitplank_r !== 'string') a.seitplank_r = a.seitplank;
    }
    function mapStep(i) {
      const id = OLD_STEPS[U.clamp(Math.floor(Number(i) || 0), 0, OLD_STEPS.length - 1)];
      return Math.max(0, stepIndex(id));
    }
    d.step = mapStep(d.step);
    d.maxStep = mapStep(d.maxStep);
    return d;
  }

  function loadDraft() {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (!raw) return null;
      let d = JSON.parse(raw);
      if (!d || typeof d !== 'object') return null;
      if (d.stateId !== stateId()) return null;   // Entwurf von einem anderen (z. B. zurückgesetzten) Spielstand
      if (d.v !== DRAFT_V) d = convertV1Draft(d);
      const w = freshWizard();
      ['name', 'bodyweight', 'goalKg', 'newTitle', 'newCat'].forEach(function (k) { if (typeof d[k] === 'string') w[k] = d[k]; });
      // nur bekannte Felder übernehmen – alte Schlüssel (arme, seitplank) fallen so weg
      ['muscles', 'abs', 'run'].forEach(function (k) {
        if (d[k] && typeof d[k] === 'object') Object.keys(w[k]).forEach(function (id) { if (typeof d[k][id] === 'string') w[k][id] = d[k][id]; });
      });
      if (d.picks && typeof d.picks === 'object') SUGGESTIONS.forEach(function (s, i) { if (typeof d.picks[i] === 'boolean') w.picks[i] = d.picks[i]; });
      if (Array.isArray(d.custom)) {
        w.custom = d.custom.filter(function (q) { return q && typeof q.title === 'string' && q.title.trim(); })
          .map(function (q) { return { title: q.title.slice(0, 60), cat: D.questCategory(q.cat).id }; });
      }
      w.step = U.clamp(Math.floor(Number(d.step) || 0), 0, STEPS.length - 1);
      w.maxStep = U.clamp(Math.floor(Number(d.maxStep) || 0), w.step, STEPS.length - 1);
      return w;
    } catch (e) { return null; }
  }

  const saveDraft = U.debounce(function () {
    if (!W) return;
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify(W)); } catch (e) { /* egal */ }
  }, 250);

  function clearDraft() {
    W = null;
    try { localStorage.removeItem(DRAFT_KEY); sessionStorage.removeItem(DRAFT_KEY); } catch (e) { /* egal */ }
  }

  /** Notfall-Sicherungen (vor Reset/Import, beschädigte Stände). Die Liste kommt aus der Zauberbude (OP.backups).
      Hier nur, was beim Neustart hilft: eingerichtete Stände zum Zurückholen und beschädigte Stände. */
  function findBackups() {
    if (!OP.backups || !OP.backups.list) return [];
    try {
      return OP.backups.list().filter(function (b) { return b.kind === 'defekt' || (b.ok && b.done); });
    } catch (e) { console.error('[setup] Sicherungen', e); return []; }
  }

  /** Nach einem Import wie beim App-Start die Tage seit dem Sichern nachholen (Retention, Abbau der Bauch-/Lauf-Ziele,
      alten offenen Zirkus-Tanz schließen). Die Update-Nachricht nach einem alten Spielstand zeigt app.js selbst. */
  function catchUpDays() {
    let r = null;
    try { r = OP.game.onNewDayCheck(); } catch (e) { console.error('[setup] Tagesprüfung', e); }
    if (r && r.days) {
      OP.ui.toast('Retention: ' + r.days + (r.days === 1 ? ' Tag' : ' Tage') + ' ohne Training → alle Werte −' +
        U.fmt2((1 - r.factor) * 100) + ' %', { type: 'warn', icon: 'warning', ms: 5200 });
    }
  }

  function bodyweightGuess() {
    const bw = U.parseNum(W && W.bodyweight);
    if (isFinite(bw) && bw >= 30 && bw <= 300) return bw;
    return (OP.state && OP.state.player && OP.state.player.bodyweight) || D.DEFAULT_BODYWEIGHT || 80;
  }

  /* ---------- Prüfung der Eingaben (arbeitet nur mit W) ---------- */

  /** -> null (alles gut) oder {msg, field} */
  function validateStep(i) {
    const id = STEPS[i] && STEPS[i].id;
    if (id === 'gewicht') {
      if (isBlank(W.bodyweight)) return { msg: 'Bitte trag dein Körpergewicht ein.', field: 'bw' };
      const bw = U.parseNum(W.bodyweight);
      if (!isFinite(bw)) return { msg: 'Das ist keine Zahl. Beispiel: 82 oder 82,5', field: 'bw' };
      if (bw < 30 || bw > 300) return { msg: 'Bitte ein Körpergewicht zwischen 30 und 300 kg.', field: 'bw' };
    }
    if (id === 'staerke') {
      for (let k = 0; k < D.MUSCLES.length; k++) {
        const m = D.MUSCLES[k], raw = W.muscles[m.id];
        if (isBlank(raw)) return { msg: 'Bei ' + m.name + ' fehlt noch ein Wert. Schätzen reicht – 0 geht auch.', field: 'm-' + m.id };
        const v = U.parseNum(raw);
        if (!isFinite(v)) return { msg: m.name + ': Bitte nur eine Zahl eintragen, z. B. 2000.', field: 'm-' + m.id };
        if (v < 0 || v > XP_MAX) return { msg: m.name + ': Bitte einen Wert zwischen 0 und ' + U.fmt(XP_MAX) + '.', field: 'm-' + m.id };
      }
    }
    if (id === 'bauch') {
      for (let k = 0; k < D.ABS_EXERCISES.length; k++) {
        const ex = D.ABS_EXERCISES[k], raw = W.abs[ex.id];
        const unit = ex.unit === 's' ? 's' : 'Wdh.';
        const max = ex.unit === 's' ? 3600 : 1000;
        if (isBlank(raw)) return { msg: ex.name + ': Bitte ein Startziel eintragen.', field: 'a-' + ex.id };
        const v = U.parseNum(raw);
        if (!isFinite(v)) return { msg: ex.name + ': Bitte nur eine Zahl eintragen.', field: 'a-' + ex.id };
        if (v < 1) return { msg: ex.name + ': Das Ziel muss mindestens 1 ' + unit + ' sein.', field: 'a-' + ex.id };
        if (v > max) return { msg: ex.name + ': Höchstens ' + U.fmt(max) + ' ' + unit + ' – das reicht für den Anfang.', field: 'a-' + ex.id };
      }
    }
    if (id === 'ausdauer') {
      for (let k = 0; k < D.RUNS.length; k++) {
        const r = D.RUNS[k], raw = W.run[r.id];
        if (isBlank(raw)) continue;                 // freiwillig: leer = der erste Lauf setzt den Wert
        const v = parseMinutes(raw);
        if (!isFinite(v)) return { msg: r.name + ': Bitte Minuten als Zahl eintragen, z. B. 5 oder 5,5.', field: 'r-' + r.id };
        if (v < 0 || v > RUN_MAX) return { msg: r.name + ': Bitte 0 bis ' + U.fmt(RUN_MAX) + ' Minuten.', field: 'r-' + r.id };
      }
    }
    if (id === 'kalorien' && !isBlank(W.goalKg)) {
      const kg = U.parseNum(W.goalKg);
      if (!isFinite(kg)) return { msg: 'Das ist keine Zahl. Beispiel: 20 oder 7,5', field: 'kg' };
      if (kg < 0 || kg > 300) return { msg: 'Bitte ein Ziel zwischen 0 und 300 kg.', field: 'kg' };
      if (kg > 0 && bodyweightGuess() - kg < 30) return { msg: 'Mit diesem Ziel wärst du unter 30 kg. Bitte prüf die Zahl.', field: 'kg' };
    }
    return null;
  }

  /** Minuten eines Lauf-Felds (leer/ungültig = 0 = noch kein Wert) */
  function runValue(id) {
    const v = isBlank(W.run[id]) ? 0 : parseMinutes(W.run[id]);
    return isFinite(v) && v > 0 ? floor2(v) : 0;
  }

  /** Alles für OP.game.completeSetup einsammeln */
  function collect() {
    const muscles = {}, abs = {};
    D.MUSCLE_IDS.forEach(function (id) { muscles[id] = Math.round(U.parseNum(W.muscles[id])); });
    D.ABS_EXERCISES.forEach(function (ex) {
      const v = U.parseNum(W.abs[ex.id]);
      // Sekunden ganz, Wiederholungen dürfen Kommazahlen sein (angezeigt wird abgerundet)
      abs[ex.id] = ex.unit === 's' ? Math.round(v) : Math.round(v * 100) / 100;
    });
    const quests = [];
    SUGGESTIONS.forEach(function (s, i) { if (W.picks[i]) quests.push({ title: s.title, cat: s.cat }); });
    W.custom.forEach(function (q) { quests.push({ title: q.title, cat: q.cat }); });
    const kg = isBlank(W.goalKg) ? 0 : U.parseNum(W.goalKg);
    return {
      name: String(W.name || '').trim().slice(0, 24) || 'Runner',
      bodyweight: U.parseNum(W.bodyweight),
      muscles: muscles, abs: abs,
      run: { steady: runValue('steady'), total: runValue('total') },
      goalKg: isFinite(kg) ? kg : 0,
      quests: quests
    };
  }

  function questCount() {
    let n = W.custom.length;
    SUGGESTIONS.forEach(function (s, i) { if (W.picks[i]) n++; });
    return n;
  }

  /* ---------- Bausteine ---------- */

  function emblem(name, tone) {
    return h('div', { class: 'su-emblem' + (tone ? ' su-emblem--' + tone : ''), 'aria-hidden': 'true' },
      h('span', { class: 'su-emblem__ring' }),
      h('span', { class: 'su-emblem__core', html: icon(name) }));
  }

  function hero(iconName, title, lead, tone) {
    return h('div', { class: 'su-hero' },
      emblem(iconName, tone),
      h('div', { class: 'su-hero__text' },
        h('h2', { class: 'su-title', text: title }),
        lead ? h('p', { class: 'su-lead', text: lead }) : null));
  }

  /** Zahlenfeld mit Rohwert aus W (Wert NICHT über numField-Option setzen, sonst wird "2.000" zu "2,000") */
  function numInput(opts, raw, field, onChange) {
    const f = OP.ui.numField(opts);
    f.input.value = raw == null ? '' : raw;
    f.input.dataset.field = field;
    f.input.dataset.nav = '1';
    f.input.addEventListener('input', function () {
      f.input.classList.remove('is-invalid');
      onChange(f.input.value);
      saveDraft();
    });
    return f;
  }

  /* ---------- Rechner (kg × Wdh. × Sätze) ---------- */

  function openCalc(muscle, current, onApply) {
    const bw = bodyweightGuess();
    const wF = OP.ui.numField({ label: 'Gewicht', suffix: 'kg', placeholder: 'z. B. 60' });
    const rF = OP.ui.numField({ label: 'Wdh.', placeholder: '10', integer: true });
    const sF = OP.ui.numField({ label: 'Sätze', placeholder: '3', integer: true, value: 3 });
    [wF, rF, sF].forEach(function (f) { f.input.dataset.nav = '1'; });
    const out = h('div', { class: 'su-calc__out num', text: '= 0 XP' });
    const err = h('p', { class: 'su-calc__err', role: 'alert', hidden: true });

    function result() {
      const w = wF.value(), r = rF.value(), s = sF.value();
      if (!isFinite(w) || !isFinite(r) || !isFinite(s) || w <= 0 || r <= 0 || s <= 0) return NaN;
      return w * r * s;
    }
    function upd() {
      const v = result();
      out.textContent = '= ' + (isFinite(v) ? U.fmt(v) : '0') + ' XP';
      err.hidden = true;
    }
    [wF, rF, sF].forEach(function (f) { f.input.addEventListener('input', upd); });

    function apply(add) {
      const v = result();
      if (!isFinite(v)) {
        err.textContent = 'Bitte Gewicht, Wiederholungen und Sätze eintragen (jeweils größer 0).';
        err.hidden = false;
        return false;
      }
      onApply(Math.round(add ? (current > 0 ? current : 0) + v : v));
      return true;
    }

    const bwChip = h('button', { class: 'chip chip--btn su-calc__bw', type: 'button', onclick: function () { wF.set(bw); upd(); rF.input.focus(); } },
      h('span', { html: icon('body') }), 'Körpergewicht (' + kgText(bw) + ' kg)');

    let dlg = null;
    const form = h('form', { class: 'su-calc', novalidate: true, onsubmit: function (e) { e.preventDefault(); if (apply(false) && dlg) dlg.close(); } },
      h('p', { class: 'su-calc__intro', text: 'Eine Übung für ' + muscle.name + ': Gewicht × Wiederholungen × Sätze.' }),
      h('div', { class: 'su-calc__row' }, wF.el, h('span', { class: 'su-calc__x', text: '×' }), rF.el, h('span', { class: 'su-calc__x', text: '×' }), sF.el),
      bwChip,
      out,
      err,
      h('p', { class: 'su-calc__tip', text: current > 0
        ? 'Mehrere Übungen? „Dazurechnen“ zählt zu deinen ' + U.fmt(current) + ' XP dazu.'
        : 'Mehrere Übungen? Erst eine übernehmen, dann den Rechner nochmal öffnen und „Dazurechnen“ tippen.' }));
    form.addEventListener('keydown', enterToNext(function () { if (apply(false) && dlg) dlg.close(); }));

    const actions = [{ label: 'Abbrechen', kind: 'ghost' }];
    if (current > 0) actions.push({ label: 'Dazurechnen', kind: 'ghost', icon: 'plus', onClick: function () { return apply(true); } });
    actions.push({ label: 'Übernehmen', kind: 'primary', icon: 'check', onClick: function () { return apply(false); } });
    dlg = OP.ui.modal({ title: 'XP-Rechner · ' + muscle.name, body: form, actions: actions });
    return dlg;
  }

  /** Enter springt ins nächste Feld; im letzten Feld wird onLast() ausgeführt */
  function enterToNext(onLast) {
    return function (e) {
      if (e.key !== 'Enter' || e.isComposing) return;
      const t = e.target;
      if (!t || t.tagName !== 'INPUT' || !t.dataset.nav) return;
      e.preventDefault();
      const list = Array.prototype.slice.call(e.currentTarget.querySelectorAll('input[data-nav]'))
        .filter(function (x) { return !x.disabled && x.offsetParent !== null; });
      const i = list.indexOf(t);
      if (i >= 0 && i < list.length - 1) { list[i + 1].focus(); revealField(list[i + 1]); }
      else onLast();
    };
  }

  /** Fokussiertes Feld (möglichst mit seiner ganzen Zeile samt Rang-Hinweis) nicht hinter der klebenden
      Zurück/Weiter-Leiste lassen. Chrome hält das Feld dank scroll-padding (setup.css) schon frei;
      das hier zeigt auch den Rest der Zeile und sichert Browser ab, die scroll-padding beim Fokus nicht beachten. */
  function revealField(input) {
    const body = input.closest('.screen__body');
    const nav = body && body.querySelector('.su-nav');
    if (!nav) return;                                   // z. B. im Rechner-Dialog: keine Leiste
    const top = body.getBoundingClientRect().top + 8, bottom = nav.getBoundingClientRect().top - 8;
    const box = (input.closest('.su-muscle, .su-abs__row, .su-run') || input).getBoundingClientRect();
    const field = input.getBoundingClientRect();
    let delta = 0;
    if (box.bottom > bottom) delta = Math.min(box.bottom - bottom, field.top - top);   // hochschieben, Feld aber nie oben hinaus
    else if (field.top < top) delta = field.top - top;                                  // Feld oben verdeckt
    if (delta) body.scrollTop += delta;
  }

  /* ---------- Import-Dialog ("Ich habe schon einen Spielstand") ---------- */

  function openImport(afterImport) {
    const ta = h('textarea', {
      class: 'input textarea su-import__ta', rows: '5', placeholder: 'OPERATOR-SAVE:1:…',
      spellcheck: 'false', autocapitalize: 'off', autocomplete: 'off', 'aria-label': 'Gesicherter Spielstand'
    });
    const err = h('p', { class: 'su-calc__err', role: 'alert', hidden: true });
    const fileIn = h('input', { type: 'file', accept: '.txt,.json,text/plain,application/json', class: 'sr-only', tabindex: '-1' });
    fileIn.addEventListener('change', function () {
      const f = fileIn.files && fileIn.files[0];
      if (!f) return;
      const rd = new FileReader();
      rd.onload = function () { ta.value = String(rd.result || '').trim(); err.hidden = true; };
      rd.onerror = function () { err.textContent = 'Die Datei konnte nicht gelesen werden.'; err.hidden = false; };
      rd.readAsText(f);
      fileIn.value = '';   // gleiche Datei nochmal wählbar
    });
    const fileBtn = h('button', { class: 'btn btn--ghost btn--sm', type: 'button', onclick: function () { fileIn.click(); } },
      h('span', { html: icon('upload') }), 'Datei öffnen');

    let dlg = null;
    function run(text) {
      const res = OP.store.importText(text);
      if (!res || !res.ok) {
        err.textContent = (res && res.error) || 'Das hat nicht geklappt.';
        err.hidden = false;
        return false;
      }
      afterImport();
      return true;
    }

    /* Notfall-Sicherungen in diesem Browser: lesbare zurückholen, kaputte als Datei retten */
    const backups = findBackups();
    const backupBox = backups.length ? h('div', { class: 'su-backups' },
      h('div', { class: 'su-backups__title', text: backups.length === 1 ? 'Sicherung gefunden' : 'Sicherungen gefunden' }),
      backups.map(function (b) {
        return h('div', { class: 'su-backup' + (b.kind === 'defekt' ? ' su-backup--bad' : '') },
          h('span', { class: 'su-backup__ico', html: icon(b.kind === 'defekt' ? 'warning' : 'refresh') }),
          h('div', { class: 'su-backup__text' }, h('strong', { text: b.title }), h('span', { text: b.sub })),
          b.ok
            ? h('button', { class: 'btn btn--sm btn--violet', type: 'button', onclick: function () { if (run(b.raw) && dlg) dlg.close(); } },
              h('span', { html: icon('refresh') }), 'Zurückholen')
            : h('button', { class: 'btn btn--sm btn--ghost', type: 'button', onclick: function () { OP.backups.saveFile(b); } },
              h('span', { html: icon('download') }), 'Als Datei speichern'));
      })) : null;

    const body = h('div', { class: 'stack su-import' },
      backupBox,
      h('p', { class: 'muted', text: 'Füge deinen gesicherten Spielstand ein. Den bekommst du in der Zauberbude unter „Spielstand sichern“.' }),
      ta,
      h('div', { class: 'row' }, fileBtn, fileIn, h('span', { class: 'faint small', text: 'oder eine gespeicherte .txt-Datei laden' })),
      err);

    dlg = OP.ui.modal({
      title: 'Spielstand laden', body: body, wide: true,
      noAutofocus: backups.length > 0,   // Sicherungen oben zeigen, nicht gleich die Tastatur öffnen
      actions: [
        { label: 'Abbrechen', kind: 'ghost' },
        { label: 'Laden', kind: 'primary', icon: 'import', onClick: function () { return run(ta.value); } }
      ]
    });
    return dlg;
  }

  /* ================= Bildschirm ================= */

  function mount(el) {
    const bag = OP.ui.cleanup();

    // Schon eingerichtet (z. B. #/setup direkt aufgerufen): nicht nochmal alles überschreiben
    if (OP.state && OP.state.setupDone) {
      el.appendChild(renderDone());
      return bag.run;
    }

    if (W && W.stateId !== stateId()) W = null;   // z. B. nach Reset: alter Entwurf gehört nicht mehr dazu
    if (!W) W = loadDraft() || freshWizard();
    let dir = 1;       // Animationsrichtung: 1 vor, -1 zurück
    let err = null;    // {msg, field}
    let nextBtn = null;

    const root = h('div', { class: 'screen__inner su' });
    el.appendChild(root);

    /* ----- Navigation ----- */

    function scrollTop() { try { el.scrollTop = 0; } catch (e) { /* egal */ } }

    function goTo(n) {
      n = U.clamp(n, 0, STEPS.length - 1);
      if (n === W.step) return;
      if (n < W.step) {
        dir = -1; err = null; W.step = n;
      } else {
        for (let i = W.step; i < n; i++) {
          const e = validateStep(i);
          if (e) { dir = i < W.step ? -1 : 1; W.step = i; err = e; render(); focusError(); return; }
        }
        dir = 1; err = null; W.step = n;
        W.maxStep = Math.max(W.maxStep, n);
      }
      saveDraft();
      render();
      scrollTop();
    }
    function next() { if (W.step < STEPS.length - 1) goTo(W.step + 1); else finish(); }
    function back() { if (W.step > 0) goTo(W.step - 1); }

    function focusError() {
      if (!err) return;
      OP.ui.haptic([20, 30, 20]);
      const box = root.querySelector('.su-error');
      if (box) { box.classList.remove('is-shake'); void box.offsetWidth; box.classList.add('is-shake'); }
      const inp = err.field ? root.querySelector('[data-field="' + err.field + '"]') : null;
      if (inp) {
        inp.classList.add('is-invalid');
        try { inp.focus({ preventScroll: true }); } catch (e) { inp.focus(); }
        try { inp.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) { /* alt */ }
      }
    }

    function finish() {
      for (let i = 0; i < STEPS.length; i++) {
        const e = validateStep(i);
        if (e) { dir = i < W.step ? -1 : 1; W.step = i; err = e; render(); focusError(); return; }
      }
      addPendingQuest();
      const data = collect();
      let res = null;
      try { res = OP.game.completeSetup(data); } catch (ex) { console.error('[setup]', ex); }
      if (!res || !res.ok) {
        OP.ui.toast('Das hat leider nicht geklappt. Versuch es bitte nochmal.', { type: 'err' });
        return;
      }
      const name = (OP.state.player && OP.state.player.name) || data.name;
      clearDraft();
      OP.ui.haptic([20, 40, 60]);
      OP.ui.go('');
      const got = res.achievements && res.achievements.length;
      OP.ui.toast(welcomeText(name, res.achievements), { type: 'gold', icon: 'star', ms: got ? 7000 : 4500 });
    }

    /** Eigene Quest eingetippt, aber nicht mit "Dazu" hinzugefügt? Dann trotzdem mitnehmen. */
    function addPendingQuest() {
      const t = String(W.newTitle || '').trim().slice(0, 60);
      if (!t) return;
      const all = W.custom.map(function (q) { return q.title.toLowerCase(); });
      SUGGESTIONS.forEach(function (sg, i) { if (W.picks[i]) all.push(sg.title.toLowerCase()); });
      if (all.indexOf(t.toLowerCase()) < 0) W.custom.push({ title: t, cat: D.questCategory(W.newCat).id });
      W.newTitle = '';
    }

    /** Begrüßung – nennt Achievements, die durch die Startwerte schon freigeschaltet sind (still, ohne Pop-ups) */
    function welcomeText(name, achievements) {
      const list = (achievements || []).filter(function (a) { return a && a.name; });
      let t = 'Willkommen, ' + name + '! Dein erster Tag als Labs Runner beginnt.';
      if (list.length === 1) t += ' Schon freigeschaltet: „' + list[0].name + '“.';
      else if (list.length > 1 && list.length <= 3) t += ' Schon freigeschaltet: ' + list.map(function (a) { return '„' + a.name + '“'; }).join(', ') + '.';
      else if (list.length > 3) t += ' Du hast schon ' + list.length + ' Achievements – schau im Profil nach.';
      return t;
    }

    function afterImport() {
      if (OP.state && OP.state.setupDone) {
        const name = (OP.state.player && OP.state.player.name) || 'Runner';
        clearDraft();
        // sofort zur Karte – die Update-Nachricht (alter Spielstand) zeigt app.js kurz danach dort
        OP.ui.go('');
        OP.ui.toast('Spielstand geladen. Willkommen zurück, ' + name + '!', { type: 'ok', ms: 4000 });
        catchUpDays();
      } else {
        W = prefillFromState(freshWizard());
        saveDraft();
        err = null; dir = 1;
        render();
        OP.ui.toast('Spielstand geladen. Bitte schließ die Einrichtung noch ab.', { type: 'info', ms: 4000 });
      }
    }

    /* ----- Kopf mit Schritt-Punkten ----- */

    function buildTop() {
      const n = STEPS.length;
      const dots = h('ol', { class: 'su-dots', style: { '--su-p': String(W.step / (n - 1)), '--su-n': String(n) } });
      STEPS.forEach(function (s, i) {
        const state = i < W.step ? ' is-done' : (i === W.step ? ' is-on' : '');
        dots.appendChild(h('li', { class: 'su-dot' + state },
          h('button', {
            type: 'button', class: 'su-dot__btn', disabled: i > W.maxStep,
            'aria-label': 'Schritt ' + (i + 1) + ': ' + s.label, 'aria-current': i === W.step ? 'step' : null,
            onclick: function () { goTo(i); },
            html: i < W.step ? icon('check') : '<span class="num">' + (i + 1) + '</span>'
          }),
          h('span', { class: 'su-dot__label', text: s.label })));
      });
      return h('div', { class: 'su-top' },
        h('div', { class: 'su-kicker' },
          h('span', { class: 'su-kicker__tag', text: 'Einrichtung' }),
          h('span', { class: 'su-kicker__n num', text: 'Schritt ' + (W.step + 1) + ' von ' + n })),
        dots);
    }

    /* ----- Schritt 1: Willkommen + Name ----- */

    function stepName(form) {
      // Beschädigter Spielstand (gerade beim Start gefunden oder Kopie noch von früher da, z. B. nach
      // erneutem Neuladen) -> Kopie anbieten, bevor neu angefangen wird. Weg, sobald die Kopie gelöscht ist.
      const broken = !!(OP.store && OP.store.corruptKey) || findBackups().some(function (b) { return b.kind === 'defekt'; });
      if (broken) {
        form.appendChild(h('div', { class: 'su-alert', role: 'status' },
          h('span', { class: 'su-alert__ico', html: icon('warning') }),
          h('div', { class: 'su-alert__text' },
            h('strong', { text: 'Dein Spielstand war beschädigt.' }),
            h('span', { text: 'Eine Kopie ist noch da. Schau sie dir an, bevor du neu anfängst.' })),
          h('button', { type: 'button', class: 'btn btn--sm btn--danger su-alert__btn', onclick: function () { openImport(afterImport); } },
            h('span', { html: icon('refresh') }), 'Ansehen')));
      }
      form.appendChild(h('div', { class: 'su-hero su-hero--welcome' },
        emblem('portal'),
        h('div', { class: 'su-hero__text' },
          h('div', { class: 'su-overline', text: 'Operator · Labs-Zugang' }),
          h('h2', { class: 'su-title su-title--xl', text: 'Willkommen, Labs Runner.' }),
          h('p', { class: 'su-lead', text: 'Operator ist dein Spiel fürs echte Leben. Du trainierst wirklich, trägst es hier ein – und dein Runner wird mit dir stärker. Mit Kämpfen, Quests und Kalorienschulden.' }))));

      form.appendChild(h('div', { class: 'su-motto' },
        h('span', { class: 'su-motto__ico', html: icon('bolt') }),
        h('span', { text: 'Das echte Leben bewegt das Spiel.' })));

      const tiles = h('div', { class: 'su-labs', 'aria-label': 'LABS: Loss Always Builds Strength' });
      [['L', 'Loss'], ['A', 'Always'], ['B', 'Builds'], ['S', 'Strength']].forEach(function (p) {
        tiles.appendChild(h('div', { class: 'su-labs__tile', 'aria-hidden': 'true' },
          h('b', { text: p[0] }), h('span', { text: p[1] })));
      });
      form.appendChild(h('div', { class: 'su-labs-wrap' },
        tiles,
        h('p', { class: 'su-labs__sub', text: 'LABS = Loss Always Builds Strength. Jede Niederlage macht dich stärker.' })));

      const nameIn = h('input', {
        class: 'input su-name', type: 'text', maxlength: '24', autocomplete: 'nickname', autocapitalize: 'words',
        spellcheck: 'false', enterkeyhint: 'next', placeholder: 'Runner', 'aria-label': 'Dein Runner-Name'
      });
      nameIn.value = W.name;
      nameIn.dataset.nav = '1';
      nameIn.dataset.field = 'name';
      nameIn.addEventListener('input', function () { W.name = nameIn.value; saveDraft(); });
      form.appendChild(h('div', { class: 'card su-card' },
        h('label', { class: 'field' },
          h('span', { class: 'field__label', text: 'Wie heißt dein Runner?' }),
          nameIn,
          h('span', { class: 'field__hint', text: 'Kannst du später in der Zauberbude ändern.' }))));

      form.appendChild(h('button', { type: 'button', class: 'su-link', onclick: function () { openImport(afterImport); } },
        h('span', { html: icon('import') }), h('span', { text: 'Ich habe schon einen Spielstand' })));
    }

    /* ----- Schritt 2: Körpergewicht ----- */

    function stepGewicht(form) {
      form.appendChild(hero('scale', 'Dein Körpergewicht',
        'Wichtig für Übungen mit Körpergewicht (z. B. 27 Liegestütze bei 100 kg = 2.700 XP).'));

      const ex = h('div', { class: 'su-example' });
      function updEx() {
        const bw = U.parseNum(W.bodyweight);
        ex.innerHTML = '';
        if (isFinite(bw) && bw >= 30 && bw <= 300) {
          ex.appendChild(h('span', { class: 'su-example__label', text: 'Mit deinem Gewicht' }));
          ex.appendChild(h('span', { class: 'su-example__calc num' },
            '27 Liegestütze × ' + kgText(bw) + ' kg = ', h('b', { text: U.fmt(27 * bw) + ' XP' })));
        } else {
          ex.appendChild(h('span', { class: 'su-example__label', text: 'Beispiel' }));
          ex.appendChild(h('span', { class: 'su-example__calc muted', text: 'Trag dein Gewicht ein – dann rechnen wir es dir vor.' }));
        }
      }
      const f = numInput({ label: 'Körpergewicht', suffix: 'kg', placeholder: 'z. B. 80', enterkeyhint: 'next' },
        W.bodyweight, 'bw', function (v) { W.bodyweight = v; updEx(); });
      f.el.classList.add('su-field-big');
      updEx();
      form.appendChild(h('div', { class: 'card su-card stack' }, f.el, ex));
      form.appendChild(h('p', { class: 'su-note', text: 'Bei Übungen mit Hantel zählt das Gewicht der Hantel. Bei Liegestützen, Klimmzügen oder Kniebeugen ohne Gewicht zählt dein Körpergewicht. Es ist auch dein Startgewicht bei den Kalorienschulden.' }));
    }

    /* ----- Schritt 3: Startwerte der 6 Muskeln (Push / Pull / Beine) ----- */

    function stepStaerke(form) {
      form.appendChild(hero('staerke', 'Deine Startwerte',
        'Du trainierst in drei Gruppen: Push (drücken), Pull (ziehen) und Beine. Jeder Muskel hat einen eigenen XP-Wert. Schätz einfach – ändern geht später in der Zauberbude.'));

      form.appendChild(h('div', { class: 'su-formula num' },
        h('span', { class: 'su-formula__label', text: 'XP = Gewicht × Wiederholungen' }),
        h('span', null, 'z. B. 3 Sätze × 10 Wdh. × 60 kg = ', h('b', { text: U.fmt(3 * 10 * 60) + ' XP' }))));

      function valueOf(id) { const v = U.parseNum(W.muscles[id]); return isFinite(v) && v > 0 ? v : 0; }

      /* Summen je Gruppe + Gesamtstärke mit Runner-Rang (Schwellen = Summe der Muskel-Schwellen) */
      const groupSums = {};
      const total = h('b', { class: 'num su-total__value', text: '0' });
      const runner = h('span', { class: 'su-total__rank' });
      function updTotals() {
        let t = 0;
        D.GROUPS.forEach(function (g) {
          let gs = 0;
          g.muscles.forEach(function (id) { gs += valueOf(id); });
          t += gs;
          if (groupSums[g.id]) groupSums[g.id].textContent = U.fmt(gs) + ' XP';
        });
        total.textContent = U.fmt(t);
        runner.innerHTML = '';
        runner.appendChild(OP.ui.rankBadge(D.RANKS[rankIndex(t, OP.game.runnerThresholds())], { small: true }));
      }

      function muscleRow(m) {
        const badgeWrap = h('span', { class: 'su-muscle__rank' });
        const info = h('span', { class: 'su-muscle__info' });
        const bar = OP.ui.progress(0, { thin: true });
        const row = h('div', { class: 'su-muscle' });

        function updRank() {
          const v = U.parseNum(W.muscles[m.id]);
          const empty = isBlank(W.muscles[m.id]) || !isFinite(v) || v < 0;
          const r = OP.game.rankFor(m.id, empty ? 0 : v);   // Schwellen je Muskel (Bizeps/Trizeps niedriger)
          row.classList.toggle('is-empty', empty);
          row.style.setProperty('--rank-color', r.rank.color);
          badgeWrap.innerHTML = '';
          badgeWrap.appendChild(OP.ui.rankBadge(r.rank, { small: true }));
          OP.ui.setProgress(bar, empty ? 0 : r.progress * 100);
          if (empty) info.textContent = 'Dein Schätzwert';
          else if (r.next) info.textContent = 'noch ' + U.fmt(r.toNext) + ' bis ' + r.next.name;
          else info.textContent = 'Höchster Rang erreicht';
        }

        const f = numInput({ placeholder: 'z. B. 2.000', suffix: 'XP', integer: true }, W.muscles[m.id], 'm-' + m.id,
          function (v) { W.muscles[m.id] = v; updRank(); updTotals(); });
        f.input.setAttribute('aria-label', m.name + ' in XP');

        const calcBtn = h('button', {
          type: 'button', class: 'btn btn--ghost su-muscle__calc', 'aria-label': 'Rechner für ' + m.name,
          onclick: function () {
            const cur = U.parseNum(W.muscles[m.id]);
            openCalc(m, isFinite(cur) ? cur : 0, function (xp) {
              W.muscles[m.id] = String(xp);
              f.input.value = String(xp);
              f.input.classList.remove('is-invalid');
              saveDraft(); updRank(); updTotals();
            });
          }
        }, h('span', { html: icon('gym') }), h('span', { class: 'su-muscle__calc-txt' }, 'Rechner', h('small', { text: 'kg × Wdh.' })));

        row.appendChild(h('div', { class: 'su-muscle__head' },
          h('span', { class: 'su-muscle__ico', html: icon(m.icon) }),
          h('span', { class: 'su-muscle__name', text: m.name }),
          badgeWrap));
        row.appendChild(h('div', { class: 'su-muscle__body' }, f.el, calcBtn));
        row.appendChild(h('div', { class: 'su-muscle__foot' }, bar, info));
        updRank();
        return row;
      }

      D.GROUPS.forEach(function (g) {
        const sum = h('span', { class: 'su-group__sum num' });
        groupSums[g.id] = sum;
        const box = h('section', { class: 'su-group', style: { '--grp': g.color }, 'aria-label': g.name },
          h('div', { class: 'su-group__head' },
            h('span', { class: 'su-group__ico', html: icon(g.icon) }),
            h('span', { class: 'su-group__titles' },
              h('span', { class: 'su-group__name', text: g.name }),
              h('span', { class: 'su-group__hint', text: g.hint })),
            sum));
        const list = h('div', { class: 'su-muscles' });
        g.muscles.forEach(function (id) { list.appendChild(muscleRow(D.muscle(id))); });
        box.appendChild(list);
        form.appendChild(box);
      });

      form.appendChild(h('p', { class: 'su-note', text: 'Tipp: Bizeps und Trizeps sind kleine Muskeln. Ihr Wert ist meist etwa halb so groß wie Brust oder Rücken – darum reichen dort auch weniger XP für einen Rang.' }));

      updTotals();
      form.appendChild(h('div', { class: 'su-total' },
        h('span', { class: 'su-total__ico', html: icon('staerke') }),
        h('span', { class: 'su-total__label' }, 'Gesamtstärke', h('small', { text: 'Runner-Rang' })),
        h('span', { class: 'su-total__right' }, total, runner)));
    }

    /* ----- Schritt 4: Bauch-Startziele (Zirkus-Tanz) ----- */

    function stepBauch(form) {
      form.appendChild(hero('bauch', 'Zirkus-Tanz (Bauch)',
        'Deine ersten Ziele. Im Zirkus (Taverne) machst du alle 5 Übungen zusammen als einen Tanz. Schaffst du ein Ziel, wird es ein Stück schwerer.'));

      function absRow(ex) {
        const secs = ex.unit === 's';
        const f = numInput({ suffix: secs ? 's' : 'Wdh.', placeholder: String(ex.start), integer: secs, compact: true },
          W.abs[ex.id], 'a-' + ex.id, function (v) { W.abs[ex.id] = v; });
        f.input.setAttribute('aria-label', ex.name + (secs ? ' in Sekunden' : ' in Wiederholungen'));
        return h('div', { class: 'su-abs__row' },
          h('div', { class: 'su-abs__text' },
            h('span', { class: 'su-abs__name', text: ex.name }),
            h('span', { class: 'su-abs__hint', text: ex.hint || '' }),
            h('span', { class: 'su-abs__step', text: 'Geschafft: +' + U.fmt1(ex.step).replace(/,0$/, '') + (secs ? ' s' : ' Wdh.') })),
          f.el);
      }

      [
        { unit: 's', title: 'Halten', sub: 'in Sekunden' },
        { unit: 'reps', title: 'Wiederholungen', sub: 'verlangt wird abgerundet (10,5 → 10)' }
      ].forEach(function (grp) {
        form.appendChild(h('div', { class: 'su-abs__sub' },
          h('span', { class: 'su-abs__sub-title', text: grp.title }),
          h('span', { class: 'su-abs__sub-hint', text: grp.sub })));
        const list = h('div', { class: 'su-abs' });
        D.ABS_EXERCISES.forEach(function (ex) { if (ex.unit === grp.unit) list.appendChild(absRow(ex)); });
        form.appendChild(list);
      });

      form.appendChild(h('div', { class: 'su-lock' },
        h('span', { class: 'su-lock__ico', html: icon('lock') }),
        h('div', { class: 'su-lock__text' },
          h('strong', { text: 'Wichtig: die Zirkus-Sperre' }),
          h('span', { text: 'Warst du ' + D.CIRCUS_LOCK_DAYS + ' Tage nicht im Zirkus, sind Arena, Gym, Abenteuer und Schmuggler gesperrt. Ein Eintrag im Zirkus macht alles wieder frei – das Ziel musst du dafür nicht schaffen.' }))));
      form.appendChild(h('p', { class: 'su-note', text: 'Nicht sicher? Lass die Vorschläge einfach stehen.' }));
    }

    /* ----- Schritt 5: Ausdauer (freiwillig) ----- */

    function stepAusdauer(form) {
      form.appendChild(hero('run', 'Ausdauer',
        'Zwei Lauf-Timer im Gym. Beides ist freiwillig: Lässt du ein Feld leer, setzt dein erster Lauf den Wert.'));

      D.RUNS.forEach(function (r) {
        const txt = RUN_TEXT[r.id] || { icon: r.icon, ask: r.hint };
        const out = h('div', { class: 'su-run__out' });
        function upd() {
          const raw = W.run[r.id];
          out.className = 'su-run__out';
          if (isBlank(raw)) { out.textContent = 'Leer: Dein erster Lauf setzt den Wert.'; out.classList.add('is-empty'); return; }
          const v = parseMinutes(raw);
          if (!isFinite(v) || v < 0 || v > RUN_MAX) { out.textContent = 'Bitte Minuten als Zahl, z. B. 5 oder 5,5.'; out.classList.add('is-bad'); return; }
          const m = floor2(v);
          if (m <= 0) { out.textContent = '0 = kein Wert: Dein erster Lauf setzt ihn.'; out.classList.add('is-empty'); return; }
          out.innerHTML = '';
          if (r.id === 'steady') {
            out.appendChild(h('span', null, 'Dein Ziel: ', h('b', { class: 'num', text: minText(m) })));
          } else {
            out.appendChild(h('span', null, 'Rekord ', h('b', { class: 'num', text: minText(m) }),
              ' → nächstes Ziel ', h('b', { class: 'num', text: minText(Math.round((m + D.RUN_TOTAL_STEP) * 100) / 100) })));
          }
        }
        const f = numInput({ label: 'Minuten', suffix: 'Min.', placeholder: 'z. B. ' + (r.id === 'steady' ? '5' : '8,5'), enterkeyhint: 'next' },
          W.run[r.id], 'r-' + r.id, function (v) { W.run[r.id] = v; upd(); updNext(); });
        f.input.setAttribute('aria-label', r.name + ' in Minuten');
        upd();
        const rule = r.id === 'steady'
          ? 'Geschafft: +' + D.RUN_STEADY_PCT.min + ' bis ' + D.RUN_STEADY_PCT.max + ' %. Jeden Tag −' + U.fmt1(D.RUN_STEADY_DECAY * 100) + ' % – auch wenn du läufst.'
          : 'Ziel = Rekord + ' + D.RUN_TOTAL_STEP + ' Minute. Nur die reine Laufzeit zählt.';
        form.appendChild(h('div', { class: 'card su-card su-run' },
          h('div', { class: 'su-run__head' },
            h('span', { class: 'su-run__ico', html: icon(txt.icon) }),
            h('span', { class: 'su-run__titles' },
              h('span', { class: 'su-run__name', text: r.name }),
              h('span', { class: 'su-run__ask', text: txt.ask }))),
          f.el,
          out,
          h('p', { class: 'su-run__rule', text: rule })));
      });
      form.appendChild(h('p', { class: 'su-note', text: 'Zeiten stehen in Minuten mit zwei Nachkommastellen. Achtung: 8,50 Min. sind 8 Minuten 30 Sekunden (nicht 8,30).' }));
    }

    /* ----- Schritt 6: Kalorienschulden ----- */

    function stepKalorien(form) {
      form.appendChild(hero('kcal', 'Kalorienschulden', 'Wie viel Kilo Fett willst du verlieren?'));
      const out = h('div', { class: 'su-kcal__value num' });
      const outSub = h('div', { class: 'su-kcal__sub' });
      const startEl = h('b', { class: 'su-path__value num' });
      const goalEl = h('b', { class: 'su-path__value num' });
      const path = h('div', { class: 'su-path' },
        h('div', { class: 'su-path__step' }, h('span', { class: 'su-path__label', text: 'Startgewicht' }), startEl, h('small', { text: '= dein Körpergewicht' })),
        h('span', { class: 'su-path__arrow', html: icon('next') }),
        h('div', { class: 'su-path__step su-path__step--goal' }, h('span', { class: 'su-path__label', text: 'Zielgewicht' }), goalEl, h('small', { text: 'Start − Ziel' })));
      function upd() {
        const kg = isBlank(W.goalKg) ? 0 : U.parseNum(W.goalKg);
        const ok = isFinite(kg) && kg >= 0 && kg <= 300;
        const bw = bodyweightGuess();
        out.textContent = '= ' + U.fmt(ok ? Math.round(kg * 10) / 10 * D.KCAL_PER_KG : 0) + ' kcal';
        out.classList.toggle('is-zero', !ok || kg === 0);
        outSub.textContent = ok && kg > 0 ? 'Das sind deine Kalorienschulden.' : 'Kein Ziel – kannst du später im Haus festlegen.';
        startEl.textContent = kgText(bw) + ' kg';
        goalEl.textContent = ok && kg > 0 && bw - kg >= 30 ? kgText(Math.round((bw - kg) * 10) / 10) + ' kg' : '–';
        path.classList.toggle('is-off', !(ok && kg > 0));
      }
      const f = numInput({ label: 'Ziel', suffix: 'kg', placeholder: 'z. B. 20', enterkeyhint: 'next' },
        W.goalKg, 'kg', function (v) { W.goalKg = v; upd(); });
      f.el.classList.add('su-field-big');
      upd();
      form.appendChild(h('div', { class: 'card su-card stack' },
        f.el,
        h('span', { class: 'field__hint', text: '0 = später festlegen' }),
        h('div', { class: 'su-kcal' }, out, outSub),
        path));
      form.appendChild(h('div', { class: 'su-sim' },
        h('span', { class: 'su-sim__ico', html: icon('scale') }),
        h('div', { class: 'su-sim__text' },
          h('strong', { text: 'Simuliertes Gewicht' }),
          h('span', { text: 'Es startet bei deinem Startgewicht und sinkt mit jedem Defizit (' + U.fmt(D.KCAL_PER_KG) + ' kcal = 1 kg). Wiegst du dich oft, vergleich deinen Wochenschnitt damit – so merkst du, ob dein Defizit stimmt.' }))));
      form.appendChild(h('div', { class: 'su-facts' },
        fact('scale', '1 kg Fett', '≈ ' + U.fmt(D.KCAL_PER_KG) + ' kcal'),
        fact('minus', 'Jedes Defizit', 'zahlt ab'),
        fact('heart', 'Bei 0 kcal', 'bist du gesund')));
    }
    function fact(ic, a, b) {
      return h('div', { class: 'su-fact' }, h('span', { class: 'su-fact__ico', html: icon(ic) }),
        h('span', { class: 'su-fact__a', text: a }), h('span', { class: 'su-fact__b', text: b }));
    }

    /* ----- Schritt 7: Erste Tages-Quests ----- */

    function stepQuests(form) {
      form.appendChild(hero('quest', 'Erste Tages-Quests',
        'Kleine Aufgaben für jeden Tag. Du hakst sie direkt auf der Karte ab. Tipp an, was passt – oder schreib eigene.', 'gold'));

      const count = h('p', { class: 'su-qcount' });
      function updCount() {
        const n = questCount();
        count.textContent = n === 0
          ? 'Keine Quest ausgewählt – geht auch. Du kannst sie später im Haus anlegen.'
          : (n === 1 ? '1 Quest ausgewählt' : n + ' Quests ausgewählt');
        count.classList.toggle('is-zero', n === 0);
      }

      const chips = h('div', { class: 'su-qchips' });
      SUGGESTIONS.forEach(function (s, i) {
        const cat = D.questCategory(s.cat);
        const btn = h('button', {
          type: 'button', class: 'su-qchip' + (W.picks[i] ? ' is-on' : ''), 'aria-pressed': W.picks[i] ? 'true' : 'false',
          style: { '--cat': cat.color },
          onclick: function () {
            W.picks[i] = !W.picks[i];
            btn.classList.toggle('is-on', W.picks[i]);
            btn.setAttribute('aria-pressed', W.picks[i] ? 'true' : 'false');
            OP.ui.haptic(8);
            saveDraft(); updCount();
          }
        },
          h('span', { class: 'su-qchip__check', html: icon('check') }),
          h('span', { class: 'su-qchip__text' }, h('span', { text: s.title }), h('small', { text: cat.name })),
          h('span', { class: 'su-qchip__cat', html: icon(cat.icon) }));
        chips.appendChild(btn);
      });
      form.appendChild(chips);

      /* eigene Quests */
      const customList = h('ul', { class: 'su-custom' });
      function renderCustom() {
        customList.innerHTML = '';
        W.custom.forEach(function (q, i) {
          const cat = D.questCategory(q.cat);
          customList.appendChild(h('li', { class: 'su-custom__item', style: { '--cat': cat.color } },
            h('span', { class: 'su-custom__ico', html: icon(cat.icon) }),
            h('span', { class: 'su-custom__text' }, h('span', { text: q.title }), h('small', { text: cat.name })),
            h('button', {
              type: 'button', class: 'icon-btn icon-btn--sm icon-btn--ghost', 'aria-label': q.title + ' entfernen', html: icon('trash'),
              onclick: function () { W.custom.splice(i, 1); saveDraft(); renderCustom(); updCount(); }
            })));
        });
        customList.hidden = !W.custom.length;
      }

      const titleIn = h('input', {
        class: 'input', type: 'text', maxlength: '60', placeholder: 'Eigene Quest, z. B. Spazieren gehen',
        autocomplete: 'off', enterkeyhint: 'done', 'aria-label': 'Name der eigenen Quest'
      });
      titleIn.value = W.newTitle;
      titleIn.dataset.field = 'qtitle';
      titleIn.addEventListener('input', function () { W.newTitle = titleIn.value; titleIn.classList.remove('is-invalid'); saveDraft(); });
      const catSel = h('select', { class: 'select', 'aria-label': 'Kategorie' },
        D.QUEST_CATEGORIES.map(function (c) { return h('option', { value: c.id, selected: c.id === W.newCat }, c.name); }));
      catSel.addEventListener('change', function () { W.newCat = catSel.value; saveDraft(); });

      function addCustom() {
        const t = titleIn.value.trim();
        if (!t) { titleIn.classList.add('is-invalid'); titleIn.focus(); OP.ui.toast('Gib deiner Quest einen Namen.', { type: 'warn' }); return; }
        const all = W.custom.map(function (q) { return q.title.toLowerCase(); });
        SUGGESTIONS.forEach(function (s, i) { if (W.picks[i]) all.push(s.title.toLowerCase()); });
        if (all.indexOf(t.toLowerCase()) >= 0) { OP.ui.toast('Diese Quest hast du schon.', { type: 'warn' }); return; }
        W.custom.push({ title: t.slice(0, 60), cat: D.questCategory(catSel.value).id });
        W.newTitle = ''; titleIn.value = '';
        saveDraft(); renderCustom(); updCount();
        OP.ui.haptic(10);
        titleIn.focus();
      }
      titleIn.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); e.stopPropagation(); addCustom(); }
      });

      form.appendChild(h('div', { class: 'card su-card su-add' },
        h('div', { class: 'field__label', text: 'Eigene Quest' }),
        h('div', { class: 'su-add__row' }, titleIn, catSel,
          h('button', { type: 'button', class: 'btn btn--primary su-add__btn', onclick: addCustom, 'aria-label': 'Quest hinzufügen' },
            h('span', { html: icon('plus') }), h('span', { class: 'su-add__lbl', text: 'Dazu' }))),
        customList));
      renderCustom();
      updCount();
      form.appendChild(count);
    }

    const BUILDERS = {
      name: stepName, gewicht: stepGewicht, staerke: stepStaerke, bauch: stepBauch,
      ausdauer: stepAusdauer, kalorien: stepKalorien, quests: stepQuests
    };

    /* ----- Untere Leiste: Zurück / Weiter ----- */

    /** Freiwilliger Schritt ohne Eingabe: "Überspringen" statt "Weiter" */
    function nextLabel() {
      if (STEPS[W.step].id === 'ausdauer' && isBlank(W.run.steady) && isBlank(W.run.total)) return 'Überspringen';
      return 'Weiter';
    }
    function updNext() {
      const lbl = nextBtn && nextBtn.querySelector('.su-nav__lbl');
      if (lbl) lbl.textContent = nextLabel();
    }

    function buildNav() {
      const last = W.step === STEPS.length - 1;
      nextBtn = last
        ? h('button', { type: 'button', class: 'btn btn--gold btn--lg su-nav__next', onclick: finish },
          'Los geht\'s', h('span', { html: icon('play') }))
        : h('button', { type: 'button', class: 'btn btn--primary btn--lg su-nav__next', onclick: next },
          h('span', { class: 'su-nav__lbl', text: nextLabel() }), h('span', { html: icon('next') }));
      return h('div', { class: 'su-nav' },
        W.step > 0 ? h('button', { type: 'button', class: 'btn btn--ghost btn--lg su-nav__back', onclick: back, 'aria-label': 'Zurück' },
          h('span', { html: icon('back') }), h('span', { class: 'su-nav__back-txt', text: 'Zurück' })) : null,   // Text fällt auf sehr schmalen Handys weg
        nextBtn);
    }

    function render() {
      root.innerHTML = '';
      root.appendChild(buildTop());
      const step = STEPS[W.step];
      const form = h('form', {
        class: 'su-step su-step--' + step.id + (dir < 0 ? ' su-step--back' : ''), novalidate: true,
        onsubmit: function (e) { e.preventDefault(); next(); }
      });
      form.addEventListener('keydown', enterToNext(next));
      // Sobald getippt wird, verschwindet die Fehlermeldung
      form.addEventListener('input', function () {
        if (!err) return;
        err = null;
        const box = form.querySelector('.su-error');
        if (box && box.parentNode) box.parentNode.removeChild(box);
      });
      BUILDERS[step.id](form);
      if (err) {
        form.appendChild(h('div', { class: 'su-error', role: 'alert' },
          h('span', { html: icon('warning') }), h('span', { text: err.msg })));
      }
      root.appendChild(form);
      root.appendChild(buildNav());
    }

    render();
    if (err) focusError();

    return bag.run;
  }

  /** Anzeige, wenn die Einrichtung schon erledigt ist */
  function renderDone() {
    return h('div', { class: 'screen__inner su su--done' },
      h('div', { class: 'su-step' },
        hero('check', 'Du bist schon startklar.', 'Die Einrichtung ist erledigt. Werte ändern kannst du jederzeit in der Zauberbude.'),
        h('div', { class: 'su-done__actions' },
          h('button', { type: 'button', class: 'btn btn--primary btn--lg', onclick: function () { OP.ui.go(''); } },
            h('span', { html: icon('karte') }), 'Zur Karte'),
          h('button', { type: 'button', class: 'btn btn--violet btn--lg', onclick: function () { OP.ui.go('zauberbude'); } },
            h('span', { html: icon('zauberbude') }), 'Zauberbude'))));
  }

  OP.screens.register('setup', { title: 'Willkommen', icon: 'portal', tone: 'setup', mount: mount });
})();
