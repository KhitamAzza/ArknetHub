// ===== DAFTAR SISWA STATE =====
let daftarStudents = [];
let daftarCurrentSort = "hadir"; // default: highest hadir
let expandedStudent = null;

// ===== DOM REFS =====
const daftarScreen = document.getElementById("daftarScreen");
const daftarList = document.getElementById("daftarList");
const daftarEmpty = document.getElementById("daftarEmpty");
const daftarStatTotal = document.getElementById("daftarStatTotal");
const daftarSortSelect = document.getElementById("daftarSortSelect");

const removeModal = document.getElementById("removeModal");
const removeStudentName = document.getElementById("removeStudentName");
const removeToggle = document.getElementById("removeToggle");
const removeToggleTrack = document.getElementById("removeToggleTrack");
const removeConfirmBtn = document.getElementById("removeConfirmBtn");

// ===== SHOW DAFTAR SCREEN =====
function showDaftarSiswa() {
  if (isMaster) {
    showStatus("MASTER tidak dapat mengakses kelola siswa", "info");
    return;
  }
  dashboardScreen.style.display = "none";
  daftarScreen.style.display = "flex";
  loadDaftarStudents();
}

function backToDashboardFromDaftar() {
  daftarScreen.style.display = "none";
  dashboardScreen.style.display = "flex";
  closeRemoveModal();
  expandedStudent = null;
}

// ===== LOAD STUDENTS =====
async function loadDaftarStudents() {
  showLoading(true);
  try {
    const res = await fetch(API_URL + "?action=getDaftarSiswa&ekstra=" + encodeURIComponent(currentEkstra));
    const data = await res.json();

    if (data.status === "ok") {
      daftarStudents = data.data || [];
      daftarCurrentSort = "hadir";
      if (daftarSortSelect) daftarSortSelect.value = "hadir";
      applySort();
      updateDaftarCount();
      renderDaftarList(); // ← ADD THIS
    } else {
      showStatus(data.message || "Gagal memuat data", "error");
    }
  } catch (err) {
    showStatus("Error koneksi: " + err.message, "error");
  }
  showLoading(false);
}

// ===== COUNT =====
function updateDaftarCount() {
  if (daftarStatTotal) daftarStatTotal.textContent = daftarStudents.length;
}

// ===== SORT =====
function handleDaftarSort() {
  daftarCurrentSort = daftarSortSelect.value;
  applySort();
  renderDaftarList();
}

function applySort() {
  const sortMap = {
    "hadir": "HADIR",
    "alpha": "ALPHA",
    "terlambat": "TERLAMBAT",
    "pagi": "PAGI",
    "kosong": "KOSONG"
  };

  const field = sortMap[daftarCurrentSort] || "HADIR";

  daftarStudents.sort((a, b) => {
    const statsA = a.stats || {};
    const statsB = b.stats || {};
    const totalA = statsA.totalDays || 1;
    const totalB = statsB.totalDays || 1;

    let valA, valB;

    if (field === "KOSONG") {
      const hadirA = statsA.HADIR || 0, alphaA = statsA.ALPHA || 0, tA = statsA.TERLAMBAT || 0, pA = statsA.PAGI || 0;
      const hadirB = statsB.HADIR || 0, alphaB = statsB.ALPHA || 0, tB = statsB.TERLAMBAT || 0, pB = statsB.PAGI || 0;
      valA = totalA - hadirA - alphaA - tA - pA;
      valB = totalB - hadirB - alphaB - tB - pB;
    } else {
      valA = statsA[field] || 0;
      valB = statsB[field] || 0;
    }

    return valB - valA; // highest first
  });
}

// ===== RENDER LIST =====
function renderDaftarList() {
  daftarList.innerHTML = "";

  if (daftarStudents.length === 0) {
    daftarEmpty.style.display = "block";
    return;
  }

  daftarEmpty.style.display = "none";

  daftarStudents.forEach((s) => {
    const isExpanded = expandedStudent && expandedStudent.nama === s.nama;
    const item = document.createElement("div");
    item.className = "daftar-item" + (isExpanded ? " expanded" : "");
    
    // Click anywhere to toggle, unless hitting detail elements
    item.onclick = (e) => {
      // Don't toggle if clicking inside detail area
      if (e.target.closest('.daftar-detail')) return;
      toggleExpandStudent(s.nama);
    };

    const stats = s.stats || {};
    const totalDays = stats.totalDays || 1;
    const hadirPct = Math.round(((stats.HADIR || 0) / totalDays) * 100);
    const alphaPct = Math.round(((stats.ALPHA || 0) / totalDays) * 100);
    const terlambatPct = Math.round(((stats.TERLAMBAT || 0) / totalDays) * 100);
    const pagiPct = Math.round(((stats.PAGI || 0) / totalDays) * 100);
    const otherPct = Math.max(0, 100 - hadirPct - alphaPct - terlambatPct - pagiPct);

    let html = `
      <div class="daftar-summary">
        <img class="daftar-photo" src="${s.foto || ''}" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
        <div class="daftar-photo-placeholder" style="display:none;">👤</div>
        <div class="daftar-info">
          <div class="daftar-name">${s.nama}</div>
          <div class="daftar-class">${s.kelas}</div>
          <div class="daftar-bar">
            ${hadirPct > 0 ? `<div class="bar-seg bar-hadir" style="width:${hadirPct}%"></div>` : ""}
            ${alphaPct > 0 ? `<div class="bar-seg bar-alpha" style="width:${alphaPct}%"></div>` : ""}
            ${terlambatPct > 0 ? `<div class="bar-seg bar-yellow" style="width:${terlambatPct}%"></div>` : ""}
            ${pagiPct > 0 ? `<div class="bar-seg bar-yellow" style="width:${pagiPct}%"></div>` : ""}
            ${otherPct > 0 ? `<div class="bar-seg bar-gray" style="width:${otherPct}%"></div>` : ""}
          </div>
        </div>

      </div>
    `;

    if (isExpanded) {
      const attendanceRows = s.attendance || [];
      let attendanceHtml = "";
      
      if (attendanceRows.length > 0) {
        attendanceRows.forEach(day => {
          const statusClass = getStatusClass(day.status);
          attendanceHtml += `
            <div class="attendance-row">
              <div class="attendance-date">${day.date}</div>
              <div class="attendance-status ${statusClass}">${day.status || "-"}</div>
            </div>
          `;
        });
      } else {
        attendanceHtml = `<div class="attendance-empty">Belum ada data absensi</div>`;
      }

      html += `
        <div class="daftar-detail">
          <div class="attendance-list">
            ${attendanceHtml}
          </div>
          <button class="btn-expel" onclick="event.stopPropagation(); openRemoveModal(daftarStudents.find(s => s.nama === '${s.nama}'))">
            <span>⚠️</span> Keluarkan dari ekskul
          </button>
        </div>
      `;
    }

    item.innerHTML = html;
    daftarList.appendChild(item);
  });
}
function getStatusClass(status) {
  const s = (status || "").trim().toUpperCase();
  if (s === "HADIR") return "status-hadir";
  if (s === "ALPHA") return "status-alpha";
  if (s === "TERLAMBAT" || s === "PAGI") return "status-yellow";
  return "status-gray";
}

