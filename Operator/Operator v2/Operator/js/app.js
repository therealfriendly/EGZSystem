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
  }

  function boot() {
    var r = null, bootError = null;
    try { OP.store.load(); } catch (e) { bootError = e; OP.state = OP.store.defaultState(); }
    try { r = OP.game.onNewDayCheck(); } catch (e) { bootError = bootError || e; console.error('[app] Tagespruefung', e); }

    // Speicherfehler melden (hoechstens einmal pro Minute)
    var lastSaveWarn = 0;
    OP.bus.on('save-error', function () {
      if (Date.now() - lastSaveWarn < 60000) return;
      lastSaveWarn = Date.now();
      OP.ui.toast('Speichern fehlgeschlagen. Sichere deinen Spielstand in der Zauberbude (Export).', { type: 'err', ms: 6000 });
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
