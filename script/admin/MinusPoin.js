// ============================================
// minuspoin.js — Admin + Tatib: Beri Minus Poin (manual)
// Menambah pengurangan poin di luar status absensi (Alpha/Terlambat/Pagi)
// ke tabel PoinManual. Disimpan NEGATIF, ikut dijumlahkan ke nilai siswa.
// Butuh: sb, currentSemester, currentOperator, isTatib, loadSupabaseConfig,
// showStatus, showLoading, hideAllScreens, showAdminScreen, showTatibScreen,
// escapeHtml, tatibFetchAll, tpComputeStudentPoint, tpGuruLabel, tpInitials,
// tpRoleLabel, tpConfig (tambahpoin.js).
// ============================================

const MP_MIN = 1;
const MP_MAX = 50;

let mpStudentIndex = [];
let mpSelected = null;       // { id, nama, kelas, ekstra }
let mpSelectToken = 0;

async function showMinusPoin() {
  showLoading(true);
  try {
    tpConfig = await loadSupabaseConfig();
    if (tpConfig.minusPointEnable === false) {
      showStatus("Sistem minus poin sedang dinonaktifkan (Config Menu)", "info");
      showLoading(false);
      return;
    }
    hideAllScreens();
    const el = document.getElementById("minusPoinScreen");
    if (el) el.style.display = "flex";
    const sub = document.getElementById("mpHeaderSub");
    if (sub) sub.textContent = "Beri minus poin manual (" + tpRoleLabel() + ")";
    resetMinusPoinUI();

    const { data, error } = await tatibFetchAll(() => sb
      .from("Database")
      .select("id, nama, kelas, ekstra")
      .order("id", { ascending: true }));
    if (error) throw error;
    mpStudentIndex = data || [];
  } catch (err) {
    console.error(err);
    showStatus("Gagal memuat data: " + err.message, "error");
  }
  showLoading(false);
}

function closeMinusPoin() {
  closeMinusPoinModal();
  resetMinusPoinUI();
  hideAllScreens();
  if (isTatib) showTatibScreen();
  else showAdminScreen();
}

function resetMinusPoinUI() {
  const search = document.getElementById("mpSearchInput");
  const sugg = document.getElementById("mpSuggestions");
  const detail = document.getElementById("mpDetail");
  const empty = document.getElementById("mpEmpty");
  if (search) search.value = "";
  if (sugg) { sugg.innerHTML = ""; sugg.style.display = "none"; }
  if (detail) { detail.innerHTML = ""; detail.style.display = "none"; }
  if (empty) empty.style.display = "flex";
  mpSelected = null;
  mpSelectToken++;
}

// ---------- SEARCH ----------
function onMinusPoinSearch() {
  const q = document.getElementById("mpSearchInput").value.trim().toLowerCase();
  const sugg = document.getElementById("mpSuggestions");
  mpSelected = null;
  mpSelectToken++;
  document.getElementById("mpDetail").style.display = "none";
  document.getElementById("mpEmpty").style.display = "flex";

  if (q.length < 2) { sugg.style.display = "none"; return; }

  const matches = mpStudentIndex
    .filter(s => (s.nama || "").toLowerCase().includes(q))
    .slice(0, 6);
  sugg.innerHTML = "";
  if (matches.length === 0) { sugg.style.display = "none"; return; }
  matches.forEach(s => {
    const div = document.createElement("div");
    div.className = "tp-suggestion-item";
    div.innerHTML =
      `<div class="tp-suggestion-name">${escapeHtml(s.nama)}</div>` +
      `<div class="tp-suggestion-class">${escapeHtml(s.kelas)}</div>`;
    div.onclick = () => selectMpStudent(s);
    sugg.appendChild(div);
  });
  sugg.style.display = "block";
}

document.addEventListener("click", (e) => {
  const sugg = document.getElementById("mpSuggestions");
  if (sugg && !e.target.closest(".mp-search-wrap")) sugg.style.display = "none";
});

// ---------- DETAIL + RIWAYAT ----------
async function selectMpStudent(student) {
  const token = ++mpSelectToken;
  document.getElementById("mpSearchInput").value = student.nama;
  document.getElementById("mpSuggestions").style.display = "none";
  showLoading(true);
  try {
    const [{ point }, { data: history, error: hErr }] = await Promise.all([
      tpComputeStudentPoint(student.id),
      sb.from("PoinManual")
        .select("id, poin, alasan, diinput_oleh, created_at")
        .eq("student_id", student.id)
        .eq("semester", currentSemester)
        .eq("dibatalkan", false)
        .order("created_at", { ascending: false })
    ]);
    if (hErr) throw hErr;
    if (token !== mpSelectToken) { showLoading(false); return; }

    mpSelected = { id: student.id, nama: student.nama, kelas: student.kelas, ekstra: student.ekstra };
    document.getElementById("mpEmpty").style.display = "none";
    renderMpDetail(student, point, history || []);
  } catch (err) {
    console.error(err);
    showStatus("Gagal memuat data siswa: " + err.message, "error");
  }
  showLoading(false);
}

