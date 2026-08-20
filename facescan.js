// ============================================
// faceScan.js — Face Recognition Attendance Module
// Multi-face detection, localStorage persistence, batch submit
// ============================================

// ===== FACE SCAN STATE =====
let faceDescriptors = [];      // RAM cache from Database sheet
let faceScanned = new Map();   // nama → {status, timestamp, kelas, ekstra}
let faceAlreadySubmitted = new Set(); // names already in today's sheet
let faceUnsentQueue = [];      // Queue of scans not yet confirmed by server
let faceSyncedNames = new Set();  // Names confirmed saved on backend
let faceVideoStream = null;
let faceRecognitionInterval = null;
let faceCameraFacing = 'environment';
let faceVideoDevices = [];
let faceModelsLoaded = false;
let faceScanScreenActive = false;
let faceLocalStorageKey = "";
let faceLastDetected = new Map(); // nama → timestamp (debounce dupes)
let isSendingChunk = false;
const FACE_DEBOUNCE_MS = 3000;
// const FACE_THRESHOLD = 0.6;
let faceThreshold = 0.6;   // mutable, will be overwritten by Config sheet
const CHUNK_SIZE = 20;
const FACE_MODEL_URL = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model';
const EXCLUDE_CAM_TERMS = ['wide', 'ultra', 'tele', 'macro', 'depth', '0.5x', '2x', '3x'];
const CONFIRM_FRAMES = 3;      // Need 3 consecutive good matches
let facePendingConfirm = new Map(); // nama → {count, data}
let verifyMode = 'list'; // 'list' | 'photo'

