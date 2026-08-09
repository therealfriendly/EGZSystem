/* ============================================================
   UI · LOG — Monatskalender und Tagesdetail
   Grün = Checkliste an dem Tag erledigt. Karten sind optional
   und erscheinen nur als kleine Zahl in der Ecke.
   Styles in css/calendar.css
   ============================================================ */

let calM = new Date().getMonth(), calY = new Date().getFullYear(), selDay = today();

function renderCal(){
  $("#monthLbl").textContent = MON[calM] + " " + calY;
  const g = $("#cal"); g.innerHTML = "";

  ["Mo","Di","Mi","Do","Fr","Sa","So"].forEach(d=>g.appendChild(el("div","dow",d)));

  /* Woche beginnt Montag, deshalb der Versatz */
  const off = (new Date(calY,calM,1).getDay()+6)%7;
  for(let i=0;i<off;i++) g.appendChild(el("div","day empty"));

  const last = new Date(calY,calM+1,0).getDate();
  for(let d=1; d<=last; d++){
    const k = key(new Date(calY,calM,d)), info = dayRec(k);
    let cls = "day";

    if(info.ok) cls += " done";                       // Checkliste voll -> grün
    else if(S.frozen.includes(k)) cls += " joker";    // Joker hat den Tag gerettet
    else if(info.d > 0) cls += " partial";            // nur Karten, Pflicht offen

    if(k === today()) cls += " today";
    if(k === selDay) cls += " sel";

    const c = el("div", cls, d + (info.d > 0 ? `<em>${info.d}</em>` : ""));
    c.onclick = ()=>{ selDay = k; blip(380,.03); renderCal(); renderDay(); };
    g.appendChild(c);
  }

  const st = streakOf();
  $("#sk1").textContent = st;
  $("#sk2").textContent = Math.max(S.best, st);
  $("#jokerInfo").textContent = S.jokers + " Joker";
}

function renderDay(){
  const list = S.hist.filter(h=>h.k===selDay), d = dayRec(selDay);
  $("#dayLbl").textContent = selDay === today() ? "Heute" : selDay.split("-").reverse().join(".");
  $("#dayXp").textContent = fmt(list.reduce((a,b)=>a+b.xp,0)) + " XP" + (d.s ? ` · ${d.s} getauscht` : "");

  const box = $("#dayList"); box.innerHTML = "";

  /* Zuerst der Pflichtteil */
  const head = el("div","daystate " + (d.ok ? "ok" : S.frozen.includes(selDay) ? "joker" : "off"));
  head.innerHTML = d.ok ? "✓ Checkliste erledigt"
    : S.frozen.includes(selDay) ? "❄ Joker eingesetzt"
    : "✕ Checkliste offen";
  box.appendChild(head);

  if(!list.length){
    box.appendChild(el("div","empty-note","Keine Karten an diesem Tag."));
    return;
  }
  list.forEach(h=>{
    const c = CATS[h.c] || {c:"#918bb4", n:"—", i:"·"}, r = el("div","row");
    r.innerHTML = `<div style="color:${c.c};width:16px;text-align:center">${c.i}</div>
      <div class="g"><div class="t">${esc(h.t)}</div><div class="s" style="color:${c.c}">${c.n} · ${DIFF[h.df]}</div></div>
      <div class="v" style="color:${c.c}">+${fmt(h.xp)} XP<br><span style="color:var(--dim2)">+${fmt(h.m)} ${APP.coin}</span></div>`;
    box.appendChild(r);
  });
}
