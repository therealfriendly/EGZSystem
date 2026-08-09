# Operator

https://therealfriendly.github.io/EGZSystem/Operator/index.html

Habit Tracker mit Zufallsanteil. Oben rechts steht die Pflicht: eine Checkliste mit
bis zu drei Punkten, die jeden Tag abgehakt werden muss. Erst wenn sie voll ist, gibt
die App eine zufällige Karte frei — Schritte, Training, Lernen oder Hacken. Karten sind
freiwillig und bringen XP und Münzen.

Karten nennen nur das Ergebnis: „7.000 Schritte“, „3 Stunden lernen“, „1 Hard Box“.
Wie du das machst, steht in deinen anderen Apps — hier steht kein Trainingsplan.

Starten: `index.html` im Browser öffnen. Kein Build, keine Abhängigkeiten, kein Server
nötig — funktioniert per Doppelklick genauso wie gehostet oder als PWA.

## Aufbau

```
index.html           Einstieg: Markup der sechs Screens + Ladereihenfolge
manifest.webmanifest PWA-Manifest (Name, Farben, Icons)
raid.original.html   Archiv der allerersten Einzeldatei (kann weg)

icons/               App-Icons, erzeugt von tools/make-icons.ps1
tools/make-icons.ps1 Icon-Generator (PowerShell + System.Drawing)

css/
  base.css           Design-Tokens (:root), Reset, Body, Screen-Container
  components.css     Panel, Buttons, Chips, Listen, Diagramme, Formulare
  hud.css            Kopfzeile: Level, XP, Münzen, Checkliste, Serie
  draw.css           Ziehanimation, gezogene Karte, Timer
  calendar.css       Monatsraster
  achievements.css   Erfolgsspuren und Stufen
  nav.css            Tab-Leiste unten
  overlays.css       Toasts, Aufstiegs-Flash, Modal

js/
  config.js          CATS, DIFF, REWARD, RANKS, TIERS, TUNE, levelInfo()
  data/deck.js       Kartenstapel (Startbestand, reines JSON)
  data/shop.js       Shop-Sortiment
  utils.js           $, el, esc, Datums- und Zahlenhelfer, setAccent()
  fx.js              blip(), buzz(), toast(), loot(), openModal()
  state.js           S, Store, DEF(), Checkliste, Serie, Erfolge, Belohnung
  ui/hud.js          Kopfzeile + Checklisten-Editor + levelUp()
  ui/roll.js         Ziehanimation
  ui/run.js          Heute-Screen: Sperre, Ziehen, Timer, Erledigt, Tauschen
  ui/log.js          Kalender und Tagesdetail
  ui/shop.js         Shop und Rangleiter
  ui/achievements.js Erfolge
  ui/cards.js        Karteneditor
  ui/profile.js      Kennzahlen, Verlauf, Protokoll
  app.js             renderAll(), Navigation, Daten-Panel, init()
```

## Spielregeln im Code

- **Checkliste ist die Pflicht.** `S.checklist` hält höchstens `TUNE.maxChecklist`
  Punkte. Abhaken läuft über `toggleCheck()` in `state.js`.
- **Ein Tag zählt für die Serie, wenn `S.days[k].ok` gesetzt ist** — also wenn die
  Checkliste an dem Tag einmal voll war, oder ein Joker den Tag gerettet hat.
  `ok` wird nie zurückgenommen: wer die Checkliste später ändert, verliert keine
  bereits verdienten Tage.
- **Karten sind optional.** Sie erhöhen `S.days[k].d` und erscheinen im Kalender nur
  als kleine Zahl. Grün wird ein Tag ausschließlich über die Checkliste.
- **Gezogen wird nur bei offener Sperre.** `checklistDone(today())` steuert sowohl den
  Button als auch `drawCard()`.

## Konventionen

- **Klassische Scripts, keine Module.** Alles liegt im globalen Scope, deshalb ist die
  Reihenfolge der `<script>`-Tags in `index.html` die Abhängigkeitskette:
  Konfiguration → Daten → Helfer → Zustand → UI → App.
- **`S` ist der einzige veränderliche Zustand.** Nach jeder Änderung `save()` aufrufen.
- **Ein `renderX()` pro Panel.** `renderAll()` in `app.js` ruft alle auf.
- **Nutzertext immer durch `esc()`.** Kartentitel und Checklisten-Namen landen in
  Template-Strings und werden als HTML eingesetzt.
