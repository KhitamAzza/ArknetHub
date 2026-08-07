const API_URL = "https://script.google.com/macros/s/AKfycbxyS9_P4Ktcy5LQ27g1sHM_eJNiOdvAJxIosVKY3Rq4bjAwn9HZ9ho_zPN4A5nDZILXpw/exec";

const OPERATORS = {
  "azkiahasna": { name: "Chusnul Khitam Azza", ekstra: "MASTER", isMaster: true },
  "devkoord1": { name: "Hernanda", ekstra: "MASTER", isMaster: true },
  // "devtatib1": { name: "Syamsul Arif", ekstra: "MASTER", isMaster: true },
  // "devtatib2": { name: "Siti Munawaroh", ekstra: "MASTER", isMaster: true },
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
  "ekstabog": { name: "Enggarsari", ekstra: "Tata Boga" },
  "eksarias": { name: "Silvina Maghfira", ekstra: "Tata rias" },
  "ekstapmr": { name: "Nur Khozinatul", ekstra: "PMR" },
  "ekswondo": { name: "jalupaka", ekstra: "Taekwondo" },
  "eksdance": { name: "Ocha", ekstra: "Dance" },
  "ekscatur": { name: "Vanny", ekstra: "Catur" },
  "ekscinalam": { name: "Badrian", ekstra: "Pecinta Alam" },
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

let appBundle = null;   // cached bundle data
let bundlePromise = null; // dedup concurrent calls

let isHelper = false;

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

// ===== GLOBAL SCREEN HIDER =====
function hideAllScreens() {
  const ids = [
    "loginScreen", "dashboardScreen", "mainApp", "listScreen",
    "absenMenuScreen", "registrationScreen", "summaryModal",
    "adminScreen", "helperScreen", "overseerScreen",
    "fixerScreen", "configScreen", "lateRecordScreen",
    "faceScanScreen", "danaHistoryScreen", "syaratScreen",
    "daftarScreen", "searchOverlay", "ketuaScreen"   // ← ADDED
  ];
  ids.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = "none";
  });
  if (summaryModal) summaryModal.classList.remove("visible");
  closeSearch();
}

// ===== LOGIN / LOGOUT =====
async function doLogin() {
  const rawPassword = passwordInput.value.trim();
  const password = rawPassword.toLowerCase();

  // === 1. TEACHER / ADMIN / PEMBINA ===
  if (OPERATORS[password]) {
    const op = OPERATORS[password];
    currentOperator = op.name;
    currentEkstra = op.ekstra;
    isMaster = !!op.isMaster;
    isHelper = false;

    operatorNameEl.textContent = op.name;
    if (op.isMaster) {
      operatorEkstraEl.textContent = "ADMIN MODE";
      operatorEkstraEl.classList.add("master-mode");
    } else {
      operatorEkstraEl.textContent = op.ekstra;
      operatorEkstraEl.classList.remove("master-mode");
    }

    dashTeacherName.textContent = op.name;
    if (regDashBtn) {
      if (op.isMaster) {
        regDashBtn.classList.add("placeholder");
        regDashBtn.onclick = () => showStatus("MASTER tidak dapat menyetujui pendaftaran", "info");
      } else {
        regDashBtn.classList.remove("placeholder");
        regDashBtn.onclick = showRegistration;
      }
    }

    loginError.style.display = "none";
    if (isMaster) showAdminScreen();
    else showDashboard();
    updateRegBadge();
    return;
  }

  // === 2. FETCH CONFIG ONCE FOR HELPER & KETUA ===
  let cfg = null;
  try {
    showLoading(true);
    const res = await fetch(API_URL + "?action=getConfig");
    cfg = await res.json();
    showLoading(false);
  } catch (e) {
    showLoading(false);
    console.error("Config fetch failed", e);
  }

  if (cfg && cfg.status === "ok") {

    // === 2a. HELPER / PANITIA ===
    const cfgPassword = String(cfg.helperPassword || "").trim();
    const cfgEnable = String(cfg.helperEnable).toUpperCase() === "TRUE" || cfg.helperEnable === true;
    if (cfgEnable && rawPassword === cfgPassword) {
      isHelper = true;
      currentOperator = "Panitia";
      currentEkstra = "MASTER";
      isMaster = true;
      hideAllScreens();
      const el = document.getElementById("helperScreen");
      if (el) el.style.display = "flex";
      return;
    }

    // === 2b. KETUA EKSKUL ===
    if (cfg.ketuaMap && typeof cfg.ketuaMap === 'object') {
      const ekstra = cfg.ketuaMap[password]; // password already lowercased
      if (ekstra) {
        isHelper = false;
        isMaster = false;
        currentOperator = "Ketua " + ekstra;
        currentEkstra = ekstra;
        loginError.style.display = "none";
        showKetuaDashboard();
        return;
      }
    }
  }

  // === 3. ALL FAILED ===
  loginError.style.display = "block";
  passwordInput.value = "";
  passwordInput.focus();
}

