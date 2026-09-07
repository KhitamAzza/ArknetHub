// ============================================
// denda.js — Penarikan Denda Siswa (Admin)
//   1) Pembayaran Denda (Admin)  — record a payment directly as admin
//   2) Denda Diterima            — confirm cash handed over by tatib
//   FAB                          — per-tatib collected/handed-over summary
// ============================================

/* ===== SHARED HELPERS ===== */
function formatRupiah(n) {
  return 'Rp ' + (n || 0).toLocaleString('id-ID');
}

// Plain YYYY-MM-DD in Asia/Jakarta — used for the `received_at` date column,
// which only needs to record *which day* a payment was received/confirmed,
// not an exact timestamp.
function todayJakarta() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date());
}

/* ===== NAVIGATION ===== */
function showPenarikanDenda() {
  hideAllScreens();
  const el = document.getElementById('penarikanDendaScreen');
  if (el) el.style.display = 'flex';
  toggleDendaFab(false);
}

function backToPenarikanDendaMenu() {
  showPenarikanDenda();
}

function toggleDendaFab(show) {
  const fab = document.getElementById('dendaFab');
  if (fab) fab.style.display = show ? 'flex' : 'none';
}

/* ===================================================
   1) ADMIN — PEMBAYARAN DENDA
   Debt formula matches tatib.js's fetchTatibDebtData() exactly:
     total = (jumlah ALPHA * dendaAlpha) + (jumlah TERLAMBAT/TELAT * dendaTerlambat)
     paid  = sum(bayardenda.amount) for this student+semester (ALL rows,
             regardless of note — a payment reduces debt the moment
             it's collected, independent of the later admin hand-over step)
     sisa  = total - paid
   =================================================== */
let dendaPaymentTarget = null;    // { id, nama, kelas, ekstra, total, paid, sisa }
let dendaPaymentDebtors = [];     // full roster of students with sisa > 0

function showAdminDendaPayment() {
  hideAllScreens();
  const el = document.getElementById('adminDendaPaymentScreen');
  if (el) {
    el.style.display = 'flex';
    initAdminDendaPayment();
  }
  toggleDendaFab(true);
}

// Mirrors tatib.js's initTatibPayment(): load every student with sisa > 0
// up front, then let the search bar filter the already-loaded list —
// same UX as the tatib payment screen, just for the admin.
async function initAdminDendaPayment() {
  const input = document.getElementById('dendaPaymentSearchInput');
  if (input) input.value = '';
  const container = document.getElementById('dendaPaymentListContainer');
  if (container) container.innerHTML = '';
  const empty = document.getElementById('dendaPaymentEmpty');
  if (empty) empty.style.display = 'none';

  showLoading(true);
  try {
    // Reuses tatib.js's fetchTatibDebtData() so the debt figures shown here
    // are guaranteed identical to the tatib payment screen — one source of truth.
    await fetchTatibDebtData();
    dendaPaymentDebtors = tatibDebtors;

    if (dendaPaymentDebtors.length === 0) {
      if (empty) {
        empty.style.display = 'flex';
        empty.querySelector('.empty-state-text').textContent = 'Tidak ada siswa dengan denda';
      }
    } else {
      renderDendaPaymentList(dendaPaymentDebtors);
    }
  } catch (err) {
    console.error(err);
    if (empty) {
      empty.style.display = 'flex';
      empty.querySelector('.empty-state-text').textContent = 'Gagal memuat data: ' + err.message;
    }
  }
  showLoading(false);
}

function renderDendaPaymentList(list) {
  const container = document.getElementById('dendaPaymentListContainer');
  if (!container) return;

  container.innerHTML = list.map(s => `
    <div class="tatib-debt-row" onclick="openAdminDendaPaymentModal('${s.id}')">
      <div class="tatib-debt-main">
        <div class="tatib-debt-name">${escapeHtml(s.nama)}</div>
        <div class="tatib-debt-class">${escapeHtml(s.kelas || '-')}</div>
      </div>
      <div class="tatib-debt-badge">
        <div class="tatib-debt-amount">${formatRupiah(s.sisa)}</div>
        <div class="tatib-debt-sub">sisa denda</div>
      </div>
    </div>
  `).join('');
}

