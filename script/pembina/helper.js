// ============================================
// helper.js — Panitia mode: Catat Keterlambatan (TELAT)
// ============================================

let helperLateStudents = [];   // {id, nama, kelas}
let todayTelatStudents = [];   // students already marked TERLAMBAT today (for the "lihat" modal)
let todayAttendanceIds = new Set(); // student ids with ANY AttendanceV2 row today (any status) — used for duplicate detection
let pendingDuplicate = null;   // {id, nama, kelas} awaiting confirmation in the "sudah didata" warning modal

// ===== STYLES (injected once — no separate CSS file for this page) =====
(function injectHelperDuplicateStyles() {
  if (document.getElementById('helperDuplicateStyles')) return;
  const style = document.createElement('style');
  style.id = 'helperDuplicateStyles';
  style.textContent = `
    .predictive-item-tagged { opacity: 0.85; }
    .pred-tag {
      display: inline-block;
      margin-top: 4px;
      padding: 2px 8px;
      border-radius: 999px;
      background: rgba(239, 68, 68, 0.15);
      color: var(--red, #ef4444);
      font-size: 11px;
      font-weight: 700;
    }
  `;
  document.head.appendChild(style);
})();

// ===== DEBOUNCE UTILITY =====
function debounce(fn, ms) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

// ===== SCREEN NAVIGATION =====
function backToHelper() {
  closeTelatModal();
  showHelperScreen();
}

// ===== CATAT KETERLAMBATAN =====
function showLateRecord() {
  hideAllScreens();
  const el = document.getElementById("lateRecordScreen");
  if (el) el.style.display = "flex";

  helperLateStudents = [];
  renderLateSelected();
  loadTodayAttendance();

  const countdownWrap = document.querySelector(".late-countdown");
  if (countdownWrap) {
    countdownWrap.innerHTML = `
      <button class="btn-primary" style="width:100%;padding:14px 16px;font-size:14px;border-radius:14px;" onclick="showTelatModal()">
        📋 Lihat Siswa TELAT Hari Ini
      </button>
    `;
  }

  const pred = document.getElementById("latePredictive");
  const list = document.getElementById("lateSelectedList");
  if (pred) {
    pred.onclick = (e) => {
      const item = e.target.closest(".predictive-item");
      if (!item) return;
      const id = item.dataset.id;
      const nama = decodeURIComponent(item.dataset.nama);
      const kelas = decodeURIComponent(item.dataset.kelas || "");
      if (item.classList.contains("predictive-item-tagged")) {
        openDuplicateWarning(id, nama, kelas);
      } else {
        addLateStudent(id, nama, kelas);
      }
    };
  }
  if (list) {
    list.onclick = (e) => {
      const btn = e.target.closest('[data-action="remove"]');
      if (!btn) return;
      const idx = parseInt(btn.dataset.idx, 10);
      if (!isNaN(idx)) {
        helperLateStudents.splice(idx, 1);
        renderLateSelected();
      }
    };
  }

  document.addEventListener("click", closePredictiveOutside);
}

function closePredictiveOutside(e) {
  const wrap = document.querySelector(".late-search-wrap");
  const pred = document.getElementById("latePredictive");
  if (wrap && pred && !wrap.contains(e.target)) {
    pred.style.display = "none";
  }
}

async function loadTodayAttendance() {
  try {
    const today = getJakartaDateString();
    const { data: attRows, error: attErr } = await sb
      .from('AttendanceV2')
      .select('student_id, status')
      .eq('date', today)
      .eq('semester', currentSemester);

    if (attErr) throw attErr;

    const rows = attRows || [];
    // Any status counts as "already recorded" — the DB's unique constraint is on
    // (student_id, date, semester) regardless of status, so this must match it.
    todayAttendanceIds = new Set(rows.map(r => r.student_id));

    const telatIds = rows.filter(r => r.status === 'TERLAMBAT').map(r => r.student_id);
    if (telatIds.length === 0) {
      todayTelatStudents = [];
      return;
    }

    const { data: students, error: sErr } = await sb
      .from('Database')
      .select('id, nama, kelas, ekstra')
      .in('id', telatIds);

    if (sErr) throw sErr;
    todayTelatStudents = students || [];
  } catch (e) {
    console.error("Failed to load today's attendance", e);
    todayAttendanceIds = new Set();
    todayTelatStudents = [];
  }
}

