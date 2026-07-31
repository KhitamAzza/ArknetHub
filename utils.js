// ===== REEL FILTER =====
function filterForReel(students) {
  if (!currentPeriod) return students;
  return students.filter(s => {
    const status = (s.status || "").trim();
    if (currentPeriod.isPagi) return !["PAGI", "HADIR", "TERLAMBAT"].includes(status);
    if (currentPeriod.isEkstra) return !["HADIR", "TERLAMBAT"].includes(status);
    return true;
  });
}

// ===== BUTTON LABEL =====
function getMarkLabel(student) {
  if (!currentPeriod || currentPeriod.isOutside) return "⏳ Di luar jam";
  return "Absen siswa";
}

// ===== LIST VIEW =====
function showList() {
  const listEl = document.getElementById("studentList");
  listEl.innerHTML = "";

  totalStudents.forEach(s => {
    const sessionStatus = markedStudents.get(s.nama);
    const sheetVal = s.status;
    const isDone = !!sessionStatus || !!sheetVal;
    const displayStatus = sessionStatus || sheetVal || "BELUM";

    const item = document.createElement("div");
    item.className = "list-item " + (isDone ? "hadir" : "belum");
    item.innerHTML = `
      <img class="list-item-photo" src="${s.foto || ""}" loading="lazy" onerror="this.style.display='none'">
      <div class="list-item-info">
        <div class="list-item-name">${s.nama}</div>
        <div class="list-item-class">${s.kelas} • ${s.ekstra}</div>
      </div>
      <div class="list-item-status ${isDone ? "hadir" : "belum"}">${displayStatus}</div>
    `;
    item.onclick = () => {
      hideList();
      const idx = allStudents.findIndex(st => st.nama === s.nama);
      if (idx >= 0) {
        currentIndex = idx;
        renderCard(currentIndex);
      } else {
        showStatus("Siswa sudah selesai diabsen", "info");
      }
    };
    listEl.appendChild(item);
  });

  mainApp.style.display = "none";
  listScreen.style.display = "flex";
}

function hideList() {
  listScreen.style.display = "none";
  mainApp.style.display = "flex";
}