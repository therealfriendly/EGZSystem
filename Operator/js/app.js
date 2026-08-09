/* ============================================================
   APP — Gesamtrender, Navigation, globale Buttons, Start
   Wird als letztes geladen, darf alles benutzen.
   ============================================================ */

/* Ein Aufruf zeichnet die komplette Oberflaeche neu.
   Neuer Screen? renderX hier eintragen. */
function renderAll(){
  renderHud();
  renderRun();
  renderCats();
  renderCal();
  renderDay();
  renderShop();
  renderAchievements();
  renderCards();
  renderProfile();
}

/* ---------- Tab-Navigation ---------- */
document.querySelectorAll("#nav button").forEach(b=>{
  b.onclick = ()=>{
    document.querySelectorAll("#nav button").forEach(x=>x.classList.remove("on"));
    document.querySelectorAll(".screen").forEach(x=>x.classList.remove("on"));
    b.classList.add("on"); $("#"+b.dataset.s).classList.add("on");
    blip(440,.04); window.scrollTo(0,0);
  };
});

/* ---------- Checkliste ---------- */
$("#editChecks").onclick = openChecklistEditor;

/* ---------- Kalendernavigation ---------- */
$("#prevM").onclick = ()=>{ if(--calM<0){calM=11;calY--;} blip(300,.03); renderCal(); };
$("#nextM").onclick = ()=>{ if(++calM>11){calM=0;calY++;} blip(300,.03); renderCal(); };

/* ---------- Aufstiegs-Overlay ---------- */
$("#flashOk").onclick = ()=>{ $("#flash").classList.remove("on"); renderRun(); };

/* ---------- Karteneditor ---------- */
$("#newCard").onclick = ()=>openCardEditor(null);
$("#restoreDeck").onclick = restoreDeck;

/* ---------- Daten: Export / Import / Sound / Reset ---------- */
$("#expBtn").onclick = ()=>{
  $("#io").value = JSON.stringify(S); $("#io").select();
  toast("Sicherung erstellt. Text kopieren.","good");
};

$("#impBtn").onclick = ()=>{
  try{
    const o = JSON.parse($("#io").value);
    if(!o || typeof o !== "object") throw 0;
    S = Object.assign(DEF(), o);
    if(!Array.isArray(S.deck) || !S.deck.length) S.deck = seedDeck();
    save(); renderAll(); toast("Sicherung eingespielt.","good");
  }catch(e){ toast("Text ist keine gültige Sicherung.","bad"); }
};

$("#sndBtn").onclick = ()=>{ S.sound = !S.sound; blip(520,.06); save(); renderProfile(); };

/* Zweistufig: erster Druck schaerft, zweiter loescht */
$("#resetBtn").onclick = ()=>{
  const b = $("#resetBtn");
  if(b.dataset.armed){
    S = DEF(); S.deck = seedDeck(); S.deckV = DECK_VERSION;
    save(); renderAll(); toast("Alles zurückgesetzt.");
    b.dataset.armed=""; b.textContent="Alles löschen";
  }else{
    b.dataset.armed="1"; b.textContent="Wirklich? Nochmal drücken";
    setTimeout(()=>{ b.dataset.armed=""; b.textContent="Alles löschen"; },4000);
  }
};

/* ============================================================
   START
   ============================================================ */
(async function init(){
  const loaded = await Store.load();
  /* Merge ueber DEF(), damit alte Spielstaende neue Felder erben */
  if(loaded){
    S = Object.assign(DEF(), loaded, {
      cats:   Object.assign(DEF().cats, loaded.cats || {}),
      totals: Object.assign(DEF().totals, loaded.totals || {})
    });
  }
  /* Erster Start, leerer Stapel, oder DECK_SEED wurde inhaltlich
     ueberarbeitet: Startbestand laden. Serie, XP und Erfolge
     bleiben dabei erhalten, nur die Karten werden ersetzt. */
  if(!Array.isArray(S.deck) || !S.deck.length || S.deckV !== DECK_VERSION){
    const replaced = Array.isArray(S.deck) && S.deck.length && S.deckV !== DECK_VERSION;
    S.deck = seedDeck(); S.deckV = DECK_VERSION; S.recent = []; S.active = null;
    if(replaced) toast("Kartenstapel wurde erneuert.");
  }

  /* Felder koennen wegfallen: verwaiste Filter aufraeumen, sonst
     bliebe ein Haken fuer ein Feld stehen, das es nicht mehr gibt. */
  Object.keys(S.cats).forEach(k => { if(!CATS[k]) delete S.cats[k]; });

  if(!Array.isArray(S.checklist)) S.checklist = DEF().checklist;
  S.checklist = S.checklist.slice(0, TUNE.maxChecklist);

  reconcile();
  selDay = today();
  renderAll();

  /* Laufenden Timer nach App-Neustart wieder aufnehmen */
  if(S.active){
    const c = cardById(S.active.id);
    if(!c) S.active = null;
    else if(c.mins) setupTimer(c);
  }
  save();
})();

/* Beim Zurueckwechseln in die App: Datum, Serie und Boosts neu bewerten */
document.addEventListener("visibilitychange", ()=>{ if(!document.hidden){ renderHud(); renderRun(); } });
