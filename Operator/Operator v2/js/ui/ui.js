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
      // defaultTab darf eine Funktion sein (z. B. Taverne: bei Sperre direkt der Zirkus)
      var def = typeof sh.defaultTab === 'function' ? sh.defaultTab() : sh.defaultTab;
      var tab = parts[1] && sh.tabs.some(function (t) { return t.id === parts[1]; }) ? parts[1] : def;
      return { shellId: first, tab: tab, screenId: first + '/' + tab, params: parts.slice(tab === parts[1] ? 2 : 1) };
    }
    return { screenId: first, params: parts.slice(1) };
  }

  /* ================= Sperre (Wache) =================
     guard(path) -> null (frei) oder {message} (gesperrt). Wird von app.js gesetzt (Zirkus-Sperre). */
  var guard = null;
  function blocked(path) {
    if (!guard) return null;
    try { return guard(String(path || '').replace(/^#\/?/, '').replace(/\/+$/, '')) || null; }
    catch (e) { console.error('[ui] guard', e); return null; }
  }
  /** Pfad eines Bildschirms inkl. Tab, z. B. 'taverne' -> 'taverne/abenteuer' (fuer die Wache) */
  function fullPath(path) {
    var r = resolve(parse('#/' + path).parts);
    if (!r.screenId) return '';
    return r.shellId ? r.shellId + '/' + r.tab + (r.params && r.params.length ? '/' + r.params.join('/') : '') : path;
  }

  /* Sperr-Hinweis oben: erscheint, blendet nach 5 Sekunden aus (Fade) */
  var lockHintEl = null, lockHintTimer = null;
  /** Steht oben schon ein fester Sperr-Hinweis? (Karte: Streifen, Bildschirm: Sperr-Zeile, Zirkus: Sperr-Karte)
      -> {el, map} oder null. Dann leuchtet dieser Hinweis 5 Sekunden auf, statt einen zweiten zu zeigen. */
  function persistentLock() {
    function shown(el) { return !!(el && !el.hidden && el.getClientRects().length); }
    if (!current) {
      var strip = document.querySelector('.map-lock');
      return shown(strip) ? { el: strip, map: true } : null;
    }
    if (!current.frameEl) return null;
    var line = current.frameEl.querySelector('.screen__lock');
    if (shown(line)) return { el: line };
    var card = current.frameEl.querySelector('.tav-zstatus--locked');
    if (shown(card)) return { el: card };
    return null;
  }
  function lockHint(message) {
    var root = document.getElementById('toast-layer');
    if (!root) return;
    var p = persistentLock();
    if (p) {
      if (p.map) OP.bus.emit('lock-flash', { message: message });   // die Karte laesst ihren Streifen aufleuchten
      else {
        var el = p.el;
        el.classList.remove('is-lock-flash');
        void el.offsetWidth;
        el.classList.add('is-lock-flash');
        clearTimeout(el._lockFlash);
        el._lockFlash = setTimeout(function () { el.classList.remove('is-lock-flash'); }, 5000);   // danach ausblenden
        try { el.scrollIntoView({ block: 'nearest' }); } catch (e) { /* alt */ }
      }
      haptic([20, 40, 20]);
      return;
    }
    if (!lockHintEl) {
      lockHintEl = h('div', { class: 'lock-hint', role: 'alert' },
        h('span', { class: 'lock-hint__icon', html: icon('lock') }),
        h('span', { class: 'lock-hint__text' }),
        h('button', { class: 'btn btn--sm btn--gold lock-hint__btn', type: 'button', onclick: function () {
          hideLockHint(true);
          router.go('taverne/zirkus');
        } }, 'Zum Zirkus'));
    }
    lockHintEl.querySelector('.lock-hint__text').textContent = message || 'Gesperrt: Erledige zuerst deinen Zirkus-Tanz.';
    if (!lockHintEl.parentNode) root.insertBefore(lockHintEl, root.firstChild);
    lockHintEl.classList.remove('is-out');
    // Neustart der Einblend-Animation
    lockHintEl.classList.remove('is-in');
    void lockHintEl.offsetWidth;
    lockHintEl.classList.add('is-in');
    clearTimeout(lockHintTimer);
    lockHintTimer = setTimeout(function () { hideLockHint(false); }, 5000);
    haptic([20, 40, 20]);
    OP.bus.emit('lock-hint', { visible: true });
  }
  function hideLockHint(now) {
    clearTimeout(lockHintTimer);
    if (!lockHintEl) return;
    if (lockHintEl.classList.contains('is-in')) OP.bus.emit('lock-hint', { visible: false });
    lockHintEl.classList.remove('is-in');
    lockHintEl.classList.add('is-out');
    var el = lockHintEl;
    setTimeout(function () { if (el.classList.contains('is-out') && el.parentNode) el.parentNode.removeChild(el); }, now ? 0 : 700);
  }

  /** Schloss an gesperrten Tabs aktualisieren; ist der offene Bereich gesperrt, zum Zirkus wechseln */
  function refreshLocks() {
    var lockedNow = !!blocked('arena');           // die Arena ist bei Sperre immer gesperrt
    if (!lockedNow && lockHintEl && lockHintEl.classList.contains('is-in')) hideLockHint(true);   // gerade entsperrt
    updateFrameLock(lockedNow);
    if (!current || !current.frameEl) return;
    if (current.shellId) {
      var sh = shells[current.shellId];
      current.frameEl.querySelectorAll('.screen__tabs .tab').forEach(function (b) {
        var isLocked = !!blocked(current.shellId + '/' + b.dataset.tab);
        b.classList.toggle('tab--locked', isLocked);
        b.setAttribute('aria-disabled', isLocked ? 'true' : 'false');
        var badge = sh && sh.tabBadge ? sh.tabBadge(b.dataset.tab) : null;
        b.classList.toggle('tab--warn', badge === 'warn');
      });
    }
    var g = blocked(current.shellId ? current.shellId + '/' + current.tab : current.path);
    // offener Bereich ist inzwischen gesperrt (z. B. Tageswechsel): Gebaeude-Standard-Tab bzw. Karte
    if (g) { lockHint(g.message); router.go(current.shellId ? current.shellId : ''); }
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
        var isLocked = !!blocked(r.shellId + '/' + t.id);
        var badge = sh.tabBadge ? sh.tabBadge(t.id) : null;   // z. B. 'warn' (Zirkus am Tag vor der Sperre)
        tabs.appendChild(h('button', {
          class: 'tab' + (t.id === r.tab ? ' tab--active' : '') + (isLocked ? ' tab--locked' : '') + (badge ? ' tab--' + badge : ''), role: 'tab',
          'aria-selected': t.id === r.tab ? 'true' : 'false', 'aria-disabled': isLocked ? 'true' : 'false',
          dataset: { tab: t.id },
          onclick: function () { router.go(r.shellId + '/' + t.id); },
          html: icon(t.icon) + '<span>' + U.esc(t.label) + '</span>' + '<span class="tab__lock">' + icon('lock') + '</span>'
        }));
      });
      frame.appendChild(tabs);
    }
    // Sperr-Zeile: solange die Zirkus-Sperre gilt, steht oben der Grund (nicht in Taverne/Einrichtung – dort gibt es eigene Hinweise)
    if (r.shellId !== 'taverne' && r.screenId !== 'setup') {
      frame.appendChild(h('div', { class: 'screen__lock', hidden: true, role: 'status' },
        h('span', { class: 'screen__lock-icon', html: icon('lock') }),
        h('span', { class: 'screen__lock-text' }),
        h('button', { class: 'btn btn--sm btn--gold', type: 'button', onclick: function () { router.go('taverne/zirkus'); } }, 'Zum Zirkus')));
    }
    var body = h('div', { class: 'screen__body' });
    frame.appendChild(body);
    return { frame: frame, body: body, headExtra: header.querySelector('.screen__head-extra') };
  }

  function updateFrameLock(lockedNow) {
    if (!current || !current.frameEl) return;
    var line = current.frameEl.querySelector('.screen__lock');
    if (!line) return;
    var g = lockedNow ? blocked('arena') : null;
    line.hidden = !g;
    if (g) line.querySelector('.screen__lock-text').textContent = g.message;
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
  var markNext = false, ignoreHash = null;
  function onMap() { return !current; }
  function isMarked() { try { return !!(history.state && history.state.opScreen); } catch (e) { return false; } }

  var router = {
    /** Navigieren: go('haus/gym'), go('#/arena'), go('') = Karte */
    go: function (path) {
      var p = String(path || '').replace(/^#\/?/, '');
      // gesperrter Bereich? Nicht hingehen, Hinweis zeigen
      var g = p ? blocked(fullPath(p)) : null;
      if (g) { lockHint(g.message); return; }
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
      if (ignoreHash) {
        var ig = ignoreHash;
        ignoreHash = null;
        if (location.hash === ig) return;
      }
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

      // gesperrter Bereich (z. B. Link, Zurueck-Taste)? Beim aktuellen Bildschirm bleiben oder zur Karte
      if (r.screenId) {
        var g = blocked(r.shellId ? r.shellId + '/' + r.tab : r.path);
        if (g) {
          lockHint(g.message);
          var curOk = current && current.path && !blocked(current.shellId ? current.shellId + '/' + current.tab : current.path);
          var stayPath = curOk ? current.path : (r.shellId === 'taverne' ? 'taverne/zirkus' : '');
          ignoreHash = '#/' + stayPath;          // das folgende hashchange nicht noch einmal verarbeiten
          location.replace('#/' + stayPath);
          if (curOk) return;                     // Bildschirm bleibt, wie er ist
          parsed = parse('#/' + stayPath);
          r = resolve(parsed.parts);
          r.path = parsed.path;
        }
      }

      if (!r.screenId) {                       // Karte
        // auf der Karte zeigt der feste Sperr-Streifen den Grund – den kurzen Hinweis hier ausblenden
        if (lockHintEl && lockHintEl.classList.contains('is-in') && blocked('arena')) hideLockHint(true);
        document.body.classList.remove('screen-tabs');
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
      document.body.classList.toggle('screen-tabs', !!r.shellId);   // Hinweise dann unter der Tab-Leiste
      current = { path: r.path, shellId: r.shellId, tab: r.tab, screenId: r.screenId, params: r.params, frameEl: f.frame, bodyEl: f.body, headExtra: f.headExtra };
      updateFrameLock(!!blocked('arena'));
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
      OP.bus.on('change', refreshLocks);
      router.handle();
    },
    /** Wache setzen: fn(pfad) -> null (frei) oder {message} (gesperrt) */
    setGuard: function (fn) { guard = fn; },
    /** Ist dieser Pfad gerade gesperrt? -> null oder {message} */
    blocked: function (path) { return blocked(fullPath(String(path || '').replace(/^#\/?/, ''))); }
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
      // Browser erlauben Vibration erst nach einer Beruehrung (sonst Fehlermeldung in der Konsole)
      if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return;
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

  /** Satz-Eingabe fuer Gym und Kampf: (Muskel-Auswahl) + Gewicht + Wiederholungen + Koerpergewicht-Knopf.
      opts: {muscles: [{id, name, icon}] (optional, Push/Pull/Beine), selected: muscleId, onSelect(id),
             onAdd(weight, reps) -> {ok, error}   ODER mit muscles: onAdd(muscleId, weight, reps),
             addLabel, addIcon, unitLabel}
      Merkt sich das letzte Gewicht (je Muskel). -> {el, focus(), select(id), selected()} */
  function setEntry(opts) {
    opts = opts || {};
    var bw = (OP.state && OP.state.player.bodyweight) || 80;
    var muscles = opts.muscles && opts.muscles.length ? opts.muscles : null;
    var sel = muscles ? (opts.selected && muscles.some(function (m) { return m.id === opts.selected; }) ? opts.selected : muscles[0].id) : null;
    function weightKey() { return 'op.lastWeight' + (sel ? '.' + sel : ''); }
    function lastWeight() {
      var v = null;
      try { v = Number(sessionStorage.getItem(weightKey()) || sessionStorage.getItem('op.lastWeight')); } catch (e) { /* egal */ }
      return v > 0 ? v : '';
    }
    var w = numField({ label: 'Gewicht', suffix: 'kg', placeholder: 'z. B. 50', value: lastWeight() });
    var r = numField({ label: 'Wiederholungen', suffix: 'Wdh.', placeholder: 'z. B. 10', integer: true, enterkeyhint: 'done' });
    var unit = opts.unitLabel || 'XP';
    var preview = h('div', { class: 'set-entry__preview num' }, '= 0 ' + unit);
    function upd() {
      var wv = w.value(), rv = r.value();
      preview.textContent = '= ' + (isFinite(wv) && isFinite(rv) ? U.fmt(wv * rv) : '0') + ' ' + unit;
    }
    w.input.addEventListener('input', upd);
    r.input.addEventListener('input', upd);

    // Muskel-Auswahl (Segmente)
    var seg = null;
    function select(id, silent) {
      if (!muscles || !muscles.some(function (m) { return m.id === id; })) return;
      sel = id;
      if (seg) seg.querySelectorAll('.seg__btn').forEach(function (b) {
        var on = b.dataset.m === id;
        b.classList.toggle('is-on', on);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
      var lw = lastWeight();
      if (lw !== '') w.set(lw);
      upd();
      if (!silent && opts.onSelect) opts.onSelect(id);
    }
    if (muscles && muscles.length > 1) {    // nur ein Muskel (z. B. Beine): keine Auswahl noetig
      seg = h('div', { class: 'seg set-entry__muscles', role: 'group', 'aria-label': 'Muskel für diesen Satz' });
      muscles.forEach(function (m) {
        seg.appendChild(h('button', {
          class: 'seg__btn' + (m.id === sel ? ' is-on' : ''), type: 'button', dataset: { m: m.id },
          'aria-pressed': m.id === sel ? 'true' : 'false',
          onclick: function () { select(m.id); },
          html: (m.icon ? icon(m.icon) : '') + '<span>' + U.esc(m.name) + '</span>'
        }));
      });
    }

    var bwBtn = h('button', { class: 'chip chip--btn', type: 'button', onclick: function () { w.set(bw); upd(); r.input.focus(); } },
      h('span', { html: icon('body') }), 'Körpergewicht (' + U.fmt1(bw).replace(',0', '') + ' kg)');
    var addBtn = h('button', { class: 'btn btn--primary btn--lg btn--block', type: 'submit' },
      h('span', { html: icon(opts.addIcon || 'plus') }), opts.addLabel || 'Satz eintragen');
    var form = h('form', { class: 'set-entry card', onsubmit: function (e) {
      e.preventDefault();
      var res = !opts.onAdd ? { ok: true } : (muscles ? opts.onAdd(sel, w.value(), r.value()) : opts.onAdd(w.value(), r.value()));
      if (res && res.ok === false) { toast(res.error || 'Eingabe prüfen.', { type: 'warn' }); return; }
      try {
        sessionStorage.setItem(weightKey(), String(w.value()));
        sessionStorage.setItem('op.lastWeight', String(w.value()));
      } catch (e2) { /* egal */ }
      r.set('');
      upd();
      haptic(12);
      if (form.isConnected) r.input.focus();
    } },
      seg,
      h('div', { class: 'set-entry__row' }, w.el, h('span', { class: 'set-entry__x', text: '×' }), r.el),
      h('div', { class: 'set-entry__meta' }, bwBtn, preview),
      addBtn);
    // Enter im Gewichtsfeld springt zu den Wiederholungen
    w.input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); r.input.focus(); } });
    return {
      el: form,
      focus: function () { (w.input.value ? r.input : w.input).focus(); },
      select: function (id) { select(id, true); },
      selected: function () { return sel; },
      /** aktuelle Eingabe {w, r} (NaN, wenn leer/ungueltig) */
      values: function () { return { w: w.value(), r: r.value() }; },
      /** Vorschau-Element (z. B. um "Kritisch!" anzuzeigen) */
      preview: preview,
      /** Muskeln mit Haken markieren (ids = Liste der vollen/erreichten Muskeln) */
      markDone: function (ids) {
        if (!seg) return;
        seg.querySelectorAll('.seg__btn').forEach(function (b) { b.classList.toggle('is-done', (ids || []).indexOf(b.dataset.m) >= 0); });
      }
    };
  }

  var KG_FMT = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 2 });

  /** Liste der Saetze mit Loeschen-Knopf. sets: [{m?, w, r, dmg}]
      opts: {onRemove(i), unitLabel, emptyText, extra(i, set) -> Node (z. B. Gegner-Treffer im Kampf),
             itemClass(i, set) -> 'klasse' (zusaetzliche Klasse fuer die Zeile)} */
  function setList(sets, opts) {
    opts = opts || {};
    var ul = h('ol', { class: 'set-list' });
    if (!sets.length) {
      ul.appendChild(h('li', { class: 'set-list__empty muted', text: opts.emptyText || 'Noch keine Sätze.' }));
      return ul;
    }
    sets.forEach(function (s, i) {
      var m = s.m && OP.data && OP.data.muscle ? OP.data.muscle(s.m) : null;
      var extraCls = opts.itemClass ? opts.itemClass(i, s) : '';
      ul.appendChild(h('li', { class: 'set-list__item' + (m ? ' set-list__item--m' : '') + (extraCls ? ' ' + extraCls : '') },
        h('span', { class: 'set-list__n num', text: (i + 1) + '.' }),
        h('span', { class: 'set-list__what num' },
          m ? h('span', { class: 'set-list__m', text: m.name }) : null,
          KG_FMT.format(s.w) + ' kg × ' + s.r),
        h('span', { class: 'set-list__dmg num', text: '+' + U.fmt(s.dmg) + ' ' + (opts.unitLabel || 'XP') }),
        opts.onRemove ? h('button', { class: 'icon-btn icon-btn--sm', type: 'button', 'aria-label': 'Satz löschen', html: icon('trash'),
          onclick: function () { opts.onRemove(i); } }) : null,
        opts.extra ? opts.extra(i, s) : null));
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
    go: router.go, back: router.back, router: router, lockHint: lockHint,
    toast: toast, modal: modal, confirm: confirmDlg, prompt: promptDlg, celebrate: celebrate,
    haptic: haptic, progress: progress, setProgress: setProgress, rankBadge: rankBadge, diffChip: diffChip,
    numField: numField, setEntry: setEntry, setList: setList, stat: stat, sectionTitle: sectionTitle,
    cleanup: cleanupBag, setHeadExtra: setHeadExtra
  };
  OP.screens = screens;
})();