// ===== NAVIGATION =====
function showDashboard() {
  if (dashboardScreen) dashboardScreen.style.display = "flex";
  mainApp.style.display = "none";
  absenMenuScreen.style.display = "none";
  registrationScreen.style.display = "none";
  const admin = document.getElementById("adminScreen");
  const helper = document.getElementById("helperScreen");
  if (admin) admin.style.display = "none";
  if (helper) helper.style.display = "none";
}

function showAdminScreen() {
//   hideAllScreens();
  const el = document.getElementById("adminScreen");
  if (el) {
    el.style.display = "flex";
    document.getElementById("adminTeacherName").textContent = currentOperator;
  }
}

function backToAdmin() {
//   hideAllScreens();
  showAdminScreen();
}

function backToAbsenMenu() {
  mainApp.style.display = "none";
  listScreen.style.display = "none";
  summaryModal.classList.remove("visible");
  closeSearch();
  if (isHelper) {
    showHelperScreen();
  } else if (isMaster) {
    showAdminScreen();
  } else if (currentOperator && currentOperator.startsWith("Ketua ")) {
    showKetuaDashboard();
  } else {
    absenMenuScreen.style.display = "flex";
  }
  currentMode = null;
}

function showAdminAbsen() {
  currentMode = 'REEL';
  isMaster = true;
  currentEkstra = "MASTER";
  if (absenMenuScreen) absenMenuScreen.style.display = "flex";
}

// ===== FIXER MODE (placeholder nav) =====
function showFixerMode() {
  hideAllScreens();
  const el = document.getElementById("fixerScreen");
  if (el) {
    el.style.display = "flex";
    initFixerMode();
  }
}

function showConfigMenu() {
  hideAllScreens();
  const el = document.getElementById("configScreen");
  if (el) {
    el.style.display = "flex";
    initConfigMenu();
  }
}

function showOverseerView() {
  hideAllScreens();
  const el = document.getElementById("overseerScreen");
  if (el) {
    el.style.display = "flex";
    loadOverseerData();
  }
}

function doLogout() {
  // Reset ALL state
  currentOperator = null;
  currentEkstra = null;
  isMaster = false;
  isHelper = false;
  currentMode = null;
  allStudents = [];
  totalStudents = [];
  currentIndex = 0;
  markedStudents.clear();
  sheetStatus.clear();
  currentPeriod = null;
  appBundle = null;
  bundlePromise = null;

  // Reset fixer/admin state if exists
  if (typeof helperLateStudents !== 'undefined') helperLateStudents = [];
  if (typeof fixerSelectedStudent !== 'undefined') fixerSelectedStudent = null;
  if (typeof configChanges !== 'undefined') configChanges = {};

  // Hide everything, show login
  hideAllScreens();
  loginScreen.style.display = "flex";
  passwordInput.value = "";
  passwordInput.focus();
}

