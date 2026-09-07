// ===== DAFTAR SISWA STATE =====
let daftarStudents = [];
let daftarCurrentSort = "hadir";
let expandedStudent = null;
let selectedStudentForRemove = null;

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
const removeReasonInput = document.getElementById("removeReasonInput"); // ← NEW

// ===== SHOW / BACK =====
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

// ===== LOAD, SORT, RENDER (unchanged from before) =====
async function loadDaftarStudents() {
  showLoading(true);
  try {
    const { data: students, error: studentError } = await sb
      .from('Database')
      .select('id, nama, kelas, ekstra, photo_url')
      .eq('ekstra', currentEkstra);
    
    if (studentError) throw studentError;
    const studentList = students || [];
    
    let attendanceMap = {};
    if (studentList.length > 0) {
      const studentIds = studentList.map(s => s.id);
            const { data: attendance, error: attError } = await sb
        .from('AttendanceV2')
        .select('student_id, date, status')
        .in('student_id', studentIds)
        .order('date', { ascending: false });
      
      if (attError) throw attError;
      (attendance || []).forEach(a => {
        if (!attendanceMap[a.student_id]) attendanceMap[a.student_id] = [];
        attendanceMap[a.student_id].push({ date: a.date, status: a.status || "-" });
      });
    }

    daftarStudents = studentList.map(s => {
      const att = attendanceMap[s.id] || [];
      const stats = { HADIR: 0, ALPHA: 0, TERLAMBAT: 0, PAGI: 0, totalDays: att.length };
      att.forEach(day => {
        const st = (day.status || "").toUpperCase();
        if (st === "HADIR") stats.HADIR++;
        else if (st === "ALPHA") stats.ALPHA++;
        else if (st === "TERLAMBAT") stats.TERLAMBAT++;
        else if (st === "PAGI") stats.PAGI++;
      });
      if (stats.totalDays === 0) stats.totalDays = 1;
      return { id: s.id, nama: s.nama, kelas: s.kelas, ekstra: s.ekstra, foto: s.photo_url, stats, attendance: att };
    });

    daftarCurrentSort = "hadir";
    if (daftarSortSelect) daftarSortSelect.value = "hadir";
    applySort();
    updateDaftarCount();
    renderDaftarList();
  } catch (err) {
    showStatus("Error memuat data: " + err.message, "error");
  }
  showLoading(false);
}

function updateDaftarCount() {
  if (daftarStatTotal) daftarStatTotal.textContent = daftarStudents.length;
}

function handleDaftarSort() {
  daftarCurrentSort = daftarSortSelect.value;
  applySort();
  renderDaftarList();
}

function applySort() {
  const sortMap = { "hadir": "HADIR", "alpha": "ALPHA", "terlambat": "TERLAMBAT", "pagi": "PAGI", "kosong": "KOSONG" };
  const field = sortMap[daftarCurrentSort] || "HADIR";
  daftarStudents.sort((a, b) => {
    const statsA = a.stats || {}, statsB = b.stats || {};
    const totalA = statsA.totalDays || 1, totalB = statsB.totalDays || 1;
    let valA, valB;
    if (field === "KOSONG") {
      const hadirA = statsA.HADIR||0, alphaA = statsA.ALPHA||0, tA = statsA.TERLAMBAT||0, pA = statsA.PAGI||0;
      const hadirB = statsB.HADIR||0, alphaB = statsB.ALPHA||0, tB = statsB.TERLAMBAT||0, pB = statsB.PAGI||0;
      valA = totalA - hadirA - alphaA - tA - pA;
      valB = totalB - hadirB - alphaB - tB - pB;
    } else {
      valA = statsA[field] || 0; valB = statsB[field] || 0;
    }
    return valB - valA;
  });
}

