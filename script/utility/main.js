const SUPABASE_URL = 'https://wkflyxloaywqigowjsfd.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndrZmx5eGxvYXl3cWlnb3dqc2ZkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYwNTczOTQsImV4cCI6MjEwMTYzMzM5NH0.ppm4u2fWS3Mz3kGqN5zGOvYSC6vSaETzS4hzEfXIcwQ';
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// ===== RESILIENT GET HELPER =====
async function fetchJsonWithRetry(url, retries = 2, delayMs = 700) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, { cache: "no-store" });
      return await res.json();
    } catch (err) {
      if (attempt === retries) throw err;
      await new Promise(r => setTimeout(r, delayMs * (attempt + 1)));
    }
  }
}

const OPERATORS = {
  "azkiahasna": { name: "Chusnul Khitam Azza", ekstra: "MASTER", isMaster: true },
  "devkoord1": { name: "Hernanda", ekstra: "MASTER", isMaster: true },
  "tatib1": { name: "Syamsul Arif", ekstra: "TATIB", isTatib: true },      // ← ADD
  "tatib2": { name: "Masduki Zen", ekstra: "TATIB", isTatib: true },    // ← ADD
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
  "eksarias": { name: "Silvina Maghfira", ekstra: "Tata Rias" },
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
let currentSemester = 'STS (Ganjil)';
let currentOperator = null;
let currentEkstra = null;
let currentMode = null;
let isMaster = false;
let allStudents = [];
let totalStudents = [];
let currentIndex = 0;
let markedStudents = new Map(); // keyed by student.id (e.g. "KD-26001")
let sheetStatus = new Map();    // keyed by student.idlet currentPeriod = null;
let isSubmitting = false;

let appBundle = null;   // cached bundle data
let bundlePromise = null; // dedup concurrent calls

let isHelper = false;
let isTatib = false;

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
// ===== GLOBAL SCREEN HIDER =====
function hideAllScreens() {
  const ids = [
    "loginScreen", "dashboardScreen", "mainApp", "listScreen",
    "absenMenuScreen", "registrationScreen", "summaryModal",
    "adminScreen", "helperScreen", "overseerScreen",
    "fixerScreen", "configScreen", "lateRecordScreen",
    "faceScanScreen", "danaHistoryScreen", "syaratScreen",
    "daftarScreen", "searchOverlay", "ketuaScreen",
    "tatibScreen", "tatibPaymentScreen", "tatibHeatmapScreen",
    "tatibBermasalahScreen", "kelolaSiswaScreen", "tanpaEkstraModal",
    "expelModal", "paperScreen", "adminInputScreen", "proofViewerScreen",
    "kelolaAbsensiScreen", "printAbsensiScreen",
    "penarikanDendaScreen", "adminDendaPaymentScreen", "dendaDiterimaScreen"
  ];
  ids.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = "none";
  });

  const tatibModal = document.getElementById("tatibPaymentModal");
  if (tatibModal) tatibModal.classList.remove("visible");

  if (summaryModal) summaryModal.classList.remove("visible");
  closeSearch();
}
// ===== LOGIN / LOGOUT =====
async function doLogin() {
  const rawPassword = passwordInput.value.trim();
  const password = rawPassword.toLowerCase();

  // === 1. TEACHER / ADMIN / PEMBINA / TATIB ===
  if (OPERATORS[password]) {
    const op = OPERATORS[password];
    
    if (op.isTatib) {
      currentOperator = op.name;
      currentEkstra = op.ekstra;
      isMaster = false;
      isHelper = false;
      isTatib = true;
      loginError.style.display = "none";
      showTatibScreen();
      return;
    }
    
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

    // === 2. HELPER / PANITIA (Config table first, fallback to default) ===
  let dbHelperPassword = null;
  let dbHelperEnabled = false;

  try {
    const { data: cfg, error: cfgErr } = await sb
      .from('Config')
      .select('helper_password, helper_enable')
      .eq('id', 1)
      .maybeSingle();

    if (!cfgErr && cfg) {
      dbHelperPassword = cfg.helper_password;
      dbHelperEnabled = cfg.helper_enable;
    }
  } catch (e) {
    console.error("Helper config check failed", e);
  }

  const fallbackPassword = getDefaultConfig().helperPassword; // "panitia123"
  const isDbMatch = dbHelperEnabled && rawPassword === dbHelperPassword;
  const isFallbackMatch = rawPassword === fallbackPassword;

  if (isDbMatch || isFallbackMatch) {
    isHelper = true;
    currentOperator = "Panitia";
    currentEkstra = "MASTER";
    isMaster = true;
    hideAllScreens();
    const el = document.getElementById("helperScreen");
    if (el) el.style.display = "flex";
    return;
  }

  // === 3. KETUA CODE DETECTED — use dedicated login ===
  if (/^\d{4}$/.test(rawPassword)) {
    loginError.textContent = "❌ Gunakan tombol Login Ketua di bawah";
    loginError.style.display = "block";
    passwordInput.value = "";
    passwordInput.focus();
    return;
  }

  // === 4. ALL FAILED ===
  loginError.textContent = "❌ Password salah";
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
function showTatibScreen() {
  hideAllScreens();
  const el = document.getElementById("tatibScreen");
  if (el) {
    el.style.display = "flex";
    const nameEl = document.getElementById("tatibName");
    if (nameEl) nameEl.textContent = currentOperator || "Tatib";
  }
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
  showAdminScreen();
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

function doLogout() {
  currentOperator = null;
  currentEkstra = null;
  isMaster = false;
  isHelper = false;
  isTatib = false;
  currentMode = null;
  allStudents = [];
  totalStudents = [];
  currentIndex = 0;
  markedStudents.clear();
  sheetStatus.clear();
  paperStudents = [];
  paperCapturedImage = null;
  stopPaperCamera();
  currentPeriod = null;
  appBundle = null;
  bundlePromise = null;

  if (typeof helperLateStudents !== 'undefined') helperLateStudents = [];
  if (typeof fixerSelectedStudent !== 'undefined') fixerSelectedStudent = null;
  if (typeof configChanges !== 'undefined') configChanges = {};

  hideAllScreens();
  loginScreen.style.display = "flex";
  passwordInput.value = "";
  passwordInput.focus();
}
// ===== KETUA LOGIN (Calculator) =====
let ketuaCodeBuffer = "";

// ===== BUNDLE LOADER =====
async function loadBundle(force = false) {
  if (!force && appBundle) return appBundle;
  if (bundlePromise) return bundlePromise;

  const today = getJakartaDateString();
  const ekstraParam = isMaster ? null : currentEkstra;
  if (!isMaster && !ekstraParam) return null;

  showLoading(true);
  bundlePromise = (async () => {
    try {
      // 1. Load config (keep for upload window & other settings, ignore time periods)
      const cfg = await loadSupabaseConfig();

      // 2. Load students
      let query = sb.from('Database').select('id, nama, kelas, ekstra, photo_url');
      if (!isMaster) query = query.eq('ekstra', ekstraParam);
      const { data: students, error: sErr } = await query;
      if (sErr) throw sErr;

      // 3. Load today's attendance from AttendanceV2
      const { data: attendance, error: aErr } = await sb
        .from('AttendanceV2')
        .select('student_id, status')
        .eq('date', today)
        .eq('semester', currentSemester);
      if (aErr) throw aErr;

      const attMap = {};
      (attendance || []).forEach(a => { attMap[a.student_id] = a.status; });

      const merged = (students || []).map(s => ({
        id: s.id,
        nama: s.nama,
        kelas: s.kelas,
        ekstra: s.ekstra,
        foto: s.photo_url,
        status: attMap[s.id] || null
      }));

      const result = {
        status: "ok",
        students: merged,
        pendingRegistrations: []
      };

      appBundle = result;
      totalStudents = merged;
      sheetStatus.clear();
      merged.forEach(s => { if (s.status) sheetStatus.set(s.id, s.status); });

      return result;
    } catch (err) {
      console.error("Bundle load failed:", err);
      showStatus("Gagal memuat data: " + err.message, "error");
      return null;
    } finally {
      showLoading(false);
      bundlePromise = null;
    }
  })();

  return bundlePromise;
}
function clearBundle() {
  appBundle = null;
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
    document.getElementById("adminTeacherName").textContent = currentOperator || "Admin";
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

function backToDashboard() {
  hideAllScreens();
  if (isHelper) {
    showHelperScreen();
  } else if (isMaster) {
    showAdminScreen();
  } else {
    showDashboard();
  }
  updateRegBadge();
}

function backToAbsenMenu() {
  hideAllScreens();
  if (isHelper) showHelperScreen();
  else if (isMaster) showAdminScreen();
  else showDashboard();
}

function safeBackToAbsenMenu() {
  backToAbsenMenu();
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
    fetched.forEach(s => { if (s.status) sheetStatus.set(s.id, s.status); });

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
    const isDone = !!s.status || markedStudents.has(s.id);
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
      const reelIdx = allStudents.findIndex(st => st.id === s.id);
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
  setTimeout(() => { statusOverlay.style.opacity = "0"; }, 5000);
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
    const { count, error } = await sb
      .from('registrations')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'pending');
    
    if (error) throw error;

    // Client-side filter because eq might miss due to spaces/case
    const { data: rows } = await sb
      .from('registrations')
      .select('ekstra')
      .eq('status', 'pending');
    
    const target = (currentEkstra || "").trim().toLowerCase();
    const matched = (rows || []).filter(r => (r.ekstra || "").trim().toLowerCase() === target);
    const c = matched.length;

    const badge = document.getElementById("regBadge");
    if (badge) {
      badge.textContent = c > 99 ? "99+" : c;
      badge.style.display = c > 0 ? "flex" : "none";
    }
  } catch (e) { /* silent */ }
}
function showDaftarSiswa() {
  // Implemented in daftar.js
}

async function loadSupabaseConfig() {
    const { data, error } = await sb.from('Config').select('*').single();
    if (error || !data) return getDefaultConfig();
    
    // Set global so every module uses the same semester
    currentSemester = data.current_semester || 'STS (Ganjil)';
    
    const config = {
        threshold: data.threshold,
        validate: data.validate,
        pagiStart: data.pagi_start,
        pagiEnd: data.pagi_end,
        ekstraStart: data.ekstra_start,
        ekstraEnd: data.ekstra_end,
        minusPointEnable: data.minus_point_enable,
        minusPointThreshold: data.minus_point_threshold,
        redemptionEnable: data.redemption_enable,
        helperEnable: data.helper_enable,
        helperPassword: data.helper_password,
        dendaAlpha: data.denda_alpha,
        dendaTerlambat: data.denda_terlambat,
        nilaiMinusAlpha: data.nilai_minus_alpha,
        nilaiMinusTerlambat: data.nilai_minus_terlambat,
        maxPointSubmit: data.max_point_submit,
        maxRedemptionPoint: data.max_redemption_point,
        currentSemester: currentSemester
    };
    
    // Cache globally for helper.js, countdown, etc.
    window.appConfig = config;
    
    return config;
}
function getDefaultConfig() {
    return {
        threshold: 0.6,
        validate: true,
        pagiStart: 5.00,
        pagiEnd: 8.45,
        ekstraStart: 9.50,
        ekstraEnd: 11.00,
        minusPointEnable: true,
        minusPointThreshold: -30,
        redemptionEnable: true,
        helperEnable: false,
        helperPassword: "panitia123",
        dendaAlpha: 0,
        dendaTerlambat: 0,
        nilaiMinusAlpha: -10,
        nilaiMinusTerlambat: -5,
        maxPointSubmit: 1,
        maxRedemptionPoint: 5,
        currentSemester: 'STS (Ganjil)'
    };
}
(function () {
  const STORAGE_KEY = 'arknet_install_prompt_shown';
  let deferredPrompt = null;

  function isStandalone() {
    return window.matchMedia('(display-mode: standalone)').matches
      || window.navigator.standalone === true; // iOS Safari
  }

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;

    if (isStandalone()) return;              // already installed, never show
    if (localStorage.getItem(STORAGE_KEY)) return; // already shown once, never again

    document.getElementById('installBanner').classList.add('show');
  });

  document.getElementById('installBannerBtn')?.addEventListener('click', async () => {
    const banner = document.getElementById('installBanner');
    banner.classList.remove('show');
    localStorage.setItem(STORAGE_KEY, '1');

    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
  });

  document.getElementById('installBannerClose')?.addEventListener('click', () => {
    document.getElementById('installBanner').classList.remove('show');
    localStorage.setItem(STORAGE_KEY, '1');
  });

  // If it gets installed some other way (browser's own UI), don't show again either
  window.addEventListener('appinstalled', () => {
    localStorage.setItem(STORAGE_KEY, '1');
    document.getElementById('installBanner')?.classList.remove('show');
  });
})();