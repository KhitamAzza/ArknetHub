// ============================================
// faceScan.js — Face Recognition Attendance Module
// Multi-face detection, localStorage persistence, batch submit
// ============================================

// ===== FACE SCAN STATE =====
let faceDescriptors = [];      // RAM cache from Database sheet
let faceScanned = new Map();   // nama → {status, timestamp, kelas, ekstra}
let faceAlreadySubmitted = new Set(); // names already in today's sheet
let faceVideoStream = null;
let faceRecognitionInterval = null;
let faceCameraFacing = 'environment';
let faceVideoDevices = [];
let faceModelsLoaded = false;
let faceScanScreenActive = false;
let faceLocalStorageKey = "";
let faceLastDetected = new Map(); // nama → timestamp (debounce dupes)
const FACE_DEBOUNCE_MS = 3000;    // 3s cooldown between scans of same person
const FACE_THRESHOLD = 0.6;
const FACE_MODEL_URL = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model';
const EXCLUDE_CAM_TERMS = ['wide', 'ultra', 'tele', 'macro', 'depth', '0.5x', '2x', '3x'];

// ===== DOM REFS (lazy init) =====
function getFaceRefs() {
  return {
    screen: document.getElementById("faceScanScreen"),
    video: document.getElementById("faceVideo"),
    canvas: document.getElementById("faceCanvas"),
    statsBar: document.getElementById("faceStatsBar"),
    scannedList: document.getElementById("faceScannedList"),
    emptyScanned: document.getElementById("faceEmptyScanned"),
    btnSimpan: document.getElementById("faceBtnSimpan"),
    btnBatal: document.getElementById("faceBtnBatal"),
    btnSwitchCam: document.getElementById("faceBtnSwitchCam"),
    loadingOverlay: document.getElementById("faceLoadingOverlay"),
    loadingText: document.getElementById("faceLoadingText"),
    statTotal: document.getElementById("faceStatTotal"),
    statSudah: document.getElementById("faceStatSudah"),
    statBelum: document.getElementById("faceStatBelum"),
    statSudahSheet: document.getElementById("faceStatSudahSheet")
  };
}

// ===== SCREEN NAVIGATION =====
function showFaceID() {
  const refs = getFaceRefs();
  if (!refs.screen) {
    showStatus("Face Scan screen not found", "error");
    return;
  }
  // Hide other screens
  dashboardScreen.style.display = "none";
  absenMenuScreen.style.display = "none";
  mainApp.style.display = "none";
  listScreen.style.display = "none";

  refs.screen.style.display = "flex";
  faceScanScreenActive = true;
  initFaceScan();
}

function hideFaceScan() {
  const refs = getFaceRefs();
  stopFaceCamera();
  faceScanScreenActive = false;
  if (refs.screen) refs.screen.style.display = "none";
}

function backFromFaceScan() {
  hideFaceScan();
  if (currentMode) {
    if (isHelper) {
      showHelperScreen();
    } else {
      backToAbsenMenu();
    }
  } else {
    if (isHelper) {
      showHelperScreen();
    } else {
      showDashboard();
    }
  }
}

// ===== INIT =====
async function initFaceScan() {
  const refs = getFaceRefs();
  const today = getJakartaDateString();
  faceLocalStorageKey = "faceScan_" + today + "_" + (currentEkstra || "MASTER");

  showFaceLoading("Memuat model pengenalan wajah...");

  // 1. Models
  if (!faceModelsLoaded) {
    try {
      await faceapi.nets.tinyFaceDetector.loadFromUri(FACE_MODEL_URL);
      await faceapi.nets.faceLandmark68Net.loadFromUri(FACE_MODEL_URL);
      await faceapi.nets.faceRecognitionNet.loadFromUri(FACE_MODEL_URL);
      faceModelsLoaded = true;
    } catch (err) {
      showFaceLoadingError("Gagal memuat model: " + err.message);
      return;
    }
  }

  // 2. Single bundle load (replaces 3 separate calls)
  showFaceLoading("Memuat data siswa...");
  try {
    const bundle = await loadBundle();
    if (!bundle) throw new Error("No bundle");

    faceDescriptors = bundle.faceDescriptors || [];
    currentPeriod = bundle.period;
    totalStudents = bundle.students || [];

    // Build submitted set
    faceAlreadySubmitted.clear();
    (bundle.todayLog || []).forEach(nama => faceAlreadySubmitted.add(nama));

    // Sheet status
    sheetStatus.clear();
    totalStudents.forEach(s => { if (s.status) sheetStatus.set(s.nama, s.status); });

  } catch (err) {
    showFaceLoadingError("Gagal memuat data: " + err.message);
    return;
  }

  // 3. Restore session
  restoreFaceSession();

  // 4. Start camera
  hideFaceLoading();
  await startFaceCamera();
  updateFaceStats();
  renderFaceScannedList();
}


