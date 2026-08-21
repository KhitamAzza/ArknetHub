// ============================================
// tatib.js — Tatib: Payment + Heatmap
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

async function runBatched(tasks, batchSize = 3) {
  const results = [];
  for (let i = 0; i < tasks.length; i += batchSize) {
    const batch = tasks.slice(i, i + batchSize);
    const batchResults = await Promise.all(batch.map(t => t()));
    results.push(...batchResults);
  }
  return results;
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

async function fetchTatibDebtData() {
  const dbData = await fetchJsonWithRetry(API_URL + "?action=getDatabase");
  if (dbData.status !== "ok") throw new Error("Gagal memuat database");

  const students = dbData.data || [];
  const uniqueKelas = [...new Set(students.map(s => s.kelas).filter(Boolean))];

  const tasks = uniqueKelas.map(kelas => () =>
    fetchJsonWithRetry(
      API_URL + "?action=getClassDebts&kelas=" + encodeURIComponent(kelas)
    ).catch(() => ({ status: "error", data: [] }))
  );

  const debtResults = await runBatched(tasks, 3);

  let allDebts = [];
  debtResults.forEach(res => {
    if (res.status === "ok" && Array.isArray(res.data)) {
      allDebts = allDebts.concat(res.data);
    }
  });

  allDebts = allDebts.filter(d => d.sisa > 0);
  allDebts.sort((a, b) => b.sisa - a.sisa);

  tatibDebtors = allDebts;
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
  `).join("");
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
    const data = await fetchJsonWithRetry(
      API_URL + "?action=getStudentDebt&nama=" + encodeURIComponent(nama)
    );

    if (data.status === "ok") {
      tatibSelectedDebtor = data;
      renderTatibPaymentModal(data);
      const modal = document.getElementById("tatibPaymentModal");
      if (modal) modal.classList.add("visible");
    } else {
      showStatus(data.message || "Gagal memuat detail", "error");
    }
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
  document.getElementById("tatibPayName").textContent = s.nama;
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
          <span class="tatib-history-id">${escapeHtml(p.id)}</span>
          <span class="tatib-history-date">${escapeHtml(p.date)}</span>
        </div>
        <div class="tatib-history-amount">Rp ${Number(p.amount).toLocaleString('id-ID')}</div>
      </div>
    `).join("");
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

  const studentName = tatibSelectedDebtor.nama;
  const studentKelas = tatibSelectedDebtor.kelas;

  btn.disabled = true;
  showLoading(true);

  try {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({
        action: "addPayment",
        nama: studentName,
        kelas: studentKelas,
        amount: amount,
        submitter: currentOperator,
        note: ""
      })
    });

    const data = await res.json();
    if (data.status === "ok") {
      showStatus("✓ " + (data.message || "Pembayaran berhasil"), "ok");
      closeTatibPaymentModal();
      const searchInput = document.getElementById("tatibSearchInput");
      if (searchInput) searchInput.value = "";
      applyLocalPaymentUpdate(studentName, amount, data.sisa || 0);
      refreshTatibListSilently();
    } else {
      showStatus(data.message || "Gagal menyimpan", "error");
      btn.disabled = false;
    }
  } catch (err) {
    showStatus("Error: " + err.message, "error");
    btn.disabled = false;
  }

  showLoading(false);
}

/* ===== HEATMAP — DISABLED (Coming Soon) ===== */
function showTatibHeatmap() {
  showStatus("🔥 Heatmap Pelanggaran — fitur ini sedang dalam pengembangan", "info");
}

/*
function setHeatmapMode(mode) {
  tatibHeatmapMode = mode;
  document.getElementById("heatmapToggleKelas").classList.toggle("active", mode === "kelas");
  document.getElementById("heatmapToggleEkstra").classList.toggle("active", mode === "ekstra");
  if (tatibHeatmapData) renderTatibHeatmap(mode);
}

async function loadTatibHeatmap() {
  const container = document.getElementById("tatibHeatmapList");
  const empty = document.getElementById("tatibHeatmapEmpty");
  if (container) container.innerHTML = "";
  if (empty) empty.style.display = "none";

  showLoading(true);
  try {
    const data = await fetchJsonWithRetry(API_URL + "?action=getViolationHeatmap");
    if (data.status === "ok") {
      tatibHeatmapData = data;
      renderTatibHeatmap(tatibHeatmapMode);
    } else {
      showStatus(data.message || "Gagal memuat heatmap", "error");
      if (empty) empty.style.display = "block";
    }
  } catch (err) {
    showStatus("Error koneksi: " + err.message, "error");
    if (empty) empty.style.display = "block";
  }
  showLoading(false);
}

function renderTatibHeatmap(mode) {
  const list = mode === "kelas" ? tatibHeatmapData.byKelas : tatibHeatmapData.byEkstra;
  const container = document.getElementById("tatibHeatmapList");
  const empty = document.getElementById("tatibHeatmapEmpty");

  if (!list || list.length === 0) {
    if (container) container.innerHTML = "";
    if (empty) empty.style.display = "block";
    return;
  }

  if (empty) empty.style.display = "none";
  const maxTotal = Math.max(...list.map(x => x.total), 1);

  container.innerHTML = list.map(item => {
    const pctAlpha = (item.alpha / maxTotal) * 100;
    const pctTerlambat = (item.terlambat / maxTotal) * 100;
    const pctPagi = (item.pagi / maxTotal) * 100;

    return `
      <div class="heatmap-row">
        <div class="heatmap-name">
          <span>${escapeHtml(item.name)}</span>
          <span class="heatmap-count">${item.total}</span>
        </div>
        <div class="heatmap-bar-track">
          ${item.alpha ? `<div class="heatmap-seg alpha" style="width:${pctAlpha}%"></div>` : ''}
          ${item.terlambat ? `<div class="heatmap-seg terlambat" style="width:${pctTerlambat}%"></div>` : ''}
          ${item.pagi ? `<div class="heatmap-seg pagi" style="width:${pctPagi}%"></div>` : ''}
          ${item.total === 0 ? '<div style="width:100%;display:flex;align-items:center;justify-content:center;font-size:10px;color:var(--text-secondary);">Aman ✓</div>' : ''}
        </div>
        <div class="heatmap-meta">
          <span><span class="hm-dot alpha"></span>${item.alpha} Alpha</span>
          <span><span class="hm-dot terlambat"></span>${item.terlambat} Telat</span>
          <span><span class="hm-dot pagi"></span>${item.pagi} Pagi</span>
          <span style="margin-left:auto;">${item.siswa} siswa</span>
        </div>
      </div>
    `;
  }).join("");
}
*/