function renderDaftarList() {
  daftarList.innerHTML = "";
  if (daftarStudents.length === 0) { daftarEmpty.style.display = "block"; return; }
  daftarEmpty.style.display = "none";

  daftarStudents.forEach((s) => {
    const isExpanded = expandedStudent && expandedStudent.nama === s.nama;
    const item = document.createElement("div");
    item.className = "daftar-item" + (isExpanded ? " expanded" : "");
    item.onclick = (e) => { if (e.target.closest('.daftar-detail')) return; toggleExpandStudent(s.nama); };

    const stats = s.stats || {};
    const totalDays = stats.totalDays || 1;
    const hadirPct = Math.round(((stats.HADIR||0)/totalDays)*100);
    const alphaPct = Math.round(((stats.ALPHA||0)/totalDays)*100);
    const terlambatPct = Math.round(((stats.TERLAMBAT||0)/totalDays)*100);
    const pagiPct = Math.round(((stats.PAGI||0)/totalDays)*100);
    const otherPct = Math.max(0, 100 - hadirPct - alphaPct - terlambatPct - pagiPct);

    let html = `
      <div class="daftar-summary">
        <img class="daftar-photo" src="${s.foto||''}" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
        <div class="daftar-photo-placeholder" style="display:none;">👤</div>
        <div class="daftar-info">
          <div class="daftar-name">${escapeHtml(s.nama)}</div>
          <div class="daftar-class">${s.kelas}</div>
          <div class="daftar-bar">
            ${hadirPct>0?`<div class="bar-seg bar-hadir" style="width:${hadirPct}%"></div>`:""}
            ${alphaPct>0?`<div class="bar-seg bar-alpha" style="width:${alphaPct}%"></div>`:""}
            ${terlambatPct>0?`<div class="bar-seg bar-yellow" style="width:${terlambatPct}%"></div>`:""}
            ${pagiPct>0?`<div class="bar-seg bar-yellow" style="width:${pagiPct}%"></div>`:""}
            ${otherPct>0?`<div class="bar-seg bar-gray" style="width:${otherPct}%"></div>`:""}
          </div>
        </div>
      </div>`;

    if (isExpanded) {
      const rows = s.attendance || [];
      const attHtml = rows.length ? rows.map(day => {
        const sc = getStatusClass(day.status);
        return `<div class="attendance-row"><div class="attendance-date">${day.date}</div><div class="attendance-status ${sc}">${day.status||"-"}</div></div>`;
      }).join('') : `<div class="attendance-empty">Belum ada data absensi</div>`;

      html += `
        <div class="daftar-detail">
          <div class="attendance-list">${attHtml}</div>
          <button class="btn-expel" data-nama="${encodeURIComponent(s.nama)}"><span>⚠️</span> Keluarkan dari ekskul</button>
        </div>`;
    }

    item.innerHTML = html;
    const expelBtn = item.querySelector('.btn-expel');
    if (expelBtn) {
      expelBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const nama = decodeURIComponent(expelBtn.dataset.nama);
        const st = daftarStudents.find(x => x.nama === nama);
        if (st) openRemoveModal(st);
      });
    }
    daftarList.appendChild(item);
  });
}

function getStatusClass(status) {
  const s = (status||"").trim().toUpperCase();
  if (s==="HADIR") return "status-hadir";
  if (s==="ALPHA") return "status-alpha";
  if (s==="TERLAMBAT"||s==="PAGI") return "status-yellow";
  return "status-gray";
}

function toggleExpandStudent(nama) {
  expandedStudent = (expandedStudent && expandedStudent.nama === nama) ? null : daftarStudents.find(s=>s.nama===nama)||null;
  renderDaftarList();
}

// ===== REMOVE MODAL (with reason) =====
function openRemoveModal(student) {
  selectedStudentForRemove = student;
  removeStudentName.textContent = student.nama;
  removeToggle.checked = false;
  if (removeReasonInput) { removeReasonInput.value = ""; removeReasonInput.style.borderColor = ""; }
  updateToggleVisual();
  removeModal.classList.add("visible");
  setTimeout(() => removeReasonInput?.focus(), 100);
}

function closeRemoveModal() {
  removeModal.classList.remove("visible");
  selectedStudentForRemove = null;
  expandedStudent = null;
  if (removeToggleTrack) { removeToggleTrack.style.pointerEvents = ""; removeToggleTrack.style.opacity = ""; }
  if (removeConfirmBtn) removeConfirmBtn.style.background = "";
  if (removeReasonInput) removeReasonInput.style.borderColor = "";
}

