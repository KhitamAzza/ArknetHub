// ============================================
// tatib.js — Tatib: Payment + Heatmap (Supabase)
// ============================================

let tatibDebtors = [];
let tatibSelectedDebtor = null;
let tatibIsBackgroundRefreshing = false;

let tatibHeatmapData = null;
let tatibHeatmapMode = "kelas";
let tatibBmFilterMode = 'all';

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text || "";
  return div.innerHTML;
}

function formatTatibDate(isoString) {
  if (!isoString) return "-";
  const d = new Date(isoString);
  const fmt = new Intl.DateTimeFormat("id-ID", {
    day: "numeric", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
    timeZone: "Asia/Jakarta"
  });
  return fmt.format(d);
}

/* ===== DASHBOARD ===== */
function showTatibScreen() {
  hideAllScreens();
  const el = document.getElementById("tatibScreen");
  if (el) {
    el.style.display = "flex";
    const nameEl = document.getElementById("tatibName");
    if (nameEl) nameEl.textContent = currentOperator || "Tatib";
  }
}

function backToTatib() {
  hideAllScreens();
  showTatibScreen();
}

/* ===== PAYMENT FULL PAGE ===== */
function showTatibPayment() {
  hideAllScreens();
  const el = document.getElementById("tatibPaymentScreen");
  if (el) {
    el.style.display = "flex";
    initTatibPayment();
  }
}

async function initTatibPayment() {
  const container = document.getElementById("tatibDebtListContainer");
  const empty = document.getElementById("tatibDebtEmpty");
  const searchInput = document.getElementById("tatibSearchInput");

  if (container) container.innerHTML = "";
  if (empty) empty.style.display = "none";
  if (searchInput) searchInput.value = "";

  showLoading(true);

  try {
    await fetchTatibDebtData();
    if (tatibDebtors.length === 0) {
      if (empty) empty.style.display = "block";
    } else {
      renderTatibDebtorList(tatibDebtors);
    }
  } catch (err) {
    console.error(err);
    if (empty) {
      empty.style.display = "block";
      const txt = empty.querySelector(".empty-state-text");
      if (txt) txt.textContent = "Gagal memuat data: " + err.message;
    }
  }

  showLoading(false);
}

/* ===== DEBT CALCULATION (Supabase) ===== */
async function fetchTatibDebtData() {
  const config = await loadSupabaseConfig();
  const dendaAlpha = config.dendaAlpha || 0;
  const dendaTerlambat = config.dendaTerlambat || 0;

  const { data: students, error: sErr } = await sb
    .from('Database')
    .select('id, nama, kelas, ekstra, photo_url');
  if (sErr) throw new Error("Gagal memuat database: " + sErr.message);

    const { data: violations, error: vErr } = await sb
    .from('AttendanceV2')  // was Attendance
    .select('student_id, status')
    .eq('semester', currentSemester)
    .in('status', ['ALPHA', 'TERLAMBAT', 'TELAT']);
  if (vErr) throw new Error("Gagal memuat pelanggaran: " + vErr.message);

  const { data: payments, error: pErr } = await sb
    .from('bayardenda')
    .select('student_id, amount')
    .eq('semester', currentSemester);
  if (pErr) throw new Error("Gagal memuat pembayaran: " + pErr.message);

  const violationCounts = {};
  (violations || []).forEach(v => {
    if (!violationCounts[v.student_id]) {
      violationCounts[v.student_id] = { alpha: 0, terlambat: 0 };
    }
    const st = (v.status || '').trim().toUpperCase();
    if (st === 'ALPHA') {
      violationCounts[v.student_id].alpha++;
    } else {
      violationCounts[v.student_id].terlambat++;
    }
  });

  const paymentSums = {};
  (payments || []).forEach(p => {
    paymentSums[p.student_id] = (paymentSums[p.student_id] || 0) + (p.amount || 0);
  });

  const debtors = [];
  (students || []).forEach(s => {
    const v = violationCounts[s.id] || { alpha: 0, terlambat: 0 };
    const total = (v.alpha * dendaAlpha) + (v.terlambat * dendaTerlambat);
    const paid = paymentSums[s.id] || 0;
    const sisa = total - paid;

    if (sisa > 0) {
      debtors.push({
        id: s.id,
        nama: s.nama,
        kelas: s.kelas,
        ekstra: s.ekstra,
        photo_url: s.photo_url,
        total: total,
        paid: paid,
        sisa: sisa,
        alphaCount: v.alpha,
        terlambatCount: v.terlambat
      });
    }
  });

  debtors.sort((a, b) => b.sisa - a.sisa);
  tatibDebtors = debtors;
}