function onDendaPaymentSearchInput() {
  const q = (document.getElementById('dendaPaymentSearchInput')?.value || '').trim().toLowerCase();
  const container = document.getElementById('dendaPaymentListContainer');
  const empty = document.getElementById('dendaPaymentEmpty');
  if (!container || !empty) return;

  const filtered = !q ? dendaPaymentDebtors : dendaPaymentDebtors.filter(s =>
    (s.nama && s.nama.toLowerCase().includes(q)) ||
    (s.kelas && s.kelas.toLowerCase().includes(q))
  );

  if (filtered.length === 0) {
    container.innerHTML = '';
    empty.style.display = 'flex';
    empty.querySelector('.empty-state-text').textContent = 'Siswa tidak ditemukan';
    return;
  }
  empty.style.display = 'none';
  renderDendaPaymentList(filtered);
}

// Mirrors tatib.js's fetchTatibDebtData(), but scoped to a single student
// (called on-demand when opening the modal) instead of the full roster.
async function calcStudentDenda(studentId) {
  const config = await loadSupabaseConfig();
  const dendaAlpha = config.dendaAlpha || 0;
  const dendaTerlambat = config.dendaTerlambat || 0;

  const { data: violations, error: vErr } = await sb
    .from('AttendanceV2')
    .select('status')
    .eq('student_id', studentId)
    .eq('semester', currentSemester)
    .in('status', ['ALPHA', 'TERLAMBAT', 'TELAT']);
  if (vErr) throw vErr;

  let alphaCount = 0, terlambatCount = 0;
  (violations || []).forEach(v => {
    const st = (v.status || '').trim().toUpperCase();
    if (st === 'ALPHA') alphaCount++;
    else terlambatCount++;
  });

  const total = (alphaCount * dendaAlpha) + (terlambatCount * dendaTerlambat);
  return { total, alphaCount, terlambatCount };
}

async function openAdminDendaPaymentModal(studentId) {
  showLoading(true);
  try {
    const { data: student, error: sErr } = await sb
      .from('Database')
      .select('id, nama, kelas, ekstra')
      .eq('id', studentId)
      .single();
    if (sErr) throw sErr;

    const [{ total }, historyRes] = await Promise.all([
      calcStudentDenda(studentId),
      sb.from('bayardenda')
        .select('id, amount, submitter, note, created_at')
        .eq('student_id', studentId)
        .eq('semester', currentSemester)
        .order('created_at', { ascending: false })
    ]);
    if (historyRes.error) throw historyRes.error;

    const rows = historyRes.data || [];
    const paid = rows.reduce((sum, r) => sum + (r.amount || 0), 0);
    const sisa = total - paid;

    dendaPaymentTarget = { ...student, total, paid, sisa };

    document.getElementById('dendaPayName').textContent = student.nama;
    document.getElementById('dendaPayClass').textContent = `${student.kelas || '-'} • ${student.ekstra || '-'}`;
    document.getElementById('dendaPayTotal').textContent = formatRupiah(total);
    document.getElementById('dendaPayPaid').textContent = formatRupiah(paid);
    document.getElementById('dendaPaySisa').textContent = formatRupiah(sisa);

    const histEl = document.getElementById('dendaPayHistory');
    histEl.innerHTML = rows.length ? rows.map(h => `
      <div class="tatib-history-item">
        <div class="tatib-history-meta">
          <span class="tatib-history-id">${escapeHtml(h.submitter || '-')}</span>
          <span class="tatib-history-date">${h.created_at ? new Date(h.created_at).toLocaleDateString('id-ID') : '-'}</span>
        </div>
        <div class="tatib-history-amount">${formatRupiah(h.amount)}</div>
        <div class="tatib-pay-hint ${h.note ? '' : 'error'}">${h.note ? escapeHtml(h.note) : 'Belum diterima admin'}</div>
      </div>
    `).join('') : `<div class="tatib-history-empty">Belum ada pembayaran</div>`;

    const amountInput = document.getElementById('dendaPayAmount');
    const hint = document.getElementById('dendaPayHint');
    if (amountInput) {
      amountInput.value = '';
      amountInput.dataset.max = sisa > 0 ? sisa : 0;
    }
    if (hint) {
      hint.textContent = 'Maksimal: ' + formatRupiah(sisa > 0 ? sisa : 0);
      hint.classList.remove('error');
    }

    document.getElementById('dendaPaymentModal').classList.add('visible');
  } catch (err) {
    showStatus('Error: ' + err.message, 'error');
  }
  showLoading(false);
}