// ===== BUNDLE LOADER =====
async function loadBundle(force = false) {
  if (!force && appBundle) return appBundle;
  if (bundlePromise) return bundlePromise; // dedup

  const today = getJakartaDateString();
  const ekstraParam = isMaster ? "MASTER" : currentEkstra;
  if (!ekstraParam) return null;

  showLoading(true);
  bundlePromise = fetch(
    API_URL + "?action=getBundle&ekstra=" + encodeURIComponent(ekstraParam) + "&date=" + encodeURIComponent(today)
  )
    .then(r => r.json())
    .then(data => {
      if (data.status === "ok") {
        appBundle = data;
        // Pre-hydrate shared state
        currentPeriod = data.period;
        totalStudents = data.students || [];
        sheetStatus.clear();
        (data.students || []).forEach(s => {
          if (s.status) sheetStatus.set(s.nama, s.status);
        });
        return data;
      }
      throw new Error(data.message);
    })
    .catch(err => {
      console.error("Bundle load failed:", err);
      return null;
    })
    .finally(() => {
      showLoading(false);
      bundlePromise = null;
    });

  return bundlePromise;
}

function clearBundle() {
  appBundle = null;
}

function showKetuaDashboard() {
  hideAllScreens();
  const el = document.getElementById("ketuaScreen");
  if (el) {
    el.style.display = "flex";
    const nameEl = document.getElementById("ketuaEkskulName");
    if (nameEl) nameEl.textContent = currentEkstra;
  }
}

function showKetuaAbsen() {
  currentMode = 'REEL';
  hideAllScreens();
  const el = document.getElementById("absenMenuScreen");
  if (el) el.style.display = "flex";
}
// ===== NAVIGATION =====
function showDashboard() {
  hideAllScreens();
  if (dashboardScreen) dashboardScreen.style.display = "flex";
}

function showAdminScreen() {
  hideAllScreens();
  const el = document.getElementById("adminScreen");
  if (el) {
    el.style.display = "flex";
    const nameEl = document.getElementById("adminTeacherName");
    if (nameEl) nameEl.textContent = currentOperator || "Admin";
  }
}

function showHelperScreen() {
  hideAllScreens();
  const el = document.getElementById("helperScreen");
  if (el) el.style.display = "flex";
}

function backToAdmin() {
  showAdminScreen();
}

function backToHelper() {
  showHelperScreen();
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
  if (isHelper) {
    showHelperScreen();
  } else if (isMaster) {
    showAdminScreen();
  } else if (currentOperator && currentOperator.startsWith("Ketua ")) {
    showKetuaDashboard();
  } else {
    showDashboard();
  }
  updateRegBadge();
}

function showReelAttendance() {
  currentMode = 'REEL';
  absenMenuScreen.style.display = "none";
  mainApp.style.display = "flex";
  activateBackGuard('reel');   // ← ADD THIS
  activateBackTrap('reel');
  loadStudents();
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
    const bundle = await loadBundle();
    if (!bundle) throw new Error("Gagal memuat bundle");

    currentPeriod = bundle.period;

    // Update period pill
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

    let fetched = bundle.students || [];
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
  } catch (err) {
    console.error(err);
    showStatus("Error memuat data: " + err.message, "error");
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
    const bundle = await loadBundle();
    const count = (bundle?.pendingRegistrations || []).length;
    const badge = document.getElementById("regBadge");
    if (badge) {
      if (count > 0) {
        badge.textContent = count > 99 ? "99+" : count;
        badge.style.display = "flex";
      } else {
        badge.style.display = "none";
      }
    }
  } catch (e) { /* silent */ }
}

function showDaftarSiswa() {
  // Implemented in daftar.js
}
// Fetch config early to show/hide helper login hint
fetch(API_URL + "?action=getConfig")
  .then(r => r.json())
  .then(cfg => {
    if (cfg.status === "ok" && cfg.helperEnable) {
      const hint = document.getElementById("loginHelperHint");
      if (hint) hint.style.display = "block";
    }
  })
  .catch(() => {});

/* ============================================
   BACK BUTTON FAILSAFE
   Blocks hardware back & on-screen back
   when unsent attendance data exists
   ============================================ */

