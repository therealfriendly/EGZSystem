const SPLITS = {
  Push: ["Brust","Schulter","Trizeps"],
  Pull: ["Rücken","Bizeps"],
  Legs: ["Beine"]
};

let data = JSON.parse(localStorage.getItem("egz-data")) || {};
let history = JSON.parse(localStorage.getItem("egz-history")) || [];

let active = null;
let selectedProgression = null;
let selectedSub = null;

/* START */

function startTraining(main) {
  active = { main, current:{}, target:{} };
  selectedProgression = null;
  selectedSub = null;

  document.getElementById("idleView").classList.add("hidden");
  document.getElementById("trainingView").classList.remove("hidden");
  document.getElementById("trainingTitle").innerText = main;

  document.getElementById("progressionSelect").classList.remove("hidden");
  document.getElementById("setInput").classList.add("hidden");
  document.getElementById("progressArea").innerHTML = "";
}

/* PROGRESSION */

function selectProgression(p) {
  selectedProgression = p;
  document.getElementById("progressionSelect").classList.add("hidden");
  document.getElementById("setInput").classList.remove("hidden");

  SPLITS[active.main].forEach(sub => {
    const last = data[active.main]?.[sub] || 0;
    active.current[sub] = 0;
    active.target[sub] = last === 0 ? 0 : Math.round(last * (1 + p));
  });

  renderTrainingUI();
}

/* TRAINING UI */

function renderTrainingUI() {
  const area = document.getElementById("progressArea");
  const subBtns = document.getElementById("subButtons");

  area.innerHTML = "";
  subBtns.innerHTML = "";

  SPLITS[active.main].forEach(sub => {
    area.innerHTML += `
      <div class="progress">
        <strong>${sub}</strong>
        <div class="bar">
          <div class="fill" id="bar-${sub}"></div>
        </div>
        <small id="text-${sub}">0 / ${active.target[sub]} kg</small>
      </div>
    `;

    subBtns.innerHTML += `
      <button class="sub" id="btn-${sub}" onclick="selectSub('${sub}')">
        ${sub}
      </button>
    `;
  });
}

/* SUB AUSWAHL */

function selectSub(sub) {
  selectedSub = sub;
  document.getElementById("activeSubText").innerText = sub;

  document.querySelectorAll(".sub").forEach(b => b.classList.remove("active"));
  document.getElementById(`btn-${sub}`).classList.add("active");
}

/* SET */

function addSet() {
  if (!selectedSub) {
    alert("Bitte zuerst einen Muskel auswählen.");
    return;
  }

  const w = +weight.value;
  const r = +reps.value;
  if (!w || !r) return;

  active.current[selectedSub] += w * r;
  updateBars();

  /* Inputs nur leeren, wenn Satz gültig war */
  weight.value = "";
  reps.value = "";
}

/* PROGRESS */

function updateBars() {
  SPLITS[active.main].forEach(sub => {
    const cur = active.current[sub];
    const tgt = active.target[sub] || cur || 1;

    document.getElementById(`text-${sub}`).innerText =
      `${cur} / ${active.target[sub]} kg`;

    document.getElementById(`bar-${sub}`).style.width =
      Math.min(100, (cur / tgt) * 100) + "%";
  });
}

/* FINISH */

function finishTraining() {
  let anyPassed = false;
  if (!data[active.main]) data[active.main] = {};

  SPLITS[active.main].forEach(sub => {
    if (active.target[sub] === 0 || active.current[sub] >= active.target[sub]) {
      data[active.main][sub] = active.current[sub];
      if (active.current[sub] > 0) anyPassed = true;
    }
  });

  if (!anyPassed) {
    location.reload();
    return;
  }

  history.unshift({
    category: active.main,
    tonnage: Object.values(active.current).reduce((a,b)=>a+b,0)
  });

  history = history.slice(0, 10);

  localStorage.setItem("egz-data", JSON.stringify(data));
  localStorage.setItem("egz-history", JSON.stringify(history));

  location.reload();
}

/* IDLE */

function clearHistory() {
  if (!confirm("Verlauf wirklich löschen?")) return;
  history = [];
  localStorage.removeItem("egz-history");
  renderHistory();
}

function getTotalForSub(sub) {
  let total = 0;
  Object.values(data).forEach(cat => {
    if (cat[sub]) total += cat[sub];
  });
  return total;
}

function renderTotals() {
  const list = document.getElementById("totalsList");
  list.innerHTML = "";

  Object.values(SPLITS).flat().forEach(sub => {
    list.innerHTML += `
      <div class="total-item">
        ${sub}
        <span class="total-value" onclick="editTonnage('${sub}')">
          ${getTotalForSub(sub)} kg
        </span>
      </div>
    `;
  });
}

function editTonnage(sub) {
  const val = prompt("Neue Tonnage:", getTotalForSub(sub));
  if (val === null) return;

  Object.keys(data).forEach(cat => {
    if (data[cat]?.[sub] !== undefined) {
      data[cat][sub] = +val;
    }
  });

  localStorage.setItem("egz-data", JSON.stringify(data));
  renderTotals();
}

function renderHistory() {
  const h = document.getElementById("historyList");
  h.innerHTML = "";

  history.forEach(e => {
    h.innerHTML += `<div class="history-item">${e.category} – ${e.tonnage} kg</div>`;
  });
}

renderTotals();
renderHistory();
