// ============================================
// admin.js — Admin Panel: Overseer, Fixer, Config
// ============================================


// ===== FIXER MODE =====
let fixerAllStudents = [];
let fixerSelectedStudent = null;
let fixerEditTarget = null; // {studentId, nama, date, currentValue}


function initFixerMode() {
  const input = document.getElementById("fixerSearchInput");
  const pred = document.getElementById("fixerPredictive");
  const area = document.getElementById("fixerStudentArea");
  const empty = document.getElementById("fixerEmpty");

  if (area) area.style.display = "none";
  if (empty) empty.style.display = "flex";
  if (input) input.value = "";

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

  document.addEventListener("click", (e) => {
    const wrap = document.querySelector(".fixer-search-wrap");
    if (wrap && pred && !wrap.contains(e.target)) {
      pred.style.display = "none";
    }
  });
}

async function loadFixerDatabase() {
  try {
    const { data, error } = await sb.from('Database').select('id, nama, kelas, ekstra');
    if (error) throw error;
    fixerAllStudents = data || [];
  } catch (e) {
    console.error("Fixer load failed", e);
    fixerAllStudents = [];
  }
}

function highlightMatchFixer(text, query) {
  const idx = text.toLowerCase().indexOf(query);
  if (idx === -1) return text;
  return text.substring(0, idx) + '<b>' + text.substring(idx, idx + query.length) + '</b>' + text.substring(idx + query.length);
}

/* Derive effective status from multiple rows per date */
function deriveFixerStatus(rows) {
  if (!rows || rows.length === 0) return 'KOSONG';

  const hasTelat = rows.some(r => r.status && r.status.trim().toUpperCase() === 'TELAT');
  const hasEkstra = rows.some(r => r.period === 'EKSTRA');

  if (hasTelat && hasEkstra) {
    const ekstraExplicit = rows.find(r => r.period === 'EKSTRA' && r.status && r.status.trim() !== '');
    if (ekstraExplicit) return ekstraExplicit.status.trim().toUpperCase();
    return 'TERLAMBAT';
  }
  if (hasTelat) return 'TELAT';

  const explicit = rows.find(r => r.status && r.status.trim() !== '');
  if (explicit) return explicit.status.trim().toUpperCase();

  const hasPagi = rows.some(r => r.period === 'PAGI');
  if (hasPagi && hasEkstra) return 'HADIR';
  if (hasPagi) return 'PAGI';
  if (hasEkstra) return 'TERLAMBAT';
  return 'KOSONG';
}

