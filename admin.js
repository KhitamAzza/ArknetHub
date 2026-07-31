// ============================================
// admin.js — Admin Panel: Overseer, Fixer, Config
// ============================================

// ===== OVERSEER STATE =====
let overseerData = [];
let waReportText = "";

// ===== OVERSEER VIEW =====

function showOverseerView() {
hideAllScreens();
  const el = document.getElementById("overseerScreen");
  if (el) {
    el.style.display = "flex";
    loadOverseerData();
  }
}

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
function showAdminAbsen() {
  currentMode = 'REEL';
  isMaster = true;
  currentEkstra = "MASTER";
  hideAllScreens();
  if (absenMenuScreen) absenMenuScreen.style.display = "flex";
}
async function loadOverseerData() {
  showLoading(true);
  try {
    const today = getJakartaDateString();
    const res = await fetch(API_URL + "?action=getOverseerData&date=" + encodeURIComponent(today));
    const data = await res.json();

    if (data.status === "ok") {
      overseerData = data.ekskuls || [];
      renderOverseerList(data.period);
    } else {
      showStatus(data.message || "Gagal memuat data", "error");
    }
  } catch (err) {
    showStatus("Error koneksi: " + err.message, "error");
  }
  showLoading(false);
}

function renderOverseerList(period) {
  const list = document.getElementById("overseerList");
  const empty = document.getElementById("overseerEmpty");
  const periodLabel = document.getElementById("overseerPeriodLabel");

  if (periodLabel) {
    const name = period?.isPagi ? "PAGI" : period?.isEkstra ? "EKSTRA" : "DI LUAR JAM";
    periodLabel.textContent = "Periode: " + name;
  }

  if (!overseerData.length) {
    if (list) list.innerHTML = "";
    if (empty) empty.style.display = "block";
    return;
  }

  if (empty) empty.style.display = "none";

  if (list) {
    list.innerHTML = overseerData.map(e => {
      const pct = e.total > 0 ? Math.round((e.sudah / e.total) * 100) : 0;
      const isDone = e.sudah >= e.threshold;
      return `
        <div class="overseer-item">
          <div class="overseer-info">
            <div class="overseer-name">${escapeHtml(e.nama)}</div>
            <div class="overseer-meta">${e.sudah}/${e.total} siswa • ${e.pembina || '-'}</div>
          </div>
          <div class="overseer-progress">
            <div class="overseer-progress-bar" style="width:${pct}%; background:${isDone ? 'var(--green)' : 'var(--red)'}"></div>
          </div>
          <div class="overseer-status">
            <div class="overseer-dot ${isDone ? 'done' : 'not-done'}"></div>
            <div class="overseer-status-text ${isDone ? 'done' : 'not-done'}">${isDone ? 'Selesai' : 'Belum'}</div>
          </div>
        </div>
      `;
    }).join("");
  }
}

// ===== FILL ALPHA =====
async function fillAlphaAll() {
  if (!confirm("Isi ALPHA untuk semua siswa yang belum absen hari ini?")) return;

  showLoading(true);
  try {
    const today = getJakartaDateString();
    const res = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({
        action: "fillAlphaAll",
        date: today,
        operator: currentOperator
      })
    });

    const data = await res.json();
    if (data.status === "ok") {
      showStatus(`✓ ${data.filled} siswa diisi ALPHA`, "ok");
      loadOverseerData();
    } else {
      showStatus(data.message || "Gagal", "error");
    }
  } catch (err) {
    showStatus("Error koneksi: " + err.message, "error");
  }
  showLoading(false);
}