let backGuardScreen = null;
let backBlockScreen = null;

function hasUnsentData() {
  if (typeof markedStudents !== 'undefined' && markedStudents.size > 0) return true;
  if (typeof faceUnsentQueue !== 'undefined' && faceUnsentQueue.length > 0) return true;
  return false;
}

function activateBackGuard(screen) {
  backGuardScreen = screen;
  history.pushState({screen: screen}, '');
}

function showBackBlockModal(screen) {
  backBlockScreen = screen;
  const countEl = document.getElementById('backBlockCount');
  if (countEl) {
    let count = 0;
    if (screen === 'reel' && typeof markedStudents !== 'undefined') count = markedStudents.size;
    if (screen === 'face' && typeof faceUnsentQueue !== 'undefined') count = faceUnsentQueue.length;
    countEl.textContent = count;
  }
  const modal = document.getElementById('backBlockModal');
  if (modal) modal.classList.add('visible');
}

function dismissBackBlock() {
  const modal = document.getElementById('backBlockModal');
  if (modal) modal.classList.remove('visible');
  if (backBlockScreen) {
    activateBackGuard(backBlockScreen);
  }
  backBlockScreen = null;
}

function confirmBackBlock() {
  const modal = document.getElementById('backBlockModal');
  if (modal) modal.classList.remove('visible');
  
  backGuardScreen = null; // disarm
  
  if (backBlockScreen === 'reel') {
    if (typeof markedStudents !== 'undefined') markedStudents.clear();
    backToAbsenMenu();
  } else if (backBlockScreen === 'face') {
    if (typeof faceScanned !== 'undefined') faceScanned.clear();
    if (typeof faceUnsentQueue !== 'undefined') faceUnsentQueue = [];
    backFromFaceScan();
  }
  backBlockScreen = null;
}

// Safe wrappers for on-screen back buttons
function safeBackToAbsenMenu() {
  if (mainApp.style.display !== 'none' && hasUnsentData()) {
    showBackBlockModal('reel');
    return;
  }
  backGuardScreen = null;
  backToAbsenMenu();
}

function safeBackFromFaceScan() {
  const faceScreen = document.getElementById('faceScanScreen');
  if (faceScreen && faceScreen.style.display !== 'none' && hasUnsentData()) {
    showBackBlockModal('face');
    return;
  }
  backGuardScreen = null;
  backFromFaceScan();
}

// Hardware back button interceptor
window.addEventListener('popstate', (e) => {
  const screen = e.state?.screen;
  if (!screen || screen !== backGuardScreen) return;

  if (hasUnsentData()) {
    showBackBlockModal(screen);
    activateBackGuard(screen);
  } else {
    backGuardScreen = null;
    if (screen === 'reel') backToAbsenMenu();
    else if (screen === 'face') backFromFaceScan();
  }
});

// Refresh / close tab warning
window.addEventListener('beforeunload', (e) => {
  if (hasUnsentData()) {
    e.preventDefault();
    e.returnValue = '';
  }
});
/* ============================================
   PHONE BACK BUTTON FAILSAFE
   ============================================ */

let backTrapActive = false;

function activateBackTrap(screenName) {
  backTrapActive = true;
  // Push a dummy state so the next back press fires popstate
  history.pushState({ guard: screenName }, "", location.href);
}

function deactivateBackTrap() {
  backTrapActive = false;
}

// Hardware back button interceptor (Android)
window.addEventListener("popstate", (e) => {
  if (!backTrapActive) return;

  const hasData = (typeof markedStudents !== 'undefined' && markedStudents.size > 0) ||
                  (typeof faceUnsentQueue !== 'undefined' && faceUnsentQueue.length > 0);

  if (hasData) {
    // Re-trap immediately so the next back press is caught again
    history.pushState({ guard: true }, "", location.href);
    showBackBlockModal(e.state?.guard || 'reel');
  } else {
    deactivateBackTrap();
    // Let it go back normally
    history.back();
  }
});
