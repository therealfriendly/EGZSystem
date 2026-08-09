/* ============================================================
   UTILS — kleine Helfer ohne eigenen Zustand
   ============================================================ */

/* DOM */
const $ = s => document.querySelector(s);
const el = (t,c,h) => { const e=document.createElement(t); if(c)e.className=c; if(h!=null)e.innerHTML=h; return e; };

/* Text sicher in Markup einsetzen — Kartentitel und Checklisten-
   Namen kommen vom Nutzer und landen in Template-Strings. */
const esc = s => String(s==null?"":s).replace(/[&<>"']/g, m => (
  {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]
));

/* Zeit */
const now = () => Date.now();
const key = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
const today = () => key(new Date());

/* Zahlen */
const fmt = n => (n<0?"-":"") + Math.abs(n).toLocaleString("de-DE");
const clamp = (n,a,b) => Math.max(a, Math.min(b, n));

/* Eindeutige ID fuer Karten und Checklisten-Punkte */
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2,7);

/* Farben */
const hexRGB = h => [parseInt(h.slice(1,3),16),parseInt(h.slice(3,5),16),parseInt(h.slice(5,7),16)].join(",");

/* Akzentfarbe der ganzen Oberflaeche umfaerben */
function setAccent(hex){
  document.documentElement.style.setProperty("--acc", hex);
  document.documentElement.style.setProperty("--accRGB", hexRGB(hex));
}

/* Respektiert die Systemeinstellung fuer reduzierte Bewegung */
const reducedMotion = () => window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