// ===== WA REPORT =====
function openWaReport() {
  const today = getJakartaDateString();
  const period = currentPeriod?.isPagi ? "PAGI" : currentPeriod?.isEkstra ? "EKSTRA" : "UNKNOWN";

  // Build report: group by kelas, only show TERLAMBAT/PAGI/ALPHA/empty
  const reportLines = [];
  reportLines.push(`📊 *Laporan Absensi — ${today}*`);
  reportLines.push(`Periode: *${period}*`);
  reportLines.push("");

  // Collect all students from overseer data
  const allStudents = [];
  overseerData.forEach(ek => {
    (ek.students || []).forEach(s => {
      const st = (s.status || "").trim().toUpperCase();
      if (!st || st === "ALPHA" || st === "TERLAMBAT" || st === "PAGI") {
        allStudents.push({
          nama: s.nama,
          kelas: s.kelas,
          ekstra: ek.nama,
          status: st || "ALPHA"
        });
      }
    });
  });

  // Group by kelas
  const byKelas = {};
  allStudents.forEach(s => {
    if (!byKelas[s.kelas]) byKelas[s.kelas] = [];
    byKelas[s.kelas].push(s);
  });

  const sortedKelas = Object.keys(byKelas).sort();
  sortedKelas.forEach(kelas => {
    reportLines.push(`*${kelas}*`);
    byKelas[kelas].forEach(s => {
      const icon = s.status === "ALPHA" ? "🔴" : s.status === "TERLAMBAT" ? "🟡" : "🔵";
      reportLines.push(`${icon} ${s.nama} — ${s.ekstra} — ${s.status}`);
    });
    reportLines.push("");
  });

  if (allStudents.length === 0) {
    reportLines.push("✅ Semua siswa hadir!");
  }

  waReportText = reportLines.join("\n");

  const preview = document.getElementById("waPreviewText");
  if (preview) preview.textContent = waReportText;

  const modal = document.getElementById("waPreviewModal");
  if (modal) modal.classList.add("visible");
}

function closeWaPreview() {
  const modal = document.getElementById("waPreviewModal");
  if (modal) modal.classList.remove("visible");
}

function confirmSendWa() {
  const encoded = encodeURIComponent(waReportText);
  window.open(`https://wa.me/?text=${encoded}`, "_blank");
  closeWaPreview();
}

// ===== FIXER MODE =====
let fixerAllStudents = [];
let fixerSelectedStudent = null;
let fixerEditTarget = null; // {row, col, currentValue, date}

function initFixerMode() {
  const input = document.getElementById("fixerSearchInput");
  const pred = document.getElementById("fixerPredictive");
  const area = document.getElementById("fixerStudentArea");
  const empty = document.getElementById("fixerEmpty");

  if (area) area.style.display = "none";
  if (empty) empty.style.display = "flex";
  if (input) input.value = "";

  // Load all students for predictive
  loadFixerDatabase();

  if (input) {
    input.addEventListener("input", (e) => {
      const q = e.target.value.trim().toLowerCase();
      if (!q || !pred) {
        if (pred) pred.style.display = "none";
        return;
      }

      const matches = fixerAllStudents.filter(s =>
        s.nama && s.nama.toLowerCase().includes(q)
      ).slice(0, 5);

      if (!matches.length) {
        pred.style.display = "none";
        return;
      }

      pred.innerHTML = matches.map(s => `
        <div class="predictive-item" data-nama="${encodeURIComponent(s.nama)}">
          <div class="pred-name">${highlightMatchFixer(escapeHtml(s.nama), q)}</div>
          <div class="pred-class">${escapeHtml(s.kelas || '')} • ${escapeHtml(s.ekstra || '')}</div>
        </div>
      `).join("");
      pred.style.display = "block";
    });
  }

  if (pred) {
    pred.onclick = (e) => {
      const item = e.target.closest(".predictive-item");
      if (!item) return;
      const nama = decodeURIComponent(item.dataset.nama);
      selectFixerStudent(nama);
      if (input) input.value = "";
      pred.style.display = "none";
    };
  }

  // Close predictive on outside click
  document.addEventListener("click", (e) => {
    const wrap = document.querySelector(".fixer-search-wrap");
    if (wrap && pred && !wrap.contains(e.target)) {
      pred.style.display = "none";
    }
  });
}

async function loadFixerDatabase() {
  try {
    const res = await fetch(API_URL + "?action=getDatabase");
    const data = await res.json();
    if (data.status === "ok") {
      fixerAllStudents = data.data || [];
    }
  } catch (e) {
    console.error("Fixer load failed", e);
  }
}

function highlightMatchFixer(text, query) {
  const idx = text.toLowerCase().indexOf(query);
  if (idx === -1) return text;
  return text.substring(0, idx) + '<b>' + text.substring(idx, idx + query.length) + '</b>' + text.substring(idx + query.length);
}