function renderMpDetail(s, point, history) {
  const isMinus = point < 0;
  const manualTotal = history.reduce((sum, r) => sum + (r.poin || 0), 0);
  const rows = history.length === 0
    ? `<div style="text-align:center;opacity:.6;padding:12px 0;">Belum ada minus poin manual</div>`
    : history.map(r => `
        <div style="display:flex;gap:10px;align-items:flex-start;padding:10px 0;border-top:1px solid rgba(255,255,255,.08);">
          <div style="flex:1;text-align:left;">
            <div style="font-weight:700;color:#ef4444;">${r.poin} poin</div>
            <div style="font-size:13px;">${escapeHtml(r.alasan)}</div>
            <div style="font-size:11px;opacity:.6;">${escapeHtml(r.diinput_oleh || "-")} • ${new Date(r.created_at).toLocaleDateString("id-ID")}</div>
          </div>
          <button class="btn-secondary" style="padding:6px 10px;" onclick="cancelMinusPoin(${r.id})">Batalkan</button>
        </div>`).join("");

  const detail = document.getElementById("mpDetail");
  detail.innerHTML = `
    <div class="tp-detail-card ${isMinus ? "is-minus" : ""}">
      <div class="tp-detail-avatar ${isMinus ? "is-minus" : ""}">${escapeHtml(tpInitials(s.nama))}</div>
      <div class="tp-detail-name">${escapeHtml(s.nama)}</div>
      <div class="tp-detail-class">${escapeHtml(s.kelas)}${s.ekstra ? " • " + escapeHtml(s.ekstra) : ""}</div>

      <div class="tp-detail-stats">
        <div class="tp-stat"><div class="tp-stat-val">${manualTotal}</div><div class="tp-stat-label">Total Manual</div></div>
      </div>

      <div class="tp-detail-point ${isMinus ? "is-minus" : ""}">
        <div class="tp-detail-point-val">${point}</div>
        <div class="tp-detail-point-label">Nilai Saat Ini</div>
      </div>

      <button class="btn-primary" style="width:100%;" onclick="openMinusPoinModal()">Beri Minus Poin</button>

      <div style="margin-top:16px;">
        <div style="font-size:12px;font-weight:700;opacity:.7;text-align:left;">RIWAYAT MINUS MANUAL</div>
        ${rows}
      </div>
    </div>`;
  detail.style.display = "block";
}

// ---------- MODAL ----------
function openMinusPoinModal() {
  if (!mpSelected) return;
  document.getElementById("mpModalName").textContent = mpSelected.nama;
  document.getElementById("mpModalClass").textContent = mpSelected.kelas;
  document.getElementById("mpAmount").value = "";
  document.getElementById("mpDesc").value = "";
  document.getElementById("mpSubmitBtn").disabled = false;
  document.getElementById("minusPoinModal").classList.add("visible");
}

function closeMinusPoinModal() {
  const modal = document.getElementById("minusPoinModal");
  if (modal) modal.classList.remove("visible");
  const btn = document.getElementById("mpSubmitBtn");
  if (btn) btn.disabled = false;
}

async function submitMinusPoin() {
  const s = mpSelected;
  if (!s) return;
  const amount = Number(document.getElementById("mpAmount").value);
  const alasan = document.getElementById("mpDesc").value.trim();
  const btn = document.getElementById("mpSubmitBtn");

  if (!Number.isInteger(amount) || amount < MP_MIN || amount > MP_MAX) {
    showStatus(`Jumlah poin harus bilangan bulat ${MP_MIN}-${MP_MAX}`, "error");
    return;
  }
  if (!alasan) {
    showStatus("Alasan wajib diisi", "error");
    return;
  }

  btn.disabled = true;
  showLoading(true);
  try {
    const { error } = await sb.from("PoinManual").insert({
      student_id: s.id,
      semester: currentSemester,
      poin: -amount,                 // selalu negatif
      alasan: alasan,
      diinput_oleh: tpGuruLabel()
    });
    if (error) throw error;

    closeMinusPoinModal();
    showStatus(`✓ -${amount} poin berhasil dicatat`, "ok");
    await selectMpStudent(s);
  } catch (err) {
    console.error(err);
    showStatus("Error: " + err.message, "error");
    btn.disabled = false;
  } finally {
    showLoading(false);
  }
}

async function cancelMinusPoin(id) {
  if (!confirm("Batalkan minus poin ini? Poin siswa akan dikembalikan.")) return;
  showLoading(true);
  try {
    const { error } = await sb.from("PoinManual")
      .update({ dibatalkan: true, dibatalkan_oleh: tpGuruLabel(), dibatalkan_pada: new Date().toISOString() })
      .eq("id", id);
    if (error) throw error;
    showStatus("Minus poin dibatalkan", "ok");
    if (mpSelected) await selectMpStudent(mpSelected);
  } catch (err) {
    console.error(err);
    showStatus("Gagal membatalkan: " + err.message, "error");
  }
  showLoading(false);
}

// ---------- PILIHAN: TAMBAH / KURANGI (satu tombol dashboard) ----------
function openPoinChoice() {
  const m = document.getElementById("poinChoiceModal");
  if (m) m.classList.add("visible");
}

function closePoinChoice() {
  const m = document.getElementById("poinChoiceModal");
  if (m) m.classList.remove("visible");
}

function pickPoinChoice(kind) {
  closePoinChoice();
  if (kind === "tambah") showTambahPoin();   // penebusan: kurangi minus siswa
  else showMinusPoin();                      // minus manual: tambah minus siswa
}