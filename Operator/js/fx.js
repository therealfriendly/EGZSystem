/* ============================================================
   FX — Ton, Vibration, Toasts, Belohnungsanzeige, Modal
   Styles dazu in css/overlays.css
   ============================================================ */

let AC = null;

/* Kurzer Ton ueber die WebAudio-API, kein Asset noetig */
function blip(f=440,d=.07,type="square",g=.03){
  if(!S.sound) return;
  try{
    AC = AC || new (window.AudioContext||window.webkitAudioContext)();
    const o = AC.createOscillator(), v = AC.createGain();
    o.type=type; o.frequency.value=f; v.gain.value=g; o.connect(v); v.connect(AC.destination); o.start();
    v.gain.exponentialRampToValueAtTime(.0001, AC.currentTime+d); o.stop(AC.currentTime+d+.02);
  }catch(e){}
}

/* ms als Zahl oder Muster-Array, z. B. buzz([80,60,80]) */
const buzz = ms => { try{ navigator.vibrate && navigator.vibrate(ms); }catch(e){} };

/* kind: undefined | "good" | "bad" */
function toast(msg,kind){
  const t = el("div","tst"+(kind?" "+kind:""),msg);
  $("#toast").appendChild(t);
  setTimeout(()=>{ t.style.transition="opacity .4s"; t.style.opacity=0; setTimeout(()=>t.remove(),400); },2600);
}

/* Grosse Belohnungsanzeige, die nach oben wegfliegt */
function loot(txt){
  const l = el("div","loot",txt);
  document.body.appendChild(l);
  setTimeout(()=>l.remove(),1250);
}

/* ============================================================
   MODAL — wird von Checkliste und Karteneditor benutzt
   openModal("Titel", "<html>", mountFn)
   mountFn bekommt das Body-Element und verdrahtet die Felder.
   ============================================================ */
function openModal(title, html, mount){
  const m = $("#modal");
  m.innerHTML = `<div class="sheet">
      <div class="sheethead"><b>${esc(title)}</b><button class="mini" id="mClose">Schließen</button></div>
      <div class="sheetbody" id="mBody">${html}</div>
    </div>`;
  m.classList.add("on");
  $("#mClose").onclick = closeModal;
  m.onclick = e => { if(e.target === m) closeModal(); };
  if(mount) mount($("#mBody"));
  blip(520,.05);
}

function closeModal(){
  const m = $("#modal");
  m.classList.remove("on");
  m.innerHTML = "";
}
