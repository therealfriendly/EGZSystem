/* Operator – Weltkarte (global: OP.map)
   Startbildschirm der App: gemaltes Kartenbild mit anklickbaren Hotspots (Pins, Schilder,
   Markierungen), HUD (Spieler-Karte, Tages-Quests, laufende Aktionen) und Hauptmenue
   (untere Leiste auf dem Handy, schmale Leiste im Querformat, Seitenleiste auf breiten Bildschirmen).
   Alle Hotspots kommen aus OP.mapConfig (js/ui/map-config.js).

   Aufbau im DOM:
     #map-root > .map
        .map-stage            Kartenbereich (ohne Menue)
           .map-view          scrollbarer Ausschnitt (Handy: seitlich wischen, PC: ziehen)
              .map-world      Kartenbild + Hotspots (Groesse per JS, 1em = 1 % der Kartenbreite)
           .map-fx            Nebel, Scanlines, Vignette (nur Deko)
           .map-hud           Spieler-Karte, Hilfe, Tages-Quests, Banner
     body > nav.map-nav       Hauptmenue (liegt direkt im body, damit die Seitenleiste
                              auf breiten Bildschirmen UEBER geoeffneten Bildschirmen bleibt) */
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

  var CFG = [], WORLD = { src: 'assets/map/world.jpg', width: 1345, height: 941 };
  var inited = false;
  var root, stage, view, world, hud, nav;
  var hotspots = [], hsById = {};
  var playerCards = [];
  var questBoard = null;
  var banners = null;
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

  /** Countdown "mm:ss" bzw. "h:mm:ss" */
  function clock(ms) {
    var s = Math.max(0, Math.ceil(num(ms) / 1000));
    var hh = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60), ss = s % 60;
    var p2 = function (n) { return (n < 10 ? '0' : '') + n; };
    return hh > 0 ? hh + ':' + p2(mm) + ':' + p2(ss) : p2(mm) + ':' + p2(ss);
  }

  function navigate(route) {
    if (debugOn) return;
    if (OP.ui && OP.ui.haptic) OP.ui.haptic(8);
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
      cardio: safe(function () { return g.cardioStatus(); }, null)
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

  /** Gemeinsamer Rahmen: <button> an der richtigen Stelle, Beschriftung, Abzeichen */
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
    function updateBadge(ctx) {
      if (typeof def.badge !== 'function') return;   // kein Abzeichen -> aria-label nicht anfassen (Schilder setzen eigenes)
      var b = safe(function () { return def.badge(ctx.s, OP.game); }, null);
      if (!b) { badge.hidden = true; el.setAttribute('aria-label', def.label + ' öffnen'); return; }
      badge.hidden = false;
      badge.className = 'map-hs__badge ' + toneClass(b.tone || 'red') + (b.dot ? ' map-hs__badge--dot' : '');
      badge.textContent = b.dot ? '' : String(b.text || '!');
      el.setAttribute('aria-label', def.label + ' öffnen' + (b.title ? ' – ' + b.title : ''));
    }
    return { el: el, badge: badge, updateBadge: updateBadge };
  }

  /** Beschriftungs-Chip. showLabel: false (map-config.js) = Name ausblenden, weil das Kartenbild
      direkt darunter schon ein gemaltes Schild hat. Der Chip erscheint dann nur fuer die
      Zusatzzeile (z. B. Countdown). Vorlesen klappt trotzdem (aria-label am Knopf). */
  function labelEl(def, withIcon) {
    var noName = def.showLabel === false;
    var sub = h('span', { class: 'map-hs__sub num', hidden: true });
    var el = h('span', { class: 'map-hs__label' + (noName ? ' map-hs__label--noname' : ''), 'aria-hidden': noName ? 'true' : null, hidden: noName },
      withIcon ? h('span', { class: 'map-hs__label-ico', html: icon(def.icon) }) : null,
      noName ? null : h('span', { class: 'map-hs__label-text', text: def.label }),
      sub);
    return {
      el: el, sub: sub,
      /** Zusatzzeile setzen (null = keine) */
      setSub: function (s) {
        sub.hidden = !s;
        sub.textContent = s ? s.text : '';
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
    return { el: b.el, def: def, spriteHost: float, update: function (ctx) { b.updateBadge(ctx); } };
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
      update: function (ctx) { safe(function () { inner.update(ctx); }); b.updateBadge(ctx); }
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
        var sub = FIG_SUB[def.id] ? safe(function () { return FIG_SUB[def.id](ctx); }, null) : null;
        lbl.setSub(sub);
        b.updateBadge(ctx);
      }
    };
  }

  var KINDS = { pin: Pin, plate: Plate, panel: Plate, figure: Figure };

  /* ---------- Inhalte der Schilder ---------- */
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
          numEl.textContent = U.fmt(cur);
          unit.textContent = cur === 1 ? 'Tag' : 'Tage';
          btn.classList.toggle('is-risk', ss.cls === 'is-risk');
          btn.classList.toggle('is-today', ss.cls === 'is-today');
          btn.classList.toggle('is-zero', ss.cls === 'is-zero');
          btn.setAttribute('aria-label', ss.label + ' Längster: ' + U.fmt(num(st.longest)) + '.');
          btn.title = 'Streak: ' + U.fmt(cur) + ' · ' + ss.hint;
        }
      };
    },

    /** Gym: Hantel-Scheibe + "GYM" + Pfeil; zeigt an, wenn ein Training laeuft */
    gym: function (def, host, btn) {
      var sub = h('span', { class: 'map-gym__sub', text: 'Training' });
      host.appendChild(h('span', { class: 'map-gym__disc', html: icon('gym') }));
      host.appendChild(h('span', { class: 'map-gym__text' }, h('span', { class: 'map-gym__title', text: def.label || 'Gym' }), sub));
      host.appendChild(h('span', { class: 'map-gym__chev', html: icon('next') }));
      return {
        update: function (ctx) {
          var g = ctx.gym;
          btn.classList.toggle('is-live', !!g);
          sub.textContent = g ? ((g.muscle && g.muscle.name) || 'Läuft') : 'Training';
          btn.setAttribute('aria-label', 'Gym öffnen' + (g ? ' – Training läuft' : ''));
        }
      };
    },

    /** Standard: Icon + Name */
    _default: function (def, host) {
      host.appendChild(h('span', { class: 'map-plate__ico', html: icon(def.icon) }));
      host.appendChild(h('span', { class: 'map-plate__lbl', text: def.label }));
      return { update: function () {} };
    }
  };

  /* ---------- Zusatzzeile unter den Markierungen ---------- */
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

  function buildHotspots() {
    CFG.forEach(function (def) {
      if (!def || !def.id) return;
      var make = KINDS[def.kind] || Pin;
      var inst = safe(function () { return make(def); }, null);
      if (!inst) return;
      hotspots.push(inst);
      hsById[def.id] = inst;
      world.appendChild(inst.el);
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
    if (n.clientWidth > 0 && n.scrollWidth > n.clientWidth + 1) el.classList.add('is-tight');
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
  function fitCards() {
    playerCards.forEach(function (c) {
      safe(function () {
        fitCard(c.el);
        Array.prototype.forEach.call(c.el.querySelectorAll('.map-player__tv'), fitText);
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
          // Runner-Rang = Durchschnitt der 5 Werte -> fehlende Gesamtstaerke = Schwelle x 5 - Gesamtstaerke
          // (gleiche Rechnung wie im Profil)
          var nMus = (OP.data && OP.data.MUSCLE_IDS && OP.data.MUSCLE_IDS.length) || 5;
          var next = r && r.next
            ? 'noch ' + U.fmt(Math.max(1, Math.ceil(num(r.nextMin) * nMus - num(ctx.strength)))) + ' Stärke bis ' + r.next.name
            : 'Höchster Rang erreicht';
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
          Array.prototype.forEach.call(tiles.querySelectorAll('.map-player__tv'), fitText);   // grosse Zahlen nie abschneiden
        }
        el.setAttribute('aria-label', 'Profil öffnen: ' + ctx.name +
          (r && r.rank ? ', Rang ' + r.rank.name : '') + ', Gesamtstärke ' + U.fmt(ctx.strength) +
          (variant === 'hud' ? '. ' + ss.label : ''));
      }
    };
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
      return { el: b, ico: ico, icoName: '', text: text, short: short, sub: sub };
    }

    function list(ctx) {
      var out = [];
      // Werte immer aus fightStatus()/gymStatus() (HP/Ziel koennen hoeher sein als beim Start)
      var f = ctx.fight;
      if (f) {
        var eName = (f.enemy && f.enemy.name) || 'Gegner';
        out.push(f.defeated
          ? { id: 'fight', tone: 'lime', icon: 'trophy', route: 'kampf', text: 'Gegner besiegt – Sieg abholen', short: 'Sieg!',
              sub: eName + ' · jetzt beenden, damit es zählt' }
          : { id: 'fight', tone: 'red', icon: 'swords', route: 'kampf', text: 'Kampf läuft – weiter', short: 'Kampf',
              // HP zuerst: bei langen Gegnernamen wird so nur der Name gekuerzt, nie die Zahl
              sub: 'noch ' + U.fmt(f.hpLeft) + ' HP · ' + eName });
      }
      var g = ctx.gym;
      if (g) {
        var mName = (g.muscle && g.muscle.name) || '…';
        out.push(g.reached
          ? { id: 'gym', tone: 'lime', icon: 'gym', route: 'haus/gym', text: 'Ziel erreicht – Training beenden', short: 'Beenden',
              sub: mName + ' · jetzt beenden, damit es zählt' }
          : { id: 'gym', tone: 'cyan', icon: 'gym', route: 'haus/gym', text: 'Training läuft: ' + mName, short: mName,
              sub: 'noch ' + U.fmt(g.left) + ' XP bis zum Ziel' });
      }
      var c = ctx.cardio;
      if (c) {
        var name = (c.def && c.def.name) || (c.active && c.active.text) || 'Lieferung';
        out.push(c.expired
          ? { id: 'cardio', tone: 'red', icon: 'schmuggler', route: 'taverne/schmuggler', text: 'Zeit abgelaufen – Ergebnis eintragen', short: 'Zeit um!', sub: name }
          : { id: 'cardio', tone: 'amber', icon: 'schmuggler', route: 'taverne/schmuggler', text: 'Schmuggler: ' + clock(c.msLeft) + ' übrig', short: clock(c.msLeft), sub: name });
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
          e.el.className = 'map-banner ' + toneClass(it.tone);
          e.el.onclick = function () { navigate(it.route); };
          if (e.icoName !== it.icon) { e.ico.innerHTML = icon(it.icon); e.icoName = it.icon; }
          e.el.setAttribute('aria-label', it.text + (it.sub ? ' – ' + it.sub : ''));
          if (e.text.textContent !== it.text) e.text.textContent = it.text;
          if (e.short.textContent !== it.short) e.short.textContent = it.short || it.text;
          if (e.sub.textContent !== it.sub) e.sub.textContent = it.sub || '';
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
      navBtns.push({ el: b, route: n.route, id: n.id, label: n.label, badge: badge });
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

  function updateNavBadges(ctx) {
    // Waehrend der Ersteinrichtung fuehrt der Router sowieso zurueck zu #/setup -> Menue gesperrt zeigen
    if (nav) nav.classList.toggle('is-locked', !(ctx.s && ctx.s.setupDone));
    navBtns.forEach(function (b) {
      if (!b.badge) return;
      var def = hsById[b.id] && hsById[b.id].def;
      var bd = def && typeof def.badge === 'function' ? safe(function () { return def.badge(ctx.s, OP.game); }, null) : null;
      b.badge.hidden = !bd;
      if (bd) {
        b.badge.className = 'map-nav__badge ' + toneClass(bd.tone || 'red') + (bd.dot ? ' map-nav__badge--dot' : '');
        b.badge.textContent = bd.dot ? '' : String(bd.text || '!');
      }
      b.el.setAttribute('aria-label', b.label + (bd && bd.title ? ' – ' + bd.title : ''));
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
    var top = num(keep.def.y) / 100 * H - size(keep.def) * above(keep.def) - 8;   // 8 px Luft zum Rand
    if (scrollY <= top) return f.y;
    var sy = Math.max(0, top);
    if (start) sy = Math.max(sy, num(start.def.y) / 100 * H + size(start.def) * (1 - above(start.def)) + 8 - vh);
    return Math.min(f.y, (sy + vh / 2) / H);
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

  function saveScroll() {
    if (!worldSize.w || !view.clientWidth) return;
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
    var vw = view.clientWidth, vh = view.clientHeight;
    if (!vw || !vh) return;
    var W = num(WORLD.width, 1345), H = num(WORLD.height, 941), ww, wh;
    if (vw / vh > W / H) { ww = vw; wh = Math.round(vw * H / W); }
    else { wh = vh; ww = Math.round(vh * W / H); }
    view.classList.toggle('is-pan-x', ww > vw + 1);
    view.classList.toggle('is-pan-y', wh > vh + 1);
    fitCards();                                          // Spieler-Karte an neue Breite anpassen
    if (ww === worldSize.w && wh === worldSize.h) return;
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

  function renderAll() {
    var ctx = lastCtx = snapshot();
    hotspots.forEach(function (hs) { safe(function () { hs.update(ctx); }); });
    playerCards.forEach(function (c) { safe(function () { c.update(ctx); }); });
    if (questBoard) safe(function () { questBoard.update(ctx); });
    if (banners) safe(function () { banners.update(ctx); });
    updateNavBadges(ctx);
    syncTicker();
  }

  /** Nur die Seitenleiste (bleibt auf breiten Bildschirmen sichtbar, wenn ein Bildschirm offen ist) */
  function renderSide() {
    var ctx = snapshot();
    playerCards.forEach(function (c) { safe(function () { c.update(ctx); }); });
    updateNavBadges(ctx);
  }

  /* Countdown fuer den Schmuggler – laeuft nur, solange die Karte sichtbar ist */
  function syncTicker() {
    var need = visible && !document.hidden && !!(OP.state && OP.state.cardio && OP.state.cardio.active);
    if (need && !ticker) ticker = setInterval(tick, 1000);
    else if (!need && ticker) { clearInterval(ticker); ticker = null; }
  }
  function tick() {
    if (!lastCtx) return;
    var c = safe(function () { return OP.game.cardioStatus(); }, null);
    lastCtx.cardio = c;
    if (banners) safe(function () { banners.update(lastCtx); });
    if (hsById.schmuggler) safe(function () { hsById.schmuggler.update(lastCtx); });
    if (hsById.taverne) safe(function () { hsById.taverne.update(lastCtx); });
    updateNavBadges(lastCtx);
    if (!c) syncTicker();
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
    var hudCard = PlayerCard('hud');
    playerCards.push(hudCard);
    questBoard = QuestBoard();
    banners = Banners();
    var help = h('button', { type: 'button', class: 'map-help', 'aria-label': 'Hilfe', title: 'Hilfe',
      onclick: function () { navigate('hilfe'); }, html: icon('hilfe') });
    hud = h('div', { class: 'map-hud' },
      h('div', { class: 'map-hud__top' }, hudCard.el, h('span', { class: 'map-hud__spacer' }), help, questBoard.el),
      banners.el);

    stage = h('div', { class: 'map-stage' }, view, fx, hud);
    var wrap = h('div', { class: 'map' }, defs, stage);
    root.appendChild(wrap);

    buildHotspots();
    buildNav();

    // Avatar-Sprite (Spieler-Karte)
    probe(CFG.avatarSprite, function (url) { avatarUrl = url; renderAll(); });

    // Sichtbar, wenn kein Bildschirm offen ist. Vor layout(): der Start-Ausschnitt richtet
    // sich nach der (schon gezeichneten) Quest-Liste.
    var path = String(location.hash || '').replace(/^#\/?/, '').replace(/\/+$/, '');
    setVisible(!path);
    if (!visible) renderAll();   // Seitenleiste & Co. trotzdem einmal fuellen
    setActiveNav(path);

    // Groesse & Scrollen
    layout();
    // Schrift geladen -> Spieler-Karte neu einpassen (Textbreiten aendern sich)
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(fitCards, function () {});
    if (window.ResizeObserver) new ResizeObserver(function () { layout(); }).observe(view);
    window.addEventListener('resize', layout);
    window.addEventListener('orientationchange', function () { setTimeout(layout, 250); });
    view.addEventListener('scroll', saveScrollSoon, { passive: true });
    enableMouseDrag();
    // Wechsel breit/Handy/Querformat: Quest-Liste (auf/zu, kompakt) und Spieler-Karte anpassen
    var onMq = function () { renderQuests(); fitCards(); };
    [mqWide, mqLand].forEach(function (mq) {
      if (!mq) return;
      if (mq.addEventListener) mq.addEventListener('change', onMq); else if (mq.addListener) mq.addListener(onMq);
    });

    // Jede Aenderung neu zeichnen – auch 'sync' (anderes Fenster), 'import' und 'reset'
    OP.bus.on('change', function () {
      if (visible) renderAll();
      else renderSide();   // Karte verdeckt: nur Seitenleiste; beim Zurueckkehren wird alles neu gezeichnet
    });
    OP.bus.on('route', function (r) {
      var p = r && r.path ? String(r.path) : '';
      setActiveNav(p);
      setVisible(!p);
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