- **Farben kommen aus CSS-Variablen.** `--acc` global (`setAccent()`), `--cc` das
  aktuelle Feld, `--rc` die Rangfarbe, `--tcol` die Erfolgsstufe.

## Erweitern

**Neue Karte** → im Tab *Karten* über „+ Neue Karte“. Dauerhaft im Startbestand:
Eintrag in `js/data/deck.js` anhängen, dann entweder einmal „Standard wiederherstellen“
drücken oder `DECK_VERSION` in `js/config.js` hochzählen — dann bekommt jeder
Spielstand den neuen Stapel beim nächsten Start, ohne Serie, XP oder Erfolge zu
verlieren. Eine Karte braucht nur einen Titel; das Feld `text` ist der Spruch, der klein
unter dem Titel steht, und darf leer bleiben — dann entfällt die Zeile.

**Neues Feld** → Eintrag in `CATS` (`js/config.js`) mit Name, Farbe und Symbol. Filter,
Kalenderfarben und Verteilung ziehen automatisch nach. Fällt ein Feld weg, räumt
`init()` die verwaisten Filter beim nächsten Start auf.

**Balance ändern** → `TUNE` und `REWARD` in `js/config.js`. Die Zahlen sind bewusst
klein: eine Karte gibt 3 bis 30 Münzen, der teuerste Shop-Posten kostet 150.

**Erfolgsstufen ändern** → `TIERS` in `js/config.js`. Eine Spur entsteht automatisch
pro Checklisten-Punkt, plus eine für alle Karten zusammen.

**Neuer Screen** → `<section class="screen" id="s-xyz">` in `index.html`, ein
`<button data-s="s-xyz">` in `#nav`, `js/ui/xyz.js` mit `renderXyz()`, Script-Tag
einhängen, Aufruf in `renderAll()` ergänzen.

**Neues Feld im Spielstand** → in `DEF()` in `js/state.js` ergänzen. Bestehende
Spielstände erben es beim Laden, weil `init()` über `DEF()` merged.

## Icons und Installation

Motiv ist der Level-Ring aus dem HUD mit dem Checklisten-Haken darin, in `--acc`
auf `--bg`. Alle Dateien in `icons/` erzeugt `tools/make-icons.ps1` neu:

```powershell
.\tools\make-icons.ps1
```

Geometrie und Farben stehen oben im Skript. `icons/icon.svg` ist von Hand gepflegt
und muss bei Änderungen mitgezogen werden.

| Datei | wofür |
|---|---|
| `icon-192.png`, `icon-512.png` | Manifest, `purpose: any` |
| `icon-maskable-192.png`, `-512.png` | Android-Adaptive-Icons, Motiv auf 90 % verkleinert damit es in der 80-%-Sicherheitszone bleibt |
| `apple-touch-icon.png` (180) | iOS-Homescreen. Muss PNG sein — Safari ignoriert SVG an dieser Stelle |
| `favicon-32.png` | Rückfall für Browser ohne SVG-Favicon, ohne Schein weil der bei 32 px die Kontur zufrisst |
| `icon.svg` | Favicon moderner Browser, skaliert verlustfrei |

**Installieren geht nur über http(s).** Browser werten das Manifest bei `file://`
nicht aus, „Zum Startbildschirm hinzufügen“ liefert dort nur eine Verknüpfung ohne
Icon. Zum Testen reicht ein beliebiger statischer Server im Projektordner; dauerhaft
tut es jedes Static-Hosting.

## Daten

Der Spielstand liegt unter `operator_v1` — bevorzugt in `window.storage` (App-Hülle),
sonst in `localStorage`. Sicherung über Profil → Daten → Export.

Der Kartenstapel wird beim ersten Start aus `js/data/deck.js` in den Spielstand kopiert.
Ab dann ist `S.deck` maßgeblich; Änderungen an `deck.js` erreichen die App erst über
„Standard wiederherstellen“ im Tab *Karten*.

Der Inhalt von `js/data/deck.js` ist reines JSON in einem `const`-Wrapper. Es ist
absichtlich keine `.json`-Datei: ein `fetch()` auf eine lokale Datei scheitert von
`file://` aus am CORS-Schutz, dann ließe sich `index.html` nicht mehr per Doppelklick
öffnen. Beim Hosten kann man auf eine echte `.json` plus `fetch()` umstellen.