async function selectFixerStudent(nama) {
  showLoading(true);
  try {
    const { data: students, error: studentError } = await sb
      .from('Database')
      .select('id, nama, kelas, ekstra, photo_url')
      .ilike('nama', `%${nama}%`)
      .limit(1);
    
    if (studentError) throw studentError;
    if (!students || students.length === 0) {
      showStatus("Siswa tidak ditemukan", "error");
      showLoading(false);
      return;
    }

    const student = students[0];
    
        const { data: attendance, error: attError } = await sb
      .from('Attendance')
      .select('id, date, status, period')
      .eq('student_id', student.id)
      .eq('semester', currentSemester)
      .order('date', { ascending: false });
    
    if (attError) throw attError;

    // Group by date
    const byDate = {};
    (attendance || []).forEach(a => {
      if (!byDate[a.date]) byDate[a.date] = [];
      byDate[a.date].push(a);
    });

    fixerSelectedStudent = {
      id: student.id,
      nama: student.nama,
      kelas: student.kelas,
      ekstra: student.ekstra,
      foto: student.photo_url,
      // One entry per date with derived status
      attendance: Object.entries(byDate).map(([date, rows]) => ({
        date: date,
        status: deriveFixerStatus(rows),
        _rowIds: rows.map(r => r.id) // keep IDs for editing
      }))
    };
    
    renderFixerStudent();
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
    const today = getJakartaDateString();
    const hasToday = dates.some(d => d.date === today);
    let html = "";

    if (dates.length === 0) {
      html += `<div class="attendance-empty">Belum ada data absensi</div>`;
    } else {
      html += dates.map((d, idx) => {
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

    // ── ADD TODAY BUTTON ──
    if (!hasToday) {
      html += `
        <div class="fixer-date-row" onclick="openFixerNewDate()"
             style="border-style:dashed;border-color:var(--accent);color:var(--accent);justify-content:center;margin-top:10px;">
          <div style="display:flex;align-items:center;gap:8px;font-weight:700;">
            <span style="font-size:20px;">+</span> Tambah hari ini (${today})
          </div>
        </div>
      `;
    }

    datesList.innerHTML = html;
  }
}
function openFixerNewDate() {
  if (!fixerSelectedStudent) return;

  const today = getJakartaDateString();

  // Guard: if the list was somehow refreshed and today now exists, bail out
  const exists = fixerSelectedStudent.attendance.some(d => d.date === today);
  if (exists) {
    showStatus("Data hari ini sudah ada", "error");
    return;
  }

  fixerEditTarget = {
    studentId: fixerSelectedStudent.id,
    nama: fixerSelectedStudent.nama,
    date: today,
    currentValue: "",
    rowIds: [] // empty = force INSERT branch in saveFixerEdit
  };

  document.getElementById("fixEditName").textContent = fixerSelectedStudent.nama;
  document.getElementById("fixEditDate").textContent = today + " (Baru)";
  document.getElementById("fixerCustomInput").value = "";

  document.querySelectorAll(".fixer-status-btn").forEach(btn => {
    btn.classList.remove("selected");
  });

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

function getFixerStatusClass(status) {
  const s = (status || "").trim().toUpperCase();
  if (s === "ALPHA") return "status-alpha";
  if (s === "HADIR") return "status-hadir";
  if (s === "TERLAMBAT") return "status-terlambat";
  if (s === "PAGI") return "status-pagi";
  if (s === "IZIN") return "status-izin";
  if (s === "SAKIT") return "status-sakit";
  if (s === "TELAT") return "status-yellow";   // reuse existing yellow badge
  return "status-empty";
}

function openFixerEdit(idx) {
  const dates = fixerSelectedStudent?.attendance || [];
  if (!dates[idx]) return;

  const d = dates[idx];
  fixerEditTarget = {
    studentId: fixerSelectedStudent.id,
    nama: fixerSelectedStudent.nama,
    date: d.date,
    currentValue: d.status || "",
    rowIds: d._rowIds || []
  };

  document.getElementById("fixEditName").textContent = fixerSelectedStudent.nama;
  document.getElementById("fixEditDate").textContent = d.date;
  document.getElementById("fixerCustomInput").value = "";

  document.querySelectorAll(".fixer-status-btn").forEach(btn => {
    btn.classList.remove("selected");
    if (btn.dataset.status === (d.status || "").toUpperCase()) {
      btn.classList.add("selected");
    }
  });

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

  // CAPTURE everything before clearing
  const targetRowIds = fixerEditTarget.rowIds || [];
  const targetStudentId = fixerEditTarget.studentId;   // ← capture this
  const targetDate = fixerEditTarget.date;
  const targetNama = fixerEditTarget.nama;

  closeFixerEdit();
  showLoading(true);

  try {
    if (targetRowIds.length > 0) {
      // ── UPDATE existing rows ──
      const { error } = await sb
        .from('Attendance')
        .update({ status: newStatus })
        .in('id', targetRowIds);

      if (error) throw error;
    } else {
      // ── INSERT new date (today only) ──
      const { error } = await sb
        .from('Attendance')
        .insert({
          student_id: targetStudentId,   // ← was bugged: fixerEditTarget.studentId
          date: targetDate,
          period: 'EKSTRA',
          semester: currentSemester,
          status: newStatus
        });

      if (error) throw error;
    }

    showStatus("✓ Absensi diperbarui", "ok");
    await selectFixerStudent(targetNama); // re-render so the new date appears
  } catch (err) {
    showStatus("Error: " + err.message, "error");
  }

  showLoading(false);
}
function showOverseerView() {
  hideAllScreens();
  const el = document.getElementById("overseerScreen");
  if (el) {
    el.style.display = "flex";
    if (typeof initOverseer === 'function') initOverseer();
  }
}
// ===== CONFIG MENU =====
let configCache = {};
let configChanges = {};
let ketuaCodesData = [];
let configActiveTab = 'config';


// Map UI camelCase keys ↔ DB snake_case columns
const CONFIG_DB_MAP = {
  threshold: 'threshold',
  validate: 'validate',
  pagiStart: 'pagi_start',
  pagiEnd: 'pagi_end',
  ekstraStart: 'ekstra_start',
  ekstraEnd: 'ekstra_end',
  dendaAlpha: 'denda_alpha',
  dendaTerlambat: 'denda_terlambat',
  nilaiMinusAlpha: 'nilai_minus_alpha',
  nilaiMinusTerlambat: 'nilai_minus_terlambat',
  minusPointEnable: 'minus_point_enable',
  minusPointThreshold: 'minus_point_threshold',
  redemptionEnable: 'redemption_enable',
  helperEnable: 'helper_enable',
  helperPassword: 'helper_password',
  maxPointSubmit: 'max_point_submit',
  maxRedemptionPoint: 'max_redemption_point',
  currentSemester: 'current_semester'
};

function initConfigMenu() {
  configChanges = {};
  configActiveTab = 'config';
  loadConfigValues();
}

async function loadConfigValues() {
  showLoading(true);
  try {
    const { data, error } = await sb
      .from('Config')
      .select('*')
      .eq('id', 1)
      .single();

    if (error) throw error;
    if (!data) throw new Error("Config not found");

    configCache = {
      threshold: data.threshold,
      validate: data.validate,
      pagiStart: data.pagi_start,
      pagiEnd: data.pagi_end,
      ekstraStart: data.ekstra_start,
      ekstraEnd: data.ekstra_end,
      dendaAlpha: data.denda_alpha,
      dendaTerlambat: data.denda_terlambat,
      nilaiMinusAlpha: data.nilai_minus_alpha,
      nilaiMinusTerlambat: data.nilai_minus_terlambat,
      minusPointEnable: data.minus_point_enable,
      minusPointThreshold: data.minus_point_threshold,
      redemptionEnable: data.redemption_enable,
      helperEnable: data.helper_enable,
      helperPassword: data.helper_password,
      maxPointSubmit: data.max_point_submit,
      maxRedemptionPoint: data.max_redemption_point,
      currentSemester: data.current_semester || 'STS (Ganjil)'
    };

    const { data: ketuaData, error: ketuaErr } = await sb
      .from('Ketua')
      .select('password, ekstra')
      .order('ekstra');

    if (ketuaErr) throw ketuaErr;
    ketuaCodesData = ketuaData || [];

    renderConfigMenu();
    renderKetuaTab();
    switchConfigTab('config');
  } catch (err) {
    console.error(err);
    showStatus("Error memuat config", "error");
  }
  showLoading(false);
}

function renderConfigMenu() {
  const list = document.getElementById("configList");
  if (!list) return;

  const sections = [
    {
      title: "Periode Akademik",
      items: [
        { key: "currentSemester", label: "Semester Aktif", type: "select", options: ["STS (Ganjil)", "SAS (Ganjil)", "STS (Genap)", "SAS (Genap)"] }
      ]
    },
    {
      title: "Konfigurasi sistem",
      items: [
        { key: "threshold", label: "Akurasi Face ID", type: "slider", min: 0.1, max: 1.0, step: 0.05 },
        { key: "pagiStart", label: "Pagi Mulai", type: "time" },
        { key: "pagiEnd", label: "Pagi Selesai", type: "time" },
        { key: "ekstraStart", label: "Ekstra Mulai", type: "time" },
        { key: "ekstraEnd", label: "Ekstra Selesai", type: "time" },
        { key: "dendaAlpha", label: "Denda alpha", type: "money" },
        { key: "dendaTerlambat", label: "Denda terlambat/pagi", type: "money" },
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
    if (item.type === "select") {
    const opts = item.options.map(o => `<option value="${o}" ${val === o ? 'selected' : ''}>${o}</option>`).join('');
    return `
      <div class="config-item">
        <div class="config-label">${item.label}</div>
        <select class="sort-select" style="width:100%;padding:14px;border-radius:14px;background:var(--bg);color:var(--text);font-size:15px;font-weight:600;border:1px solid var(--border);outline:none;" onchange="updateConfigValue('${item.key}', this.value)">
          ${opts}
        </select>
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

  // Convert camelCase UI keys back to snake_case DB columns
  const dbChanges = {};
  for (const [key, val] of Object.entries(configChanges)) {
    const dbKey = CONFIG_DB_MAP[key];
    if (dbKey) dbChanges[dbKey] = val;
  }

  showLoading(true);
  try {
    const { error } = await sb
      .from('Config')
      .update(dbChanges)
      .eq('id', 1);

    if (error) throw error;

    showStatus("✓ Config diperbarui", "ok");
    configChanges = {};
    loadConfigValues();
  } catch (err) {
    showStatus("Error: " + err.message, "error");
  }
  showLoading(false);
}
// ===== KELOLA SISWA =====
let kelolaAllStudents = [];
let kelolaSelectedStudent = null;

function showKelolaSiswa() {
  hideAllScreens();
  const el = document.getElementById("kelolaSiswaScreen");
  if (el) {
    el.style.display = "flex";
    initKelolaSiswa();
  }
}

function initKelolaSiswa() {
  kelolaSelectedStudent = null;

  const input = document.getElementById("kelolaSearchInput");
  const pred = document.getElementById("kelolaPredictive");
  const area = document.getElementById("kelolaStudentArea");
  const empty = document.getElementById("kelolaEmpty");

  if (input) input.value = "";
  if (pred) pred.style.display = "none";
  if (area) area.style.display = "none";
  if (empty) empty.style.display = "flex";
  if (document.getElementById("kelolaAlasanInput")) document.getElementById("kelolaAlasanInput").value = "";

  // Default to first tab
  switchKelolaTab('kelola');

  // Load student list
  loadKelolaDatabase();

  // Populate ekstra dropdown
  populateKelolaEkstraSelect();

  // Wire search
  if (input) {
    input.oninput = (e) => {
      const q = e.target.value.trim().toLowerCase();
      if (!q || !pred) {
        if (pred) pred.style.display = "none";
        return;
      }
      const matches = kelolaAllStudents.filter(s =>
        s.nama && s.nama.toLowerCase().includes(q)
      ).slice(0, 5);

      if (!matches.length) {
        pred.style.display = "none";
        return;
      }

      pred.innerHTML = matches.map(s => `
        <div class="predictive-item" data-nama="${encodeURIComponent(s.nama)}">
          <div class="pred-name">${highlightMatchFixer(escapeHtml(s.nama), q)}</div>
          <div class="pred-class">${escapeHtml(s.kelas || '')} • ${escapeHtml(s.ekstra || '-')}</div>
        </div>
      `).join("");
      pred.style.display = "block";
    };
  }

  if (pred) {
    pred.onclick = (e) => {
      const item = e.target.closest(".predictive-item");
      if (!item) return;
      const nama = decodeURIComponent(item.dataset.nama);
      selectKelolaStudent(nama);
      if (input) input.value = "";
      pred.style.display = "none";
    };
  }

  // Close predictive on outside click
  document.addEventListener("click", (e) => {
    const wrap = document.querySelector("#kelolaTabContent .fixer-search-wrap");
    if (wrap && pred && !wrap.contains(e.target)) {
      pred.style.display = "none";
    }
  });
}

async function loadKelolaDatabase() {
  try {
    const { data, error } = await sb.from('Database').select('id, nama, kelas, ekstra, photo_url');
    if (error) throw error;
    kelolaAllStudents = data || [];
  } catch (e) {
    console.error("Kelola load failed", e);
    kelolaAllStudents = [];
  }
}

function populateKelolaEkstraSelect() {
  const select = document.getElementById("kelolaEkstraSelect");
  if (!select) return;

  const ekstras = new Set();
  for (const [_, val] of Object.entries(OPERATORS || {})) {
    if (!val.isMaster && !val.isTatib && val.ekstra) {
      ekstras.add(val.ekstra);
    }
  }

  const sorted = Array.from(ekstras).sort();
  select.innerHTML = `<option value="">-- Pilih Ekstra --</option>` +
    sorted.map(e => `<option value="${escapeHtml(e)}">${escapeHtml(e)}</option>`).join('');
}

function switchKelolaTab(tab) {
  document.querySelectorAll('.kelola-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.kelola-tab-content').forEach(c => c.style.display = 'none');

  if (tab === 'kelola') {
    const c = document.getElementById('kelolaTabContent');
    if (c) c.style.display = 'block';
    const t = document.querySelectorAll('.kelola-tab')[0];
    if (t) t.classList.add('active');
  } else {
    const c = document.getElementById('bermasalahTabContent');
    if (c) c.style.display = 'block';
    const t = document.querySelectorAll('.kelola-tab')[1];
    if (t) t.classList.add('active');

    // Data was never loaded for this tab until now — fetch it on entry.
    loadBermasalahData();
  }
}

async function selectKelolaStudent(nama) {
  showLoading(true);
  try {
    const { data: students, error } = await sb
      .from('Database')
      .select('id, nama, kelas, ekstra, photo_url')
      .ilike('nama', `%${nama}%`)
      .limit(1);

    if (error) throw error;
    if (!students || !students.length) {
      showStatus("Siswa tidak ditemukan", "error");
      showLoading(false);
      return;
    }

    const student = students[0];

    // Load attendance for current semester
    const { data: attendance, error: attError } = await sb
      .from('Attendance')
      .select('date, status, period')
      .eq('student_id', student.id)
      .eq('semester', currentSemester)
      .order('date', { ascending: false });

    if (attError) throw attError;

    // Group by date and derive daily status
    const byDate = {};
    (attendance || []).forEach(a => {
      if (!byDate[a.date]) byDate[a.date] = [];
      byDate[a.date].push(a);
    });

    const dailyStatuses = Object.entries(byDate).map(([date, rows]) => ({
      date,
      status: deriveFixerStatus(rows)
    }));

    const counts = {};
    dailyStatuses.forEach(d => {
      const st = d.status || 'KOSONG';
      counts[st] = (counts[st] || 0) + 1;
    });

    kelolaSelectedStudent = {
      id: student.id,
      nama: student.nama,
      kelas: student.kelas,
      ekstra: student.ekstra,
      photo_url: student.photo_url,
      attendanceCounts: counts,
      totalDays: dailyStatuses.length
    };

    renderKelolaStudent();
  } catch (err) {
    showStatus("Error: " + err.message, "error");
  }
  showLoading(false);
}

function renderKelolaStudent() {
  const area = document.getElementById("kelolaStudentArea");
  const empty = document.getElementById("kelolaEmpty");
  if (!kelolaSelectedStudent) return;

  if (area) area.style.display = "block";
  if (empty) empty.style.display = "none";

  const photo = document.getElementById("kelolaPhoto");
  if (photo) {
    photo.src = kelolaSelectedStudent.photo_url || "";
    photo.style.display = kelolaSelectedStudent.photo_url ? "block" : "none";
  }

  const semLabel = document.getElementById("kelolaSemesterLabel");
  if (semLabel) semLabel.textContent = currentSemester || '-';

  const nameEl = document.getElementById("kelolaName");
  const classEl = document.getElementById("kelolaClass");
  const ekstraEl = document.getElementById("kelolaCurrentEkstra");

  if (nameEl) nameEl.textContent = kelolaSelectedStudent.nama;
  if (classEl) classEl.textContent = "Kelas " + (kelolaSelectedStudent.kelas || "-");
  if (ekstraEl) ekstraEl.textContent = "Ekstra: " + (kelolaSelectedStudent.ekstra || "-");

  const select = document.getElementById("kelolaEkstraSelect");
  if (select) select.value = kelolaSelectedStudent.ekstra || "";

  renderKelolaBar();
}

function renderKelolaBar() {
  const bar = document.getElementById("kelolaBar");
  const legend = document.getElementById("kelolaBarLegend");
  const counts = kelolaSelectedStudent?.attendanceCounts || {};
  const total = kelolaSelectedStudent?.totalDays || 0;

  if (!bar || !legend) return;

  if (!total) {
    bar.innerHTML = `<div style="width:100%;height:100%;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:12px;color:var(--text-secondary);background:var(--bg);">Belum ada data absensi</div>`;
    legend.innerHTML = "";
    return;
  }

  const cfg = {
    'HADIR':       { color: 'var(--green)',  label: 'Hadir' },
    'ALPHA':       { color: 'var(--red)',    label: 'Alpha' },
    'TERLAMBAT':   { color: 'var(--yellow)', label: 'Terlambat' },
    'PAGI':        { color: 'var(--accent)', label: 'Pagi' },
    'TELAT':       { color: '#fbbf24',       label: 'Telat' },
    'IZIN':        { color: '#a78bfa',       label: 'Izin' },
    'SAKIT':       { color: '#f472b6',       label: 'Sakit' },
    'KOSONG':      { color: 'var(--text-secondary)', label: 'Kosong' }
  };

  let barHtml = "";
  let legendHtml = "";

  Object.entries(counts).forEach(([status, count]) => {
    const pct = (count / total) * 100;
    const c = cfg[status] || { color: 'var(--text-secondary)', label: status };
    if (pct > 0) {
      barHtml += `<div class="kelola-bar-seg" style="width:${pct}%;background:${c.color};" title="${c.label}: ${count} hari"></div>`;
    }
  });

  Object.entries(counts).forEach(([status, count]) => {
    const c = cfg[status] || { color: 'var(--text-secondary)', label: status };
    const pct = Math.round((count / total) * 100);
    legendHtml += `
      <div class="kelola-legend-item">
        <div class="kelola-legend-dot" style="background:${c.color};"></div>
        <span>${c.label} <b>${count}</b> (${pct}%)</span>
      </div>
    `;
  });

  legendHtml += `<div class="kelola-legend-total">Total hari tercatat: <b>${total}</b></div>`;

  bar.innerHTML = barHtml;
  legend.innerHTML = legendHtml;
}

async function saveKelolaEkstra() {
  if (!kelolaSelectedStudent) return;

  const select = document.getElementById("kelolaEkstraSelect");
  const alasanInput = document.getElementById("kelolaAlasanInput");
  const newEkstra = select ? select.value : "";
  const alasan = alasanInput ? alasanInput.value.trim() : "";
  const oldEkstra = kelolaSelectedStudent.ekstra || "";

  if (!newEkstra) {
    showStatus("Pilih ekstra tujuan terlebih dahulu", "error");
    return;
  }

  if (newEkstra === oldEkstra) {
    showStatus("Siswa sudah berada di ekstra tersebut", "info");
    return;
  }

  if (!alasan) {
    showStatus("Alasan perubahan wajib diisi", "error");
    return;
  }

  showLoading(true);
  try {
    // 1. Update Database
    const { error: updErr } = await sb
      .from('Database')
      .update({ ekstra: newEkstra })
      .eq('id', kelolaSelectedStudent.id);

    if (updErr) throw updErr;

    // 2. Log to registrations
    const { error: regErr } = await sb
      .from('registrations')
      .insert({
        student_id: kelolaSelectedStudent.id,
        nama: kelolaSelectedStudent.nama,
        kelas: kelolaSelectedStudent.kelas,
        ekstra: newEkstra,
        status: 'approved',
        alasan: `Perpindahan ekstra dari "${oldEkstra || '-'}" ke "${newEkstra}" oleh ${currentOperator || 'Admin'}. Alasan: ${alasan}`,
        operator: currentOperator || 'Admin',
        processed_at: new Date().toISOString()
      });

    if (regErr) throw regErr;

    showStatus("✓ Ekstra berhasil diperbarui", "ok");

    // Update local state
    kelolaSelectedStudent.ekstra = newEkstra;
    const ekstraEl = document.getElementById("kelolaCurrentEkstra");
    if (ekstraEl) ekstraEl.textContent = "Ekstra: " + newEkstra;
    if (alasanInput) alasanInput.value = "";

    // Refresh cache
    await loadKelolaDatabase();
  } catch (err) {
    showStatus("Error: " + err.message, "error");
  }
  showLoading(false);
}
// ===== TAB 2: SISWA BERMASALAH =====
let tanpaEkstraStudents = [];
let bermasalahStudents = [];
let bermasalahFiltered = [];
let expelTarget = null;

async function loadBermasalahData() {
  showLoading(true);
  try {
    // 1. All students
    const { data: allStudents, error: dbErr } = await sb
      .from('Database')
      .select('id, nama, kelas, ekstra, photo_url');
    if (dbErr) throw dbErr;

    // 2. Students with no ekstra (handled by banner, not alpha list)
    tanpaEkstraStudents = (allStudents || []).filter(s => {
      const e = (s.ekstra || '').trim();
      return !e || e === '0';
    });

    // 3. Alpha counts for current semester
    const { data: alphaRows, error: alphaErr } = await sb
      .from('Attendance')
      .select('student_id')
      .eq('semester', currentSemester)
      .eq('status', 'ALPHA');
    if (alphaErr) throw alphaErr;

    const alphaCounts = {};
    (alphaRows || []).forEach(a => {
      alphaCounts[a.student_id] = (alphaCounts[a.student_id] || 0) + 1;
    });

    // 4. Build bermasalah list
    //    - MUST have an ekstra (not empty, not '0')
    //    - MUST have alpha > 0
    //    - Sorted highest alpha first
    bermasalahStudents = (allStudents || [])
      .filter(s => {
        const e = (s.ekstra || '').trim();
        return e && e !== '0';           // ← HAS ekstra
      })
      .filter(s => alphaCounts[s.id] > 0) // ← HAS alpha
      .map(s => ({
        ...s,
        alphaCount: alphaCounts[s.id]
      }))
      .sort((a, b) => b.alphaCount - a.alphaCount);

    bermasalahFiltered = [...bermasalahStudents];

    renderTanpaEkstraBadge();
    renderBermasalahList();
  } catch (err) {
    console.error("Bermasalah load failed:", err);
    showStatus("Gagal memuat data", "error");
  }
  showLoading(false);
}

function renderTanpaEkstraBadge() {
  const badge = document.getElementById("tanpaEkstraBadge");
  const banner = document.getElementById("bermasalahBanner");
  
  if (badge) {
    badge.textContent = tanpaEkstraStudents.length;
    badge.style.display = tanpaEkstraStudents.length > 0 ? "flex" : "none";
  }
  
  if (banner) {
    banner.style.display = tanpaEkstraStudents.length > 0 ? "flex" : "none";
  }
}
function renderBermasalahList() {
  const list = document.getElementById("bermasalahList");
  const empty = document.getElementById("bermasalahEmpty");
  const countLabel = document.getElementById("bermasalahCountLabel");
  
  if (!list) return;

  if (countLabel) countLabel.textContent = `${bermasalahFiltered.length} siswa`;

  if (!bermasalahFiltered.length) {
    list.innerHTML = "";
    if (empty) empty.style.display = "block";
    return;
  }
  if (empty) empty.style.display = "none";

  list.innerHTML = bermasalahFiltered.map(s => {
    const hasPhoto = !!s.photo_url;
    return `
    <div class="bermasalah-item">
      ${hasPhoto ? `<img class="bermasalah-photo" src="${escapeHtml(s.photo_url)}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">` : ''}
      <div class="bermasalah-photo-placeholder" style="${hasPhoto ? 'display:none;' : ''}">👤</div>
      <div class="bermasalah-info">
        <div class="bermasalah-name">${escapeHtml(s.nama)}</div>
        <div class="bermasalah-meta">${escapeHtml(s.kelas)} • ${escapeHtml(s.ekstra || '-')}</div>
      </div>
      <div class="bermasalah-alpha">${s.alphaCount} Alpha</div>
      <button class="bermasalah-expel-btn" onclick="openExpelModal('${s.id}')">Keluarkan</button>
    </div>
  `}).join('');
}

function filterBermasalahList() {
  const input = document.getElementById("bermasalahSearchInput");
  const q = (input ? input.value : "").trim().toLowerCase();
  
  if (!q) {
    bermasalahFiltered = [...bermasalahStudents];
  } else {
    bermasalahFiltered = bermasalahStudents.filter(s => 
      s.nama.toLowerCase().includes(q) || 
      s.kelas.toLowerCase().includes(q)
    );
  }
  renderBermasalahList();
}

// --- Tanpa Ekstra Modal ---
function showTanpaEkstraModal() {
  const list = document.getElementById("tanpaEkstraList");
  const modal = document.getElementById("tanpaEkstraModal");
  if (!list || !modal) {
    alert("DEBUG: modal or list not found");
    return;
  }

  if (!tanpaEkstraStudents.length) {
    list.innerHTML = `
      <div class="empty-state" style="padding:24px;">
        <div class="empty-state-icon">✅</div>
        <div class="empty-state-text">Semua siswa sudah memiliki ekskul</div>
      </div>`;
  } else {
    list.innerHTML = tanpaEkstraStudents.map(s => {
      const hasPhoto = !!s.photo_url;
      return `
      <div class="tanpa-ekstra-item" style="cursor:pointer;" onclick="openExpelFromTanpaEkstra('${String(s.id).replace(/'/g, "\\'")}')">
        ${hasPhoto 
          ? `<img class="tanpa-ekstra-photo" src="${escapeHtml(s.photo_url)}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">` 
          : `<div class="tanpa-ekstra-photo" style="display:flex;align-items:center;justify-content:center;background:var(--bg);">👤</div>`
        }
        <div class="tanpa-ekstra-info">
          <div class="tanpa-ekstra-name">${escapeHtml(s.nama)}</div>
          <div class="tanpa-ekstra-class">${escapeHtml(s.kelas)}</div>
        </div>
      </div>`;
    }).join('');
  }

  modal.classList.add("visible");
}

function renderBermasalahList() {
  const list = document.getElementById("bermasalahList");
  const empty = document.getElementById("bermasalahEmpty");
  const countLabel = document.getElementById("bermasalahCountLabel");
  
  if (!list) return;

  if (countLabel) countLabel.textContent = `${bermasalahFiltered.length} siswa`;

  if (!bermasalahFiltered.length) {
    list.innerHTML = "";
    if (empty) empty.style.display = "block";
    return;
  }
  if (empty) empty.style.display = "none";

  list.innerHTML = bermasalahFiltered.map(s => {
    const hasPhoto = !!s.photo_url;
    // FIX: escape single quotes in ID so onclick doesn't break
    const safeId = String(s.id).replace(/'/g, "\\'");
    return `
    <div class="bermasalah-item">
      ${hasPhoto ? `<img class="bermasalah-photo" src="${escapeHtml(s.photo_url)}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">` : ''}
      <div class="bermasalah-photo-placeholder" style="${hasPhoto ? 'display:none;' : ''}">👤</div>
      <div class="bermasalah-info">
        <div class="bermasalah-name">${escapeHtml(s.nama)}</div>
        <div class="bermasalah-meta">${escapeHtml(s.kelas)} • ${escapeHtml(s.ekstra || '-')}</div>
      </div>
      <div class="bermasalah-alpha">${s.alphaCount} Alpha</div>
      <button class="bermasalah-expel-btn" onclick="openExpelModal('${safeId}')">Keluarkan</button>
    </div>
  `}).join('');
}
function closeTanpaEkstraModal() {
  const modal = document.getElementById("tanpaEkstraModal");
  if (modal) modal.classList.remove("visible");
}

// --- Expel Modal ---
function openExpelModal(studentId) {
  // DEBUG: remove this alert after testing
  // alert("DEBUG: clicked id = " + studentId);

  const student = bermasalahStudents.find(s => String(s.id) === String(studentId))
    || tanpaEkstraStudents.find(s => String(s.id) === String(studentId));

  if (!student) {
    // alert("DEBUG: student not found for id: " + studentId);
    return;
  }

  expelTarget = student;

  const nameEl = document.getElementById("expelStudentName");
  const metaEl = document.getElementById("expelStudentMeta");
  const alphaEl = document.getElementById("expelAlphaCount");
  const reasonInput = document.getElementById("expelReasonInput");
  const confirmBtn = document.getElementById("expelConfirmBtn");

  if (nameEl) nameEl.textContent = student.nama;
  if (metaEl) metaEl.textContent = `${student.kelas} • ${student.ekstra || '-'}`;
  if (alphaEl) {
    const alphaCount = student.alphaCount || 0;
    alphaEl.textContent = `${alphaCount} kali Alpha di semester ini`;
  }
  if (reasonInput) {
    reasonInput.value = "";
    reasonInput.oninput = () => {
      if (confirmBtn) confirmBtn.disabled = !reasonInput.value.trim();
    };
  }
  if (confirmBtn) confirmBtn.disabled = true;

  const modal = document.getElementById("expelModal");
  if (modal) modal.classList.add("visible");
}

function closeExpelModal() {
  const modal = document.getElementById("expelModal");
  if (modal) modal.classList.remove("visible");
  expelTarget = null;
}

// Bridge: clicking a student inside the "tanpa ekskul" popup opens the
// same expel confirmation used in the main Alpha list, closing the
// tanpa-ekskul popup first so the two sheets don't stack.
function openExpelFromTanpaEkstra(studentId) {
  closeTanpaEkstraModal();
  openExpelModal(studentId);
}

async function confirmExpelStudent() {
  if (!expelTarget) return;

  const reasonInput = document.getElementById("expelReasonInput");
  const alasan = reasonInput ? reasonInput.value.trim() : "";
  
  if (!alasan) {
    showStatus("Alasan wajib diisi", "error");
    return;
  }

  showLoading(true);
  try {
    // 1. Reset ekstra to '0'
    const { error: updErr } = await sb
      .from('Database')
      .update({ ekstra: '0' })
      .eq('id', expelTarget.id);
    if (updErr) throw updErr;

    // 2. Log to registrations as expelled
    const { error: regErr } = await sb
      .from('registrations')
      .insert({
        student_id: expelTarget.id,
        nama: expelTarget.nama,
        kelas: expelTarget.kelas,
        ekstra: expelTarget.ekstra || '0',
        status: 'expelled',
        alasan: `Dikeluarkan oleh ${currentOperator || 'Admin'}. Alasan: ${alasan}`,
        operator: currentOperator || 'Admin',
        processed_at: new Date().toISOString()
      });
    if (regErr) throw regErr;

    showStatus("✓ Siswa dikeluarkan", "ok");
    closeExpelModal();

    // Refresh both lists
    await loadBermasalahData();
  } catch (err) {
    showStatus("Error: " + err.message, "error");
  }
  showLoading(false);
}
// ===== KODE KETUA SECTION =====
function renderKetuaSection() {
  const dateStr = getJakartaDateString();

  if (!ketuaCodesData || ketuaCodesData.length === 0) {
    return `
      <div class="config-section-title">Kode Ketua — ${dateStr}</div>
      <div class="config-item">
        <div class="config-label">Tidak ada data ketua di tabel</div>
      </div>
    `;
  }

  const rows = ketuaCodesData.map(k => `
    <div class="ketua-code-row">
      <div class="ketua-code-info">
        <div class="ketua-code-ekstra">${escapeHtml(k.ekstra)}</div>
        <div class="ketua-code-value">${escapeHtml(k.password || '-')}</div>
      </div>
      <button class="ketua-code-btn" onclick="generateKetuaCode('${escapeHtml(k.ekstra)}')">🎲 Generate</button>
    </div>
  `).join('');

  const waText = formatKetuaWaMessage();

  return `
    <div class="config-section-title">Kode Ketua — ${dateStr}</div>
    <div class="config-item ketua-code-section">
      <div style="font-size:11px;color:var(--text-secondary);margin-bottom:12px;">
        Kode diperbarui langsung ke database. Tekan Generate untuk membuat kode baru.
      </div>
      <div class="ketua-code-header">
        <div class="config-label" style="margin-bottom:0;">Kode login harian (4 digit)</div>
        <button class="ketua-generate-all-btn" onclick="generateAllKetuaCodes()">Generate Semua</button>
      </div>
      <div class="ketua-code-list">${rows}</div>
      <div class="ketua-code-wa-wrap">
        <div class="ketua-code-preview">${escapeHtml(waText)}</div>
        <button class="ketua-wa-btn" onclick="sendKetuaCodesToWa()">📤 Kirim ke WhatsApp</button>
      </div>
    </div>
  `;
}

function formatKetuaWaMessage() {
  const date = getJakartaDateString();
  let text = `*Kode Login Ketua Ekskul* 📋\n📅 ${date}\n\n`;
  ketuaCodesData.forEach(k => {
    text += `• *${k.ekstra}*: \`${k.password || '-'}\`\n`;
  });
  text += `\nMasukkan kode di ArkNet Hub untuk absen hari ini.`;
  return text;
}

function sendKetuaCodesToWa() {
  const text = formatKetuaWaMessage();
  const url = `https://wa.me/?text=${encodeURIComponent(text)}`;
  window.open(url, '_blank');
}

async function generateKetuaCode(ekstra) {
  const existing = new Set(ketuaCodesData.map(k => k.password).filter(Boolean));
  let newCode;
  let attempts = 0;
  do {
    newCode = Math.floor(1000 + Math.random() * 9000).toString();
    attempts++;
  } while (existing.has(newCode) && attempts < 100);

  showLoading(true);
  try {
    const { error } = await sb
      .from('Ketua')
      .update({ password: newCode })
      .eq('ekstra', ekstra);

    if (error) throw error;

    const item = ketuaCodesData.find(k => k.ekstra === ekstra);
    if (item) item.password = newCode;

    showStatus(`✓ Kode ${ekstra}: ${newCode}`, "ok");
    renderConfigMenu();
  } catch (err) {
    showStatus("Error: " + err.message, "error");
  }
  showLoading(false);
}

async function generateAllKetuaCodes() {
  showLoading(true);
  try {
    const usedCodes = new Set();

    for (const k of ketuaCodesData) {
      let newCode;
      let attempts = 0;
      do {
        newCode = Math.floor(1000 + Math.random() * 9000).toString();
        attempts++;
      } while (usedCodes.has(newCode) && attempts < 100);

      usedCodes.add(newCode);

      const { error } = await sb
        .from('Ketua')
        .update({ password: newCode })
        .eq('ekstra', k.ekstra);

      if (error) throw error;
      k.password = newCode;
    }

    showStatus("✓ Semua kode ketua diperbarui", "ok");
    renderConfigMenu();
  } catch (err) {
    showStatus("Error: " + err.message, "error");
  }
  showLoading(false);
}
// ===== CONFIG TABS =====
function switchConfigTab(tab) {
  configActiveTab = tab;

  const configList = document.getElementById("configList");
  const ketuaList = document.getElementById("ketuaList");
  const configTabBtn = document.getElementById("configTabBtn");
  const ketuaTabBtn = document.getElementById("ketuaTabBtn");
  const bottomBar = document.getElementById("configBottomBar");

  if (tab === 'config') {
    if (configList) configList.style.display = 'block';
    if (ketuaList) ketuaList.style.display = 'none';
    if (configTabBtn) configTabBtn.classList.add('active');
    if (ketuaTabBtn) ketuaTabBtn.classList.remove('active');
    if (bottomBar) bottomBar.style.display = 'flex';
  } else {
    if (configList) configList.style.display = 'none';
    if (ketuaList) ketuaList.style.display = 'block';
    if (configTabBtn) configTabBtn.classList.remove('active');
    if (ketuaTabBtn) ketuaTabBtn.classList.add('active');
    if (bottomBar) bottomBar.style.display = 'none';
  }
}

// ===== KODE KETUA TAB =====
function renderKetuaTab() {
  const container = document.getElementById("ketuaList");
  if (!container) return;

  const dateStr = getJakartaDateString();

  if (!ketuaCodesData || ketuaCodesData.length === 0) {
    container.innerHTML = `
      <div class="config-section-title">Kode Ketua — ${dateStr}</div>
      <div class="config-item">
        <div class="config-label">Tidak ada data ketua di tabel</div>
      </div>
    `;
    return;
  }

  const rows = ketuaCodesData.map(k => `
    <div class="ketua-code-row">
      <div class="ketua-code-info">
        <div class="ketua-code-ekstra">${escapeHtml(k.ekstra)}</div>
        <div class="ketua-code-value">${escapeHtml(k.password || '-')}</div>
      </div>
      <button class="ketua-code-btn" onclick="generateKetuaCode('${escapeHtml(k.ekstra)}')">🎲 Generate</button>
    </div>
  `).join('');

  const waText = formatKetuaWaMessage();

  container.innerHTML = `
    <div class="config-section-title">Kode Ketua — ${dateStr}</div>
    <div class="config-item ketua-code-section">
      <div style="font-size:11px;color:var(--text-secondary);margin-bottom:12px;">
        Kode diperbarui langsung ke database. Tekan Generate untuk membuat kode baru.
      </div>
      <div class="ketua-code-header">
        <div class="config-label" style="margin-bottom:0;">Kode login harian (4 digit)</div>
        <button class="ketua-generate-all-btn" onclick="generateAllKetuaCodes()">Generate Semua</button>
      </div>
      <div class="ketua-code-list">${rows}</div>
      <div class="ketua-code-wa-wrap">
        <div class="ketua-code-preview">${escapeHtml(waText)}</div>
        <button class="ketua-wa-btn" onclick="sendKetuaCodesToWa()">📤 Kirim ke WhatsApp</button>
      </div>
    </div>
  `;
}

function formatKetuaWaMessage() {
  const date = getJakartaDateString();
  let text = `*Kode Login Ketua Ekskul* 📋\n📅 ${date}\n\n`;
  ketuaCodesData.forEach(k => {
    text += `• *${k.ekstra}*: \`${k.password || '-'}\`\n`;
  });
  text += `\nMasukkan kode di ArkNet Hub untuk absen hari ini.`;
  return text;
}

function sendKetuaCodesToWa() {
  const text = formatKetuaWaMessage();
  const url = `https://wa.me/?text=${encodeURIComponent(text)}`;
  window.open(url, '_blank');
}

async function generateKetuaCode(ekstra) {
  const existing = new Set(ketuaCodesData.map(k => k.password).filter(Boolean));
  let newCode;
  let attempts = 0;
  do {
    newCode = Math.floor(1000 + Math.random() * 9000).toString();
    attempts++;
  } while (existing.has(newCode) && attempts < 100);

  showLoading(true);
  try {
    const { error } = await sb
      .from('Ketua')
      .update({ password: newCode })
      .eq('ekstra', ekstra);

    if (error) throw error;

    const item = ketuaCodesData.find(k => k.ekstra === ekstra);
    if (item) item.password = newCode;

    showStatus(`✓ Kode ${ekstra}: ${newCode}`, "ok");
    renderKetuaTab();
  } catch (err) {
    showStatus("Error: " + err.message, "error");
  }
  showLoading(false);
}

async function generateAllKetuaCodes() {
  showLoading(true);
  try {
    const usedCodes = new Set();

    for (const k of ketuaCodesData) {
      let newCode;
      let attempts = 0;
      do {
        newCode = Math.floor(1000 + Math.random() * 9000).toString();
        attempts++;
      } while (usedCodes.has(newCode) && attempts < 100);

      usedCodes.add(newCode);

      const { error } = await sb
        .from('Ketua')
        .update({ password: newCode })
        .eq('ekstra', k.ekstra);

      if (error) throw error;
      k.password = newCode;
    }

    showStatus("✓ Semua kode ketua diperbarui", "ok");
    renderKetuaTab();
  } catch (err) {
    showStatus("Error: " + err.message, "error");
  }
  showLoading(false);
}
// ===== UTILS =====
function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text || "";
  return div.innerHTML;
}