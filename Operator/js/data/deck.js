/* ============================================================
   KARTENSTAPEL — Startbestand
   ------------------------------------------------------------
   Karten sagen nur, WAS und WIE VIEL. Wie du es machst, steht in
   deinen anderen Apps — hier steht kein Trainingsplan drin.
   Also "5.000 Schritte", nicht "Kurze Runde, reicht schon um…".

   Der Inhalt unten ist reines JSON. Er steht in einer .js-Datei
   und nicht in einer .json-Datei, weil ein fetch() auf eine
   lokale Datei von file:// aus am CORS-Schutz des Browsers
   scheitert. So laesst sich index.html per Doppelklick oeffnen.

   Felder pro Karte:
     titel    das Ergebnis, knapp
     text     der Spruch unter dem Titel. Kurz, trocken, kein
              Motivationsposter. Optional — leer heisst, die
              Zeile wird gar nicht gerendert.
     feld     Schluessel aus CATS (js/config.js)
     stufe    1..5, bestimmt die Belohnung ueber REWARD
     minuten  0 = kein Timer, sonst Countdown in Minuten

   Diese Liste ist nur der Startbestand. Beim ersten Start wird
   sie in den Spielstand kopiert; ab dann bearbeitet man Karten
   im Tab "Karten". Ueber "Standard wiederherstellen" laedt man
   diese Liste erneut.

   WICHTIG: Nach inhaltlichen Aenderungen hier DECK_VERSION in
   js/config.js hochzaehlen. Sonst behalten bestehende Spielstaende
   ihren alten Stapel.
   ============================================================ */

