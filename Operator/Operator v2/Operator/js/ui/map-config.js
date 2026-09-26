/* Operator – Einstellungen der Weltkarte (global: OP.mapConfig)

   OP.mapConfig ist eine Liste der anklickbaren Stellen ("Hotspots") auf der Karte.
   Jeder Eintrag:
     id      eindeutiger Name (auch Dateiname des Sprites: assets/sprites/<id>.png)
     label   Beschriftung auf der Karte
     route   Ziel beim Antippen (siehe Router, z. B. 'haus/gym')
     icon    Icon-Name aus OP.icons (Standard-Aussehen, solange kein Sprite da ist)
     kind    'pin'    = Stecknadel ueber einem Gebaeude (x/y = Mitte des Nadelkopfs)
             'plate'  = Schild/Tafel (x/y = Mitte, w/h = Groesse)
             'figure' = Markierung um etwas Gemaltes (Portal, Figur, Wagen …)
     x, y    Ankerpunkt in PROZENT des Kartenbilds (0–100, von links / von oben)
     w       Breite in Prozent der Kartenbreite
     h       Hoehe in Prozent der Kartenhoehe (nur plate/figure; pin ist immer gleich geformt)
     tone    Akzentfarbe: 'cyan' | 'gold' | 'red' | 'violet' | 'amber' | 'lime'
     labelPos  wo die Beschriftung sitzt: 'bottom' (Standard) | 'top' | 'right' | 'left'
     labelDx   (optional) Beschriftung seitlich verschieben, in Prozent der Kartenbreite (+ = nach rechts)
     showLabel (optional) false = keinen Namens-Chip zeigen, weil das Kartenbild direkt darunter
               schon ein gemaltes Schild hat (Vorlesen/Tooltip nennen den Namen trotzdem)
     sprite  Bild, das statt des Standard-Aussehens gezeigt wird, falls die Datei existiert
     badge   (optional) function (state, game) -> null | {text:'!', tone:'red', title} | {dot:true, tone}
             kleines Abzeichen am Hotspot, wird bei jeder Aenderung neu berechnet

   Neues Kartenbild? Breite/Hoehe unten in WORLD eintragen und die x/y-Werte neu messen.
   Tipp: In der Browser-Konsole OP.map.debug(true) eingeben – dann zeigt ein Klick auf die
   Karte die Prozent-Werte der Stelle an. */
