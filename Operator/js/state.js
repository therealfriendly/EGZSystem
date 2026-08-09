/* ============================================================
   STATE — Spielstand, Speichern/Laden, abgeleitete Werte
   S ist der einzige veraenderliche Zustand der App.
   Nach jeder Aenderung save() aufrufen.

   Tagesdatensatz S.days[k]:
     ck   ids der heute abgehakten Checklisten-Punkte
     cnt  ids, die heute schon fuer die Erfolge gezaehlt wurden
     ok   true, sobald die Checkliste an dem Tag einmal voll war.
          Bleibt true, auch wenn die Checkliste spaeter geaendert
          wird — ein verdienter Tag wird nie rueckwirkend entwertet.
     d    Anzahl erledigter Karten
     s    Anzahl getauschter Karten
     c    {feld: anzahl} fuer Kalenderfarbe und Statistik
   ============================================================ */

/* ---------- Persistenz ----------
   Bevorzugt window.storage (App-Huelle), sonst localStorage. */
const Store = {
  async load(){
    if(window.storage){ try{ const r = await window.storage.get(STORAGE_KEY); if(r && r.value) return JSON.parse(r.value); }catch(e){} }
    try{ const v = localStorage.getItem(STORAGE_KEY); if(v) return JSON.parse(v); }catch(e){}
    return null;
  },
  async save(o){
    const s = JSON.stringify(o);
    if(window.storage){ try{ await window.storage.set(STORAGE_KEY, s); return; }catch(e){} }
    try{ localStorage.setItem(STORAGE_KEY, s); }catch(e){}
  }
};

/* Leerer Spielstand. Neue Felder hier ergaenzen — beim Laden wird
   ueber DEF() gemerged, alte Staende bekommen sie automatisch. */
const DEF = () => ({
  v:2,
  xp:0, coins:0,

  /* Die Pflicht. Hoechstens TUNE.maxChecklist Punkte. */
  checklist:[ {id:"base-training", n:"Training"}, {id:"base-hacken", n:"Hacken"} ],

  days:{}, frozen:[], hist:[],
  totals:{ cards:0, check:{} },   // Lebenszeitzaehler fuer die Erfolge

  deck:[], deckV:0,               // wird beim ersten Start aus DECK_SEED gefuellt
  recent:[], active:null,

  tokens:0, jokers:0, dbl:0, xpBoost:0, coinBoost:0,
  best:0, swaps:0, spent:0, sound:true,
  cats:Object.fromEntries(Object.keys(CATS).map(k=>[k,true]))
});

let S = DEF(), saveT = null;

/* Gebuendeltes Speichern, damit schnelle Klicks nicht spammen */
const save = () => { clearTimeout(saveT); saveT = setTimeout(()=>Store.save(S), 250); };

/* ============================================================
   TAGE UND SERIE
   ============================================================ */
const dayRec = k => S.days[k] || {ck:[], cnt:[], ok:false, d:0, s:0, c:{}};

/* Ein Tag zaehlt fuer die Serie, wenn die Checkliste voll war
   oder ein Joker ihn gerettet hat. Karten sind optional. */
const dayOk = k => !!dayRec(k).ok || S.frozen.includes(k);

/* Ist die Checkliste heute abgearbeitet? Steuert das Ziehen. */
function checklistDone(k){
  const d = dayRec(k);
  if(d.ok) return true;
  return S.checklist.length > 0 && S.checklist.every(it => d.ck.includes(it.id));
}

function streakOf(){
  let d = new Date(), s = 0;
  /* Heute darf noch offen sein, solange gestern gezaehlt hat */
  if(!dayOk(key(d))){ d.setDate(d.getDate()-1); if(!dayOk(key(d))) return 0; }
  while(dayOk(key(d))){ s++; d.setDate(d.getDate()-1); }
  return s;
}

/* Beim Start: verpasste Tage rueckwirkend mit Jokern abdecken */
function reconcile(){
  const ks = Object.keys(S.days).filter(k=>S.days[k].ok).sort();
  if(!ks.length) return;
  const yest = new Date(); yest.setDate(yest.getDate()-1);
  let c = new Date(ks[ks.length-1]+"T12:00:00"); c.setDate(c.getDate()+1);
  while(key(c) <= key(yest) && S.jokers > 0){
    if(!dayOk(key(c))){ S.jokers--; S.frozen.push(key(c)); toast("Joker eingesetzt für "+key(c),"good"); }
    c.setDate(c.getDate()+1);
  }
}

/* Farbe des an diesem Tag staerksten Felds */
function topCat(k){
  const c = dayRec(k).c || {};
  const e = Object.entries(c).sort((a,b)=>b[1]-a[1])[0];
  return e ? CATS[e[0]].c : "#00ffa3";
}

/* ============================================================
   BOOSTS UND BELOHNUNG
   ============================================================ */
const boostXp = () => S.xpBoost > now();
const boostCoins = () => S.coinBoost > now();
const streakMult = () => 1 + Math.min(streakOf(), TUNE.streakCap) * TUNE.streakBonus;

