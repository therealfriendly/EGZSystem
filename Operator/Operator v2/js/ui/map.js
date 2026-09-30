/* Operator – Weltkarte (global: OP.map)
   Startbildschirm der App: gemaltes Kartenbild mit anklickbaren Hotspots (Pins, Schilder,
   Markierungen), HUD (Spieler-Karte, Tages-Quests, Zirkus-Sperre, laufende Aktionen) und Hauptmenue
   (untere Leiste auf dem Handy, schmale Leiste im Querformat, Seitenleiste auf breiten Bildschirmen).
   Alle Hotspots kommen aus OP.mapConfig (js/ui/map-config.js).

   Aufbau im DOM:
     #map-root > .map
        .map-stage            Kartenbereich (ohne Menue)
           .map-view          scrollbarer Ausschnitt (Handy: seitlich wischen, PC: ziehen)
              .map-world      Kartenbild + Hotspots (Groesse per JS, 1em = 1 % der Kartenbreite)
           .map-fx            Nebel, Scanlines, Vignette (nur Deko)
           .map-hud           Spieler-Karte, Sperr-Streifen, Hilfe, Tages-Quests, Banner
     body > nav.map-nav       Hauptmenue (liegt direkt im body, damit die Seitenleiste
                              auf breiten Bildschirmen UEBER geoeffneten Bildschirmen bleibt)

   Zirkus-Sperre (OP.game.lockInfo): Solange gesperrt ist, steht oben ein Streifen mit dem Grund
   und "Zum Zirkus"; am Tag davor (lockInfo.warn) ein ruhigerer Streifen "Morgen gesperrt". Gesperrte
   Orte/Menuepunkte (Router-Wache OP.ui.router.blocked) bekommen ein Schloss und werden abgedunkelt.
   Antippen ruft trotzdem OP.ui.go(): Auf der Karte zeigt der Router dann keinen eigenen Hinweis,
   sondern meldet OP.bus 'lock-flash' – der Streifen leuchtet kurz auf. */
