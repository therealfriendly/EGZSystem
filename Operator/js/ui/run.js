/* ============================================================
   UI · HEUTE — Ziehen, gezogene Karte, Timer, Feldfilter
   Gezogen werden darf erst, wenn die Checkliste voll ist.
   Styles in css/draw.css
   ============================================================ */

let tickTimer = null;

function renderRun(){
  if(rolling) return;                        // laufende Animation nicht ueberschreiben

  const k = today(), d = dayRec(k), gate = checklistDone(k), st = streakOf();
  const area = $("#cardArea"), ctr = $("#controls");

  /* ---------- Statuszeile ---------- */
  const ds = $("#dstat");
  if(gate){ ds.textContent = "Checkliste erledigt · Serie " + st; ds.style.color = "var(--ok)"; }
  else if(st > 0){ ds.textContent = "Serie in Gefahr — Checkliste offen"; ds.style.color = "var(--danger)"; }
  else { ds.textContent = "Checkliste offen"; ds.style.color = ""; }
  $("#dcount").textContent = d.d + (d.d === 1 ? " Karte" : " Karten");

  /* ---------- Aktive Karte ---------- */
  if(S.active){
    const card = cardById(S.active.id);
    if(!card){ S.active = null; save(); return renderRun(); }   // Karte wurde geloescht
    const c = CATS[card.cat] || CATS[Object.keys(CATS)[0]];
    const r = rewardFor(card), sc = swapCost();
    setAccent(c.c);

    area.innerHTML = `
      <div class="qcard" style="--cc:${c.c}">
        <div class="qtop">
          <span class="tag solid">${c.i} ${c.n}</span>
          <span class="tag d${card.diff}">${DIFF[card.diff]}</span>
        </div>
        <div class="qtitle">${esc(card.title)}</div>
        ${card.text ? `<div class="qstory">${esc(card.text)}</div>` : ``}
        <div class="qmeta">
          <span class="chip">Erfahrung <b>${fmt(r.xp)} XP</b></span>
          <span class="chip">Belohnung <b>${fmt(r.c)} ${APP.coin}</b></span>
          ${card.mins ? `<span class="chip">Dauer <b>${card.mins} Min</b></span>` : ``}
          ${S.dbl ? `<span class="chip hl">Doppelte Belohnung</span>` : ``}
          ${boostXp()||boostCoins() ? `<span class="chip hl">Boost aktiv</span>` : ``}
        </div>
        ${card.mins ? `<div class="timer" style="--cc:${c.c}">
            <div class="tnum" id="tnum">--:--</div>
            <div class="tbar"><i id="tbar"></i></div>
            <button class="mini" id="tbtn">Start</button>
          </div>` : ``}
      </div>`;

    ctr.innerHTML = `<button class="btn ok" id="done">Erledigt</button>
      <button class="btn ghost ${sc.free||sc.token?"":"warn"}" id="swap" style="margin-top:8px">
        ${sc.free ? "Karte tauschen · gratis"
          : sc.token ? "Karte tauschen · Marke"
          : `Tauschen · ${fmt(sc.c)} ${APP.coin} / ${sc.xp} XP`}
      </button>`;
    $("#done").onclick = completeCard;
    $("#swap").onclick = swapCard;
    if(card.mins) setupTimer(card);
    return;
  }

  /* ---------- Keine Karte aktiv ---------- */
  clearInterval(tickTimer);
  setAccent(gate ? "#00ffa3" : "#615a86");

  if(gate){
    area.innerHTML = `<div class="idle">
        <div class="idlemark">◈</div>
        <p>Stapel bereit.</p>
      </div>`;
    ctr.innerHTML = `<button class="btn" id="draw">Karte ziehen</button>`;
    $("#draw").onclick = drawCard;
  }else{
    const open = S.checklist.filter(it => !dayRec(k).ck.includes(it.id)).map(it => it.n);
    area.innerHTML = `<div class="idle">
        <div class="lockmark">✕</div>
        <p>Erst die Checkliste, dann eine Karte.</p>
        <p class="small">${open.length ? "Offen: " + esc(open.join(", ")) : "Checkliste ist leer — mit ✎ Punkte anlegen."}</p>
      </div>`;
    ctr.innerHTML = `<button class="btn" id="draw" disabled>Gesperrt</button>`;
  }
}

/* ============================================================
   ZIEHEN
   ============================================================ */
function drawCard(){
  if(rolling || S.active) return;

  if(!checklistDone(today())){
    toast("Erst die Checkliste abhaken.","bad");
    blip(160,.16,"square",.04); buzz(60);
    return;
  }
  const pool = drawPool();
  if(!pool.length){
    toast("Keine Karten im Stapel. Im Tab Karten welche anlegen.","bad");
    return;
  }

  const pick = pool[Math.floor(Math.random()*pool.length)];
  $("#controls").innerHTML = `<button class="btn" disabled>Läuft…</button>`;

  rollTo(pick, ()=>{
    rolling = false;
    S.active = {id:pick.id, ts:now(), tEnd:null, tRun:false, tLeft:(pick.mins||0)*60};
    S.recent.push(pick.id);
    if(S.recent.length > TUNE.recentMemory) S.recent.shift();
    save(); renderRun(); renderHud();
  });
}

