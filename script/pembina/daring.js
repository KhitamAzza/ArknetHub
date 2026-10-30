// ============================================
// daring.js — Pembina: Absensi Mode Daring
// No photo upload. Pembina marks HADIR / ALPHA (or leaves blank)
// straight into AttendanceV2, same table admin input writes to.
// ============================================

const DARING_STATUSES = ['', 'HADIR', 'ALPHA']; // tap cycle order
let daringStudents = [];
let daringChanges = new Map();   // student_id -> 'HADIR' | 'ALPHA' | ''
let daringWindow = { start: 0, end: 24 };

// Small helper (also used by admin input to hide the proof photo pane)
async function fetchDaringMode() {
  try {
    const { data, error } = await sb.from('Config').select('daring_mode').eq('id', 1).single();
    if (error) throw error;
    return data.daring_mode === true;
  } catch (e) {
    return false;
  }
}

// ===== ENTRY POINT (dashboard button) =====
// Reads Config fresh so a toggle made by admin applies without re-login.
async function openAbsensiPembina() {
  let daring = false;
  showLoading(true);
  try {
    const { data, error } = await sb
      .from('Config')
      .select('daring_mode, mulai_pengumpulan, batas_pengumpulan_absensi')
      .eq('id', 1)
      .single();
    if (error) throw error;
    daring = data.daring_mode === true;
    daringWindow = {
      start: data.mulai_pengumpulan ?? 0,
      end: data.batas_pengumpulan_absensi ?? 24
    };
    if (window.appConfig) window.appConfig.daringMode = daring;
  } catch (e) {
    daring = false; // fail safe: fall back to the normal photo flow
  }
  showLoading(false);

  if (daring) showDaringScreen();
  else showPaperScreen();
}

// Label on the dashboard button follows the cached config.
function applyAbsensiModeLabel() {
  const el = document.getElementById('paperDashLabel');
  if (!el) return;
  const daring = !!(window.appConfig && window.appConfig.daringMode);
  el.textContent = daring ? 'Absensi Daring' : 'Upload Absensi';
}

// ===== SCREEN =====
function showDaringScreen() {
  hideAllScreens();
  const el = document.getElementById('daringScreen');
  if (el) {
    el.style.display = 'flex';
    initDaring();
  }
}

async function initDaring() {
  daringChanges.clear();
  const label = document.getElementById('daringEkstraLabel');
  if (label) label.textContent = currentEkstra || '-';
  renderDaringWindowNote();
  await loadDaringList();
}

