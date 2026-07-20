const API_URL = "https://script.google.com/macros/s/AKfycbwHPt6TQdSq3bVSQLZXmz_FVDnfPzODgBJg04mAGboZ8fwVZYTQwGiiGNAesIY1bXEZTw/exec";

const OPERATORS = {
  "azkiahasna": { name: "Chusnul Khitam Azza", ekstra: "MASTER", isMaster: true },
  "devkoord1": { name: "Prihanto Wahyu", ekstra: "MASTER", isMaster: true },
  "devtatib1": { name: "Syamsul Arif", ekstra: "MASTER", isMaster: true },
  "devtatib2": { name: "Siti Munawaroh", ekstra: "MASTER", isMaster: true },
  "eksesport": { name: "Masduki Zen", ekstra: "E-Sport" },
  "eksfutsal": { name: "Rizky", ekstra: "Futsal" },
  "ekspakbola": { name: "Rico Yoga", ekstra: "Sepakbola" },
  "eksperdiri": { name: "Yudi Setiono", ekstra: "Perisai diri" },
  "eksmusik": { name: "M ismail", ekstra: "Musik" },
  "eksminton": { name: "Deni Affandi", ekstra: "Badminton" },
  "eksbasket": { name: "Syamsul Arif", ekstra: "Basket" },
  "eksbvoli": { name: "Achamd Wahyudi", ekstra: "Bola Voli" },
  "eksbanjari": { name: "Rahmad Hidayat", ekstra: "Al-Banjari" },
  "ekstari": { name: "Nila", ekstra: "Seni tari" },
  "ekstabog": { name: "M Iqbal", ekstra: "Tata Boga" },
  "eksarias": { name: "Dina", ekstra: "Tata rias" },
  "ekstapmr": { name: "Nur Khozinatul", ekstra: "PMR" },
  "ekswondo": { name: "jalupaka", ekstra: "Taekwondo" },
  "eksdance": { name: "Ocha", ekstra: "Dance" },
  "ekscatur": { name: "Vanny", ekstra: "Catur" },
  "ekscinalam": { name: "Ergananta", ekstra: "Pecinta Alam" },
  "ekspramu": { name: "kakak pembina", ekstra: "Pramuka" }
};

const BULAN_ID = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember"
];

// ===== STATE =====
let currentOperator = null;
let currentEkstra = null;
let currentMode = null;
let isMaster = false;
let allStudents = [];
let totalStudents = [];
let currentIndex = 0;
let markedStudents = new Map();
let sheetStatus = new Map();
let currentPeriod = null;
let isSubmitting = false;


// ===== DOM REFS =====
const loginScreen = document.getElementById("loginScreen");
const mainApp = document.getElementById("mainApp");
const listScreen = document.getElementById("listScreen");
const passwordInput = document.getElementById("passwordInput");
const loginError = document.getElementById("loginError");
const operatorNameEl = document.getElementById("operatorName");
const operatorEkstraEl = document.getElementById("operatorEkstra");
const reelContainer = document.getElementById("reelContainer");
const emptyState = document.getElementById("emptyState");
const markBtn = document.getElementById("markBtn");
const kirimBtn = document.getElementById("kirimBtn");
const statusOverlay = document.getElementById("statusOverlay");
const loadingOverlay = document.getElementById("loadingOverlay");
const summaryModal = document.getElementById("summaryModal");
const summaryBody = document.getElementById("summaryBody");
const periodPill = document.getElementById("periodPill");
const searchOverlay = document.getElementById("searchOverlay");
const searchInput = document.getElementById("searchInput");
const searchResults = document.getElementById("searchResults");

// NEW SCREENS
const dashboardScreen = document.getElementById("dashboardScreen");
const absenMenuScreen = document.getElementById("absenMenuScreen");
const registrationScreen = document.getElementById("registrationScreen");
const dashTeacherName = document.getElementById("dashTeacherName");
const regDashBtn = document.getElementById("regDashBtn");