// NEW: button state now checks BOTH toggle AND reason
function updateRemoveButtonState() {
  const hasReason = removeReasonInput && removeReasonInput.value.trim().length > 0;
  const isToggled = removeToggle.checked;

  if (isToggled && hasReason) {
    removeConfirmBtn.disabled = false;
    removeConfirmBtn.textContent = "Keluarkan dari ekskul";
    removeConfirmBtn.style.background = "linear-gradient(135deg, var(--red), #dc2626)";
  } else {
    removeConfirmBtn.disabled = true;
    removeConfirmBtn.textContent = isToggled ? "Isi alasan pengeluaran" : "Geser untuk konfirmasi";
    removeConfirmBtn.style.background = "var(--border)";
  }

  if (removeReasonInput) {
    removeReasonInput.style.borderColor = (isToggled && !hasReason) ? "var(--red)" : "";
  }
}

function updateToggleVisual() {
  removeToggleTrack.classList.toggle("active", removeToggle.checked);
  updateRemoveButtonState();
}

removeToggle.addEventListener("change", updateToggleVisual);
if (removeReasonInput) removeReasonInput.addEventListener("input", updateRemoveButtonState);

let toggleStartX = 0, toggleDragging = false;
removeToggleTrack.addEventListener("touchstart", (e) => { toggleStartX = e.touches[0].clientX; toggleDragging = true; }, { passive: true });
removeToggleTrack.addEventListener("touchmove", (e) => {
  if (!toggleDragging) return;
  const diff = e.touches[0].clientX - toggleStartX;
  if (diff > 40) removeToggle.checked = true; else if (diff < -40) removeToggle.checked = false;
  updateToggleVisual();
}, { passive: true });
removeToggleTrack.addEventListener("touchend", () => { toggleDragging = false; });
removeToggleTrack.addEventListener("mousedown", (e) => { toggleStartX = e.clientX; toggleDragging = true; });
removeToggleTrack.addEventListener("mousemove", (e) => {
  if (!toggleDragging) return;
  const diff = e.clientX - toggleStartX;
  if (diff > 40) removeToggle.checked = true; else if (diff < -40) removeToggle.checked = false;
  updateToggleVisual();
});
removeToggleTrack.addEventListener("mouseup", () => { toggleDragging = false; });

// ===== CONFIRM REMOVE (with alasan) =====
async function confirmRemoveStudent() {
  if (!selectedStudentForRemove || !removeToggle.checked) return;

  const reason = removeReasonInput ? removeReasonInput.value.trim() : "";
  if (!reason) {
    showStatus("Alasan pengeluaran wajib diisi", "error");
    if (removeReasonInput) { removeReasonInput.focus(); removeReasonInput.style.borderColor = "var(--red)"; }
    return;
  }

  removeConfirmBtn.disabled = true;
  removeConfirmBtn.textContent = "Memproses...";
  removeToggleTrack.style.pointerEvents = "none";
  removeToggleTrack.style.opacity = "0.5";

  showLoading(true);
  try {
    const { error: dbError } = await sb.from('Database').update({ ekstra: '0' }).eq('id', selectedStudentForRemove.id);
    if (dbError) throw dbError;

    const { error: regError } = await sb.from('registrations').insert({
      student_id: selectedStudentForRemove.id,
      nama: selectedStudentForRemove.nama,
      kelas: selectedStudentForRemove.kelas,
      ekstra: currentEkstra,
      status: 'expelled',
      alasan: reason,                 // ← SAVED HERE
      operator: currentOperator,
      processed_at: new Date().toISOString()
    });
    if (regError) throw regError;

    removeConfirmBtn.textContent = "✓ Berhasil";
    removeConfirmBtn.style.background = "var(--green)";
    setTimeout(() => {
      closeRemoveModal();
      loadDaftarStudents();
      updateRegBadge();
      clearBundle();
      showStatus("✓ Siswa dikeluarkan dari ekskul", "ok");
    }, 600);
  } catch (err) {
    removeConfirmBtn.textContent = "Error";
    removeConfirmBtn.style.background = "var(--red)";
    setTimeout(() => { closeRemoveModal(); showStatus("Error: " + err.message, "error"); }, 600);
  }
  showLoading(false);
}