function renderTatibDebtorList(list) {
  const container = document.getElementById("tatibDebtListContainer");
  if (!container) return;

  container.innerHTML = list.map((s) => `
    <div class="tatib-debt-row" onclick="openTatibDebtorModal('${encodeURIComponent(s.nama)}')">
      <div class="tatib-debt-main">
        <div class="tatib-debt-name">${escapeHtml(s.nama)}</div>
        <div class="tatib-debt-class">${escapeHtml(s.kelas)}</div>
      </div>
      <div class="tatib-debt-badge">
        <div class="tatib-debt-amount">Rp ${Number(s.sisa).toLocaleString('id-ID')}</div>
        <div class="tatib-debt-sub">sisa denda</div>
      </div>
    </div>
  `).join('');
}

function onTatibSearchInput() {
  const input = document.getElementById("tatibSearchInput");
  const q = (input?.value || "").trim().toLowerCase();
  if (!q) {
    renderTatibDebtorList(tatibDebtors);
    return;
  }
  const filtered = tatibDebtors.filter(s =>
    (s.nama && s.nama.toLowerCase().includes(q)) ||
    (s.kelas && s.kelas.toLowerCase().includes(q))
  );
  renderTatibDebtorList(filtered);
}

/* ===== PAYMENT MODAL ===== */
async function openTatibDebtorModal(encodedNama) {
  const nama = decodeURIComponent(encodedNama);
  const debtor = tatibDebtors.find(d => d.nama === nama);
  if (!debtor) return;

  showLoading(true);
  try {
    const { data: payments, error } = await sb
      .from('bayardenda')
      .select('id, amount, submitter, note, created_at')
      .eq('student_id', debtor.id)
      .eq('semester', currentSemester)
      .order('created_at', { ascending: false });

    if (error) throw error;

    tatibSelectedDebtor = {
      ...debtor,
      payments: (payments || []).map(p => ({
        id: p.id,
        amount: p.amount,
        date: formatTatibDate(p.created_at),
        submitter: p.submitter || '-'
      }))
    };

    renderTatibPaymentModal(tatibSelectedDebtor);
    const modal = document.getElementById("tatibPaymentModal");
    if (modal) modal.classList.add("visible");
  } catch (err) {
    showStatus("Error koneksi: " + err.message, "error");
  }
  showLoading(false);
}

function closeTatibPaymentModal() {
  const modal = document.getElementById("tatibPaymentModal");
  if (modal) modal.classList.remove("visible");
  tatibSelectedDebtor = null;
}

function renderTatibPaymentModal(s) {
  if (!s) return;
  document.getElementById("tatibPayName").textContent = s.nama || "-";
  document.getElementById("tatibPayClass").textContent = s.kelas || "-";
  document.getElementById("tatibPayTotal").textContent = "Rp " + Number(s.total || 0).toLocaleString('id-ID');
  document.getElementById("tatibPayPaid").textContent = "Rp " + Number(s.paid || 0).toLocaleString('id-ID');
  document.getElementById("tatibPaySisa").textContent = "Rp " + Number(s.sisa || 0).toLocaleString('id-ID');

  const historyList = document.getElementById("tatibPayHistory");
  const payments = s.payments || [];
  if (payments.length === 0) {
    historyList.innerHTML = '<div class="tatib-history-empty">Belum ada riwayat pembayaran</div>';
  } else {
    historyList.innerHTML = payments.map(p => `
      <div class="tatib-history-item">
        <div class="tatib-history-meta">
          <span class="tatib-history-id">${escapeHtml(p.id ? p.id.slice(0, 8) : '-')}</span>
          <span class="tatib-history-date">${escapeHtml(p.date)}</span>
        </div>
        <div class="tatib-history-amount">Rp ${Number(p.amount).toLocaleString('id-ID')}</div>
      </div>
    `).join('');
  }

  const amountInput = document.getElementById("tatibPayAmount");
  const hint = document.getElementById("tatibPayHint");
  if (amountInput) {
    amountInput.value = "";
    amountInput.dataset.max = s.sisa || 0;
  }
  if (hint) {
    hint.textContent = "Maksimal: Rp " + Number(s.sisa || 0).toLocaleString('id-ID');
    hint.classList.remove("error");
  }
}