// ===== LOAD FACE DATABASE =====
async function loadFaceDatabase() {
  const isMaster = currentEkstra === "MASTER";
  const ekstraParam = isMaster ? "MASTER" : currentEkstra;

  const res = await fetch(API_URL + "?action=getFaceDatabase&ekstra=" + encodeURIComponent(ekstraParam));
  const data = await res.json();

  if (data.status !== "ok") {
    throw new Error(data.message || "Gagal memuat data wajah");
  }

  faceDescriptors = [];
  const students = data.students || [];

  for (const s of students) {
    if (s.faceId && Array.isArray(s.faceId) && s.faceId.length === 128) {
      faceDescriptors.push({
        nama: s.nama,
        kelas: s.kelas,
        ekstra: s.ekstra,
        descriptor: s.faceId
      });
    }
  }

  console.log("Loaded " + faceDescriptors.length + " face descriptors");
}

// ===== LOAD CURRENT PERIOD (+ SHEET STATUS) =====
async function loadCurrentPeriod() {
  const isMaster = currentEkstra === "MASTER";
  const ekstraParam = isMaster ? "MASTER" : currentEkstra;
  const today = getJakartaDateString();

  const res = await fetch(API_URL + "?action=getStudentsByEkstra&ekstra=" + encodeURIComponent(ekstraParam) + "&date=" + encodeURIComponent(today));
  const data = await res.json();

  if (data.status !== "ok") {
    throw new Error(data.message || "Gagal memuat periode");
  }

  currentPeriod = {
    isPagi: data.isPagiPeriod,
    isEkstra: data.isEkstraPeriod,
    isOutside: data.isOutsideHours
  };

  let fetched = data.data || [];
  if (!isMaster) {
    fetched = fetched.filter(s => s.ekstra && s.ekstra.toLowerCase() === currentEkstra.toLowerCase());
  }

  totalStudents = fetched;
  sheetStatus.clear();
  fetched.forEach(s => { if (s.status) sheetStatus.set(s.nama, s.status); });
}

// ===== LOAD TODAY'S SUBMITTED =====
async function loadTodaySubmitted() {
  const today = getJakartaDateString();
  const res = await fetch(API_URL + "?action=getLogAbsen&date=" + encodeURIComponent(today));
  const data = await res.json();

  faceAlreadySubmitted.clear();
  if (data.status === "ok" && data.data) {
    for (const entry of data.data) {
      if (entry.nama) faceAlreadySubmitted.add(entry.nama.trim());
    }
  }
}

// ===== LOCALSTORAGE =====
function restoreFaceSession() {
  faceScanned.clear();
  try {
    const saved = localStorage.getItem(faceLocalStorageKey);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (item.nama) faceScanned.set(item.nama, item);
        }
      }
    }
  } catch (e) {
    console.warn("Failed to restore face session:", e);
  }
}

function saveFaceSession() {
  try {
    const arr = Array.from(faceScanned.values());
    localStorage.setItem(faceLocalStorageKey, JSON.stringify(arr));
  } catch (e) {
    console.warn("Failed to save face session:", e);
  }
}

function clearFaceSession() {
  faceScanned.clear();
  try {
    localStorage.removeItem(faceLocalStorageKey);
  } catch (e) {}
}

