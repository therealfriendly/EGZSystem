/* ============================================================
   CONFIG — alle Stellschrauben an einem Ort
   Wird als erstes geladen, haengt von nichts ab.
   ============================================================ */

const APP = { name:"Operator", coin:"◎" };

/* Felder. Neues Feld hier eintragen, dann Karten in
   js/data/deck.js mit demselben Schluessel versehen — Filter,
   Kalenderfarben und Statistik ziehen automatisch nach. */
const CATS = {
  SCHRITTE:{n:"Schritte", c:"#00ffa3", i:"→"},
  TRAINING:{n:"Training", c:"#ff2e63", i:"▲"},
  LERNEN  :{n:"Lernen",   c:"#a86bff", i:"≡"},
  HACKEN  :{n:"Hacken",   c:"#00e5ff", i:"⌁"}
};

/* Hochzaehlen, wenn sich DECK_SEED inhaltlich aendert. Bestehende
   Spielstaende bekommen den neuen Stapel dann beim naechsten Start,
   ohne dass Serie, XP oder Erfolge verloren gehen. */
const DECK_VERSION = 3;

/* Index 1..5, passt zu den Klassen .d1–.d5 in css/draw.css */
const DIFF = ["","Leicht","Normal","Fordernd","Hart","Extrem"];

/* Belohnung pro Stufe. Bewusst klein gehalten — eine Karte gibt
   3 bis 30 Muenzen, kein Zahlensalat. */
const REWARD = {
  1:{xp:10, c:3},
  2:{xp:18, c:6},
  3:{xp:30, c:10},
  4:{xp:48, c:18},
  5:{xp:70, c:30}
};

/* Rang = Level. Ab dem letzten Eintrag bleibt der Rang stehen. */
const RANKS = [
  ["Niemand",         "#6f6a8c"],
  ["Anfänger",        "#8b86ab"],
  ["Amateur",         "#7ee0b8"],
  ["Fortgeschritten", "#00ffa3"],
  ["Profi",           "#00e5ff"],
  ["Experte",         "#4aa8ff"],
  ["Spezialist",      "#a86bff"],
  ["Veteran",         "#d16bff"],
  ["Meister",         "#ffc233"],
  ["Elite",           "#ff8a3d"],
  ["Legende",         "#ff2e63"]
];
const rankOf = l => RANKS[Math.min(l, RANKS.length) - 1];

/* Erfolgsstufen. Gelten fuer jeden Checklisten-Punkt einzeln
   und zusaetzlich fuer alle gezogenen Karten zusammen. */
const TIERS = [
  {n:"Bronze",     s:"Ich komm in den Schwung",            at:10,   c:"#c87d3f"},
  {n:"Silber",     s:"Wie lange noch",                     at:100,  c:"#c3cbd6"},
  {n:"Gold",       s:"Unaufhaltsam",                       at:250,  c:"#ffc233"},
  {n:"Diamant",    s:"Hat das alles einen Sinn",           at:500,  c:"#6de3ff"},
  {n:"Regenbogen", s:"Selbst die Stoiker werden neidisch", at:1000, c:"#ff7ad9"}
];

const MON = ["Januar","Februar","März","April","Mai","Juni","Juli","August","September","Oktober","November","Dezember"];

/* ---------- Balance ---------- */
const TUNE = {
  xpBase:        80,   // XP fuer Level 1
  xpStep:        60,   // zusaetzliche XP pro weiterem Level

  dayXp:         15,   // Belohnung, wenn die Checkliste voll ist
  dayCoins:      5,

  streakCap:     10,   // ab so vielen Serientagen waechst der Bonus nicht mehr
  streakBonus:   0.03, // +3 % pro Serientag, also hoechstens +30 %

  swapBase:      15,   // Muenzen fuer den 2. Kartentausch am Tag, danach doppelt
  swapXp:        5,    // XP-Abzug je bereits getauschter Karte

  recentMemory:  10,   // so viele zuletzt gezogene Karten werden gemieden
  histMax:       300,  // maximale Eintraege im Protokoll
  maxChecklist:  3,    // harte Obergrenze fuer die Checkliste

  rollMs:        1900, // Dauer der Ziehanimation
  rollFast:      42,   // kuerzester Abstand zwischen zwei Titeln, in ms
  rollSlow:      300   // zusaetzlicher Abstand am Ende (kubisch ausgebremst)
};

/* XP-Bedarf fuer ein bestimmtes Level */
const need = l => TUNE.xpBase + (l - 1) * TUNE.xpStep;

/* Gesamt-XP -> {lvl, into (XP im aktuellen Level), need} */
function levelInfo(xp){
  let l = 1, rest = xp;
  while(rest >= need(l)){ rest -= need(l); l++; }
  return {lvl:l, into:rest, need:need(l)};
}

/* Schluessel im Speicher. Beim Aendern des Datenformats hochzaehlen. */
const STORAGE_KEY = "operator_v1";
