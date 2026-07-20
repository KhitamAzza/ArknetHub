// ===== SYARAT KHUSUS STATE =====
let syaratStudents = [];
let syaratChanges = new Map(); // nama → "SUDAH" | "BELUM"

// ===== DOM REFS =====
const syaratScreen = document.getElementById("syaratScreen");
const syaratList = document.getElementById("syaratList");
const syaratEmpty = document.getElementById("syaratEmpty");
const syaratStatTotal = document.getElementById("syaratStatTotal");
const syaratStatDone = document.getElementById("syaratStatDone");
const syaratStatPending = document.getElementById("syaratStatPending");
const syaratSaveBtn = document.getElementById("syaratSaveBtn");

// ===== SHOW SYARAT SCREEN =====
function showSyaratKhusus() {
  if (isMaster) {
    showStatus("MASTER tidak dapat mengakses syarat khusus", "info");
    return;
  }
  dashboardScreen.style.display = "none";
  syaratScreen.style.display = "flex";
  loadSyaratStudents();
}

function backToDashboardFromSyarat() {
  if (syaratChanges.size > 0) {
    // Optional: confirm discard
    showStatus("Perubahan belum disimpan", "error");
    return;
  }
  syaratScreen.style.display = "none";
  dashboardScreen.style.display = "flex";
  syaratChanges.clear();
}

// ===== LOAD STUDENTS =====
async function loadSyaratStudents() {
  showLoading(true);
  try {
    const res = await fetch(API_URL + "?action=getSyaratStudents&ekstra=" + encodeURIComponent(currentEkstra));
    const data = await res.json();

    if (data.status === "ok") {
      syaratStudents = data.data || [];
      syaratChanges.clear();
      updateSyaratStats();
      renderSyaratList();
    } else {
      showStatus(data.message || "Gagal memuat data", "error");
    }
  } catch (err) {
    showStatus("Error koneksi: " + err.message, "error");
  }
  showLoading(false);
}

// ===== STATS =====
function updateSyaratStats() {
  const total = syaratStudents.length;
  const done = syaratStudents.filter(s => {
    const changed = syaratChanges.get(s.nama);
    if (changed) return changed === "SUDAH";
    return s.syarat === "SUDAH";
  }).length;
  const pending = total - done;

  if (syaratStatTotal) syaratStatTotal.textContent = total;
  if (syaratStatDone) syaratStatDone.textContent = done;
  if (syaratStatPending) syaratStatPending.textContent = pending;
  
  // Update save button state
  if (syaratSaveBtn) {
    if (syaratChanges.size > 0) {
      syaratSaveBtn.textContent = `Simpan (${syaratChanges.size})`;
      syaratSaveBtn.classList.add("has-changes");
      syaratSaveBtn.disabled = false;
    } else {
      syaratSaveBtn.textContent = "Simpan";
      syaratSaveBtn.classList.remove("has-changes");
      syaratSaveBtn.disabled = true;
    }
  }
}

// ===== RENDER LIST =====
function renderSyaratList() {
  syaratList.innerHTML = "";

  if (syaratStudents.length === 0) {
    syaratEmpty.style.display = "block";
    return;
  }

  syaratEmpty.style.display = "none";

  syaratStudents.forEach((s) => {
    const currentVal = syaratChanges.get(s.nama) || s.syarat || "BELUM";
    const isSudah = currentVal === "SUDAH";

    const item = document.createElement("div");
    item.className = "syarat-item";
    item.dataset.nama = s.nama; // store nama safely

    item.innerHTML = `
      <div class="syarat-left">
        <img class="syarat-photo" src="${s.foto || ''}" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
        <div class="syarat-photo-placeholder" style="display:none;">👤</div>
        <div class="syarat-info">
          <div class="syarat-name">${escapeHtml(s.nama)}</div>
          <div class="syarat-class">${s.kelas}</div>
        </div>
      </div>
      <div class="syarat-toggle-wrap">
        <div class="syarat-toggle-label">${isSudah ? 'SUDAH' : 'BELUM'}</div>
        <button class="syarat-toggle ${isSudah ? 'active' : ''}" 
          aria-pressed="${isSudah}">
          <div class="syarat-toggle-thumb"></div>
        </button>
      </div>
    `;

    // Attach click listener safely instead of inline onclick
    const toggleBtn = item.querySelector('.syarat-toggle');
    toggleBtn.addEventListener('click', () => toggleSyarat(s.nama));

    syaratList.appendChild(item);
  });
}

// Helper to escape HTML special chars
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ===== TOGGLE =====
function toggleSyarat(nama) {
  const student = syaratStudents.find(s => s.nama === nama);
  if (!student) return;

  const currentVal = syaratChanges.get(nama) || student.syarat || "BELUM";
  const newVal = currentVal === "SUDAH" ? "BELUM" : "SUDAH";

  // If toggling back to original sheet value, remove from changes
  if (newVal === (student.syarat || "BELUM")) {
    syaratChanges.delete(nama);
  } else {
    syaratChanges.set(nama, newVal);
  }

  renderSyaratList();
  updateSyaratStats();
}

// ===== BATCH SUBMIT =====
async function submitSyaratChanges() {
  if (syaratChanges.size === 0) {
    showStatus("Tidak ada perubahan", "info");
    return;
  }

  showLoading(true);
  if (syaratSaveBtn) {
    syaratSaveBtn.disabled = true;
    syaratSaveBtn.textContent = "Menyimpan...";
  }

  const changes = [];
  syaratChanges.forEach((syarat, nama) => {
    changes.push({ nama, syarat });
  });

  try {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({
        action: "batchUpdateSyarat",
        ekstra: currentEkstra,
        changes: changes
      })
    });

    const data = await res.json();
    if (data.status === "ok") {
      showStatus(`✓ ${data.updated} data diperbarui`, "ok");
      syaratChanges.clear();
      loadSyaratStudents(); // refresh
    } else {
      showStatus(data.message || "Gagal menyimpan", "error");
      updateSyaratStats(); // restore button
    }
  } catch (err) {
    showStatus("Error koneksi: " + err.message, "error");
    updateSyaratStats();
  }

  showLoading(false);
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