function formatTatibAmount(el) {
  let val = el.value.replace(/[^0-9]/g, '');
  const num = parseInt(val, 10) || 0;
  el.value = num ? 'Rp ' + num.toLocaleString('id-ID') : '';

  const max = parseInt(el.dataset.max || "0", 10);
  const hint = document.getElementById("tatibPayHint");
  if (hint && max > 0) {
    if (num > max) {
      hint.textContent = "Jumlah melebihi sisa denda (Rp " + max.toLocaleString('id-ID') + ")";
      hint.classList.add("error");
    } else {
      hint.textContent = "Maksimal: Rp " + max.toLocaleString('id-ID');
      hint.classList.remove("error");
    }
  }
}

function applyLocalPaymentUpdate(nama, amountPaid, newSisa) {
  const idx = tatibDebtors.findIndex(d => d.nama === nama);
  if (idx === -1) return;

  if (newSisa <= 0) {
    tatibDebtors.splice(idx, 1);
  } else {
    tatibDebtors[idx].sisa = newSisa;
    tatibDebtors[idx].paid = (tatibDebtors[idx].total || 0) - newSisa;
  }

  tatibDebtors.sort((a, b) => b.sisa - a.sisa);
  onTatibSearchInput();
}

async function refreshTatibListSilently() {
  if (tatibIsBackgroundRefreshing) return;
  tatibIsBackgroundRefreshing = true;

  try {
    await fetchTatibDebtData();
    onTatibSearchInput();
  } catch (e) {
    console.error("Silent refresh failed", e);
  }

  tatibIsBackgroundRefreshing = false;
}

async function submitTatibPayment() {
  if (!tatibSelectedDebtor) return;

  const amountEl = document.getElementById("tatibPayAmount");
  const btn = document.getElementById("tatibPaySubmitBtn");

  const raw = amountEl.value.replace(/[^0-9]/g, '');
  const amount = parseInt(raw, 10) || 0;
  const max = parseInt(amountEl.dataset.max || "0", 10);

  if (amount <= 0) {
    showStatus("Jumlah pembayaran harus lebih dari 0", "error");
    return;
  }

  if (max > 0 && amount > max) {
    showStatus("Pembayaran tidak boleh melebihi sisa denda", "error");
    return;
  }

  // CAPTURE these BEFORE closing the modal
  const studentName = tatibSelectedDebtor.nama;
  const newSisa = max - amount;

  btn.disabled = true;
  showLoading(true);

  try {
    const { error } = await sb
      .from('bayardenda')
      .insert({
        student_id: tatibSelectedDebtor.id,
        amount: amount,
        submitter: currentOperator,
        semester: currentSemester,
        note: ''
      });

    if (error) throw error;

    showStatus("✓ Pembayaran berhasil", "ok");

    // 1. Update local array first
    applyLocalPaymentUpdate(studentName, amount, newSisa);

    // 2. Then close modal and clean up
    closeTatibPaymentModal();

    const searchInput = document.getElementById("tatibSearchInput");
    if (searchInput) searchInput.value = "";

    // 3. Background refresh to sync with Supabase
    // refreshTatibListSilently();
  } catch (err) {
    showStatus("Error: " + err.message, "error");
    btn.disabled = false;
  }

  showLoading(false);
}

/* ===== BERMASALAH CHECKLIST ===== */
let tatibBmData = [];
let tatibBmFiltered = [];