function closeDendaPaymentModal() {
  const modal = document.getElementById('dendaPaymentModal');
  if (modal) modal.classList.remove('visible');
  dendaPaymentTarget = null;
}

function formatDendaPayInput(el) {
  const digits = el.value.replace(/\D/g, '');
  const num = parseInt(digits, 10) || 0;
  el.value = num ? 'Rp ' + num.toLocaleString('id-ID') : '';

  const max = parseInt(el.dataset.max || '0', 10);
  const hint = document.getElementById('dendaPayHint');
  if (hint && max > 0) {
    if (num > max) {
      hint.textContent = 'Jumlah melebihi sisa denda (' + formatRupiah(max) + ')';
      hint.classList.add('error');
    } else {
      hint.textContent = 'Maksimal: ' + formatRupiah(max);
      hint.classList.remove('error');
    }
  }
}

async function submitAdminDendaPayment() {
  if (!dendaPaymentTarget) return;

  const amountEl = document.getElementById('dendaPayAmount');
  const raw = (amountEl?.value || '').replace(/\D/g, '');
  const amount = parseInt(raw, 10) || 0;
  const max = parseInt(amountEl?.dataset.max || '0', 10);

  if (amount <= 0) {
    showStatus('Jumlah pembayaran harus lebih dari 0', 'error');
    return;
  }
  if (max > 0 && amount > max) {
    showStatus('Pembayaran tidak boleh melebihi sisa denda', 'error');
    return;
  }

  const btn = document.getElementById('dendaPaySubmitBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Menyimpan...'; }
  showLoading(true);

  try {
    // Admin-recorded payments are self-confirmed immediately — there is no
    // separate hand-over step, since the admin collected it directly.
    const { error } = await sb.from('bayardenda').insert({
      student_id: dendaPaymentTarget.id,
      amount: amount,
      submitter: currentOperator,
      note: `Diterima oleh ${currentOperator}`,
      received_at: todayJakarta(),
      semester: currentSemester
    });
    if (error) throw error;

    showStatus('✓ Pembayaran berhasil dicatat', 'ok');
    closeDendaPaymentModal();
    initAdminDendaPayment();
  } catch (err) {
    showStatus('Gagal menyimpan: ' + err.message, 'error');
  }

  if (btn) { btn.disabled = false; btn.textContent = 'Simpan'; }
  showLoading(false);
}

/* ===================================================
   2) DENDA DITERIMA — confirm tatib deposits
   Rows shown here are bayardenda entries where note IS NULL.
   Because admin's own payments (above) set note immediately
   on insert, only tatib-submitted, not-yet-handed-over payments
   ever appear here — no separate role check needed.
   =================================================== */
let dendaDiterimaList = [];       // grouped by student: { studentId, nama, kelas, ekstra, total, rowIds, submitters }
let dendaSelectedIds = new Set(); // selected studentIds

function showDendaDiterima() {
  hideAllScreens();
  const el = document.getElementById('dendaDiterimaScreen');
  if (el) {
    el.style.display = 'flex';
    const search = document.getElementById('dendaDiterimaSearchInput');
    if (search) search.value = '';
    dendaSelectedIds.clear();
    loadDendaDiterimaList();
  }
  toggleDendaFab(true);
}

async function loadDendaDiterimaList() {
  showLoading(true);
  try {
    const { data, error } = await sb
      .from('bayardenda')
      .select('id, student_id, amount, submitter, created_at, Database(nama, kelas, ekstra)')
      // Matches both real NULL and legacy '' notes — rows inserted before
      // this fix used note:'' instead of leaving it NULL, and those are
      // just as "not yet confirmed" as a true NULL.
      .or('note.is.null,note.eq.')
      .eq('semester', currentSemester)
      .order('created_at', { ascending: true });
    if (error) throw error;

    const grouped = {};
    (data || []).forEach(row => {
      const sid = row.student_id;
      if (!grouped[sid]) {
        grouped[sid] = {
          studentId: sid,
          nama: row.Database?.nama || '(tidak diketahui)',
          kelas: row.Database?.kelas || '-',
          ekstra: row.Database?.ekstra || '-',
          total: 0,
          rowIds: [],
          submitters: new Set()
        };
      }
      grouped[sid].total += row.amount || 0;
      grouped[sid].rowIds.push(row.id);
      if (row.submitter) grouped[sid].submitters.add(row.submitter);
    });

    dendaDiterimaList = Object.values(grouped);
    // Drop selections for students that no longer appear (already confirmed elsewhere)
    dendaSelectedIds.forEach(sid => {
      if (!grouped[sid]) dendaSelectedIds.delete(sid);
    });

    renderDendaDiterimaList(document.getElementById('dendaDiterimaSearchInput')?.value || '');
    updateDendaContextNotif();
  } catch (err) {
    showStatus('Gagal memuat data: ' + err.message, 'error');
  }
  showLoading(false);
}