async function selectFixerStudent(nama) {
  showLoading(true);
  try {
    const res = await fetch(API_URL + "?action=getStudentAttendance&nama=" + encodeURIComponent(nama));
    const data = await res.json();

    if (data.status === "ok") {
      fixerSelectedStudent = data;
      renderFixerStudent();
    } else {
      showStatus(data.message || "Gagal memuat data siswa", "error");
    }
  } catch (err) {
    showStatus("Error koneksi: " + err.message, "error");
  }
  showLoading(false);
}

function renderFixerStudent() {
  const area = document.getElementById("fixerStudentArea");
  const empty = document.getElementById("fixerEmpty");
  const photo = document.getElementById("fixerPhoto");
  const nameEl = document.getElementById("fixerName");
  const classEl = document.getElementById("fixerClass");
  const ekstraEl = document.getElementById("fixerEkstra");
  const datesList = document.getElementById("fixerDatesList");

  if (!fixerSelectedStudent) return;

  if (area) area.style.display = "block";
  if (empty) empty.style.display = "none";

  if (photo) photo.src = fixerSelectedStudent.foto || "";
  if (nameEl) nameEl.textContent = fixerSelectedStudent.nama;
  if (classEl) classEl.textContent = "Kelas " + (fixerSelectedStudent.kelas || "-");
  if (ekstraEl) ekstraEl.textContent = fixerSelectedStudent.ekstra || "-";

  if (datesList) {
    const dates = fixerSelectedStudent.attendance || [];
    if (dates.length === 0) {
      datesList.innerHTML = `<div class="attendance-empty">Belum ada data absensi</div>`;
      return;
    }

    datesList.innerHTML = dates.map((d, idx) => {
      const status = (d.status || "").trim().toUpperCase();
      const statusClass = getFixerStatusClass(status);
      return `
        <div class="fixer-date-row" onclick="openFixerEdit(${idx})">
          <div class="fixer-date-label">${d.date}</div>
          <div class="fixer-date-status ${statusClass}">${status || "KOSONG"}</div>
        </div>
      `;
    }).join("");
  }
}

function getFixerStatusClass(status) {
  const s = (status || "").trim().toUpperCase();
  if (s === "ALPHA") return "status-alpha";
  if (s === "HADIR") return "status-hadir";
  if (s === "TERLAMBAT") return "status-terlambat";
  if (s === "PAGI") return "status-pagi";
  if (s === "IZIN") return "status-izin";
  if (s === "SAKIT") return "status-sakit";
  return "status-empty";
}

function openFixerEdit(idx) {
  const dates = fixerSelectedStudent?.attendance || [];
  if (!dates[idx]) return;

  const d = dates[idx];
  fixerEditTarget = {
    nama: fixerSelectedStudent.nama,
    date: d.date,
    currentValue: d.status || "",
    row: d.row,
    col: d.col
  };

  document.getElementById("fixEditName").textContent = fixerSelectedStudent.nama;
  document.getElementById("fixEditDate").textContent = d.date;
  document.getElementById("fixerCustomInput").value = "";

  // Reset buttons
  document.querySelectorAll(".fixer-status-btn").forEach(btn => {
    btn.classList.remove("selected");
    if (btn.dataset.status === (d.status || "").toUpperCase()) {
      btn.classList.add("selected");
    }
  });

  // Button click handlers
  document.querySelectorAll(".fixer-status-btn").forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll(".fixer-status-btn").forEach(b => b.classList.remove("selected"));
      btn.classList.add("selected");
      document.getElementById("fixerCustomInput").value = "";
    };
  });

  const modal = document.getElementById("fixerEditModal");
  if (modal) modal.classList.add("visible");
}

function closeFixerEdit() {
  const modal = document.getElementById("fixerEditModal");
  if (modal) modal.classList.remove("visible");
  fixerEditTarget = null;
}