// ===== LOGIN / LOGOUT =====
function doLogin() {
  const password = passwordInput.value.trim().toLowerCase();
  if (OPERATORS[password]) {
    const op = OPERATORS[password];
    currentOperator = op.name;
    currentEkstra = op.ekstra;
    isMaster = !!op.isMaster;

    // Header info
    operatorNameEl.textContent = op.name;
    if (op.isMaster) {
      operatorEkstraEl.textContent = "MASTER MODE";
      operatorEkstraEl.classList.add("master-mode");
    } else {
      operatorEkstraEl.textContent = op.ekstra;
      operatorEkstraEl.classList.remove("master-mode");
    }

    // Dashboard info
    dashTeacherName.textContent = op.name;

    // MASTER cannot access registration
    if (regDashBtn) {
      if (op.isMaster) {
        regDashBtn.classList.add("placeholder");
        regDashBtn.onclick = () => showStatus("MASTER tidak dapat menyetujui pendaftaran", "info");
      } else {
        regDashBtn.classList.remove("placeholder");
        regDashBtn.onclick = showRegistration;
      }
    }

    loginScreen.style.display = "none";
    loginError.style.display = "none";
    showDashboard();
    updateRegBadge();
  } else {
    loginError.style.display = "block";
    passwordInput.value = "";
    passwordInput.focus();
  }
}

function doLogout() {
  currentOperator = null;
  currentEkstra = null;
  isMaster = false;
  currentMode = null; // ← ADD
  allStudents = [];
  totalStudents = [];
  currentIndex = 0;
  markedStudents.clear();
  sheetStatus.clear();
  currentPeriod = null;

  mainApp.style.display = "none";
  listScreen.style.display = "none";
  summaryModal.classList.remove("visible");
  closeSearch();
  if (dashboardScreen) dashboardScreen.style.display = "none";
  if (absenMenuScreen) absenMenuScreen.style.display = "none";
  if (registrationScreen) registrationScreen.style.display = "none";

  loginScreen.style.display = "flex";
  passwordInput.value = "";
  passwordInput.focus();
}

// ===== NAVIGATION =====
function showDashboard() {
  if (dashboardScreen) dashboardScreen.style.display = "flex";
  mainApp.style.display = "none";
  absenMenuScreen.style.display = "none";
  registrationScreen.style.display = "none";
}

function showAbsenMenu() {
  dashboardScreen.style.display = "none";
  absenMenuScreen.style.display = "flex";
}

function backToDashboard() {
  mainApp.style.display = "none";
  absenMenuScreen.style.display = "none";
  registrationScreen.style.display = "none";
  listScreen.style.display = "none";
  showDashboard();
  updateRegBadge();
}

function showReelAttendance() {
  currentMode = 'REEL';
  absenMenuScreen.style.display = "none";
  mainApp.style.display = "flex";
  loadStudents();
}

function backToAbsenMenu() {
  mainApp.style.display = "none";
  listScreen.style.display = "none";
  summaryModal.classList.remove("visible");
  closeSearch();
  absenMenuScreen.style.display = "flex";
  currentMode = null; // ← ADD
}

// AFTER
function showFaceID() {
  showStatus("Fitur ini belum tersedia", "info");
}

// ===== DATE =====
function getJakartaDateString() {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Jakarta",
    day: "numeric",
    month: "numeric",
    year: "numeric"
  });
  const parts = {};
  fmt.formatToParts(new Date()).forEach(p => { parts[p.type] = p.value; });
  const day = parseInt(parts.day, 10);
  const monthNum = parseInt(parts.month, 10) - 1;
  const year = parts.year;
  return day + " " + BULAN_ID[monthNum] + " " + year;
}

// ===== DATA LOAD =====
async function loadStudents() {
  showLoading(true);
  try {
    const today = getJakartaDateString();
    const isMaster = currentEkstra === "MASTER";
    const ekstraParam = isMaster ? "MASTER" : currentEkstra;

    const res = await fetch(API_URL + "?action=getStudentsByEkstra&ekstra=" + encodeURIComponent(ekstraParam) + "&date=" + encodeURIComponent(today));
    const data = await res.json();

    if (data.status === "ok") {
      currentPeriod = {
        isPagi: data.isPagiPeriod,
        isEkstra: data.isEkstraPeriod,
        isOutside: data.isOutsideHours
      };

      if (periodPill) {
        if (currentPeriod.isPagi) {
          periodPill.textContent = "PAGI";
          periodPill.style.color = "var(--green)";
        } else if (currentPeriod.isEkstra) {
          periodPill.textContent = "EKSTRA";
          periodPill.style.color = "var(--accent)";
        } else {
          periodPill.textContent = "CLOSED";
          periodPill.style.color = "var(--red)";
        }
      }

      let fetched = data.data || [];
      if (!isMaster) {
        fetched = fetched.filter(s => s.ekstra && s.ekstra.toLowerCase() === currentEkstra.toLowerCase());
      }

      totalStudents = fetched;
      sheetStatus.clear();
      fetched.forEach(s => { if (s.status) sheetStatus.set(s.nama, s.status); });

      markedStudents.clear();
      allStudents = filterForReel(fetched);
      currentIndex = 0;

      updateStats();

      if (allStudents.length === 0) {
        renderCard(-1);
        emptyState.style.display = "block";
        showSummary();
      } else {
        emptyState.style.display = "none";
        renderCard(currentIndex);
      }
    } else {
      showStatus(data.message || "Gagal memuat data", "error");
    }
  } catch (err) {
    console.error(err);
    showStatus("Error koneksi: " + err.message, "error");
  }
  showLoading(false);
}

