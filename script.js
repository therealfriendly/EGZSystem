let data = JSON.parse(localStorage.getItem("staerke")) || [];
let trainingMode = false;
let currentCategory = null;
let currentZiel = 0;
let currentTotal = 0;

/* ---------------- Sicherstellen: Overlay beim Laden verstecken ---------------- */
document.addEventListener("DOMContentLoaded", () => {
  const overlay = document.getElementById("trainingOverlay");
  if (overlay) overlay.classList.add("hidden");
});

/* ---------------- Speicherfunktion ---------------- */
function save() {
  localStorage.setItem("staerke", JSON.stringify(data));
  if (!trainingMode) render();
}

/* ---------------- Übung hinzufügen ---------------- */
function addExercise() {
  const name = document.getElementById("name").value.trim();
  const maxrep = Number(document.getElementById("maxrep").value);
  const gewicht = Number(document.getElementById("gewicht").value);
  const kat = document.getElementById("kategorie").value;

  if (!name || !maxrep || !gewicht)
    return alert("Bitte alle Felder ausfüllen!");

  const oneRM = gewicht * (1 + maxrep / 30);
  data.push({ name, kat, maxrep, gewicht, oneRM, history: [] });

  document.getElementById("name").value = "";
  document.getElementById("maxrep").value = "";
  document.getElementById("gewicht").value = "";
  save();
}

/* ---------------- Übersicht rendern ---------------- */
function render() {
  const exDiv = document.getElementById("exercises");
  const catDiv = document.getElementById("categoryButtons");
  exDiv.innerHTML = "";
  catDiv.innerHTML = "";

  const cats = ["Rücken", "Brust", "Arme", "Beine", "Schultern"];
  cats.forEach(cat => {
    const btn = document.createElement("div");
    btn.className = "catBtn";
    btn.innerHTML = `
      <b>${cat}</b><br>
      <button onclick="beginCategoryTraining('${cat}')">Training starten</button>
    `;
    catDiv.appendChild(btn);
  });

  data.forEach(ex => {
    const box = document.createElement("div");
    box.className = "exercise";
    box.innerHTML = `<b>${ex.name}</b> (${ex.kat}) – 1RM: ${ex.oneRM.toFixed(
      1
    )} kg`;
    exDiv.appendChild(box);
  });

  // --- Stärkeübersicht ---
  const stDiv =
    document.getElementById("strength") ||
    (() => {
      const d = document.createElement("div");
      d.id = "strength";
      document.body.appendChild(d);
      return d;
    })();

  let html = "<h3>Gesamte Stärke</h3>";

  const showEdit = !document
    .getElementById("settingsPanel")
    ?.classList.contains("hidden");

  cats.forEach(cat => {
    const key = "ziel_" + cat;
    const val = parseFloat(localStorage.getItem(key)) || 0;
    html += `${cat}: ${val.toFixed(0)} kg`;
    if (showEdit) {
      html += ` <button class="editBtn" onclick="editStrength('${cat}')">✎</button>`;
    }
    html += "<br>";
  });

  stDiv.innerHTML = html;
}

/* ---------------- Training starten (Overlay) ---------------- */
function beginCategoryTraining(cat) {
  trainingMode = true;
  currentCategory = cat;

  const overlay = document.getElementById("trainingOverlay");
  overlay.classList.remove("hidden");

  const key = "ziel_" + cat;
  let savedZiel = parseFloat(localStorage.getItem(key));

  if (savedZiel) {
    currentZiel = savedZiel * 1.05;
  } else {
    const exs = data.filter(e => e.kat === cat);
    const sum1RM = exs.reduce((sum, e) => sum + e.oneRM, 0);
    const autoStart = sum1RM * 8;
    const man = prompt(
      `Kein Ziel für ${cat} vorhanden.\nAutomatisch geschätzt: ${autoStart.toFixed(
        0
      )} kg\nOder eigenen Wert eingeben:`
    );
    currentZiel = parseFloat(man) || autoStart;
  }

  localStorage.setItem(key, currentZiel);
  currentTotal = 0;

  document.getElementById("trainTitle").innerText = `Training: ${cat}`;
  document.getElementById(
    "trainInfo"
  ).innerHTML = `Ziel: ${currentZiel.toFixed(
    0
  )} kg <button onclick="changeGoal('${cat}')">Ziel ändern</button>`;

  const exs = data.filter(e => e.kat === cat);
  const area = document.getElementById("trainExercises");
  area.innerHTML = "";

  exs.forEach((ex, i) => {
    const div = document.createElement("div");
    div.className = "exercise";
    div.innerHTML = `
      <b>${ex.name}</b><br>
      <input id="wdh${i}" type="number" placeholder="Wdh">
      <input id="gw${i}" type="number" placeholder="Gewicht (kg)" value="${ex.gewicht}">
      <button onclick="addSet('${cat}', ${i})">Satz speichern</button>
    `;
    area.appendChild(div);
  });

  updateProgress();
  renderTodaySets();
}