// ===== DOM REFS (lazy init) =====
function getFaceRefs() {
  return {
    screen: document.getElementById("faceScanScreen"),
    video: document.getElementById("faceVideo"),
    canvas: document.getElementById("faceCanvas"),
    ribbon: document.getElementById("faceScanRibbon"),
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
  activateBackGuard('face');   // ← ADD THIS
  activateBackTrap('face');
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
    backToAbsenMenu();
  } else {
    if (isHelper) {
      showHelperScreen();
    } else if (currentOperator && currentOperator.startsWith("Ketua ")) {
      showKetuaDashboard();
    } else if (isMaster) {
      showAdminScreen();
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

  // 2. Load bundle (roster + period, no face descriptors)
  showFaceLoading("Memuat data siswa...");
  try {
    const bundle = await loadBundle();
    if (!bundle) throw new Error("No bundle");

    currentPeriod = bundle.period;
    totalStudents = bundle.students || [];

    sheetStatus.clear();
    totalStudents.forEach(s => {
      if (s.status) sheetStatus.set(s.nama, s.status);
    });

    faceAlreadySubmitted.clear();
    totalStudents.forEach(s => {
      const st = (sheetStatus.get(s.nama) || "").trim();
      if (!st) return;

      if (currentPeriod?.isPagi && ["PAGI", "HADIR", "TERLAMBAT"].includes(st)) {
        faceAlreadySubmitted.add(s.nama);
      } else if (currentPeriod?.isEkstra && ["HADIR", "TERLAMBAT"].includes(st)) {
        faceAlreadySubmitted.add(s.nama);
      }
    });
  } catch (err) {
    showFaceLoadingError("Gagal memuat data: " + err.message);
    return;
  }

  // 2.5. Respect threshold from Config sheet
  try {
    const cfg = await fetchJsonWithRetry(API_URL + "?action=getConfig");
    if (cfg.status === "ok" && typeof cfg.threshold === "number") {
      faceThreshold = cfg.threshold;
      console.log("Face threshold set from config:", faceThreshold);
    }
  } catch (e) {
    console.warn("Could not load config threshold, using default:", faceThreshold);
  }

  // 3. Load face descriptors separately
  showFaceLoading("Memuat data wajah...");
  try {
    await loadFaceDatabase();
  } catch (err) {
    showFaceLoadingError("Gagal memuat wajah: " + err.message);
    return;
  }

  // 4. Restore session from crash/refresh
  restoreFaceSession();
  faceUnsentQueue = Array.from(faceScanned.values());
  faceSyncedNames.clear();

  // 5. Auto-resume sending pending scans
  if (faceUnsentQueue.length > 0) {
    submitFaceChunk();
  }

  // 6. Start camera
  hideFaceLoading();
  await startFaceCamera();
  updateFaceStats();
  renderFaceScannedList();
  updateVerifyPanel();   // ← DESKTOP PANEL: initial render
}
// ===== LOAD FACE DATABASE =====
async function loadFaceDatabase() {
  const isMaster = currentEkstra === "MASTER";
  const ekstraParam = isMaster ? "MASTER" : currentEkstra;

  const data = await fetchJsonWithRetry(API_URL + "?action=getFaceDatabase&ekstra=" + encodeURIComponent(ekstraParam));

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

  const data = await fetchJsonWithRetry(API_URL + "?action=getStudentsByEkstra&ekstra=" + encodeURIComponent(ekstraParam) + "&date=" + encodeURIComponent(today));

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
  const data = await fetchJsonWithRetry(API_URL + "?action=getLogAbsen&date=" + encodeURIComponent(today));

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
async function submitFaceChunk() {
  if (isSendingChunk || faceUnsentQueue.length === 0) return;
  isSendingChunk = true;
  showLoading(true);

  const btn = document.getElementById("faceBtnSimpan");
  if (btn) btn.disabled = true;

  const chunk = faceUnsentQueue.slice(0, CHUNK_SIZE);
  const today = getJakartaDateString();
  const scans = chunk.map(s => ({
    nama: s.nama,
    status: s.status,
    timestamp: s.timestamp,
    date: today
  }));

  try {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({
        action: "reelSubmit",
        scans: scans,
        operator: currentOperator,
        mode: "FACE",
        ekstra: currentEkstra
      })
    });

    const data = await res.json();

    if (data.status === "ok") {
      faceUnsentQueue.splice(0, chunk.length);
      chunk.forEach(s => faceSyncedNames.add(s.nama));
      clearBundle();
      updateVerifyPanel();   // ← DESKTOP PANEL: sync status updated

      if (faceUnsentQueue.length >= CHUNK_SIZE) {
        isSendingChunk = false;
        submitFaceChunk(); // next chunk, loading stays on
        return;
      }
    } else {
      console.error("Auto-send failed:", data.message);
      showStatus("Auto-kirim gagal: " + data.message, "error");
    }
  } catch (err) {
    console.error("Auto-send error:", err);
    showStatus("Koneksi bermasalah, akan dicoba lagi", "error");
  }

  isSendingChunk = false;
  showLoading(false);
  if (btn) btn.disabled = false;
  updateFaceStats();
  renderFaceScannedList();
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
  hideFaceRibbon(refs);
}

function switchFaceCamera() {
  faceCameraFacing = faceCameraFacing === 'environment' ? 'user' : 'environment';
  stopFaceCamera();
  startFaceCamera();
}

// ===== SCAN STATUS RIBBON =====
// Big banner above the camera showing current scan state (replaces the
// small on-box label). Purely visual — does not affect scan logic.
function setFaceRibbon(refs, stateClass, line1, line2) {
  if (!refs.ribbon) return;
  refs.ribbon.className = "face-scan-ribbon visible " + stateClass;
  refs.ribbon.innerHTML = line2
    ? escapeHtml(line1) + '<div class="ribbon-sub">' + escapeHtml(line2) + '</div>'
    : escapeHtml(line1);
}

function hideFaceRibbon(refs) {
  if (!refs.ribbon) return;
  refs.ribbon.classList.remove("visible");
}

// ===== FACE RECOGNITION =====
function startFaceRecognition() {
  const refs = getFaceRefs();
  const video = refs.video;
  const canvas = refs.canvas;
  const ctx = canvas.getContext("2d");

  faceRecognitionInterval = setInterval(async () => {
    if (video.paused || video.ended || !faceScanScreenActive) return;

    // Safety guard: Wait until the camera stream initializes its width/height
    if (!video.videoWidth || !video.videoHeight) return;

    // Define the dimensions and match the canvas overlay layout
    const displaySize = { width: video.videoWidth, height: video.videoHeight };
    faceapi.matchDimensions(canvas, displaySize);

    const detections = await faceapi.detectAllFaces(
      video,
      new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.6 })
    ).withFaceLandmarks().withFaceDescriptors();

    // 🔥 FIX: Map face coordinate tracking matrices directly onto the canvas size
    const resizedDetections = faceapi.resizeResults(detections, displaySize);

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const now = Date.now();
    const confirmedThisFrame = new Set();

    if (resizedDetections.length === 0) {
      hideFaceRibbon(refs);
      facePendingConfirm.clear();
      return;
    }

    // Loop through resized detections instead of the raw ones
    for (const det of resizedDetections) {
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

      let boxColor;
      let reticleCount = null; // null = no countdown shown, just a full locked ring

      if (faceDescriptors.length === 0) {
        boxColor = "#f59e0b";
        setFaceRibbon(refs, "state-scanning", "Database wajah kosong");
      } else if (bestMatch && bestDist < faceThreshold) {
        const confidence = ((1 - bestDist) * 100);
        const nama = bestMatch.nama;
        confirmedThisFrame.add(nama);

        // ── ALREADY SUBMITTED ──
        if (faceAlreadySubmitted.has(nama)) {
          boxColor = "#10b981";
          setFaceRibbon(refs, "state-success", "Siswa sudah di scan", nama + " - " + bestMatch.kelas);
        }
        // ── ALREADY SCANNED THIS SESSION ──
        else if (faceScanned.has(nama)) {
          boxColor = "#10b981";
          setFaceRibbon(refs, "state-success", "Siswa sudah di scan", nama + " - " + bestMatch.kelas);
        }
        // ── BUILDING CONFIDENCE (3-frame lock) ──
        else {
          const pending = facePendingConfirm.get(nama);
          let count = 1;
          if (pending) count = pending.count + 1;
          facePendingConfirm.set(nama, { count, data: bestMatch });

          if (count < CONFIRM_FRAMES) {
            boxColor = "#f59e0b";
            reticleCount = count;
            setFaceRibbon(refs, "state-scanning", "Tahan jangan bergerak", count + "/" + CONFIRM_FRAMES);
          } else {
            // ── LOCKED IN ──
            boxColor = "#3b82f6";
            reticleCount = count;
            setFaceRibbon(refs, "state-success", "Scan berhasil", nama + " - " + bestMatch.kelas);

            const lastSeen = faceLastDetected.get(nama);
            if (!lastSeen || (now - lastSeen > FACE_DEBOUNCE_MS)) {
              faceLastDetected.set(nama, now);
              addFaceScan(bestMatch);
            }
            facePendingConfirm.delete(nama);
          }
        }
      } else {
        boxColor = "#ef4444";
        setFaceRibbon(refs, "state-danger", "Wajah tidak dikenali");
      }

      // Draw animated target-lock reticle aligned with the resized viewport coordinates
      drawReticle(ctx, box, boxColor, now, { count: reticleCount, max: CONFIRM_FRAMES });
    }

    // Clear pending for faces that disappeared this frame
    for (const [nama] of facePendingConfirm) {
      if (!confirmedThisFrame.has(nama)) {
        facePendingConfirm.delete(nama);
      }
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

// // ===== RETICLE (target-lock circle: sweep progress + countdown + pulsing glow) =====
// function drawReticle(ctx, box, color, now, opts = {}) {
//   const { x, y, width: w, height: h } = box;
//   const cx = x + w / 2;
//   const cy = y + h / 2;
//   const radius = (Math.max(w, h) / 2) * 1.15;

//   const count = opts.count ?? null;          // null = no countdown (idle/locked states)
//   const max = opts.max || CONFIRM_FRAMES;
//   const progress = count !== null ? Math.min(count / max, 1) : 1; // full ring when not counting

//   // Pulse: breathing glow driven by a sine wave (period ~1.2s)
//   const pulse = (Math.sin((now / 600) * Math.PI) + 1) / 2; // 0..1
//   const glow = 6 + pulse * 12;   // 6..18 px blur
//   const alpha = 0.8 + pulse * 0.2; // 0.8..1.0

//   ctx.save();

//   // Outer ring — thin dashed guide, full 360°, distinct from inner sweep stroke
//   ctx.beginPath();
//   ctx.setLineDash([5, 5]);
//   ctx.lineWidth = 2;
//   ctx.strokeStyle = color;
//   ctx.globalAlpha = 0.5;
//   ctx.shadowBlur = 0;
//   ctx.arc(cx, cy, radius, 0, Math.PI * 2);
//   ctx.stroke();
//   ctx.setLineDash([]); // reset dash so it doesn't leak into other draws

//   // Inner sweep — solid progress arc, starts at 12 o'clock, sweeps clockwise
//   ctx.beginPath();
//   ctx.lineWidth = 5;
//   ctx.lineCap = "round";
//   ctx.strokeStyle = color;
//   ctx.globalAlpha = alpha;
//   ctx.shadowColor = color;
//   ctx.shadowBlur = glow;
//   const startAngle = -Math.PI / 2;
//   const endAngle = startAngle + Math.PI * 2 * progress;
//   ctx.arc(cx, cy, radius - 7, startAngle, endAngle);
//   ctx.stroke();

//   ctx.restore();

//   // Center countdown number (1, 2, 3...) while locking on
//   if (count !== null) {
//     ctx.save();
//     ctx.font = "bold 30px sans-serif";
//     ctx.textAlign = "center";
//     ctx.textBaseline = "middle";
//     ctx.fillStyle = color;
//     ctx.shadowColor = color;
//     ctx.shadowBlur = 10;
//     ctx.globalAlpha = alpha;
//     ctx.fillText(String(count), cx, cy);
//     ctx.restore();
//   }
// }
// ===== RETICLE (crosshair: corner brackets + center cross + outside badge) =====
function drawReticle(ctx, box, color, now, opts = {}) {
  const { x, y, width: w, height: h } = box;
  const cx = x + w / 2;
  const cy = y + h / 2;
  const count = opts.count ?? null;
  const max = opts.max || CONFIRM_FRAMES;
  const progress = count !== null ? Math.min(count / max, 1) : 1;

  // Pulse animation for glow
  const pulse = (Math.sin((now / 600) * Math.PI) + 1) / 2;
  const glow = 10 + pulse * 14;

  ctx.save();

  ctx.shadowColor = color;
  ctx.shadowBlur = glow;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 5;          // 🔥 thicker
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  const inset = 6;            // gap inside box edge
  const ext   = 8;            // how far brackets stick outside the box
  const arm   = Math.min(w, h) * 0.22;

  // --- 1. Corner brackets (crosshair style) ---
  // Top-left
  ctx.beginPath();
  ctx.moveTo(x - ext, y + inset);
  ctx.lineTo(x + arm, y + inset);
  ctx.moveTo(x + inset, y - ext);
  ctx.lineTo(x + inset, y + arm);
  ctx.stroke();

  // Top-right
  ctx.beginPath();
  ctx.moveTo(x + w + ext, y + inset);
  ctx.lineTo(x + w - arm, y + inset);
  ctx.moveTo(x + w - inset, y - ext);
  ctx.lineTo(x + w - inset, y + arm);
  ctx.stroke();

  // Bottom-left
  ctx.beginPath();
  ctx.moveTo(x - ext, y + h - inset);
  ctx.lineTo(x + arm, y + h - inset);
  ctx.moveTo(x + inset, y + h + ext);
  ctx.lineTo(x + inset, y + h - arm);
  ctx.stroke();

  // Bottom-right
  ctx.beginPath();
  ctx.moveTo(x + w + ext, y + h - inset);
  ctx.lineTo(x + w - arm, y + h - inset);
  ctx.moveTo(x + w - inset, y + h + ext);
  ctx.lineTo(x + w - inset, y + h - arm);
  ctx.stroke();

  // --- 2. Center cross (+) with gap so the face stays visible ---
  const crossLen = Math.min(w, h) * 0.14;
  const gap = 5;
  ctx.beginPath();
  // Horizontal
  ctx.moveTo(cx - crossLen, cy);
  ctx.lineTo(cx - gap, cy);
  ctx.moveTo(cx + gap, cy);
  ctx.lineTo(cx + crossLen, cy);
  // Vertical
  ctx.moveTo(cx, cy - crossLen);
  ctx.lineTo(cx, cy - gap);
  ctx.moveTo(cx, cy + gap);
  ctx.lineTo(cx, cy + crossLen);
  ctx.stroke();

  // --- 3. Tiny progress arc on top edge (keeps the "filling up" feel) ---
  if (count !== null && count > 0) {
    ctx.lineWidth = 4;
    ctx.beginPath();
    const arcR = Math.min(w, h) * 0.10;
    const startA = -Math.PI / 2;
    const endA = startA + Math.PI * 2 * progress;
    ctx.arc(cx, y + inset, arcR, startA, endA);
    ctx.stroke();
  }

  // --- 4. Count badge OUTSIDE the box (above center) ---
  if (count !== null) {
    const badgeR = 16;
    const badgeY = y - 28;

    // Connector line
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(cx, y - 4);
    ctx.lineTo(cx, badgeY + badgeR);
    ctx.stroke();

    // Circle badge
    ctx.shadowBlur = glow * 0.6;
    ctx.globalAlpha = 0.95;
    ctx.beginPath();
    ctx.arc(cx, badgeY, badgeR, 0, Math.PI * 2);
    ctx.fill();

    // Number text
    ctx.shadowBlur = 0;
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 15px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.globalAlpha = 1;
    ctx.fillText(String(count), cx, badgeY);
  }

  ctx.restore();
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

  const scanData = {
    nama: student.nama,
    kelas: student.kelas,
    ekstra: student.ekstra,
    status: status,
    timestamp: new Date().toISOString()
  };

  faceScanned.set(student.nama, scanData);
  faceUnsentQueue.push(scanData);

  saveFaceSession();
  updateFaceStats();
  renderFaceScannedList();
   updateVerifyPanel(); 

  // Auto-send when queue hits threshold
  if (faceUnsentQueue.length >= CHUNK_SIZE) {
    submitFaceChunk();
  }

  showStatus("✓ " + student.nama, "ok");
}

// ===== STATS =====
function updateFaceStats() {
  const refs = getFaceRefs();
  const total = totalStudents.length;

  // FIX: Only count students in the CURRENT ekskul/class
  const sudahSheet = totalStudents.filter(s => faceAlreadySubmitted.has(s.nama)).length;
  const sudahScan = Array.from(faceScanned.keys()).filter(n => 
    totalStudents.some(s => s.nama === n)
  ).length;

  // Unique "done" count — avoid double-counting if a student is both in sheet AND scanned
  const sudahSet = new Set();
  totalStudents.forEach(s => { 
    if (faceAlreadySubmitted.has(s.nama)) sudahSet.add(s.nama); 
  });
  faceScanned.forEach((_, nama) => {
    if (totalStudents.some(s => s.nama === nama)) sudahSet.add(nama);
  });
  const belum = Math.max(0, total - sudahSet.size);

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

  scans.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  list.innerHTML = scans.map(s => {
    const isSynced = faceSyncedNames.has(s.nama);
    const isPending = faceUnsentQueue.some(u => u.nama === s.nama);
    const icon = isSynced ? "🟢" : isPending ? "🟠" : "⚪";
    const meta = isSynced ? "Tersimpan" : isPending ? "Menunggu..." : "Baru";

    return `
      <div class="face-scanned-item">
        <div class="face-scanned-avatar">${icon}</div>
        <div class="face-scanned-info">
          <div class="face-scanned-name">${escapeHtml(s.nama)}</div>
          <div class="face-scanned-meta">${escapeHtml(s.kelas)} • ${escapeHtml(s.status)} • ${meta}</div>
        </div>
        <button class="face-scanned-remove" onclick="removeFaceScan('${escapeHtml(s.nama)}')" title="Hapus">✕</button>
      </div>
    `;
  }).join("");
}

function removeFaceScan(nama) {
  faceScanned.delete(nama);
  faceSyncedNames.delete(nama);
  faceUnsentQueue = faceUnsentQueue.filter(s => s.nama !== nama);
  saveFaceSession();
  updateFaceStats();
  renderFaceScannedList();
  updateVerifyPanel();
}
// ===== SUBMIT =====
async function submitFaceScans() {
  const btn = document.getElementById("faceBtnSimpan");
  if (btn) btn.disabled = true;

  // 1. Flush any remaining queue first
  if (faceUnsentQueue.length > 0) {
    await submitFaceChunk();
  }

  // 2. If queue still has items (failed), don't clear anything
  if (faceUnsentQueue.length > 0) {
    showStatus("Beberapa data gagal dikirim, coba lagi", "error");
    if (btn) btn.disabled = false;
    return;
  }

  if (faceScanned.size === 0) {
    showStatus("Belum ada siswa yang discan", "error");
    if (btn) btn.disabled = false;
    return;
  }

  showStatus("✓ Semua data terkirim", "ok");
  clearFaceSession();
  faceScanned.clear();
  faceUnsentQueue = [];
  faceSyncedNames.clear();
  updateFaceStats();
  renderFaceScannedList();
  updateVerifyPanel(); 
  await loadTodaySubmitted();
  updateFaceStats();

  if (btn) btn.disabled = false;
}

function batalFaceScan() {
  const unsentCount = faceUnsentQueue.length;
  if (unsentCount > 0) {
    if (!confirm(`Batalkan? ${unsentCount} siswa belum terkirim dan akan hilang.`)) return;
  }
  clearFaceSession();
  faceScanned.clear();
  faceUnsentQueue = [];
  faceSyncedNames.clear();
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
function showFaceScanList() {
  listReturnTarget = "faceScanScreen";
  const listEl = document.getElementById("studentList");
  const screen = document.getElementById("listScreen");
  if (!listEl || !screen) return;

  listEl.innerHTML = "";

  // Sort: not done first, then alphabetical
  const sorted = [...totalStudents].sort((a, b) => {
    const aDone = faceAlreadySubmitted.has(a.nama) || faceScanned.has(a.nama);
    const bDone = faceAlreadySubmitted.has(b.nama) || faceScanned.has(b.nama);
    if (aDone !== bDone) return aDone ? 1 : -1;
    return a.nama.localeCompare(b.nama);
  });

  sorted.forEach(s => {
    const isSubmitted = faceAlreadySubmitted.has(s.nama);
    const isScanned = faceScanned.has(s.nama);
    const isDone = isSubmitted || isScanned;

    let displayStatus = "BELUM";
    if (isSubmitted) {
      displayStatus = sheetStatus.get(s.nama) || "HADIR";
    } else if (isScanned) {
      displayStatus = faceScanned.get(s.nama)?.status || "SCAN";
    }

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
    // No onclick — Face Scan is read-only list, just close with ✕
    listEl.appendChild(item);
  });

  screen.style.display = "flex";
}
// ===== DESKTOP VERIFICATION PANEL =====
function setVerifyMode(mode) {
  verifyMode = mode;
  document.getElementById('verifyToggleList')?.classList.toggle('active', mode === 'list');
  document.getElementById('verifyTogglePhoto')?.classList.toggle('active', mode === 'photo');
  document.getElementById('verifyContentList') && (document.getElementById('verifyContentList').style.display = mode === 'list' ? 'block' : 'none');
  document.getElementById('verifyContentPhoto') && (document.getElementById('verifyContentPhoto').style.display = mode === 'photo' ? 'block' : 'none');
  updateVerifyPanel();
}

function updateVerifyPanel() {
  const panel = document.getElementById('verifyPanel');
  if (!panel || getComputedStyle(panel).display === 'none') return;
  verifyMode === 'list' ? renderVerifyList() : renderVerifyPhoto();
}

function renderVerifyList() {
  const container = document.getElementById('verifyListLarge');
  if (!container) return;

  const scans = Array.from(faceScanned.values()).sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  if (scans.length === 0) {
    container.innerHTML = `<div class="verify-empty"><div class="verify-empty-icon">📭</div><div>Belum ada siswa terdeteksi</div></div>`;
    return;
  }

  container.innerHTML = scans.map(s => {
    const isSynced = faceSyncedNames.has(s.nama);
    const db = totalStudents.find(st => st.nama === s.nama);
    const foto = db?.foto || '';
    return `
      <div class="verify-item">
        ${foto 
          ? `<img class="verify-item-photo" src="${foto}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';"><div class="verify-item-photo-placeholder" style="display:none;">👤</div>`
          : `<div class="verify-item-photo-placeholder">👤</div>`
        }
        <div class="verify-item-info">
          <div class="verify-item-name">${escapeHtml(s.nama)}</div>
          <div class="verify-item-meta">${escapeHtml(s.kelas)} • ${escapeHtml(s.ekstra || currentEkstra || '-')}</div>
        </div>
        <div class="verify-item-status">${isSynced ? '✓ Tersimpan' : '⏳ Menunggu'}</div>
      </div>
    `;
  }).join('');
}

function renderVerifyPhoto() {
  const emptyEl = document.getElementById('verifyPhotoEmpty');
  const cardEl = document.getElementById('verifyPhotoCard');
  const imgEl = document.getElementById('verifyPhotoImg');
  const fallbackEl = document.getElementById('verifyPhotoFallback');
  if (!emptyEl || !cardEl) return;

  const scans = Array.from(faceScanned.values());
  if (scans.length === 0) {
    emptyEl.style.display = 'flex';
    cardEl.style.display = 'none';
    return;
  }

  const last = scans.reduce((a, b) => new Date(a.timestamp) > new Date(b.timestamp) ? a : b);
  const db = totalStudents.find(st => st.nama === last.nama);
  const foto = db?.foto || '';

  emptyEl.style.display = 'none';
  cardEl.style.display = 'flex';

  if (imgEl) {
    imgEl.style.display = 'block';
    imgEl.src = foto;
    imgEl.onerror = function() { this.style.display = 'none'; fallbackEl && (fallbackEl.style.display = 'flex'); };
    imgEl.onload = function() { fallbackEl && (fallbackEl.style.display = 'none'); };
  }

  const nameEl = document.getElementById('verifyPhotoName');
  const classEl = document.getElementById('verifyPhotoClass');
  const ekstraEl = document.getElementById('verifyPhotoEkstra');
  const statusEl = document.getElementById('verifyPhotoStatus');

  if (nameEl) nameEl.textContent = last.nama;
  if (classEl) classEl.textContent = last.kelas;
  if (ekstraEl) ekstraEl.textContent = last.ekstra || currentEkstra || '-';
  if (statusEl) statusEl.textContent = last.status;
}

// ===== UTILS =====
function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text || "";
  return div.innerHTML;
}
