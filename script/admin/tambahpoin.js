// ============================================
// tambahpoin.js — Admin: Tambah Poin (Supabase)
// Menambah poin penebusan ke tabel Redemptions, versi admin dari
// redemption.js. Poin 1-10 persis (slider), tidak pernah melewati 0.
// Dipakai dua role: Admin (dari adminScreen) dan Tatib (dari tatibScreen).
// Butuh: sb, currentSemester, currentOperator, isTatib, loadSupabaseConfig,
// showStatus, showLoading, hideAllScreens, showAdminScreen (main.js),
// showTatibScreen, escapeHtml, tatibFetchAll (tatib.js).
// ============================================

const TP_MIN_POINT = 1;
const TP_MAX_POINT = 10;

const TP_PALETTE = [
  "#0C7114", "#177D1A", "#239921", "#2FB528", "#45CA3F",
  "#66D95F", "#88E680", "#ADEFA6", "#D3F7CF", "#F5FDF4"
];

let tpConfig = null;
let tpStudentIndex = [];     // roster ringan: id, nama, kelas, ekstra
let tpSelectedStudent = null; // { id, nama, kelas, point }
let tpModalMaxPoint = 1;
let tpSelectToken = 0;        // cegah respons lama menimpa pilihan terbaru

// ============================================
// HELPERS
// ============================================

// Redemptions.guru dipakai redemption.js buat hitung batas harian per guru.
// Suffix "(Admin)" / "(Tatib)" menjaga input dari sini tidak ikut menghabiskan
// jatah guru yang kebetulan namanya sama.
function tpRoleLabel() {
  return isTatib ? "Tatib" : "Admin";
}

function tpGuruLabel() {
  return (currentOperator || tpRoleLabel()) + " (" + tpRoleLabel() + ")";
}

