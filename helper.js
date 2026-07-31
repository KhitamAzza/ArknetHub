// ============================================
// helper.js — Panitia mode: Master absen + Catat Keterlambatan
// ============================================

let helperLateStudents = [];   // {nama, kelas}
let allDatabaseStudents = [];  // predictive source
let countdownInterval = null;

// ===== SCREEN NAVIGATION =====
function showHelperScreen() {
  // hideAllScreens();
  const el = document.getElementById("helperScreen");
  if (el) el.style.display = "flex";
}

function backToHelper() {
  stopCountdown();
  // hideAllScreens();
  showHelperScreen();
}

// function hideAllScreens() {
//   if (loginScreen) loginScreen.style.display = "none";
//   if (dashboardScreen) dashboardScreen.style.display = "none";
//   if (absenMenuScreen) absenMenuScreen.style.display = "none";
//   if (mainApp) mainApp.style.display = "none";
//   if (listScreen) listScreen.style.display = "none";
//   if (registrationScreen) registrationScreen.style.display = "none";
//   const hs = document.getElementById("helperScreen");
//   const ls = document.getElementById("lateRecordScreen");
//   const fs = document.getElementById("faceScanScreen");
//   if (hs) hs.style.display = "none";
//   if (ls) ls.style.display = "none";
//   if (fs) fs.style.display = "none";
// }

// ===== 1. ABSEN SISWA (Master Mode) =====
function showHelperAbsen() {
  currentMode = 'REEL';
  isMaster = true;
  currentEkstra = "MASTER";
  hideAllScreens();
  if (absenMenuScreen) absenMenuScreen.style.display = "flex";
}

// ===== 2. CATAT KETERLAMBATAN =====
function showLateRecord() {
  hideAllScreens();
  const el = document.getElementById("lateRecordScreen");
  if (el) el.style.display = "flex";

  helperLateStudents = [];
  renderLateSelected();
  startCountdown();
  loadDatabaseStudents();

  // Predictive + remove delegation
  const pred = document.getElementById("latePredictive");
  const list = document.getElementById("lateSelectedList");
  if (pred) {
    pred.onclick = (e) => {
      const item = e.target.closest(".predictive-item");
      if (!item) return;
      const nama = decodeURIComponent(item.dataset.nama);
      const kelas = decodeURIComponent(item.dataset.kelas || "");
      addLateStudent(nama, kelas);
    };
  }
  if (list) {
    list.onclick = (e) => {
      const btn = e.target.closest('[data-action="remove"]');
      if (!btn) return;
      const idx = parseInt(btn.dataset.idx, 10);
      if (!isNaN(idx)) {
        helperLateStudents.splice(idx, 1);
        renderLateSelected();
      }
    };
  }

  // Close predictive when tapping outside
  document.addEventListener("click", closePredictiveOutside);
}

function closePredictiveOutside(e) {
  const wrap = document.querySelector(".late-search-wrap");
  const pred = document.getElementById("latePredictive");
  if (wrap && pred && !wrap.contains(e.target)) {
    pred.style.display = "none";
  }
}

async function loadDatabaseStudents() {
  try {
    const res = await fetch(API_URL + "?action=getDatabase");
    const data = await res.json();
    if (data.status === "ok") {
      allDatabaseStudents = data.data || [];
    }
  } catch (e) {
    console.error("Failed to load database", e);
  }
}

// ===== SEARCH & PREDICTIVE =====
const lateSearchInput = document.getElementById("lateSearchInput");
const latePredictive = document.getElementById("latePredictive");

if (lateSearchInput) {
  lateSearchInput.addEventListener("input", (e) => {
    const q = e.target.value.trim().toLowerCase();
    if (!q) {
      if (latePredictive) latePredictive.style.display = "none";
      return;
    }

    const matches = allDatabaseStudents.filter(s =>
      s.nama && s.nama.toLowerCase().includes(q) &&
      !helperLateStudents.find(ls => ls.nama === s.nama)
    ).slice(0, 5);

    if (!matches.length) {
      if (latePredictive) latePredictive.style.display = "none";
      return;
    }

    if (latePredictive) {
      latePredictive.innerHTML = matches.map(s => `
        <div class="predictive-item" data-nama="${encodeURIComponent(s.nama)}" data-kelas="${encodeURIComponent(s.kelas || '')}">
          <div class="pred-name">${highlightMatch(escapeHtml(s.nama), q)}</div>
          <div class="pred-class">${escapeHtml(s.kelas || '')}</div>
        </div>
      `).join("");
      latePredictive.style.display = "block";
    }
  });
}

function highlightMatch(text, query) {
  const idx = text.toLowerCase().indexOf(query);
  if (idx === -1) return text;
  return text.substring(0, idx) + '<b>' + text.substring(idx, idx + query.length) + '</b>' + text.substring(idx + query.length);
}