// ===== CAMERA =====
async function enumerateFaceCameras() {
  try {
    const tempStream = await navigator.mediaDevices.getUserMedia({ video: true });
    tempStream.getTracks().forEach(t => t.stop());
  } catch (e) {
    showStatus("Izin kamera ditolak", "error");
    return;
  }
  const devices = await navigator.mediaDevices.enumerateDevices();
  faceVideoDevices = devices.filter(d => d.kind === "videoinput");
}

async function getFaceCameraStream(facing) {
  if (faceVideoDevices.length === 0) await enumerateFaceCameras();
  const isRear = facing === 'environment';

  if (faceVideoDevices.length > 0 && faceVideoDevices[0].label) {
    let target = null;
    const terms = isRear
      ? ['back', 'rear', 'environment', 'belakang']
      : ['front', 'user', 'depan', 'selfie', 'facetime'];

    for (const device of faceVideoDevices) {
      const label = device.label.toLowerCase();
      if (EXCLUDE_CAM_TERMS.some(t => label.includes(t))) continue;
      for (const term of terms) {
        if (label.includes(term)) { target = device; break; }
      }
      if (target) break;
    }

    if (!target) {
      target = faceVideoDevices[isRear ? faceVideoDevices.length - 1 : 0];
    }

    if (target) {
      try {
        return await navigator.mediaDevices.getUserMedia({
          video: { deviceId: { exact: target.deviceId }, width: { ideal: 1280 }, height: { ideal: 720 } }
        });
      } catch (e) {}
    }
  }

  try {
    return await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { exact: isRear ? 'environment' : 'user' }, width: { ideal: 1280 }, height: { ideal: 720 } }
    });
  } catch (e) {}

  try {
    return await navigator.mediaDevices.getUserMedia({
      video: { facingMode: isRear ? 'environment' : 'user', width: { ideal: 1280 }, height: { ideal: 720 } }
    });
  } catch (e) {}

  return await navigator.mediaDevices.getUserMedia({
    video: { width: { ideal: 1280 }, height: { ideal: 720 } }
  });
}

async function startFaceCamera() {
  const refs = getFaceRefs();
  try {
    faceVideoStream = await getFaceCameraStream(faceCameraFacing);
    refs.video.srcObject = faceVideoStream;
    refs.video.addEventListener("play", startFaceRecognition);
  } catch (err) {
    showStatus("Tidak dapat mengakses kamera: " + err.message, "error");
  }
}

function stopFaceCamera() {
  if (faceRecognitionInterval) {
    clearInterval(faceRecognitionInterval);
    faceRecognitionInterval = null;
  }
  if (faceVideoStream) {
    faceVideoStream.getTracks().forEach(t => t.stop());
    faceVideoStream = null;
  }
  const refs = getFaceRefs();
  if (refs.video) {
    refs.video.srcObject = null;
    refs.video.removeEventListener("play", startFaceRecognition);
  }
  if (refs.canvas) {
    const ctx = refs.canvas.getContext("2d");
    ctx.clearRect(0, 0, refs.canvas.width, refs.canvas.height);
  }
}

function switchFaceCamera() {
  faceCameraFacing = faceCameraFacing === 'environment' ? 'user' : 'environment';
  stopFaceCamera();
  startFaceCamera();
}

