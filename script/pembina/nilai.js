// ===== NILAI EKSKUL (pembina) =====
let nilaiStudents = [];
let nilaiChanges = new Map(); // id -> number (0-100), only rows that differ from DB
let nilaiSearchQuery = "";

const nilaiScreen = document.getElementById("nilaiScreen");
const nilaiList = document.getElementById("nilaiList");
const nilaiEmpty = document.getElementById("nilaiEmpty");
const nilaiEmptyText = document.getElementById("nilaiEmptyText");
const nilaiStatTotal = document.getElementById("nilaiStatTotal");
const nilaiStatAvg = document.getElementById("nilaiStatAvg");
const nilaiStatZero = document.getElementById("nilaiStatZero");
const nilaiSaveBtn = document.getElementById("nilaiSaveBtn");
const nilaiChangeCount = document.getElementById("nilaiChangeCount");
const nilaiSearchInput = document.getElementById("nilaiSearchInput");

// ===== ENABLE / DISABLE (controlled from admin Config Menu) =====
async function isNilaiEnabled() {
  try {
    const cfg = await loadSupabaseConfig(); // always fresh, so admin changes apply immediately
    return cfg.nilaiEnable !== false;
  } catch (e) {
    return true;
  }
}

// Called from showDashboard(): hide the dashboard button when disabled
async function applyNilaiMenuVisibility() {
  const btn = document.getElementById("nilaiDashBtn");
  if (!btn) return;
  const enabled = await isNilaiEnabled();
  btn.style.display = enabled ? "" : "none";
}

// ===== SHOW / HIDE =====
async function showNilai() {
  if (isMaster) {
    showStatus("MASTER tidak dapat mengakses nilai", "info");
    return;
  }
  showLoading(true);
  const enabled = await isNilaiEnabled();
  showLoading(false);
  if (!enabled) {
    showStatus("Menu nilai sedang dinonaktifkan admin", "info");
    applyNilaiMenuVisibility();
    return;
  }
  dashboardScreen.style.display = "none";
  nilaiScreen.style.display = "flex";
  loadNilaiStudents();
}

function backToDashboardFromNilai() {
  if (nilaiChanges.size > 0) {
    showStatus("Perubahan belum disimpan", "error");
    return;
  }
  nilaiScreen.style.display = "none";
  dashboardScreen.style.display = "flex";
}

// ===== LOAD =====
async function loadNilaiStudents() {
  showLoading(true);
  try {
    const { data, error } = await sb
      .from('Database')
      .select('id, nama, kelas, ekstra, photo_url, nilai_ekskul')
      .eq('ekstra', currentEkstra)
      .order('nama', { ascending: true });
    if (error) throw error;

    nilaiStudents = (data || []).map(s => ({
      id: s.id,
      nama: s.nama,
      kelas: s.kelas,
      foto: s.photo_url,
      nilai: clampNilai(s.nilai_ekskul)
    }));

    nilaiChanges.clear();
    nilaiSearchQuery = "";
    if (nilaiSearchInput) nilaiSearchInput.value = "";
    updateNilaiStats();
    renderNilaiList();
  } catch (err) {
    showStatus("Error memuat data: " + err.message, "error");
  }
  showLoading(false);
}

function clampNilai(v) {
  const n = parseInt(v, 10);
  if (isNaN(n)) return 0;
  return Math.max(0, Math.min(100, n));
}

function nilaiLevel(v) {
  if (v <= 0) return "zero";
  if (v < 60) return "low";
  if (v < 80) return "mid";
  return "high";
}

function currentNilai(s) {
  return nilaiChanges.has(s.id) ? nilaiChanges.get(s.id) : s.nilai;
}

// ===== SEARCH =====
function handleNilaiSearch() {
  nilaiSearchQuery = nilaiSearchInput ? nilaiSearchInput.value : "";
  renderNilaiList();
}

// ===== STATS =====
function updateNilaiStats() {
  const total = nilaiStudents.length;
  const values = nilaiStudents.map(currentNilai);
  const sum = values.reduce((a, b) => a + b, 0);
  const avg = total ? Math.round((sum / total) * 10) / 10 : 0;
  const zero = values.filter(v => v === 0).length;

  if (nilaiStatTotal) nilaiStatTotal.textContent = total;
  if (nilaiStatAvg) nilaiStatAvg.textContent = avg;
  if (nilaiStatZero) nilaiStatZero.textContent = zero;

  if (nilaiChangeCount) nilaiChangeCount.textContent = `${nilaiChanges.size} perubahan`;
  if (nilaiSaveBtn) {
    if (nilaiChanges.size > 0) {
      nilaiSaveBtn.textContent = `Simpan (${nilaiChanges.size})`;
      nilaiSaveBtn.classList.add("has-changes");
      nilaiSaveBtn.disabled = false;
    } else {
      nilaiSaveBtn.textContent = "Simpan";
      nilaiSaveBtn.classList.remove("has-changes");
      nilaiSaveBtn.disabled = true;
    }
  }
}