function tpMinusValue(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

// AttendanceV2 menyimpan status final langsung (sama dengan student_.js)
function tpDeriveStatus(rows) {
  if (!rows || rows.length === 0) return null;
  const explicit = rows.find(r => r.status && r.status.trim());
  return explicit ? explicit.status.trim().toUpperCase() : null;
}

function tpInitials(name) {
  return (name || "").trim().split(/\s+/).slice(0, 2).map(w => w[0]).join("").toUpperCase();
}

// ============================================
// NAVIGASI
// ============================================
async function showTambahPoin() {
  showLoading(true);
  try {
    // Config selalu diambil fresh; ini juga yang mengisi currentSemester
    tpConfig = await loadSupabaseConfig();

    if (tpConfig.redemptionEnable === false) {
      showStatus("Sistem penebusan sedang dinonaktifkan (Config Menu)", "info");
      showLoading(false);
      return;
    }

    hideAllScreens();
    const el = document.getElementById("tambahPoinScreen");
    if (el) el.style.display = "flex";
    const sub = document.getElementById("tpHeaderSub");
    if (sub) sub.textContent = "Kurangi minus poin siswa (" + tpRoleLabel() + ")";
    resetTambahPoinUI();

    // Roster diambil ulang tiap masuk supaya kelas/nama yang ditulis
    // ke Redemptions selalu terbaru. Dipaging karena batas 1000 baris Supabase.
    const { data, error } = await tatibFetchAll(() => sb
      .from("Database")
      .select("id, nama, kelas, ekstra")
      .order("id", { ascending: true }));
    if (error) throw error;
    tpStudentIndex = data || [];
  } catch (err) {
    console.error(err);
    showStatus("Gagal memuat data: " + err.message, "error");
  }
  showLoading(false);
}

function closeTambahPoin() {
  closeTambahPoinModal();
  resetTambahPoinUI();
  hideAllScreens();
  if (isTatib) showTatibScreen();
  else showAdminScreen();
}

function resetTambahPoinUI() {
  const search = document.getElementById("tpSearchInput");
  const sugg = document.getElementById("tpSuggestions");
  const detail = document.getElementById("tpDetail");
  const empty = document.getElementById("tpEmpty");
  if (search) search.value = "";
  if (sugg) { sugg.innerHTML = ""; sugg.style.display = "none"; }
  if (detail) { detail.innerHTML = ""; detail.style.display = "none"; }
  if (empty) empty.style.display = "flex";
  tpSelectedStudent = null;
  tpSelectToken++;
}

// ============================================
// SEARCH / AUTOCOMPLETE (client-side)
// ============================================
function onTambahPoinSearch() {
  const q = document.getElementById("tpSearchInput").value.trim().toLowerCase();
  const detail = document.getElementById("tpDetail");
  const empty = document.getElementById("tpEmpty");
  const sugg = document.getElementById("tpSuggestions");

  tpSelectedStudent = null;
  tpSelectToken++;
  detail.style.display = "none";
  empty.style.display = "flex";

  if (q.length < 2) {
    sugg.style.display = "none";
    return;
  }

  const matches = tpStudentIndex
    .filter(s => (s.nama || "").toLowerCase().includes(q))
    .slice(0, 6);
  renderTpSuggestions(matches);
}

function renderTpSuggestions(matches) {
  const sugg = document.getElementById("tpSuggestions");
  sugg.innerHTML = "";
  if (matches.length === 0) {
    sugg.style.display = "none";
    return;
  }
  matches.forEach(s => {
    const div = document.createElement("div");
    div.className = "tp-suggestion-item";
    div.innerHTML =
      `<div class="tp-suggestion-name">${escapeHtml(s.nama)}</div>` +
      `<div class="tp-suggestion-class">${escapeHtml(s.kelas)}</div>`;
    div.onclick = () => selectTpStudent(s);
    sugg.appendChild(div);
  });
  sugg.style.display = "block";
}

document.addEventListener("click", (e) => {
  const sugg = document.getElementById("tpSuggestions");
  if (sugg && !e.target.closest(".tp-search-wrap")) sugg.style.display = "none";
});

// ============================================
// HITUNG POIN SISWA (sama dengan redemption.js, config dari appConfig utama)
// ============================================
async function tpComputeStudentPoint(studentId) {
  const [{ data: attRows, error: attErr }, { data: reds, error: redErr }] = await Promise.all([
    sb.from("AttendanceV2").select("date, status").eq("student_id", studentId).eq("semester", currentSemester),
    sb.from("Redemptions").select("poin").eq("student_id", studentId).eq("semester", currentSemester)
  ]);
  if (attErr) throw attErr;
  if (redErr) throw redErr;

  const byDate = {};
  (attRows || []).forEach(r => {
    if (!byDate[r.date]) byDate[r.date] = [];
    byDate[r.date].push(r);
  });
  const stats = { HADIR: 0, ALPHA: 0, TERLAMBAT: 0, PAGI: 0, TELAT: 0 };
  Object.values(byDate).forEach(rows => {
    const st = tpDeriveStatus(rows) || "-";
    if (stats[st] !== undefined) stats[st]++;
  });

  const minusAlpha = tpMinusValue(tpConfig?.nilaiMinusAlpha, -10);
  const minusLate  = tpMinusValue(tpConfig?.nilaiMinusTerlambat, -5);
  const alphaCount = stats.ALPHA;
  const lateCount  = stats.TERLAMBAT + stats.TELAT + stats.PAGI; // PAGI dihitung telat, sama seperti dashboard siswa
  const totalMinus = (alphaCount * minusAlpha) + (lateCount * minusLate);
  const redemptionTotal = (reds || []).reduce((sum, r) => sum + (r.poin || 0), 0);

  return { point: totalMinus + redemptionTotal, hadir: stats.HADIR, alpha: alphaCount, late: lateCount };
}

// ============================================
// PILIH SISWA + DETAIL
// ============================================
async function selectTpStudent(student) {
  const token = ++tpSelectToken;
  document.getElementById("tpSearchInput").value = student.nama;
  document.getElementById("tpSuggestions").style.display = "none";
  showLoading(true);

  try {
    const { point, hadir, alpha, late } = await tpComputeStudentPoint(student.id);
    if (token !== tpSelectToken) { showLoading(false); return; } // user sudah ganti pilihan

    tpSelectedStudent = { id: student.id, nama: student.nama, kelas: student.kelas, point };
    document.getElementById("tpEmpty").style.display = "none";
    renderTpDetail({ nama: student.nama, kelas: student.kelas, ekstra: student.ekstra, hadir, alpha, late, point });
  } catch (err) {
    console.error(err);
    showStatus("Gagal memuat data siswa: " + err.message, "error");
  }
  showLoading(false);
}

function renderTpDetail(d) {
  const isMinus = d.point < 0;
  const detail = document.getElementById("tpDetail");
  detail.innerHTML = `
    <div class="tp-detail-card ${isMinus ? "is-minus" : ""}">
      <div class="tp-detail-avatar ${isMinus ? "is-minus" : ""}">${escapeHtml(tpInitials(d.nama))}</div>
      <div class="tp-detail-name">${escapeHtml(d.nama)}</div>
      <div class="tp-detail-class">${escapeHtml(d.kelas)}${d.ekstra ? " • " + escapeHtml(d.ekstra) : ""}</div>

      <div class="tp-detail-stats">
        <div class="tp-stat">
          <div class="tp-stat-val">${d.hadir}</div>
          <div class="tp-stat-label">Hadir</div>
        </div>
        <div class="tp-stat">
          <div class="tp-stat-val">${d.alpha}</div>
          <div class="tp-stat-label">Alpha</div>
        </div>
        <div class="tp-stat">
          <div class="tp-stat-val">${d.late}</div>
          <div class="tp-stat-label">Terlambat</div>
        </div>
      </div>

      <div class="tp-detail-point ${isMinus ? "is-minus" : ""}">
        <div class="tp-detail-point-val">${d.point}</div>
        <div class="tp-detail-point-label">Sisa Poin</div>
      </div>

      ${isMinus
        ? `<button class="btn-primary" style="width:100%;" onclick="openTambahPoinModal()">Tambah Poin</button>`
        : `<div class="tp-detail-ok">✓ Siswa ini tidak memiliki minus poin</div>`
      }
    </div>
  `;
  detail.style.display = "block";
}

// ============================================
// MODAL
// ============================================
function openTambahPoinModal() {
  const s = tpSelectedStudent;
  if (!s) return;
  if (s.point >= 0) {
    showStatus("Siswa ini tidak memiliki minus poin", "info");
    return;
  }
  const room = Math.floor(Math.abs(s.point));
  if (room < TP_MIN_POINT) {
    showStatus("Sisa minus siswa kurang dari 1 poin", "info");
    return;
  }

  document.getElementById("tpModalName").textContent = s.nama;
  document.getElementById("tpModalClass").textContent = s.kelas + " • " + s.point + " poin";

  // 1-10 persis, tapi tidak boleh melewati sisa minus (tidak pernah jadi +)
  tpModalMaxPoint = Math.min(TP_MAX_POINT, room);
  const slider = document.getElementById("tpSlider");
  slider.min = TP_MIN_POINT;
  slider.max = tpModalMaxPoint;
  slider.value = Math.min(3, tpModalMaxPoint);

  document.getElementById("tpDesc").value = "";
  renderTpSliderMarks();
  updateTpSliderLabel();
  document.getElementById("tpSubmitBtn").disabled = false;
  document.getElementById("tambahPoinModal").classList.add("visible");
}

function closeTambahPoinModal() {
  const modal = document.getElementById("tambahPoinModal");
  if (modal) modal.classList.remove("visible");
  const btn = document.getElementById("tpSubmitBtn");
  if (btn) btn.disabled = false;
}

function renderTpSliderMarks() {
  const container = document.getElementById("tpSliderMarks");
  if (!container) return;
  container.innerHTML = "";
  for (let i = TP_MIN_POINT; i <= tpModalMaxPoint; i++) {
    const span = document.createElement("span");
    span.textContent = i;
    container.appendChild(span);
  }
}

function updateTpSliderLabel() {
  const slider = document.getElementById("tpSlider");
  const labelEl = document.getElementById("tpSliderLabel");
  const val = Number(slider.value);
  const maxVal = tpModalMaxPoint;

  const colors = TP_PALETTE.slice(0, maxVal);
  const color = colors[val - 1] || TP_PALETTE[0];

  labelEl.innerHTML = `
    <span class="tp-slider-number">${val}</span>
    <span class="tp-slider-text">poin</span>
  `;
  labelEl.style.color = color;

  const percent = maxVal === 1 ? 100 : ((val - 1) / (maxVal - 1)) * 100;
  slider.style.setProperty("--slider-color", color);
  slider.style.setProperty("--value-percent", percent + "%");
}

// ============================================
// SUBMIT (SUPABASE)
// ============================================
async function submitTambahPoin() {
  const s = tpSelectedStudent;
  if (!s) return;

  const poin = Number(document.getElementById("tpSlider").value);
  const deskripsi = document.getElementById("tpDesc").value.trim();
  const btn = document.getElementById("tpSubmitBtn");

  if (!Number.isInteger(poin) || poin < TP_MIN_POINT || poin > TP_MAX_POINT) {
    showStatus(`Poin harus ${TP_MIN_POINT}-${TP_MAX_POINT}`, "error");
    return;
  }
  if (!deskripsi) {
    showStatus("Deskripsi wajib diisi", "error");
    return;
  }

  btn.disabled = true;
  showLoading(true);

  try {
    // Cek ulang saldo tepat sebelum insert — bisa berubah sejak modal dibuka
    // (mis. guru lain baru kasih poin ke siswa yang sama).
    const { point: freshPoint } = await tpComputeStudentPoint(s.id);
    if (freshPoint >= 0) {
      showStatus("Siswa ini sudah tidak memiliki minus poin", "error");
      closeTambahPoinModal();
      await selectTpStudent(s);
      return;
    }
    const room = Math.floor(Math.abs(freshPoint));
    if (poin > room) {
      showStatus(`Poin melebihi sisa minus siswa (maks ${room})`, "error");
      btn.disabled = false;
      return;
    }

    const { error: insertErr } = await sb.from("Redemptions").insert({
      student_id: s.id,
      nama: s.nama,
      kelas: s.kelas,
      poin: poin,
      deskripsi: deskripsi,
      guru: tpGuruLabel(),
      semester: currentSemester,
      created_at: new Date().toISOString()
    });
    if (insertErr) throw insertErr;

    closeTambahPoinModal();
    showStatus(`✓ +${poin} poin berhasil dicatat`, "ok");
    await selectTpStudent(s); // refresh detail dengan saldo baru
  } catch (err) {
    console.error(err);
    showStatus("Error: " + err.message, "error");
    btn.disabled = false;
  } finally {
    showLoading(false); // juga jalan di semua jalur return di atas
  }
}