function addLateStudent(nama, kelas) {
  if (helperLateStudents.find(s => s.nama === nama)) return;
  helperLateStudents.push({ nama, kelas });
  if (lateSearchInput) lateSearchInput.value = "";
  if (latePredictive) latePredictive.style.display = "none";
  renderLateSelected();
}

function renderLateSelected() {
  const list = document.getElementById("lateSelectedList");
  const empty = document.getElementById("lateEmpty");
  const saveBtn = document.getElementById("lateSaveBtn");

  if (!list) return;

  if (helperLateStudents.length === 0) {
    list.innerHTML = "";
    if (empty) empty.style.display = "block";
    if (saveBtn) saveBtn.disabled = true;
    return;
  }

  if (empty) empty.style.display = "none";
  if (saveBtn) saveBtn.disabled = false;

  list.innerHTML = helperLateStudents.map((s, idx) => `
    <div class="late-list-item">
      <div class="late-list-info">
        <div class="late-list-name">${escapeHtml(s.nama)}</div>
        <div class="late-list-class">${escapeHtml(s.kelas || '')}</div>
      </div>
      <button class="late-chip-remove" data-action="remove" data-idx="${idx}">✕</button>
    </div>
  `).join("");
}

// ===== COUNTDOWN (Pagi period end) =====
function startCountdown() {
  if (countdownInterval) clearInterval(countdownInterval);
  updateCountdown();
  countdownInterval = setInterval(updateCountdown, 1000);
}

function stopCountdown() {
  if (countdownInterval) {
    clearInterval(countdownInterval);
    countdownInterval = null;
  }
}

function updateCountdown() {
  const el = document.getElementById("countdownValue");
  const labelEl = document.getElementById("countdownLabel");
  if (!el) return;

  const cfg = window.appConfig || {};
  if (!cfg.pagiEnd) {
    el.textContent = "--:--:--";
    return;
  }

  const pagiEnd = cfg.pagiEnd;
  const endHour = Math.floor(pagiEnd);
  const endMinute = Math.round((pagiEnd - endHour) * 100);

  const now = new Date();
  const jakarta = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Jakarta" }));
  let target = new Date(jakarta);
  target.setHours(endHour, endMinute, 0, 0);

  let diff = target - jakarta;

  if (diff <= 0) {
    el.textContent = "00:00:00";
    el.style.color = "var(--red)";
    if (labelEl) {
      labelEl.textContent = "Silakan masukkan siswa";
      labelEl.style.color = "var(--green)";
    }
    return;
  }

  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  const s = Math.floor((diff % 60000) / 1000);

  el.textContent = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  el.style.color = "var(--yellow)";
  if (labelEl) {
    labelEl.textContent = "Jangan absen siswa sampai periode pagi selesai";
    labelEl.style.color = "var(--text-secondary)";
  }
}

// ===== CONFIRM & SUBMIT =====
function openLateConfirm() {
  const body = document.getElementById("lateConfirmBody");
  if (!body) return;

  body.innerHTML = `
    <div style="margin-bottom:16px;font-size:14px;color:var(--text-secondary);">
      Akan mencatat keterlambatan untuk <b>${helperLateStudents.length}</b> siswa:
    </div>
    ${helperLateStudents.map(s => `
      <div class="summary-item">
        <div class="summary-avatar">👤</div>
        <div class="summary-item-name">${escapeHtml(s.nama)}</div>
        <div class="summary-item-class">${escapeHtml(s.kelas || '')}</div>
      </div>
    `).join("")}
  `;
  const modal = document.getElementById("lateConfirmModal");
  if (modal) modal.classList.add("visible");
}

function closeLateConfirm() {
  const modal = document.getElementById("lateConfirmModal");
  if (modal) modal.classList.remove("visible");
}

async function submitLateRecord() {
  closeLateConfirm();
  showLoading(true);

  try {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({
        action: "submitLateRecord",
        students: helperLateStudents,   // [{nama, kelas}, ...]
        operator: currentOperator,
        date: getJakartaDateString()
      })
    });

    const data = await res.json();
    if (data.status === "ok") {
      let msg = `✓ ${data.updated} keterlambatan tercatat`;
      if (data.notFound && data.notFound.length) msg += ` (${data.notFound.length} tidak ditemukan)`;
      showStatus(msg, "ok");
      helperLateStudents = [];
      renderLateSelected();
    } else {
      showStatus(data.message || "Gagal mencatat", "error");
    }
  } catch (err) {
    showStatus("Error koneksi: " + err.message, "error");
  }

  showLoading(false);
}

// ===== UTILS =====
function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text || "";
  return div.innerHTML;
}

// Expose config to helper.js via global
fetch(API_URL + "?action=getConfig")
  .then(r => r.json())
  .then(cfg => {
    if (cfg.status === "ok") window.appConfig = cfg;
  })
  .catch(() => {});