/* Operator – UI-Grundbausteine (global: OP.ui, OP.screens)
   Router ueber den Hash (#/haus/gym), Bildschirm-Rahmen mit Tabs, Toasts, Dialoge, Feiern,
   gemeinsame Eingabe-Bausteine (Satz-Eingabe fuer Gym und Kampf). */
(function () {
  'use strict';
  var OP = (window.OP = window.OP || {});
  var U = OP.util, h = OP.h;

  /* ================= Icons ================= */
  OP.icons = OP.icons || {};
  var FALLBACK_ICON = '<circle cx="12" cy="12" r="7"/>';

  /** SVG-Icon als HTML-String. Icons liegen als innerer SVG-Code (viewBox 0 0 24 24) in OP.icons[name]. */
  function icon(name, cls) {
    return '<svg class="ico' + (cls ? ' ' + cls : '') + '" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
      (OP.icons[name] || FALLBACK_ICON) + '</svg>';
  }
  /** Icon als DOM-Element */
  function iconEl(name, cls) {
    var span = document.createElement('span');
    span.className = 'ico-wrap';
    span.innerHTML = icon(name, cls);
    return span.firstChild;
  }

  /* ================= Bildschirme & Router ================= */
  var registry = {};   // id -> {title, icon, mount(el, params) -> cleanup?}
  var shells = {};     // id -> {title, icon, tone, defaultTab, tabs:[{id,label,icon}]}

  var screens = {
    /** Einzelnen Bildschirm (oder Tab-Inhalt 'haus/gym') anmelden */
    register: function (id, def) { registry[id] = def; if (current && current.screenId === id) router.refresh(); },
    /** Gebaeude mit Tabs anmelden. Tab-Inhalte werden als '<shellId>/<tabId>' registriert. */
    registerShell: function (id, def) { shells[id] = def; },
    get: function (id) { return registry[id]; },
    shell: function (id) { return shells[id]; },
    all: function () { return Object.keys(registry); }
  };

  var current = null;  // {path, shellId, tab, screenId, params, cleanup, el}
  var layer, mapHidden = false;

  function parse(hash) {
    var path = String(hash || '').replace(/^#\/?/, '').replace(/\/+$/, '');
    var parts = path ? path.split('/') : [];
    return { path: path, parts: parts };
  }

  function resolve(parts) {
    if (!parts.length) return { screenId: null };
    var first = parts[0];
    if (shells[first]) {
      var sh = shells[first];
      var tab = parts[1] && sh.tabs.some(function (t) { return t.id === parts[1]; }) ? parts[1] : sh.defaultTab;
      return { shellId: first, tab: tab, screenId: first + '/' + tab, params: parts.slice(tab === parts[1] ? 2 : 1) };
    }
    return { screenId: first, params: parts.slice(1) };
  }

  function unmountCurrent() {
    if (current && typeof current.cleanup === 'function') {
      try { current.cleanup(); } catch (e) { console.error('[ui] cleanup', e); }
    }
    if (current) current.cleanup = null;
  }

  function buildFrame(r) {
    var sh = r.shellId ? shells[r.shellId] : null;
    var def = registry[r.screenId] || {};
    var title = sh ? sh.title : (def.title || 'Operator');
    var ico = sh ? sh.icon : (def.icon || 'info');
    var tone = sh ? (sh.tone || '') : (def.tone || '');

    var frame = h('section', { class: 'screen' + (tone ? ' screen--' + tone : ''), role: 'dialog', 'aria-label': title });
    var header = h('header', { class: 'screen__head' },
      h('button', { class: 'icon-btn screen__back', 'aria-label': 'Zurück zur Karte', onclick: function () { router.go(''); }, html: icon('back') }),
      h('div', { class: 'screen__title' }, h('span', { class: 'screen__icon', html: icon(ico) }), h('h1', { text: title })),
      h('div', { class: 'screen__head-extra' })
    );
    frame.appendChild(header);
    if (sh) {
      var tabs = h('nav', { class: 'tabs screen__tabs', role: 'tablist' });
      sh.tabs.forEach(function (t) {
        tabs.appendChild(h('button', {
          class: 'tab' + (t.id === r.tab ? ' tab--active' : ''), role: 'tab', 'aria-selected': t.id === r.tab ? 'true' : 'false',
          dataset: { tab: t.id },
          onclick: function () { router.go(r.shellId + '/' + t.id); },
          html: icon(t.icon) + '<span>' + U.esc(t.label) + '</span>'
        }));
      });
      frame.appendChild(tabs);
    }
    var body = h('div', { class: 'screen__body' });
    frame.appendChild(body);
    return { frame: frame, body: body, headExtra: header.querySelector('.screen__head-extra') };
  }

  function mountBody(r, body) {
    body.innerHTML = '';
    body.scrollTop = 0;
    var def = registry[r.screenId];
    if (!def) {
      body.appendChild(h('div', { class: 'empty' },
        h('div', { class: 'empty__icon', html: icon('flask') }),
        h('p', { text: 'Dieser Bereich wird noch gebaut.' })));
      return null;
    }
    try {
      var cleanup = def.mount(body, r.params || [], r);
      return typeof cleanup === 'function' ? cleanup : null;
    } catch (e) {
      console.error('[ui] mount ' + r.screenId, e);
      body.appendChild(h('div', { class: 'empty' }, h('p', { text: 'Fehler beim Laden: ' + e.message })));
      return null;
    }
  }

  /* Verlauf (Zurueck-Taste auf Android / im Browser): Es gibt hoechstens [Karte, Bildschirm].
     Von der Karte in einen Bildschirm = neuer Eintrag (markiert mit {opScreen:true}).
     Bildschirm -> anderer Bildschirm oder Tab = Eintrag ersetzen. Schliessen = history.back(). */
  var markNext = false;
  function onMap() { return !current; }
  function isMarked() { try { return !!(history.state && history.state.opScreen); } catch (e) { return false; } }

  var router = {
    /** Navigieren: go('haus/gym'), go('#/arena'), go('') = Karte */
    go: function (path) {
      var p = String(path || '').replace(/^#\/?/, '');
      var target = '#/' + p;
      var here = location.hash === '' || location.hash === '#' ? '#/' : location.hash;
      if (here === target) { router.handle(); return; }
      if (!p) {                                   // zur Karte
        if (!onMap() && isMarked()) { history.back(); return; }
        location.replace('#/');
        return;
      }
      if (onMap()) {                              // Karte -> Bildschirm: neuer Eintrag
        markNext = true;
        location.hash = target;
      } else {                                    // Bildschirm -> Bildschirm/Tab: ersetzen
        markNext = isMarked();
        location.replace(target);
      }
    },
    back: function () { router.go(''); },
    current: function () { return current; },
    handle: function () {
      if (markNext) {
        markNext = false;
        try { history.replaceState({ opScreen: true }, ''); } catch (e) { /* egal */ }
      }
      closeAllModals();
      var parsed = parse(location.hash);
      // Ersteinrichtung erzwingen
      if (OP.state && !OP.state.setupDone && parsed.parts[0] !== 'setup' && registry.setup) {
        location.replace('#/setup');
        parsed = parse('#/setup');
      }
      var r = resolve(parsed.parts);
      r.path = parsed.path;

      if (!r.screenId) {                       // Karte
        unmountCurrent();
        current = null;
        layer.innerHTML = '';
        layer.classList.remove('is-open');
        document.body.classList.remove('screen-open');
        OP.bus.emit('route', { path: '', parts: [] });
        return;
      }
      // gleicher Rahmen (Tab-Wechsel in derselben Huette): nur Inhalt tauschen
      if (current && current.shellId && current.shellId === r.shellId && current.frameEl && layer.contains(current.frameEl)) {
        unmountCurrent();
        current.frameEl.querySelectorAll('.screen__tabs .tab').forEach(function (b) {
          var on = b.dataset.tab === r.tab;
          b.classList.toggle('tab--active', on);
          b.setAttribute('aria-selected', on ? 'true' : 'false');
          if (on && b.scrollIntoView) { try { b.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (e) { /* alt */ } }
        });
        current.frameEl.querySelector('.screen__head-extra').innerHTML = '';
        current.tab = r.tab; current.screenId = r.screenId; current.params = r.params; current.path = r.path;
        current.cleanup = mountBody(r, current.bodyEl);
        OP.bus.emit('route', { path: r.path, parts: parsed.parts });
        return;
      }
      unmountCurrent();
      layer.innerHTML = '';
      var f = buildFrame(r);
      layer.appendChild(f.frame);
      layer.classList.add('is-open');
      document.body.classList.add('screen-open');
      current = { path: r.path, shellId: r.shellId, tab: r.tab, screenId: r.screenId, params: r.params, frameEl: f.frame, bodyEl: f.body, headExtra: f.headExtra };
      current.cleanup = mountBody(r, f.body);
      // aktiven Tab sichtbar machen (auf schmalen Handys sonst abgeschnitten)
      var activeTab = f.frame.querySelector('.screen__tabs .tab--active');
      if (activeTab && activeTab.scrollIntoView) {
        requestAnimationFrame(function () { try { activeTab.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (e) { /* alt */ } });
      }
      OP.bus.emit('route', { path: r.path, parts: parsed.parts });
    },
    init: function () {
      layer = document.getElementById('screen-layer');
      window.addEventListener('hashchange', router.handle);
      router.handle();
    }
  };
  /** Aktuellen Bildschirm komplett neu aufbauen */
  router.refresh = function () {
    if (!current) return;
    unmountCurrent();
    current.frameEl = null;
    router.handle();
  };

  /* ================= Toasts ================= */
  function toast(msg, opts) {
    opts = opts || {};
    var root = document.getElementById('toast-layer');
    if (!root) return;
    var type = opts.type || 'info';
    var ico = opts.icon || ({ ok: 'check', warn: 'warning', err: 'warning', info: 'info', gold: 'star' })[type] || 'info';
    var t = h('div', { class: 'toast toast--' + type, role: 'status' },
      h('span', { class: 'toast__icon', html: icon(ico) }),
      h('span', { class: 'toast__text', text: msg }));
    root.appendChild(t);
    requestAnimationFrame(function () { t.classList.add('is-in'); });
    var ms = opts.ms || (type === 'err' ? 4200 : 2600);
    setTimeout(function () {
      t.classList.remove('is-in');
      setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 350);
    }, ms);
  }

  /* ================= Dialoge ================= */
  /** modal({title, body: Node|String, actions:[{label, kind, onClick}], dismissable=true, wide}) -> {close, el}
      onClick darf false zurueckgeben, dann bleibt der Dialog offen. */
  var openModals = [];
  /** Alle offenen Dialoge schliessen (beim Seitenwechsel / Zurueck-Taste) */
  function closeAllModals() {
    openModals.slice().forEach(function (m) { try { m.close(); } catch (e) { /* egal */ } });
  }

  function modal(opts) {
    var root = document.getElementById('modal-layer');
    var closed = false;
    var box = h('div', { class: 'modal' + (opts.wide ? ' modal--wide' : '') + (opts.tone ? ' modal--' + opts.tone : ''), role: 'dialog', 'aria-modal': 'true' });
    var back = h('div', { class: 'modal-backdrop' }, box);
    if (opts.title) box.appendChild(h('h2', { class: 'modal__title', text: opts.title }));
    var body = h('div', { class: 'modal__body' });
    if (typeof opts.body === 'string') body.innerHTML = opts.body; else if (opts.body) body.appendChild(opts.body);
    box.appendChild(body);
    var actions = h('div', { class: 'modal__actions' });
    (opts.actions || [{ label: 'OK', kind: 'primary' }]).forEach(function (a) {
      actions.appendChild(h('button', {
        class: 'btn btn--' + (a.kind || 'ghost'), type: 'button',
        onclick: function () {
          var r = a.onClick ? a.onClick(api) : undefined;
          if (r !== false) api.close();
        }
      }, a.icon ? h('span', { html: icon(a.icon) }) : null, a.label));
    });
    box.appendChild(actions);
    function onKey(e) { if (e.key === 'Escape' && opts.dismissable !== false) api.close(); }
    var api = {
      el: box, body: body,
      close: function () {
        if (closed) return;
        closed = true;
        var idx = openModals.indexOf(api);
        if (idx >= 0) openModals.splice(idx, 1);
        document.removeEventListener('keydown', onKey);
        back.classList.remove('is-in');
        setTimeout(function () { if (back.parentNode) back.parentNode.removeChild(back); }, 200);
        if (opts.onClose) opts.onClose();
      }
    };
    back.addEventListener('click', function (e) { if (e.target === back && opts.dismissable !== false) api.close(); });
    document.addEventListener('keydown', onKey);
    openModals.push(api);
    root.appendChild(back);
    requestAnimationFrame(function () { back.classList.add('is-in'); });
    var first = box.querySelector('input, textarea, select');
    if (first && !opts.noAutofocus) setTimeout(function () { try { first.focus(); } catch (e) { /* egal */ } }, 60);
    return api;
  }

  /** confirm('Wirklich?', {okLabel, danger, title}) -> Promise<boolean> */
  function confirmDlg(text, opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
      var done = false;
      modal({
        title: opts.title || 'Sicher?',
        body: h('p', { text: text }),
        actions: [
          { label: opts.cancelLabel || 'Abbrechen', kind: 'ghost', onClick: function () { done = true; resolve(false); } },
          { label: opts.okLabel || 'Ja', kind: opts.danger ? 'danger' : 'primary', onClick: function () { done = true; resolve(true); } }
        ],
        onClose: function () { if (!done) resolve(false); }
      });
    });
  }

  /** prompt('Titel', {value, placeholder, label, inputmode, multiline}) -> Promise<string|null> */
  function promptDlg(title, opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
      var done = false;
      var input = opts.multiline
        ? h('textarea', { class: 'input textarea', rows: 5, placeholder: opts.placeholder || '' })
        : h('input', { class: 'input', type: 'text', placeholder: opts.placeholder || '', inputmode: opts.inputmode || 'text', autocomplete: 'off' });
      input.value = opts.value != null ? opts.value : '';
      var form = h('form', { class: 'stack', onsubmit: function (e) { e.preventDefault(); ok(); } },
        opts.label ? h('label', { class: 'field' }, h('span', { class: 'field__label', text: opts.label }), input) : input);
      var dlg;
      function ok() { done = true; resolve(input.value); dlg.close(); }
      dlg = modal({
        title: title, body: form,
        actions: [
          { label: 'Abbrechen', kind: 'ghost', onClick: function () { done = true; resolve(null); } },
          { label: opts.okLabel || 'OK', kind: opts.danger ? 'danger' : 'primary', onClick: function () { done = true; resolve(input.value); } }
        ],
        onClose: function () { if (!done) resolve(null); }
      });
    });
  }

  /* ================= Feiern (Sieg, Achievement) ================= */
  var celebrateQueue = [], celebrating = false;
  /** celebrate({title, text, icon, tone:'gold'|'ok'|'err'|'cyan', kicker, big}) -> Promise (wenn geschlossen) */
  function celebrate(opts) {
    return new Promise(function (resolve) {
      celebrateQueue.push({ opts: opts, resolve: resolve });
      if (!celebrating) nextCelebrate();
    });
  }
  function nextCelebrate() {
    var item = celebrateQueue.shift();
    if (!item) { celebrating = false; return; }
    celebrating = true;
    var o = item.opts, root = document.getElementById('modal-layer');
    var el = h('div', { class: 'celebrate celebrate--' + (o.tone || 'gold') + (o.big ? ' celebrate--big' : '') },
      h('div', { class: 'celebrate__card' },
        h('div', { class: 'celebrate__rays' }),
        h('div', { class: 'celebrate__icon', html: icon(o.icon || 'trophy') }),
        o.kicker ? h('div', { class: 'celebrate__kicker', text: o.kicker }) : null,
        h('div', { class: 'celebrate__title', text: o.title || '' }),
        o.text ? h('div', { class: 'celebrate__text', text: o.text }) : null,
        h('button', { class: 'btn btn--primary btn--lg', type: 'button', onclick: close }, o.button || 'Weiter')));
    function close() {
      el.classList.remove('is-in');
      setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); item.resolve(); nextCelebrate(); }, 220);
    }
    root.appendChild(el);
    requestAnimationFrame(function () { el.classList.add('is-in'); });
    haptic([30, 40, 60]);
  }

  /* ================= Kleine Bausteine ================= */

  function haptic(pattern) {
    try {
      if (OP.state && OP.state.settings && OP.state.settings.haptics === false) return;
      if (navigator.vibrate) navigator.vibrate(pattern || 15);
    } catch (e) { /* egal */ }
  }

  /** Fortschrittsbalken. pct 0..100. opts: {tone:'cyan'|'ok'|'warn'|'err'|'gold'|'hp'|'kcal', label, thin} */
  function progress(pct, opts) {
    opts = opts || {};
    var el = h('div', { class: 'bar' + (opts.tone ? ' bar--' + opts.tone : '') + (opts.thin ? ' bar--thin' : ''), role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(Math.round(pct)) },
      h('div', { class: 'bar__fill', style: { width: U.clamp(pct, 0, 100) + '%' } }),
      opts.label ? h('div', { class: 'bar__label', text: opts.label }) : null);
    return el;
  }
  /** tone optional: wechselt die Farbe (z. B. 'ok' wenn ein Ziel erreicht ist) */
  function setProgress(barEl, pct, label, tone) {
    if (!barEl) return;
    if (tone !== undefined) {
      barEl.className = barEl.className.replace(/\bbar--(cyan|ok|warn|err|gold|hp|kcal)\b/g, '').replace(/\s+/g, ' ').trim();
      if (tone) barEl.classList.add('bar--' + tone);
    }
    var f = barEl.querySelector('.bar__fill');
    if (f) f.style.width = U.clamp(pct, 0, 100) + '%';
    barEl.setAttribute('aria-valuenow', String(Math.round(pct)));
    if (label != null) { var l = barEl.querySelector('.bar__label'); if (l) l.textContent = label; }
  }

  /** Rang-Abzeichen. rank = Eintrag aus OP.data.RANKS */
  function rankBadge(rank, opts) {
    opts = opts || {};
    return h('span', { class: 'rank-badge rank-' + rank.id + (opts.small ? ' rank-badge--sm' : ''), style: { '--rank-color': rank.color } },
      h('span', { class: 'rank-badge__gem' }), h('span', { class: 'rank-badge__name', text: rank.name }));
  }

  function diffChip(diff) {
    return h('span', { class: 'chip chip--diff', style: { '--chip-color': diff.color } }, diff.name);
  }

  /** Zahlenfeld (Text mit Dezimal-Tastatur, versteht "22,5"). -> {el, input, value(): Number|NaN, set(v)} */
  function numField(opts) {
    opts = opts || {};
    var input = h('input', {
      class: 'input input--num', type: 'text', inputmode: opts.integer ? 'numeric' : 'decimal',
      autocomplete: 'off', placeholder: opts.placeholder || '', 'aria-label': opts.label || '', enterkeyhint: opts.enterkeyhint || 'next'
    });
    if (opts.value != null && opts.value !== '') input.value = typeof opts.value === 'number' ? String(opts.value).replace('.', ',') : String(opts.value);
    var wrap = h('label', { class: 'field' + (opts.compact ? ' field--compact' : '') },
      opts.label ? h('span', { class: 'field__label', text: opts.label }) : null,
      h('span', { class: 'field__control' }, input, opts.suffix ? h('span', { class: 'field__suffix', text: opts.suffix }) : null));
    return {
      el: wrap, input: input,
      value: function () { return U.parseNum(input.value); },
      set: function (v) { input.value = v == null ? '' : (typeof v === 'number' ? String(v).replace('.', ',') : String(v)); }
    };
  }

  /** Satz-Eingabe fuer Gym und Kampf: Gewicht + Wiederholungen + Koerpergewicht-Knopf.
      opts: {onAdd(weight, reps) -> {ok, error}, addLabel, addIcon}
      Merkt sich das letzte Gewicht. -> {el, focus()} */
  function setEntry(opts) {
    opts = opts || {};
    var bw = (OP.state && OP.state.player.bodyweight) || 80;
    var last = null;
    try { last = Number(sessionStorage.getItem('op.lastWeight')); } catch (e) { /* egal */ }
    var w = numField({ label: 'Gewicht', suffix: 'kg', placeholder: 'z. B. 50', value: last > 0 ? last : '' });
    var r = numField({ label: 'Wiederholungen', suffix: 'Wdh.', placeholder: 'z. B. 10', integer: true, enterkeyhint: 'done' });
    var preview = h('div', { class: 'set-entry__preview num' }, '= 0 ' + (opts.unitLabel || 'XP'));
    function upd() {
      var wv = w.value(), rv = r.value();
      preview.textContent = isFinite(wv) && isFinite(rv) ? '= ' + U.fmt(wv * rv) + ' ' + (opts.unitLabel || 'XP') : '= 0 ' + (opts.unitLabel || 'XP');
    }
    w.input.addEventListener('input', upd);
    r.input.addEventListener('input', upd);
    var bwBtn = h('button', { class: 'chip chip--btn', type: 'button', onclick: function () { w.set(bw); upd(); r.input.focus(); } },
      h('span', { html: icon('body') }), 'Körpergewicht (' + U.fmt1(bw).replace(',0', '') + ' kg)');
    var addBtn = h('button', { class: 'btn btn--primary btn--lg btn--block', type: 'submit' },
      h('span', { html: icon(opts.addIcon || 'plus') }), opts.addLabel || 'Satz eintragen');
    var form = h('form', { class: 'set-entry card', onsubmit: function (e) {
      e.preventDefault();
      var res = opts.onAdd ? opts.onAdd(w.value(), r.value()) : { ok: true };
      if (res && res.ok === false) { toast(res.error || 'Eingabe prüfen.', { type: 'warn' }); return; }
      try { sessionStorage.setItem('op.lastWeight', String(w.value())); } catch (e2) { /* egal */ }
      r.set('');
      upd();
      haptic(12);
      r.input.focus();
    } },
      h('div', { class: 'set-entry__row' }, w.el, h('span', { class: 'set-entry__x', text: '×' }), r.el),
      h('div', { class: 'set-entry__meta' }, bwBtn, preview),
      addBtn);
    // Enter im Gewichtsfeld springt zu den Wiederholungen
    w.input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); r.input.focus(); } });
    return { el: form, focus: function () { (w.input.value ? r.input : w.input).focus(); } };
  }

  var KG_FMT = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 2 });

  /** Liste der Saetze mit Loeschen-Knopf. sets: [{w, r, dmg}] opts: {onRemove(i), unitLabel} */
  function setList(sets, opts) {
    opts = opts || {};
    var ul = h('ol', { class: 'set-list' });
    if (!sets.length) {
      ul.appendChild(h('li', { class: 'set-list__empty muted', text: opts.emptyText || 'Noch keine Sätze.' }));
      return ul;
    }
    sets.forEach(function (s, i) {
      ul.appendChild(h('li', { class: 'set-list__item' },
        h('span', { class: 'set-list__n num', text: (i + 1) + '.' }),
        h('span', { class: 'set-list__what num', text: KG_FMT.format(s.w) + ' kg × ' + s.r }),
        h('span', { class: 'set-list__dmg num', text: '+' + U.fmt(s.dmg) + ' ' + (opts.unitLabel || 'XP') }),
        opts.onRemove ? h('button', { class: 'icon-btn icon-btn--sm', type: 'button', 'aria-label': 'Satz löschen', html: icon('trash'),
          onclick: function () { opts.onRemove(i); } }) : null));
    });
    return ul;
  }

  /** Statistik-Kachel */
  function stat(value, label, opts) {
    opts = opts || {};
    return h('div', { class: 'stat' + (opts.tone ? ' tone-' + opts.tone : '') },
      opts.icon ? h('span', { class: 'stat__icon', html: icon(opts.icon) }) : null,
      h('div', { class: 'stat__value num', text: value }),
      h('div', { class: 'stat__label', text: label }));
  }

  /** Abschnitts-Ueberschrift */
  function sectionTitle(text, iconName, extra) {
    return h('div', { class: 'section-title' },
      iconName ? h('span', { html: icon(iconName) }) : null,
      h('h2', { text: text }), extra || null);
  }

  /** Aufraeum-Sammler fuer Bildschirme: var c = OP.ui.cleanup(); c.add(fn); return c.run; */
  function cleanupBag() {
    var fns = [];
    return {
      add: function (fn) { if (typeof fn === 'function') fns.push(fn); return fn; },
      /** OP.bus.on mit automatischem off */
      on: function (evt, fn) { fns.push(OP.bus.on(evt, fn)); },
      interval: function (fn, ms) { var id = setInterval(fn, ms); fns.push(function () { clearInterval(id); }); return id; },
      run: function () { while (fns.length) { try { fns.pop()(); } catch (e) { console.error(e); } } }
    };
  }

  /** Setzt Inhalt in den Kopf des aktuellen Bildschirms (rechts neben dem Titel) */
  function setHeadExtra(node) {
    if (!current || !current.headExtra) return;
    current.headExtra.innerHTML = '';
    if (node) current.headExtra.appendChild(node);
  }

  /** Achievements aus einem Ergebnis sind schon per Event gemeldet – nur fuer Sonderfaelle */
  OP.ui = {
    icon: icon, iconEl: iconEl,
    go: router.go, back: router.back, router: router,
    toast: toast, modal: modal, confirm: confirmDlg, prompt: promptDlg, celebrate: celebrate,
    haptic: haptic, progress: progress, setProgress: setProgress, rankBadge: rankBadge, diffChip: diffChip,
    numField: numField, setEntry: setEntry, setList: setList, stat: stat, sectionTitle: sectionTitle,
    cleanup: cleanupBag, setHeadExtra: setHeadExtra
  };
  OP.screens = screens;
})();