// ===== TELAT LIST MODAL =====
async function showTelatModal() {
  await loadTodayAttendance();

  let modal = document.getElementById("telatListModal");
  if (!modal) {
    modal = document.createElement("div");
    modal.id = "telatListModal";
    modal.className = "modal-overlay";
    modal.innerHTML = `
      <div class="modal-sheet" style="max-height:70dvh;">
        <div class="modal-header">
          <div class="modal-title">Siswa TELAT — ${getJakartaDateString()}</div>
          <button class="icon-btn" onclick="closeTelatModal()" style="width:32px;height:32px;font-size:16px;">✕</button>
        </div>
        <div class="modal-body" id="telatModalBody" style="padding:16px 20px;"></div>
        <div class="modal-footer">
          <button class="btn-secondary" onclick="closeTelatModal()">Tutup</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
  }

  const body = document.getElementById("telatModalBody");
  if (todayTelatStudents.length === 0) {
    body.innerHTML = `
      <div class="empty-state" style="padding:24px 0;">
        <div class="empty-state-icon" style="font-size:48px;">📭</div>
        <div class="empty-state-text" style="font-size:14px;">Belum ada siswa TELAT hari ini</div>
      </div>
    `;
  } else {
    body.innerHTML = todayTelatStudents.map(s => `
      <div class="summary-item" style="padding:10px 0;border-bottom:1px solid rgba(255,255,255,0.04);">
        <div class="summary-avatar" style="background:var(--bg);">👤</div>
        <div class="summary-item-name" style="font-size:14px;font-weight:600;">${escapeHtml(s.nama)}</div>
        <div class="summary-item-class" style="font-size:12px;color:var(--text-secondary);margin-left:auto;">${escapeHtml(s.kelas)} • ${escapeHtml(s.ekstra)}</div>
      </div>
    `).join('');
  }

  modal.classList.add("visible");
}

function closeTelatModal() {
  const modal = document.getElementById("telatListModal");
  if (modal) modal.classList.remove("visible");
}

// ===== "SUDAH DIDATA" DUPLICATE WARNING MODAL =====
function openDuplicateWarning(id, nama, kelas) {
  pendingDuplicate = { id, nama, kelas };

  let modal = document.getElementById("duplicateWarningModal");
  if (!modal) {
    modal = document.createElement("div");
    modal.id = "duplicateWarningModal";
    modal.className = "modal-overlay";
    modal.innerHTML = `
      <div class="modal-sheet">
        <div class="modal-header">
          <div class="modal-title">Siswa Sudah Didata</div>
          <button class="icon-btn" onclick="closeDuplicateWarning()" style="width:32px;height:32px;font-size:16px;">✕</button>
        </div>
        <div class="modal-body" id="duplicateWarningBody" style="padding:16px 20px;"></div>
        <div class="modal-footer">
          <button class="btn-secondary" onclick="closeDuplicateWarning()">Kembali</button>
          <button class="btn-primary" style="background:var(--red, #ef4444);" onclick="confirmDeleteDuplicate()">Hapus</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
  }

  const body = document.getElementById("duplicateWarningBody");
  if (body) {
    body.innerHTML = `
      <div style="font-size:14px;color:var(--text-secondary);">
        <b style="color:var(--text);">${escapeHtml(nama)}</b>${kelas ? ` (${escapeHtml(kelas)})` : ''} sudah didata. Apakah Anda ingin menghapus dari data?
      </div>
    `;
  }

  modal.classList.add("visible");
}

function closeDuplicateWarning() {
  const modal = document.getElementById("duplicateWarningModal");
  if (modal) modal.classList.remove("visible");
  pendingDuplicate = null;
}

async function confirmDeleteDuplicate() {
  if (!pendingDuplicate) return;
  const { id, nama } = pendingDuplicate;
  closeDuplicateWarning();

  const inWaitingList = helperLateStudents.some(s => s.id === id);
  const inDatabase = todayAttendanceIds.has(id);

  showLoading(true);
  try {
    if (inWaitingList) {
      helperLateStudents = helperLateStudents.filter(s => s.id !== id);
      renderLateSelected();
    }
    if (inDatabase) {
      const today = getJakartaDateString();
      const { error } = await sb.from('AttendanceV2')
        .delete()
        .eq('student_id', id)
        .eq('date', today)
        .eq('semester', currentSemester);
      if (error) throw error;
      await loadTodayAttendance();
    }
    showStatus(`✓ ${nama} dihapus dari data`, "ok");
  } catch (err) {
    showStatus("Error: " + err.message, "error");
  }
  showLoading(false);
}

// ===== SERVER-SIDE SEARCH & PREDICTIVE =====
const lateSearchInput = document.getElementById("lateSearchInput");
const latePredictive = document.getElementById("latePredictive");