/* ============================================================
   TIMER
   Laeuft ueber einen Zielzeitpunkt, damit er auch weiterlaeuft,
   wenn die App zwischendurch im Hintergrund war.
   ============================================================ */
function setupTimer(card){
  const btn = $("#tbtn"); if(!btn) return;

  const draw = ()=>{
    const a = S.active; if(!a) return;
    const left = a.tRun ? Math.max(0, Math.round((a.tEnd-now())/1000)) : a.tLeft;
    const num = $("#tnum"); if(!num) return;
    num.textContent = String(Math.floor(left/60)).padStart(2,"0")+":"+String(left%60).padStart(2,"0");
    $("#tbar").style.width = (100 - left/(card.mins*60)*100)+"%";
    if(a.tRun && left <= 0){
      a.tRun = false; a.tLeft = 0; save();
      btn.textContent = "Fertig"; btn.disabled = true;
      blip(880,.2,"triangle",.06); setTimeout(()=>blip(1200,.26,"triangle",.06),220);
      buzz([80,60,80]); toast("Zeit ist um.","good");
    }
  };

  btn.textContent = S.active.tRun ? "Pause" : (S.active.tLeft < card.mins*60 ? "Weiter" : "Start");
  btn.onclick = ()=>{
    const a = S.active;
    if(a.tRun){ a.tLeft = Math.max(0, Math.round((a.tEnd-now())/1000)); a.tRun = false; btn.textContent = "Weiter"; }
    else { a.tEnd = now()+a.tLeft*1000; a.tRun = true; btn.textContent = "Pause"; }
    blip(420,.05); save(); draw();
  };

  clearInterval(tickTimer); tickTimer = setInterval(draw,1000); draw();
}

/* ============================================================
   ABSCHLUSS
   ============================================================ */
function completeCard(){
  const card = cardById(S.active.id);
  if(!card){ S.active = null; save(); return renderAll(); }

  const r = rewardFor(card), k = today(), d = dayRec(k);
  const c = Object.assign({}, d.c); c[card.cat] = (c[card.cat]||0)+1;
  S.days[k] = Object.assign({}, d, {d:d.d+1, c});

  S.hist.unshift({t:card.title, c:card.cat, df:card.diff, xp:r.xp, m:r.c, k, ts:now()});
  if(S.hist.length > TUNE.histMax) S.hist.pop();

  /* Erfolgsspur "Alle Karten" */
  const before = S.totals.cards || 0;
  S.totals.cards = before + 1;

  const lvlBefore = levelInfo(S.xp).lvl;
  S.xp += r.xp; S.coins += r.c; S.active = null; S.dbl = 0;
  clearInterval(tickTimer);
  save();

  loot(`+${fmt(r.xp)} XP · +${fmt(r.c)} ${APP.coin}`);
  blip(540,.09,"triangle",.05); setTimeout(()=>blip(810,.15,"triangle",.05),90);
  buzz([25,40,25]);
  announceTier("Alle Karten", before, before+1);

  renderAll();
  const lvlAfter = levelInfo(S.xp).lvl;
  if(lvlAfter > lvlBefore) levelUp(lvlAfter);
}

function swapCard(){
  const c = swapCost();
  if(c.free){
    toast("Gratis-Tausch für heute verbraucht.");
  }else if(c.token){
    S.tokens--; toast("Marke eingesetzt. Rest: "+S.tokens);
  }else{
    const debt = S.coins < c.c;
    S.coins = Math.max(0, S.coins - c.c);        // keine Schulden, keine Minuszahlen
    const floorXp = S.xp - levelInfo(S.xp).into; // Abzug nie unter das aktuelle Level
    S.xp = Math.max(floorXp, S.xp - c.xp);
    toast(debt ? "Nicht genug Münzen — Rest abgezogen." : `Getauscht: −${fmt(c.c)} ${APP.coin}, −${c.xp} XP`, "bad");
  }

  const k = today(), d = dayRec(k);
  S.days[k] = Object.assign({}, d, {s:d.s+1});
  S.swaps++; S.active = null; clearInterval(tickTimer);
  blip(200,.13,"square",.04); buzz(50); save(); renderAll();
}

/* ---------- Feldfilter ---------- */
function renderCats(){
  const box = $("#cats"); box.innerHTML = "";
  Object.entries(CATS).forEach(([k,c])=>{
    const b = el("button","mini"+(S.cats[k]?" on":""), `${c.i} ${c.n}`);
    b.style.setProperty("--cc", c.c);
    b.onclick = ()=>{
      S.cats[k] = !S.cats[k];
      if(!Object.values(S.cats).some(Boolean)){ S.cats[k] = true; toast("Mindestens ein Feld muss aktiv bleiben.","bad"); }
      blip(320,.04); save(); renderCats();
    };
    box.appendChild(b);
  });
  const n = S.deck.filter(c => S.cats[c.cat]).length;
  $("#fcount").textContent = n + " von " + S.deck.length + " Karten";
}