/* ---------------- Satz hinzufügen ---------------- */
function addSet(cat, index) {
  const exs = data.filter(e => e.kat === cat);
  const ex = exs[index];
  const wdh = Number(document.getElementById(`wdh${index}`).value);
  const g = Number(document.getElementById(`gw${index}`).value);
  if (!wdh || !g) return;

  const satzZug = g * wdh;
  currentTotal += satzZug;

  const new1RM = g * (1 + wdh / 30);
  if (new1RM > ex.oneRM) ex.oneRM = new1RM;

  ex.history.push({ date: new Date().toLocaleString(), wdh, g, satzZug });
  save();
  updateProgress();
  renderTodaySets();
}

/* ---------------- Heutige Sätze anzeigen ---------------- */
function renderTodaySets() {
  let area = document.getElementById("todaySets");
  if (!area) {
    area = document.createElement("div");
    area.id = "todaySets";
    document.getElementById("trainExercises").after(area);
  }

  const exs = data.filter(e => e.kat === currentCategory);
  const today = exs
    .flatMap((ex, i) =>
      ex.history.map((h, idx) => ({ ...h, name: ex.name, exIndex: i, idx }))
    );

  area.innerHTML =
    "<h3>Heutige Sätze</h3>" +
    today
      .map(
        h =>
          `<div>${h.name}: ${h.wdh}×${h.g} kg = ${h.satzZug.toFixed(
            0
          )} kg <button onclick="undoSet(${h.exIndex},${h.idx})">⟲</button></div>`
      )
      .join("");
}

function undoSet(exIndex, setIdx) {
  const exs = data.filter(e => e.kat === currentCategory);
  const ex = exs[exIndex];
  if (!ex) return;
  const s = ex.history.splice(setIdx, 1)[0];
  currentTotal -= s.satzZug;
  save();
  updateProgress();
  renderTodaySets();
}

/* ---------------- Fortschritt ---------------- */
function updateProgress() {
  const prog = document.getElementById("progress");
  const percent = Math.min(100, (currentTotal / currentZiel) * 100);
  prog.innerText = `Erreicht: ${currentTotal.toFixed(
    0
  )} kg / Ziel: ${currentZiel.toFixed(0)} kg (${percent.toFixed(1)} %)`;
}

/* ---------------- Training beenden ---------------- */
function endTraining() {
  // 🧠 Sicherheitscheck: Kein aktives Training → einfach schließen
  if (!currentCategory) {
    const overlay = document.getElementById("trainingOverlay");
    if (overlay) overlay.classList.add("hidden");
    trainingMode = false;
    return;
  }

  const key = "ziel_" + currentCategory;
  const newGoal = currentTotal > currentZiel ? currentTotal : currentZiel;
  localStorage.setItem(key, newGoal);

  // Sätze löschen
  data.forEach(ex => {
    if (ex.kat === currentCategory) ex.history = [];
  });

  save();
  trainingMode = false;
  currentCategory = null;
  document.getElementById("trainingOverlay").classList.add("hidden");
  render();
}

/* ---------------- Ziel manuell ändern ---------------- */
function changeGoal(cat) {
  const key = "ziel_" + cat;
  const old = parseFloat(localStorage.getItem(key)) || 0;
  const neu = prompt(`Aktuelles Ziel: ${old}\nNeues Ziel eingeben:`);
  if (neu) {
    localStorage.setItem(key, parseFloat(neu));
    currentZiel = parseFloat(neu);
    updateProgress();
  }
}

/* ---------------- Stärke bearbeiten ---------------- */
function editStrength(cat) {
  const key = "ziel_" + cat;
  const old = parseFloat(localStorage.getItem(key)) || 0;
  const neu = prompt(`Aktuelle Stärke für ${cat}: ${old}\nNeuen Wert eingeben:`);
  if (neu) {
    localStorage.setItem(key, parseFloat(neu));
    render();
  }
}

/* ---------------- Alles löschen ---------------- */
function deleteEverything() {
  if (confirm("Wirklich ALLES (Übungen, Ziele, History) löschen?")) {
    localStorage.clear();
    data = [];
    trainingMode = false;
    currentCategory = null;
    currentZiel = 0;
    currentTotal = 0;
    document.getElementById("trainingOverlay").classList.add("hidden");
    render();
    alert("Alles wurde gelöscht!");
  }
}

/* ---------------- Einstellungen umschalten ---------------- */
function toggleSettings() {
  const panel = document.getElementById("settingsPanel");
  panel.classList.toggle("hidden");
  render(); // 👈 neu: sofort neu rendern, damit ✎-Buttons an/aus gehen
}


render();