const runServerSearch = debounce(async (q) => {
  try {
    const { data, error } = await sb
      .from('Database')
      .select('id, nama, kelas, ekstra')
      .ilike('nama', `%${q}%`)
      .limit(8);

    if (error) throw error;

    const matches = (data || []).slice(0, 5);

    if (!matches.length) {
      if (latePredictive) latePredictive.style.display = "none";
      return;
    }

    if (latePredictive) {
      latePredictive.innerHTML = matches.map(s => {
        // "sudah didata" = already on the waiting list OR already has any
        // AttendanceV2 row today (any status) — either would hit the duplicate error.
        const inWaitingList = helperLateStudents.some(ls => ls.id === s.id);
        const alreadyRecorded = todayAttendanceIds.has(s.id);
        const tagged = inWaitingList || alreadyRecorded;
        return `
        <div class="predictive-item${tagged ? ' predictive-item-tagged' : ''}" data-id="${s.id}" data-nama="${encodeURIComponent(s.nama)}" data-kelas="${encodeURIComponent(s.kelas || '')}">
          <div class="pred-name">${highlightMatch(escapeHtml(s.nama), q)}</div>
          <div class="pred-class">${escapeHtml(s.kelas || '')}</div>
          ${tagged ? '<span class="pred-tag">sudah didata</span>' : ''}
        </div>
      `;
      }).join("");
      latePredictive.style.display = "block";
    }
  } catch (e) {
    console.error("Search failed", e);
    if (latePredictive) latePredictive.style.display = "none";
  }
}, 250);

if (lateSearchInput) {
  lateSearchInput.addEventListener("input", (e) => {
    const q = e.target.value.trim().toLowerCase();
    if (!q) {
      if (latePredictive) latePredictive.style.display = "none";
      return;
    }
    runServerSearch(q);
  });
}

function highlightMatch(text, query) {
  const idx = text.toLowerCase().indexOf(query);
  if (idx === -1) return text;
  return text.substring(0, idx) + '<b>' + text.substring(idx, idx + query.length) + '</b>' + text.substring(idx + query.length);
}

function addLateStudent(id, nama, kelas) {
  if (helperLateStudents.find(s => s.id === id)) return;
  helperLateStudents.push({ id, nama, kelas });
  if (lateSearchInput) lateSearchInput.value = "";
  if (latePredictive) latePredictive.style.display = "none";
  renderLateSelected();
}

function renderLateSelected() {
  const list = document.getElementById("lateSelectedList");
  const empty = document.getElementById("lateEmpty");
  const saveBtn = document.getElementById("lateSaveBtn");

  if (!list) return;

  if (helperLateStudents.length === 0) {
    list.innerHTML = "";
    if (empty) empty.style.display = "block";
    if (saveBtn) saveBtn.disabled = true;
    return;
  }

  if (empty) empty.style.display = "none";
  if (saveBtn) saveBtn.disabled = false;

  list.innerHTML = helperLateStudents.map((s, idx) => `
    <div class="late-list-item">
      <div class="late-list-info">
        <div class="late-list-name">${escapeHtml(s.nama)}</div>
        <div class="late-list-class">${escapeHtml(s.kelas || '')}</div>
      </div>
      <button class="late-chip-remove" data-action="remove" data-idx="${idx}">✕</button>
    </div>
  `).join("");
}

// ===== CONFIRM & SUBMIT =====
function openLateConfirm() {
  const body = document.getElementById("lateConfirmBody");
  if (!body) return;

  body.innerHTML = `
    <div style="margin-bottom:16px;font-size:14px;color:var(--text-secondary);">
      Akan mencatat <b style="color:var(--yellow);">TELAT</b> untuk <b>${helperLateStudents.length}</b> siswa:
    </div>
    ${helperLateStudents.map(s => `
      <div class="summary-item">
        <div class="summary-avatar">👤</div>
        <div class="summary-item-name">${escapeHtml(s.nama)}</div>
        <div class="summary-item-class">${escapeHtml(s.kelas || '')}</div>
      </div>
    `).join("")}
  `;
  const modal = document.getElementById("lateConfirmModal");
  if (modal) modal.classList.add("visible");
}

function closeLateConfirm() {
  const modal = document.getElementById("lateConfirmModal");
  if (modal) modal.classList.remove("visible");
}

async function submitLateRecord() {
  closeLateConfirm();
  showLoading(true);

  try {
    const today = getJakartaDateString();
    const inserts = helperLateStudents.map(s => ({
      student_id: s.id,
      date: today,
      semester: currentSemester,
      status: 'TERLAMBAT'
    }));

    if (inserts.length > 0) {
      const { error } = await sb.from('AttendanceV2').insert(inserts);
      if (error) throw error;
    }

    showStatus(`✓ ${inserts.length} siswa dicatat TELAT`, "ok");
    helperLateStudents = [];
    renderLateSelected();
    loadTodayAttendance();
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