function filterDendaDiterimaList() {
  renderDendaDiterimaList(document.getElementById('dendaDiterimaSearchInput')?.value || '');
}

function renderDendaDiterimaList(filterQuery = '') {
  const container = document.getElementById('dendaDiterimaListContainer');
  const empty = document.getElementById('dendaDiterimaEmpty');
  if (!container || !empty) return;

  const q = filterQuery.trim().toLowerCase();
  const items = dendaDiterimaList.filter(g =>
    !q || g.nama.toLowerCase().includes(q) || (g.kelas || '').toLowerCase().includes(q)
  );

  if (items.length === 0) {
    container.innerHTML = '';
    empty.style.display = 'flex';
    return;
  }
  empty.style.display = 'none';

  container.innerHTML = items.map(g => {
    const checked = dendaSelectedIds.has(g.studentId);
    return `
      <div class="tatib-bm-row ${checked ? 'checked' : ''}" onclick="toggleDendaSelect('${g.studentId}')">
        <div class="tatib-bm-info">
          <div class="tatib-bm-name">${escapeHtml(g.nama)}</div>
          <div class="tatib-bm-class">${escapeHtml(g.kelas)} • ${escapeHtml(g.ekstra)}</div>
          <div class="tatib-bm-badges">
            <span class="tatib-bm-badge alpha">${formatRupiah(g.total)}</span>
            <span class="tatib-bm-badge tanpa">${escapeHtml(Array.from(g.submitters).join(', '))}</span>
          </div>
        </div>
        <button class="tatib-bm-toggle ${checked ? 'checked' : ''}" onclick="event.stopPropagation();toggleDendaSelect('${g.studentId}')">
          <div class="tatib-bm-toggle-thumb"></div>
        </button>
      </div>
    `;
  }).join('');
}

function toggleDendaSelect(studentId) {
  if (dendaSelectedIds.has(studentId)) dendaSelectedIds.delete(studentId);
  else dendaSelectedIds.add(studentId);
  renderDendaDiterimaList(document.getElementById('dendaDiterimaSearchInput')?.value || '');
  updateDendaContextNotif();
}

function updateDendaContextNotif() {
  const notif = document.getElementById('dendaContextNotif');
  const countEl = document.getElementById('dendaDiterimaCount');
  const btn = document.getElementById('dendaDiterimaSubmitBtn');

  const selectedGroups = dendaDiterimaList.filter(g => dendaSelectedIds.has(g.studentId));
  const total = selectedGroups.reduce((sum, g) => sum + g.total, 0);

  if (selectedGroups.length === 0) {
    if (notif) notif.style.display = 'none';
    if (countEl) countEl.textContent = '0 dipilih';
    if (btn) btn.disabled = true;
    return;
  }

  if (notif) {
    notif.style.display = 'block';
    notif.textContent = `${selectedGroups.length} siswa • ${formatRupiah(total)} akan diterima`;
  }
  if (countEl) countEl.textContent = `${selectedGroups.length} dipilih • ${formatRupiah(total)}`;
  if (btn) btn.disabled = false;
}

