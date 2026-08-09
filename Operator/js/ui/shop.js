/* ============================================================
   UI · SHOP — Sortiment und Rangleiter
   Waren stehen in js/data/shop.js, Raenge in js/config.js
   ============================================================ */

function renderShop(){
  $("#coins2").textContent = fmt(S.coins);

  const box = $("#shopList"); box.innerHTML = "";
  SHOP.forEach(it=>{
    const active = it.live && it.live() > now();
    const info = it.own ? it.own() : (active ? Math.ceil((it.live()-now())/36e5)+" h aktiv" : "nicht aktiv");
    const r = el("div","item");
    r.innerHTML = `<div class="ic">${it.ic}</div><div class="g"><div class="n">${it.n}</div>
      <div class="d">${it.d}</div><div class="d" style="color:var(--acc)">${info}</div></div>`;

    const b = el("button","mini", fmt(it.p)+" "+APP.coin);
    if(S.coins < it.p) b.style.opacity = .4;
    b.onclick = ()=>{
      if(S.coins < it.p){ toast("Zu wenig Münzen.","bad"); blip(150,.16,"square",.04); return; }
      S.coins -= it.p; S.spent += it.p; it.buy();
      blip(740,.1,"triangle",.05); buzz(30); toast(it.n+" gekauft.","good"); save(); renderAll();
    };
    r.appendChild(b); box.appendChild(r);
  });

  /* ---------- Rangleiter ---------- */
  const lad = $("#ladder"); lad.innerHTML = "";
  const cur = levelInfo(S.xp).lvl;
  RANKS.forEach((rk,i)=>{
    const l = i+1, on = (l === Math.min(cur, RANKS.length));
    const r = el("div","row");
    r.style.opacity = l <= cur ? 1 : .45;
    r.innerHTML = `<div style="width:26px;font-size:11px;color:var(--dim2)">${l===RANKS.length?l+"+":l}</div>
      <div class="g"><div class="t rankname" style="color:${rk[1]}">${rk[0]}</div></div>
      <div class="v" style="color:${rk[1]}">${on ? "◀ hier" : l < cur ? "erreicht" : ""}</div>`;
    lad.appendChild(r);
  });
}