(function () {
  'use strict';
  var OP = (window.OP = window.OP || {});
  var U = OP.util, h = OP.h;

  /* Gleiche Grenzen wie in base.css / map.css */
  var MQ_WIDE = '(min-width: 900px) and (min-height: 560px)';
  var MQ_LAND = '(orientation: landscape) and (max-height: 559px)';   // Querformat-Handy

  /* Notfall-Menue, falls map-config.js fehlt oder kaputt ist (dann bleibt die App bedienbar) */
  var FALLBACK_NAV = [
    { id: 'taverne', label: 'Taverne', short: 'Taverne', route: 'taverne', icon: 'taverne', tone: 'gold' },
    { id: 'arena', label: 'Arena', short: 'Arena', route: 'arena', icon: 'arena', tone: 'red' },
    { id: 'haus', label: 'Haus', short: 'Haus', route: 'haus', icon: 'haus', tone: 'cyan' },
    { id: 'zauberbude', label: 'Zauberbude', short: 'Zauber', route: 'zauberbude', icon: 'zauberbude', tone: 'violet' },
    { id: 'abenteuer', label: 'Abenteuer', short: 'Abenteuer', route: 'taverne/abenteuer', icon: 'abenteuer', tone: 'cyan' },
    { id: 'profil', label: 'Profil', short: 'Profil', route: 'haus/profil', icon: 'profil', tone: 'gold' }
  ];
  var FALLBACK_NAV_SMALL = [
    { id: 'einstellungen', label: 'Zauberbude (Einstellungen)', route: 'zauberbude', icon: 'settings' },
    { id: 'hilfe', label: 'Hilfe', route: 'hilfe', icon: 'hilfe' }
  ];
  var LOCK_TEXT_DEFAULT = 'Gesperrt: Erledige zuerst deinen Zirkus-Tanz.';
  var WARN_TEXT = 'Morgen gesperrt: Heute Zirkus-Tanz machen.';
  var LOCK_AREAS_TEXT = 'Arena, Gym, Abenteuer und Schmuggler';
  var RUN_MAX_MIN = 1440;         // Lauf-Timer: mehr als 24 Std. wertet OP.game.runStop nicht (Timer vergessen)

  var CFG = [], WORLD = { src: 'assets/map/world.jpg', width: 1345, height: 941 };
  var inited = false;
  var root, stage, view, world, hud, hudTop, nav;
  var hotspots = [], hsById = {};
  var callouts = [];
  var playerCards = [], hudCard = null;
  var questBoard = null;
  var banners = null;
  var lockStrip = null;
  var hintShown = false;          // Router-Sperrhinweis (#toast-layer) gerade sichtbar? (OP.bus 'lock-hint')
  var navBtns = [];
  var avatarUrl = null;
  var visible = true;
  var lastCtx = null;
  var ticker = null;
  var justChecked = null;
  var debugOn = false;
  var worldSize = { w: 0, h: 0 };
  var scrollFrac = null;          // Mitte des Ausschnitts als Anteil der Karte {x, y}
  var lastDragEnd = 0;
  var mqWide = null, mqLand = null;
  var landQuestsOpen = false;     // Querformat-Handy: Tages-Quests nur fuer diese Sitzung aufgeklappt

  /* ================= kleine Helfer ================= */

  function icon(name, cls) { return OP.ui && OP.ui.icon ? OP.ui.icon(name, cls) : ''; }
  function safe(fn, fallback) {
    try { return fn(); } catch (e) { console.error('[map]', e); return fallback; }
  }
  function num(v, def) { v = Number(v); return isFinite(v) ? v : (def || 0); }
  function sGet(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } }
  function sSet(k, v) { try { sessionStorage.setItem(k, v); } catch (e) { /* egal */ } }
  function isWide() { return !!(mqWide && mqWide.matches); }
  function isLand() { return !!(mqLand && mqLand.matches); }
  function reducedMotion() { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); }
  function setAttr(el, name, value) {
    if (value == null) { if (el.hasAttribute(name)) el.removeAttribute(name); }
    else if (el.getAttribute(name) !== value) el.setAttribute(name, value);
  }
  function setText(el, t) { t = t == null ? '' : String(t); if (el.textContent !== t) el.textContent = t; }

  /** Ist dieser Weg gerade gesperrt (Zirkus-Sperre)? -> null oder {message}. Fragt die Router-Wache,
      damit Ausnahmen (z. B. laufendes Gym-Training, laufender Lauf-Timer) automatisch stimmen. */
  function blockedInfo(route) {
    if (!route) return null;
    var r = OP.ui && OP.ui.router;
    if (!r || typeof r.blocked !== 'function') return null;
    return safe(function () { return r.blocked(route); }, null) || null;
  }
  function lockText(info) {
    return (info && info.text) || (info && info.message) || (OP.data && OP.data.LOCK_TEXT) || LOCK_TEXT_DEFAULT;
  }
  /** Vorlese-Text fuer gesperrte Orte: "Arena – Gesperrt: Erledige zuerst deinen Zirkus-Tanz." */
  function lockedLabel(name, info) {
    var t = lockText(info);
    return name + ' – ' + (/gesperrt/i.test(t) ? t : 'gesperrt. ' + t);
  }

  /** Streak-Zustand als Text und CSS-Klasse (Karte, Spieler-Karte) */
  function streakState(st) {
    st = st || {};
    var cur = Math.max(0, Math.floor(num(st.current)));
    var hint = st.todayActive ? 'Heute schon erledigt.' : (cur > 0 ? 'Heute noch offen – mach etwas, damit er hält!' : 'Starte heute deinen Streak.');
    return {
      cur: cur,
      cls: cur === 0 ? 'is-zero' : (st.todayActive ? 'is-today' : 'is-risk'),
      hint: hint,
      label: 'Streak: ' + U.fmt(cur) + (cur === 1 ? ' Tag. ' : ' Tage. ') + hint
    };
  }

  var TONES = { cyan: 1, gold: 1, red: 1, violet: 1, amber: 1, lime: 1 };
  function toneClass(t) { return 'map-tone--' + (TONES[t] ? t : 'cyan'); }

  function p2(n) { return (n < 10 ? '0' : '') + n; }
  /** Sekunden -> "mm:ss" bzw. "h:mm:ss" */
  function hms(s) {
    s = Math.max(0, s);
    var hh = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60), ss = s % 60;
    return hh > 0 ? hh + ':' + p2(mm) + ':' + p2(ss) : p2(mm) + ':' + p2(ss);
  }
  /** Countdown (angefangene Sekunde zaehlt noch) */
  function clock(ms) { return hms(Math.ceil(num(ms) / 1000)); }
  /** Stoppuhr (nur volle Sekunden) */
  function stopwatch(ms) { return hms(Math.floor(num(ms) / 1000)); }
  /** Minuten immer mit zwei Nachkommastellen: 8.59 -> "8,59 Min." (geschuetztes Leerzeichen: nie getrennt) */
  function minutes(v) { return U.fmt2(v) + '\u00a0Min.'; }

  function navigate(route) {
    if (debugOn) return;
    // Gesperrt? Dann vibriert der Router selbst und meldet 'lock-flash' (Streifen leuchtet auf, siehe init)
    if (!(route && blockedInfo(route)) && OP.ui && OP.ui.haptic) OP.ui.haptic(8);
    if (OP.ui && OP.ui.go) OP.ui.go(route);
  }

  /** Alle Werte, die die Karte anzeigt – einmal pro Aenderung berechnet, robust gegen fehlende Daten */
  function snapshot() {
    var s = OP.state || {}, g = OP.game || {};
    return {
      s: s,
      name: (s.player && s.player.name) || 'Runner',
      rank: safe(function () { return g.runnerRank(); }, null),
      strength: safe(function () { return g.totalStrength(); }, 0),
      kcal: safe(function () { return g.kcalStatus(); }, null),
      streak: safe(function () { return g.streakInfo(); }, null) || { current: 0, longest: 0, todayActive: false },
      quests: safe(function () { return g.questsToday(); }, null) || [],
      fight: safe(function () { return g.fightStatus(); }, null),
      gym: safe(function () { return g.gymStatus(); }, null),
      run: safe(function () { return g.runStatus ? g.runStatus() : null; }, null),
      dance: s.dance ? safe(function () { return g.danceStatus ? g.danceStatus() : null; }, null) : null,
      cardio: safe(function () { return g.cardioStatus(); }, null),
      lock: safe(function () { return g.lockInfo ? g.lockInfo() : null; }, null)
    };
  }

  /** Prueft, ob ein Bild existiert (fuer austauschbare Sprites). cb(url) nur bei Erfolg. */
  function probe(url, cb) {
    if (!url) return;
    var img = new Image();
    img.onload = function () { if (img.naturalWidth > 0) cb(url); };
    img.onerror = function () { /* kein Sprite da -> Standard-Aussehen bleibt */ };
    img.src = url;
  }

  /* ================= Hotspot-Bausteine =================
     Jede Art ist eine eigene kleine Funktion: pin, plate, figure.
     Rueckgabe: {el, def, spriteHost, update(ctx)} */

  /** Gemeinsamer Rahmen: <button> an der richtigen Stelle, Abzeichen, Zirkus-Sperre */
  function baseHotspot(def, kindCls) {
    var el = h('button', {
      type: 'button',
      class: 'map-hs ' + kindCls + ' ' + toneClass(def.tone) + ' map-hs--lbl-' + (def.labelPos || 'bottom'),
      'aria-label': def.label + ' öffnen',
      title: def.label,
      dataset: { id: def.id, route: def.route || '' },
      style: {
        left: num(def.x) + '%',
        top: num(def.y) + '%',
        width: num(def.w, 6) + '%',
        'z-index': String(10 + Math.round(num(def.y) * 2)),
        '--ldx': num(def.labelDx) + 'em',                     // Beschriftung seitlich verschieben
        '--delay': (-(num(def.x) * 0.07)).toFixed(2) + 's'   // Pins wippen nicht alle gleichzeitig
      },
      onclick: function () { navigate(def.route); }
    });
    var badge = h('span', { class: 'map-hs__badge', 'aria-hidden': 'true', hidden: true });
    var badgeKey = '';

    /** Sperre, Abzeichen, Vorlese-Text und Tooltip setzen.
        bl = Ergebnis von blockedInfo (gesperrt) oder null; aria/title = eigener Text (Schilder) */
    function refresh(ctx, bl, aria, title) {
      var locked = !!bl;
      el.classList.toggle('map-hs--locked', locked);
      setAttr(el, 'aria-disabled', locked ? 'true' : null);
      var b = !locked && typeof def.badge === 'function' ? safe(function () { return def.badge(ctx.s, OP.game); }, null) : null;
      // Abzeichen: Schloss (gesperrt) > Regel aus map-config.js
      var key = locked ? 'lock' : (b ? (b.dot ? 'dot' : 'txt') + '|' + (b.tone || 'red') + '|' + (b.dot ? '' : String(b.text || '!')) : '');
      if (key !== badgeKey) {
        badgeKey = key;
        badge.hidden = !key;
        if (locked) {
          badge.className = 'map-hs__badge map-hs__badge--lock';
          badge.innerHTML = icon('lock');
        } else if (b) {
          badge.className = 'map-hs__badge ' + toneClass(b.tone || 'red') + (b.dot ? ' map-hs__badge--dot' : '');
          badge.textContent = b.dot ? '' : String(b.text || '!');
        }
      }
      var a = aria || (def.label + ' öffnen');
      if (locked) a = lockedLabel(def.label, bl);
      else if (b && b.title) a += ' – ' + b.title;
      setAttr(el, 'aria-label', a);
      el.title = locked ? def.label + ' – gesperrt' : (title || def.label);
      return locked;
    }
    return { el: el, badge: badge, refresh: refresh };
  }

  /** Beschriftungs-Chip. showLabel: false (map-config.js) = Name ausblenden, weil das Kartenbild
      direkt darunter schon ein gemaltes Schild hat. Der Chip erscheint dann nur fuer die
      Zusatzzeile (z. B. Countdown). Vorlesen klappt trotzdem (aria-label am Knopf). */
  function labelEl(def, withIcon) {
    var noName = def.showLabel === false;
    var sub = h('span', { class: 'map-hs__sub num', hidden: true });
    var el = h('span', { class: 'map-hs__label' + (noName ? ' map-hs__label--noname' : ''), 'aria-hidden': noName ? 'true' : null, hidden: noName },
      // Schloss erscheint nur bei Zirkus-Sperre (CSS: .map-hs--locked), ersetzt dann das Icon
      noName ? null : h('span', { class: 'map-hs__label-lock', html: icon('lock') }),
      withIcon ? h('span', { class: 'map-hs__label-ico', html: icon(def.icon) }) : null,
      noName ? null : h('span', { class: 'map-hs__label-text', text: def.label }),
      sub);
    return {
      el: el, sub: sub,
      /** Zusatzzeile setzen (null = keine) */
      setSub: function (s) {
        sub.hidden = !s;
        setText(sub, s ? s.text : '');
        sub.className = 'map-hs__sub num' + (s && s.tone ? ' ' + toneClass(s.tone) + ' is-toned' : '');
        if (noName) el.hidden = !s;
      }
    };
  }

  // Stecknadel: Kopf-Kreis + Spitze (viewBox 100 x 130, Kopf-Mitte bei 50/50)
  var PIN_SVG =
    '<svg class="map-pin__shape" viewBox="0 0 100 130" aria-hidden="true" focusable="false">' +
      '<path class="map-pin__fill" d="M50 127 C40 108 4 88 4 50 A46 46 0 1 1 96 50 C96 88 60 108 50 127 Z"/>' +
      '<circle class="map-pin__ring" cx="50" cy="50" r="36"/>' +
      '<path class="map-pin__shine" d="M22 36 A32 32 0 0 1 64 20"/>' +
    '</svg>';

  /** pin: Stecknadel ueber einem Gebaeude (deckt die gemalte Nadel ab) */
  function Pin(def) {
    var b = baseHotspot(def, 'map-pin');
    var lbl = labelEl(def, false);
    var art = h('span', { class: 'map-pin__art', 'aria-hidden': 'true',
      html: PIN_SVG + '<span class="map-pin__icon">' + icon(def.icon) + '</span>' });
    var float = h('span', { class: 'map-pin__float' }, art, b.badge);
    b.el.appendChild(h('span', { class: 'map-pin__ping', 'aria-hidden': 'true' }));
    b.el.appendChild(float);
    if (def.showLabel !== false) b.el.appendChild(lbl.el);   // sonst: gemaltes Schild reicht
    return {
      el: b.el, def: def, spriteHost: float,
      update: function (ctx) { b.refresh(ctx, blockedInfo(def.route)); }
    };
  }

  /** plate: Schild/Tafel (Streak, Gym). Inhalt je nach id aus PLATES, sonst Icon + Name. */
  function Plate(def) {
    var b = baseHotspot(def, 'map-plate map-plate--' + def.id);
    b.el.style.height = num(def.h, 8) + '%';
    var art = h('span', { class: 'map-plate__art', 'aria-hidden': 'true' });
    var content = h('span', { class: 'map-plate__content' });
    var inner = (PLATES[def.id] || PLATES._default)(def, content, b.el);
    b.el.appendChild(art);
    b.el.appendChild(content);
    b.el.appendChild(b.badge);
    return {
      el: b.el, def: def, spriteHost: b.el,
      update: function (ctx) {
        var bl = blockedInfo(def.route);
        // Inhalt liefert eigenen Vorlese-Text/Tooltip ({aria, title}) oder nichts
        var t = safe(function () { return inner.update(ctx, !!bl); }, null) || {};
        b.refresh(ctx, bl, t.aria, t.title);
      },
      /** nach Groessenaenderung der Karte: Texte neu einpassen (falls der Inhalt das braucht) */
      fit: function () { if (inner.fit) safe(inner.fit); }
    };
  }

  /** figure: Ziel-Markierung (Eck-Klammern) um etwas Gemaltes + Beschriftung */
  function Figure(def) {
    var b = baseHotspot(def, 'map-fig');
    b.el.style.height = num(def.h, 8) + '%';
    var lbl = labelEl(def, true);
    var frame = h('span', { class: 'map-fig__frame', 'aria-hidden': 'true' });
    b.el.appendChild(frame);
    b.el.appendChild(lbl.el);
    b.el.appendChild(b.badge);
    return {
      el: b.el, def: def, spriteHost: b.el,
      update: function (ctx) {
        var bl = blockedInfo(def.route);
        var sub = FIG_SUB[def.id] ? safe(function () { return FIG_SUB[def.id](ctx, !!bl); }, null) : null;
        lbl.setSub(sub);
        b.refresh(ctx, bl);
      }
    };
  }

  var KINDS = { pin: Pin, plate: Plate, panel: Plate, figure: Figure };

  /* ---------- Inhalte der Schilder ----------
     update(ctx, locked) -> optional {aria, title} fuer Vorlesen/Tooltip */
  var PLATES = {
    /** Streak: Flamme, "STREAK", aktuelle Tage und 5 Flammen-Punkte (Tage im 5er-Block) */
    streak: function (def, host, btn) {
      var flame = h('span', { class: 'map-streak__flame', html: icon('streak') });
      var pips = h('span', { class: 'map-streak__pips' });
      var pipEls = [];
      for (var i = 0; i < 5; i++) { var p = h('span', { class: 'map-streak__pip', html: icon('streak') }); pipEls.push(p); pips.appendChild(p); }
      var title = h('span', { class: 'map-streak__title', text: 'Streak' });
      var numEl = h('b', { class: 'map-streak__num num', text: '0' });
      var unit = h('small', { class: 'map-streak__unit', text: 'Tage' });
      // Aufbau: Flamme | (Zahl + Tage / 5 Flammen-Punkte); "STREAK" als Reiter oben am Rand
      host.appendChild(flame);
      host.appendChild(h('span', { class: 'map-streak__mid' }, h('span', { class: 'map-streak__count' }, numEl, unit), pips));
      host.appendChild(title);
      return {
        update: function (ctx) {
          var st = ctx.streak || {}, ss = streakState(st), cur = ss.cur;
          var filled = cur > 0 ? ((cur - 1) % 5) + 1 : 0;
          pipEls.forEach(function (p, i) { p.classList.toggle('is-on', i < filled); });
          setText(numEl, U.fmt(cur));
          setText(unit, cur === 1 ? 'Tag' : 'Tage');
          btn.classList.toggle('is-risk', ss.cls === 'is-risk');
          btn.classList.toggle('is-today', ss.cls === 'is-today');
          btn.classList.toggle('is-zero', ss.cls === 'is-zero');
          return { aria: ss.label + ' Längster: ' + U.fmt(num(st.longest)) + '.', title: 'Streak: ' + U.fmt(cur) + ' · ' + ss.hint };
        }
      };
    },

    /** Gym: Hantel-Scheibe + "GYM" + Pfeil. Zeigt laufendes Training (Gruppe), laufenden
        Lauf-Timer (Stoppuhr), vergessenen Timer (ueber 24 Std.) oder die Zirkus-Sperre. */
    gym: function (def, host, btn) {
      var sub = h('span', { class: 'map-gym__sub', text: 'Training' });
      host.appendChild(h('span', { class: 'map-gym__disc', html: icon('gym') }));
      host.appendChild(h('span', { class: 'map-gym__text' }, h('span', { class: 'map-gym__title', text: def.label || 'Gym' }), sub));
      host.appendChild(h('span', { class: 'map-gym__chev', html: icon('next') }));
      function fit() { fitSub(btn, sub); }
      return {
        fit: fit,
        update: function (ctx, locked) {
          var g = ctx.gym, ra = ctx.run && ctx.run.active;
          var stale = !!ra && num(ra.minutes) > RUN_MAX_MIN;   // Timer vergessen: zaehlt nicht mehr (runStop -> tooLong)
          var live = !locked && !!(g || ra);
          var txt = 'Training', aria = 'Gym öffnen';
          if (locked) txt = 'Gesperrt';
          else if (g) {
            txt = (g.group && g.group.name) || 'Läuft';
            aria += ' – Training läuft: ' + txt + ', ' + num(g.reachedCount) + ' von ' + ((g.parts && g.parts.length) || 0) + ' Zielen erreicht';
          } else if (ra) {
            txt = stale ? 'Vergessen?' : (ra.running ? stopwatch(ra.elapsedMs) : 'Pause');
            aria += stale ? ' – Lauf-Timer läuft seit über 24 Stunden (vergessen?)' : ' – Lauf-Timer ' + (ra.running ? 'läuft' : 'pausiert');
          }
          btn.classList.toggle('is-live', live);
          btn.classList.toggle('is-paused', live && !g && !!ra && (!ra.running || stale));
          btn.classList.toggle('is-stale', live && !g && stale);
          setText(sub, txt);
          fit();
          return { aria: aria, title: 'Gym' + (g ? ' – Training läuft' : (ra ? ' – Lauf-Timer' : '')) };
        }
      };
    },

    /** Standard: Icon + Name */
    _default: function (def, host) {
      host.appendChild(h('span', { class: 'map-plate__ico', html: icon(def.icon) }));
      host.appendChild(h('span', { class: 'map-plate__lbl', text: def.label }));
      return { update: function () { return null; } };
    }
  };

  /* ---------- Zusatzzeile unter den Markierungen (ctx, gesperrt) ---------- */
  var FIG_SUB = {
    kalorien: function (ctx) {
      var k = ctx.kcal;
      if (!k || !k.hasGoal) return { text: 'Ziel setzen' };
      if (k.done) return { text: 'Gesund!', tone: 'lime' };
      return { text: U.fmt(k.remaining) + ' kcal' };
    },
    schmuggler: function (ctx) {
      var c = ctx.cardio;
      if (!c) return null;
      if (c.expired) return { text: 'Zeit um!', tone: 'red' };
      return { text: clock(c.msLeft), tone: 'amber' };
    }
  };

  /** Faehnchen neben einem Hotspot (map-config: callout), z. B. "Zirkus!" an der Taverne.
      Eigener Knopf, damit er direkt zum richtigen Tab fuehrt. */
  function Callout(def) {
    var ico = h('span', { class: 'map-callout__ico', 'aria-hidden': 'true' });
    var txt = h('span', { class: 'map-callout__txt' });
    var route = def.route;
    var isPin = (def.kind || 'pin') === 'pin';
    var el = h('button', {
      type: 'button', class: 'map-callout ' + toneClass('amber'), hidden: true,
      dataset: { for: def.id },
      style: {
        // Pin: rechts neben dem Nadelkopf; sonst rechts oben an der Markierung
        left: (num(def.x) + num(def.w, 6) / 2) + '%',
        top: (isPin ? num(def.y) : num(def.y) - num(def.h, 8) / 2) + '%'
      },
      onclick: function () { navigate(route); }
    }, ico, txt);
    var iconName = '';
    return {
      el: el,
      update: function (ctx) {
        var c = typeof def.callout === 'function' ? safe(function () { return def.callout(ctx.s, OP.game); }, null) : null;
        el.hidden = !c;
        if (!c) return;
        route = c.route || def.route;
        el.className = 'map-callout ' + toneClass(c.tone || 'amber') + (c.strong ? ' is-strong' : '');
        if (iconName !== (c.icon || '')) { iconName = c.icon || ''; ico.innerHTML = iconName ? icon(iconName) : ''; ico.hidden = !iconName; }
        setText(txt, c.text || '!');
        setAttr(el, 'aria-label', c.title || c.text || def.label || '');
        el.title = c.title || c.text || '';
      }
    };
  }

  function buildHotspots() {
    CFG.forEach(function (def) {
      if (!def || !def.id) return;
      var make = KINDS[def.kind] || Pin;
      var inst = safe(function () { return make(def); }, null);
      if (!inst) return;
      hotspots.push(inst);
      hsById[def.id] = inst;
      world.appendChild(inst.el);
      if (typeof def.callout === 'function') {
        var co = safe(function () { return Callout(def); }, null);
        if (co) { callouts.push(co); world.appendChild(co.el); }
      }
      // Sprite austauschbar: existiert die Datei, wird sie statt des Standard-Aussehens gezeigt
      probe(def.sprite, function (url) {
        var img = h('img', { class: 'map-hs__sprite', src: url, alt: '', draggable: 'false', 'aria-hidden': 'true' });
        inst.spriteHost.insertBefore(img, inst.spriteHost.firstChild);
        inst.el.classList.add('has-sprite');
      });
    });
  }

  /* ================= Spieler-Karte ================= */

  function avatarEl() {
    var inner = avatarUrl
      ? h('img', { class: 'map-avatar__img', src: avatarUrl, alt: '', draggable: 'false' })
      : h('span', { class: 'map-avatar__ico', html: icon('profil') });
    return h('span', { class: 'map-avatar', 'aria-hidden': 'true' }, h('span', { class: 'map-avatar__in' }, inner));
  }

  /** Handy-Karte: passt der Name neben den Rang nicht mehr, nur den Rang-Stein zeigen
      (Zahlen werden nie abgeschnitten, der Rang-Name steht im aria-label). */
  function fitCard(el) {
    if (!el || !el.classList.contains('map-player--hud') || !el.offsetWidth) return;
    el.classList.remove('is-tight');
    el.style.maxWidth = '';
    var n = el.querySelector('.map-player__name'), info = el.querySelector('.map-player__info');
    var line1 = n && n.parentNode, stats = el.querySelector('.map-player__line--stats');
    if (!n || !info || !stats) return;
    // Karte nur so breit wie ihr Inhalt (sonst leerer Platz im Querformat)
    var gap = function (line) { return parseFloat(getComputedStyle(line).columnGap) || 0; };
    var sum = function (line) {
      var w = 0, kids = line.children;
      for (var i = 0; i < kids.length; i++) w += kids[i] === n ? n.scrollWidth : kids[i].offsetWidth;
      return w + gap(line) * Math.max(0, kids.length - 1);
    };
    var chrome = el.offsetWidth - info.clientWidth;   // Avatar, Abstaende, Rahmen
    el.style.maxWidth = Math.min(300, Math.ceil(chrome + Math.max(sum(line1), sum(stats)) + 2)) + 'px';
    if (n.clientWidth > 0 && n.scrollWidth > n.clientWidth) el.classList.add('is-tight');   // schon 1 px zu breit = "Art…"
  }
  /** Zahl in einer schmalen Kachel: Schrift so weit verkleinern, dass sie ganz hineinpasst */
  function fitText(el) {
    el.style.fontSize = '';
    var cw = el.clientWidth;
    if (!cw) return;
    // Textbreite genau messen (scrollWidth ist gerundet)
    var range = document.createRange();
    range.selectNodeContents(el);
    var tw = range.getBoundingClientRect().width;
    if (tw <= cw) return;
    var px = parseFloat(getComputedStyle(el).fontSize) || 16;
    el.style.fontSize = Math.max(9, Math.floor(px * (cw - 1) / tw * 10) / 10) + 'px';
  }
  /** Breite, die ein Element ohne Umbruch braucht – genau (Bruchteile) und samt ::before (Live-Punkt) */
  function needWidth(el) {
    var old = el.style.width;
    el.style.width = 'max-content';
    var w = el.getBoundingClientRect().width;
    el.style.width = old;
    return w;
  }
  /** Unterzeile eines Schildes (Gym) nie abschneiden. Die Schrift hat eine Mindestgroesse, das Schild
      waechst mit der Karte – auf kleinen Karten (Querformat, 375er-Handys) wird es eng. Dann faellt
      zuerst der Pfeil weg (.is-tight: mehr Platz, ohne Sperrung), erst danach wird die Schrift kleiner. */
  function fitSub(btn, sub) {
    btn.classList.remove('is-tight');
    sub.style.fontSize = '';
    var box = sub.getBoundingClientRect().width;
    if (!box || needWidth(sub) <= box) return;
    btn.classList.add('is-tight');
    box = sub.getBoundingClientRect().width;
    var need = needWidth(sub);
    if (need <= box) return;
    var px = parseFloat(getComputedStyle(sub).fontSize) || 10;
    sub.style.fontSize = Math.max(8, Math.floor(px * (box - 0.5) / need * 10) / 10) + 'px';
  }
  function fitPlates() {
    hotspots.forEach(function (hs) { if (hs.fit) hs.fit(); });
  }
  /** grosse Zahlen in den Kacheln nie abschneiden */
  function fitNums(root) {
    Array.prototype.forEach.call(root.querySelectorAll('.map-player__tv'), function (el) { fitText(el); });
  }
  function fitCards() {
    playerCards.forEach(function (c) {
      safe(function () {
        fitCard(c.el);
        fitNums(c.el);
      });
    });
  }

  /** variant: 'hud' (Handy, kompakt) oder 'side' (Seitenleiste, ausfuehrlich) */
  function PlayerCard(variant) {
    var el = h('button', { type: 'button', class: 'map-player map-player--' + variant, onclick: function () { navigate('haus/profil'); } });
    return {
      el: el,
      update: function (ctx) {
        el.innerHTML = '';
        var r = ctx.rank;
        var rankNode = r && r.rank && OP.ui.rankBadge ? OP.ui.rankBadge(r.rank, { small: true }) : null;
        var bar = h('span', { class: 'map-player__bar', 'aria-hidden': 'true' },
          h('span', { style: { width: Math.round(num(r && r.progress) * 100) + '%' } }));
        var strength = h('span', { class: 'map-player__stat', title: 'Gesamtstärke' },
          h('span', { html: icon('staerke') }), h('span', { class: 'num', text: U.fmt(ctx.strength) }));
        var ss = streakState(ctx.streak);
        // Runner-Rang nach Gesamtstaerke: toNext ist schon in Gesamtstaerke (kein Umrechnen)
        var next = r && r.next
          ? 'noch ' + U.fmt(Math.max(1, Math.ceil(num(r.toNext)))) + ' Gesamtstärke bis ' + r.next.name
          : 'Höchster Rang erreicht';

        if (variant === 'hud') {
          // Zeile 1: Name + Rang · Zeile 2: Gesamtstaerke + Streak (Zahlen schrumpfen nie)
          var streak = h('span', { class: 'map-player__streak ' + ss.cls, title: ss.label },
            h('span', { class: 'map-player__flame', html: icon('streak') }), h('span', { class: 'num', text: U.fmt(ss.cur) }));
          el.appendChild(avatarEl());
          el.appendChild(h('span', { class: 'map-player__info' },
            h('span', { class: 'map-player__line' }, h('span', { class: 'map-player__name', text: ctx.name }), rankNode),
            h('span', { class: 'map-player__line map-player__line--stats' }, strength, streak)));
          el.appendChild(bar);
          fitCard(el);
        } else {
          var k = ctx.kcal;
          el.appendChild(h('span', { class: 'map-player__top' }, avatarEl(),
            h('span', { class: 'map-player__info' },
              h('span', { class: 'map-player__name', text: ctx.name }),
              rankNode)));
          el.appendChild(h('span', { class: 'map-player__next' }, bar, h('span', { class: 'map-player__next-txt', text: next })));
          // Zwei kleine Kacheln: Gesamtstaerke und (falls Ziel gesetzt) Kalorienschulden
          var tiles = h('span', { class: 'map-player__tiles' },
            h('span', { class: 'map-player__tile', title: 'Gesamtstärke' },
              h('span', { class: 'map-player__tv num', text: U.fmt(ctx.strength) }),
              h('span', { class: 'map-player__tl', html: icon('staerke') + '<span>Stärke</span>' })));
          if (k && k.hasGoal) {
            tiles.appendChild(h('span', { class: 'map-player__tile map-player__tile--kcal', title: 'Kalorienschulden' },
              h('span', { class: 'map-player__tv num', text: k.done ? '0' : U.fmt(k.remaining) }),
              h('span', { class: 'map-player__tl', html: icon('kcal') + '<span>' + (k.done ? 'Bezahlt!' : 'kcal') + '</span>' })));
          }
          el.appendChild(tiles);
          fitNums(tiles);
        }
        el.setAttribute('aria-label', 'Profil öffnen: ' + ctx.name +
          (r && r.rank ? ', Rang ' + r.rank.name + (r.next ? ', ' + next : '') : '') + ', Gesamtstärke ' + U.fmt(ctx.strength) +
          (variant === 'hud' ? '. ' + ss.label : ''));
        el.title = r && r.rank ? 'Rang ' + r.rank.name + ' · ' + next : 'Profil';
      }
    };
  }

  /* ================= Zirkus-Sperre: Streifen oben ================= */

  /** Zirkus-Streifen oben, zwei Zustaende (OP.game.lockInfo):
        gesperrt (locked)       Schloss, Grund (OP.data.LOCK_TEXT) und "Zum Zirkus"
        morgen gesperrt (warn)  Warnzeichen, "Morgen gesperrt: …" und "Zum Zirkus" – ruhiger, ohne Warnstreifen
      Handy: eigene Zeile unter Spieler-Karte/Quests (Karte rutscht darunter).
      Querformat: in der HUD-Zeile, wenn genug Platz ist. Breit: oben mittig neben den Tages-Quests.
      Gesperrten Ort angetippt: Auf der Karte zeigt der Router keinen eigenen Hinweis, sondern meldet
      'lock-flash' -> flash(): der Streifen leuchtet auf und der Grund wird vorgelesen. */
  function LockStrip() {
    var ico = h('span', { class: 'map-lock__icon', 'aria-hidden': 'true' });
    var kicker = h('b', { class: 'map-lock__kicker' });
    var rest = h('span', { class: 'map-lock__rest' });
    var detail = h('span', { class: 'map-lock__detail' });
    var btn = h('button', { type: 'button', class: 'btn btn--gold map-lock__btn', onclick: function () { navigate('taverne/zirkus'); } },
      h('span', { class: 'map-lock__btn-ico', html: icon('zirkus') }), h('span', { text: 'Zum Zirkus' }));
    var el = h('div', { class: 'map-lock', role: 'status', hidden: true },
      ico,
      h('span', { class: 'map-lock__body' }, h('span', { class: 'map-lock__text' }, kicker, rest), detail),
      btn);
    // Ansage beim Aufleuchten: ersetzt fuer Screenreader den Router-Hinweis (role=alert), der hier fehlt
    var say = h('span', { class: 'sr-only', role: 'alert' });
    var mode = '', flashTimer = null, sayTimer = null;

    /** "Gesperrt: Erledige zuerst …" -> "Gesperrt:" hervorheben, Rest normal */
    function setMain(t) {
      var i = t.indexOf(':'), cut = i > 0 && i < 20;
      setText(kicker, cut ? t.slice(0, i + 1) : '');
      setText(rest, cut ? t.slice(i + 1).replace(/^\s+/, '') : t);
    }

    return {
      el: el, say: say,
      /** was der Streifen gerade zeigt: 'lock' | 'warn' | '' (nichts) */
      mode: function () { return mode; },
      update: function (ctx) {
        var li = ctx.lock, ready = !!(li && ctx.s && ctx.s.setupDone);
        var m = ready && li.locked ? 'lock' : (ready && li.warn ? 'warn' : '');
        if (m === 'lock') {
          setMain(lockText(li));
          var days = Math.max(0, Math.floor(num(li.days)));
          setText(detail, (days >= 2 ? 'Seit ' + days + ' Tagen kein Zirkus-Eintrag. ' : '') +
            LOCK_AREAS_TEXT + ' sind zu. Ein Eintrag im Zirkus reicht zum Entsperren.');
        } else if (m === 'warn') {
          setMain(WARN_TEXT);
          setText(detail, 'Ohne Zirkus-Eintrag heute sind ab morgen ' + LOCK_AREAS_TEXT + ' zu. ' +
            'Ein Eintrag reicht – das Ziel musst du nicht schaffen.');
        }
        if (m !== mode) {
          if (m) ico.innerHTML = icon(m === 'lock' ? 'lock' : 'warning');
          el.classList.toggle('map-lock--warn', m === 'warn');
          if (m !== 'lock') el.classList.remove('is-flash');
          mode = m;
        }
        el.hidden = !m;
      },
      /** kurz aufleuchten (gesperrten Ort angetippt, App-Start mit Sperre) und den Grund ansagen.
          silent: nicht ansagen (der Router-Hinweis im Bildschirm wurde schon vorgelesen) */
      flash: function (msg, silent) {
        if (el.hidden) return;
        el.classList.remove('is-flash');
        void el.offsetWidth;   // Lichtring (::after) neu starten
        el.classList.add('is-flash');
        clearTimeout(flashTimer);
        flashTimer = setTimeout(function () { el.classList.remove('is-flash'); }, 5000);   // 5 Sekunden, dann ausblenden
        // kurzes Wackeln – per Web Animations, damit die CSS-Animation des Streifens (mapLockIn) unberuehrt bleibt
        if (el.animate && !reducedMotion()) {
          safe(function () {
            el.animate([{ transform: 'none' }, { transform: 'translateX(-4px)' }, { transform: 'translateX(4px)' },
              { transform: 'translateX(-2px)' }, { transform: 'translateX(1px)' }, { transform: 'none' }], { duration: 520, easing: 'ease-out' });
          });
        }
        if (silent) return;
        // erst leeren, dann setzen: derselbe Text wird sonst nicht noch einmal vorgelesen
        say.textContent = '';
        clearTimeout(sayTimer);
        sayTimer = setTimeout(function () {
          say.textContent = msg || (kicker.textContent + ' ' + rest.textContent).trim();
          sayTimer = setTimeout(function () { say.textContent = ''; }, 5000);
        }, 80);
      }
    };
  }

  /** Unterkante des Streifens relativ zur Karten-Buehne – aus dem Layout (offsetTop), also ohne transform:
      Der Streifen rutscht beim Erscheinen 8 px von oben herein (mapLockIn) und wackelt beim Aufleuchten.
      getBoundingClientRect() lieferte mitten in der Animation eine zu hohe Kante (Karte 8 px zu weit oben). */
  function lockBottom() {
    var el = lockStrip.el, y = el.offsetHeight;
    while (el && el !== stage) { y += el.offsetTop; el = el.offsetParent; }
    return y;
  }

  /** Streifen platzieren und die Karte darunter rutschen lassen (Handy/breit), damit er nichts verdeckt.
      Setzt --map-top (Oberkante der Karte) und --map-qdrop (Quest-Liste unter dem Streifen).
      -> true, wenn sich --map-top geaendert hat */
  var lastMapTop = null;
  function placeLock() {
    if (!lockStrip || !hudTop || !stage) return false;
    var on = !lockStrip.el.hidden;
    hudTop.classList.toggle('has-lock', on);
    var inline = false;
    if (on && isLand() && !isWide()) {
      // Querformat: passt der Streifen in die HUD-Zeile zwischen Spieler-Karte und Hilfe?
      // (nicht hoeher als die Spieler-Karte, sonst verdeckt er oben die Arena)
      hudTop.classList.add('is-lock-inline');
      var lr0 = lockStrip.el.getBoundingClientRect();
      var cr = hudCard && hudCard.el.offsetWidth ? hudCard.el.getBoundingClientRect() : null;
      inline = lr0.width >= 240 && lr0.height <= Math.max(62, cr ? cr.height + 2 : 0);
    }
    if (!inline) hudTop.classList.remove('is-lock-inline');
    var shift = on && !inline;
    stage.classList.toggle('has-lock', shift);
    var top = null, qdrop = null;
    if (shift) {
      var lb = lockBottom();
      // Handy hochkant: Karte beginnt knapp ueber der Unterkante des Streifens (weicher dunkler Uebergang wie beim HUD).
      // Breit und Querformat: ganz darunter – oben im Bild liegen Abenteuer-Portal und Arena direkt am Rand.
      top = Math.max(0, Math.round(lb + (isWide() ? 10 : (isLand() ? 4 : -22))));
      // Quest-Liste (Handy) beginnt unter dem Streifen; beide liegen in der HUD-Zeile
      if (questBoard) qdrop = Math.max(0, Math.round(lockStrip.el.offsetTop + lockStrip.el.offsetHeight - questBoard.el.offsetTop + 8));
    }
    if (qdrop == null) stage.style.removeProperty('--map-qdrop'); else stage.style.setProperty('--map-qdrop', qdrop + 'px');
    if (top === lastMapTop) return false;
    lastMapTop = top;
    if (top == null) stage.style.removeProperty('--map-top'); else stage.style.setProperty('--map-top', top + 'px');
    return true;
  }

  /* ================= Tages-Quests (rechts oben) ================= */

  /* Auf- oder zugeklappt: im Spielstand gemerkt (bleibt nach App-Neustart).
     Standard = offen (Spec: Tages-Quests immer rechts oben, dort abhakbar).
     Ausnahme Querformat-Handy (wenig Hoehe): die offene Liste wuerde Zauberbude und Arena verdecken.
     Dort startet sie immer zugeklappt (nur die Pille); Antippen klappt sie fuer diese Sitzung auf,
     der gemerkte Wert fuer Hochformat/PC bleibt dabei unveraendert. */
  var PHONE_MAX = 3;   // Handy: so viele offene Quests direkt auf der Karte, Rest ueber "+N weitere"

  function questsCollapsed() {
    if (isLand()) return !landQuestsOpen;
    return !!(OP.state && OP.state.settings && OP.state.settings.questsCollapsed);
  }
  function setQuestsCollapsed(c) {
    if (questBoard) questBoard.showAll(false);
    if (isLand()) { landQuestsOpen = !c; renderQuests(); return; }
    // speichert -> 'change' -> neu zeichnen
    var ok = safe(function () { OP.game.setSetting('questsCollapsed', !!c); return true; }, false);
    if (!ok || !visible) renderQuests();
  }

  function QuestBoard() {
    var showAll = false;        // Handy: alle Quests zeigen (bis zum Zuklappen)
    var recent = null;          // Handy: frisch abgehakte Quest bleibt kurz (durchgestrichen) stehen
    var recentTimer = null;

    var ring = h('span', { class: 'map-quests__ring', 'aria-hidden': 'true' }, h('span', { class: 'map-quests__ring-ico', html: icon('quest') }));
    var count = h('span', { class: 'map-quests__count num' });
    var head = h('button', { type: 'button', class: 'map-quests__head', 'aria-controls': 'map-quests-body',
      onclick: function () { OP.ui.haptic(6); setQuestsCollapsed(!questsCollapsed()); } },
      ring,
      h('span', { class: 'map-quests__title', text: 'Tages-Quests' }),
      count,
      h('span', { class: 'map-quests__chev', 'aria-hidden': 'true', html: icon('down') }));
    var list = h('ul', { class: 'map-quests__list' });
    var status = h('span', { class: 'map-quests__status' });
    var moreTxt = h('span');
    var moreIco = h('span', { class: 'map-quests__more-ico', html: icon('down') });
    var more = h('button', { type: 'button', class: 'map-quests__more', hidden: true,
      onclick: function () { OP.ui.haptic(6); showAll = !showAll; renderQuests(); } }, moreTxt, moreIco);
    // "Verwalten": breit mit Text, auf dem Handy nur als Stift-Icon (schmale Liste)
    var foot = h('div', { class: 'map-quests__foot' }, status, more,
      h('button', { type: 'button', class: 'map-quests__manage', 'aria-label': 'Quests verwalten', title: 'Quests verwalten',
        onclick: function () { navigate('haus/quests'); } },
        h('span', { class: 'map-quests__manage-txt', text: 'Verwalten' }),
        h('span', { class: 'map-quests__manage-next', html: icon('next') }),
        h('span', { class: 'map-quests__manage-edit', html: icon('edit') })));
    var body = h('div', { class: 'map-quests__body', id: 'map-quests-body' }, list, foot);
    var el = h('section', { class: 'map-quests', 'aria-label': 'Tages-Quests' }, head, body);

    // Austauschbar wie die anderen Knoepfe: assets/sprites/quests.png = Hintergrund/Rahmen der Tafel
    probe(CFG.questsSprite || 'assets/sprites/quests.png', function (url) {
      // absolute Adresse: ein relativer Pfad in einer CSS-Variable wuerde sonst ab css/ gesucht
      var abs = safe(function () { return new URL(url, document.baseURI).href; }, url);
      el.style.setProperty('--qs-sprite', 'url("' + String(abs).replace(/"/g, '%22') + '")');
      el.classList.add('has-sprite');
    });

    function row(item) {
      var q = item.quest || {}, cat = item.cat || {};
      var title = String(q.title || 'Quest');
      var li = h('li', {
        class: 'map-quest' + (item.done ? ' is-done' : '') + (justChecked && justChecked === q.id ? ' is-fresh' : ''),
        style: { '--cat': cat.color || '#8aa0ad' }
      });
      var check = h('span', { class: 'check' + (item.done ? ' is-on' : ''), html: icon('check') });
      var btn = h('button', {
        type: 'button', class: 'map-quest__btn',
        'aria-label': (item.done ? 'Erledigt: ' : 'Abhaken: ') + title,
        'aria-pressed': item.done ? 'true' : 'false'
      },
        check,
        h('span', { class: 'map-quest__title', text: title }),   // Nutzertext -> nur als Text
        h('span', { class: 'map-quest__cat', title: cat.name || '', html: icon(cat.icon || 'dots') }));
      btn.addEventListener('click', function () { onQuestTap(item, li, check); });
      li.appendChild(btn);
      return li;
    }

    function onQuestTap(item, li, check) {
      if (item.done) {
        OP.ui.haptic(8);
        OP.ui.toast('Zurücknehmen geht nur im Haus.', { type: 'info', icon: 'haus' });
        return;
      }
      if (li.classList.contains('is-checking')) return;
      li.classList.add('is-checking');
      check.classList.add('is-on');
      OP.ui.haptic([10, 40, 18]);
      setTimeout(function () {
        var id = item.quest.id;
        justChecked = id;
        if (!isWide()) setRecent(id);   // vor dem Speichern: Zeile bleibt beim Neuzeichnen stehen
        var r = safe(function () { return OP.game.questCheck(id); }, null);   // speichert -> 'change' -> neu zeichnen
        justChecked = null;
        if (!r || r.ok === false) {
          setRecent(null);
          li.classList.remove('is-checking');
          check.classList.remove('is-on');
          OP.ui.toast('Das hat nicht geklappt. Gibt es die Quest noch?', { type: 'warn' });
          return;
        }
        var all = safe(function () { return OP.game.questsToday(); }, []) || [];
        if (!r.already && all.length && all.every(function (x) { return x.done; })) {
          OP.ui.toast('Alle Tages-Quests erledigt. Stark!', { type: 'ok', icon: 'trophy' });
        }
      }, 240);
    }

    /** Frisch abgehakte Quest auf dem Handy noch ~2 s zeigen, dann rueckt die naechste nach */
    function setRecent(id) {
      clearTimeout(recentTimer);
      recent = id;
      if (id) recentTimer = setTimeout(function () { recent = null; renderQuests(); }, 2000);
    }

    return {
      el: el,
      body: body,
      showAll: function (on) { showAll = !!on; },
      update: function (ctx) {
        var items = ctx.quests || [];
        var total = items.length, done = items.filter(function (x) { return x.done; }).length;
        var open = total - done;
        var collapsed = questsCollapsed();
        var wide = isWide();
        el.classList.toggle('is-collapsed', collapsed);
        el.classList.toggle('is-all', total > 0 && done === total);
        el.classList.toggle('is-empty', total === 0);
        el.classList.toggle('is-showall', !wide && showAll);
        head.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
        head.setAttribute('aria-label', 'Tages-Quests: ' + (total ? done + ' von ' + total + ' erledigt' : 'noch keine') + (collapsed ? '. Aufklappen' : '. Zuklappen'));
        count.textContent = total ? done + '/' + total : 'Neu';
        ring.style.setProperty('--p', (total ? Math.round(done / total * 100) : 0) + '%');

        // Handy (kompakt): nur die ersten offenen Quests, Rest ueber "+N weitere"
        var shown = items;
        if (!wide && !showAll) {
          shown = items.filter(function (it) { return !it.done || (recent && it.quest && it.quest.id === recent); }).slice(0, PHONE_MAX);
        }
        var hidden = total - shown.length;

        // Liste neu aufbauen (Scroll-Position behalten)
        var st = list.scrollTop;
        list.innerHTML = '';
        if (!total) {
          list.appendChild(h('li', { class: 'map-quests__empty' },
            h('span', { class: 'map-quests__empty-txt', text: 'Noch keine Quests' }),
            h('button', { type: 'button', class: 'btn btn--primary btn--sm', onclick: function () { navigate('haus/quests'); } },
              h('span', { html: icon('plus') }), 'Quests anlegen')));
        } else if (!shown.length) {
          list.appendChild(h('li', { class: 'map-quests__alldone' },
            h('span', { class: 'map-quests__alldone-ico', html: icon('trophy') }),
            h('span', { text: 'Alles erledigt!' })));
        } else {
          shown.forEach(function (it) { list.appendChild(row(it)); });
        }
        list.scrollTop = st;

        // Fuss: Status bzw. "+N weitere" / "Weniger" (nur Handy)
        var openShown = shown.filter(function (it) { return !it.done; }).length;
        var canMore = !wide && (showAll ? (done > 0 || open > PHONE_MAX) : hidden > 0);
        more.hidden = !canMore;
        if (canMore) {
          moreTxt.textContent = showAll ? 'Weniger' : '+' + hidden + (open > openShown ? ' weitere' : ' erledigt');
          more.setAttribute('aria-expanded', showAll ? 'true' : 'false');
          more.setAttribute('aria-label', showAll ? 'Weniger Quests zeigen' : 'Alle ' + total + ' Quests zeigen');
          moreIco.classList.toggle('is-up', showAll);
        }
        status.hidden = canMore;
        status.textContent = !total ? '' : (done === total ? 'Alles erledigt!' : 'Noch ' + open + ' offen');
        foot.hidden = !total;
      }
    };
  }

  /* ================= Banner fuer laufende Aktionen ================= */

  function Banners() {
    var el = h('div', { class: 'map-banners' });   // kein aria-live: der Countdown wuerde sonst jede Sekunde vorgelesen
    var items = {};   // id -> {el, text, sub, tone}

    function make() {
      var ico = h('span', { class: 'map-banner__ico' });
      var text = h('span', { class: 'map-banner__text' });
      var short = h('span', { class: 'map-banner__short num' });   // Kurzform fuer wenig Platz (Querformat)
      var sub = h('span', { class: 'map-banner__sub num' });
      // Klick-Ziel wird in update() gesetzt (nur ein Handler, sonst wuerde doppelt navigiert)
      var b = h('button', { type: 'button', class: 'map-banner' },
        ico,
        h('span', { class: 'map-banner__body' }, text, short, sub),
        h('span', { class: 'map-banner__go', html: icon('next') }));
      return { el: b, ico: ico, icoName: '', cls: '', text: text, short: short, sub: sub };
    }

    function list(ctx) {
      var out = [];
      // Werte immer aus fightStatus()/gymStatus() (HP/Ziel koennen hoeher sein als beim Start)
      var f = ctx.fight;
      if (f) {
        var eName = (f.enemy && f.enemy.name) || 'Gegner';
        var fg = (f.group && f.group.name) || '';
        out.push(f.defeated
          ? { id: 'fight', tone: 'lime', icon: 'trophy', route: 'kampf', text: 'Gegner besiegt – Sieg abholen', short: 'Sieg!',
              sub: (fg ? fg + ' – ' : '') + eName + ' · beenden, damit es zählt' }
          : { id: 'fight', tone: 'red', icon: 'swords', route: 'kampf', text: 'Kampf läuft: ' + (fg ? fg + ' – ' : '') + eName, short: fg ? 'Kampf: ' + fg : 'Kampf',
              sub: 'noch ' + U.fmt(f.hpLeft) + ' HP' });
      }
      var g = ctx.gym;
      if (g) {
        var gName = (g.group && g.group.name) || 'Training';
        var parts = g.parts || [], n = parts.length, got = Math.max(0, Math.floor(num(g.reachedCount)));
        // Push/Pull: "Training läuft: Pull · 1/2 Ziele". Beine (ein Muskel): fehlende XP in der Zusatzzeile.
        var open = null;
        parts.forEach(function (p) { if (!p.reached && !open) open = p; });
        out.push(g.reached
          ? { id: 'gym', tone: 'lime', icon: 'gym', route: 'haus/gym', text: (n > 1 ? 'Alle Ziele' : 'Ziel') + ' erreicht – Training beenden', short: 'Beenden',
              sub: gName + ' · jetzt beenden, damit es zählt' }
          : { id: 'gym', tone: 'cyan', icon: 'gym', route: 'haus/gym',
              text: 'Training läuft: ' + gName + (n > 1 ? ' · ' + got + '/' + n + ' Ziele' : ''), short: gName + (n > 1 ? ' ' + got + '/' + n : ''),
              sub: open ? (n > 1 && open.muscle ? open.muscle.name + ': ' : '') + 'noch ' + U.fmt(open.left) + ' XP bis zum Ziel' : '' });
      }
      var run = ctx.run && ctx.run.active;
      if (run) {
        var rd = (OP.data && OP.data.run && OP.data.run(run.kind)) || { name: 'Lauf' };
        var rs = ctx.run[run.kind] || {};
        var goal = run.kind === 'steady' ? num(rs.target) : num(rs.goal);
        var goalTxt = goal > 0 ? 'Ziel ' + minutes(goal) : 'Erster Lauf: setzt dein Ziel';
        if (num(run.minutes) > RUN_MAX_MIN) {
          // vergessen: ueber 24 Std. traegt runStop nichts mehr ein (tooLong) – im Gym verwerfen oder von Hand eintragen
          out.push({ id: 'run', tone: 'amber', icon: 'warning', route: 'haus/gym', text: rd.name + ': über 24 Std. – vergessen?', short: 'Vergessen?',
            sub: 'Im Gym verwerfen oder von Hand eintragen' });
        } else {
          out.push(run.running
            ? { id: 'run', tone: 'cyan', icon: 'run', route: 'haus/gym', text: rd.name + ' läuft · ' + stopwatch(run.elapsedMs), short: stopwatch(run.elapsedMs),
                sub: goalTxt + (num(run.segments) > 1 ? ' · Etappe ' + run.segments : '') }
            : { id: 'run', tone: 'amber', icon: 'pause', route: 'haus/gym', text: rd.name + ' · Pause · ' + minutes(run.minutes), short: 'Pause',
                sub: 'Gehen zählt nicht · ' + goalTxt });
        }
      }
      var c = ctx.cardio;
      if (c) {
        var name = (c.def && c.def.name) || (c.active && c.active.text) || 'Lieferung';
        out.push(c.expired
          ? { id: 'cardio', tone: 'red', icon: 'schmuggler', route: 'taverne/schmuggler', text: 'Zeit abgelaufen – Ergebnis eintragen', short: 'Zeit um!', sub: name }
          : { id: 'cardio', tone: 'amber', icon: 'schmuggler', route: 'taverne/schmuggler', text: 'Schmuggler: ' + clock(c.msLeft) + ' übrig', short: clock(c.msLeft), sub: name });
      }
      var d = ctx.dance;
      if (d && d.active) {
        var next = d.next && d.next.ex ? d.next.ex.name : '';
        out.push({ id: 'dance', tone: 'gold', icon: 'zirkus', route: 'taverne/zirkus',
          text: 'Zirkus-Tanz läuft · ' + num(d.doneCount) + '/' + num(d.total, 5), short: 'Tanz ' + num(d.doneCount) + '/' + num(d.total, 5),
          sub: next ? 'Als Nächstes: ' + next : 'Tanz abschließen' });
      }
      return out;
    }

    return {
      el: el,
      update: function (ctx) {
        var want = list(ctx), keep = {};
        want.forEach(function (it, i) {
          var e = items[it.id];
          if (!e) { e = items[it.id] = make(); }
          var cls = 'map-banner ' + toneClass(it.tone);
          if (e.cls !== cls) { e.el.className = cls; e.cls = cls; }
          e.el.onclick = function () { navigate(it.route); };
          if (e.icoName !== it.icon) { e.ico.innerHTML = icon(it.icon); e.icoName = it.icon; }
          setAttr(e.el, 'aria-label', it.text + (it.sub ? ' – ' + it.sub : ''));
          setText(e.text, it.text);
          setText(e.short, it.short || it.text);
          setText(e.sub, it.sub || '');
          if (el.children[i] !== e.el) el.insertBefore(e.el, el.children[i] || null);
          keep[it.id] = 1;
        });
        Object.keys(items).forEach(function (id) {
          if (!keep[id]) { if (items[id].el.parentNode) items[id].el.parentNode.removeChild(items[id].el); delete items[id]; }
        });
        el.hidden = !want.length;
        el.classList.toggle('is-multi', want.length > 1);   // mehrere: kompakter (ohne Zusatzzeile)
      }
    };
  }

  /* ================= Hauptmenue ================= */

  function currentPath() {
    var c = OP.ui && OP.ui.router && OP.ui.router.current ? OP.ui.router.current() : null;
    return c ? String(c.path || '') : '';
  }

  function onNavClick(route) {
    // Auf breiten Bildschirmen bleibt die Seitenleiste sichtbar: erneutes Tippen schliesst den Bildschirm
    if (visible === false && currentPath() === route) { navigate(''); return; }
    navigate(route);
  }

  function buildNav() {
    nav = h('nav', { class: 'map-nav', 'aria-label': 'Hauptmenü' });
    var side = PlayerCard('side');
    playerCards.push(side);
    nav.appendChild(h('div', { class: 'map-nav__head' },
      h('div', { class: 'map-nav__brand', 'aria-hidden': 'true' }, h('span', { text: 'OPERATOR' }), h('small', { text: 'Labs Runner' })),
      side.el));

    var listEl = h('div', { class: 'map-nav__list' });
    (Array.isArray(CFG.nav) && CFG.nav.length ? CFG.nav : FALLBACK_NAV).forEach(function (n) {
      // Abzeichen sitzt an der Ecke des Icons (verdeckt so nie die Beschriftung)
      var badge = h('span', { class: 'map-nav__badge', hidden: true, 'aria-hidden': 'true' });
      var b = h('button', {
        type: 'button', class: 'map-nav__btn ' + toneClass(n.tone), 'aria-label': n.label, title: n.label,
        dataset: { route: n.route, id: n.id },
        onclick: function () { onNavClick(n.route); }
      },
        h('span', { class: 'map-nav__ico', html: icon(n.icon) }, badge),
        h('span', { class: 'map-nav__lbl', text: n.label }),
        h('span', { class: 'map-nav__short', text: n.short || n.label }));
      navBtns.push({ el: b, route: n.route, id: n.id, label: n.label, badge: badge, cfg: n, key: '' });
      listEl.appendChild(b);
    });
    nav.appendChild(listEl);

    var small = h('div', { class: 'map-nav__small' });
    (Array.isArray(CFG.navSmall) ? CFG.navSmall : FALLBACK_NAV_SMALL).forEach(function (n) {
      var b = h('button', { type: 'button', class: 'map-nav__mini', 'aria-label': n.label, title: n.label,
        dataset: { route: n.route }, onclick: function () { onNavClick(n.route); }, html: icon(n.icon) });
      navBtns.push({ el: b, route: n.route, id: n.id, small: true });
      small.appendChild(b);
    });
    small.appendChild(h('span', { class: 'map-nav__ver', text: 'v' + ((OP.data && OP.data.VERSION) || '1') }));
    nav.appendChild(small);
    document.body.appendChild(nav);
  }

  /** Markiert den Menuepunkt des offenen Bildschirms */
  function setActiveNav(path) {
    path = String(path || '');
    var first = path.split('/')[0];
    var target = null;
    if (first === 'kampf') {
      var f = OP.state && OP.state.fight;
      target = f && f.pool === 'arena' ? 'arena' : 'taverne/abenteuer';
    } else if (path) {
      navBtns.forEach(function (b) { if (!b.small && b.route === path) target = path; });
      if (!target) navBtns.forEach(function (b) { if (!b.small && b.route === first) target = first; });
      if (!target && first === 'hilfe') target = 'hilfe';
    }
    navBtns.forEach(function (b) {
      var on = !!target && b.route === target && !(b.small && b.route !== 'hilfe');
      b.el.classList.toggle('is-active', on);
      if (on) b.el.setAttribute('aria-current', 'page'); else b.el.removeAttribute('aria-current');
    });
  }

  /** Abzeichen und Zirkus-Sperre im Menue */
  function updateNavBadges(ctx) {
    // Waehrend der Ersteinrichtung fuehrt der Router sowieso zurueck zu #/setup -> Menue gesperrt zeigen
    if (nav) nav.classList.toggle('is-locked', !(ctx.s && ctx.s.setupDone));
    navBtns.forEach(function (b) {
      if (!b.badge) return;
      var bl = blockedInfo(b.route), locked = !!bl;
      b.el.classList.toggle('map-nav__btn--locked', locked);
      setAttr(b.el, 'aria-disabled', locked ? 'true' : null);
      var bd = null;
      if (!locked) {
        var def = hsById[b.id] && hsById[b.id].def;
        bd = def && typeof def.badge === 'function' ? safe(function () { return def.badge(ctx.s, OP.game); }, null) : null;
        if (!bd && b.cfg && typeof b.cfg.badge === 'function') bd = safe(function () { return b.cfg.badge(ctx.s, OP.game); }, null);
      }
      var key = locked ? 'lock' : (bd ? (bd.dot ? 'dot' : 'txt') + '|' + (bd.tone || 'red') + '|' + (bd.dot ? '' : String(bd.text || '!')) : '');
      if (key !== b.key) {
        b.key = key;
        b.badge.hidden = !key;
        if (locked) {
          b.badge.className = 'map-nav__badge map-nav__badge--lock';
          b.badge.innerHTML = icon('lock');
        } else if (bd) {
          b.badge.className = 'map-nav__badge ' + toneClass(bd.tone || 'red') + (bd.dot ? ' map-nav__badge--dot' : '');
          b.badge.textContent = bd.dot ? '' : String(bd.text || '!');
        }
      }
      var label = locked ? lockedLabel(b.label, bl) : b.label + (bd && bd.title ? ' – ' + bd.title : '');
      setAttr(b.el, 'aria-label', label);
      b.el.title = locked ? b.label + ' – gesperrt' : label;
    });
  }

  /* ================= Karte: Groesse, Scrollen, Ziehen ================= */

  function startFrac() {
    var saved = safe(function () { return JSON.parse(sGet('op.map.scroll') || 'null'); }, null);
    if (saved && isFinite(saved.x) && isFinite(saved.y)) return saved;
    var def = hsById[WORLD.startAt] && hsById[WORLD.startAt].def;
    var f = def ? { x: num(def.x) / 100, y: num(def.y) / 100 } : { x: 0.5, y: 0.5 };
    // Breite Bildschirme: rechts buendig, damit die Tages-Quests genau ueber dem freien Bereich
    // rechts oben liegen (dort war im Bild die gemalte Quest-Tafel). Senkrecht: Mitte zwischen
    // oberstem und unterstem Hotspot, damit oben die Arena und unten die Figur sichtbar bleiben.
    if (isWide()) {
      f.x = 1;
      var ratio = num(WORLD.width, 1345) / num(WORLD.height, 941), lo = 100, hi = 0;
      hotspots.forEach(function (hs) {
        var d = hs.def, half = (d.h ? num(d.h) : num(d.w) * ratio) / 2;
        lo = Math.min(lo, num(d.y) - half);
        hi = Math.max(hi, num(d.y) + half);
      });
      if (hi > lo) f.y = (lo + hi) / 200;
    } else {
      f.x = keepClearOfQuests(f);
      f.y = keepBelowHud(f);
    }
    return f;
  }

  /** Querformat-Handy (Karte scrollt nur senkrecht): um das Start-Gebaeude zentriert laege die Nadel
      aus WORLD.keepClear (Arena, ganz oben im Bild) unter dem HUD-Streifen. Ausschnitt so weit nach
      oben schieben, dass sie ganz sichtbar ist – das Start-Gebaeude bleibt dabei sichtbar. -> neuer f.y */
  function keepBelowHud(f) {
    var W = worldSize.w, H = worldSize.h, vh = view.clientHeight;
    var keep = hsById[WORLD.keepClear || 'arena'], start = hsById[WORLD.startAt];
    if (!H || !vh || !keep || !view.classList.contains('is-pan-y')) return f.y;
    // Hoehe eines Hotspots in px und Anteil ueber dem Ankerpunkt (Pin: Anker = Mitte des Nadelkopfs)
    var size = function (d) { return d.kind === 'pin' || !d.h ? num(d.w) / 100 * W * 1.3 : num(d.h) / 100 * H; };
    var above = function (d) { return d.kind === 'pin' ? 0.385 : 0.5; };
    var scrollY = f.y * H - vh / 2;
    // 8 px Luft zum Rand; steht der Sperr-Streifen in der HUD-Zeile, auch unter ihm
    var top = num(keep.def.y) / 100 * H - size(keep.def) * above(keep.def) - 8 - lockClearance();
    if (scrollY <= top) return f.y;
    var sy = Math.max(0, top);
    if (start) sy = Math.max(sy, num(start.def.y) / 100 * H + size(start.def) * (1 - above(start.def)) + 8 - vh);
    return Math.min(f.y, (sy + vh / 2) / H);
  }

  /** Wie weit ragt der Sperr-Streifen in die Karte hinein? (px, 0 = gar nicht) */
  function lockClearance() {
    if (!lockStrip || lockStrip.el.hidden) return 0;
    return Math.max(0, lockBottom() - view.offsetTop);
  }

  /** Handy mit offenen Tages-Quests: Ausschnitt so weit schieben, dass die Nadel aus
      WORLD.keepClear (Standard: Arena) links neben der Quest-Liste frei bleibt.
      Das Start-Gebaeude (WORLD.startAt) bleibt dabei immer sichtbar. -> neuer f.x */
  function keepClearOfQuests(f) {
    var W = worldSize.w, H = worldSize.h, vw = view.clientWidth, vh = view.clientHeight;
    var keep = hsById[WORLD.keepClear || 'arena'], start = hsById[WORLD.startAt];
    if (!W || !vw || !keep || !questBoard || questsCollapsed() || !view.classList.contains('is-pan-x')) return f.x;
    var br = questBoard.body.getBoundingClientRect(), vr = view.getBoundingClientRect();
    if (!br.width || !br.height) return f.x;
    var d = keep.def, pinW = num(d.w) / 100 * W, pinH = d.kind === 'pin' || !d.h ? pinW * 1.3 : num(d.h) / 100 * H;
    var scrollX = f.x * W - vw / 2;
    var scrollY = Math.max(0, Math.min(H - vh, f.y * H - vh / 2));
    // Liegt die Nadel senkrecht ueberhaupt im Bereich der Liste?
    var top = num(d.y) / 100 * H - pinH * (d.kind === 'pin' ? 0.385 : 0.5) - scrollY + vr.top;
    if (top > br.bottom || top + pinH < br.top) return f.x;
    var need = (num(d.x) / 100 * W + pinW / 2 + 8) - (br.left - vr.left);   // rechte Nadelkante links der Liste
    if (scrollX >= need) return f.x;
    var limit = start ? (num(start.def.x) - num(start.def.w) / 2) / 100 * W - 12 : need;
    var sx = Math.max(scrollX, Math.min(need, limit));
    return (sx + vw / 2) / W;
  }

  /* Nur merken, wenn der Nutzer die Karte selbst bewegt hat. Sonst wird der Start-Ausschnitt bei jeder
     Groessenaenderung neu berechnet (z. B. wenn der Sperr-Streifen nach dem Laden der Schrift niedriger wird). */
  var userMoved = false;
  function markUserMove() { userMoved = true; }

  function saveScroll() {
    if (!userMoved || !worldSize.w || !view.clientWidth) return;
    scrollFrac = {
      x: (view.scrollLeft + view.clientWidth / 2) / worldSize.w,
      y: (view.scrollTop + view.clientHeight / 2) / worldSize.h
    };
    sSet('op.map.scroll', JSON.stringify({ x: +scrollFrac.x.toFixed(4), y: +scrollFrac.y.toFixed(4) }));
  }
  var saveScrollSoon = U.debounce(saveScroll, 150);

  function restoreScroll() {
    var f = scrollFrac || startFrac();
    view.scrollLeft = Math.round(f.x * worldSize.w - view.clientWidth / 2);
    view.scrollTop = Math.round(f.y * worldSize.h - view.clientHeight / 2);
  }

  /** Karte so gross machen, dass sie den Bereich ganz fuellt ("cover"); was uebersteht, ist scrollbar */
  function layout() {
    placeLock();                                         // Sperr-Streifen zuerst: er bestimmt die Oberkante der Karte
    var vw = view.clientWidth, vh = view.clientHeight;
    if (!vw || !vh) return;
    var W = num(WORLD.width, 1345), H = num(WORLD.height, 941), ww, wh;
    if (vw / vh > W / H) { ww = vw; wh = Math.round(vw * H / W); }
    else { wh = vh; ww = Math.round(vh * W / H); }
    view.classList.toggle('is-pan-x', ww > vw + 1);
    view.classList.toggle('is-pan-y', wh > vh + 1);
    fitCards();                                          // Spieler-Karte an neue Breite anpassen
    if (ww === worldSize.w && wh === worldSize.h) { fitPlates(); return; }   // z. B. Schrift gerade geladen
    worldSize = { w: ww, h: wh };
    world.style.width = ww + 'px';
    world.style.height = wh + 'px';
    world.style.fontSize = (ww / 100) + 'px';            // 1em = 1 % der Kartenbreite
    stage.style.setProperty('--map-u', (ww / 100) + 'px'); // fuer HUD-Groessen passend zur Karte
    // Breite der Tages-Quests (breite Bildschirme): so breit wie der freie Bereich rechts oben
    // im Kartenbild (~21 % der Kartenbreite), damit die Zauberbude-Nadel sichtbar bleibt
    var qw = Math.round(U.clamp(ww * 0.213 - 14, 212, 330));
    stage.style.setProperty('--map-qw', qw + 'px');
    if (questBoard) questBoard.el.classList.toggle('is-narrow', qw < 250);
    restoreScroll();
    fitPlates();                                         // Schilder wachsen mit der Karte: Unterzeile neu einpassen
  }

  /** Maus: Karte mit gedrueckter Taste verschieben. Touch nutzt natives Scrollen. */
  function enableMouseDrag() {
    var down = null, dragged = false;
    view.addEventListener('pointerdown', function (e) {
      if (e.pointerType !== 'mouse' || e.button !== 0) return;
      down = { x: e.clientX, y: e.clientY, sl: view.scrollLeft, st: view.scrollTop, id: e.pointerId };
      dragged = false;
    });
    view.addEventListener('pointermove', function (e) {
      if (!down || e.pointerId !== down.id) return;
      var dx = e.clientX - down.x, dy = e.clientY - down.y;
      if (!dragged && Math.abs(dx) + Math.abs(dy) > 6) {
        dragged = true;
        view.classList.add('is-dragging');
        try { view.setPointerCapture(e.pointerId); } catch (err) { /* egal */ }
      }
      if (dragged) { view.scrollLeft = down.sl - dx; view.scrollTop = down.st - dy; }
    });
    function end() {
      if (!down) return;
      down = null;
      view.classList.remove('is-dragging');
      if (dragged) lastDragEnd = Date.now();
    }
    view.addEventListener('pointerup', end);
    view.addEventListener('pointercancel', end);
    // Nach dem Ziehen keinen Klick auf einen Hotspot ausloesen
    view.addEventListener('click', function (e) {
      if (Date.now() - lastDragEnd < 250) { e.stopPropagation(); e.preventDefault(); }
    }, true);
    // Mausrad: wenn die Karte nur seitlich uebersteht, dreht das Rad seitlich
    view.addEventListener('wheel', function (e) {
      if (e.ctrlKey) return;
      var panX = view.classList.contains('is-pan-x'), panY = view.classList.contains('is-pan-y');
      if (panX && !panY && Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        view.scrollLeft += e.deltaY;
        e.preventDefault();
      }
    }, { passive: false });
  }

  /* ================= Zeichnen ================= */

  function renderQuests() { if (questBoard && lastCtx) safe(function () { questBoard.update(lastCtx); }); }

  /** Sperr-Streifen + Faehnchen; Karte neu einpassen, wenn der Streifen kommt oder geht */
  function renderLock(ctx) {
    callouts.forEach(function (c) { safe(function () { c.update(ctx); }); });
    if (!lockStrip) return;
    safe(function () { lockStrip.update(ctx); });
    // map.css: solange der Streifen die Sperre zeigt, tritt ein noch sichtbarer Router-Hinweis auf der Karte zurueck
    document.body.classList.toggle('map-lock-on', lockStrip.mode() === 'lock');
    // Oberkante der Karte geaendert? Dann Groesse neu berechnen (ohne ResizeObserver sonst nie)
    if (safe(placeLock, false)) layout();
  }

  function renderAll() {
    var ctx = lastCtx = snapshot();
    hotspots.forEach(function (hs) { safe(function () { hs.update(ctx); }); });
    playerCards.forEach(function (c) { safe(function () { c.update(ctx); }); });
    if (questBoard) safe(function () { questBoard.update(ctx); });
    if (banners) safe(function () { banners.update(ctx); });
    updateNavBadges(ctx);
    renderLock(ctx);
    syncTicker();
  }

  /** Karte verdeckt (Bildschirm offen): Seitenleiste und Sperr-Zustand aktuell halten.
      Der Rest wird beim Zurueckkehren neu gezeichnet. */
  function renderSide() {
    var ctx = snapshot();
    playerCards.forEach(function (c) { safe(function () { c.update(ctx); }); });
    hotspots.forEach(function (hs) { safe(function () { hs.update(ctx); }); });
    updateNavBadges(ctx);
    renderLock(ctx);
  }

  /* Sekundentakt fuer Schmuggler-Countdown und Lauf-Stoppuhr – nur, solange die Karte sichtbar ist */
  function needTicker() {
    var s = OP.state || {};
    return !!((s.cardio && s.cardio.active) || (s.run && s.run.active && s.run.active.running));
  }
  function syncTicker() {
    var need = visible && !document.hidden && needTicker();
    if (need && !ticker) ticker = setInterval(tick, 1000);
    else if (!need && ticker) { clearInterval(ticker); ticker = null; }
  }
  function tick() {
    if (!lastCtx) return;
    lastCtx.cardio = safe(function () { return OP.game.cardioStatus(); }, null);
    lastCtx.run = safe(function () { return OP.game.runStatus ? OP.game.runStatus() : null; }, null);
    if (banners) safe(function () { banners.update(lastCtx); });
    ['schmuggler', 'taverne', 'gym'].forEach(function (id) {   // Countdown, "Zeit um"-Punkt, Stoppuhr
      if (hsById[id]) safe(function () { hsById[id].update(lastCtx); });
    });
    updateNavBadges(lastCtx);
    if (!needTicker()) syncTicker();
  }

  function setVisible(on) {
    visible = !!on;
    if (stage) {
      if (visible) { stage.removeAttribute('inert'); stage.removeAttribute('aria-hidden'); }
      else { stage.setAttribute('inert', ''); stage.setAttribute('aria-hidden', 'true'); }
    }
    // Beim Zurueckkehren immer frisch zeichnen (Countdown, Tageswechsel, Aenderungen im Bildschirm)
    if (visible) renderAll();
    syncTicker();
  }

  /* ================= Debug (zum Einmessen neuer Karten) ================= */

  function onWorldClickDebug(e) {
    if (!debugOn) return;
    var r = world.getBoundingClientRect();
    var x = (e.clientX - r.left) / r.width * 100, y = (e.clientY - r.top) / r.height * 100;
    var txt = 'x: ' + x.toFixed(1) + ' %, y: ' + y.toFixed(1) + ' %';
    console.log('[map] ' + txt);
    OP.ui.toast(txt, { type: 'info', icon: 'target' });
  }

  /* ================= Start ================= */

  function init(rootEl) {
    if (inited) return;
    inited = true;
    CFG = Array.isArray(OP.mapConfig) ? OP.mapConfig : [];
    if (CFG.world) WORLD = CFG.world;
    root = rootEl || document.getElementById('map-root') || document.body;
    mqWide = window.matchMedia ? window.matchMedia(MQ_WIDE) : null;
    mqLand = window.matchMedia ? window.matchMedia(MQ_LAND) : null;

    // Gemeinsame SVG-Verlaeufe fuer die Pins
    var defs = h('div', { class: 'map-defs', 'aria-hidden': 'true',
      html: '<svg width="0" height="0" focusable="false"><defs>' +
        '<linearGradient id="map-pin-grad" x1="0" y1="0" x2="0" y2="1">' +
          '<stop offset="0" stop-color="#16293a"/><stop offset="0.55" stop-color="#0b1621"/><stop offset="1" stop-color="#060b11"/>' +
        '</linearGradient></defs></svg>' });

    var img = h('img', { class: 'map-world__img', src: WORLD.src, alt: '', draggable: 'false', decoding: 'async' });
    img.addEventListener('error', function () { world.classList.add('map-world--noimg'); });
    world = h('div', { class: 'map-world' }, img);
    world.addEventListener('click', onWorldClickDebug);
    view = h('div', { class: 'map-view' }, world);

    var fx = h('div', { class: 'map-fx', 'aria-hidden': 'true' },
      h('div', { class: 'map-fx__fog map-fx__fog--a' }),
      h('div', { class: 'map-fx__fog map-fx__fog--b' }),
      h('div', { class: 'map-fx__lines' }),
      h('div', { class: 'map-fx__scan' }),
      h('div', { class: 'map-fx__vignette' }),
      h('div', { class: 'map-fx__band' }));

    // HUD
    hudCard = PlayerCard('hud');
    playerCards.push(hudCard);
    questBoard = QuestBoard();
    banners = Banners();
    lockStrip = LockStrip();
    var help = h('button', { type: 'button', class: 'map-help', 'aria-label': 'Hilfe', title: 'Hilfe',
      onclick: function () { navigate('hilfe'); }, html: icon('hilfe') });
    hudTop = h('div', { class: 'map-hud__top' }, hudCard.el, lockStrip.el, h('span', { class: 'map-hud__spacer' }), help, questBoard.el);
    hud = h('div', { class: 'map-hud' }, hudTop, banners.el, lockStrip.say);

    stage = h('div', { class: 'map-stage' }, view, fx, hud);
    var wrap = h('div', { class: 'map' }, defs, stage);
    root.appendChild(wrap);

    buildHotspots();
    buildNav();

    // Avatar-Sprite (Spieler-Karte)
    probe(CFG.avatarSprite, function (url) { avatarUrl = url; renderAll(); });

    // Sichtbar, wenn kein Bildschirm offen ist. Vor layout(): der Start-Ausschnitt richtet
    // sich nach der (schon gezeichneten) Quest-Liste und dem Sperr-Streifen.
    var path = String(location.hash || '').replace(/^#\/?/, '').replace(/\/+$/, '');
    setVisible(!path);
    if (!visible) renderAll();   // Seitenleiste & Co. trotzdem einmal fuellen
    setActiveNav(path);

    // Groesse & Scrollen
    layout();
    // Schrift geladen -> Spieler-Karte und Sperr-Streifen neu einpassen (Textbreiten aendern sich)
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { fitCards(); layout(); }, function () {});
    if (window.ResizeObserver) new ResizeObserver(function () { layout(); }).observe(view);
    window.addEventListener('resize', layout);
    window.addEventListener('orientationchange', function () { setTimeout(layout, 250); });
    view.addEventListener('scroll', saveScrollSoon, { passive: true });
    ['pointerdown', 'touchstart', 'wheel'].forEach(function (t) { view.addEventListener(t, markUserMove, { passive: true }); });
    enableMouseDrag();
    // Wechsel breit/Handy/Querformat: Quest-Liste (auf/zu, kompakt), Spieler-Karte und Streifen anpassen
    var onMq = function () { renderQuests(); fitCards(); layout(); };
    [mqWide, mqLand].forEach(function (mq) {
      if (!mq) return;
      if (mq.addEventListener) mq.addEventListener('change', onMq); else if (mq.addListener) mq.addListener(onMq);
    });

    // Jede Aenderung neu zeichnen – auch 'sync' (anderes Fenster), 'import' und 'reset'
    OP.bus.on('change', function () {
      if (visible) renderAll();
      else renderSide();   // Karte verdeckt: nur Seitenleiste + Sperre; beim Zurueckkehren wird alles neu gezeichnet
    });
    OP.bus.on('route', function (r) {
      var p = r && r.path ? String(r.path) : '';
      var back = !p && !visible;
      setActiveNav(p);
      setVisible(!p);
      // Zurueck auf der Karte, waehrend der Router-Hinweis noch laeuft (z. B. gesperrten Tab angetippt und gleich
      // zurueck, oder der offene Bereich wurde beim Tageswechsel gesperrt): Der Hinweis tritt hier zurueck (map.css),
      // der Streifen uebernimmt und leuchtet kurz auf – nie zwei gleiche Kaesten uebereinander.
      if (back && hintShown && lockStrip && lockStrip.mode() === 'lock') lockStrip.flash(null, true);
    });
    // Router: Sperr-Hinweis sichtbar oder nicht ({visible})
    OP.bus.on('lock-hint', function (e) { hintShown = !!(e && e.visible); });
    // Router: gesperrten Ort auf der Karte angetippt (oder App-Start/Tageswechsel mit Sperre). Statt eines
    // eigenen Hinweises soll der Streifen aufleuchten. Vorher neu zeichnen: die Sperre kann gerade erst
    // begonnen haben (Mitternacht), dann zeigt der Streifen noch "Morgen gesperrt".
    OP.bus.on('lock-flash', function (e) {
      if (visible) renderAll();
      if (lockStrip) lockStrip.flash(e && e.message);
    });
    document.addEventListener('visibilitychange', syncTicker);
  }

  OP.map = {
    init: init,
    /** Alles neu zeichnen */
    refresh: function () { if (inited) { renderAll(); layout(); } },
    /** Karte auf einen Hotspot zentrieren, z. B. OP.map.center('arena') */
    center: function (id) {
      var d = hsById[id] && hsById[id].def;
      if (!d || !inited) return;
      scrollFrac = { x: num(d.x) / 100, y: num(d.y) / 100 };
      restoreScroll();
    },
    /** Einmess-Hilfe: Hotspots halb durchsichtig, Klick zeigt x/y in Prozent */
    debug: function (on) {
      debugOn = on !== false;
      if (root) root.classList.toggle('map--debug', debugOn);
      return debugOn;
    }
  };
})();