async function submitDendaDiterima() {
  if (dendaSelectedIds.size === 0) return;

  const selectedGroups = dendaDiterimaList.filter(g => dendaSelectedIds.has(g.studentId));
  const allRowIds = selectedGroups.flatMap(g => g.rowIds);
  const totalAmount = selectedGroups.reduce((sum, g) => sum + g.total, 0);
  const count = selectedGroups.length;

  const btn = document.getElementById('dendaDiterimaSubmitBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Menyimpan...'; }
  showLoading(true);

  try {
    const { data: updated, error } = await sb
      .from('bayardenda')
      .update({ note: `Diterima oleh ${currentOperator}`, received_at: todayJakarta() })
      .in('id', allRowIds)
      .select('id');
    if (error) throw error;

    // Supabase returns no error even when RLS silently blocks every row —
    // it just matches 0 rows. Catch that case explicitly instead of
    // reporting success when nothing actually changed.
    if (!updated || updated.length === 0) {
      throw new Error('Tidak ada baris yang berhasil diperbarui — kemungkinan diblokir oleh RLS policy UPDATE pada tabel bayardenda.');
    }

    showStatus(`✓ ${count} siswa • ${formatRupiah(totalAmount)} ditandai diterima`, 'ok');
    dendaSelectedIds.clear();
    await loadDendaDiterimaList();
  } catch (err) {
    showStatus('Gagal menyimpan: ' + err.message, 'error');
  }

  if (btn) { btn.textContent = 'Simpan'; } // disabled state is re-derived by updateDendaContextNotif()
  showLoading(false);
}

/* ===================================================
   FAB — per-submitter collected summary, drill-down:
     Level 1 "submitters": name + grand total only
     Level 2 "days":       that submitter's days + day total
     Level 3 "payments":   that day's students + amount +
                            admin-received status (only
                            surfaced at this level)
   Includes every submitter — tatib accounts and admin's own
   direct entries alike. Admin-recorded payments are always
   self-confirmed immediately, so their days will naturally
   always show as fully "Diterima admin".
   =================================================== */
let dendaFabData = {};              // submitter -> { total, days: { dayKey: { label, total, payments } } }
let dendaFabView = 'submitters';    // 'submitters' | 'days' | 'payments'
let dendaFabSelectedSubmitter = null;
let dendaFabSelectedDay = null;

async function openDendaFabSummary() {
  showLoading(true);
  try {
    const { data, error } = await sb
      .from('bayardenda')
      .select('submitter, amount, note, created_at, Database(nama)')
      .eq('semester', currentSemester)
      .order('created_at', { ascending: false });
    if (error) throw error;

    const summary = {};
    (data || []).forEach(row => {
      if (!row.submitter) return;
      if (!summary[row.submitter]) summary[row.submitter] = { total: 0, days: {} };
      const s = summary[row.submitter];
      s.total += row.amount || 0;

      const dayKey = row.created_at
        ? new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date(row.created_at))
        : 'unknown';
      if (!s.days[dayKey]) {
        s.days[dayKey] = {
          label: row.created_at
            ? new Intl.DateTimeFormat('id-ID', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Asia/Jakarta' }).format(new Date(row.created_at))
            : 'Tanggal tidak diketahui',
          total: 0,
          payments: []
        };
      }
      s.days[dayKey].total += row.amount || 0;
      s.days[dayKey].payments.push({
        nama: row.Database?.nama || '(tidak diketahui)',
        amount: row.amount || 0,
        note: row.note || null
      });
    });

    dendaFabData = summary;
    dendaFabView = 'submitters';
    dendaFabSelectedSubmitter = null;
    dendaFabSelectedDay = null;

    renderDendaFabView();
    document.getElementById('dendaFabModal')?.classList.add('visible');
  } catch (err) {
    showStatus('Gagal memuat ringkasan: ' + err.message, 'error');
  }
  showLoading(false);
}

function renderDendaFabView() {
  const container = document.getElementById('dendaFabList');
  if (!container) return;

  if (dendaFabView === 'days') return renderDendaFabDaysView(container);
  if (dendaFabView === 'payments') return renderDendaFabPaymentsView(container);
  return renderDendaFabSubmittersView(container);
}

// Level 1: names + grand total only — no diserahkan/belum breakdown here.
function renderDendaFabSubmittersView(container) {
  const names = Object.keys(dendaFabData);
  if (names.length === 0) {
    container.innerHTML = `<div class="tatib-history-empty" style="padding:24px;">Belum ada setoran tatib</div>`;
    return;
  }
  container.innerHTML = names.map(name => `
    <div class="tatib-debt-row" onclick="openDendaFabSubmitter('${encodeURIComponent(name)}')">
      <div class="tatib-debt-main">
        <div class="tatib-debt-name">${escapeHtml(name)}</div>
      </div>
      <div class="tatib-debt-badge">
        <div class="tatib-debt-amount" style="color:var(--text)">${formatRupiah(dendaFabData[name].total)}</div>
      </div>
    </div>
  `).join('');
}

