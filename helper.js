// ============================================
// helper.js — Panitia mode: Catat Keterlambatan (TELAT)
// ============================================

let helperLateStudents = [];   // {nama, kelas}
let todayTelatStudents = [];   // students already marked TELAT today

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
  loadTelatStudents();

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
      const nama = decodeURIComponent(item.dataset.nama);
      const kelas = decodeURIComponent(item.dataset.kelas || "");
      addLateStudent(nama, kelas);
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

async function loadTelatStudents() {
  try {
    const today = getJakartaDateString();
    const { data: attRows, error: attErr } = await sb
      .from('Attendance')
      .select('student_id')
      .eq('date', today)
      .eq('semester', currentSemester)
      .eq('status', 'TELAT');

    if (attErr) throw attErr;

    const telatIds = (attRows || []).map(d => d.student_id);
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
    console.error("Failed to load TELAT students", e);
    todayTelatStudents = [];
  }
}

// ===== TELAT LIST MODAL =====
async function showTelatModal() {
  await loadTelatStudents();

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

    // Client-side exclude: already selected or already TELAT today
    const matches = (data || []).filter(s =>
      !helperLateStudents.find(ls => ls.nama === s.nama) &&
      !todayTelatStudents.find(ts => ts.id === s.id)
    ).slice(0, 5);

    if (!matches.length) {
      if (latePredictive) latePredictive.style.display = "none";
      return;
    }

    if (latePredictive) {
      latePredictive.innerHTML = matches.map(s => `
        <div class="predictive-item" data-nama="${encodeURIComponent(s.nama)}" data-kelas="${encodeURIComponent(s.kelas || '')}">
          <div class="pred-name">${highlightMatch(escapeHtml(s.nama), q)}</div>
          <div class="pred-class">${escapeHtml(s.kelas || '')}</div>
        </div>
      `).join("");
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

function addLateStudent(nama, kelas) {
  if (helperLateStudents.find(s => s.nama === nama)) return;
  helperLateStudents.push({ nama, kelas });
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
    const inserts = [];

    for (const s of helperLateStudents) {
      const { data: found } = await sb.from('Database')
        .select('id')
        .eq('nama', s.nama)
        .maybeSingle();

      if (found) {
        inserts.push({
          student_id: found.id,
          date: today,
          period: 'PAGI',
          semester: currentSemester,
          status: 'TELAT'
        });
      }
    }

    if (inserts.length > 0) {
      const { error } = await sb.from('Attendance').insert(inserts);
      if (error) throw error;
    }

    showStatus(`✓ ${inserts.length} siswa dicatat TELAT`, "ok");
    helperLateStudents = [];
    renderLateSelected();
    loadTelatStudents();
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