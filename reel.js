const AUTO_SUBMIT_THRESHOLD = 20;

// ===== MARK LABEL =====
function getMarkLabel(student) {
  if (markedStudents.has(student.id)) {
    return "❌ Batal";
  }
  if (!currentPeriod || currentPeriod.isOutside) return "Tutup";
  if (currentPeriod.isPagi) return "PAGI";
  if (currentPeriod.isEkstra) {
    const sheetVal = sheetStatus.get(student.id) || "";
    return (sheetVal === "PAGI") ? "HADIR" : "TERLAMBAT";
  }
  return "HADIR";
}

// ===== STATS BAR =====
function updateStats() {
  const total = totalStudents.length;
    const hadir = totalStudents.filter(s => {
    const status = (s.status || "").trim().toUpperCase();
    const sessionMark = markedStudents.has(s.id);
    if (sessionMark) return true;
    if (currentPeriod?.isPagi) return ["PAGI", "HADIR", "TERLAMBAT", "TELAT"].includes(status);
    if (currentPeriod?.isEkstra) return ["HADIR", "TERLAMBAT"].includes(status);
    return false;
  }).length;
  const belum = total - hadir;

  const statTotal = document.getElementById("statTotal");
  const statHadir = document.getElementById("statHadir");
  const statBelum = document.getElementById("statBelum");
  const subHadir = document.getElementById("subHadir");
  const subBelum = document.getElementById("subBelum");

  if (statTotal) statTotal.textContent = total;
  if (statHadir) statHadir.textContent = hadir;
  if (statBelum) statBelum.textContent = belum;
  if (subHadir) subHadir.textContent = total ? Math.round((hadir / total) * 100) + "%" : "0%";
  if (subBelum) subBelum.textContent = total ? Math.round((belum / total) * 100) + "%" : "0%";
}

// ===== CARD RENDER =====
function renderCard(index) {
  reelContainer.querySelectorAll(".student-card").forEach(c => c.remove());

  if (!allStudents || allStudents.length === 0 || index < 0 || index >= allStudents.length) {
    if (!allStudents || allStudents.length === 0) emptyState.style.display = "block";
    updateMarkButton();
    return;
  }

  emptyState.style.display = "none";

  const card = createCard(allStudents[index]);
  card.style.position = "relative";
  card.style.zIndex = "10";
  reelContainer.appendChild(card);
  setupSwipe(card);

  if (index + 1 < allStudents.length) {
    const preview = createCard(allStudents[index + 1], true);
    preview.style.cssText = "position:absolute;top:0;left:12px;right:12px;bottom:0;margin:auto;height:fit-content;transform:scale(0.92) translateY(10px);opacity:0.35;z-index:0;pointer-events:none;";
    reelContainer.appendChild(preview);
  }

  updateMarkButton();
}