async function saveFixerEdit() {
  if (!fixerEditTarget) return;

  const selectedBtn = document.querySelector(".fixer-status-btn.selected");
  const customInput = document.getElementById("fixerCustomInput").value.trim();
  let newStatus = "";

  if (customInput) {
    newStatus = customInput;
  } else if (selectedBtn) {
    newStatus = selectedBtn.dataset.status;
  }

  if (!newStatus) {
    showStatus("Pilih status atau masukkan custom", "error");
    return;
  }

  closeFixerEdit();
  showLoading(true);

  try {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({
        action: "updateAttendance",
        nama: fixerEditTarget.nama,
        date: fixerEditTarget.date,
        status: newStatus,
        operator: currentOperator
      })
    });

    const data = await res.json();
    if (data.status === "ok") {
      showStatus("✓ Absensi diperbarui", "ok");
      // Refresh student data
      selectFixerStudent(fixerEditTarget.nama);
    } else {
      showStatus(data.message || "Gagal menyimpan", "error");
    }
  } catch (err) {
    showStatus("Error koneksi: " + err.message, "error");
  }

  showLoading(false);
}

// ===== CONFIG MENU =====
let configCache = {};
let configChanges = {};

function initConfigMenu() {
  configChanges = {};
  loadConfigValues();
}

async function loadConfigValues() {
  showLoading(true);
  try {
    const res = await fetch(API_URL + "?action=getConfig");
    const data = await res.json();
    if (data.status === "ok") {
      configCache = data;
      renderConfigMenu();
    }
  } catch (err) {
    showStatus("Error memuat config", "error");
  }
  showLoading(false);
}

function renderConfigMenu() {
  const list = document.getElementById("configList");
  if (!list) return;

  const sections = [
    {
      title: "Konfigurasi sistem",
      items: [
        { key: "threshold", label: "Akurasi Face ID", type: "slider", min: 0.1, max: 1.0, step: 0.05 },
        { key: "pagiStart", label: "Pagi Mulai", type: "time" },
        { key: "pagiEnd", label: "Pagi Selesai", type: "time" },
        { key: "ekstraStart", label: "Ekstra Mulai", type: "time" },
        { key: "ekstraEnd", label: "Ekstra Selesai", type: "time" },
        { key: "dendaAlpha", label: "Denda alpha", type: "money" },
        { key: "nilaiMinusAlpha", label: "Nilai minus (Alpha)", type: "negative" },
        { key: "nilaiMinusTerlambat", label: "Nilai minus (Terlambat/Pagi)", type: "negative" }
      ]
    },
    {
      title: "Sistem point",
      items: [
        { key: "minusPointEnable", label: "Sistem point (Minus point)", type: "toggle" },
        { key: "minusPointThreshold", label: "MINUS POINT THRESHOLD", type: "number" },
        { key: "redemptionEnable", label: "sistem penebusan (redemption)", type: "toggle" }
      ]
    },
    {
      title: "Siswa piket",
      items: [
        { key: "helperEnable", label: "Siswa bisa mengabsen", type: "toggle" },
        { key: "helperPassword", label: "Password siswa", type: "text" }
      ]
    }
  ];

  list.innerHTML = sections.map(section => {
    const itemsHtml = section.items.map(item => renderConfigItem(item)).join('');
    return `<div class="config-section-title">${section.title}</div>${itemsHtml}`;
  }).join('');

  updateConfigSaveButton();
}
function renderConfigItem(item) {
  const val = configChanges[item.key] !== undefined ? configChanges[item.key] : configCache[item.key];

  if (item.type === "slider") {
    return `
      <div class="config-item">
        <div class="config-label">${item.label}</div>
        <div class="config-value-display">${val}</div>
        <input type="range" class="config-slider" min="${item.min}" max="${item.max}" step="${item.step}" value="${val}"
          oninput="updateConfigSlider('${item.key}', this.value)">
      </div>
    `;
  }

  if (item.type === "toggle") {
    const isOn = String(val).toUpperCase() === "TRUE" || val === true;
    return `
      <div class="config-item" style="display:flex;align-items:center;justify-content:space-between;">
        <div class="config-label" style="margin-bottom:0;">${item.label}</div>
        <button class="config-toggle ${isOn ? 'active' : ''}" onclick="toggleConfig('${item.key}')">
          <div class="config-toggle-thumb"></div>
        </button>
      </div>
    `;
  }

  if (item.type === "time") {
    const timeStr = decimalToTime(val);
    return `
      <div class="config-item">
        <div class="config-label">${item.label}</div>
        <input type="time" class="config-time-input" value="${timeStr}"
          onchange="updateConfigTime('${item.key}', this.value)">
      </div>
    `;
  }

  if (item.type === "money") {
    const displayVal = val ? 'Rp ' + Number(val).toLocaleString('id-ID') : 'Rp 0';
    return `
      <div class="config-item">
        <div class="config-label">${item.label}</div>
        <input type="text" class="config-money-input" value="${displayVal}"
          onfocus="configMoneyFocus(this, '${item.key}')" 
          onblur="configMoneyBlur(this, '${item.key}')">
      </div>
    `;
  }

  if (item.type === "negative") {
    const displayVal = val !== undefined ? val : 0;
    return `
      <div class="config-item">
        <div class="config-label">${item.label}</div>
        <input type="number" class="config-number-input" value="${displayVal}" step="1"
          onchange="updateConfigNegative('${item.key}', this.value)">
      </div>
    `;
  }

  if (item.type === "number") {
    return `
      <div class="config-item">
        <div class="config-label">${item.label}</div>
        <input type="number" class="config-number-input" value="${val !== undefined ? val : 0}" step="1"
          onchange="updateConfigValue('${item.key}', this.value)">
      </div>
    `;
  }

  if (item.type === "text") {
    return `
      <div class="config-item">
        <div class="config-label">${item.label}</div>
        <input type="text" class="config-text-input" value="${escapeHtml(val || '')}" placeholder="Password..."
          onchange="updateConfigValue('${item.key}', this.value)">
      </div>
    `;
  }

  return "";
}
/* --- money helpers --- */
function configMoneyFocus(el, key) {
  const current = configChanges[key] !== undefined ? configChanges[key] : (configCache[key] || 0);
  el.value = String(current);
}
function configMoneyBlur(el, key) {
  let val = el.value.replace(/[^0-9]/g, '');
  const num = parseInt(val, 10) || 0;
  el.value = 'Rp ' + num.toLocaleString('id-ID');
  configChanges[key] = num;
  updateConfigSaveButton();
}