// ===== SEARCH =====
function openSearch() {
  if (searchOverlay) {
    searchOverlay.style.display = "flex";
    searchInput.value = "";
    searchResults.innerHTML = "";
    searchInput.focus();
  }
}

function closeSearch() {
  if (searchOverlay) searchOverlay.style.display = "none";
}

function handleSearch() {
  const q = searchInput.value.trim().toLowerCase();
  if (!q) {
    searchResults.innerHTML = "";
    return;
  }

  const matches = totalStudents.filter(s => s.nama.toLowerCase().includes(q));
  searchResults.innerHTML = "";

  if (matches.length === 0) {
    searchResults.innerHTML = `<div style="padding:12px;color:var(--text-secondary);text-align:center;">Tidak ditemukan</div>`;
    return;
  }

  matches.forEach(s => {
    const row = document.createElement("div");
    const isDone = !!s.status || markedStudents.has(s.nama);
    row.className = "search-item";
    row.style.cssText = "display:flex;align-items:center;padding:12px 16px;border-bottom:1px solid var(--border);gap:12px;cursor:pointer;";
    row.innerHTML = `
      <img src="${s.foto || ''}" style="width:36px;height:36px;border-radius:8px;object-fit:cover;background:var(--bg);" onerror="this.style.display='none'">
      <div style="flex:1;">
        <div style="font-weight:700;font-size:14px;">${s.nama}</div>
        <div style="font-size:12px;color:var(--text-secondary);">${s.kelas} • ${s.ekstra}</div>
      </div>
      <div style="font-size:12px;font-weight:700;color:${isDone ? 'var(--green)' : 'var(--red)'};">${isDone ? '✓' : '○'}</div>
    `;
    row.onclick = () => {
      closeSearch();
      const reelIdx = allStudents.findIndex(st => st.nama === s.nama);
      if (reelIdx >= 0) {
        currentIndex = reelIdx;
        renderCard(currentIndex);
      } else {
        showStatus("Siswa sudah selesai diabsen", "info");
      }
    };
    searchResults.appendChild(row);
  });
}

// ===== STATUS & LOADING =====
function showStatus(message, type) {
  statusOverlay.textContent = message;
  statusOverlay.className = "status-overlay status-" + type;
  statusOverlay.style.opacity = "1";
  setTimeout(() => { statusOverlay.style.opacity = "0"; }, 1800);
}

function showLoading(show) {
  loadingOverlay.classList.toggle("visible", show);
}

// ===== INIT =====
passwordInput.addEventListener("keypress", (e) => {
  if (e.key === "Enter") doLogin();
});

passwordInput.addEventListener("input", () => {
  const password = passwordInput.value.trim().toLowerCase();
  if (OPERATORS[password]) {
    doLogin();
  }
});

window.addEventListener("DOMContentLoaded", () => {
  passwordInput.focus();
});

document.addEventListener("keydown", (e) => {
  if (mainApp.style.display !== "none") {
    if (e.key === "ArrowRight") nextStudent();
    if (e.key === "ArrowLeft") prevStudent();
    if (e.key === "Enter" || e.key === " ") markCurrentStudent();
  }
});

async function updateRegBadge() {
  if (!currentEkstra || isMaster) return;
  try {
    const res = await fetch(API_URL + "?action=getPendingRegistrations&ekstra=" + encodeURIComponent(currentEkstra));
    const data = await res.json();
    const badge = document.getElementById("regBadge");
    if (badge && data.status === "ok") {
      const count = (data.data || []).length;
      if (count > 0) {
        badge.textContent = count > 99 ? "99+" : count;
        badge.style.display = "flex";
      } else {
        badge.style.display = "none";
      }
    }
  } catch (e) { /* silent fail */ }
}
function showDaftarSiswa() {
  // Implemented in daftar.js
}