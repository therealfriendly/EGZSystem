/* ============================================================
   UI · ERFOLGE
   Eine Spur pro Checklisten-Punkt (gezaehlt in Tagen) plus eine
   Spur fuer alle erledigten Karten zusammen.
   Stufen kommen aus TIERS in js/config.js.
   Styles in css/achievements.css
   ============================================================ */

function renderAchievements(){
  const box = $("#achList"); box.innerHTML = "";
  const all = tracks();

  const unlocked = all.reduce((a,t)=>a + TIERS.filter(x=>t.n >= x.at).length, 0);
  $("#achCount").textContent = unlocked + " von " + (all.length * TIERS.length);

  all.forEach(t=>{
    const cur = tierAt(t.n), nx = nextTier(t.n);
    const w = el("div","ach");

    const goal = nx ? nx.at : TIERS[TIERS.length-1].at;
    const prev = cur ? cur.at : 0;
    const pct = nx ? clamp((t.n - prev) / (goal - prev) * 100, 0, 100) : 100;

    w.innerHTML = `
      <div class="achhead">
        <div class="achname">${esc(t.name)}</div>
        <div class="achnum">${fmt(t.n)} <span>${t.unit}</span></div>
      </div>
      <div class="achbar"><i style="width:${pct}%;background:${nx ? nx.c : TIERS[4].c}"></i></div>
      <div class="achnext">${nx ? `Noch ${fmt(nx.at - t.n)} bis ${nx.n}` : `Alles freigeschaltet`}</div>
      <div class="tiers">
        ${TIERS.map(x=>{
          const got = t.n >= x.at;
          return `<div class="tier ${got?"got":""} ${x.n==="Regenbogen"?"rainbow":""}" style="--tcol:${x.c}">
            <div class="tdot">${got?"★":"·"}</div>
            <div class="tinfo">
              <b>${x.n}</b>
              <span>${esc(x.s)}</span>
              <em>${fmt(x.at)}</em>
            </div>
          </div>`;
        }).join("")}
      </div>`;
    box.appendChild(w);
  });

  if(!all.length) box.appendChild(el("div","empty-note","Keine Spuren. Lege Checklisten-Punkte an."));
}
