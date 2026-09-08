// ============================================
// tatib.js — Tatib: Payment + Heatmap (Supabase)
// ============================================

let tatibDebtors = [];
let tatibSelectedDebtor = null;
let tatibIsBackgroundRefreshing = false;

let tatibHeatmapData = null;
let tatibHeatmapMode = "kelas";

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
  toggleDendaFab(false);
}

/* ===== PAYMENT FULL PAGE ===== */
function showTatibPayment() {
  hideAllScreens();
  const el = document.getElementById("tatibPaymentScreen");
  if (el) {
    el.style.display = "flex";
    initTatibPayment();
  }
  toggleDendaFab(true); // reuses denda.js's FAB — same collected/handed summary as admin sees
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
      // note intentionally omitted here so it stays NULL — Denda Diterima
      // (denda.js) finds pending tatib deposits via .is('note', null),
      // so an explicit '' would hide this payment from that screen forever.
      .insert({
        student_id: tatibSelectedDebtor.id,
        amount: amount,
        submitter: currentOperator,
        semester: currentSemester
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
  }

  // Always re-enable — previously this only happened in the catch block,
  // so a *successful* submit left the button disabled until page refresh.
  btn.disabled = false;
  showLoading(false);
}

/* ===================================================
   BERMASALAH — kelas x total debt (remodeled)
   Alpha-count-per-student was noisy and redundant with the
   denda module, so this now groups students-with-debt by
   kelas and surfaces total outstanding denda per class —
   the number that actually matters for follow-up priority.

   Reuses fetchTatibDebtData()'s sisa > 0 filter, so students
   who've already paid off their fine never appear here.

   Level 1 "classes": kelas + total debt, sorted biggest first
   Level 2 "detail":   that class's students + violation
                        counts + individual debt, plus an
                        "Ingatkan Wakel" WhatsApp button
   Plus a bottom "Kirim Semua Laporan" button on level 1 that
   compiles every class into one forwardable report.
   =================================================== */
let tatibBmClassData = [];      // [{ kelas, totalDebt, students: [{nama, alphaCount, terlambatCount, sisa}] }]
let tatibBmView = 'classes';    // 'classes' | 'detail'
let tatibBmSelectedKelas = null;
let tatibBmWakelMap = {};       // kelas -> { kelas, nama, whatsapp }

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
  if (searchInput) {
    searchInput.value = "";
    searchInput.placeholder = "Cari kelas...";
  }

  tatibBmView = 'classes';
  tatibBmSelectedKelas = null;

  showLoading(true);
  try {
    await fetchTatibBermasalahData();
    renderTatibBmView();
    if (tatibBmClassData.length === 0 && empty) {
      empty.style.display = "block";
      const txt = empty.querySelector(".empty-state-text");
      if (txt) txt.textContent = "Tidak ada kelas dengan denda tertunggak";
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

async function fetchTatibBermasalahData() {
  // Same debt formula as the payment screens (violations x Config's
  // denda_alpha/denda_terlambat, minus what's already been paid) — sisa > 0
  // only, so fully-paid students are excluded automatically.
  await fetchTatibDebtData(); // populates tatibDebtors

  const { data: wakelRows, error: wErr } = await sb.from('Wakel').select('kelas, nama, whatsapp');
  if (wErr) console.warn("Wakel load:", wErr.message);
  tatibBmWakelMap = {};
  (wakelRows || []).forEach(w => { tatibBmWakelMap[w.kelas] = w; });

  const byClass = {};
  tatibDebtors.forEach(s => {
    const kelas = s.kelas || 'Tanpa Kelas';
    if (!byClass[kelas]) byClass[kelas] = { kelas, totalDebt: 0, students: [] };
    byClass[kelas].totalDebt += s.sisa;
    byClass[kelas].students.push({
      nama: s.nama,
      alphaCount: s.alphaCount,
      terlambatCount: s.terlambatCount,
      sisa: s.sisa
    });
  });

  tatibBmClassData = Object.values(byClass).sort((a, b) => b.totalDebt - a.totalDebt);
  tatibBmClassData.forEach(c => c.students.sort((a, b) => b.sisa - a.sisa));
}

function renderTatibBmView() {
  if (tatibBmView === 'detail') return renderTatibBmDetailView();
  return renderTatibBmClassesView();
}

function onTatibBmSearch() {
  renderTatibBmView();
}

// Level 1: kelas + total debt, biggest first.
function renderTatibBmClassesView() {
  const container = document.getElementById("tatibBmListContainer");
  if (!container) return;

  const q = (document.getElementById("tatibBmSearchInput")?.value || '').trim().toLowerCase();
  const list = !q ? tatibBmClassData : tatibBmClassData.filter(c => c.kelas.toLowerCase().includes(q));

  const empty = document.getElementById("tatibBmEmpty");
  if (empty) empty.style.display = (tatibBmClassData.length > 0 && list.length === 0) ? "block" : "none";

  if (tatibBmClassData.length === 0) { container.innerHTML = ""; return; }

  const rows = list.map(c => `
    <div class="tatib-debt-row" onclick="openTatibBmClass('${encodeURIComponent(c.kelas)}')">
      <div class="tatib-debt-main">
        <div class="tatib-debt-name">${escapeHtml(c.kelas)}</div>
        <div class="tatib-debt-class">${c.students.length} siswa menunggak</div>
      </div>
      <div class="tatib-debt-badge">
        <div class="tatib-debt-amount">${formatRupiah(c.totalDebt)}</div>
        <div class="tatib-debt-sub">total denda</div>
      </div>
    </div>
  `).join('');

  container.innerHTML = rows + `
    <button class="tatib-bm-action-btn green" onclick="sendTatibBmAllReport()">
      📤 Kirim Semua Laporan
    </button>
  `;
}

function openTatibBmClass(encodedKelas) {
  tatibBmSelectedKelas = decodeURIComponent(encodedKelas);
  tatibBmView = 'detail';
  renderTatibBmView();
}

function backTatibBmToClasses() {
  tatibBmView = 'classes';
  tatibBmSelectedKelas = null;
  renderTatibBmView();
}

// Level 2: that class's students + violation breakdown + individual debt.
function renderTatibBmDetailView() {
  const container = document.getElementById("tatibBmListContainer");
  if (!container) return;
  const empty = document.getElementById("tatibBmEmpty");
  if (empty) empty.style.display = "none";

  const c = tatibBmClassData.find(x => x.kelas === tatibBmSelectedKelas);
  if (!c) { tatibBmView = 'classes'; return renderTatibBmView(); }

  const wakel = tatibBmWakelMap[c.kelas];

  const rows = c.students.map(s => `
    <div class="denda-fab-payment">
      <span class="denda-fab-payment-name">${escapeHtml(s.nama)} — ${escapeHtml(tatibBmViolationLabel(s))}</span>
      <span class="denda-fab-payment-amount">${formatRupiah(s.sisa)}</span>
    </div>
  `).join('');

  const wakelLine = wakel
    ? `<div class="tatib-detail-class" style="padding:0 4px 12px;">Wakel: ${escapeHtml(wakel.nama || '-')}</div>`
    : `<div class="tatib-pay-hint error" style="padding:0 4px 12px;">Nomor wali kelas belum terdaftar di tabel Wakel</div>`;

  container.innerHTML = `
    <div class="denda-fab-back" onclick="backTatibBmToClasses()">‹ Semua Kelas</div>
    <div class="denda-fab-header-title">${escapeHtml(c.kelas)} • ${formatRupiah(c.totalDebt)}</div>
    ${wakelLine}
    ${rows}
    <button class="tatib-bm-action-btn" onclick="sendTatibBmWakelReminder()" ${wakel && wakel.whatsapp ? '' : 'disabled'}>
      💬 Ingatkan Wakel
    </button>
  `;
}

function tatibBmViolationLabel(s) {
  const parts = [];
  if (s.alphaCount > 0) parts.push(`Alpha ${s.alphaCount}x`);
  if (s.terlambatCount > 0) parts.push(`Terlambat ${s.terlambatCount}x`);
  return parts.join(', ') || '-';
}

function formatRupiahPlain(n) {
  // "Rp.20.000" to match the requested forward-message format —
  // formatRupiah() (denda.js) uses "Rp 20.000" with a space instead.
  return 'Rp.' + (n || 0).toLocaleString('id-ID');
}

function buildTatibBmClassLines(c) {
  return c.students
    .map(s => `- ${s.nama} ${tatibBmViolationLabel(s)}, denda ${formatRupiahPlain(s.sisa)}`)
    .join('\n');
}

function normalizeWaNumber(raw) {
  let digits = (raw || '').replace(/\D/g, '');
  if (digits.startsWith('0')) digits = '62' + digits.slice(1);
  else if (!digits.startsWith('62')) digits = '62' + digits;
  return digits;
}

function sendTatibBmWakelReminder() {
  const c = tatibBmClassData.find(x => x.kelas === tatibBmSelectedKelas);
  if (!c) return;
  const wakel = tatibBmWakelMap[c.kelas];
  if (!wakel || !wakel.whatsapp) {
    showStatus('Nomor WhatsApp wali kelas belum terdaftar', 'error');
    return;
  }

  const message = `${c.kelas}\nwakel : ${wakel.nama || '-'}\n\n${buildTatibBmClassLines(c)}`;
  const phone = normalizeWaNumber(wakel.whatsapp);
  window.open(`https://wa.me/${phone}?text=${encodeURIComponent(message)}`, '_blank');
}

function sendTatibBmAllReport() {
  if (tatibBmClassData.length === 0) return;

  const now = new Intl.DateTimeFormat('id-ID', {
    dateStyle: 'long', timeStyle: 'short', timeZone: 'Asia/Jakarta'
  }).format(new Date());

  const sections = tatibBmClassData
    .map(c => `${c.kelas}\n${buildTatibBmClassLines(c)}`)
    .join('\n\n');

  const message = `Laporan siswa dengan denda ekskul (${now})\n\n${sections}`;

  // No fixed recipient — opens WhatsApp's contact picker so it can be
  // forwarded to whichever group or person needs it (e.g. kepala sekolah).
  window.open(`https://wa.me/?text=${encodeURIComponent(message)}`, '_blank');
}

/* ===================================================
   NILAI MINUS — kelas x point-deficit (2nd tab)
   Same drill-down pattern as the denda Bermasalah screen,
   just a different formula and no "admin accept" step —
   points have no hand-over/confirmation stage, they're just
   a live calculated balance.

   nilai (poin) per student =
     (alphaCount x Config.nilai_minus_alpha)
     + (terlambatCount x Config.nilai_minus_terlambat)
     + sum(Redemptions.poin for that student this semester)

   nilai_minus_alpha/terlambat are configured as negative
   values by default, so violations push nilai down;
   Redemptions.poin (always positive per its DB check) adds
   back on top to represent recovered points.

   A student is flagged once nilai <= Config.minus_point_threshold
   (also negative, e.g. -30). Respects minus_point_enable —
   if the feature is off, the screen shows a disabled state
   instead of computing anything.

   Level 1 "classes": kelas + total point deficit, worst first
   Level 2 "detail":   that class's flagged students + violation
                        counts + individual nilai, plus
                        "Ingatkan Wakel"
   Plus bottom "Kirim Semua Laporan" on level 1.
   =================================================== */
let tatibMinusClassData = [];      // [{ kelas, totalMinus, students: [{nama, alphaCount, terlambatCount, nilai}] }]
let tatibMinusView = 'classes';    // 'classes' | 'detail'
let tatibMinusSelectedKelas = null;
let tatibMinusWakelMap = {};
let tatibMinusFeatureDisabled = false;

function showTatibMinus() {
  hideAllScreens();
  const el = document.getElementById("tatibMinusScreen");
  if (el) {
    el.style.display = "flex";
    initTatibMinus();
  }
}

async function initTatibMinus() {
  const container = document.getElementById("tatibMinusListContainer");
  const empty = document.getElementById("tatibMinusEmpty");
  const searchInput = document.getElementById("tatibMinusSearchInput");

  if (container) container.innerHTML = "";
  if (empty) empty.style.display = "none";
  if (searchInput) {
    searchInput.value = "";
    searchInput.placeholder = "Cari kelas...";
  }

  tatibMinusView = 'classes';
  tatibMinusSelectedKelas = null;

  showLoading(true);
  try {
    await fetchTatibMinusData();

    if (tatibMinusFeatureDisabled) {
      if (container) container.innerHTML = "";
      if (empty) {
        empty.style.display = "block";
        const txt = empty.querySelector(".empty-state-text");
        if (txt) txt.textContent = "Fitur nilai minus sedang dinonaktifkan (Config: minus_point_enable)";
      }
    } else {
      renderTatibMinusView();
      if (tatibMinusClassData.length === 0 && empty) {
        empty.style.display = "block";
        const txt = empty.querySelector(".empty-state-text");
        if (txt) txt.textContent = "Tidak ada kelas dengan nilai minus";
      }
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

async function fetchTatibMinusData() {
  const config = await loadSupabaseConfig();

  if (!config.minusPointEnable) {
    tatibMinusFeatureDisabled = true;
    tatibMinusClassData = [];
    return;
  }
  tatibMinusFeatureDisabled = false;

  const nilaiMinusAlpha = config.nilaiMinusAlpha || 0;
  const nilaiMinusTerlambat = config.nilaiMinusTerlambat || 0;
  const threshold = config.minusPointThreshold ?? -30;

  const { data: students, error: sErr } = await sb.from('Database').select('id, nama, kelas');
  if (sErr) throw new Error("Gagal memuat database: " + sErr.message);

  const { data: violations, error: vErr } = await sb
    .from('AttendanceV2')
    .select('student_id, status')
    .eq('semester', currentSemester)
    .in('status', ['ALPHA', 'TERLAMBAT', 'TELAT']);
  if (vErr) throw new Error("Gagal memuat pelanggaran: " + vErr.message);

  const { data: redemptions, error: rErr } = await sb
    .from('Redemptions')
    .select('student_id, poin')
    .eq('semester', currentSemester);
  if (rErr) throw new Error("Gagal memuat redemptions: " + rErr.message);

  const { data: wakelRows, error: wErr } = await sb.from('Wakel').select('kelas, nama, whatsapp');
  if (wErr) console.warn("Wakel load:", wErr.message);
  tatibMinusWakelMap = {};
  (wakelRows || []).forEach(w => { tatibMinusWakelMap[w.kelas] = w; });

  const violationCounts = {};
  (violations || []).forEach(v => {
    if (!violationCounts[v.student_id]) violationCounts[v.student_id] = { alpha: 0, terlambat: 0 };
    const st = (v.status || '').trim().toUpperCase();
    if (st === 'ALPHA') violationCounts[v.student_id].alpha++;
    else violationCounts[v.student_id].terlambat++;
  });

  const redemptionSums = {};
  (redemptions || []).forEach(r => {
    redemptionSums[r.student_id] = (redemptionSums[r.student_id] || 0) + (r.poin || 0);
  });

  const byClass = {};
  (students || []).forEach(s => {
    const v = violationCounts[s.id] || { alpha: 0, terlambat: 0 };
    const nilai = (v.alpha * nilaiMinusAlpha) + (v.terlambat * nilaiMinusTerlambat) + (redemptionSums[s.id] || 0);

    // nilai < 0 is a hard guard on top of the threshold check — a student
    // sitting at exactly 0 (no real deficit) should never show up here,
    // even if Config.minus_point_threshold were ever set to 0 or above.
    if (nilai < 0 && nilai <= threshold) {
      const kelas = s.kelas || 'Tanpa Kelas';
      if (!byClass[kelas]) byClass[kelas] = { kelas, totalMinus: 0, students: [] };
      byClass[kelas].totalMinus += nilai;
      byClass[kelas].students.push({
        nama: s.nama,
        alphaCount: v.alpha,
        terlambatCount: v.terlambat,
        nilai
      });
    }
  });

  // Most negative (worst) class first; worst student first within a class.
  tatibMinusClassData = Object.values(byClass).sort((a, b) => a.totalMinus - b.totalMinus);
  tatibMinusClassData.forEach(c => c.students.sort((a, b) => a.nilai - b.nilai));
}

function renderTatibMinusView() {
  if (tatibMinusView === 'detail') return renderTatibMinusDetailView();
  return renderTatibMinusClassesView();
}

function onTatibMinusSearch() {
  renderTatibMinusView();
}

function formatPoin(n) {
  return (n || 0).toLocaleString('id-ID');
}

// Level 1: kelas + total point deficit, worst first.
function renderTatibMinusClassesView() {
  const container = document.getElementById("tatibMinusListContainer");
  if (!container) return;

  const q = (document.getElementById("tatibMinusSearchInput")?.value || '').trim().toLowerCase();
  const list = !q ? tatibMinusClassData : tatibMinusClassData.filter(c => c.kelas.toLowerCase().includes(q));

  const empty = document.getElementById("tatibMinusEmpty");
  if (empty) empty.style.display = (tatibMinusClassData.length > 0 && list.length === 0) ? "block" : "none";

  if (tatibMinusClassData.length === 0) { container.innerHTML = ""; return; }

  const rows = list.map(c => `
    <div class="tatib-debt-row" onclick="openTatibMinusClass('${encodeURIComponent(c.kelas)}')">
      <div class="tatib-debt-main">
        <div class="tatib-debt-name">${escapeHtml(c.kelas)}</div>
        <div class="tatib-debt-class">${c.students.length} siswa bermasalah</div>
      </div>
      <div class="tatib-debt-badge">
        <div class="tatib-debt-amount">${formatPoin(c.totalMinus)}</div>
        <div class="tatib-debt-sub">total poin minus</div>
      </div>
    </div>
  `).join('');

  container.innerHTML = rows + `
    <button class="tatib-bm-action-btn green" onclick="sendTatibMinusAllReport()">
      📤 Kirim Semua Laporan
    </button>
  `;
}

function openTatibMinusClass(encodedKelas) {
  tatibMinusSelectedKelas = decodeURIComponent(encodedKelas);
  tatibMinusView = 'detail';
  renderTatibMinusView();
}

function backTatibMinusToClasses() {
  tatibMinusView = 'classes';
  tatibMinusSelectedKelas = null;
  renderTatibMinusView();
}

// Level 2: that class's flagged students + violation breakdown + nilai.
function renderTatibMinusDetailView() {
  const container = document.getElementById("tatibMinusListContainer");
  if (!container) return;
  const empty = document.getElementById("tatibMinusEmpty");
  if (empty) empty.style.display = "none";

  const c = tatibMinusClassData.find(x => x.kelas === tatibMinusSelectedKelas);
  if (!c) { tatibMinusView = 'classes'; return renderTatibMinusView(); }

  const wakel = tatibMinusWakelMap[c.kelas];

  const rows = c.students.map(s => `
    <div class="denda-fab-payment">
      <span class="denda-fab-payment-name">${escapeHtml(s.nama)} — ${escapeHtml(tatibBmViolationLabel(s))}</span>
      <span class="denda-fab-payment-amount">${formatPoin(s.nilai)}</span>
    </div>
  `).join('');

  const wakelLine = wakel
    ? `<div class="tatib-detail-class" style="padding:0 4px 12px;">Wakel: ${escapeHtml(wakel.nama || '-')}</div>`
    : `<div class="tatib-pay-hint error" style="padding:0 4px 12px;">Nomor wali kelas belum terdaftar di tabel Wakel</div>`;

  container.innerHTML = `
    <div class="denda-fab-back" onclick="backTatibMinusToClasses()">‹ Semua Kelas</div>
    <div class="denda-fab-header-title">${escapeHtml(c.kelas)} • ${formatPoin(c.totalMinus)} poin</div>
    ${wakelLine}
    ${rows}
    <button class="tatib-bm-action-btn" onclick="sendTatibMinusWakelReminder()" ${wakel && wakel.whatsapp ? '' : 'disabled'}>
      💬 Ingatkan Wakel
    </button>
  `;
}

function buildTatibMinusClassLines(c) {
  return c.students
    .map(s => `- ${s.nama} ${tatibBmViolationLabel(s)}, poin ${formatPoin(s.nilai)}`)
    .join('\n');
}

function sendTatibMinusWakelReminder() {
  const c = tatibMinusClassData.find(x => x.kelas === tatibMinusSelectedKelas);
  if (!c) return;
  const wakel = tatibMinusWakelMap[c.kelas];
  if (!wakel || !wakel.whatsapp) {
    showStatus('Nomor WhatsApp wali kelas belum terdaftar', 'error');
    return;
  }

  const message = `${c.kelas}\nwakel : ${wakel.nama || '-'}\n\n${buildTatibMinusClassLines(c)}`;
  const phone = normalizeWaNumber(wakel.whatsapp);
  window.open(`https://wa.me/${phone}?text=${encodeURIComponent(message)}`, '_blank');
}

function sendTatibMinusAllReport() {
  if (tatibMinusClassData.length === 0) return;

  const now = new Intl.DateTimeFormat('id-ID', {
    dateStyle: 'long', timeStyle: 'short', timeZone: 'Asia/Jakarta'
  }).format(new Date());

  const sections = tatibMinusClassData
    .map(c => `${c.kelas}\n${buildTatibMinusClassLines(c)}`)
    .join('\n\n');

  const message = `Laporan siswa dengan nilai minus (${now})\n\n${sections}`;
  window.open(`https://wa.me/?text=${encodeURIComponent(message)}`, '_blank');
}
