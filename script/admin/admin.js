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
  return (rows[0].status || 'KOSONG').trim().toUpperCase();
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
  .from('AttendanceV2')
  .select('id, date, status')
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
      attendance: (attendance || []).map(a => ({
        date: a.date,
        status: (a.status || 'KOSONG').trim().toUpperCase(),
        _rowIds: [a.id] // single row id
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
  .from('AttendanceV2')
  .update({ status: newStatus })
  .in('id', targetRowIds);

      if (error) throw error;
    } else {
      // ── INSERT new date (today only) ──
      const { error } = await sb
  .from('AttendanceV2')
  .insert({
    student_id: targetStudentId,
    date: targetDate,
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
  allowAppCamera: 'allow_app_camera',
  validate: 'validate',
  mulaiPengumpulan: 'mulai_pengumpulan',
  batasPengumpulan: 'batas_pengumpulan_absensi',
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
  currentSemester: 'current_semester',
  omrRequireCorners: 'omr_require_corners',
  uploadBackend: 'upload_backend'
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
  allowAppCamera: data.allow_app_camera,
  validate: data.validate,
  mulaiPengumpulan: data.mulai_pengumpulan,
  batasPengumpulan: data.batas_pengumpulan_absensi,
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
  currentSemester: data.current_semester || 'STS (Ganjil)',
  uploadBackend: data.upload_backend || 'cloudinary',
  omrRequireCorners: data.omr_require_corners
};

    const { data: ketuaData, error: ketuaErr } = await sb
      .from('Ketua')
      .select('password, ekstra')
      .order('ekstra');

    if (ketuaErr) throw ketuaErr;
    ketuaCodesData = ketuaData || [];

    renderConfigMenu();
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
    title: "Jendela Upload Bukti Absensi (Pembina)",
    items: [
      { key: "mulaiPengumpulan", label: "Mulai Pengumpulan", type: "time" },
      { key: "batasPengumpulan", label: "Batas Pengumpulan Absensi", type: "time" },
      { key: "allowAppCamera", label: "Izinkan pembina pakai kamera aplikasi", type: "toggle" }
    ]
  },
  {
    title: "Konfigurasi sistem",
    items: [
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
    },
    {
      title: "Sistem OMR",
      items: [
        { key: "omrRequireCorners", label: "Peringati jika sudut kertas tidak terdeteksi", type: "toggle" }
      ]
    },
    {
  title: "Layanan Upload Foto",
  items: [
    { key: "uploadBackend", label: "Backend Upload", type: "select", options: ["cloudinary", "discord"] }
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
  .from('AttendanceV2')
  .select('id, date, status')
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
  .from('AttendanceV2')
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
async function loadAdminEkstraAttendanceStatus() {
  const today = todayJakartaDate();
  try {
    // 1. How many students per ekstra?
    const { data: students, error: sErr } = await sb
      .from('Database')
      .select('id, ekstra');
    if (sErr) throw sErr;

    const totalPerEkstra = {};
    const studentToEkstra = {};
    (students || []).forEach(s => {
      const e = (s.ekstra || '').trim();
      if (e && e !== '0') {
        totalPerEkstra[e] = (totalPerEkstra[e] || 0) + 1;
        studentToEkstra[s.id] = e;
      }
    });

    // 2. How many attendance rows today?
    const { data: att, error: aErr } = await sb
      .from('AttendanceV2')
      .select('student_id')
      .eq('date', today)
      .eq('semester', currentSemester);
    if (aErr) throw aErr;

    const submittedPerEkstra = {};
    (att || []).forEach(a => {
      const e = studentToEkstra[a.student_id];
      if (e) submittedPerEkstra[e] = (submittedPerEkstra[e] || 0) + 1;
    });

    // 3. Paint every chip
    document.querySelectorAll('.admin-ekstra-chip').forEach(chip => {
      const ekstra = chip.dataset.ekstra;
      const total = totalPerEkstra[ekstra] || 0;
      const done  = submittedPerEkstra[ekstra] || 0;

      chip.classList.remove('attendance-none', 'attendance-partial', 'attendance-full');

      if (done === 0) {
        chip.classList.add('attendance-none');
      } else if (done >= total && total > 0) {
        chip.classList.add('attendance-full');
      } else {
        chip.classList.add('attendance-partial');
      }

      const label = chip.querySelector('.admin-ekstra-chip-label');
      if (label) {
        if (!label.dataset.base) label.dataset.base = label.textContent;
        label.textContent = done > 0
          ? `${label.dataset.base} • ${done}/${total}`
          : label.dataset.base;
      }
    });
  } catch (e) {
    console.error("Ekstra attendance status failed", e);
  }
}
// ===== ADMIN MANUAL INPUT =====
let adminInputStudents = [];
let adminInputChanges = new Map();

function showAdminInput() {
  hideAllScreens();
  const el = document.getElementById("adminInputScreen");
  if (el) {
    el.style.display = "flex";
    initAdminInput();
  }
}

async function initAdminInput() {
  initAdminPhotoViewportEvents();

  const select = document.getElementById('adminInputEkstra');
  const ekstras = new Set();
  Object.values(OPERATORS || {}).forEach(op => {
    if (!op.isMaster && !op.isTatib && op.ekstra) ekstras.add(op.ekstra);
  });
  if (select) {
    select.innerHTML = '<option value="">Pilih Ekskul</option>' +
      Array.from(ekstras).sort().map(e => `<option value="${escapeHtml(e)}">${escapeHtml(e)}</option>`).join('');
  }
  renderAdminEkstraChips(Array.from(ekstras).sort());
  loadAdminEkstraUploadStatus();
  loadAdminEkstraAttendanceStatus();
  adminInputStudents = [];
  adminInputChanges.clear();
  const list = document.getElementById('adminInputList');
  if (list) list.innerHTML = '<div class="empty-state" style="padding-top:40px;"><div class="empty-state-icon">📋</div><div class="empty-state-text">Pilih ekskul untuk memulai input</div></div>';
  updateAdminInputStats();

  // Reset the photo comparison pane (mobile defaults back to the input list)
  adminInputMobileView = 'input';
  const body = document.getElementById('adminInputBody');
  if (body) body.classList.remove('show-photo');
  const toggleBtn = document.getElementById('adminInputViewToggleBtn');
  if (toggleBtn) toggleBtn.textContent = '🖼️ Lihat Foto';
  loadAdminProofPhoto(null, null);
}

// ===== ADMIN INPUT: EKSTRA CHIP ROW (today's upload status at a glance) =====
function renderAdminEkstraChips(ekstraList) {
  const row = document.getElementById('adminEkstraChipRow');
  if (!row) return;
  row.innerHTML = ekstraList.map(e => `
    <button type="button" class="admin-ekstra-chip" data-ekstra="${escapeHtml(e)}" onclick="selectAdminEkstraChip(this.dataset.ekstra)">
      <span class="admin-ekstra-chip-dot"></span>
      <span class="admin-ekstra-chip-label">${escapeHtml(e)}</span>
    </button>
  `).join('');
}

function selectAdminEkstraChip(ekstra) {
  const select = document.getElementById('adminInputEkstra');
  if (!select) return;
  select.value = ekstra;
  loadAdminInputList();
}

async function loadAdminEkstraUploadStatus() {
  const today = todayJakartaDate();
  try {
    const { data, error } = await sb
      .from('AttendanceProof')
      .select('ekstra')
      .eq('date', today)
      .eq('semester', currentSemester);
    if (error) throw error;
    const uploaded = new Set((data || []).map(r => r.ekstra));
    document.querySelectorAll('.admin-ekstra-chip').forEach(chip => {
      markAdminEkstraChipStatus(chip.dataset.ekstra, uploaded.has(chip.dataset.ekstra));
    });
  } catch (e) {
    // non-critical — chips just stay in the neutral "belum dicek" state
  }
}

function markAdminEkstraChipStatus(ekstra, hasPhoto) {
  document.querySelectorAll('.admin-ekstra-chip').forEach(chip => {
    if (chip.dataset.ekstra !== ekstra) return;
    const dot = chip.querySelector('.admin-ekstra-chip-dot');
    if (!dot) return;
    dot.classList.toggle('uploaded', hasPhoto);
    dot.classList.toggle('missing', !hasPhoto);
  });
}

async function loadAdminInputList() {
  const select = document.getElementById('adminInputEkstra');
  const ekstra = select ? select.value : "";
  document.querySelectorAll('.admin-ekstra-chip').forEach(chip => {
    chip.classList.toggle('active', chip.dataset.ekstra === ekstra);
  });
  if (!ekstra) {
    loadAdminProofPhoto(null, null);
    return;
  }

  // Load today's attendance-proof photo for this ekstra in parallel with the roster
  loadAdminProofPhoto(ekstra, todayJakartaDate());

  showLoading(true);
  try {
    const today = getJakartaDateString();
    const { data: students, error: sErr } = await sb
      .from('Database').select('id, nama, kelas, photo_url').eq('ekstra', ekstra).order('nama');
    if (sErr) throw sErr;

    const { data: att, error: aErr } = await sb
      .from('AttendanceV2').select('student_id, status').eq('date', today).eq('semester', currentSemester);
    if (aErr) throw aErr;

    const attMap = {};
    (att || []).forEach(a => attMap[a.student_id] = a.status);

    adminInputStudents = (students || []).map(s => ({
      id: s.id, nama: s.nama, kelas: s.kelas, photo_url: s.photo_url,
      currentStatus: attMap[s.id] || null
    }));
    adminInputChanges.clear();
    renderAdminInputList();
    updateAdminInputStats();
  } catch (err) {
    showStatus("Error: " + err.message, "error");
  }
  showLoading(false);
}

let adminInputSearchQuery = '';
let adminPickerTimer = null;
let adminLongPressTriggered = false;
let adminPickerTargetId = null;

function onAdminRowMouseDown(e, id) {
  adminLongPressTriggered = false;
  adminPickerTargetId = id;
  const row = e.currentTarget;
  if (row) row.style.transform = 'scale(0.97)';

  adminPickerTimer = setTimeout(() => {
    adminLongPressTriggered = true;
    if (row) row.style.transform = '';
    openAdminInputPicker(id);
  }, 500);
}

function onAdminRowMouseUp(e) {
  clearTimeout(adminPickerTimer);
  const row = e.currentTarget;
  if (row) row.style.transform = '';
}

function onAdminRowTouchMove(e) {
  clearTimeout(adminPickerTimer);
  const row = e.currentTarget;
  if (row) row.style.transform = '';
}

function onAdminRowClick(e, id) {
  if (adminLongPressTriggered) {
    adminLongPressTriggered = false;
    return;
  }
  // Set focus to clicked row
  const rows = getVisibleAdminRows();
  rows.forEach((row, i) => {
    if (row.getAttribute('data-id') === id) {
      adminInputFocusedIndex = i;
      row.classList.add('focused');
    } else {
      row.classList.remove('focused');
    }
  });
  cycleAdminInputStatus(id);
}

function openAdminInputPicker(id) {
  adminPickerTargetId = id;
  const modal = document.getElementById('adminInputPickerModal');
  if (modal) modal.classList.add('visible');
}

function closeAdminInputPicker() {
  const modal = document.getElementById('adminInputPickerModal');
  if (modal) modal.classList.remove('visible');
  adminPickerTargetId = null;
}

function pickAdminStatus(status) {
  if (!adminPickerTargetId) return;
  setAdminInputStatus(adminPickerTargetId, status);
  closeAdminInputPicker();
}

// ===== KEYBOARD NAVIGATION =====
let adminInputFocusedIndex = -1;

function setAdminInputFocus(idx) {
  const rows = document.querySelectorAll('#adminInputList .admin-input-row');
  if (!rows.length) return;

  // Clamp index
  if (idx < 0) idx = 0;
  if (idx >= rows.length) idx = rows.length - 1;

  adminInputFocusedIndex = idx;

  rows.forEach((row, i) => {
    row.classList.toggle('focused', i === idx);
  });

  // Scroll into view smoothly
  const focusedRow = rows[idx];
  if (focusedRow) {
    focusedRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

function restoreAdminInputFocus() {
  const rows = document.querySelectorAll('#adminInputList .admin-input-row');
  if (!rows.length) {
    adminInputFocusedIndex = -1;
    return;
  }

  // Clamp to valid range
  if (adminInputFocusedIndex >= rows.length) {
    adminInputFocusedIndex = rows.length - 1;
  }
  if (adminInputFocusedIndex < 0) {
    adminInputFocusedIndex = -1;
    return;
  }

  // Apply focus
  rows.forEach((row, i) => {
    row.classList.toggle('focused', i === adminInputFocusedIndex);
  });

  // Scroll into view
  const focusedRow = rows[adminInputFocusedIndex];
  if (focusedRow) {
    focusedRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

function getVisibleAdminRows() {
  return document.querySelectorAll('#adminInputList .admin-input-row');
}

function getAdminRowStudentId(row) {
  // Extract ID from the onclick attribute
  const onclick = row.getAttribute('onclick') || '';
  const match = onclick.match(/onAdminRowClick\(event,\s*'(.+?)'\)/);
  return match ? match[1].replace(/\\'/g, "'") : null;
}

// Global keyboard listener
document.addEventListener('keydown', (e) => {
  const screen = document.getElementById('adminInputScreen');
  if (!screen || screen.style.display === 'none') return;

  // Don't intercept if a modal is open
  const picker = document.getElementById('adminInputPickerModal');
  if (picker && picker.classList.contains('visible')) return;

  // Don't intercept if search input is focused
  const searchInput = document.getElementById('adminInputSearch');
  if (searchInput && document.activeElement === searchInput) {
    // Only intercept Escape to blur search
    if (e.key === 'Escape') {
      searchInput.blur();
      e.preventDefault();
    }
    return;
  }

  const rows = getVisibleAdminRows();
  if (!rows.length) return;

  // Search shortcuts
  if (e.key === '/' || (e.ctrlKey && e.key === 'k')) {
    e.preventDefault();
    const searchInput = document.getElementById('adminInputSearch');
    if (searchInput) {
      searchInput.focus();
      searchInput.select();
    }
    return;
  }

  switch (e.key) {
    case 'ArrowDown':
    case 'Tab':
      e.preventDefault();
      if (adminInputFocusedIndex === -1) {
        setAdminInputFocus(0);
      } else {
        setAdminInputFocus(adminInputFocusedIndex + 1);
      }
      break;

    case 'ArrowUp':
      e.preventDefault();
      if (adminInputFocusedIndex === -1) {
        setAdminInputFocus(rows.length - 1);
      } else {
        setAdminInputFocus(adminInputFocusedIndex - 1);
      }
      break;

    case 'Enter':
    case ' ':
      e.preventDefault();
      if (adminInputFocusedIndex >= 0 && rows[adminInputFocusedIndex]) {
        const id = getAdminRowStudentId(rows[adminInputFocusedIndex]);
        if (id) cycleAdminInputStatus(id);
      }
      break;

    case '1':
      e.preventDefault();
      applyStatusToFocused('HADIR');
      break;
    case '2':
      e.preventDefault();
      applyStatusToFocused('ALPHA');
      break;
    case '3':
      e.preventDefault();
      applyStatusToFocused('TERLAMBAT');
      break;
     case '4':
      e.preventDefault();
      applyStatusToFocused('PAGI');
      break;
    case '5':
      e.preventDefault();
      applyStatusToFocused('IZIN');
      break;
    case '6':
      e.preventDefault();
      applyStatusToFocused('SAKIT');
      break;
    case '0':
    case 'Delete':
    case 'Backspace':
      e.preventDefault();
      applyStatusToFocused('');
      break;
  }
});

function applyStatusToFocused(status) {
  const rows = getVisibleAdminRows();
  if (adminInputFocusedIndex >= 0 && rows[adminInputFocusedIndex]) {
    const id = getAdminRowStudentId(rows[adminInputFocusedIndex]);
    if (id) setAdminInputStatus(id, status);
  }
}



function onAdminInputSearch() {
  const input = document.getElementById('adminInputSearch');
  adminInputSearchQuery = input ? input.value.trim().toLowerCase() : '';
  renderAdminInputList();
}

function cycleAdminInputStatus(id) {
  const student = adminInputStudents.find(s => String(s.id) === String(id));
  if (!student) return;

  const order = ['', 'HADIR', 'ALPHA', 'TERLAMBAT', 'PAGI', 'IZIN', 'SAKIT'];
  const current = adminInputChanges.get(id);
  const currentStatus = current !== undefined ? current : (student.currentStatus || '');
  const idx = order.indexOf(currentStatus);
  const nextIdx = (idx + 1) % order.length;
  const nextStatus = order[nextIdx];

  setAdminInputStatus(id, nextStatus);
}

function getAdminStatusClass(status) {
  const s = (status || '').trim().toUpperCase();
  if (s === 'HADIR') return 'status-hadir';
  if (s === 'ALPHA') return 'status-alpha';
  if (s === 'TERLAMBAT') return 'status-terlambat';
  if (s === 'PAGI') return 'status-pagi';
  if (s === 'IZIN') return 'status-izin';
  if (s === 'SAKIT') return 'status-sakit';
  if (s === 'TELAT') return 'status-telat';   // ← ADD
  return 'status-kosong';
}

function renderAdminInputList() {
  const container = document.getElementById('adminInputList');
  if (!container) return;

  const filtered = adminInputSearchQuery 
    ? adminInputStudents.filter(s => s.nama.toLowerCase().includes(adminInputSearchQuery))
    : adminInputStudents;

  if (filtered.length === 0) {
    container.innerHTML = '<div class="empty-state" style="padding-top:40px;"><div class="empty-state-icon">📭</div><div class="empty-state-text">Tidak ada siswa</div></div>';
    return;
  }

  container.innerHTML = filtered.map((s, i) => {
    const changed = adminInputChanges.get(s.id);
    const status = changed !== undefined ? changed : (s.currentStatus || '');
    const statusClass = getAdminStatusClass(status);
    const statusLabel = status || 'KOSONG';

    const safeId = String(s.id).replace(/'/g, "\'");

    return `
      <div class="admin-input-row"
           data-id="${safeId}"
           onclick="onAdminRowClick(event, '${safeId}')"
           onmousedown="onAdminRowMouseDown(event, '${safeId}')"
           ontouchstart="onAdminRowMouseDown(event, '${safeId}')"
           onmouseup="onAdminRowMouseUp(event)"
           ontouchend="onAdminRowMouseUp(event)"
           ontouchmove="onAdminRowTouchMove(event)">
        <div class="admin-input-num">${i + 1}</div>
        <div class="admin-input-info">
          <div class="admin-input-name">${escapeHtml(s.nama)}</div>
          <div class="admin-input-class">${escapeHtml(s.kelas)}</div>
        </div>
        <div class="admin-input-status ${statusClass}">${escapeHtml(statusLabel)}</div>
      </div>
    `;
  }).join('');

  // Restore focus after re-render
  restoreAdminInputFocus();
}

function setAdminInputStatus(id, status) {
  const student = adminInputStudents.find(s => String(s.id) === String(id));
  if (!student) return;
  const original = student.currentStatus || '';
  if (status === original) adminInputChanges.delete(id);
  else adminInputChanges.set(id, status);
  renderAdminInputList();
  updateAdminInputStats();
}

function markAllAdminInputHadir() {
  adminInputStudents.forEach(s => {
    if ((s.currentStatus || '') !== 'HADIR') adminInputChanges.set(s.id, 'HADIR');
  });
  renderAdminInputList();
  updateAdminInputStats();
}

function updateAdminInputStats() {
  const count = adminInputChanges.size;
  const btn = document.getElementById('adminInputSaveBtn');
  const label = document.getElementById('adminInputChangeCount');
  if (btn) { btn.disabled = count === 0; btn.textContent = count > 0 ? `Simpan (${count})` : 'Simpan'; }
  if (label) label.textContent = `${count} perubahan`;
}

// ===== ADMIN INPUT: PHOTO COMPARISON PANE =====
// Mobile has no room for side-by-side, so a single pane toggles between
// the manual input list and the full attendance-proof photo.
let adminInputMobileView = 'input'; // 'input' | 'photo'

function toggleAdminInputView() {
  const body = document.getElementById('adminInputBody');
  const btn = document.getElementById('adminInputViewToggleBtn');
  if (!body) return;
  adminInputMobileView = adminInputMobileView === 'input' ? 'photo' : 'input';
  body.classList.toggle('show-photo', adminInputMobileView === 'photo');
  if (btn) btn.textContent = adminInputMobileView === 'photo' ? '📝 Tandai Absensi' : '🖼️ Lihat Foto';
}

function todayJakartaDate() {
  return getJakartaDateString();
}

function parseIndoDate(str) {
  if (!str) return null;
  const parts = str.trim().split(/\s+/);
  if (parts.length < 3) return null;
  const day = parseInt(parts[0], 10);
  const monthIdx = BULAN_ID.findIndex(m => m.toLowerCase() === parts[1].toLowerCase());
  const year = parseInt(parts[2], 10);
  if (isNaN(day) || monthIdx === -1 || isNaN(year)) return null;
  return new Date(year, monthIdx, day, 12, 0, 0);
}

function formatIndoDate(dateObj) {
  return dateObj.getDate() + " " + BULAN_ID[dateObj.getMonth()] + " " + dateObj.getFullYear();
}

let adminInputCurrentEkstra = null;
let adminProofCurrentDate = null;
let adminProofCache = {};
let adminProofLoadToken = 0;
let adminProofPhotos = [];   // all pages/lembar for the current ekstra+date+semester
let adminProofPhotoIndex = 0;

async function loadAdminProofPhoto(ekstra, date) {
  adminInputCurrentEkstra = ekstra;
  adminProofCurrentDate = date;
  updateAdminPhotoDateLabel();
  updateAdminPhotoNavButtons();
  adminPhotoZoomReset();

  const img = document.getElementById('adminPhotoImg');
  const emptyEl = document.getElementById('adminPhotoEmptyState');
  const emptyText = document.getElementById('adminPhotoEmptyText');
  const ekstraLabel = document.getElementById('adminPhotoEkstraLabel');
  if (ekstraLabel) ekstraLabel.textContent = ekstra || '';

  adminProofPhotos = [];
  adminProofPhotoIndex = 0;

  if (!ekstra) {
    if (img) img.style.display = 'none';
    if (emptyEl) emptyEl.style.display = 'flex';
    if (emptyText) emptyText.textContent = 'Pilih ekskul untuk melihat foto';
    updateAdminPhotoPageBar();
    return;
  }

  const token = ++adminProofLoadToken;
  const cacheKey = ekstra + '|' + date + '|' + currentSemester;

  if (img) img.style.display = 'none';
  if (emptyEl) emptyEl.style.display = 'flex';
  if (emptyText) emptyText.textContent = 'Memuat foto...';
  updateAdminPhotoPageBar();

  let proofs = adminProofCache[cacheKey];
  if (proofs === undefined) {
    try {
      const { data, error } = await sb
        .from('AttendanceProof')
        .select('photo_url, uploaded_by, uploaded_at, page')
        .eq('ekstra', ekstra).eq('date', date).eq('semester', currentSemester)
        .order('page', { ascending: true });
      if (error) throw error;
      proofs = data || [];
    } catch (e) {
      proofs = [];
    }
    adminProofCache[cacheKey] = proofs;
  }

  if (token !== adminProofLoadToken) return; // superseded by a newer request

  adminProofPhotos = proofs;
  adminProofPhotoIndex = 0;
  if (date === todayJakartaDate()) markAdminEkstraChipStatus(ekstra, proofs.length > 0);
  updateAdminPhotoPageBar();

  if (!proofs.length) {
    if (emptyText) emptyText.textContent = 'Pembina belum upload foto di sistem';
    if (emptyEl) emptyEl.style.display = 'flex';
    if (img) img.style.display = 'none';
    return;
  }

  renderAdminProofPhoto(token);
}

function renderAdminProofPhoto(token) {
  const img = document.getElementById('adminPhotoImg');
  const emptyEl = document.getElementById('adminPhotoEmptyState');
  const emptyText = document.getElementById('adminPhotoEmptyText');
  const proof = adminProofPhotos[adminProofPhotoIndex];
  if (!proof || !img) return;

  adminPhotoZoomReset();
  if (emptyEl) emptyEl.style.display = 'flex';
  if (emptyText) emptyText.textContent = 'Memuat foto...';
  img.style.display = 'none';

  img.onload = () => {
    if (token !== undefined && token !== adminProofLoadToken) return;
    if (emptyEl) emptyEl.style.display = 'none';
    img.style.display = 'block';
  };
  img.onerror = () => {
    if (token !== undefined && token !== adminProofLoadToken) return;
    if (emptyText) emptyText.textContent = 'Gagal memuat gambar';
    if (emptyEl) emptyEl.style.display = 'flex';
    img.style.display = 'none';
  };
  img.src = proof.photo_url;
}

function updateAdminPhotoPageBar() {
  const bar = document.getElementById('adminPhotoPageBar');
  const label = document.getElementById('adminPhotoPageLabel');
  const prevBtn = document.getElementById('adminPhotoPagePrevBtn');
  const nextBtn = document.getElementById('adminPhotoPageNextBtn');
  if (!bar) return;

  if (adminProofPhotos.length <= 1) {
    bar.style.display = 'none';
    return;
  }

  bar.style.display = 'flex';
  if (label) label.textContent = `Lembar ${adminProofPhotoIndex + 1}/${adminProofPhotos.length}`;
  if (prevBtn) prevBtn.disabled = adminProofPhotoIndex <= 0;
  if (nextBtn) nextBtn.disabled = adminProofPhotoIndex >= adminProofPhotos.length - 1;
}

function adminPhotoShiftPage(delta) {
  const next = adminProofPhotoIndex + delta;
  if (next < 0 || next >= adminProofPhotos.length) return;
  adminProofPhotoIndex = next;
  updateAdminPhotoPageBar();
  renderAdminProofPhoto(adminProofLoadToken);
}

function updateAdminPhotoDateLabel() {
  const label = document.getElementById('adminPhotoDateLabel');
  if (!label) return;
  if (!adminProofCurrentDate) { label.textContent = '-'; return; }
  label.textContent = adminProofCurrentDate === todayJakartaDate()
    ? `${adminProofCurrentDate} (Hari ini)`
    : adminProofCurrentDate;
}

function updateAdminPhotoNavButtons() {
  const nextBtn = document.getElementById('adminPhotoNextBtn');
  if (!nextBtn) return;
  nextBtn.disabled = !adminProofCurrentDate || adminProofCurrentDate === todayJakartaDate();
}

function adminProofShiftDate(deltaDays) {
  if (!adminInputCurrentEkstra) return;
  const current = parseIndoDate(adminProofCurrentDate) || parseIndoDate(todayJakartaDate());
  if (!current) return;
  current.setDate(current.getDate() + deltaDays);

  const todayD = parseIndoDate(todayJakartaDate());
  if (deltaDays > 0 && todayD && current > todayD) return; // no browsing into the future

  loadAdminProofPhoto(adminInputCurrentEkstra, formatIndoDate(current));
}

function openAdminProofDatePicker() {
  if (!adminInputCurrentEkstra) return;
  const modal = document.getElementById('adminProofDateModal');
  const list = document.getElementById('adminProofDateModalList');
  if (!modal || !list) return;
  modal.classList.add('visible');
  list.innerHTML = '<div class="overseer-empty">Memuat...</div>';
  loadAdminProofDateOptions(adminInputCurrentEkstra, list);
}

function closeAdminProofDateModal() {
  const modal = document.getElementById('adminProofDateModal');
  if (modal) modal.classList.remove('visible');
}

async function loadAdminProofDateOptions(ekstra, list) {
  try {
    const { data, error } = await sb
      .from('AttendanceProof')
      .select('date')
      .eq('ekstra', ekstra)
      .eq('semester', currentSemester)
      .order('date', { ascending: false });
    if (error) throw error;

    const seen = new Set();
    const dates = (data || []).map(d => d.date).filter(d => {
      if (seen.has(d)) return false;
      seen.add(d);
      return true;
    });

    const today = todayJakartaDate();
    if (!dates.includes(today)) dates.unshift(today);
    dates.sort((a, b) => {
      const da = parseIndoDate(a), db = parseIndoDate(b);
      if (!da || !db) return 0;
      return db - da;
    });

    if (!dates.length) {
      list.innerHTML = '<div class="empty-state" style="padding-top:24px;"><div class="empty-state-icon">📭</div><div class="empty-state-text">Belum ada foto diupload</div></div>';
      return;
    }

    list.innerHTML = dates.map(d => `
      <div class="proof-date-btn" onclick="selectAdminProofDateFromModal('${escapeHtml(d)}')">
        <div class="proof-date-icon">📅</div>
        <div class="proof-date-text">${escapeHtml(d)}${d === today ? ' (Hari ini)' : ''}</div>
        <div class="proof-date-arrow">▶</div>
      </div>
    `).join('');
  } catch (err) {
    list.innerHTML = '<div class="overseer-empty">Gagal memuat</div>';
  }
}

function selectAdminProofDateFromModal(date) {
  closeAdminProofDateModal();
  loadAdminProofPhoto(adminInputCurrentEkstra, date);
}

// ===== ADMIN INPUT: PHOTO ZOOM & PAN =====
let adminPhotoScale = 1;
let adminPhotoTx = 0;
let adminPhotoTy = 0;
let adminPhotoPointers = new Map();
let adminPhotoPinchStartDist = 0;
let adminPhotoPinchStartScale = 1;
let adminPhotoPanStart = null;

function adminPhotoApplyTransform() {
  const img = document.getElementById('adminPhotoImg');
  if (img) img.style.transform = `translate(calc(-50% + ${adminPhotoTx}px), calc(-50% + ${adminPhotoTy}px)) scale(${adminPhotoScale})`;
}

function adminPhotoZoomReset() {
  adminPhotoScale = 1;
  adminPhotoTx = 0;
  adminPhotoTy = 0;
  adminPhotoApplyTransform();
}

function adminPhotoZoom(dir) {
  const factor = dir > 0 ? 1.3 : (1 / 1.3);
  adminPhotoScale = Math.min(5, Math.max(1, adminPhotoScale * factor));
  if (adminPhotoScale === 1) { adminPhotoTx = 0; adminPhotoTy = 0; }
  adminPhotoApplyTransform();
}

function initAdminPhotoViewportEvents() {
  const vp = document.getElementById('adminPhotoViewport');
  if (!vp || vp.dataset.bound) return;
  vp.dataset.bound = '1';

  function isPhotoActive() {
    const img = document.getElementById('adminPhotoImg');
    return img && img.style.display !== 'none';
  }

  vp.addEventListener('wheel', (e) => {
    if (!isPhotoActive()) return;
    e.preventDefault();
    adminPhotoZoom(e.deltaY < 0 ? 1 : -1);
  }, { passive: false });

  vp.addEventListener('pointerdown', (e) => {
    if (!isPhotoActive()) return;
    vp.setPointerCapture(e.pointerId);
    adminPhotoPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (adminPhotoPointers.size === 1) {
      adminPhotoPanStart = { x: e.clientX, y: e.clientY, tx: adminPhotoTx, ty: adminPhotoTy };
    } else if (adminPhotoPointers.size === 2) {
      const pts = Array.from(adminPhotoPointers.values());
      adminPhotoPinchStartDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      adminPhotoPinchStartScale = adminPhotoScale;
    }
  });

  vp.addEventListener('pointermove', (e) => {
    if (!adminPhotoPointers.has(e.pointerId)) return;
    adminPhotoPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (adminPhotoPointers.size === 2) {
      const pts = Array.from(adminPhotoPointers.values());
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      if (adminPhotoPinchStartDist > 0) {
        adminPhotoScale = Math.min(5, Math.max(1, adminPhotoPinchStartScale * (dist / adminPhotoPinchStartDist)));
        adminPhotoApplyTransform();
      }
    } else if (adminPhotoPointers.size === 1 && adminPhotoPanStart) {
      adminPhotoTx = adminPhotoPanStart.tx + (e.clientX - adminPhotoPanStart.x);
      adminPhotoTy = adminPhotoPanStart.ty + (e.clientY - adminPhotoPanStart.y);
      adminPhotoApplyTransform();
    }
  });

  function releasePointer(e) {
    adminPhotoPointers.delete(e.pointerId);
    if (adminPhotoPointers.size < 2) adminPhotoPinchStartDist = 0;
    if (adminPhotoPointers.size === 0) adminPhotoPanStart = null;
  }
  vp.addEventListener('pointerup', releasePointer);
  vp.addEventListener('pointercancel', releasePointer);
  vp.addEventListener('pointerleave', releasePointer);

  vp.addEventListener('dblclick', () => adminPhotoZoomReset());
}

async function submitAdminInput() {
  if (adminInputChanges.size === 0) return;
  const today = getJakartaDateString();
  showLoading(true);
  try {
    const upserts = [];
    const toDelete = [];
    adminInputChanges.forEach((status, id) => {
      if (status) upserts.push({ student_id: id, date: today, status, semester: currentSemester, operator: currentOperator });
      else toDelete.push(id);
    });

    if (upserts.length) {
      const { error } = await sb.from('AttendanceV2').upsert(upserts, { onConflict: 'student_id,date,semester' });
      if (error) throw error;
    }
    if (toDelete.length) {
      const { error } = await sb.from('AttendanceV2').delete().eq('date', today).eq('semester', currentSemester).in('student_id', toDelete);
      if (error) throw error;
    }

    showStatus(`✓ ${upserts.length} data tersimpan`, "ok");
    adminInputChanges.clear();
    loadAdminInputList();
    loadAdminEkstraAttendanceStatus(); 
  } catch (err) {
    showStatus("Error: " + err.message, "error");
  }
  showLoading(false);
}

// ===== PROOF VIEWER =====
// ===== PROOF VIEWER =====
let proofViewerDates = [];
let proofViewerCurrentDate = null;
let proofViewerCurrentEkstra = null;
let proofViewerEkstraList = [];
let proofViewerProofMap = {};

function showProofViewer() {
  hideAllScreens();
  const el = document.getElementById("proofViewerScreen");
  if (el) {
    el.style.display = "flex";
    resetProofViewer();
    loadProofDates();
  }
}

function resetProofViewer() {
  proofViewerCurrentDate = null;
  proofViewerCurrentEkstra = null;
  proofViewerProofMap = {};
  document.getElementById('proofDateListView').style.display = 'block';
  document.getElementById('proofEkstraListView').style.display = 'none';
  document.getElementById('proofPhotoView').style.display = 'none';
  document.getElementById('proofViewerSubtitle').textContent = 'Pilih tanggal';
}

function backProofViewer() {
  if (document.getElementById('proofPhotoView').style.display !== 'none') {
    showProofEkstraList();
  } else if (document.getElementById('proofEkstraListView').style.display !== 'none') {
    resetProofViewer();
    loadProofDates();
  } else {
    // If opened from Tatib, return to Tatib screen instead of Admin
    if (typeof isTatib !== 'undefined' && isTatib) {
      hideAllScreens();
      showTatibScreen();
    } else {
      backToKelolaAbsensi();
    }
  }
}

async function loadProofDates() {
  const container = document.getElementById('proofDateList');
  if (container) container.innerHTML = '<div class="overseer-empty">Memuat...</div>';
  
  try {
    const { data, error } = await sb
      .from('AttendanceProof')
      .select('date')
      .eq('semester', currentSemester)
      .order('date', { ascending: false });
    
    if (error) throw error;
    
    const seen = new Set();
    proofViewerDates = (data || []).filter(d => {
      if (seen.has(d.date)) return false;
      seen.add(d.date);
      return true;
    });
    
    renderProofDateList();
  } catch (err) {
    showStatus('Error: ' + err.message, 'error');
    if (container) container.innerHTML = '<div class="overseer-empty">Gagal memuat</div>';
  }
}

function renderProofDateList() {
  const container = document.getElementById('proofDateList');
  if (!container) return;
  
  if (!proofViewerDates.length) {
    container.innerHTML = `
      <div class="empty-state" style="padding-top:40px;">
        <div class="empty-state-icon">📭</div>
        <div class="empty-state-text">Belum ada bukti upload</div>
      </div>`;
    return;
  }
  
  container.innerHTML = proofViewerDates.map(d => `
    <div class="proof-date-btn" onclick="selectProofDate('${escapeHtml(d.date)}')">
      <div class="proof-date-icon">📅</div>
      <div class="proof-date-text">${escapeHtml(d.date)}</div>
      <div class="proof-date-arrow">▶</div>
    </div>
  `).join('');
}

async function selectProofDate(date) {
  proofViewerCurrentDate = date;
  document.getElementById('proofViewerSubtitle').textContent = date;
  document.getElementById('proofEkstraDateLabel').textContent = date;
  
  const container = document.getElementById('proofEkstraList');
  if (container) container.innerHTML = '<div class="overseer-empty">Memuat...</div>';
  
  document.getElementById('proofDateListView').style.display = 'none';
  document.getElementById('proofEkstraListView').style.display = 'block';
  document.getElementById('proofPhotoView').style.display = 'none';
  
  try {
    const { data: students, error: sErr } = await sb
      .from('Database')
      .select('ekstra');
    if (sErr) throw sErr;
    
    const ekstraSet = new Set();
    (students || []).forEach(s => {
      const e = (s.ekstra || '').trim();
      if (e && e !== '0') ekstraSet.add(e);
    });
    proofViewerEkstraList = Array.from(ekstraSet).sort();
    
    const { data: proofs, error: pErr } = await sb
      .from('AttendanceProof')
      .select('ekstra, photo_url, uploaded_by, uploaded_at, page')
      .eq('date', date)
      .eq('semester', currentSemester)
      .order('page', { ascending: true });
    if (pErr) throw pErr;
    
    proofViewerProofMap = {};
    (proofs || []).forEach(p => {
      if (!proofViewerProofMap[p.ekstra]) proofViewerProofMap[p.ekstra] = [];
      proofViewerProofMap[p.ekstra].push(p);
    });
    
    renderProofEkstraList();
  } catch (err) {
    showStatus('Error: ' + err.message, 'error');
    if (container) container.innerHTML = '<div class="overseer-empty">Gagal memuat</div>';
  }
}

function renderProofEkstraList() {
  const container = document.getElementById('proofEkstraList');
  if (!container) return;
  
  if (!proofViewerEkstraList.length) {
    container.innerHTML = `
      <div class="empty-state" style="padding-top:40px;">
        <div class="empty-state-icon">📭</div>
        <div class="empty-state-text">Tidak ada ekskul terdaftar</div>
      </div>`;
    return;
  }
  
  container.innerHTML = proofViewerEkstraList.map(ekstra => {
    const proofs = proofViewerProofMap[ekstra];
    const hasPhoto = !!(proofs && proofs.length);
    const metaText = hasPhoto
      ? (proofs.length > 1 ? `${proofs.length} lembar tersedia` : 'Foto tersedia')
      : 'Belum ada foto';
    return `
      <div class="proof-ekstra-item" onclick="selectProofEkstra('${escapeHtml(ekstra)}')">
        <div class="proof-ekstra-info">
          <div class="proof-ekstra-name">${escapeHtml(ekstra)}</div>
          <div class="proof-ekstra-meta">${metaText}</div>
        </div>
        <div class="proof-ekstra-badge ${hasPhoto ? 'has' : 'missing'}">
          ${hasPhoto ? '✓' : '✗'}
        </div>
      </div>
    `;
  }).join('');
}

function selectProofEkstra(ekstra) {
  proofViewerCurrentEkstra = ekstra;
  const proofs = proofViewerProofMap[ekstra];
  
  document.getElementById('proofDateListView').style.display = 'none';
  document.getElementById('proofEkstraListView').style.display = 'none';
  document.getElementById('proofPhotoView').style.display = 'block';
  document.getElementById('proofViewerSubtitle').textContent = ekstra;
  
  const container = document.getElementById('proofPhotoContent');
  if (!container) return;
  
  if (!proofs || !proofs.length) {
    container.innerHTML = `
      <div class="proof-empty">
        <div class="proof-empty-icon">⚠️</div>
        <div class="proof-empty-title">Pembina belum upload foto absen</div>
        <div class="proof-empty-sub">Tanggal: ${escapeHtml(proofViewerCurrentDate)}</div>
      </div>
    `;
    return;
  }
  
  container.innerHTML = proofs.map((proof, i) => {
    const uploadedAt = proof.uploaded_at
      ? new Date(proof.uploaded_at).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' })
      : '-';
    return `
    <div class="proof-photo-card" style="${i > 0 ? 'margin-top:16px;' : ''}" onclick="window.open('${escapeHtml(proof.photo_url)}','_blank')">
      <div class="proof-photo-frame">
        <img src="${escapeHtml(proof.photo_url)}" alt="Bukti absensi lembar ${proof.page || i + 1}" onerror="this.parentElement.innerHTML='<div class=\\'proof-photo-error\\'>Gagal memuat gambar</div>'">
      </div>
      <div class="proof-photo-meta">
        <div class="proof-meta-row">
          <span class="proof-meta-label">Lembar</span>
          <span class="proof-meta-value">${proof.page || i + 1} / ${proofs.length}</span>
        </div>
        <div class="proof-meta-row">
          <span class="proof-meta-label">Diupload oleh</span>
          <span class="proof-meta-value">${escapeHtml(proof.uploaded_by)}</span>
        </div>
        <div class="proof-meta-row">
          <span class="proof-meta-label">Waktu upload</span>
          <span class="proof-meta-value">${uploadedAt}</span>
        </div>
      </div>
    </div>
  `;
  }).join('') + `<div class="proof-photo-hint">Klik gambar untuk membuka di tab baru</div>`;
}

function showProofEkstraList() {
  document.getElementById('proofPhotoView').style.display = 'none';
  document.getElementById('proofEkstraListView').style.display = 'block';
  document.getElementById('proofViewerSubtitle').textContent = proofViewerCurrentDate;
}
// ===== UTILS =====


// ===== KELOLA ABSENSI =====
function showKelolaAbsensi() {
  hideAllScreens();
  const el = document.getElementById('kelolaAbsensiScreen');
  if (el) el.style.display = 'flex';
}

function backToKelolaAbsensi() {
  hideAllScreens();
  showKelolaAbsensi();
}

// ===== PRINT ABSENSI =====
let printAbsensiData = [];
let printAbsensiSelectedEkstra = null;

function showPrintAbsensi() {
  hideAllScreens();
  const el = document.getElementById('printAbsensiScreen');
  if (el) {
    el.style.display = 'flex';
    loadPrintAbsensiList();
  }
}

async function loadPrintAbsensiList() {
  showLoading(true);
  try {
    // Get all ekstras from OPERATORS (excluding master/tatib)
    const ekstras = [];
    for (const [key, val] of Object.entries(OPERATORS || {})) {
      if (!val.isMaster && !val.isTatib && val.ekstra) {
        ekstras.push(val.ekstra);
      }
    }
    const uniqueEkstras = [...new Set(ekstras)].sort();

    // Count students per ekstra
    const counts = {};
    for (const ekstra of uniqueEkstras) {
      const { count, error } = await sb
        .from('Database')
        .select('*', { count: 'exact', head: true })
        .eq('ekstra', ekstra);
      counts[ekstra] = error ? 0 : (count || 0);
    }

    printAbsensiData = uniqueEkstras.map(ekstra => ({
      name: ekstra,
      count: counts[ekstra] || 0,
      pages: Math.ceil((counts[ekstra] || 0) / 30) || 1
    }));

    renderPrintAbsensiList();
  } catch (err) {
    showStatus('Error: ' + err.message, 'error');
  }
  showLoading(false);
}

function renderPrintAbsensiList() {
  const container = document.getElementById('printAbsensiList');
  const listView = document.getElementById('printAbsensiListView');
  const previewView = document.getElementById('printAbsensiPreviewView');

  if (listView) listView.style.display = 'block';
  if (previewView) previewView.style.display = 'none';

  if (!container) return;

  if (!printAbsensiData.length) {
    container.innerHTML = '<div class="empty-state" style="padding:24px;"><div class="empty-state-icon">📭</div><div class="empty-state-text">Tidak ada ekskul</div></div>';
    return;
  }

  container.innerHTML = printAbsensiData.map(e => `
    <div class="print-ekstra-item" onclick="showPrintAbsensiPreview('${escapeHtml(e.name)}')">
      <div class="print-ekstra-info">
        <div class="print-ekstra-name">${escapeHtml(e.name)}</div>
        <div class="print-ekstra-meta">${e.count} siswa</div>
      </div>
      <div class="print-ekstra-pages">~${e.pages} hal</div>
    </div>
  `).join('');
}

async function showPrintAbsensiPreview(ekstraName) {
  printAbsensiSelectedEkstra = ekstraName;
  showLoading(true);

  try {
    const { data: students, error } = await sb
      .from('Database')
      .select('id, nama, kelas')
      .eq('ekstra', ekstraName)
      .order('nama');

    if (error) throw error;

    const list = students || [];
    const dateStr = getJakartaDateString();
    const semStr = currentSemester || '-';

    // 32 students per page max (readable font size)
    const studentsPerPage = 30;
    const pages = [];
    for (let i = 0; i < list.length; i += studentsPerPage) {
      pages.push(list.slice(i, i + studentsPerPage));
    }
    if (pages.length === 0) pages.push([]);

    // Generate HTML
    const previewArea = document.getElementById('printAbsensiPreviewArea');
    if (!previewArea) return;

    previewArea.innerHTML = pages.map((pageStudents, pageIdx) => `
      <div class="print-paper" id="printPaper_${pageIdx}">
        <div class="print-corner tl"></div>
        <div class="print-corner tr"></div>
        <div class="print-corner bl"></div>
        <div class="print-corner br"></div>

        <div class="print-paper-header">
          <div class="print-paper-title">DAFTAR HADIR EKSTRAKURIKULER</div>
          <div class="print-paper-subtitle">${escapeHtml(ekstraName)} &mdash; ${semStr}</div>
          <div class="print-paper-meta">
            <span>Tanggal: ${dateStr}</span>
          </div>
        </div>

        <table class="print-main-table">
          <thead>
            <tr>
              <th rowspan="3">No</th>
              <th rowspan="3">Nama</th>
              <th rowspan="3">Kelas</th>
              <th colspan="6" class="attendance-header">Kehadiran</th>
              <th rowspan="3">No</th>
            </tr>
            <tr>
              <th colspan="6" class="attendance-date-blank">&nbsp;</th>
            </tr>
            <tr>
              <th class="attendance-col">PAGI</th>
              <th class="attendance-col">EKSTRA</th>
              <th class="attendance-col">PAGI</th>
              <th class="attendance-col">EKSTRA</th>
              <th class="attendance-col">PAGI</th>
              <th class="attendance-col">EKSTRA</th>
            </tr>
          </thead>
          <tbody>
            ${pageStudents.map((s, i) => `
              <tr>
                <td>${pageIdx * studentsPerPage + i + 1}</td>
                <td>${escapeHtml(s.nama)}</td>
                <td>${escapeHtml(s.kelas)}</td>
                <td class="attendance-col"><span class="print-square"></span></td>
                <td class="attendance-col"><span class="print-square"></span></td>
                <td class="attendance-col"><span class="print-square"></span></td>
                <td class="attendance-col"><span class="print-square"></span></td>
                <td class="attendance-col"><span class="print-square"></span></td>
                <td class="attendance-col"><span class="print-square"></span></td>
                <td>${pageIdx * studentsPerPage + i + 1}</td>
              </tr>
            `).join('')}
            ${pageStudents.length < studentsPerPage ? 
              Array(studentsPerPage - pageStudents.length).fill(0).map((_, i) => `
              <tr>
                <td>${pageIdx * studentsPerPage + pageStudents.length + i + 1}</td>
                <td></td>
                <td></td>
                <td class="attendance-col"><span class="print-square"></span></td>
                <td class="attendance-col"><span class="print-square"></span></td>
                <td class="attendance-col"><span class="print-square"></span></td>
                <td class="attendance-col"><span class="print-square"></span></td>
                <td class="attendance-col"><span class="print-square"></span></td>
                <td class="attendance-col"><span class="print-square"></span></td>
                <td>${pageIdx * studentsPerPage + pageStudents.length + i + 1}</td>
              </tr>
            `).join('') : ''}
          </tbody>
        </table>

        ${pageIdx === pages.length - 1 ? `
        <div class="print-paper-footer">
          <div class="print-signature">
            <div class="print-signature-label">Mengetahui,</div>
            <div class="print-signature-line">(_______________________)</div>
            <div>Pembina Ekskul</div>
          </div>
        </div>
        ` : ''}
      </div>
    `).join('');

    document.getElementById('printAbsensiListView').style.display = 'none';
    document.getElementById('printAbsensiPreviewView').style.display = 'block';

  } catch (err) {
    showStatus('Error: ' + err.message, 'error');
  }
  showLoading(false);
}

function backToPrintAbsensiList() {
  document.getElementById('printAbsensiListView').style.display = 'block';
  document.getElementById('printAbsensiPreviewView').style.display = 'none';
  printAbsensiSelectedEkstra = null;
}

function savePrintAbsensiPDF() {
  window.print();
}

async function printAllAbsensi() {
  showLoading(true);
  try {
    const dateStr = getJakartaDateString();
    const semStr = currentSemester || '-';
    const allPages = [];

    for (const ekstra of printAbsensiData) {
      const { data: students, error } = await sb
        .from('Database')
        .select('id, nama, kelas')
        .eq('ekstra', ekstra.name)
        .order('nama');

      if (error) continue;
      const list = students || [];

      const studentsPerPage = 30;
      for (let i = 0; i < list.length; i += studentsPerPage) {
        allPages.push({
          ekstra: ekstra.name,
          students: list.slice(i, i + studentsPerPage),
          startIdx: i,
          dateStr,
          semStr
        });
      }
    }

    const previewArea = document.getElementById('printAbsensiPreviewArea');
    if (previewArea) {
      previewArea.innerHTML = allPages.map((p, idx) => `
        <div class="print-paper" id="printPaper_all_${idx}">
          <div class="print-corner tl"></div>
          <div class="print-corner tr"></div>
          <div class="print-corner bl"></div>
          <div class="print-corner br"></div>

          <div class="print-paper-header">
            <div class="print-paper-title">DAFTAR HADIR EKSTRAKURIKULER</div>
            <div class="print-paper-subtitle">${escapeHtml(p.ekstra)} &mdash; ${p.semStr}</div>
            <div class="print-paper-meta">
              <span>Tanggal cetak: ${p.dateStr}</span>
            </div>
          </div>

          <table class="print-main-table">
          <thead>
            <tr>
              <th rowspan="3">No</th>
              <th rowspan="3">Nama</th>
              <th rowspan="3">Kelas</th>
              <th colspan="6" class="attendance-header">Kehadiran</th>
              <th rowspan="3">No</th>
            </tr>
            <tr>
              <th colspan="6" class="attendance-date-blank">&nbsp;</th>
            </tr>
            <tr>
              <th class="attendance-col">PAGI</th>
              <th class="attendance-col">EKSTRA</th>
              <th class="attendance-col">PAGI</th>
              <th class="attendance-col">EKSTRA</th>
              <th class="attendance-col">PAGI</th>
              <th class="attendance-col">EKSTRA</th>
            </tr>
          </thead>
          <tbody>
            ${p.students.map((s, i) => `
              <tr>
                <td>${p.startIdx + i + 1}</td>
                <td>${escapeHtml(s.nama)}</td>
                <td>${escapeHtml(s.kelas)}</td>
                <td class="attendance-col"><span class="print-square"></span></td>
                <td class="attendance-col"><span class="print-square"></span></td>
                <td class="attendance-col"><span class="print-square"></span></td>
                <td class="attendance-col"><span class="print-square"></span></td>
                <td class="attendance-col"><span class="print-square"></span></td>
                <td class="attendance-col"><span class="print-square"></span></td>
                <td>${p.startIdx + i + 1}</td>
              </tr>
            `).join('')}
            ${p.students.length < 30 ? 
              Array(30 - p.students.length).fill(0).map((_, i) => `
              <tr>
                <td>${p.startIdx + p.students.length + i + 1}</td>
                <td></td>
                <td></td>
                <td class="attendance-col"><span class="print-square"></span></td>
                <td class="attendance-col"><span class="print-square"></span></td>
                <td class="attendance-col"><span class="print-square"></span></td>
                <td class="attendance-col"><span class="print-square"></span></td>
                <td class="attendance-col"><span class="print-square"></span></td>
                <td class="attendance-col"><span class="print-square"></span></td>
                <td>${p.startIdx + p.students.length + i + 1}</td>
              </tr>
            `).join('') : ''}
          </tbody>
        </table>

          ${idx === allPages.length - 1 ? `
          <div class="print-paper-footer">
            <div class="print-signature">
              <div class="print-signature-label">Mengetahui,</div>
              <div class="print-signature-line">(_______________________)</div>
              <div>Pembina Ekskul</div>
            </div>
          </div>
          ` : ''}
        </div>
      `).join('');

      document.getElementById('printAbsensiListView').style.display = 'none';
      document.getElementById('printAbsensiPreviewView').style.display = 'block';
    }

  } catch (err) {
    showStatus('Error: ' + err.message, 'error');
  }
  showLoading(false);
}


function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text || "";
  return div.innerHTML;
}