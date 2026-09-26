/* Operator – 50 Schmuggler-Auftraege = Kardio-Challenges (global: OP.data.CARDIO)

   Aufbau:
   { id: 'c01'..'c50', name (max. 32 Zeichen), type (Art, fuer Filter/Icon im Schmuggler),
     unit: 'schritte' | 'km' | 'sek' | 'min' | 'wdh' | 'hm' | 'stufen' | 'intervall',
     base:  Startwert (bei 'intervall': Sekunden pro Runde),
     round: Rundungsschritt (jeder Erfolg = +5 %, mindestens aber +1 Schritt),
     limitMin:   Zeitfenster in Minuten fuer Stufe 1,
     limitScale: true  = Zeitfenster waechst mit (+5 %), das Tempo bleibt gleich (Umfang-Aufgaben)
                 false = Zeitfenster bleibt fest, man muss schneller werden (Tempo-Aufgaben),
     sets:  nur bei 'intervall': Anzahl Runden (bleibt fest),
     text:  kurze Schmuggler-Geschichte, how: einfache Anleitung }

   Rechnung (OP.game.cardioInfo): Wert = base × 1,05^Erfolge (gerundet), Zeit = limitMin (× 1,05^Erfolge).
   Beispiel c01: 3.000 Schritte in 60 Minuten → nach 25 Erfolgen ca. 10.150 Schritte in 204 Minuten.
   c01–c05 sind die Start-Werte des Nutzers – bitte nicht aendern, sonst springen die Stufen. */
