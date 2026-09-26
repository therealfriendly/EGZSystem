# Operator

Dein Labs Runner. **L**oss **A**lways **B**uilds **S**trength.
Ein Spiel, das dein echtes Training, deine Tages-Quests und deine Kalorienschulden zählt.

## Starten

Die App ist eine Web-App (PWA). Es gibt keinen Build-Schritt: Dateien ändern, Seite neu laden, fertig.

**Am PC testen** (Node ist installiert):

```
cd C:\Operator
npx serve .
```

Dann im Browser die angezeigte Adresse öffnen (z. B. `http://localhost:3000`).
Direkt per Doppelklick auf `index.html` geht es **nicht** richtig (Service Worker und Speichern brauchen einen Server).

**Aufs Handy** (iPhone oder Android): Die App braucht eine HTTPS-Adresse. Am einfachsten:

- **GitHub Pages**: Ordner in ein GitHub-Repository hochladen → Settings → Pages → Branch wählen.
- **Netlify Drop**: <https://app.netlify.com/drop> öffnen und den Ordner `C:\Operator` hineinziehen.

Dann auf dem Handy installieren:

- **iPhone**: Adresse in Safari öffnen → Teilen-Knopf → „Zum Home-Bildschirm“.
- **Android**: Adresse in Chrome öffnen → Menü (⋮) → „App installieren“.

## Spielstand

Der Spielstand liegt nur in diesem Browser (localStorage).
Sichern: **Zauberbude → Spielstand sichern → Kopieren** oder **Als Datei speichern**.
Laden: **Zauberbude → Importieren** (Text einfügen). So kannst du den Spielstand auch vom PC aufs Handy bringen.

## Eigene Bilder (Sprites)

Leg deine Bilder in den Ordner **`assets/sprites/`**. Die App findet sie von selbst, kein Code nötig.
Genaue Dateinamen und Größen stehen in **`assets/sprites/LIESMICH.txt`**.

Das Kartenbild liegt in **`assets/map/world.jpg`**. Dein Original-Stilbild liegt daneben als `vorlage-original.png`.

## Wo stelle ich was ein?

| Was | Datei |
| --- | --- |
| Ränge, Schwierigkeiten, Bauch-Übungen, Quest-Kategorien, Retention | `js/data/constants.js` |
| Die 100 Gegner | `js/data/enemies.js` |
| Die 50 Schmuggler-Aufträge (Kardio) | `js/data/cardio.js` |
| Achievements | `js/data/achievements.js` |
| Alle Spielregeln (XP, Kampf, Gym, Streak …) | `js/logic/game.js` |
| Knöpfe auf der Karte (Position, Größe, Sprite) | `js/ui/map-config.js` |
| Farben und Grund-Design | `css/base.css` (oben die Farb-Variablen) |

**Wichtig nach Änderungen:** In `sw.js` die Zeile mit `VERSION` hochzählen (z. B. `operator-1.0.1`).
Dann holt sich die installierte App sicher die neuen Dateien.

## Ordner

```
index.html              lädt alles
manifest.webmanifest    App-Name und Icons fürs Handy
sw.js                   Service Worker (offline nutzbar)
css/                    Design (base.css = Grundlage, screens/ = je Gebäude)
js/core/                Hilfsfunktionen und Speichern
js/data/                Spielwerte, Gegner, Kardio, Achievements
js/logic/game.js        Spielregeln
js/ui/                  Karte, Icons, Bausteine
js/three/holo.js        3D-Hologramme (Körper und Gegner, three.js r128)
js/screens/             ein Skript pro Bildschirm
assets/                 Karte, Icons, Schrift, deine Sprites
```