function openDendaFabSubmitter(encodedName) {
  dendaFabSelectedSubmitter = decodeURIComponent(encodedName);
  dendaFabView = 'days';
  renderDendaFabView();
}

// Level 2: that tatib's days + day total.
function renderDendaFabDaysView(container) {
  const s = dendaFabData[dendaFabSelectedSubmitter];
  if (!s) { dendaFabView = 'submitters'; return renderDendaFabView(); }

  const dayKeys = Object.keys(s.days).sort((a, b) => b.localeCompare(a));

  const rows = dayKeys.map(dayKey => {
    const d = s.days[dayKey];
    const allHanded = d.payments.length > 0 && d.payments.every(p => p.note);
    return `
      <div class="tatib-debt-row" onclick="openDendaFabDay('${dayKey}')">
        <div class="tatib-debt-main">
          <div class="tatib-debt-name">${escapeHtml(d.label)}</div>
        </div>
        <div class="tatib-debt-badge">
          <div class="tatib-debt-amount" style="color:var(--text)">${formatRupiah(d.total)}</div>
          <div class="denda-fab-payment-status ${allHanded ? 'confirmed' : 'pending'}" style="margin-top:4px; display:inline-block;">
            ${allHanded ? 'Diterima admin' : 'Belum diserahkan'}
          </div>
        </div>
      </div>
    `;
  }).join('') || `<div class="tatib-history-empty" style="padding:24px;">Belum ada setoran</div>`;

  container.innerHTML = `
    <div class="denda-fab-back" onclick="backDendaFabToSubmitters()">‹ Semua Tatib</div>
    <div class="denda-fab-header-title">${escapeHtml(dendaFabSelectedSubmitter)}</div>
    ${rows}
  `;
}

function backDendaFabToSubmitters() {
  dendaFabView = 'submitters';
  dendaFabSelectedSubmitter = null;
  renderDendaFabView();
}

function openDendaFabDay(dayKey) {
  dendaFabSelectedDay = dayKey;
  dendaFabView = 'payments';
  renderDendaFabView();
}

// Level 3: that day's students + amount + admin-received status.
// This is the only level where the confirmed/pending badge shows.
function renderDendaFabPaymentsView(container) {
  const s = dendaFabData[dendaFabSelectedSubmitter];
  const day = s?.days?.[dendaFabSelectedDay];
  if (!day) { dendaFabView = 'days'; return renderDendaFabView(); }

  const isToday = dendaFabSelectedDay === todayJakarta();
  const allHanded = day.payments.length > 0 && day.payments.every(p => p.note);
  const doneBanner = (isToday && allHanded)
    ? `<div class="denda-fab-done-banner">✓ Setoran hari ini sudah diterima admin</div>`
    : '';

  const rows = day.payments.map(p => `
    <div class="denda-fab-payment">
      <span class="denda-fab-payment-name">${escapeHtml(p.nama)}</span>
      <span class="denda-fab-payment-amount">${formatRupiah(p.amount)}</span>
      <span class="denda-fab-payment-status ${p.note ? 'confirmed' : 'pending'}">
        ${p.note ? 'Diterima admin' : 'Belum diserahkan'}
      </span>
    </div>
  `).join('');

  container.innerHTML = `
    <div class="denda-fab-back" onclick="backDendaFabToDays()">‹ ${escapeHtml(dendaFabSelectedSubmitter)}</div>
    <div class="denda-fab-header-title">${escapeHtml(day.label)} • ${formatRupiah(day.total)}</div>
    ${doneBanner}
    ${rows}
  `;
}

function backDendaFabToDays() {
  dendaFabView = 'days';
  dendaFabSelectedDay = null;
  renderDendaFabView();
}

function closeDendaFabModal() {
  document.getElementById('dendaFabModal')?.classList.remove('visible');
  // Reset to top level so it doesn't reopen mid-drill-down next time.
  dendaFabView = 'submitters';
  dendaFabSelectedSubmitter = null;
  dendaFabSelectedDay = null;
}