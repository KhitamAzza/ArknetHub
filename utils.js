let listReturnTarget = "mainApp"; // "mainApp" | "faceScanScreen"
// ===== REEL FILTER =====
function filterForReel(students) {
  if (!currentPeriod) return students;
  return students.filter(s => {
    const status = (s.status || "").trim().toUpperCase();
    if (currentPeriod.isPagi) return !["PAGI", "HADIR", "TERLAMBAT", "TELAT"].includes(status);
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
  listReturnTarget = "mainApp";
  const listEl = document.getElementById("studentList");
  listEl.innerHTML = "";

  totalStudents.forEach(s => {
    const sessionStatus = markedStudents.get(s.id);
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
      const idx = allStudents.findIndex(st => st.id=== s.id);
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
  if (listReturnTarget === "faceScanScreen") {
    mainApp.style.display = "none"; // keep reel hidden
    // faceScanScreen stays flex underneath
  } else {
    mainApp.style.display = "flex";
  }
}
// ===== SAFE IndexedDB Cache (additive only) =====
const CACHE_DB_NAME = 'EkskulCache_v1';
const CACHE_STORE = 'kv';

async function safeCacheOpen() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(CACHE_DB_NAME, 1);
    r.onupgradeneeded = (e) => {
      if (!e.target.result.objectStoreNames.contains(CACHE_STORE)) {
        e.target.result.createObjectStore(CACHE_STORE);
      }
    };
    r.onsuccess = (e) => res(e.target.result);
    r.onerror = (e) => rej(e);
  });
}

async function safeCacheGet(key) {
  try {
    const db = await safeCacheOpen();
    return new Promise((res) => {
      const tx = db.transaction(CACHE_STORE, 'readonly');
      const store = tx.objectStore(CACHE_STORE);
      const getReq = store.get(key);
      getReq.onsuccess = (e) => res(e.target.result || null);
      getReq.onerror = () => res(null);
    });
  } catch (e) {
    return null;
  }
}

async function safeCacheSet(key, value) {
  try {
    const db = await safeCacheOpen();
    const tx = db.transaction(CACHE_STORE, 'readwrite');
    tx.objectStore(CACHE_STORE).put(value, key);
  } catch (e) {
    // silent fail
  }
}

function safeCacheKey(...parts) {
  return parts.join('_');
}