// ===== FACE RECOGNITION =====
function startFaceRecognition() {
  const refs = getFaceRefs();
  const video = refs.video;
  const canvas = refs.canvas;
  const ctx = canvas.getContext("2d");

  canvas.width = video.videoWidth || 640;
  canvas.height = video.videoHeight || 480;

  faceRecognitionInterval = setInterval(async () => {
    if (video.paused || video.ended || !faceScanScreenActive) return;

    const detections = await faceapi.detectAllFaces(
      video,
      new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.5 })
    ).withFaceLandmarks().withFaceDescriptors();

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (detections.length === 0) {
      ctx.fillStyle = "rgba(100, 116, 139, 0.7)";
      ctx.font = "bold 16px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("👤 Tidak ada wajah terdeteksi", canvas.width / 2, canvas.height / 2);
      return;
    }

    const now = Date.now();

    for (const det of detections) {
      const box = det.detection.box;
      const liveDesc = Array.from(det.descriptor);

      let bestMatch = null;
      let bestDist = Infinity;

      for (const stored of faceDescriptors) {
        const dist = euclideanDistance(liveDesc, stored.descriptor);
        if (dist < bestDist) {
          bestDist = dist;
          bestMatch = stored;
        }
      }

      let label, boxColor, textColor, status;

      if (faceDescriptors.length === 0) {
        label = "📭 Database kosong";
        boxColor = "#f59e0b";
        textColor = "#fbbf24";
        status = "empty";
      } else if (bestMatch && bestDist < FACE_THRESHOLD) {
        const confidence = ((1 - bestDist) * 100).toFixed(0);
        const nama = bestMatch.nama;

        if (faceAlreadySubmitted.has(nama)) {
          label = "✅ " + nama + " — Sudah Absen";
          boxColor = "#10b981";   // green
          textColor = "#86efac";
          status = "submitted";
        } else if (faceScanned.has(nama)) {
          label = "🟠 " + nama + " — Sudah Scan";
          boxColor = "#f59e0b";   // orange
          textColor = "#fcd34d";
          status = "scanned";
        } else {
          label = "🔵 " + nama + " (" + confidence + "%)";
          boxColor = "#3b82f6";   // blue
          textColor = "#93c5fd";
          status = "new";

          // Debounce: only add if not seen in last 3 seconds
          const lastSeen = faceLastDetected.get(nama);
          if (!lastSeen || (now - lastSeen > FACE_DEBOUNCE_MS)) {
            faceLastDetected.set(nama, now);
            addFaceScan(bestMatch);
          }
        }
      } else {
        label = "❌ Tidak Dikenal";
        boxColor = "#ef4444";     // red
        textColor = "#fca5a5";
        status = "unknown";
      }

      // Draw box
      ctx.strokeStyle = boxColor;
      ctx.lineWidth = 3;
      ctx.strokeRect(box.x, box.y, box.width, box.height);

      // Draw label background
      ctx.font = "bold 15px sans-serif";
      const textWidth = ctx.measureText(label).width;
      const padding = 8;
      ctx.fillStyle = "rgba(15, 23, 42, 0.9)";
      ctx.fillRect(box.x, box.y - 32, textWidth + padding * 2, 28);

      // Draw label text
      ctx.fillStyle = textColor;
      ctx.textAlign = "left";
      ctx.fillText(label, box.x + padding, box.y - 10);
    }
  }, 500);
}

function euclideanDistance(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    sum += (a[i] - b[i]) * (a[i] - b[i]);
  }
  return Math.sqrt(sum);
}

// ===== ADD SCAN =====
function addFaceScan(student) {
  if (!currentPeriod || currentPeriod.isOutside) {
    showStatus("Di luar jam absensi", "error");
    return;
  }

  let status = "HADIR";
  if (currentPeriod.isPagi) {
    status = "PAGI";
  } else if (currentPeriod.isEkstra) {
    const sheetVal = sheetStatus.get(student.nama) || "";
    status = (sheetVal === "PAGI") ? "HADIR" : "TERLAMBAT";
  }

  faceScanned.set(student.nama, {
    nama: student.nama,
    kelas: student.kelas,
    ekstra: student.ekstra,
    status: status,
    timestamp: new Date().toISOString()
  });

  saveFaceSession();
  updateFaceStats();
  renderFaceScannedList();

  // Visual feedback
  showStatus("✓ " + student.nama, "ok");
}

// ===== STATS =====
function updateFaceStats() {
  const refs = getFaceRefs();
  const total = totalStudents.length || faceDescriptors.length;
  const sudahSheet = faceAlreadySubmitted.size;
  const sudahScan = faceScanned.size;
  const sudahTotal = sudahSheet + sudahScan;
  const belum = Math.max(0, total - sudahTotal);

  if (refs.statTotal) refs.statTotal.textContent = total;
  if (refs.statSudah) refs.statSudah.textContent = sudahScan;
  if (refs.statBelum) refs.statBelum.textContent = belum;
  if (refs.statSudahSheet) refs.statSudahSheet.textContent = sudahSheet;
}

