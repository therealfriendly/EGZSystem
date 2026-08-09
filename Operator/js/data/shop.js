/* ============================================================
   SHOP-SORTIMENT
   Preise bewusst niedrig — eine Karte bringt 3 bis 30 Muenzen,
   der teuerste Posten kostet gut eine Woche Disziplin.

   Ein Eintrag pro Ware:
     ic   Symbol
     n    Name
     d    Beschreibung
     p    Preis in Muenzen
     buy  wird beim Kauf ausgefuehrt, veraendert den State S
     own  optional: zeigt den Bestand an
     live optional: Zeitstempel, bis wann ein Boost laeuft
   Gerendert von js/ui/shop.js
   ============================================================ */

const SHOP = [
  {ic:"⇄", n:"Tausch-Marke", d:"Tauscht eine gezogene Karte, ohne dass es Münzen oder XP kostet.", p:40,
   buy:()=>S.tokens++, own:()=>S.tokens+" Stück"},

  {ic:"❄", n:"Streak-Joker", d:"Rettet einen Tag, an dem die Checkliste leer geblieben ist. Die Serie läuft weiter.", p:120,
   buy:()=>S.jokers++, own:()=>S.jokers+" Stück"},

  {ic:"◈", n:"Doppelte Belohnung", d:"Die nächste erledigte Karte bringt doppelte XP und doppelte Münzen.", p:80,
   buy:()=>S.dbl=1, own:()=>S.dbl?"scharf":"—"},

  {ic:"⇈", n:"Doppelte XP · 24 h", d:"Einen Tag lang doppelte XP auf jede Karte.", p:150,
   buy:()=>S.xpBoost=Math.max(now(),S.xpBoost)+864e5, live:()=>S.xpBoost},

  {ic:"◎", n:"Mehr Münzen · 24 h", d:"Einen Tag lang anderthalbfache Münzen auf jede Karte.", p:100,
   buy:()=>S.coinBoost=Math.max(now(),S.coinBoost)+864e5, live:()=>S.coinBoost}
];