function showTatibBermasalah() {
  hideAllScreens();
  const el = document.getElementById("tatibBermasalahScreen");
  if (el) {
    el.style.display = "flex";
    initTatibBermasalah();
  }
}

async function initTatibBermasalah() {
  const container = document.getElementById("tatibBmListContainer");
  const empty = document.getElementById("tatibBmEmpty");
  const searchInput = document.getElementById("tatibBmSearchInput");

  if (container) container.innerHTML = "";
  if (empty) empty.style.display = "none";
  if (searchInput) searchInput.value = "";

  showLoading(true);
  try {
    await fetchTatibBermasalahData();
    updateTatibBmStats();
    applyTatibBmFilters();
    if (tatibBmData.length === 0) {
      if (empty) empty.style.display = "block";
    }
  } catch (err) {
    console.error(err);
    showStatus("Gagal memuat data: " + err.message, "error");
    if (empty) {
      empty.style.display = "block";
      const txt = empty.querySelector(".empty-state-text");
      if (txt) txt.textContent = "Gagal memuat data";
    }
  }
  showLoading(false);
}

function setTatibBmFilter(mode) {
  tatibBmFilterMode = mode;
  document.querySelectorAll('.tatib-bm-filter').forEach(btn => {
    const isMatch = 
      (mode === 'all' && btn.textContent.includes('Semua')) ||
      (mode === 'tanpa' && btn.textContent.includes('Tanpa')) ||
      (mode === 'alpha3' && btn.textContent.includes('Alpha'));
    btn.classList.toggle('active', isMatch);
  });
  applyTatibBmFilters();
}

function applyTatibBmFilters() {
  const input = document.getElementById("tatibBmSearchInput");
  const q = (input?.value || "").trim().toLowerCase();

  tatibBmFiltered = tatibBmData.filter(s => {
    if (tatibBmFilterMode === 'tanpa' && !s.hasNoEkstra) return false;
    if (tatibBmFilterMode === 'alpha3' && s.alphaCount < 3) return false;

    if (!q) return true;
    return (s.nama && s.nama.toLowerCase().includes(q)) ||
           (s.kelas && s.kelas.toLowerCase().includes(q));
  });

  renderTatibBermasalahList(tatibBmFiltered);

  const empty = document.getElementById("tatibBmEmpty");
  if (empty) empty.style.display = tatibBmFiltered.length === 0 ? "block" : "none";
}

function onTatibBmSearch() {
  applyTatibBmFilters();
}

async function fetchTatibBermasalahData() {
  const { data: students, error: sErr } = await sb
    .from('Database')
    .select('id, nama, kelas, ekstra, photo_url');
  if (sErr) throw sErr;

  const { data: alphaRows, error: aErr } = await sb
  .from('AttendanceV2')
  .select('student_id')
  .eq('semester', currentSemester)
  .eq('status', 'ALPHA');
  if (aErr) throw aErr;

  const alphaCounts = {};
  (alphaRows || []).forEach(r => {
    alphaCounts[r.student_id] = (alphaCounts[r.student_id] || 0) + 1;
  });

  const { data: checks, error: cErr } = await sb
    .from('TatibCheck')
    .select('student_id, checked_at')
    .eq('semester', currentSemester);
  if (cErr) console.warn("TatibCheck load:", cErr.message);

  const checkedMap = {};
  (checks || []).forEach(c => { checkedMap[c.student_id] = c.checked_at; });

  const list = [];
  (students || []).forEach(s => {
    const ekstra = (s.ekstra || '').trim();
    const hasNoEkstra = !ekstra || ekstra === '0';
    const alphaCount = alphaCounts[s.id] || 0;

    if (hasNoEkstra || alphaCount > 0) {
      list.push({
        id: s.id,
        nama: s.nama,
        kelas: s.kelas,
        photo_url: s.photo_url,
        hasNoEkstra,
        alphaCount,
        checked: !!checkedMap[s.id]
      });
    }
  });

  list.sort((a, b) => {
    if (a.checked !== b.checked) return a.checked ? 1 : -1;
    return a.nama.localeCompare(b.nama);
  });

  tatibBmData = list;
  tatibBmFiltered = [...list];
}