function createCard(student, isPreview = false) {
  const card = document.createElement("div");
  const isMarked = markedStudents.has(student.id);

  card.className = "student-card";
  if (isMarked) card.classList.add("hadir");

  const markStyle = isMarked
    ? 'style="background:rgba(239,68,68,0.15);color:var(--red);box-shadow:0 4px 15px rgba(239,68,68,0.2);"'
    : "";

  card.innerHTML = `
    <div class="card-photo-container">
      ${student.foto
        ? `<img class="card-photo" src="${student.foto}" alt="${student.nama}" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';">`
        : ""
      }
      <div class="card-photo-placeholder" style="display:${student.foto ? 'none' : 'flex'}">👤</div>
      <div class="card-hadir-overlay"></div>
      <div class="card-hadir-badge">✅</div>
    </div>
    <div class="card-info">
      <div class="card-name">${student.nama}</div>
      <div class="card-meta">📚 Kelas ${student.kelas}</div>
      <div class="card-ekstra">${student.ekstra}</div>
    </div>
    ${!isPreview ? `
    <div class="card-actions">
      <button class="btn-mark" id="cardMarkBtn" onclick="markCurrentStudent()" ${markStyle}>${getMarkLabel(student)}</button>
    </div>
    ` : ""}
  `;

  return card;
}

function updateMarkButton() {
  if (!markBtn) return;
  const student = allStudents[currentIndex];
  if (!student) {
    markBtn.textContent = "Tidak ada siswa";
    markBtn.disabled = true;
    return;
  }
  markBtn.textContent = getMarkLabel(student);
  markBtn.disabled = !currentPeriod || currentPeriod.isOutside;
}

// ===== NAVIGATION =====
function nextStudent() {
  if (currentIndex < allStudents.length - 1) {
    currentIndex++;
    renderCard(currentIndex);
  } else {
    showStatus("Siswa terakhir", "info");
    showSummary();
  }
}

function prevStudent() {
  if (currentIndex > 0) {
    currentIndex--;
    renderCard(currentIndex);
  } else {
    showStatus("Siswa pertama", "info");
  }
}

// ===== SWIPE NAVIGATION =====
function setupSwipe(card) {
  let startX = 0, currentX = 0, isDragging = false;

  const onStart = (x) => { startX = x; isDragging = true; card.style.transition = "none"; };
  const onMove = (x) => {
    if (!isDragging) return;
    currentX = x - startX;
    
    const isFirst = currentIndex === 0;
    const isLast = currentIndex >= allStudents.length - 1;
    
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

    const isFirst = currentIndex === 0;
    const isLast = currentIndex >= allStudents.length - 1;

    if (currentX > 80) {
      if (isFirst) {
        card.style.transform = "";
        showStatus("Siswa pertama", "info");
      } else {
        card.classList.add("swiping-right");
        setTimeout(() => { card.remove(); prevStudent(); }, 250);
      }
    } else if (currentX < -80) {
      if (isLast) {
        card.style.transform = "";
        showStatus("Siswa terakhir", "info");
      } else {
        card.classList.add("swiping-left");
        setTimeout(() => { card.remove(); nextStudent(); }, 250);
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

// ===== MARK ATTENDANCE =====
function markCurrentStudent() {
  const student = allStudents[currentIndex];
  if (!student) return;
  if (!currentPeriod || currentPeriod.isOutside) {
    showStatus("Di luar jam absensi", "error");
    return;
  }

  // UNMARK
  if (markedStudents.has(student.id)) {
    markedStudents.delete(student.id);
    showStatus("❌ Batal", "error");
    renderCard(currentIndex);
    updateStats();
    return;
  }

  // MARK
  let status = "HADIR";
  if (currentPeriod.isPagi) {
    status = "PAGI";
  } else if (currentPeriod.isEkstra) {
    const sheetVal = sheetStatus.get(student.id) || "";
    status = (sheetVal === "PAGI") ? "HADIR" : "TERLAMBAT";
  }

  markedStudents.set(student.id, status);
  updateStats();

  // Re-render immediately so button shows "❌ Batal" & card shows green border
  renderCard(currentIndex);

  // Auto-submit check
  if (markedStudents.size >= AUTO_SUBMIT_THRESHOLD && !isSubmitting) {
    showStatus(`📤 ${markedStudents.size} data, auto-mengirim...`, "info");
    submitAttendance();
    return;
  }

  // Animate card away and advance to next student
  setTimeout(() => {
    const card = reelContainer.querySelector(".student-card:not([style*='opacity:0.35'])");
    if (card) {
      card.classList.add("swiping-left");
    }

    setTimeout(() => {
      allStudents = allStudents.filter(s => !markedStudents.has(s.id));
      if (allStudents.length === 0) {
        showSummary();
        return;
      }
      if (currentIndex >= allStudents.length) currentIndex = allStudents.length - 1;
      renderCard(currentIndex);
    }, 300);
  }, 400);
}

// ===== SUMMARY MODAL =====
function showSummary() {
    const done = totalStudents.filter(s => {
    const status = (s.status || "").trim().toUpperCase();
    const session = markedStudents.has(s.id);
    if (session) return true;
    if (currentPeriod?.isPagi) return ["PAGI", "HADIR", "TERLAMBAT", "TELAT"].includes(status);
    if (currentPeriod?.isEkstra) return ["HADIR", "TERLAMBAT"].includes(status);
    return false;
  });

  const pending = totalStudents.filter(s => !done.includes(s));

  let html = "";

  html += `<div class="summary-section">
    <div class="summary-section-title done">✓ SUDAH ABSEN (${done.length})</div>
    ${done.length ? done.map(s => `
      <div class="summary-item">
        ${s.foto ? `<img src="${s.foto}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';">` : `<div class="summary-avatar">👤</div>`}
        <div class="summary-item-name">${s.nama}</div>
        <div class="summary-item-class">${s.kelas}</div>
      </div>
    `).join("") : "<div style='color:var(--text-secondary);font-size:13px;'>Belum ada</div>"}
  </div>`;

  html += `<div class="summary-section">
    <div class="summary-section-title pending">✗ BELUM ABSEN (${pending.length})</div>
    ${pending.length ? pending.map(s => `
      <div class="summary-item">
        ${s.foto ? `<img src="${s.foto}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';">` : `<div class="summary-avatar">👤</div>`}
        <div class="summary-item-name">${s.nama}</div>
        <div class="summary-item-class">${s.kelas}</div>
      </div>
    `).join("") : "<div style='color:var(--text-secondary);font-size:13px;'>Semua sudah absen! 🎉</div>"}
  </div>`;

  summaryBody.innerHTML = html;
  summaryModal.classList.add("visible");
}

function closeSummary() {
  summaryModal.classList.remove("visible");
}

function submitFromSummary() {
  closeSummary();
  submitAttendance();
}

// ===== SUBMIT =====
async function submitAttendance() {
  if (isSubmitting) return;
  if (markedStudents.size === 0) {
    showStatus("Belum ada siswa yang diabsen", "error");
    return;
  }

  isSubmitting = true;
  if (kirimBtn) kirimBtn.disabled = true;
  showLoading(true);

  try {
    const today = getJakartaDateString();
    const inserts = [];

        markedStudents.forEach((status, id) => {
      let period = null;
      if (status === "PAGI") period = "PAGI";
      else if (status === "HADIR" || status === "TERLAMBAT") period = "EKSTRA";
      
      if (period) {
        inserts.push({
          student_id: id,
          date: today,
          period: period,
          semester: currentSemester,
          status: status
        });
      }
    });

    if (inserts.length > 0) {
      const { error } = await sb.from('Attendance').insert(inserts);
      if (error) throw error;
    }

    showStatus(`✓ ${markedStudents.size} data tersimpan`, "ok");
    markedStudents.clear();
    clearBundle();
    loadStudents();
    deactivateBackTrap();
  } catch (err) {
    console.error(err);
    showStatus("Error: " + err.message, "error");
  }

  isSubmitting = false;
  if (kirimBtn) kirimBtn.disabled = false;
  showLoading(false);
}