const DECK_SEED = [

/* ================= SCHRITTE ================= */
{ "titel":"2.000 Schritte",  "text":"Kaum der Rede wert. Trotzdem raus.",              "feld":"SCHRITTE", "stufe":1, "minuten":0 },
{ "titel":"3.000 Schritte",  "text":"Schuhe an. Fragen später.",                       "feld":"SCHRITTE", "stufe":1, "minuten":0 },
{ "titel":"5.000 Schritte",  "text":"Reicht nicht zum Angeben. Reicht zum Anfangen.",  "feld":"SCHRITTE", "stufe":2, "minuten":0 },
{ "titel":"7.000 Schritte",  "text":"Die Strecke, die niemand sieht.",                 "feld":"SCHRITTE", "stufe":2, "minuten":0 },
{ "titel":"10.000 Schritte", "text":"Die Zahl, über die alle reden. Heute machst du sie.", "feld":"SCHRITTE", "stufe":3, "minuten":0 },
{ "titel":"12.000 Schritte", "text":"Wetter ist kein Argument.",                       "feld":"SCHRITTE", "stufe":3, "minuten":0 },
{ "titel":"15.000 Schritte", "text":"Der Tag richtet sich nach dir, nicht umgekehrt.", "feld":"SCHRITTE", "stufe":4, "minuten":0 },
{ "titel":"20.000 Schritte", "text":"Keine Ausreden. Nur Kilometer.",                  "feld":"SCHRITTE", "stufe":5, "minuten":0 },

/* ================= TRAINING ================= */
{ "titel":"Beintraining",     "text":"Der Tag, den alle verschieben. Nicht du.",       "feld":"TRAINING", "stufe":3, "minuten":0 },
{ "titel":"Oberkörper",       "text":"Drücken, ziehen, fertig.",                       "feld":"TRAINING", "stufe":3, "minuten":0 },
{ "titel":"Rücken",           "text":"Was du nicht siehst, trägt dich trotzdem.",      "feld":"TRAINING", "stufe":3, "minuten":0 },
{ "titel":"Brust",            "text":"Der letzte Satz entscheidet.",                   "feld":"TRAINING", "stufe":3, "minuten":0 },
{ "titel":"Schultern",        "text":"Klein, undankbar, notwendig.",                   "feld":"TRAINING", "stufe":2, "minuten":0 },
{ "titel":"Arme",             "text":"Ja, auch die. Keine Ausreden.",                  "feld":"TRAINING", "stufe":2, "minuten":0 },
{ "titel":"Bauch",            "text":"Brennt. Soll es auch.",                          "feld":"TRAINING", "stufe":2, "minuten":0 },
{ "titel":"Liegestütze",      "text":"Boden, du und sonst nichts.",                    "feld":"TRAINING", "stufe":2, "minuten":0 },
{ "titel":"Klimmzüge",        "text":"Hochziehen oder hängen bleiben.",                "feld":"TRAINING", "stufe":3, "minuten":0 },
{ "titel":"Dips",             "text":"Runter ist leicht. Hoch zählt.",                 "feld":"TRAINING", "stufe":2, "minuten":0 },
{ "titel":"Kniebeugen",       "text":"Tief oder gar nicht.",                           "feld":"TRAINING", "stufe":3, "minuten":0 },
{ "titel":"Plank",            "text":"Nur halten. Das ist der ganze Trick.",           "feld":"TRAINING", "stufe":1, "minuten":0 },
{ "titel":"Dehnen",           "text":"Heute langweilig, in zehn Jahren dankbar.",      "feld":"TRAINING", "stufe":1, "minuten":0 },
{ "titel":"Cardio",           "text":"Tempo egal. Stehenbleiben nicht.",               "feld":"TRAINING", "stufe":2, "minuten":0 },
{ "titel":"Laufen",           "text":"Der erste Kilometer lügt.",                      "feld":"TRAINING", "stufe":3, "minuten":0 },
{ "titel":"Doppelte Einheit", "text":"Einmal ist Pflicht. Zweimal ist eine Ansage.",   "feld":"TRAINING", "stufe":5, "minuten":0 },

/* ================= LERNEN ================= */
{ "titel":"30 Minuten lernen", "text":"Eine halbe Stunde. Selbst dafür gibt es Ausreden.", "feld":"LERNEN", "stufe":1, "minuten":30 },
{ "titel":"1 Stunde lernen",   "text":"Tür zu. Handy weg.",                                "feld":"LERNEN", "stufe":1, "minuten":60 },
{ "titel":"2 Stunden lernen",  "text":"Ab jetzt wird es unbequem.",                        "feld":"LERNEN", "stufe":2, "minuten":120 },
{ "titel":"3 Stunden lernen",  "text":"Hier trennt es sich.",                              "feld":"LERNEN", "stufe":3, "minuten":180 },
{ "titel":"4 Stunden lernen",  "text":"Der Kopf will aufhören. Der Kopf entscheidet nicht.","feld":"LERNEN", "stufe":4, "minuten":240 },
{ "titel":"5 Stunden lernen",  "text":"Ein ganzer Arbeitstag. Diesmal für dich.",          "feld":"LERNEN", "stufe":5, "minuten":300 },

/* ================= HACKEN ================= */
{ "titel":"1 Easy Box",         "text":"Aufwärmen. Mehr nicht.",                          "feld":"HACKEN", "stufe":2, "minuten":0 },
{ "titel":"1 Medium Box",       "text":"Kein Walkthrough. Kein Discord.",                 "feld":"HACKEN", "stufe":3, "minuten":0 },
{ "titel":"1 Hard Box",         "text":"Wenn es leicht wäre, hieße es anders.",           "feld":"HACKEN", "stufe":4, "minuten":0 },
{ "titel":"1 Insane Box",       "text":"Viel Glück. Ernst gemeint.",                      "feld":"HACKEN", "stufe":5, "minuten":0 },
{ "titel":"2 Easy Boxen",       "text":"Doppelt aufgewärmt ist halb geknackt.",           "feld":"HACKEN", "stufe":3, "minuten":0 },
{ "titel":"1 Easy Challenge",   "text":"In der Zeit, in der andere scrollen.",            "feld":"HACKEN", "stufe":1, "minuten":0 },
{ "titel":"1 Medium Challenge", "text":"Erst denken. Dann Tools.",                        "feld":"HACKEN", "stufe":2, "minuten":0 },
{ "titel":"1 Hard Challenge",   "text":"Der Punkt, an dem die meisten zumachen.",         "feld":"HACKEN", "stufe":3, "minuten":0 },
{ "titel":"1 Insane Challenge", "text":"Die Kategorie, die sonst niemand anfasst.",       "feld":"HACKEN", "stufe":4, "minuten":0 },
{ "titel":"1 Lab-Modul",        "text":"Ein Modul. Ganz. Nicht überflogen.",              "feld":"HACKEN", "stufe":3, "minuten":0 },
{ "titel":"1 Write-up",         "text":"Erklären ist der Beweis, dass du es kannst.",     "feld":"HACKEN", "stufe":2, "minuten":0 }

];