(function () {
  'use strict';
  var OP = (window.OP = window.OP || {});

  /* Hintergrundbild der Welt (Pixelmasse des Bildes!) */
  var WORLD = {
    src: 'assets/map/world.jpg',
    width: 1345,
    height: 941,
    startAt: 'haus',         // beim ersten Oeffnen wird auf diesen Hotspot zentriert
    keepClear: 'arena'       // Handy: diese Nadel beim Start links neben der offenen Quest-Liste zeigen
  };

  function sprite(id) { return 'assets/sprites/' + id + '.png'; }

  /* Kleine Helfer fuer die Abzeichen (duerfen nie abstuerzen) */
  function fightIn(s, pool) { return !!(s && s.fight && s.fight.pool === pool); }
  function cardioOn(s) { return !!(s && s.cardio && s.cardio.active); }
  function cardioLate(s) { return cardioOn(s) && Number(s.cardio.active.deadline) < Date.now(); }

  var hotspots = [
    /* ---------- Gebaeude-Pins (decken die gemalten Pins ab) ----------
       Taverne, Haus, Zauberbude: showLabel false, weil der Name direkt darunter gemalt ist. */
    {
      id: 'arena', label: 'Arena', route: 'arena', icon: 'arena', kind: 'pin',
      x: 49.9, y: 10.1, w: 7.6, tone: 'red', sprite: sprite('arena'),
      badge: function (s) { return fightIn(s, 'arena') ? { text: '!', tone: 'red', title: 'Arena-Kampf läuft' } : null; }
    },
    {
      id: 'taverne', label: 'Taverne', route: 'taverne', icon: 'taverne', kind: 'pin',
      x: 22.9, y: 33.3, w: 7.6, tone: 'gold', showLabel: false, sprite: sprite('taverne'),
      badge: function (s) {
        if (fightIn(s, 'abenteuer')) return { text: '!', tone: 'red', title: 'Abenteuer-Kampf läuft' };
        if (cardioLate(s)) return { dot: true, tone: 'red', title: 'Schmuggler: Zeit abgelaufen' };
        return cardioOn(s) ? { dot: true, tone: 'amber', title: 'Schmuggler-Lieferung läuft' } : null;
      }
    },
    {
      id: 'zauberbude', label: 'Zauberbude', route: 'zauberbude', icon: 'zauberbude', kind: 'pin',
      x: 74.7, y: 29.0, w: 7.6, tone: 'violet', showLabel: false, sprite: sprite('zauberbude')
    },
    {
      id: 'haus', label: 'Haus', route: 'haus', icon: 'haus', kind: 'pin',
      x: 45.9, y: 50.9, w: 7.6, tone: 'cyan', showLabel: false, sprite: sprite('haus'),
      badge: function (s) { return s && s.gym ? { dot: true, tone: 'cyan', title: 'Training läuft' } : null; }
    },

    /* ---------- Schilder (decken die ausgeblendeten Tafeln ab) ---------- */
    {
      id: 'streak', label: 'Streak', route: 'haus/profil', icon: 'streak', kind: 'plate',
      x: 17.6, y: 17.1, w: 15.9, h: 11.7, tone: 'amber', sprite: sprite('streak')
    },
    {
      id: 'gym', label: 'Gym', route: 'haus/gym', icon: 'gym', kind: 'plate',
      x: 79.9, y: 85.0, w: 14.4, h: 10.8, tone: 'cyan', sprite: sprite('gym')
    },

    /* ---------- Markierungen um gemalte Dinge ---------- */
    {
      id: 'abenteuer', label: 'Abenteuer', route: 'taverne/abenteuer', icon: 'abenteuer', kind: 'figure',
      x: 17.6, y: 6.2, w: 8.4, h: 11.4, tone: 'cyan', labelPos: 'right', sprite: sprite('abenteuer'),
      badge: function (s) { return fightIn(s, 'abenteuer') ? { text: '!', tone: 'red', title: 'Abenteuer-Kampf läuft' } : null; }
    },
    {
      id: 'schmuggler', label: 'Schmuggler', route: 'taverne/schmuggler', icon: 'schmuggler', kind: 'figure',
      x: 7.0, y: 35.6, w: 12.2, h: 15.4, tone: 'amber', labelPos: 'top', labelDx: 3, showLabel: false, sprite: sprite('schmuggler'),
      badge: function (s) {
        if (cardioLate(s)) return { dot: true, tone: 'red', title: 'Zeit abgelaufen' };
        return cardioOn(s) ? { dot: true, tone: 'amber', title: 'Lieferung läuft' } : null;
      }
    },
    {
      id: 'kalorien', label: 'Kalorien', route: 'haus/kalorien', icon: 'kcal', kind: 'figure',
      x: 49.3, y: 74.8, w: 8.4, h: 12.6, tone: 'lime', labelPos: 'bottom', sprite: sprite('kalorien')
    },
    {
      id: 'profil', label: 'Profil', route: 'haus/profil', icon: 'profil', kind: 'figure',
      x: 33.5, y: 87.4, w: 5.2, h: 12.4, tone: 'gold', labelPos: 'top', sprite: sprite('profil')
    }
  ];

  /* Hauptmenue: Seitenleiste (breite Bildschirme) bzw. untere Leiste (Handy).
     short = kurze Beschriftung fuer die schmale Handy-Leiste. */
  var nav = [
    { id: 'taverne', label: 'Taverne', short: 'Taverne', route: 'taverne', icon: 'taverne', tone: 'gold' },
    { id: 'arena', label: 'Arena', short: 'Arena', route: 'arena', icon: 'arena', tone: 'red' },
    { id: 'haus', label: 'Haus', short: 'Haus', route: 'haus', icon: 'haus', tone: 'cyan' },
    { id: 'zauberbude', label: 'Zauberbude', short: 'Zauber', route: 'zauberbude', icon: 'zauberbude', tone: 'violet' },
    { id: 'abenteuer', label: 'Abenteuer', short: 'Abenteuer', route: 'taverne/abenteuer', icon: 'abenteuer', tone: 'cyan' },
    { id: 'profil', label: 'Profil', short: 'Profil', route: 'haus/profil', icon: 'profil', tone: 'gold' }
  ];

  /* Kleine Knoepfe unten in der Seitenleiste */
  var navSmall = [
    { id: 'einstellungen', label: 'Zauberbude (Einstellungen)', route: 'zauberbude', icon: 'settings' },
    { id: 'hilfe', label: 'Hilfe', route: 'hilfe', icon: 'hilfe' }
  ];

  hotspots.world = WORLD;
  hotspots.nav = nav;
  hotspots.navSmall = navSmall;
  hotspots.avatarSprite = 'assets/sprites/avatar.png';
  hotspots.questsSprite = 'assets/sprites/quests.png';   // Hintergrund/Rahmen der Tages-Quests-Tafel

  OP.mapConfig = hotspots;
})();