(function () {
  'use strict';
  var OP = (window.OP = window.OP || {});
  var D = (OP.data = OP.data || {});

  D.CARDIO = [
    /* ---------- Die fuenf Start-Auftraege ---------- */
    { id: 'c01', type: 'schritte', unit: 'schritte', base: 3000, round: 50, limitMin: 60, limitScale: true,
      name: 'Kurierweg durchs Viertel',
      text: 'Ein Brief muss unauffällig durchs Viertel. Geh los, bevor jemand fragt.',
      how: 'Geh die Schritte in der Zeit. Handy oder Uhr zählt mit. Tempo ist egal.' },
    { id: 'c02', type: 'marsch', unit: 'km', base: 2, round: 0.05, limitMin: 30, limitScale: true,
      name: 'Grenzgang',
      text: 'Die Ware muss über die grüne Grenze. Zügig gehen, nicht rennen.',
      how: 'Geh die Strecke zügig in der Zeit. Gehen, nicht joggen. Kurz an der Ampel warten ist ok.' },
    { id: 'c03', type: 'joggen_distanz', unit: 'km', base: 1, round: 0.05, limitMin: 30, limitScale: true,
      name: 'Kurierlauf Sektor 7',
      text: 'Ein Päckchen muss nach Sektor 7. Hauptsache, du kommst an.',
      how: 'Lauf die Strecke am Stück, ohne Gehpause. Tempo ist egal.' },
    { id: 'c04', type: 'joggen_zeit', unit: 'sek', base: 600, round: 15, limitMin: 20, limitScale: true,
      name: 'Patrouille abschütteln',
      text: 'Die Patrouille ist hinter dir. Bleib in Bewegung, bis sie aufgibt.',
      how: 'Jogge so lange am Stück, ohne Gehpause. Tempo ist egal, ganz langsam ist erlaubt.' },
    { id: 'c05', type: 'sprints', unit: 'intervall', sets: 4, base: 20, round: 1, limitMin: 20, limitScale: false,
      name: 'Sprint über den Hof',
      text: 'Scheinwerfer suchen den Hof ab. Sprinte von Deckung zu Deckung.',
      how: 'Sprinte jede Runde so lange wie angegeben. Dazwischen 1–2 Minuten locker gehen.' },

    /* ---------- Schritte ---------- */
    { id: 'c06', type: 'schritte', unit: 'schritte', base: 1500, round: 50, limitMin: 30, limitScale: true,
      name: 'Botengang zum Markt',
      text: 'Nur ein kurzer Botengang: ein Umschlag für den Händler am Markt.',
      how: 'Geh die Schritte in der Zeit. Normales Gehtempo reicht.' },
    { id: 'c07', type: 'schritte', unit: 'schritte', base: 5000, round: 50, limitMin: 90, limitScale: true,
      name: 'Nachtlieferung',
      text: 'Im Dunkeln fällst du nicht auf. Liefere die Ware noch heute Nacht.',
      how: 'Geh die Schritte in der Zeit, gern am Abend. Kurze Pausen sind erlaubt.' },
    { id: 'c08', type: 'schritte', unit: 'schritte', base: 8000, round: 100, limitMin: 150, limitScale: true,
      name: 'Große Runde durch die Stadt',
      text: 'Viele Päckchen, viele Adressen. Das wird ein langer Weg.',
      how: 'Sammle die Schritte in der Zeit. Pausen sind erlaubt, die Uhr läuft aber weiter.' },

    /* ---------- Marsch (zuegig gehen) ---------- */
    { id: 'c09', type: 'marsch', unit: 'km', base: 1.5, round: 0.05, limitMin: 20, limitScale: true,
      name: 'Eilmarsch zum Hafen',
      text: 'Das Boot legt gleich ab. Geh schneller, sonst fährt es ohne dich.',
      how: 'Geh sehr zügig die Strecke in der Zeit. Nicht joggen – nur schnell gehen.' },
    { id: 'c10', type: 'marsch', unit: 'km', base: 3, round: 0.05, limitMin: 45, limitScale: true,
      name: 'Grenzstreife',
      text: 'Geh die Grenze ab und merk dir, wo die Wachen stehen.',
      how: 'Geh die Strecke zügig in der Zeit. Gehen, nicht joggen.' },
    { id: 'c11', type: 'marsch', unit: 'km', base: 5, round: 0.1, limitMin: 75, limitScale: true,
      name: 'Tagesmarsch ins Hinterland',
      text: 'Das Versteck liegt weit draußen. Pack Wasser ein.',
      how: 'Geh die Strecke in der Zeit. Kurze Trinkpausen sind ok.' },
    { id: 'c12', type: 'marsch', unit: 'min', base: 15, round: 1, limitMin: 20, limitScale: true,
      name: 'Abendrunde mit Paket',
      text: 'Ein kleines Paket, eine kleine Runde. Hauptsache, du bleibst in Bewegung.',
      how: 'Geh so viele Minuten zügig am Stück, ohne stehen zu bleiben.' },

    /* ---------- Rucking (Marsch mit Rucksack) ---------- */
    { id: 'c13', type: 'rucking', unit: 'km', base: 1.5, round: 0.05, limitMin: 30, limitScale: true,
      name: 'Rucksack voller Ware',
      text: 'Der Rucksack ist schwer, die Ware wertvoll. Bring sie sicher ans Ziel.',
      how: 'Geh die Strecke mit Rucksack (5–10 kg, z. B. Wasserflaschen). Zügig gehen, nicht joggen.' },
    { id: 'c14', type: 'rucking', unit: 'km', base: 3, round: 0.05, limitMin: 60, limitScale: true,
      name: 'Lastesel der Grenze',
      text: 'Doppelte Ladung, doppelter Lohn. Der Weg über die Grenze ist lang.',
      how: 'Geh die Strecke mit etwa 10 kg im Rucksack. Kurze Pausen sind ok.' },

    /* ---------- Joggen auf Distanz ---------- */
    { id: 'c15', type: 'joggen_distanz', unit: 'km', base: 2, round: 0.05, limitMin: 35, limitScale: true,
      name: 'Fluchtweg durch den Park',
      text: 'Die Wachen haben dich gesehen. Nimm den Weg durch den Park!',
      how: 'Lauf die Strecke am Stück, ohne Gehpause. Langsam ist völlig ok.' },
    { id: 'c16', type: 'joggen_distanz', unit: 'km', base: 3, round: 0.1, limitMin: 45, limitScale: true,
      name: 'Die lange Lieferung',
      text: 'Die Ware muss ans andere Ende der Stadt. Teil dir die Kraft ein.',
      how: 'Lauf die Strecke in der Zeit. Wenn nötig, kurz gehen – aber nicht stehen bleiben.' },
    { id: 'c17', type: 'joggen_distanz', unit: 'km', base: 1, round: 0.05, limitMin: 10, limitScale: false,
      name: 'Eilpaket',
      text: 'Express-Auftrag! Der Kunde zahlt extra, wenn du schnell bist.',
      how: 'Lauf die Strecke in der Zeit. Die Zeit bleibt immer gleich, nur die Strecke wächst.' },
    { id: 'c18', type: 'joggen_distanz', unit: 'km', base: 1.4, round: 0.05, limitMin: 12, limitScale: false,
      name: 'Cooper-Test am Zoll',
      text: 'Der Zoll will sehen, wie weit du in 12 Minuten kommst.',
      how: 'Lauf die Strecke in 12 Minuten. Gehen ist erlaubt, aber dann wird es knapp.' },

    /* ---------- Joggen auf Zeit ---------- */
    { id: 'c19', type: 'joggen_zeit', unit: 'sek', base: 300, round: 15, limitMin: 10, limitScale: true,
      name: 'Dauerlauf im Nebel',
      text: 'Der Nebel gibt dir Deckung – aber nur, solange du in Bewegung bleibst.',
      how: 'Jogge so lange am Stück. Ganz langsam ist erlaubt, nur nicht gehen.' },
    { id: 'c20', type: 'joggen_zeit', unit: 'sek', base: 900, round: 15, limitMin: 25, limitScale: true,
      name: 'Schmugglerpfad im Wald',
      text: 'Der alte Pfad durch den Wald. Wer stehen bleibt, verirrt sich.',
      how: 'Jogge so lange am Stück, ohne Gehpause. Tempo ist egal.' },

    /* ---------- Intervalle (Laufen und Gehen im Wechsel) ---------- */
    { id: 'c21', type: 'intervall', unit: 'intervall', sets: 6, base: 60, round: 5, limitMin: 20, limitScale: true,
      name: 'Lauf-Geh-Kurier',
      text: 'Laufen, verschnaufen, weiterlaufen. So kommt jeder Kurier ans Ziel.',
      how: 'Jogge jede Runde so lange wie angegeben, danach 90 s gehen. Dann die nächste Runde.' },

    /* ---------- Sprints ---------- */
    { id: 'c22', type: 'sprints', unit: 'intervall', sets: 6, base: 15, round: 1, limitMin: 20, limitScale: false,
      name: 'Der Hundestaffel entkommen',
      text: 'Die Wachhunde sind los! Kurze, schnelle Sprints retten dich.',
      how: 'Sprinte jede Runde so lange wie angegeben, dann 1–2 Minuten gehen.' },
    { id: 'c23', type: 'sprints', unit: 'intervall', sets: 5, base: 15, round: 1, limitMin: 20, limitScale: false,
      name: 'Bergsprint zur Hütte',
      text: 'Die Hütte liegt oben am Hang. Nur wer schnell ist, bleibt ungesehen.',
      how: 'Sprinte einen Hügel oder eine Rampe hoch. Langsam runter gehen, dann die nächste Runde.' },
    { id: 'c24', type: 'sprints', unit: 'intervall', sets: 5, base: 20, round: 1, limitMin: 20, limitScale: false,
      name: 'Zickzack durch die Gassen',
      text: 'Enge Gassen, scharfe Kurven. Wer schnell wendet, gewinnt.',
      how: 'Pendelsprint: 10 m hin und zurück, so lange wie angegeben. Dazwischen 1 Minute Pause.' },

    /* ---------- Intervalle zu Hause ---------- */
    { id: 'c25', type: 'intervall', unit: 'intervall', sets: 8, base: 20, round: 1, limitMin: 15, limitScale: false,
      name: 'Scheinwerfer-Tabata',
      text: 'Licht an, Licht aus. Beweg dich nur, wenn der Scheinwerfer wegschaut.',
      how: 'Jede Runde Vollgas (z. B. Hampelmänner oder Kniehebelauf), dann 10 s Pause.' },
    { id: 'c26', type: 'intervall', unit: 'intervall', sets: 4, base: 30, round: 1, limitMin: 10, limitScale: false,
      name: 'Kniehebelauf am Kontrollpunkt',
      text: 'Am Kontrollpunkt heißt es: auf der Stelle laufen, bis das Tor aufgeht.',
      how: 'Lauf auf der Stelle und zieh die Knie hoch. Nach jeder Runde 30 s Pause.' },
    { id: 'c27', type: 'intervall', unit: 'intervall', sets: 3, base: 60, round: 5, limitMin: 15, limitScale: false,
      name: 'Schattenboxen im Keller',
      text: 'Im Keller trainieren die Schmuggler für den Ernstfall. Du bist dran.',
      how: 'Boxe schnell gegen die Luft, so lange wie angegeben. 1 Minute Pause zwischen den Runden.' },

    /* ---------- Treppen ---------- */
    { id: 'c28', type: 'treppen', unit: 'stufen', base: 100, round: 5, limitMin: 10, limitScale: true,
      name: 'Treppenhaus-Lieferung',
      text: 'Der Aufzug ist kaputt. Das Paket muss trotzdem nach ganz oben.',
      how: 'Steig die Stufen hoch (nur aufwärts zählt). Runtergehen und Pausen sind erlaubt.' },
    { id: 'c29', type: 'treppen', unit: 'stufen', base: 300, round: 10, limitMin: 25, limitScale: true,
      name: 'Leuchtturm-Aufstieg',
      text: 'Oben im Leuchtturm wartet der Käufer. Es sind viele Stufen.',
      how: 'Steig die Stufen hoch, nur aufwärts zählt. Du darfst dieselbe Treppe mehrmals nehmen.' },
    { id: 'c30', type: 'treppen', unit: 'min', base: 5, round: 1, limitMin: 10, limitScale: true,
      name: 'Die Bunkertreppe',
      text: 'Rauf, runter, rauf. Die Bunkertreppe ist der einzige Weg.',
      how: 'Geh so viele Minuten Treppen rauf und runter, ohne Pause.' },

    /* ---------- Radfahren ---------- */
    { id: 'c31', type: 'rad', unit: 'km', base: 5, round: 0.1, limitMin: 30, limitScale: true,
      name: 'Fahrradkurier',
      text: 'Schnell rein, schnell raus. Mit dem Rad bist du fast unsichtbar.',
      how: 'Fahr die Strecke mit dem Rad in der Zeit. Gemütliches Tempo reicht.' },
    { id: 'c32', type: 'rad', unit: 'min', base: 20, round: 1, limitMin: 30, limitScale: true,
      name: 'Nachtfahrt durch den Tunnel',
      text: 'Der Tunnel ist lang und dunkel. Tritt in die Pedale und hör nicht auf.',
      how: 'Fahr so viele Minuten Rad am Stück. Der Heimtrainer zählt auch.' },
    { id: 'c33', type: 'rad', unit: 'km', base: 10, round: 0.25, limitMin: 60, limitScale: true,
      name: 'Überlandfahrt',
      text: 'Über Feldwege ins Nachbardorf. Dort wartet eine Kiste auf dich.',
      how: 'Fahr die Strecke mit dem Rad in der Zeit. Kurze Pausen sind ok.' },
    { id: 'c34', type: 'rad', unit: 'km', base: 3, round: 0.05, limitMin: 12, limitScale: false,
      name: 'Tempofahrt zur Grenze',
      text: 'Die Grenze schließt bald. Jetzt zählt nur Tempo.',
      how: 'Fahr die Strecke in der Zeit. Die Zeit bleibt immer gleich, nur die Strecke wächst.' },

    /* ---------- Seilspringen ---------- */
    { id: 'c35', type: 'seil', unit: 'wdh', base: 50, round: 5, limitMin: 5, limitScale: true,
      name: 'Seilspringen im Hinterhof',
      text: 'Im Hinterhof wartet der Kontaktmann. Spring, bis er kommt.',
      how: 'Spring Seil (oder ohne Seil in der Luft). Pausen sind erlaubt, es zählen nur die Sprünge.' },
    { id: 'c36', type: 'seil', unit: 'sek', base: 45, round: 5, limitMin: 5, limitScale: true,
      name: 'Dauerspringer am Kai',
      text: 'Die Kisten werden verladen. So lange hüpfst du ohne Pause.',
      how: 'Spring Seil am Stück, ohne Unterbrechung. Wenn du stolperst, fang einfach neu an.' },

    /* ---------- Hampelmaenner und Burpees ---------- */
    { id: 'c37', type: 'hampelmann', unit: 'wdh', base: 30, round: 1, limitMin: 3, limitScale: false,
      name: 'Hampelmänner am Zaun',
      text: 'Die Wache soll denken, du machst nur Sport. Also: hampeln!',
      how: 'Mach die Hampelmänner in der Zeit. Kurze Pausen sind erlaubt.' },
    { id: 'c38', type: 'burpees', unit: 'wdh', base: 10, round: 1, limitMin: 5, limitScale: true,
      name: 'Burpees im Laderaum',
      text: 'Runter in Deckung, hoch zum Fenster. Immer wieder.',
      how: 'Burpee: in die Hocke, Beine nach hinten, zurück, hochspringen. Pausen sind erlaubt.' },
    { id: 'c39', type: 'burpees', unit: 'wdh', base: 12, round: 1, limitMin: 4, limitScale: false,
      name: 'Leise Burpees im Versteck',
      text: 'Die Wache schläft nebenan. Trainieren ja – aber ohne Lärm.',
      how: 'Burpees ohne Sprung: in die Hocke, Beine nach hinten, zurück, aufstehen. Pausen sind ok.' },

    /* ---------- Wandern und bergauf ---------- */
    { id: 'c40', type: 'wandern', unit: 'hm', base: 50, round: 5, limitMin: 30, limitScale: true,
      name: 'Pfad über den Pass',
      text: 'Der Pass ist steil, aber unbewacht. Nur wer hochkommt, kommt durch.',
      how: 'Geh bergauf, bis du die Höhenmeter hast (Uhr oder App misst sie). 1 Etage ≈ 3 Höhenmeter.' },
    { id: 'c41', type: 'wandern', unit: 'km', base: 4, round: 0.1, limitMin: 75, limitScale: true,
      name: 'Wanderung zum Versteck',
      text: 'Das Versteck liegt im Wald. Nimm den langen Weg, da sucht dich keiner.',
      how: 'Wandere die Strecke in der Zeit. Gehen reicht, Pausen sind ok.' },
    { id: 'c42', type: 'wandern', unit: 'hm', base: 150, round: 5, limitMin: 60, limitScale: true,
      name: 'Gipfelkurier',
      text: 'Ganz oben auf dem Berg wartet ein Käufer mit viel Gold.',
      how: 'Sammle die Höhenmeter bergauf in der Zeit. Treppen zählen auch (1 Etage ≈ 3 Höhenmeter).' },

    /* ---------- Rudern ---------- */
    { id: 'c43', type: 'rudern', unit: 'min', base: 10, round: 1, limitMin: 15, limitScale: true,
      name: 'Ruderboot über den Fluss',
      text: 'Kein Motor, kein Lärm. Nur du, das Ruder und die Ware.',
      how: 'Rudere so viele Minuten am Stück (Rudergerät oder Boot). Ruhiges Tempo reicht.' },
    { id: 'c44', type: 'rudern', unit: 'km', base: 1, round: 0.05, limitMin: 10, limitScale: true,
      name: 'Nebelüberfahrt',
      text: 'Im Nebel über den See, bevor die Küstenwache aufwacht.',
      how: 'Rudere die Strecke in der Zeit (das Rudergerät zeigt die Meter). Kurze Pausen sind ok.' },

    /* ---------- Schwimmen ---------- */
    { id: 'c45', type: 'schwimmen', unit: 'min', base: 10, round: 1, limitMin: 15, limitScale: true,
      name: 'Durch das Hafenbecken',
      text: 'Die Wachen schauen auf die Brücke, nicht ins Wasser. Schwimm!',
      how: 'Schwimm so viele Minuten am Stück. Langsam und ruhig ist völlig ok.' },
    { id: 'c46', type: 'schwimmen', unit: 'km', base: 0.2, round: 0.01, limitMin: 15, limitScale: true,
      name: 'Tauchgang zur Kiste',
      text: 'Eine Kiste liegt am Grund des Hafens. Schwimm hin und hol sie.',
      how: 'Schwimm die Strecke in der Zeit (0,1 km = 100 m). Pausen am Rand sind erlaubt.' },

    /* ---------- Sonstiges ---------- */
    { id: 'c47', type: 'crosstrainer', unit: 'min', base: 10, round: 1, limitMin: 15, limitScale: true,
      name: 'Stepper im Lagerhaus',
      text: 'Im Lagerhaus steht ein alter Crosstrainer. Perfekt zum Warten.',
      how: 'Trainiere so viele Minuten am Crosstrainer oder Stepper, ohne Pause.' },
    { id: 'c48', type: 'tanzen', unit: 'min', base: 10, round: 1, limitMin: 15, limitScale: true,
      name: 'Tanz auf dem Schwarzmarkt',
      text: 'Laute Musik lenkt die Wachen ab. Tanz, bis der Deal durch ist.',
      how: 'Tanz so viele Minuten zu Musik, ohne Pause. Hauptsache, du bewegst dich.' },
    { id: 'c49', type: 'joggen_distanz', unit: 'km', base: 5, round: 0.1, limitMin: 70, limitScale: true,
      name: 'Die große Schmuggelroute',
      text: 'Die längste Route der Schmuggler. Wer sie schafft, ist ein Profi.',
      how: 'Lauf und geh im Wechsel, bis du die Strecke geschafft hast. Tempo ist egal.' },
    { id: 'c50', type: 'marsch', unit: 'km', base: 2.5, round: 0.05, limitMin: 40, limitScale: true,
      name: 'Stockmarsch durchs Moor',
      text: 'Mit zwei Stöcken wirkst du wie ein harmloser Wanderer. Perfekt.',
      how: 'Nordic Walking: Geh die Strecke zügig mit Stöcken. Ohne Stöcke geht es auch.' }
  ];
})();
