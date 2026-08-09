/* ============================================================
   UI · PROFIL — Kennzahlen, 14-Tage-Verlauf, Verteilung, Protokoll
   Das Daten-Panel (Export/Import/Reset) wird in js/app.js verdrahtet.
   ============================================================ */

function renderProfile(){
  const li = levelInfo(S.xp), rk = rankOf(li.lvl);
  $("#meRank").textContent = rk[0].toUpperCase();
  $("#meRank").style.color = rk[1];

  const earned = S.hist.reduce((a,b)=>a+(b.m||0),0);
  const byCat = {}; S.hist.forEach(h=>byCat[h.c]=(byCat[h.c]||0)+1);
  const top = Object.entries(byCat).sort((a,b)=>b[1]-a[1])[0];
  const okDays = Object.values(S.days).filter(d=>d.ok).length;
  const st = streakOf();

  const rows = [
    ["Tage mit voller Checkliste", fmt(okDays)],
    ["Serie aktuell", st+" Tage"],
    ["Serienrekord", Math.max(S.best, st)+" Tage"],
    ["Karten erledigt", fmt(S.totals.cards||0)],
    ["Level · XP", li.lvl+" · "+fmt(S.xp)],
    ["Münzen verdient", fmt(earned)+" "+APP.coin],
    ["Im Shop gelassen", fmt(S.spent)+" "+APP.coin],
    ["Karten getauscht", fmt(S.swaps)],
    ["Stärkstes Feld", top && CATS[top[0]] ? CATS[top[0]].n+" ("+top[1]+")" : "—"]
  ];
  const box = $("#meStats"); box.innerHTML = "";
  rows.forEach(([a,b])=>{
    const r = el("div","row");
    r.innerHTML = `<div class="g"><div class="t" style="color:var(--dim)">${a}</div></div><div class="v" style="color:var(--txt)">${b}</div>`;
    box.appendChild(r);
  });

  /* ---------- Letzte 14 Tage: Höhe = Karten, Farbe = Pflicht erfüllt ---------- */
  const bars = $("#bars"); bars.innerHTML = "";
  const days = [];
  for(let i=13;i>=0;i--){ const d = new Date(); d.setDate(d.getDate()-i); days.push(key(d)); }
  const max = Math.max(1, ...days.map(k=>dayRec(k).d));
  days.forEach(k=>{
    const rec = dayRec(k), b = el("div");
    b.style.height = (rec.d ? 8 + rec.d/max*58 : 4)+"px";
    if(rec.ok){ b.style.background = "var(--ok)"; b.style.boxShadow = "0 0 12px -2px var(--ok)"; }
    else if(S.frozen.includes(k)) b.style.background = "var(--hack)";
    else b.style.background = "#1c1830";
    bars.appendChild(b);
  });

  /* ---------- Verteilung nach Feld ---------- */
  const dist = $("#dist"); dist.innerHTML = "";
  const mx = Math.max(1, ...Object.values(byCat));
  Object.entries(CATS).forEach(([k,c])=>{
    const n = byCat[k]||0, w = el("div");
    w.innerHTML = `<div class="l"><span style="color:${c.c}">${c.i} ${c.n}</span><span>${n}</span></div>
      <div class="b"><i style="width:${n/mx*100}%;background:${c.c};box-shadow:0 0 10px ${c.c}"></i></div>`;
    dist.appendChild(w);
  });

  /* ---------- Protokoll ---------- */
  const h = $("#hist"); h.innerHTML = "";
  $("#histCount").textContent = S.hist.length + " Einträge";
  if(!S.hist.length) h.appendChild(el("div","empty-note","Noch keine Karte erledigt."));
  S.hist.slice(0,25).forEach(x=>{
    const c = CATS[x.c] || {c:"#918bb4", i:"·"}, r = el("div","row");
    r.innerHTML = `<div style="color:${c.c};width:16px;text-align:center">${c.i}</div>
      <div class="g"><div class="t">${esc(x.t)}</div><div class="s">${x.k.split("-").reverse().join(".")} · ${DIFF[x.df]}</div></div>
      <div class="v" style="color:${c.c}">+${fmt(x.xp)}</div>`;
    h.appendChild(r);
  });

  $("#sndBtn").classList.toggle("on", !!S.sound);
  $("#sndBtn").textContent = S.sound ? "Sound an" : "Sound aus";
}