// ===== SCANNED LIST =====
function renderFaceScannedList() {
  const refs = getFaceRefs();
  const list = refs.scannedList;
  const empty = refs.emptyScanned;

  if (!list) return;

  const scans = Array.from(faceScanned.values());

  if (scans.length === 0) {
    list.innerHTML = "";
    if (empty) empty.style.display = "block";
    return;
  }

  if (empty) empty.style.display = "none";

  // Sort by timestamp desc
  scans.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  list.innerHTML = scans.map(s => `
    <div class="face-scanned-item">
      <div class="face-scanned-avatar">👤</div>
      <div class="face-scanned-info">
        <div class="face-scanned-name">${escapeHtml(s.nama)}</div>
        <div class="face-scanned-meta">${escapeHtml(s.kelas)} • ${escapeHtml(s.status)}</div>
      </div>
      <button class="face-scanned-remove" onclick="removeFaceScan('${escapeHtml(s.nama)}')" title="Hapus">✕</button>
    </div>
  `).join("");
}

function removeFaceScan(nama) {
  faceScanned.delete(nama);
  saveFaceSession();
  updateFaceStats();
  renderFaceScannedList();
}

// ===== SUBMIT =====
async function submitFaceScans() {
  if (faceScanned.size === 0) {
    showStatus("Belum ada siswa yang discan", "error");
    return;
  }

  const refs = getFaceRefs();
  if (refs.btnSimpan) refs.btnSimpan.disabled = true;
  showLoading(true);

  try {
    const scans = [];
    const now = new Date().toISOString();
    const today = getJakartaDateString();

    faceScanned.forEach((data, nama) => {
      scans.push({
        nama: data.nama,
        status: data.status,
        timestamp: now,
        date: today
      });
    });

    const payload = {
      action: "reelSubmit",
      scans: scans,
      operator: currentOperator,
      mode: "FACE",
      ekstra: currentEkstra
    };

    const res = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload)
    });

    const data = await res.json();

clearBundle(); 
    if (data.status === "ok") {
      showStatus("✓ " + data.processed + " data terkirim", "ok");
      clearFaceSession();
      faceScanned.clear();
      updateFaceStats();
      renderFaceScannedList();
      // Refresh submitted set
      await loadTodaySubmitted();
      updateFaceStats();
    } else {
      showStatus(data.message || "Gagal mengirim", "error");
    }
  } catch (err) {
    console.error(err);
    showStatus("Error koneksi: " + err.message, "error");
  }

  showLoading(false);
  if (refs.btnSimpan) refs.btnSimpan.disabled = false;
}

function batalFaceScan() {
  if (faceScanned.size > 0) {
    if (!confirm("Batalkan semua scan? Data belum tersimpan akan hilang.")) return;
  }
  clearFaceSession();
  faceScanned.clear();
  backFromFaceScan();
}

// ===== LOADING OVERLAY =====
function showFaceLoading(text) {
  const refs = getFaceRefs();
  if (refs.loadingOverlay) {
    refs.loadingOverlay.style.display = "flex";
    refs.loadingOverlay.classList.add("visible");
  }
  if (refs.loadingText) refs.loadingText.textContent = text || "Memuat...";
}

function hideFaceLoading() {
  const refs = getFaceRefs();
  if (refs.loadingOverlay) {
    refs.loadingOverlay.style.display = "none";
    refs.loadingOverlay.classList.remove("visible");
  }
}

function showFaceLoadingError(msg) {
  const refs = getFaceRefs();
  if (refs.loadingText) {
    refs.loadingText.innerHTML = `<span style="color:var(--red);">❌ ${escapeHtml(msg)}</span><br><button class="btn-primary" style="margin-top:16px;" onclick="initFaceScan()">Coba Lagi</button>`;
  }
}

// ===== UTILS =====
function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text || "";
  return div.innerHTML;
}