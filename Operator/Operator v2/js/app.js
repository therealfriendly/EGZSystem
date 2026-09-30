/* Operator – Start der App */
(function () {
  'use strict';
  var U = OP.util;

  function hideBoot() {
    var b = document.getElementById('boot');
    if (!b) return;
    b.classList.add('is-done');
    setTimeout(function () { if (b.parentNode) b.parentNode.removeChild(b); }, 500);
  }

  function retentionNotice(r) {
    if (!r || !r.days) return;
    var lostPct = (1 - r.factor) * 100;
    OP.ui.toast('Retention: ' + r.days + (r.days === 1 ? ' Tag' : ' Tage') + ' ohne Training → alle Werte −' +
      U.fmt2(lostPct) + ' %', { type: 'warn', icon: 'warning', ms: 5200 });
  }

  var lastDay = U.today();
  function dayCheck() {
    var d = U.today();
    if (d === lastDay) return;
    lastDay = d;
    var r = OP.game.onNewDayCheck();
    OP.store.save('new-day');
    retentionNotice(r);
    if (OP.game.lockInfo().locked) OP.ui.lockHint(OP.game.lockInfo().text);
  }

  /** Zirkus-Sperre: welche Bereiche (Pfade) sind gesperrt? Laufende Einheiten duerfen noch beendet werden. */
  function lockGuard(path) {
    var li = OP.game.lockInfo();
    if (!li.locked) return null;
    var p = path.split('/'), area = null, s = OP.state;
    if (p[0] === 'arena') area = 'arena';
    else if (p[0] === 'haus' && p[1] === 'gym') area = 'gym';
    else if (p[0] === 'taverne' && p[1] === 'abenteuer') area = 'abenteuer';
    else if (p[0] === 'taverne' && p[1] === 'schmuggler') area = 'schmuggler';
    if (!area) return null;
    if (area === 'gym' && (s.gym || (s.run && s.run.active))) return null;
    if (area === 'schmuggler' && s.cardio && s.cardio.active) return null;
    return { area: area, message: li.text };
  }

  /** Einmalige Nachricht nach einem Update (z. B. Umstellung auf Push/Pull/Beine) */
  function showNotice() {
    var n = OP.game.popNotice();
    if (!n) return;
    OP.ui.modal({
      title: n.title || 'Neu in Operator',
      body: OP.h('p', { text: n.text || '' }),
      actions: [
        { label: 'Werte prüfen', kind: 'ghost', onClick: function () { OP.ui.go('zauberbude/xp'); } },
        { label: 'Alles klar', kind: 'primary' }
      ]
    });
  }

  /** Halbes Update (alte und neue Dateien gemischt): Spielstand NICHT anfassen, Zwischenspeicher leeren, neu laden */
  function updateReload() {
    var tried = false;
    try { tried = sessionStorage.getItem('op.updateReload') === '1'; sessionStorage.setItem('op.updateReload', '1'); } catch (e) { /* egal */ }
    var box = document.getElementById('boot');
    if (box) box.innerHTML = '<div><div class="boot__logo">OPERATOR</div><div class="boot__sub">' +
      (tried ? 'Update unvollständig – bitte App schließen und neu öffnen' : 'Update wird geladen …') + '</div></div>';
    if (tried) return;
    var jobs = [];
    try { if (window.caches) jobs.push(caches.keys().then(function (ks) { return Promise.all(ks.map(function (k) { return caches.delete(k); })); })); } catch (e) { /* egal */ }
    try { if (navigator.serviceWorker) jobs.push(navigator.serviceWorker.getRegistrations().then(function (rs) { return Promise.all(rs.map(function (r) { return r.update(); })); })); } catch (e) { /* egal */ }
    Promise.all(jobs).catch(function () {}).then(function () { location.reload(); });
  }

  function boot() {
    var r = null, bootError = null;
    try { OP.store.load(); }
    catch (e) { bootError = e; try { OP.state = OP.store.defaultState(); } catch (e2) { OP.state = null; } }
    // halbes Update oder fehlende Datei: Spielstand nicht anfassen, neu laden
    if (!OP.store || OP.store.mismatch || !OP.state) { updateReload(); return; }
    try { sessionStorage.removeItem('op.updateReload'); } catch (e) { /* egal */ }
    try { r = OP.game.onNewDayCheck(); } catch (e) { bootError = bootError || e; console.error('[app] Tagespruefung', e); }

    // Speicherfehler melden (hoechstens einmal pro Minute)
    var lastSaveWarn = 0;
    OP.bus.on('save-error', function () {
      if (Date.now() - lastSaveWarn < 60000) return;
      lastSaveWarn = Date.now();
      OP.ui.toast('Speichern fehlgeschlagen. Sichere deinen Spielstand in der Zauberbude (Export).', { type: 'err', ms: 6000 });
    });

    // Nach einem Import (z. B. alter Spielstand) die Update-Nachricht gleich zeigen
    OP.bus.on('change', function (e) {
      if (e && e.reason === 'import') setTimeout(function () {
        try { retentionNotice(OP.game.onNewDayCheck()); showNotice(); } catch (x) { /* egal */ }
      }, 600);
    });

    // Achievements feiern
    OP.bus.on('achievement', function (a) {
      var big = a.id === 'ich_bin_gesund';
      OP.ui.celebrate({
        kicker: big ? 'Kalorienschulden bezahlt' : 'Achievement freigeschaltet',
        title: a.name, text: a.desc, icon: a.icon || 'trophy', tone: big ? 'ok' : 'gold', big: big
      });
    });

    try {
      OP.ui.router.setGuard(lockGuard);
      if (OP.map && OP.map.init) {
        try { OP.map.init(document.getElementById('map-root')); }
        catch (e) { console.error('[app] Karte', e); }
      }
      OP.ui.router.init();
    } catch (e) {
      bootError = bootError || e;
      console.error('[app] Start', e);
    } finally {
      hideBoot();   // nie auf dem Startbild haengen bleiben
    }

    setTimeout(function () {
      retentionNotice(r);
      if (!OP.store.storageOk()) {
        OP.ui.toast('Achtung: Der Browser erlaubt kein Speichern. Spielstand geht beim Schließen verloren.', { type: 'err', ms: 7000 });
      }
      if (OP.store.corruptKey) {
        OP.ui.toast('Dein Spielstand war beschädigt. Eine Kopie ist noch da: in der Einrichtung auf „Ansehen“ tippen (später auch in der Zauberbude unter Notfall-Sicherungen).', { type: 'err', ms: 9000 });
      } else if (bootError) {
        OP.ui.toast('Beim Start ist ein Fehler passiert. Notfall-Sicherungen findest du in der Zauberbude.', { type: 'err', ms: 7000 });
      }
      try {
        if (OP.state.setupDone) {
          showNotice();
          if (OP.game.lockInfo().locked) OP.ui.lockHint(OP.game.lockInfo().text);
        }
      } catch (e) { console.error('[app] Hinweise', e); }
    }, 700);

    // Tageswechsel erkennen (App bleibt offen oder kommt aus dem Hintergrund).
    // Vorher neueren Stand aus einem anderen Fenster uebernehmen, damit nichts ueberschrieben wird.
    setInterval(dayCheck, 60000);
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) return;
      if (OP.store.syncFromStorage() && OP.ui.router.current()) OP.ui.router.refresh();
      dayCheck();
    });

    // Speicher dauerhaft anfragen (weniger Risiko, dass der Browser aufraeumt)
    try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) { /* egal */ }

    // Service Worker fuer Offline und "Zum Home-Bildschirm"
    if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
      window.addEventListener('load', function () {
        navigator.serviceWorker.register('sw.js').catch(function (e) { console.warn('[sw]', e); });
      });
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
