// ===== REGISTRATION STATE =====
let pendingRegistrations = [];
let currentRegIndex = 0;
let sessionMarked = new Map();

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
  if (!currentEkstra || currentEkstra === "MASTER") {
    showStatus("Ekskul tidak dikenali, silakan login ulang", "error");
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
    console.log("[REG] Loading for currentEkstra:", currentEkstra);

    // Fetch ALL pending for this semester first (client-side filter = safer)
    const { data: rows, error } = await sb
      .from('registrations')
      .select('*')
      .eq('status', 'pending')
      .order('created_at', { ascending: true });

    if (error) throw error;

    console.log("[REG] Raw pending rows:", rows?.length || 0, rows);

    // Robust match: trim + case-insensitive
    const target = (currentEkstra || "").trim().toLowerCase();
    const matched = (rows || []).filter(r => {
      const rowEkstra = (r.ekstra || "").trim().toLowerCase();
      return rowEkstra === target;
    });

    console.log("[REG] Matched for", currentEkstra, ":", matched.length);

    pendingRegistrations = matched.map(r => ({
      id: r.id,
      student_id: r.student_id,
      nama: r.nama,
      kelas: r.kelas,
      ekstra: r.ekstra,
      alasan: r.alasan,
      pilihanKe: r.pilihan_ke || 1,
      foto: null
    }));

    // Enrich with photo from Database
    const names = pendingRegistrations.map(r => r.nama);
    if (names.length > 0) {
      const { data: dbRows } = await sb
        .from('Database')
        .select('nama, photo_url')
        .in('nama', names);
      const photoMap = {};
      (dbRows || []).forEach(d => photoMap[d.nama] = d.photo_url);
      pendingRegistrations.forEach(r => r.foto = photoMap[r.nama] || null);
    }

    currentRegIndex = 0;
    sessionMarked.clear();
    updateRegStats();

    if (pendingRegistrations.length === 0) {
      renderRegCard(-1);
      if (regEmptyState) regEmptyState.style.display = "block";
    } else {
      if (regEmptyState) regEmptyState.style.display = "none";
      renderRegCard(currentRegIndex);
    }
  } catch (err) {
    console.error("[REG] Error:", err);
    showStatus("Error memuat pendaftar: " + err.message, "error");
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
  if (regReelContainer) regReelContainer.querySelectorAll(".student-card").forEach(c => c.remove());

  if (!pendingRegistrations || pendingRegistrations.length === 0 || index < 0 || index >= pendingRegistrations.length) {
    if ((!pendingRegistrations || pendingRegistrations.length === 0) && regEmptyState) {
      regEmptyState.style.display = "block";
    }
    return;
  }

  if (regEmptyState) regEmptyState.style.display = "none";
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

  if (regReelContainer) regReelContainer.appendChild(card);
  setupRegSwipe(card);

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
    if (regReelContainer) regReelContainer.appendChild(preview);
  }
}

// ===== MARK REGISTRATION =====
function markCurrentReg(decision) {
  const reg = pendingRegistrations[currentRegIndex];
  if (!reg) return;

  if (sessionMarked.has(reg.nama)) {
    if (sessionMarked.get(reg.nama) === decision) {
      sessionMarked.delete(reg.nama);
      showStatus("Batal " + (decision === "approved" ? "menerima" : "menolak"), "info");
    } else {
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
    if (isFirst && currentX > 0) currentX = currentX / 3;
    else if (isLast && currentX < 0) currentX = currentX / 3;
    card.style.transform = `translateX(${currentX}px) rotate(${currentX * 0.04}deg)`;
  };
  const onEnd = () => {
    if (!isDragging) return;
    isDragging = false;
    card.style.transition = "transform 0.25s cubic-bezier(0.4,0,0.2,1), opacity 0.25s ease";
    const isFirst = currentRegIndex === 0;
    const isLast = currentRegIndex >= pendingRegistrations.length - 1;

    if (currentX > 100) {
      if (isFirst) { card.style.transform = ""; showStatus("Pendaftar pertama", "info"); }
      else { card.classList.add("swiping-right"); setTimeout(() => { prevReg(); }, 250); }
    } else if (currentX < -100) {
      if (isLast) { card.style.transform = ""; showStatus("Pendaftar terakhir", "info"); }
      else { card.classList.add("swiping-left"); setTimeout(() => { nextReg(); }, 250); }
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

  showLoading(true);
  let approvedCount = 0;
  let rejectedCount = 0;

  try {
    for (const [nama, decision] of sessionMarked) {
      const reg = pendingRegistrations.find(r => r.nama === nama);
      if (!reg) continue;

      if (decision === 'approved') {
        const { error: regErr } = await sb
          .from('registrations')
          .update({ status: 'approved', operator: currentOperator, processed_at: new Date().toISOString() })
          .eq('id', reg.id);
        if (regErr) throw regErr;

        const { error: dbErr } = await sb
          .from('Database')
          .update({ ekstra: reg.ekstra })
          .eq('id', reg.student_id);
        if (dbErr) throw dbErr;

        approvedCount++;
      } else if (decision === 'rejected') {
        const { error: regErr } = await sb
          .from('registrations')
          .update({ status: 'rejected', operator: currentOperator, processed_at: new Date().toISOString() })
          .eq('id', reg.id);
        if (regErr) throw regErr;
        rejectedCount++;
      }
    }

    showStatus(`✓ ${approvedCount} diterima, ${rejectedCount} ditolak`, "ok");
    sessionMarked.clear();
    loadRegistrations();
    updateRegBadge();
  } catch (err) {
    showStatus("Error: " + err.message, "error");
  }
  showLoading(false);
}

// Keyboard nav
document.addEventListener("keydown", (e) => {
  if (registrationScreen && registrationScreen.style.display !== "none") {
    if (e.key === "ArrowRight") nextReg();
    if (e.key === "ArrowLeft") prevReg();
  }
});