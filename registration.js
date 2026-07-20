// ===== REGISTRATION STATE =====
let pendingRegistrations = [];
let currentRegIndex = 0;
let sessionMarked = new Map(); // nama -> "approved" | "rejected"

// ===== DOM REFS =====
const regReelContainer = document.getElementById("regReelContainer");
const regEmptyState = document.getElementById("regEmptyState");
const regStatTotal = document.getElementById("regStatTotal");
const regStatApproved = document.getElementById("regStatApproved");
const regStatRejected = document.getElementById("regStatRejected");

// ===== SHOW REGISTRATION SCREEN =====
function showRegistration() {
  if (isMaster) {
    showStatus("MASTER tidak dapat menyetujui pendaftaran", "info");
    return;
  }
  dashboardScreen.style.display = "none";
  registrationScreen.style.display = "flex";
  loadRegistrations();
}

// ===== LOAD PENDING REGISTRATIONS =====
async function loadRegistrations() {
  showLoading(true);
  try {
    const res = await fetch(API_URL + "?action=getPendingRegistrations&ekstra=" + encodeURIComponent(currentEkstra));
    const data = await res.json();

    if (data.status === "ok") {
      pendingRegistrations = data.data || [];
      currentRegIndex = 0;
      sessionMarked.clear();
      updateRegStats();

      if (pendingRegistrations.length === 0) {
        renderRegCard(-1);
        regEmptyState.style.display = "block";
      } else {
        regEmptyState.style.display = "none";
        renderRegCard(currentRegIndex);
      }
    } else {
      showStatus(data.message || "Gagal memuat pendaftar", "error");
    }
  } catch (err) {
    console.error(err);
    showStatus("Error koneksi: " + err.message, "error");
  }
  showLoading(false);
}

function refreshRegistrations() {
  loadRegistrations();
}

// ===== STATS =====
function updateRegStats() {
  const total = pendingRegistrations.length;
  let approved = 0, rejected = 0;
  sessionMarked.forEach(v => {
    if (v === "approved") approved++;
    if (v === "rejected") rejected++;
  });

  if (regStatTotal) regStatTotal.textContent = total;
  if (regStatApproved) regStatApproved.textContent = approved;
  if (regStatRejected) regStatRejected.textContent = rejected;
}

