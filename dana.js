// ===== PENGAJUAN DANA =====
const AUDIT_API_URL = "https://script.google.com/macros/s/AKfycbz0nTZE3SEQuoyBQVWI83du_9uDIpu3qZE5gbsqDQgvVVTNhw2CJvbnM460fjP5K03mzg/exec";

async function openDanaModal() {
  if (!currentOperator) return;

  const loader = document.getElementById("danaLoadingOverlay");
  if (loader) {
    loader.classList.add("visible");
    loader.style.display = "flex";
  }

  document.getElementById("danaNama").value = "";
  document.getElementById("danaJumlah").value = "";

  const btn = document.getElementById("danaKirimBtn");
  btn.disabled = true;
  btn.textContent = "Kirim";

  try {
    const res = await fetch(API_URL + "?action=getAuditNextId");
    const data = await res.json();
    document.getElementById("danaId").value = (data.status === "ok") ? data.id : "DEV-?????";
  } catch (err) {
    document.getElementById("danaId").value = "DEV-?????";
  }

  if (loader) {
    loader.classList.remove("visible");
    loader.style.display = "none";
  }
  document.getElementById("danaModal").classList.add("visible");
  btn.disabled = false;
}

function closeDanaModal() {
  document.getElementById("danaModal").classList.remove("visible");
}

async function submitPengajuanDana() {
  const id = document.getElementById("danaId").value.trim();
  const nama = document.getElementById("danaNama").value.trim();
  const jumlah = parseDanaRupiah(document.getElementById("danaJumlah").value);

  if (!id || id === "DEV-?????") {
    showStatus("Gagal memuat ID transaksi", "error");
    return;
  }
  if (!nama) {
    showStatus("Nama kegiatan wajib diisi", "error");
    return;
  }
  if (!jumlah || jumlah <= 0) {
    showStatus("Jumlah harus lebih dari 0", "error");
    return;
  }

  closeDanaModal();
  showLoading(true);

  try {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({
        action: "submitAuditPengajuan",
        id: id,
        transaksi: nama,
        jumlah: jumlah,
        bukti: "",
        diajukanOleh: currentOperator,
        ekstra: currentEkstra
      })
    });

    const data = await res.json();
    if (data.status === "ok") {
      showStatus("✓ Pengajuan berhasil dikirim", "ok");
    } else {
      showStatus(data.message || "Gagal mengirim", "error");
    }
  } catch (err) {
    showStatus("Error koneksi: " + err.message, "error");
  }

  showLoading(false);
}

// ===== RUPIAH FORMATTER =====
function formatDanaInput(el) {
  let val = el.value.replace(/[^0-9]/g, '');
  if (!val) { el.value = ''; return; }
  el.value = 'Rp ' + parseInt(val).toLocaleString('id-ID');
}

function parseDanaRupiah(str) {
  return parseFloat(str.replace(/[^0-9]/g, '')) || 0;
}

// ===== DANA HISTORY =====
function openDanaHistory() {
  closeDanaModal();
  if (dashboardScreen) dashboardScreen.style.display = "none";
  
  const screen = document.getElementById("danaHistoryScreen");
  if (!screen) {
    console.error("danaHistoryScreen not found in DOM");
    showStatus("Error: Riwayat screen tidak ditemukan", "error");
    return;
  }
  
  screen.style.display = "flex";
  loadDanaHistory();
}

function closeDanaHistory() {
  const screen = document.getElementById("danaHistoryScreen");
  if (screen) screen.style.display = "none";
  if (dashboardScreen) dashboardScreen.style.display = "flex";
}

async function loadDanaHistory() {
  showLoading(true);
  try {
    const res = await fetch(API_URL + "?action=getAuditHistory&diajukanOleh=" + encodeURIComponent(currentOperator));
    const data = await res.json();

    if (data.status === "ok") {
      renderDanaHistory(data.data || []);
    } else {
      showStatus(data.message || "Gagal memuat riwayat", "error");
    }
  } catch (err) {
    showStatus("Error koneksi", "error");
  }
  showLoading(false);
}

function renderDanaHistory(list) {
  const container = document.getElementById("danaHistoryList");
  const empty = document.getElementById("danaHistoryEmpty");
  const statTotal = document.getElementById("dhStatTotal");
  const statApproved = document.getElementById("dhStatApproved");
  const statRejected = document.getElementById("dhStatRejected");

  if (list.length === 0) {
    container.innerHTML = "";
    empty.style.display = "block";
    if (statTotal) statTotal.textContent = "0";
    if (statApproved) statApproved.textContent = "0";
    if (statRejected) statRejected.textContent = "0";
    return;
  }

  empty.style.display = "none";

  let approved = 0, rejected = 0;
  list.forEach(item => {
    const st = (item.status || "").toLowerCase();
    if (st === "approved" || st === "confirmed") approved++;
    else if (st === "rejected") rejected++;
  });

  if (statTotal) statTotal.textContent = list.length;
  if (statApproved) statApproved.textContent = approved;
  if (statRejected) statRejected.textContent = rejected;

  container.innerHTML = list.map(item => {
    const st = (item.status || "Submitted").toLowerCase();
    const statusClass = st === "confirmed" ? "confirmed" : st === "approved" ? "approved" : st === "rejected" ? "rejected" : "submitted";
    const statusText = st === "confirmed" ? "Selesai" : st === "approved" ? "Disetujui" : st === "rejected" ? "Ditolak" : "Menunggu";
    const dateStr = item.timestamp ? new Date(item.timestamp).toLocaleDateString('id-ID') : "-";
    const jumlah = Number(item.jumlah) || 0;

    return `
      <div class="dana-history-item">
        <div class="dh-header">
          <div class="dh-id">${item.id}</div>
          <div class="dh-status ${statusClass}">${statusText}</div>
        </div>
        <div class="dh-name">${item.transaksi}</div>
        <div class="dh-meta">${dateStr} • ${item.diajukanOleh}</div>
        <div class="dh-amount">Rp ${jumlah.toLocaleString('id-ID')}</div>
        ${item.reason ? `<div class="dh-reason">Alasan: ${item.reason}</div>` : ""}
      </div>
    `;
  }).join('');
}