// ===== RENDER =====
function renderNilaiList() {
  nilaiList.innerHTML = "";

  if (nilaiStudents.length === 0) {
    nilaiEmptyText.textContent = "Tidak ada siswa";
    nilaiEmpty.style.display = "block";
    return;
  }

  const q = nilaiSearchQuery.trim().toLowerCase();
  const filtered = q
    ? nilaiStudents.filter(s => (s.nama || "").toLowerCase().includes(q))
    : nilaiStudents;

  if (filtered.length === 0) {
    nilaiEmptyText.textContent = "Siswa tidak ditemukan";
    nilaiEmpty.style.display = "block";
    return;
  }
  nilaiEmpty.style.display = "none";

  filtered.forEach(s => {
    const item = document.createElement("div");
    item.className = "syarat-item" + (nilaiChanges.has(s.id) ? " nilai-changed" : "");

    item.innerHTML = `
      <div class="syarat-left">
        <img class="syarat-photo" src="${s.foto || ''}" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
        <div class="syarat-photo-placeholder" style="display:none;">👤</div>
        <div class="syarat-info">
          <div class="syarat-name">${escapeHtml(s.nama)}</div>
          <div class="syarat-class">${escapeHtml(s.kelas || "")}</div>
        </div>
      </div>
      <div class="nilai-field" data-level="${nilaiLevel(currentNilai(s))}">
        <input class="nilai-score" type="text" inputmode="numeric" pattern="[0-9]*"
               maxlength="3" value="${currentNilai(s)}" aria-label="Nilai ${escapeHtml(s.nama)}">
        <span class="nilai-suffix">/100</span>
      </div>
    `;

    const input = item.querySelector(".nilai-score");
    const field = item.querySelector(".nilai-field");
    input.addEventListener("focus", () => input.select());
    input.addEventListener("input", () => {
      const digits = input.value.replace(/\D/g, "");
      const val = digits === "" ? 0 : clampNilai(digits);
      if (digits !== "") input.value = val; // keeps value inside 0-100 while typing
      field.dataset.level = nilaiLevel(val);
      setNilai(s.id, val, item);
    });
    input.addEventListener("blur", () => {
      input.value = currentNilai(s); // empty -> shows 0
      field.dataset.level = nilaiLevel(currentNilai(s));
    });

    nilaiList.appendChild(item);
  });
}

// Updates state WITHOUT re-rendering, so the keyboard/focus stays put
function setNilai(id, val, itemEl) {
  const student = nilaiStudents.find(s => s.id === id);
  if (!student) return;
  if (val === student.nilai) nilaiChanges.delete(id);
  else nilaiChanges.set(id, val);
  if (itemEl) itemEl.classList.toggle("nilai-changed", nilaiChanges.has(id));
  updateNilaiStats();
}

// ===== SAVE =====
async function submitNilaiChanges() {
  if (nilaiChanges.size === 0) {
    showStatus("Tidak ada perubahan", "info");
    return;
  }
  if (!(await isNilaiEnabled())) {
    showStatus("Menu nilai sedang dinonaktifkan admin", "error");
    return;
  }

  showLoading(true);
  if (nilaiSaveBtn) {
    nilaiSaveBtn.disabled = true;
    nilaiSaveBtn.textContent = "Menyimpan...";
  }

  try {
    const count = nilaiChanges.size;
    const updates = [];
    nilaiChanges.forEach((val, id) => {
      updates.push(
        sb.from('Database')
          .update({ nilai_ekskul: clampNilai(val) })
          .eq('id', id)
      );
    });

    const results = await Promise.all(updates);
    const errors = results.filter(r => r.error);
    if (errors.length > 0) throw new Error(errors[0].error.message);

    clearBundle();
    showStatus(`✓ ${count} nilai diperbarui`, "ok");
    nilaiChanges.clear();
    await loadNilaiStudents();
  } catch (err) {
    showStatus("Error: " + err.message, "error");
    updateNilaiStats();
  }
  showLoading(false);
}