function updateTatibBmStats() {
  const total = tatibBmData.length;
  const done = tatibBmData.filter(s => s.checked).length;
  const pending = total - done;

  const elTotal = document.getElementById("tatibBmStatTotal");
  const elDone = document.getElementById("tatibBmStatDone");
  const elPending = document.getElementById("tatibBmStatPending");

  if (elTotal) elTotal.textContent = total;
  if (elDone) elDone.textContent = done;
  if (elPending) elPending.textContent = pending;
}

function renderTatibBermasalahList(list) {
  const container = document.getElementById("tatibBmListContainer");
  if (!container) return;
  if (!list.length) { container.innerHTML = ""; return; }

  container.innerHTML = list.map(s => {
    const hasPhoto = !!s.photo_url;
    const safeId = String(s.id).replace(/'/g, "\\'");
    return `
      <div class="tatib-bm-row ${s.checked ? 'checked' : ''}" id="tatibBmRow-${s.id}">
        ${hasPhoto 
          ? `<img class="tatib-bm-photo" src="${escapeHtml(s.photo_url)}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">`
          : `<div class="tatib-bm-placeholder">👤</div>`
        }
        <div class="tatib-bm-info">
          <div class="tatib-bm-name">${escapeHtml(s.nama)}</div>
          <div class="tatib-bm-class">${escapeHtml(s.kelas)}</div>
          <div class="tatib-bm-badges">
            ${s.hasNoEkstra ? `<span class="tatib-bm-badge tanpa">Tanpa Ekstra</span>` : ''}
            ${s.alphaCount > 0 ? `<span class="tatib-bm-badge alpha">Alpha ${s.alphaCount}x</span>` : ''}
          </div>
        </div>
        <button class="tatib-bm-toggle ${s.checked ? 'checked' : ''}" onclick="toggleTatibCheck('${safeId}')">
          <div class="tatib-bm-toggle-thumb"></div>
        </button>
      </div>
    `;
  }).join('');
}

function onTatibBmSearch() {
  const input = document.getElementById("tatibBmSearchInput");
  const q = (input?.value || "").trim().toLowerCase();
  if (!q) {
    tatibBmFiltered = [...tatibBmData];
  } else {
    tatibBmFiltered = tatibBmData.filter(s =>
      (s.nama && s.nama.toLowerCase().includes(q)) ||
      (s.kelas && s.kelas.toLowerCase().includes(q))
    );
  }
  renderTatibBermasalahList(tatibBmFiltered);
}

async function toggleTatibCheck(studentId) {
  const student = tatibBmData.find(s => String(s.id) === String(studentId));
  if (!student) return;

  const newChecked = !student.checked;
  student.checked = newChecked;

  // Optimistic UI
  const row = document.getElementById(`tatibBmRow-${studentId}`);
  if (row) {
    row.classList.toggle('checked', newChecked);
    const toggle = row.querySelector('.tatib-bm-toggle');
    if (toggle) toggle.classList.toggle('checked', newChecked);
  }
  updateTatibBmStats();

  // Re-sort: unchecked float to top
  tatibBmData.sort((a, b) => {
    if (a.checked !== b.checked) return a.checked ? 1 : -1;
    return a.nama.localeCompare(b.nama);
  });
  onTatibBmSearch();

  showLoading(true);
  try {
    if (newChecked) {
      const { error } = await sb.from('TatibCheck').upsert({
        student_id: studentId,
        semester: currentSemester,
        checked_by: currentOperator || 'Tatib',
        checked_at: new Date().toISOString()
      });
      if (error) throw error;
      showStatus("✓ Ditandai sudah ditindak", "ok");
    } else {
      const { error } = await sb
        .from('TatibCheck')
        .delete()
        .eq('student_id', studentId)
        .eq('semester', currentSemester);
      if (error) throw error;
      showStatus("✓ Batal ditandai", "ok");
    }
  } catch (err) {
    showStatus("Error: " + err.message, "error");
    student.checked = !newChecked;
    updateTatibBmStats();
    onTatibBmSearch();
  }
  showLoading(false);
}