// ===== CARD RENDER =====
function renderRegCard(index) {
  regReelContainer.querySelectorAll(".student-card").forEach(c => c.remove());

  if (!pendingRegistrations || pendingRegistrations.length === 0 || index < 0 || index >= pendingRegistrations.length) {
    if (!pendingRegistrations || pendingRegistrations.length === 0) regEmptyState.style.display = "block";
    return;
  }

  regEmptyState.style.display = "none";

  const reg = pendingRegistrations[index];
  const mark = sessionMarked.get(reg.nama);
  const isApproved = mark === "approved";
  const isRejected = mark === "rejected";

  const card = document.createElement("div");
  card.className = "student-card " + (isApproved ? "hadir" : "");
  card.style.position = "relative";
  card.style.zIndex = "10";

  const pilihanClass = reg.pilihanKe === 2 ? "pilihan-2" : "pilihan-1";
  const pilihanText = reg.pilihanKe === 2 ? "Pilihan Ke-2 (Terakhir)" : "Pilihan Ke-1";

  card.innerHTML = `
    <div class="card-photo-container">
      ${reg.foto
        ? `<img class="card-photo" src="${reg.foto}" alt="${reg.nama}" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';">`
        : ""
      }
      <div class="card-photo-placeholder" style="display:${reg.foto ? 'none' : 'flex'}">👤</div>
      ${isApproved ? `<div class="card-hadir-overlay"></div><div class="card-hadir-badge">✅ DITERIMA</div>` : ""}
      ${isRejected ? `<div class="card-hadir-overlay" style="background:rgba(239,68,68,0.12);"></div><div class="card-hadir-badge" style="background:var(--red);box-shadow:0 4px 15px rgba(239,68,68,0.4);">❌ DITOLAK</div>` : ""}
    </div>
    <div class="card-info">
      <div class="card-name">${reg.nama}</div>
      <div class="card-meta">📚 Kelas ${reg.kelas}</div>
      <div class="card-ekstra">${reg.ekstra}</div>
      <div class="pilihan-badge ${pilihanClass}">${pilihanText}</div>
      <div style="font-size:13px;color:var(--text);margin-top:12px;padding:12px 14px;background:var(--bg);border-radius:12px;line-height:1.5;border:1px solid var(--border);">
        <span style="color:var(--text-secondary);font-size:11px;font-weight:600;">Alasan mendaftar:</span><br>
        ${reg.alasan ? reg.alasan : '<span style="color:var(--text-secondary);font-style:italic;">Tidak ada alasan</span>'}
      </div>
    </div>
    <div class="reg-actions">
      <button class="btn-reject" id="regRejectBtn" onclick="markCurrentReg('rejected')" ${isRejected ? 'style="opacity:0.5;"' : ''}>
        ${isRejected ? '✗ Ditolak' : 'Tolak'}
      </button>
      <button class="btn-approve" id="regApproveBtn" onclick="markCurrentReg('approved')" ${isApproved ? 'style="opacity:0.5;"' : ''}>
        ${isApproved ? '✓ Diterima' : 'Terima'}
      </button>
    </div>
  `;

  regReelContainer.appendChild(card);
  setupRegSwipe(card);

  // Preview card
  if (index + 1 < pendingRegistrations.length) {
    const preview = document.createElement("div");
    preview.className = "student-card";
    preview.style.cssText = "position:absolute;top:0;left:12px;right:12px;bottom:0;margin:auto;height:fit-content;transform:scale(0.92) translateY(10px);opacity:0.35;z-index:0;pointer-events:none;";
    const nextReg = pendingRegistrations[index + 1];
    const nextMark = sessionMarked.get(nextReg.nama);
    preview.innerHTML = `
      <div class="card-photo-container">
        ${nextReg.foto
          ? `<img class="card-photo" src="${nextReg.foto}" alt="${nextReg.nama}" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';">`
          : ""
        }
        <div class="card-photo-placeholder" style="display:${nextReg.foto ? 'none' : 'flex'}">👤</div>
      </div>
      <div class="card-info">
        <div class="card-name">${nextReg.nama}</div>
        <div class="card-meta">📚 Kelas ${nextReg.kelas}</div>
        ${nextMark ? `<div style="font-size:12px;color:${nextMark === 'approved' ? 'var(--green)' : 'var(--red)'};font-weight:700;">${nextMark === 'approved' ? '✓' : '✗'}</div>` : ""}
      </div>
    `;
    regReelContainer.appendChild(preview);
  }
}

// ===== MARK REGISTRATION (session only) =====
function markCurrentReg(decision) {
  const reg = pendingRegistrations[currentRegIndex];
  if (!reg) return;

  if (sessionMarked.has(reg.nama)) {
    // Toggle off if same decision clicked again
    if (sessionMarked.get(reg.nama) === decision) {
      sessionMarked.delete(reg.nama);
      showStatus("Batal " + (decision === "approved" ? "menerima" : "menolak"), "info");
    } else {
      // Switch decision
      sessionMarked.set(reg.nama, decision);
      showStatus(decision === "approved" ? "✓ Diterima" : "✗ Ditolak", decision === "approved" ? "ok" : "error");
    }
  } else {
    sessionMarked.set(reg.nama, decision);
    showStatus(decision === "approved" ? "✓ Diterima" : "✗ Ditolak", decision === "approved" ? "ok" : "error");
  }

  renderRegCard(currentRegIndex);
  updateRegStats();
}

// ===== SWIPE =====
function setupRegSwipe(card) {
  let startX = 0, currentX = 0, isDragging = false;

  const onStart = (x) => { startX = x; isDragging = true; card.style.transition = "none"; };
  const onMove = (x) => {
    if (!isDragging) return;
    currentX = x - startX;
    
    const isFirst = currentRegIndex === 0;
    const isLast = currentRegIndex >= pendingRegistrations.length - 1;
    
    if (isFirst && currentX > 0) {
      currentX = currentX / 3;
    } else if (isLast && currentX < 0) {
      currentX = currentX / 3;
    }
    
    card.style.transform = `translateX(${currentX}px) rotate(${currentX * 0.04}deg)`;
  };
  const onEnd = () => {
    if (!isDragging) return;
    isDragging = false;
    card.style.transition = "transform 0.25s cubic-bezier(0.4,0,0.2,1), opacity 0.25s ease";

    const isFirst = currentRegIndex === 0;
    const isLast = currentRegIndex >= pendingRegistrations.length - 1;

    if (currentX > 100) {
      if (isFirst) {
        card.style.transform = "";
        showStatus("Pendaftar pertama", "info");
      } else {
        card.classList.add("swiping-right");
        setTimeout(() => { prevReg(); }, 250);
      }
    } else if (currentX < -100) {
      if (isLast) {
        card.style.transform = "";
        showStatus("Pendaftar terakhir", "info");
      } else {
        card.classList.add("swiping-left");
        setTimeout(() => { nextReg(); }, 250);
      }
    } else {
      card.style.transform = "";
    }
    currentX = 0;
  };

  card.addEventListener("touchstart", (e) => onStart(e.touches[0].clientX), { passive: true });
  card.addEventListener("touchmove", (e) => onMove(e.touches[0].clientX), { passive: true });
  card.addEventListener("touchend", onEnd, { passive: true });

  card.addEventListener("mousedown", (e) => onStart(e.clientX));
  card.addEventListener("mousemove", (e) => onMove(e.clientX));
  card.addEventListener("mouseup", onEnd);
  card.addEventListener("mouseleave", () => {
    if (isDragging) { isDragging = false; card.style.transition = "transform 0.25s ease"; card.style.transform = ""; currentX = 0; }
  });
}

// ===== NAVIGATION =====
function nextReg() {
  if (currentRegIndex < pendingRegistrations.length - 1) {
    currentRegIndex++;
    renderRegCard(currentRegIndex);
  } else {
    showStatus("Pendaftar terakhir", "info");
  }
}

function prevReg() {
  if (currentRegIndex > 0) {
    currentRegIndex--;
    renderRegCard(currentRegIndex);
  } else {
    showStatus("Pendaftar pertama", "info");
  }
}

// ===== SUBMIT BATCH =====
async function submitRegistrations() {
  if (sessionMarked.size === 0) {
    showStatus("Belum ada pendaftaran yang diproses", "error");
    return;
  }

  const approved = [];
  const rejected = [];

  sessionMarked.forEach((decision, nama) => {
    const reg = pendingRegistrations.find(r => r.nama === nama);
    if (!reg) return;
    if (decision === "approved") approved.push(reg);
    if (decision === "rejected") rejected.push({ nama: reg.nama, ekstra: reg.ekstra });
  });

  showLoading(true);

  try {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({
        action: "batchProcessRegistrations",
        approved: approved,
        rejected: rejected
      })
    });

    const data = await res.json();
    if (data.status === "ok") {
      showStatus(`✓ ${data.approvedCount} diterima, ${data.rejectedCount} ditolak`, "ok");
      loadRegistrations();
    } else {
      showStatus(data.message || "Gagal mengirim", "error");
    }
  } catch (err) {
    showStatus("Error koneksi: " + err.message, "error");
  }

  showLoading(false);
}

// Keyboard nav for registration
document.addEventListener("keydown", (e) => {
  if (registrationScreen && registrationScreen.style.display !== "none") {
    if (e.key === "ArrowRight") nextReg();
    if (e.key === "ArrowLeft") prevReg();
  }
});