function rewardFor(card){
  const b = REWARD[card.diff] || REWARD[1], m = streakMult(), d = S.dbl ? 2 : 1;
  return {
    xp: Math.round(b.xp * m * (boostXp()?2:1) * d),
    c:  Math.round(b.c  * m * (boostCoins()?1.5:1) * d)
  };
}

/* ============================================================
   KARTENSTAPEL
   S.deck haelt die Karten des Nutzers. Beim ersten Start wird
   DECK_SEED hineinkopiert, danach ist S.deck massgeblich.
   ============================================================ */
function seedDeck(){
  return DECK_SEED.map(q => ({
    id: uid(),
    title: q.titel,
    text: q.text || "",          // der Spruch unter dem Titel, optional

    cat: CATS[q.feld] ? q.feld : Object.keys(CATS)[0],
    diff: clamp(q.stufe|0, 1, 5),
    mins: Math.max(0, q.minuten|0)
  }));
}

const cardById = id => S.deck.find(c => c.id === id) || null;

/* Ziehbare Karten: aktive Felder, zuletzt gezogene werden gemieden */
function drawPool(){
  let p = S.deck.filter(c => S.cats[c.cat]);
  if(!p.length) p = S.deck.slice();
  const fresh = p.filter(c => !S.recent.includes(c.id));
  return fresh.length ? fresh : p;
}

/* Erster Tausch am Tag ist gratis, danach Marke oder Muenzen + XP */
function swapCost(){
  const s = dayRec(today()).s;
  if(s === 0) return {free:true, c:0, xp:0};
  if(S.tokens > 0) return {token:true, c:0, xp:0};
  return {c: TUNE.swapBase * Math.pow(2, s-1), xp: TUNE.swapXp * s};
}

/* ============================================================
   ERFOLGE
   Eine Spur pro Checklisten-Punkt plus eine fuer alle Karten.
   ============================================================ */
function tracks(){
  const t = S.checklist.map(it => ({
    id: it.id, name: it.n, n: S.totals.check[it.id] || 0, unit: "Tage"
  }));
  t.push({ id:"__cards", name:"Alle Karten", n: S.totals.cards || 0, unit:"Karten" });
  return t;
}

const tierAt = n => TIERS.filter(t => n >= t.at).pop() || null;
const nextTier = n => TIERS.find(t => n < t.at) || null;

/* Meldet, wenn ein Zaehler eine Stufe ueberschritten hat */
function announceTier(label, before, after){
  TIERS.forEach(t => {
    if(before < t.at && after >= t.at){
      toast(`${t.n} freigeschaltet — ${label}: ${t.s}`, "good");
      blip(880,.16,"triangle",.05); setTimeout(()=>blip(1320,.24,"triangle",.05),150);
      buzz([40,60,90]);
    }
  });
}

/* ============================================================
   CHECKLISTE
   ============================================================ */
function toggleCheck(id){
  const k = today(), d = dayRec(k);
  const ck = d.ck.slice(), cnt = (d.cnt || []).slice();
  const i = ck.indexOf(id);

  if(i >= 0){
    ck.splice(i, 1);
  }else{
    ck.push(id);
    /* Nur einmal pro Tag zaehlen, sonst liesse sich der Erfolg
       durch An- und Abhaken hochtreiben. */
    if(!cnt.includes(id)){
      cnt.push(id);
      const item = S.checklist.find(x => x.id === id);
      const before = S.totals.check[id] || 0;
      S.totals.check[id] = before + 1;
      announceTier(item ? item.n : "Checkliste", before, before + 1);
    }
  }

  const wasOk = !!d.ok;
  const full = S.checklist.length > 0 && S.checklist.every(it => ck.includes(it.id));
  S.days[k] = Object.assign({}, d, {ck, cnt, ok: wasOk || full});

  if(!wasOk && full) awardDay();
  return !wasOk && full;
}

/* Nach dem Bearbeiten der Checkliste noch einmal pruefen.
   Sonst bliebe dieser Fall haengen: zwei Punkte, einer abgehakt,
   der andere geloescht — die Liste waere voll, der Tag aber nie
   als erledigt vermerkt und die Serie zaehlte ihn nicht. */
function reevaluateToday(){
  const k = today(), d = dayRec(k);
  if(d.ok || !S.checklist.length) return false;
  if(!S.checklist.every(it => d.ck.includes(it.id))) return false;
  S.days[k] = Object.assign({}, d, {ok:true});
  awardDay();
  return true;
}

/* Belohnung fuer die volle Checkliste. Genau einmal pro Tag. */
function awardDay(){
  const m = streakMult();
  const xp = Math.round(TUNE.dayXp * m * (boostXp()?2:1));
  const c  = Math.round(TUNE.dayCoins * m * (boostCoins()?1.5:1));
  S.xp += xp; S.coins += c;
  loot(`Tag gesichert · +${fmt(xp)} XP · +${fmt(c)} ${APP.coin}`);
  const st = streakOf();
  toast(`Checkliste voll. Serie: ${st} ${st===1?"Tag":"Tage"}.`, "good");
  blip(560,.1,"triangle",.05); setTimeout(()=>blip(840,.18,"triangle",.05),100);
  buzz([25,40,60]);
}
