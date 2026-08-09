/* ============================================================
   UI · KARTEN — Stapel bearbeiten
   S.deck ist massgeblich. DECK_SEED (js/data/deck.js) ist nur
   der Startbestand und laesst sich hier wiederherstellen.
   ============================================================ */

let cardFilter = "ALLE";

function renderCards(){
  /* ---------- Filterleiste ---------- */
  const fb = $("#cardFilter"); fb.innerHTML = "";
  const mk = (k,label,col)=>{
    const b = el("button","mini"+(cardFilter===k?" on":""), label);
    if(col) b.style.setProperty("--cc", col);
    b.onclick = ()=>{ cardFilter = k; blip(320,.04); renderCards(); };
    fb.appendChild(b);
  };
  mk("ALLE","Alle ("+S.deck.length+")");
  Object.entries(CATS).forEach(([k,c])=>mk(k, `${c.i} ${c.n} (${S.deck.filter(x=>x.cat===k).length})`, c.c));

  /* ---------- Liste ---------- */
  const box = $("#cardList"); box.innerHTML = "";
  const list = S.deck
    .filter(c => cardFilter === "ALLE" || c.cat === cardFilter)
    .slice()
    .sort((a,b)=> a.cat === b.cat ? a.diff - b.diff : a.cat.localeCompare(b.cat));

  if(!list.length){
    box.appendChild(el("div","empty-note","Keine Karten in diesem Feld."));
  }

  list.forEach(card=>{
    const c = CATS[card.cat] || {c:"#918bb4", n:"—", i:"·"};
    const r = el("div","item");
    r.innerHTML = `<div class="ic" style="color:${c.c};border-color:${c.c}44">${c.i}</div>
      <div class="g">
        <div class="n">${esc(card.title)}</div>
        ${card.text ? `<div class="d">${esc(card.text)}</div>` : ``}
        <div class="d" style="color:${c.c}">${c.n} · <span class="d${card.diff}">${DIFF[card.diff]}</span>${card.mins?` · ${card.mins} Min`:``}</div>
      </div>`;
    const b = el("button","mini","✎");
    b.onclick = ()=>openCardEditor(card);
    r.appendChild(b);
    box.appendChild(r);
  });

  $("#deckCount").textContent = S.deck.length + " Karten";
}

/* ============================================================
   EDITOR — dieselbe Maske fuer neu und bearbeiten
   card === null bedeutet: neue Karte
   ============================================================ */
function openCardEditor(card){
  const isNew = !card;
  const c = card || {id:null, title:"", text:"", cat:Object.keys(CATS)[0], diff:2, mins:0};

  const html = `
    <label class="flab">Titel</label>
    <input class="fin" id="cTitle" maxlength="40" value="${esc(c.title)}" placeholder="z. B. 10.000 Schritte">

    <label class="flab">Spruch — steht klein unter dem Titel, optional</label>
    <input class="fin" id="cText" maxlength="120" value="${esc(c.text)}" placeholder="z. B. Keine Ausreden.">

    <label class="flab">Feld</label>
    <div class="fpick" id="cCat">
      ${Object.entries(CATS).map(([k,v])=>
        `<button class="mini${c.cat===k?" on":""}" data-k="${k}" style="--cc:${v.c}">${v.i} ${v.n}</button>`).join("")}
    </div>

    <label class="flab">Stufe — bestimmt die Belohnung</label>
    <div class="fpick" id="cDiff">
      ${[1,2,3,4,5].map(n=>
        `<button class="mini${c.diff===n?" on":""}" data-n="${n}">${DIFF[n]}</button>`).join("")}
    </div>
    <div class="fhint" id="cRew"></div>

    <label class="flab">Timer in Minuten — 0 heißt kein Timer</label>
    <input class="fin" id="cMins" type="number" min="0" max="600" value="${c.mins}">

    <button class="btn ok" id="cSave" style="margin-top:14px">${isNew?"Karte anlegen":"Speichern"}</button>
    ${isNew?``:`<button class="mini wide danger" id="cDel" style="margin-top:8px">Karte löschen</button>`}`;

  openModal(isNew ? "Neue Karte" : "Karte bearbeiten", html, body=>{
    let cat = c.cat, diff = c.diff;

    const showRew = ()=>{
      const r = REWARD[diff];
      body.querySelector("#cRew").textContent = `Gibt ${r.xp} XP und ${r.c} ${APP.coin}, vor Serie und Boosts.`;
    };
    showRew();

    body.querySelectorAll("#cCat button").forEach(b=>{
      b.onclick = ()=>{
        cat = b.dataset.k;
        body.querySelectorAll("#cCat button").forEach(x=>x.classList.remove("on"));
        b.classList.add("on"); blip(340,.04);
      };
    });
    body.querySelectorAll("#cDiff button").forEach(b=>{
      b.onclick = ()=>{
        diff = +b.dataset.n;
        body.querySelectorAll("#cDiff button").forEach(x=>x.classList.remove("on"));
        b.classList.add("on"); blip(340,.04); showRew();
      };
    });

    body.querySelector("#cSave").onclick = ()=>{
      const title = body.querySelector("#cTitle").value.trim();
      if(!title){ toast("Titel fehlt.","bad"); return; }
      const data = {
        title,
        text: body.querySelector("#cText").value.trim(),
        cat, diff,
        mins: clamp(parseInt(body.querySelector("#cMins").value,10)||0, 0, 600)
      };
      if(isNew) S.deck.push(Object.assign({id:uid()}, data));
      else Object.assign(card, data);
      blip(700,.1,"triangle",.05);
      toast(isNew?"Karte angelegt.":"Karte gespeichert.","good");
      save(); closeModal(); renderAll();
    };

    const del = body.querySelector("#cDel");
    if(del) del.onclick = ()=>{
      if(del.dataset.armed){
        S.deck = S.deck.filter(x => x.id !== card.id);
        if(S.active && S.active.id === card.id) S.active = null;
        blip(200,.14,"square",.04); toast("Karte gelöscht.");
        save(); closeModal(); renderAll();
      }else{
        del.dataset.armed = "1"; del.textContent = "Wirklich? Nochmal drücken";
        setTimeout(()=>{ if(del.isConnected){ del.dataset.armed=""; del.textContent="Karte löschen"; } },4000);
      }
    };
  });
}

/* Startbestand aus js/data/deck.js erneut laden */
function restoreDeck(){
  const b = $("#restoreDeck");
  if(b.dataset.armed){
    S.deck = seedDeck(); S.deckV = DECK_VERSION; S.active = null; S.recent = [];
    b.dataset.armed = ""; b.textContent = "Standard wiederherstellen";
    toast("Standardkarten geladen.","good");
    save(); renderAll();
  }else{
    b.dataset.armed = "1"; b.textContent = "Ersetzt alle Karten — nochmal drücken";
    setTimeout(()=>{ b.dataset.armed=""; b.textContent="Standard wiederherstellen"; },4000);
  }
}