function toggleExpandStudent(nama) {
  if (expandedStudent && expandedStudent.nama === nama) {
    expandedStudent = null;
  } else {
    expandedStudent = daftarStudents.find(s => s.nama === nama) || null;
  }
  renderDaftarList();
}

// ===== REMOVE MODAL =====
function openRemoveModal(student) {
  selectedStudentForRemove = student;
  removeStudentName.textContent = student.nama;
  removeToggle.checked = false;
  updateToggleVisual();
  removeConfirmBtn.disabled = true;
  removeConfirmBtn.textContent = "Geser untuk konfirmasi";
  removeModal.classList.add("visible");
}

function closeRemoveModal() {
  removeModal.classList.remove("visible");
  selectedStudentForRemove = null;
}

function updateToggleVisual() {
  if (removeToggle.checked) {
    removeToggleTrack.classList.add("active");
    removeConfirmBtn.disabled = false;
    removeConfirmBtn.textContent = "Keluarkan dari ekskul";
    removeConfirmBtn.style.background = "linear-gradient(135deg, var(--red), #dc2626)";
  } else {
    removeToggleTrack.classList.remove("active");
    removeConfirmBtn.disabled = true;
    removeConfirmBtn.textContent = "Geser untuk konfirmasi";
    removeConfirmBtn.style.background = "var(--border)";
  }
}

removeToggle.addEventListener("change", updateToggleVisual);

let toggleStartX = 0;
let toggleDragging = false;

removeToggleTrack.addEventListener("touchstart", (e) => {
  toggleStartX = e.touches[0].clientX;
  toggleDragging = true;
}, { passive: true });

removeToggleTrack.addEventListener("touchmove", (e) => {
  if (!toggleDragging) return;
  const diff = e.touches[0].clientX - toggleStartX;
  if (diff > 40) removeToggle.checked = true;
  else if (diff < -40) removeToggle.checked = false;
  updateToggleVisual();
}, { passive: true });

removeToggleTrack.addEventListener("touchend", () => { toggleDragging = false; });

removeToggleTrack.addEventListener("mousedown", (e) => {
  toggleStartX = e.clientX;
  toggleDragging = true;
});

removeToggleTrack.addEventListener("mousemove", (e) => {
  if (!toggleDragging) return;
  const diff = e.clientX - toggleStartX;
  if (diff > 40) removeToggle.checked = true;
  else if (diff < -40) removeToggle.checked = false;
  updateToggleVisual();
});

removeToggleTrack.addEventListener("mouseup", () => { toggleDragging = false; });

// ===== CONFIRM REMOVE =====
async function confirmRemoveStudent() {
  if (!selectedStudentForRemove || !removeToggle.checked) return;

  removeConfirmBtn.disabled = true;
  removeConfirmBtn.textContent = "Memproses...";
  removeToggleTrack.style.pointerEvents = "none";
  removeToggleTrack.style.opacity = "0.5";

  showLoading(true);

  try {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({
        action: "removeFromEkstra",
        nama: selectedStudentForRemove.nama,
        ekstra: currentEkstra
      })
    });

    const data = await res.json();
    if (data.status === "ok") {
      removeConfirmBtn.textContent = "✓ Berhasil";
      removeConfirmBtn.style.background = "var(--green)";
      
      setTimeout(() => {
        closeRemoveModal();
        expandedStudent = null;
        loadDaftarStudents();
        updateRegBadge();
        showStatus("✓ " + data.message, "ok");
      }, 600);
    } else {
      removeConfirmBtn.textContent = "Gagal";
      removeConfirmBtn.style.background = "var(--red)";
      
      setTimeout(() => {
        closeRemoveModal();
        showStatus(data.message || "Gagal mengeluarkan", "error");
      }, 600);
    }
  } catch (err) {
    removeConfirmBtn.textContent = "Error";
    removeConfirmBtn.style.background = "var(--red)";
    
    setTimeout(() => {
      closeRemoveModal();
      showStatus("Error koneksi", "error");
    }, 600);
  }

  showLoading(false);
}