/* --- negative number helper --- */
function updateConfigNegative(key, value) {
  let num = parseFloat(value) || 0;
  if (num > 0) num = -num;
  configChanges[key] = num;
  updateConfigSaveButton();
}
function updateConfigValue(key, value) {
  configChanges[key] = value;
  updateConfigSaveButton();
}

function decimalToTime(decimal) {
  if (decimal === null || decimal === undefined) return "00:00";
  const h = Math.floor(decimal);
  const m = Math.round((decimal - h) * 100);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function timeToDecimal(timeStr) {
  const [h, m] = timeStr.split(":").map(Number);
  return parseFloat((h + m / 100).toFixed(2));
}

function updateConfigSlider(key, value) {
  configChanges[key] = parseFloat(value);
  renderConfigMenu();
}

function toggleConfig(key) {
  const current = configChanges[key] !== undefined ? configChanges[key] : configCache[key];
  configChanges[key] = !(String(current).toUpperCase() === "TRUE" || current === true);
  renderConfigMenu();
}

function updateConfigTime(key, timeStr) {
  configChanges[key] = timeToDecimal(timeStr);
  updateConfigSaveButton();
}

function updateConfigSaveButton() {
  const btn = document.getElementById("configSaveBtn");
  if (btn) {
    const hasChanges = Object.keys(configChanges).length > 0;
    btn.disabled = !hasChanges;
    btn.textContent = hasChanges ? `Simpan (${Object.keys(configChanges).length})` : "Simpan Perubahan";
  }
}

async function saveConfigChanges() {
  if (Object.keys(configChanges).length === 0) return;

  showLoading(true);
  try {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({
        action: "updateConfig",
        changes: configChanges
      })
    });

    const data = await res.json();
    if (data.status === "ok") {
      showStatus("✓ Config diperbarui", "ok");
      configChanges = {};
      loadConfigValues();
    } else {
      showStatus(data.message || "Gagal menyimpan", "error");
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