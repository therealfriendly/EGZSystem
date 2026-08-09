/* ============================================================
   UI · ROLL — die Ziehanimation
   Kein Automat, keine Walzen. Kandidaten aus dem Stapel blitzen
   durch, werden kubisch langsamer und bleiben auf der gezogenen
   Karte stehen. Danach klappt die Karte auf.
   Styles in css/draw.css
   ============================================================ */

let rolling = false;        // sperrt renderRun waehrend der Animation
let rollTimer = null;

/* card = die bereits gezogene Karte, done() laeuft am Ende */
function rollTo(card, done){
  const area = $("#cardArea");

  /* Systemeinstellung respektieren: kein Geflacker, direkt Ergebnis */
  if(reducedMotion()){ done(); return; }

  rolling = true;
  const pool = drawPool();
  const c = CATS[card.cat];

  area.innerHTML = `
    <div class="roll" id="roll">
      <div class="rolllabel">Karte wird gezogen</div>
      <div class="rolltext" id="rollText">—</div>
      <div class="rollbar"><i id="rollBar"></i></div>
    </div>`;

  const txt = $("#rollText"), bar = $("#rollBar"), box = $("#roll");
  const t0 = now();

  const step = ()=>{
    const p = clamp((now()-t0)/TUNE.rollMs, 0, 1);

    if(p >= 1){
      txt.textContent = card.title;
      txt.style.color = c.c;
      box.style.setProperty("--cc", c.c);
      box.classList.add("lock");
      bar.style.width = "100%";
      blip(760,.15,"triangle",.05); buzz([30,50,40]);
      setTimeout(done, 420);
      return;
    }

    const pick = pool[Math.floor(Math.random()*pool.length)];
    const pc = CATS[pick.cat] || c;
    txt.textContent = pick.title;
    txt.style.color = pc.c;
    bar.style.width = (p*100)+"%";
    blip(210 + Math.random()*70, .014, "square", .014);

    /* p hoch 3 bremst spaet und hart ab — fuehlt sich an, als
       fiele die Auswahl erst am Schluss. */
    rollTimer = setTimeout(step, TUNE.rollFast + Math.pow(p,3)*TUNE.rollSlow);
  };

  step();
}

/* Sicherheitsnetz: laufende Animation abbrechen */
function stopRoll(){
  clearTimeout(rollTimer);
  rolling = false;
}