function isDaringWindowOpen() {
  const now = new Date();
  const jh = parseInt(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Jakarta', hour: 'numeric', hour12: false }).format(now));
  const jm = parseInt(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Jakarta', minute: 'numeric' }).format(now));
  const tv = jh + (jm / 100);
  return tv >= daringWindow.start && tv <= daringWindow.end;
}

function renderDaringWindowNote() {
  const el = document.getElementById('daringWindowNote');
  if (!el) return;
  const open = isDaringWindowOpen();
  el.textContent = open
    ? `Input absensi dibuka sampai ${decimalToTime(daringWindow.end)} WIB`
    : `Input absensi hanya pukul ${decimalToTime(daringWindow.start)} - ${decimalToTime(daringWindow.end)} WIB`;
  el.style.color = open ? 'var(--text-secondary)' : 'var(--red, #e53935)';
}

// ===== LOAD =====
async function loadDaringList() {
  if (!currentEkstra) return;
  showLoading(true);
  try {
    const today = getJakartaDateString();

    const { data: students, error: sErr } = await sb
      .from('Database')
      .select('id, nama, kelas')
      .eq('ekstra', currentEkstra)
      .order('nama');
    if (sErr) throw sErr;

    const { data: att, error: aErr } = await sb
      .from('AttendanceV2')
      .select('student_id, status, locked_by')
      .eq('date', today)
      .eq('semester', currentSemester);
    if (aErr) throw aErr;

    const attMap = {};
    (att || []).forEach(a => { attMap[a.student_id] = a; });

    daringStudents = (students || []).map(s => {
      const a = attMap[s.id];
      return {
        id: s.id,
        nama: s.nama,
        kelas: s.kelas,
        currentStatus: a ? (a.status || '') : '',
        lockedBy: a ? (a.locked_by || null) : null
      };
    });
    daringChanges.clear();
    renderDaringList();
    updateDaringStats();
  } catch (err) {
    showStatus('Error: ' + err.message, 'error');
  }
  showLoading(false);
}

// Read-only for the pembina when the status isn't theirs to set:
//  - anything other than HADIR/ALPHA (TERLAMBAT, PAGI, IZIN, SAKIT, ...)
//  - helper/Fixer wrote a non-HADIR status (locked_by set)
// Only admin can change those.
function isDaringLocked(s) {
  const cur = (s.currentStatus || '').trim().toUpperCase();
  if (cur === '') return false;
  if (cur !== 'HADIR' && cur !== 'ALPHA') return true;
  if (s.lockedBy && cur !== 'HADIR') return true;
  return false;
}

// ===== RENDER =====
function renderDaringList() {
  const container = document.getElementById('daringList');
  if (!container) return;

  if (daringStudents.length === 0) {
    container.innerHTML = '<div class="empty-state" style="padding-top:40px;"><div class="empty-state-icon">📭</div><div class="empty-state-text">Tidak ada siswa</div></div>';
    return;
  }

  container.innerHTML = daringStudents.map((s, i) => {
    const changed = daringChanges.get(s.id);
    const status = changed !== undefined ? changed : (s.currentStatus || '');
    const locked = isDaringLocked(s);
    const statusClass = getAdminStatusClass(status);
    const safeId = String(s.id).replace(/'/g, "\\'");

    return `
      <div class="admin-input-row${locked ? ' locked' : ''}" data-id="${escapeHtml(String(s.id))}"
           onclick="cycleDaringStatus('${safeId}')">
        <div class="admin-input-num">${i + 1}</div>
        <div class="admin-input-info">
          <div class="admin-input-name">${escapeHtml(s.nama)}</div>
          <div class="admin-input-class">${escapeHtml(s.kelas)}</div>
        </div>
        <div class="admin-input-status ${statusClass}">${escapeHtml(status || 'KOSONG')}</div>
        ${locked ? '<span aria-label="Terkunci" style="margin-left:8px;">🔒</span>' : ''}
      </div>
    `;
  }).join('');
}

// ===== EDIT =====
function cycleDaringStatus(id) {
  const s = daringStudents.find(x => String(x.id) === String(id));
  if (!s) return;
  if (isDaringLocked(s)) {
    showStatus('Status ini hanya bisa diubah admin', 'info');
    return;
  }
  const changed = daringChanges.get(s.id);
  const cur = changed !== undefined ? changed : (s.currentStatus || '');
  const next = DARING_STATUSES[(DARING_STATUSES.indexOf(cur) + 1) % DARING_STATUSES.length];

  if (next === (s.currentStatus || '')) daringChanges.delete(s.id);
  else daringChanges.set(s.id, next);

  renderDaringList();
  updateDaringStats();
}

function markAllDaringHadir() {
  let skipped = 0;
  daringStudents.forEach(s => {
    if (isDaringLocked(s)) { skipped++; return; }
    if ((s.currentStatus || '') !== 'HADIR') daringChanges.set(s.id, 'HADIR');
    else daringChanges.delete(s.id);
  });
  renderDaringList();
  updateDaringStats();
  if (skipped > 0) showStatus(`${skipped} siswa dilewati (status terkunci)`, 'info');
}

function updateDaringStats() {
  const count = daringChanges.size;
  const btn = document.getElementById('daringSaveBtn');
  const label = document.getElementById('daringChangeCount');
  if (btn) { btn.disabled = count === 0; btn.textContent = count > 0 ? `Simpan (${count})` : 'Simpan'; }
  if (label) label.textContent = `${count} perubahan`;
}

// ===== SAVE =====
async function submitDaring() {
  if (daringChanges.size === 0) return;

  // Same submit window as the photo upload (Config.mulai_pengumpulan / batas_pengumpulan_absensi)
  if (!isDaringWindowOpen()) {
    renderDaringWindowNote();
    showStatus(`Input absensi hanya diperbolehkan pukul ${decimalToTime(daringWindow.start)} - ${decimalToTime(daringWindow.end)} WIB`, 'error');
    return;
  }

  const today = getJakartaDateString();
  showLoading(true);
  try {
    const upserts = [];
    const toDelete = [];
    daringChanges.forEach((status, id) => {
      const s = daringStudents.find(x => x.id === id);
      if (!s || isDaringLocked(s)) return; // never touch locked rows
      if (status === 'HADIR' || status === 'ALPHA') {
        upserts.push({ student_id: id, date: today, status, semester: currentSemester, operator: currentOperator, locked_by: null });
      } else {
        toDelete.push(id);
      }
    });

    if (upserts.length) {
      const { error } = await sb.from('AttendanceV2').upsert(upserts, { onConflict: 'student_id,date,semester' });
      if (error) throw error;
    }
    if (toDelete.length) {
      const { error } = await sb.from('AttendanceV2').delete()
        .eq('date', today).eq('semester', currentSemester).in('student_id', toDelete);
      if (error) throw error;
    }

    showStatus(`✓ ${upserts.length + toDelete.length} data tersimpan`, 'ok');
    daringChanges.clear();
    await loadDaringList();
  } catch (err) {
    showStatus('Error: ' + err.message, 'error');
  }
  showLoading(false);
}
