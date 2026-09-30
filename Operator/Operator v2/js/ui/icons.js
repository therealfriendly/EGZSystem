/* Operator – Icon-Satz (global: OP.icons)
   Jedes Icon ist innerer SVG-Code fuer viewBox="0 0 24 24".
   OP.ui.icon(name) packt ihn in <svg class="ico"> mit stroke=currentColor, stroke-width 1.8,
   runden Enden und fill=none. Kleine volle Punkte bekommen fill="currentColor" stroke="none".
   Betonte Muskeln (Brust, Ruecken, Bizeps ...) sind halbtransparent gefuellt (HALB).
   Neues Icon? Einfach hier einen Eintrag ergaenzen – Linien bleiben innerhalb von 2..22.
   Version 2: push, pull (Trainings-Gruppen), bizeps, trizeps (Muskeln). 'arme' bleibt fuer alte Spielstaende. */
(function () {
  'use strict';
  var OP = (window.OP = window.OP || {});

  // Kurzform fuer einen vollen Punkt (z. B. Augen, Wuerfel-Augen)
  function dot(x, y, r) {
    return '<circle cx="' + x + '" cy="' + y + '" r="' + (r || 1.3) + '" fill="currentColor" stroke="none"/>';
  }
  // Halbtransparente Flaeche (betonter Muskel) bzw. volle Flaeche ohne Linie
  var HALB = ' fill="currentColor" fill-opacity=".3"';
  var VOLL = ' fill="currentColor" stroke="none"';
  // Gemeinsamer Oberkoerper fuer Brust und Ruecken (Hals, Schultern, Arme)
  var TORSO =
    '<path d="M9.6 3v2.6L6.2 6.9a3.7 3.7 0 0 0-2.9 3.6V21M14.4 3v2.6l3.4 1.3a3.7 3.7 0 0 1 2.9 3.6V21"/>' +
    '<path d="M7 21v-5.2M17 21v-5.2"/>';

  var I = {
    /* ================= Gebaeude & Navigation ================= */

    // Bierkrug mit Schaumkrone
    taverne:
      '<path d="M5.5 9.5v9.5a2 2 0 0 0 2 2h7a2 2 0 0 0 2-2V9.5"/>' +
      '<path d="M16.5 11.5h1.8a2.2 2.2 0 0 1 2.2 2.2v1.6a2.2 2.2 0 0 1-2.2 2.2h-1.8"/>' +
      '<path d="M5.4 9.6A2.5 2.5 0 0 1 6.5 4.8a3.3 3.3 0 0 1 5.6-1 2.9 2.9 0 0 1 4.4 2A2 2 0 0 1 16.6 9.6z"/>' +
      '<path d="M9.2 13v4.5M12.8 13v4.5"/>',

    // Abenteurer-Stiefel
    abenteuer:
      '<path d="M7 3.5h6.5v8.2l4.7 1.8a3 3 0 0 1 1.9 2.8V20H4.2v-2.3L7 14.2z"/>' +
      '<path d="M4.2 17.5h15.9M7 6.8h6.5M13.5 12.2l-2.3 1.4"/>',

    // Kolosseum mit Boegen
    arena:
      '<path d="M2.5 20.5h19"/>' +
      '<path d="M3.5 20.5V8.4C6.2 7 9 6.4 12 6.4s5.8.6 8.5 2v12.1"/>' +
      '<path d="M3.5 12.4c2.7-1 5.5-1.5 8.5-1.5s5.8.5 8.5 1.5"/>' +
      '<path d="M6.6 20.5v-3.6a1.4 1.4 0 0 1 2.8 0v3.6M10.6 20.5v-3.6a1.4 1.4 0 0 1 2.8 0v3.6M14.6 20.5v-3.6a1.4 1.4 0 0 1 2.8 0v3.6"/>' +
      '<path d="M12 6.4V2.8l3 1.2-3 1.2"/>',

    // Haus mit Kamin und Bogentuer
    haus:
      '<path d="M2.8 11.6 12 4l9.2 7.6"/>' +
      '<path d="M15.8 6.8V4.2h2.6v4.8"/>' +
      '<path d="M5.3 9.6V20.5h13.4V9.6"/>' +
      '<path d="M10 20.5v-4.3a2 2 0 0 1 4 0v4.3"/>' +
      '<path d="M11 11.2h2v2h-2z"/>',

    // Zauberhut mit Stern
    zauberbude:
      '<path d="M3 18.6c0 1.2 4 2.2 9 2.2s9-1 9-2.2-2.2-1.7-4.3-2H7.3c-2.1.3-4.3 1-4.3 2z"/>' +
      '<path d="M6.6 16.8 10.8 6.2c.6-1.5 2-2.6 3.6-2.7l4.3-.3-3.3 2.4 2.2 11.2"/>' +
      '<path d="M11.8 10.2l.6 1.4 1.5.2-1.1 1 .3 1.5-1.3-.7-1.3.7.3-1.5-1.1-1 1.5-.2z"/>' +
      '<path d="M4.5 4v3M3 5.5h3"/>',

    // Person (Brustbild)
    profil:
      '<circle cx="12" cy="8" r="4"/>' +
      '<path d="M4.5 20.5c.4-4 3.4-6.5 7.5-6.5s7.1 2.5 7.5 6.5"/>',

    // Hantel
    gym:
      '<rect x="5.5" y="6.5" width="3" height="11" rx="1"/>' +
      '<rect x="15.5" y="6.5" width="3" height="11" rx="1"/>' +
      '<path d="M3 9.5v5M21 9.5v5M8.5 12h7"/>',

    // Schmuggel-Kiste (Paket mit Klebeband)
    schmuggler:
      '<path d="M12 2.8l8.2 4.6v9.2L12 21.2l-8.2-4.6V7.4z"/>' +
      '<path d="M3.8 7.4 12 12l8.2-4.6M12 12v9.2M7.9 5.1l8.2 4.6"/>',

    // Zirkuszelt mit Wimpel
    zirkus:
      '<path d="M12 6.2V2.6l3 1.2-3 1.2"/>' +
      '<path d="M3 11.5 12 6.2l9 5.3"/>' +
      '<path d="M3 11.5c1 1.2 2 1.2 3 0 1 1.2 2 1.2 3 0 1 1.2 2 1.2 3 0 1 1.2 2 1.2 3 0 1 1.2 2 1.2 3 0 1 1.2 2 1.2 3 0"/>' +
      '<path d="M4.5 12.8v7.7h15v-7.7"/>' +
      '<path d="M9.5 20.5 12 14l2.5 6.5M9 6.9 7.3 10M15 6.9l1.7 3.1"/>',

    // Fragezeichen im Kreis
    hilfe:
      '<circle cx="12" cy="12" r="9"/>' +
      '<path d="M9.4 9.4a2.7 2.7 0 0 1 5.2.9c0 1.8-2.6 2.2-2.6 4"/>' +
      '<path d="M12 17.2v.01"/>',

    // Karte mit Standort-Nadel
    karte:
      '<path d="M8.5 6.5 3.5 8.5v12l5.5-2.2 6 2.2 5.5-2.2v-5"/>' +
      '<path d="M9 8v10.3M15 14v6.5"/>' +
      '<path d="M16.5 12.5s-3.5-3.1-3.5-5.8a3.5 3.5 0 0 1 7 0c0 2.7-3.5 5.8-3.5 5.8z"/>' +
      dot(16.5, 6.7, 1.1),

    // Kalorien: Fetttropfen mit Flamme
    kcal:
      '<path d="M12 2.8s-6.8 6.9-6.8 11.6a6.8 6.8 0 0 0 13.6 0C18.8 9.7 12 2.8 12 2.8z"/>' +
      '<path d="M12 18.3c-1.6 0-2.7-1.1-2.7-2.6 0-1.7 1.6-2.7 2.1-4.5 1.2 1 1.6 1.9 1.6 2.9.5-.3.9-.8 1.1-1.5.4.6.6 1.4.6 2.2 0 2-1.1 3.5-2.7 3.5z"/>',

    // Schriftrolle mit Haken
    quest:
      '<path d="M18.5 16V5a2 2 0 0 0-2-2H5"/>' +
      '<path d="M5 3a2 2 0 0 0-2 2v1.5h4V5a2 2 0 0 0-2-2z"/>' +
      '<path d="M7 6.5V19a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-1.2a.8.8 0 0 0-.8-.8H11.8a.8.8 0 0 0-.8.8V19a2 2 0 0 1-2 2"/>' +
      '<path d="M9.8 10.2l1.8 1.8 3.6-3.8"/>',

    /* ================= Muskelgruppen ================= */

    // Ruecken: Oberkoerper mit Wirbelsaeule und breitem Latissimus (V-Form)
    ruecken:
      TORSO +
      '<path d="M12 7.5v13.5"/>' +
      '<path d="M11 8.2c-1.8.1-3.3.7-4.1 1.7 1.6 1.7 3 4.2 4.1 7.3zM13 8.2c1.8.1 3.3.7 4.1 1.7-1.6 1.7-3 4.2-4.1 7.3z"' + HALB + '/>',

    // Brust: Oberkoerper mit zwei Brustmuskeln
    brust:
      TORSO +
      '<path d="M11.3 8.8c-1.6-.5-3.2-.4-4.3.3-.2 1.7.1 3.3 1.1 4.2 1.4.6 2.6.4 3.2-.7zM12.7 8.8c1.6-.5 3.2-.4 4.3.3.2 1.7-.1 3.3-1.1 4.2-1.4.6-2.6.4-3.2-.7z"' + HALB + '/>',

    // Angespannter Arm (alte Gruppe "Arme" aus Version 1, bleibt fuer alte Spielstaende)
    arme:
      '<path d="M3 20.5h12.4a4.6 4.6 0 0 0 4.4-5.9L17.7 8l.6-2.4a1.5 1.5 0 0 0-1-1.8l-2.9-.9a1.5 1.5 0 0 0-1.9 1l-.6 2.3 2.5 1.2.4 4.6c-1.9-2.5-6.1-2.9-8.6-.3-1.1 1.2-2.3 1.8-3.7 2"/>' +
      '<path d="M9 15.8c2-.4 4 .3 5.3 1.9"/>',

    // Bizeps: angespannter Arm von vorn, hoher Bizeps-Berg betont
    bizeps:
      '<path d="M3 20.5h12.4a4.6 4.6 0 0 0 4.4-5.9L17.7 8l.6-2.4a1.5 1.5 0 0 0-1-1.8l-2.9-.9a1.5 1.5 0 0 0-1.9 1l-.6 2.3 2.5 1.2.4 4.6c-1.6-3.3-6.6-4.3-9.2-.8-.9 1.2-2.1 1.9-3.4 2.1"/>' +
      '<path d="M14.8 12c-1.6-3.3-6.6-4.3-9.2-.8 2.6 1.9 6.3 2.4 9.2.8z"' + HALB + '/>',

    // Trizeps: Oberkoerper von hinten (wie Ruecken), Rueckseite der Oberarme betont
    trizeps:
      TORSO +
      '<path d="M12 7.5v13.5"/>' +
      '<path d="M3.3 10.3c2.2-.3 4 1.8 4.1 4.6 0 1-.2 1.8-.6 2.4-1.5.1-2.8-.4-3.5-1.3zM20.7 10.3c-2.2-.3-4 1.8-4.1 4.6 0 1 .2 1.8.6 2.4 1.5.1 2.8-.4 3.5-1.3z"' + HALB + '/>',

    // Schultern: Figur mit betonten Deltamuskeln
    schultern:
      '<circle cx="12" cy="5" r="2.6"/>' +
      '<path d="M7.6 10.3c1.4-.7 2.9-1 4.4-1s3 .3 4.4 1"/>' +
      '<path d="M7.6 10.3a4 4 0 0 0-4.1 4V21M16.4 10.3a4 4 0 0 1 4.1 4V21M8.6 15.5V21M15.4 15.5V21"/>' +
      '<path d="M7.6 10.3a4 4 0 0 0-4.1 4v1.2h5.1c.8-2 .5-4-1-5.2zM16.4 10.3a4 4 0 0 1 4.1 4v1.2h-5.1c-.8-2-.5-4 1-5.2z"' + HALB + '/>',

    // Bein von der Seite (Oberschenkel, Knie, Wade, Fuss)
    beine:
      '<path d="M7.8 2.8C7.2 6.4 7.6 9.7 8.9 12.5c-1.4 2-1.5 4.2-.4 6.4L8.3 21h8.9c.8 0 1-1 .4-1.4l-4.2-1.9.8-5c.5-3.4.3-6.6-.5-9.9"/>' +
      '<path d="M13.6 12.4c-.9.4-1.8.4-2.6.1"/>',

    // Bauch: Sixpack (volle Kacheln, damit es auch klein gut lesbar ist)
    bauch:
      '<path d="M5.8 3c-.6 2.6-.7 5.2-.3 7.8.3 2.1 0 4.2-.7 6.2L4.3 21M18.2 3c.6 2.6.7 5.2.3 7.8-.3 2.1 0 4.2.7 6.2l.5 4"/>' +
      '<rect x="7.9" y="4" width="3.5" height="4" rx="1.2"' + VOLL + '/><rect x="12.6" y="4" width="3.5" height="4" rx="1.2"' + VOLL + '/>' +
      '<rect x="7.9" y="9.3" width="3.5" height="4" rx="1.2"' + VOLL + '/><rect x="12.6" y="9.3" width="3.5" height="4" rx="1.2"' + VOLL + '/>' +
      '<rect x="8.2" y="14.6" width="3.2" height="4.4" rx="1.2"' + VOLL + '/><rect x="12.6" y="14.6" width="3.2" height="4.4" rx="1.2"' + VOLL + '/>',

    // Ganzer Koerper
    body:
      '<circle cx="12" cy="4.6" r="2.1"/>' +
      '<path d="M5 8.4l7 1.1 7-1.1M12 9.5v5.3M12 14.8l-3.2 6.2M12 14.8l3.2 6.2"/>',

    /* ================= Trainings-Gruppen (Push / Pull / Beine) ================= */
    // Beine nutzt das Muskel-Icon 'beine'

    // Push (Druecken): Langhantel wird nach oben gedrueckt
    push:
      '<path d="M3 6h2M7.4 6h9.2M19 6h2"/>' +
      '<rect x="5" y="2.8" width="2.4" height="6.4" rx=".8"/><rect x="16.6" y="2.8" width="2.4" height="6.4" rx=".8"/>' +
      '<path d="M12 21V10.5M8.2 14.3 12 10.5l3.8 3.8"/>',

    // Pull (Ziehen): Klimmzug an der Stange
    pull:
      '<path d="M2.5 3.5h19"/>' +
      '<circle cx="12" cy="6.8" r="2.1"/>' +
      '<path d="M6 3.5v3.8a4.2 4.2 0 0 0 4.2 4.2h3.6A4.2 4.2 0 0 0 18 7.3V3.5"/>' +
      '<path d="M12 11.5v5M12 16.5l-2.6 4.5M12 16.5l2.6 4.5"/>',

    /* ================= HUD ================= */

    // Faust
    staerke:
      '<path d="M6.5 10V7.9a1.6 1.6 0 0 1 3.2 0V10M9.7 7.4a1.6 1.6 0 0 1 3.2 0V10M12.9 7.4a1.6 1.6 0 0 1 3.2 0V10M16.1 8a1.6 1.6 0 0 1 3.2 0v4.5"/>' +
      '<path d="M6.5 10v3.5c0 3.8 2.6 6.8 6.3 6.8h.9c3.3 0 5.6-2.6 5.6-5.8v-2"/>' +
      '<path d="M6.5 11.5h5.4a1.8 1.8 0 0 1 0 3.6H9.3"/>',

    // Flamme (Streak)
    streak:
      '<path d="M12 21.2c-3.9 0-6.7-2.6-6.7-6.3 0-2.7 1.5-4.5 3-6.2.2 1.6.9 2.7 2 3.3.1-3.5 1.7-6.5 4.6-8.8.4 3.1 1.8 4.8 3.1 6.5 1.1 1.5 1.8 3.2 1.8 5 0 3.8-2.9 6.5-7.8 6.5z"/>' +
      '<path d="M12.2 21.2c-1.9 0-3.1-1.2-3.1-2.9 0-1.9 1.5-3 2.4-4.8 1.6 1.2 3.7 2.6 3.7 4.8 0 1.7-1.2 2.9-3 2.9z"/>',

    // Goldmuenze
    gold:
      '<circle cx="12" cy="12" r="8.8"/>' +
      '<circle cx="12" cy="12" r="5.6"/>' +
      '<path d="M12 9.2l2.2 2.8-2.2 2.8-2.2-2.8z"/>',

    // Edelstein (Rang)
    rank:
      '<path d="M6.5 4h11l3.6 5.2L12 20.5 2.9 9.2z"/>' +
      '<path d="M2.9 9.2h18.2M9.6 4 8 9.2l4 11.3 4-11.3L14.4 4"/>',

    /* ================= Aktionen ================= */
    check: '<path d="M4.5 12.5l4.8 4.8L19.5 7"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    minus: '<path d="M5 12h14"/>',
    close: '<path d="M6 6l12 12M18 6 6 18"/>',
    back: '<path d="M19.5 12h-15M10.5 5.5 4 12l6.5 6.5"/>',
    next: '<path d="M4.5 12h15M13.5 5.5 20 12l-6.5 6.5"/>',
    edit:
      '<path d="M4 20h4L19.2 8.8a2.8 2.8 0 0 0-4-4L4 16z"/>' +
      '<path d="M13.5 6.5l4 4"/>',
    trash:
      '<path d="M4 6.5h16M9 6.5V4.5h6v2M6 6.5l1 13.5h10l1-13.5"/>' +
      '<path d="M10 10.5v6M14 10.5v6"/>',
    copy:
      '<rect x="8.5" y="8.5" width="12" height="12" rx="2"/>' +
      '<path d="M15.5 8.5V5.5a2 2 0 0 0-2-2h-8a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h3"/>',
    // Pfeil aus der Box heraus
    export:
      '<path d="M8 10.5H6a2 2 0 0 0-2 2V19a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-6.5a2 2 0 0 0-2-2h-2"/>' +
      '<path d="M12 15V3M7.8 7.2 12 3l4.2 4.2"/>',
    // Pfeil in die Box hinein
    import:
      '<path d="M8 10.5H6a2 2 0 0 0-2 2V19a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-6.5a2 2 0 0 0-2-2h-2"/>' +
      '<path d="M12 3v12M7.8 10.8 12 15l4.2-4.2"/>',
    download: '<path d="M12 3.5v11.5M7 10l5 5 5-5M4.5 20.5h15"/>',
    upload: '<path d="M12 20.5V9M7 14l5-5 5 5M4.5 3.5h15"/>',
    refresh:
      '<path d="M20 12a8 8 0 0 1-14.3 4.9M4 12a8 8 0 0 1 14.3-4.9"/>' +
      '<path d="M18.6 3v4.4h-4.4M5.4 21v-4.4h4.4"/>',
    dice:
      '<rect x="3.5" y="3.5" width="17" height="17" rx="3.5"/>' +
      dot(8.2, 8.2) + dot(15.8, 8.2) + dot(12, 12) + dot(8.2, 15.8) + dot(15.8, 15.8),
    play: '<path d="M7.5 4.8v14.4a.8.8 0 0 0 1.2.7l11.3-7.2a.8.8 0 0 0 0-1.4L8.7 4.1a.8.8 0 0 0-1.2.7z"/>',
    pause: '<rect x="6" y="4.5" width="4" height="15" rx="1"/><rect x="14" y="4.5" width="4" height="15" rx="1"/>',
    stop: '<rect x="5.5" y="5.5" width="13" height="13" rx="2"/>',
    // Stoppuhr
    timer:
      '<circle cx="12" cy="13.5" r="7.5"/>' +
      '<path d="M12 13.5V9.5M9.5 2.5h5M12 2.5V6M18 7.5l1.6-1.6"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.3 2"/>',
    settings:
      '<path d="M10.52 5.06 10.77 2.68h2.46l.25 2.38a7.1 7.1 0 0 1 2.39.99l1.85-1.51 1.74 1.74-1.51 1.85a7.1 7.1 0 0 1 .99 2.39l2.38.25v2.46l-2.38.25a7.1 7.1 0 0 1-.99 2.39l1.51 1.85-1.74 1.74-1.85-1.51a7.1 7.1 0 0 1-2.39.99l-.25 2.38h-2.46l-.25-2.38a7.1 7.1 0 0 1-2.39-.99l-1.85 1.51-1.74-1.74 1.51-1.85a7.1 7.1 0 0 1-.99-2.39l-2.38-.25v-2.46l2.38-.25a7.1 7.1 0 0 1 .99-2.39L4.54 6.28l1.74-1.74 1.85 1.51a7.1 7.1 0 0 1 2.39-.99z"/>' +
      '<circle cx="12" cy="12" r="3"/>',
    lock:
      '<rect x="4.5" y="10.5" width="15" height="10.5" rx="2"/>' +
      '<path d="M8 10.5V7.5a4 4 0 0 1 8 0v3M12 14.5v2.5"/>',
    unlock:
      '<rect x="4.5" y="10.5" width="15" height="10.5" rx="2"/>' +
      '<path d="M8 10.5V7.5a4 4 0 0 1 7.7-1.5M12 14.5v2.5"/>',
    info:
      '<circle cx="12" cy="12" r="9"/>' +
      '<path d="M12 11v5.5M12 7.6v.01"/>',
    warning:
      '<path d="M10.3 4.1 2.8 17.2a2 2 0 0 0 1.7 3h15a2 2 0 0 0 1.7-3L13.7 4.1a2 2 0 0 0-3.4 0z"/>' +
      '<path d="M12 9.5v4M12 16.8v.01"/>',
    star: '<path d="M12 3.4l2.47 6 6.47.5-4.95 4.2 1.54 6.3L12 17l-5.53 3.4 1.54-6.3-4.95-4.2 6.47-.5z"/>',
    trophy:
      '<path d="M7 3.5h10V9a5 5 0 0 1-10 0z"/>' +
      '<path d="M7 5.5H4.2v1.2a3.6 3.6 0 0 0 3.3 3.6M17 5.5h2.8v1.2a3.6 3.6 0 0 1-3.3 3.6"/>' +
      '<path d="M12 14v3M9.2 17h5.6l.9 3.5H8.3z"/>',
    skull:
      '<path d="M12 3a7.5 7.5 0 0 0-7.5 7.5c0 2.6 1.2 4.3 3 5.4v3.1a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1v-3.1c1.8-1.1 3-2.8 3-5.4A7.5 7.5 0 0 0 12 3z"/>' +
      '<circle cx="9" cy="11" r="1.9" fill="currentColor" stroke="none"/><circle cx="15" cy="11" r="1.9" fill="currentColor" stroke="none"/>' +
      '<path d="M12 13.8l-.9 1.7h1.8zM10.3 20v-2M13.7 20v-2"/>',
    // Einzelnes Schwert
    sword:
      '<path d="M20 4v3.6L10.4 17.2l-3.6-3.6L16.4 4z"/>' +
      '<path d="M5.2 12.5l6.3 6.3M8.6 15.4 4.6 19.4M3.4 18.2l2.4 2.4"/>',
    // Zwei gekreuzte Schwerter
    swords:
      '<path d="M4 4h3.4l10 10-3.4 3.4-10-10z"/>' +
      '<path d="M12.5 18.8l6.3-6.3M15.7 15.7l4 4M18.6 20.8l2.2-2.2"/>' +
      '<path d="M13.8 7.4 17.2 4H20v2.8l-3.4 3.4"/>' +
      '<path d="M5.2 12.5l6.3 6.3M8.3 15.7l-4 4M3.2 18.6l2.2 2.2"/>',
    shield:
      '<path d="M12 2.8 4.5 5.8v5.7c0 4.6 3.1 8 7.5 9.7 4.4-1.7 7.5-5.1 7.5-9.7V5.8z"/>' +
      '<path d="M12 6.8v10.4M8 10.5h8"/>',
    target:
      '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5.2"/>' + dot(12, 12, 1.6),
    flag: '<path d="M5.5 21V3.5M5.5 4h12.5l-2.8 4.5 2.8 4.5H5.5"/>',
    bolt: '<path d="M13.2 2.5 4.8 13.6h6.4l-1.1 7.9 8.3-11.3h-6.3z"/>',
    // Labor-Kolben
    flask:
      '<path d="M9 3h6M10 3v6.2L4.6 18.1a2 2 0 0 0 1.7 3h11.4a2 2 0 0 0 1.7-3L14 9.2V3"/>' +
      '<path d="M7.3 14.5h9.4"/>',
    heart: '<path d="M12 20.3C6.4 16.6 3.3 13.4 3.3 9.4A4.6 4.6 0 0 1 12 7.2a4.6 4.6 0 0 1 8.7 2.2c0 4-3.1 7.2-8.7 10.9z"/>',
    book:
      '<path d="M12 6.6C10 5 7.3 4.5 3.5 4.5v14c3.8 0 6.5.5 8.5 2 2-1.5 4.7-2 8.5-2v-14c-3.8 0-6.5.5-8.5 2.1z"/>' +
      '<path d="M12 6.6v13.9"/>',
    briefcase:
      '<rect x="3.2" y="7" width="17.6" height="13" rx="2"/>' +
      '<path d="M8.8 7V5.3a1.5 1.5 0 0 1 1.5-1.5h3.4a1.5 1.5 0 0 1 1.5 1.5V7M3.2 12.5h17.6M12 11.3v2.4"/>',
    hammer:
      '<path d="M13.2 10.8 4.4 19.6a1.6 1.6 0 0 1-2.2-2.2L11 8.6"/>' +
      '<path d="M9.3 6.9l5.2-5.2 2.2 2.2-1 1 3.9 3.9 1-1 2.2 2.2-5.2 5.2-2.2-2.2 1-1-3.9-3.9-1 1z"/>',
    home:
      '<path d="M3.5 11 12 4l8.5 7"/>' +
      '<path d="M6 9v11.5h12V9"/>' +
      '<path d="M10 20.5v-5.5h4v5.5"/>',
    users:
      '<circle cx="9" cy="8" r="3.5"/>' +
      '<path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6"/>' +
      '<path d="M15.5 4.8a3.5 3.5 0 0 1 0 6.4M17.8 14.3c2.2.8 3.7 2.9 3.7 5.7"/>',
    dots: dot(5.5, 12, 1.7) + dot(12, 12, 1.7) + dot(18.5, 12, 1.7),

    /* ================= Kardio ================= */
    // Laeufer
    run:
      '<circle cx="15" cy="4.5" r="2"/>' +
      '<path d="M6.5 10.4 9.8 8h4l2.8 3.3 3 .6"/>' +
      '<path d="M13.2 8.2 10.4 14l3.6 2.4-1.2 4.6M10.4 14l-2.3 3.4H4.2"/>',
    // Fussspuren
    steps:
      '<path d="M7 2.8c-2 0-3.2 2.3-3.2 4.8 0 2.1.9 3.6 1.1 5.2h4.2c.2-1.6 1.1-3.1 1.1-5.2 0-2.5-1.2-4.8-3.2-4.8z"/>' +
      '<path d="M4.9 15h4.2v1.3a2.1 2.1 0 0 1-4.2 0z"/>' +
      '<path d="M17 6.8c2 0 3.2 2.3 3.2 4.8 0 2.1-.9 3.6-1.1 5.2h-4.2c-.2-1.6-1.1-3.1-1.1-5.2 0-2.5 1.2-4.8 3.2-4.8z"/>' +
      '<path d="M14.9 19h4.2v.4a2.1 2.1 0 0 1-4.2 0z"/>',
    // Sprinter mit Tempo-Strichen
    sprint:
      '<circle cx="17" cy="4.6" r="2"/>' +
      '<path d="M9.8 10.2l3-2.2h3.4l2.5 3 2.6.5"/>' +
      '<path d="M15.2 8.2 12.8 13.6l3.4 2.3-1.1 4.6M12.8 13.6l-2.2 3.2H7"/>' +
      '<path d="M2.5 9.5h4.5M3.5 13h4M2.5 16.5h3"/>',
    bike:
      '<circle cx="5.5" cy="16.5" r="3.7"/><circle cx="18.5" cy="16.5" r="3.7"/>' +
      '<path d="M5.5 16.5 8.8 9.5h6.4M8.8 9.5l3 7h-6.3M15.2 9.5l-3.4 7M15.2 9.5l3.3 7M14.2 6.2h2.2l-1.2 3.3M7.2 7.5h3"/>',
    // Schwimmer ueber Wellen
    swim:
      '<circle cx="16.8" cy="9" r="2.1"/>' +
      '<path d="M3 11.8c2.3-2.8 5.1-4.3 8.4-4.6"/>' +
      '<path d="M7.2 14.3l3.8-2.9 3.2 2.6"/>' +
      '<path d="M2.5 17.5c1.6 0 1.6 1.3 3.2 1.3s1.6-1.3 3.2-1.3 1.6 1.3 3.2 1.3 1.6-1.3 3.2-1.3 1.6 1.3 3.2 1.3 1.6-1.3 3-1.3"/>',
    stairs:
      '<path d="M3 20.5h4.5V16H12v-4.5h4.5V7H21"/>' +
      '<path d="M5 11.5 10.5 6M7.2 5.8h3.3v3.3"/>',
    mountain:
      '<path d="M2.5 20 9.2 8.5l3.6 6 2.5-3.6L21.5 20z"/>' +
      '<path d="M7.1 12.1l1.6 1.2 1.9-1.4"/>',
    // Springseil
    rope:
      '<rect x="3.5" y="2.8" width="3" height="7" rx="1.5"/>' +
      '<rect x="17.5" y="2.8" width="3" height="7" rx="1.5"/>' +
      '<path d="M5 9.8c0 7.3 3.2 10.9 7 10.9s7-3.6 7-10.9"/>',
    // Personenwaage
    scale:
      '<rect x="3.5" y="3.5" width="17" height="17" rx="4"/>' +
      '<path d="M7.6 10.5a5 5 0 0 1 8.8 0z"/>' +
      '<path d="M12 10.5l1.5-2.6"/>',
    calendar:
      '<rect x="3.5" y="5" width="17" height="15.5" rx="2"/>' +
      '<path d="M3.5 9.5h17M8 3v4M16 3v4"/>' +
      '<path d="M8 13.3v.01M12 13.3v.01M16 13.3v.01M8 16.8v.01M12 16.8v.01"/>',
    eye:
      '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/>' +
      '<circle cx="12" cy="12" r="3"/>',
    crown:
      '<path d="M4.3 16.5 3 7.5l4.8 3.8L12 4.5l4.2 6.8L21 7.5l-1.3 9z"/>' +
      '<path d="M4.5 20h15"/>',
    medal:
      '<path d="M8.6 10.6 5.6 3h4.2l2.4 5.6M15.4 10.6 18.4 3h-4.2l-1.1 2.6"/>' +
      '<circle cx="12" cy="15.3" r="5.6"/>' +
      '<path d="M12 12.6l.9 1.8 2 .3-1.5 1.4.4 2-1.8-.9-1.8.9.4-2-1.5-1.4 2-.3z"/>',
    up: '<path d="M6 15l6-6 6 6"/>',
    down: '<path d="M6 9l6 6 6-6"/>',

    /* ================= Fantasy & Gegner ================= */
    // Zaubertrank (runder Kolben mit Korken)
    potion:
      '<path d="M9.3 3h5.4M10.5 3v5.2a6.5 6.5 0 1 0 3 0V3"/>' +
      '<path d="M5.8 14c2 .9 4.1-.7 6.2 0s4.2.9 6.2 0"/>' +
      dot(10.5, 17, 1) + dot(13.8, 16, .8),
    // Wirbelndes Portal
    portal:
      '<ellipse cx="12" cy="12" rx="6.5" ry="9"/>' +
      '<path d="M12 7.2c2.1 0 3.4 2.2 3.4 4.8s-1.4 4.4-3.4 4.4-2.8-1.4-2.8-3.1 1-2.8 2.4-2.8 1.8 1 1.6 2"/>' +
      '<path d="M20.5 4v2.4M19.3 5.2h2.4M3.5 17.5v2.4M2.3 18.7h2.4"/>',
    // Pistole
    gun:
      '<path d="M3 6.5h17.5v4.5H3z"/>' +
      '<path d="M5.5 11 4 20h4.2l1-5.3h3a1.5 1.5 0 0 0 1.5-1.5V11"/>' +
      '<path d="M18 6.5V5M9.8 11v1.8"/>',
    // Drachenkopf im Profil mit Horn und offenem Maul
    dragon:
      '<path d="M4.5 21c0-6 1-9.5 3.5-12.5L3.8 3.5l6.7 3.7c2.7-.4 5.5.1 8 1.1l2.1.7c.6.2.7 1.2.1 1.5L13.2 11.9l5.8 2.5c.5.2.4 1-.1 1.1l-5.4.8c-1.5.4-2.7 1.9-3.3 4.7"/>' +
      dot(14.3, 9.3, 1.1),
    // Trollkopf mit Hauern
    troll:
      '<path d="M6.3 10.2a5.7 5.7 0 0 1 11.4 0v3.6c0 3.7-2.6 6.7-5.7 6.7s-5.7-3-5.7-6.7z"/>' +
      '<path d="M6.3 11.2 3 9.5l.7 3.9 2.6.9M17.7 11.2 21 9.5l-.7 3.9-2.6.9"/>' +
      '<path d="M8.6 10.3l2.2.9M15.4 10.3l-2.2.9M9.8 17.5l.4-2.2M14.2 17.5l-.4-2.2"/>' +
      dot(9.8, 12.6, 1) + dot(14.2, 12.6, 1),
    ghost:
      '<path d="M5.5 20.5V10a6.5 6.5 0 0 1 13 0v10.5l-2.2-1.7-2.1 1.7-2.2-1.7-2.2 1.7-2.1-1.7z"/>' +
      dot(9.6, 10.5, 1.3) + dot(14.4, 10.5, 1.3),
    spider:
      '<ellipse cx="12" cy="14.8" rx="3.2" ry="4"/>' +
      '<circle cx="12" cy="8.6" r="2.2"/>' +
      '<path d="M9.4 12.5 5.5 9.5 4.5 5.5M9 14.8H5l-1.8-2.8M9.4 16.8l-3.6 2.3-1 2.4M10.4 7.3 8.6 4.6 9 2.6"/>' +
      '<path d="M14.6 12.5l3.9-3 1-4M15 14.8h4l1.8-2.8M14.6 16.8l3.6 2.3 1 2.4M13.6 7.3l1.8-2.7-.4-2"/>',
    // Wolfskopf von vorne
    wolf:
      '<path d="M4.5 3.5 8.4 7.6h7.2l3.9-4.1.9 8.2-3.4 3.2-2.5 5.6H9.5L7 14.9l-3.4-3.2z"/>' +
      '<path d="M10.3 17.4h3.4L12 19.1z"/>' +
      dot(9.2, 11.4, 1) + dot(14.8, 11.4, 1),
    // Quadrokopter-Drohne
    drone:
      '<rect x="9.2" y="9.2" width="5.6" height="5.6" rx="1.2"/>' +
      '<path d="M9.2 9.2 7.6 7.6M14.8 9.2l1.6-1.6M9.2 14.8l-1.6 1.6M14.8 14.8l1.6 1.6"/>' +
      '<circle cx="5.8" cy="5.8" r="3"/><circle cx="18.2" cy="5.8" r="3"/><circle cx="5.8" cy="18.2" r="3"/><circle cx="18.2" cy="18.2" r="3"/>' +
      dot(12, 12, 1),
    // Schriftrolle mit Text
    scroll:
      '<path d="M18.5 16V5a2 2 0 0 0-2-2H5"/>' +
      '<path d="M5 3a2 2 0 0 0-2 2v1.5h4V5a2 2 0 0 0-2-2z"/>' +
      '<path d="M7 6.5V19a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-1.2a.8.8 0 0 0-.8-.8H11.8a.8.8 0 0 0-.8.8V19a2 2 0 0 1-2 2"/>' +
      '<path d="M10 8h5.5M10 11h5.5M10 14h3.5"/>',
    // Gefaltete Karte
    map:
      '<path d="M3.5 6.5 9 4.2l6 2.3 5.5-2.3v13.3L15 19.8l-6-2.3-5.5 2.3z"/>' +
      '<path d="M9 4.2v13.3M15 6.5v13.3"/>'
  };

  OP.icons = Object.assign(OP.icons || {}, I);
})();
