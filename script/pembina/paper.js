// ============================================
// paper.js — Pembina: Upload Bukti Foto
// Rewritten: no refusals, no waiting, Blob-based upload
// ============================================

const CLOUDINARY_CLOUD_NAME = 'ddccvdnye';
const CLOUDINARY_UPLOAD_PRESET = 'arknet_unsigned';
// Paste a NEW Discord webhook URL here (rotate the old one, it was exposed in client code)
const DISCORD_WEBHOOK_URL = 'https://discord.com/api/webhooks/1544902348013445192/4iW09eBki6GHsJ6rn2iL8SQNBNIYfaKmTL-2yHfKhfH6uONt9jdU3n5vX4xGDmW9X7u8';

const PAPER_MAX_WIDTH = 1200;   // longest side after resize
const PAPER_JPEG_QUALITY = 0.8;
const PAPER_UPLOAD_TIMEOUT = 60000; // 60s per attempt (slow mobile signal)

let paperStudents = [];
let paperCapturedImage = null;   // object URL used for preview + corner check
let paperUploadBlob = null;      // the actual file that gets uploaded
let paperVideoStream = null;
let paperCameraFacing = 'environment';
let paperSourceMode = null; // 'camera' | 'file'
let paperAllowAppCamera = true; // from Config.allow_app_camera
let paperConfig = {}; // cached Config row

/* ===== PHOTO STATE HELPERS ===== */
function setPaperPhoto(blob) {
  clearPaperPhoto();
  paperUploadBlob = blob;
  paperCapturedImage = URL.createObjectURL(blob);
}

function clearPaperPhoto() {
  if (paperCapturedImage) {
    try { URL.revokeObjectURL(paperCapturedImage); } catch (e) {}
  }
  paperCapturedImage = null;
  paperUploadBlob = null;
}

/* ===== SCREEN NAVIGATION ===== */
function showPaperScreen() {
  hideAllScreens();
  const el = document.getElementById("paperScreen");
  if (el) {
    el.style.display = "flex";
    initPaperScreen();
  }
}

function backToDashboardFromPaper() {
  stopPaperCamera();
  paperSourceMode = null;
  clearPaperPhoto();

  const fileInput = document.getElementById('paperFileInput');
  if (fileInput) fileInput.value = '';

  hideAllScreens();
  showDashboard();
}

async function loadPaperCameraConfig() {
  try {
    const { data, error } = await sb
      .from('Config')
      .select('allow_app_camera, mulai_pengumpulan, batas_pengumpulan_absensi, omr_require_corners, upload_backend')
      .single();
    if (error) throw error;
    paperConfig = data || {};
    paperAllowAppCamera = paperConfig.allow_app_camera !== false;
  } catch (e) {
    paperConfig = {};
    paperAllowAppCamera = true;
  }
}

async function initPaperScreen() {
  await Promise.all([loadPaperStudents(), loadPaperCameraConfig()]);
  renderPaperPrint();
  await syncPaperUploadCounters();

  const btnPrint = document.getElementById('paperTabPrint');
  const titleEl = document.querySelector('#paperScreen .operator-name');

  if (isMaster) {
    // Admin sees both tabs (print + upload)
    if (btnPrint) btnPrint.style.display = '';
    if (titleEl) titleEl.textContent = 'Cetak & Upload Absensi';
    switchPaperTab('print');
  } else {
    // Pembina: only upload
    if (btnPrint) btnPrint.style.display = 'none';
    if (titleEl) titleEl.textContent = 'Upload Absensi';
    switchPaperTab('camera');
  }
}

/* ===== LOAD STUDENTS ===== */
async function loadPaperStudents() {
  showLoading(true);
  try {
    const { data, error } = await sb
      .from('Database')
      .select('id, nama, kelas, photo_url')
      .eq('ekstra', currentEkstra)
      .order('nama');
    if (error) throw error;
    paperStudents = data || [];
  } catch (e) {
    console.error(e);
    paperStudents = [];
  }
  showLoading(false);
}

/* ===== TABS ===== */
function switchPaperTab(tab) {
  const btnPrint = document.getElementById('paperTabPrint');
  const btnCam   = document.getElementById('paperTabCamera');
  const secPrint = document.getElementById('paperPrintSection');
  const secCam   = document.getElementById('paperCameraSection');

  if (btnPrint) btnPrint.classList.toggle('active', tab === 'print');
  if (btnCam)   btnCam.classList.toggle('active', tab === 'camera');
  if (secPrint) secPrint.style.display = tab === 'print' ? 'block' : 'none';
  if (secCam)   secCam.style.display = tab === 'camera' ? 'flex' : 'none';

  if (tab === 'camera') {
    showPaperSourceSelect();
  } else {
    stopPaperCamera();
  }
}

/* ===== PRINT SECTION ===== */
function renderPaperPrint() {
  const container = document.getElementById('paperPrintArea');
  if (!container) return;

  const dateStr = getJakartaDateString();
  const semStr  = currentSemester || '-';
  const totalStudents = paperStudents.length;
  const pagesNeeded = Math.max(1, Math.ceil(totalStudents / 30));

  // Show page count banner
  const bannerHtml = `
    <div style="background:var(--card);border:1px solid var(--border);border-radius:14px;padding:14px 16px;margin-bottom:12px;display:flex;align-items:center;gap:12px;">
      <div style="font-size:24px;">📄</div>
      <div style="flex:1;">
        <div style="font-size:14px;font-weight:700;">${totalStudents} siswa = ${pagesNeeded} lembar</div>
        <div style="font-size:12px;color:var(--text-secondary);margin-top:2px;">Harap upload semua ${pagesNeeded} lembar ke sistem</div>
      </div>
      <div style="background:var(--accent);color:#fff;font-size:13px;font-weight:800;padding:6px 12px;border-radius:20px;min-width:32px;text-align:center;" id="paperUploadCounter">0/${pagesNeeded}</div>
    </div>
  `;

  const pageBanner = document.getElementById('paperPageBanner');
  if (pageBanner) pageBanner.innerHTML = bannerHtml;

  const cameraBanner = document.getElementById('paperCameraBanner');
  if (cameraBanner) {
    const camText = cameraBanner.querySelector('#paperCameraBannerText');
    const camCounter = cameraBanner.querySelector('#paperCameraUploadCounter');
    if (camText) camText.textContent = `${totalStudents} siswa = ${pagesNeeded} lembar`;
    if (camCounter) camCounter.textContent = `0/${pagesNeeded}`;
    cameraBanner.style.display = 'flex';
  }

  const rows = paperStudents.map((s, i) => `
    <tr>
      <td style="border:1px solid #333;padding:6px;text-align:center;">${i+1}</td>
      <td style="border:1px solid #333;padding:6px;">${escapeHtml(s.nama)}</td>
      <td style="border:1px solid #333;padding:6px;text-align:center;">${escapeHtml(s.kelas)}</td>
      <td style="border:1px solid #333;padding:6px;text-align:center;"><span style="display:inline-block;width:10px;height:10px;border:1.5px solid #333;"></span></td>
      <td style="border:1px solid #333;padding:6px;text-align:center;"><span style="display:inline-block;width:10px;height:10px;border:1.5px solid #333;"></span></td>
      <td style="border:1px solid #333;padding:6px;text-align:center;"><span style="display:inline-block;width:10px;height:10px;border:1.5px solid #333;"></span></td>
      <td style="border:1px solid #333;padding:6px;text-align:center;"><span style="display:inline-block;width:10px;height:10px;border:1.5px solid #333;"></span></td>
      <td style="border:1px solid #333;padding:6px;text-align:center;"><span style="display:inline-block;width:10px;height:10px;border:1.5px solid #333;"></span></td>
      <td style="border:1px solid #333;padding:6px;text-align:center;"><span style="display:inline-block;width:10px;height:10px;border:1.5px solid #333;"></span></td>
      <td style="border:1px solid #333;padding:6px;text-align:center;font-weight:700;">${i+1}</td>
    </tr>
  `).join('');

  container.innerHTML = `
    <div class="paper-sheet" id="paperSheet">
      <div class="paper-corner tl"></div>
      <div class="paper-corner tr"></div>
      <div class="paper-corner bl"></div>
      <div class="paper-corner br"></div>

      <div class="paper-header">
        <h2>DAFTAR HADIR EKSTRAKURIKULER</h2>
        <div class="paper-meta">
          <div><strong>Ekskul:</strong> ${escapeHtml(currentEkstra)}</div>
          <div><strong>Tanggal:</strong> ${dateStr}</div>
          <div><strong>Semester:</strong> ${semStr}</div>
        </div>
      </div>

      <table class="paper-table" style="width:100%;border-collapse:collapse;margin-top:16px;">
        <thead>
          <tr style="background:#f0f0f0;">
            <th style="border:1px solid #333;padding:8px;width:40px;" rowspan="2">No</th>
            <th style="border:1px solid #333;padding:8px;" rowspan="2">Nama Siswa</th>
            <th style="border:1px solid #333;padding:8px;width:80px;" rowspan="2">Kelas</th>
            <th style="border:1px solid #333;padding:8px;" colspan="6">Kehadiran</th>
            <th style="border:1px solid #333;padding:8px;width:40px;" rowspan="2">No</th>
          </tr>
          <tr style="background:#f0f0f0;">
            <th style="border:1px solid #333;padding:8px;width:36px;">PAGI</th>
            <th style="border:1px solid #333;padding:8px;width:36px;">EKSTRA</th>
            <th style="border:1px solid #333;padding:8px;width:36px;">PAGI</th>
            <th style="border:1px solid #333;padding:8px;width:36px;">EKSTRA</th>
            <th style="border:1px solid #333;padding:8px;width:36px;">PAGI</th>
            <th style="border:1px solid #333;padding:8px;width:36px;">EKSTRA</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>

      <div class="paper-footer">
        <div class="paper-signature">
          <div>Mengetahui,</div>
          <div style="margin-top:60px;">(_______________________)</div>
          <div>Pembina Ekskul</div>
        </div>
      </div>
    </div>
  `;
}

// Pull the real number of pages already uploaded today so the counters
// don't reset to 0/N every time the pembina reopens the app.
async function syncPaperUploadCounters() {
  if (!currentEkstra) return;
  try {
    const { data, error } = await sb
      .from('AttendanceProof')
      .select('page')
      .eq('ekstra', currentEkstra)
      .eq('date', getJakartaDateString())
      .eq('semester', currentSemester);
    if (error) throw error;

    const uploadedCount = (data || []).length;

    ['paperUploadCounter', 'paperCameraUploadCounter'].forEach(id => {
      const counterEl = document.getElementById(id);
      if (!counterEl) return;
      const total = parseInt(counterEl.textContent.split('/')[1]) || 1;
      counterEl.textContent = uploadedCount + '/' + total;
      counterEl.style.background = uploadedCount >= total ? 'var(--green)' : '';
    });
  } catch (e) {
    // non-critical, counters just stay at their rendered default
  }
}

function printPaper() {
  const sheet = document.getElementById('paperSheet');
  if (!sheet) return;

  const printWindow = window.open('', '_blank');
  printWindow.document.write(`
    <html>
      <head>
        <title>Cetak Absensi</title>
        <style>
          @page { size: A4; margin: 10mm; }
          * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; color-adjust: exact !important; }
          body { font-family: Arial, sans-serif; color: #000; background: #fff; margin: 0; }
          .paper-sheet { width: 190mm; min-height: 277mm; position: relative; padding: 20mm; box-sizing: border-box; margin: 0 auto; }
          .paper-corner { position: absolute; width: 15mm; height: 15mm; background: #000; }
          .paper-corner.tl { top: 10mm; left: 10mm; }
          .paper-corner.tr { top: 10mm; right: 10mm; }
          .paper-corner.bl { bottom: 10mm; left: 10mm; }
          .paper-corner.br { bottom: 10mm; right: 10mm; }
          .paper-header { text-align: center; margin-bottom: 20px; }
          .paper-header h2 { margin: 0 0 8px; font-size: 18px; }
          .paper-meta { display: flex; justify-content: space-between; font-size: 12px; margin-top: 12px; }
          .paper-table th, .paper-table td { font-size: 12px; }
          .paper-table tbody tr:nth-child(even) { background: #f5f5f5; }
          .paper-footer { margin-top: 40px; display: flex; justify-content: flex-end; }
          .paper-signature { text-align: center; font-size: 12px; width: 200px; }
        </style>
      </head>
      <body>${sheet.outerHTML}</body>
    </html>
  `);
  printWindow.document.close();
  printWindow.focus();
  setTimeout(() => { printWindow.print(); }, 250);
}

/* ===== IMAGE PROCESSING ===== */
// Shrinks any image File/Blob to max PAPER_MAX_WIDTH and returns a JPEG Blob.
// Never throws: if resizing fails for any reason, the ORIGINAL file is returned
// so the upload is never refused because of a decode problem.
async function resizeImageToBlob(file) {
  try {
    let bmp;
    try {
      // Resize while decoding: low memory, fast, applies EXIF rotation
      bmp = await createImageBitmap(file, {
        resizeWidth: PAPER_MAX_WIDTH,
        resizeQuality: 'medium',
        imageOrientation: 'from-image'
      });
    } catch (e) {
      bmp = await createImageBitmap(file); // fallback: no resize option
    }

    const scale = Math.min(1, PAPER_MAX_WIDTH / bmp.width);
    const w = Math.round(bmp.width * scale);
    const h = Math.round(bmp.height * scale);

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    canvas.getContext('2d').drawImage(bmp, 0, 0, w, h);
    if (bmp.close) bmp.close();

    const out = await new Promise(r => canvas.toBlob(r, 'image/jpeg', PAPER_JPEG_QUALITY));
    if (out && out.size > 0) return out;
  } catch (e) {
    console.warn('Resize skipped, using original file:', e);
  }
  return file;
}

/* ===== CAMERA SECTION ===== */
async function startPaperCamera() {
  const video = document.getElementById('paperVideo');
  if (!video) return;
  try {
    paperVideoStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: paperCameraFacing, width: { ideal: 1920 }, height: { ideal: 1080 } }
    });
    video.srcObject = paperVideoStream;
    startExposureCheck();
  } catch (err) {
    showStatus('Tidak dapat mengakses kamera: ' + err.message, 'error');
  }
}

// Toggle front/back camera
async function switchPaperCamera() {
  paperCameraFacing = paperCameraFacing === 'environment' ? 'user' : 'environment';
  stopPaperCamera();

  const video = document.getElementById('paperVideo');
  if (!video) return;

  try {
    paperVideoStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: paperCameraFacing, width: { ideal: 1920 }, height: { ideal: 1080 } }
    });
    video.srcObject = paperVideoStream;
    startExposureCheck();
  } catch (err) {
    // Revert on failure so next tap tries the other side again
    paperCameraFacing = paperCameraFacing === 'environment' ? 'user' : 'environment';
    showStatus('Gagal ganti kamera: ' + err.message, 'error');
  }
}

/* ===== EXPOSURE CHECK ===== */
function checkPaperExposure() {
  const video = document.getElementById('paperVideo');
  const canvas = document.getElementById('paperCaptureCanvas');
  const hint = document.getElementById('paperCameraHint');
  if (!video || !canvas || !video.videoWidth) return;

  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(video, 0, 0);

  const cx = Math.floor(canvas.width / 2);
  const cy = Math.floor(canvas.height / 2);
  const sampleW = Math.floor(canvas.width * 0.3);
  const sampleH = Math.floor(canvas.height * 0.3);

  const imgData = ctx.getImageData(cx - sampleW/2, cy - sampleH/2, sampleW, sampleH).data;
  let total = 0, count = 0;
  for (let i = 0; i < imgData.length; i += 16) {
    total += (imgData[i] + imgData[i+1] + imgData[i+2]) / 3;
    count++;
  }
  const avg = total / count;

  const exposureEl = document.getElementById('paperExposureBadge');
  if (!exposureEl) return;

  if (avg < 40) {
    exposureEl.textContent = '🔅 GELAP';
    exposureEl.style.background = 'rgba(239,68,68,0.2)';
    exposureEl.style.color = 'var(--red)';
    exposureEl.style.display = 'flex';
    if (hint) hint.textContent = 'Pencahayaan terlalu gelap. Nyalakan flash atau pindah ke tempat lebih terang.';
  } else if (avg > 220) {
    exposureEl.textContent = '☀️ TERANG';
    exposureEl.style.background = 'rgba(245,158,11,0.2)';
    exposureEl.style.color = 'var(--yellow)';
    exposureEl.style.display = 'flex';
    if (hint) hint.textContent = 'Pencahayaan terlalu terang. Kurangi cahaya atau jauhkan dari lampu langsung.';
  } else {
    exposureEl.style.display = 'none';
    if (hint) hint.textContent = 'Arahkan kamera ke kertas. Pastikan 4 kotak hitam terlihat di sudut.';
  }
}

let paperExposureInterval = null;
function startExposureCheck() {
  if (paperExposureInterval) clearInterval(paperExposureInterval);
  paperExposureInterval = setInterval(checkPaperExposure, 1500);
}
function stopExposureCheck() {
  if (paperExposureInterval) { clearInterval(paperExposureInterval); paperExposureInterval = null; }
  const el = document.getElementById('paperExposureBadge');
  if (el) el.style.display = 'none';
}
function stopPaperCamera() {
  if (paperVideoStream) {
    paperVideoStream.getTracks().forEach(t => t.stop());
    paperVideoStream = null;
  }
  const video = document.getElementById('paperVideo');
  if (video) video.srcObject = null;
  stopExposureCheck();
}

async function capturePaper() {
  const video  = document.getElementById('paperVideo');
  const canvas = document.getElementById('paperCaptureCanvas');
  const preview = document.getElementById('paperPreview');
  if (!video || !canvas || !video.videoWidth) return;

  // Resize straight from the video frame
  let w = video.videoWidth, h = video.videoHeight;
  if (w > PAPER_MAX_WIDTH) { h = Math.round((PAPER_MAX_WIDTH / w) * h); w = PAPER_MAX_WIDTH; }
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d').drawImage(video, 0, 0, w, h);

  const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', PAPER_JPEG_QUALITY));
  if (!blob) {
    showStatus('Gagal mengambil foto, coba lagi.', 'error');
    return;
  }
  setPaperPhoto(blob);

  // Show preview — fill the portrait container
  if (preview) {
    preview.src = paperCapturedImage;
    preview.style.display = 'block';
  }

  const btnCap = document.getElementById('paperBtnCapture');
  const btnRet = document.getElementById('paperBtnRetake');
  const btnUpl = document.getElementById('paperBtnUpload');
  const hint   = document.getElementById('paperCameraHint');

  if (btnCap) btnCap.style.display = 'none';
  if (btnRet) btnRet.style.display = 'inline-block';
  if (btnUpl) btnUpl.style.display = 'inline-block';
  if (hint)   hint.textContent = 'Review foto di atas. Jika jelas, tap Upload.';
}

function retakePaper() {
  clearPaperPhoto();

  if (paperSourceMode === 'camera') {
    const preview = document.getElementById('paperPreview');
    if (preview) { preview.src = ''; preview.style.display = 'none'; }

    const btnCap = document.getElementById('paperBtnCapture');
    const btnRet = document.getElementById('paperBtnRetake');
    const btnUpl = document.getElementById('paperBtnUpload');
    const hint   = document.getElementById('paperCameraHint');

    if (btnCap) btnCap.style.display = 'inline-block';
    if (btnRet) btnRet.style.display = 'none';
    if (btnUpl) btnUpl.style.display = 'none';
    if (hint)   hint.textContent     = 'Arahkan kamera ke kertas. Pastikan 4 kotak hitam terlihat di sudut.';
  } else if (paperSourceMode === 'file') {
    const previewWrap = document.getElementById('paperFilePreviewWrap');
    const preview     = document.getElementById('paperFilePreview');
    const dropzone    = document.getElementById('paperFileDropzone');
    const controls    = document.getElementById('paperCameraControls');
    const hint        = document.getElementById('paperCameraHint');
    const fileInput   = document.getElementById('paperFileInput');

    if (preview)     preview.src = '';
    if (previewWrap) previewWrap.style.display = 'none';
    if (dropzone)    dropzone.style.display    = 'block';
    if (controls)    controls.style.display    = 'none';
    if (hint)        hint.textContent          = 'Pilih foto yang sudah ada di perangkat Anda.';
    if (fileInput)   fileInput.value           = '';
  }
}

/* ===== UPLOAD — Cloudinary direct browser upload ===== */
// One upload with per-attempt timeout and one automatic retry, so a slow or
// flaky mobile connection shows a brief "trying again" instead of a hard failure.
async function uploadToCloudinaryWithRetry(blob, filename, attempts = 2) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    // Fresh FormData per attempt (a body should not be reused after a failed request)
    const formData = new FormData();
    formData.append('file', blob, filename);
    formData.append('upload_preset', CLOUDINARY_UPLOAD_PRESET);
    formData.append('folder', 'arknet_absensi');

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), PAPER_UPLOAD_TIMEOUT);
    try {
      const uploadRes = await fetch(
        `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`,
        { method: 'POST', body: formData, signal: controller.signal }
      );
      clearTimeout(timeoutId);
      const data = await uploadRes.json();
      if (!data.secure_url) throw new Error(data.error?.message || 'Upload gagal');
      return data;
    } catch (err) {
      clearTimeout(timeoutId);
      lastErr = err;
      if (i < attempts - 1) {
        showStatus('Koneksi lambat, mencoba lagi...', 'info');
        await new Promise(r => setTimeout(r, 800));
      }
    }
  }
  throw new Error(
    lastErr?.name === 'AbortError'
      ? 'Koneksi terlalu lambat, upload dibatalkan. Periksa sinyal internet dan coba lagi.'
      : (lastErr?.message || 'Upload ke server gagal, periksa koneksi internet.')
  );
}

async function uploadPaper() {
  if (!paperCapturedImage && !paperUploadBlob) return;

  const cfg = paperConfig || {};

  // 1. Check upload window from Config
  const now = new Date();
  const jh = parseInt(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Jakarta', hour: 'numeric', hour12: false }).format(now));
  const jm = parseInt(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Jakarta', minute: 'numeric' }).format(now));
  const tv = jh + (jm / 100);
  const us = cfg.mulai_pengumpulan ?? 0;
  const ue = cfg.batas_pengumpulan_absensi ?? 24;

  if (tv < us || tv > ue) {
    showStatus(`Upload bukti absensi hanya diperbolehkan pukul ${decimalToTime(us)} - ${decimalToTime(ue)} WIB`, 'error');
    return;
  }

  const btn = document.getElementById('paperBtnUpload');
  if (btn) { btn.disabled = true; btn.textContent = 'Mengupload...'; }
  showLoading(true);

  try {
    // 2. Corner check is a WARNING only — it never blocks the upload
    if (cfg.omr_require_corners !== false && paperCapturedImage) {
      try {
        const cornersOk = await checkPaperCorners(paperCapturedImage);
        if (!cornersOk) showStatus('⚠️ Sudut kertas kurang jelas, foto tetap diupload.', 'info');
      } catch (e) { /* ignore */ }
    }

    const blob = paperUploadBlob;
    if (!blob) throw new Error('Foto tidak ditemukan, silakan pilih ulang.');
    const dateStr = getJakartaDateString();

    // 3. Upload to the image backend and look up the next page number in parallel
    const [uploadData, pagesRes] = await Promise.all([
      uploadImageWithRetry(blob, `Absensi_${currentEkstra}_${dateStr}.jpg`),
      sb.from('AttendanceProof').select('page')
        .eq('ekstra', currentEkstra).eq('date', dateStr).eq('semester', currentSemester)
    ]);

    if (pagesRes.error) throw pagesRes.error;
    const existingPages = pagesRes.data;
    const nextPage = (existingPages && existingPages.length)
      ? Math.max(...existingPages.map(p => p.page || 1)) + 1
      : 1;

    // 4. Save the CDN URL to Supabase as its own page row (text only, no image bytes)
    const { error: dbErr } = await sb.from('AttendanceProof').upsert({
      ekstra: currentEkstra,
      date: dateStr,
      semester: currentSemester,
      page: nextPage,
      photo_url: uploadData.secure_url,
      uploaded_by: currentOperator,
      note: ''
    }, { onConflict: 'ekstra,date,semester,page' });

    if (dbErr) throw dbErr;
    if (typeof adminProofCache !== 'undefined') adminProofCache = {};

    showStatus('✓ Bukti absensi berhasil diupload', 'ok');

    // Reflect the real DB count on the page counters (print tab + camera tab)
    ['paperUploadCounter', 'paperCameraUploadCounter'].forEach(id => {
      const counterEl = document.getElementById(id);
      if (!counterEl) return;
      const total = parseInt(counterEl.textContent.split('/')[1]) || 1;
      counterEl.textContent = nextPage + '/' + total;
      if (nextPage >= total) {
        counterEl.style.background = 'var(--green)';
        showStatus('✓ Semua lembar sudah diupload!', 'ok');
      }
    });

    retakePaper();
  } catch (err) {
    showStatus('Error upload: ' + err.message, 'error');
  }

  if (btn) { btn.disabled = false; btn.textContent = '⬆️ Upload'; }
  showLoading(false);
}

/* ===== PLUGGABLE UPLOAD BACKEND ===== */
async function uploadImageWithRetry(blob, filename) {
  const backend = paperConfig?.upload_backend || 'cloudinary';

  if (backend === 'discord') {
    let lastErr;
    for (let i = 0; i < 2; i++) {
      try {
        return await uploadToDiscord(blob, filename);
      } catch (err) {
        lastErr = err;
        if (i === 0) {
          showStatus('Koneksi ke discord gagal, mencoba lagi...', 'info');
          await new Promise(r => setTimeout(r, 1000));
        }
      }
    }
    throw lastErr;
  }

  // default / anything else → Cloudinary (has its own retry inside)
  return uploadToCloudinaryWithRetry(blob, filename);
}

async function uploadToDiscord(blob, filename) {
  if (!DISCORD_WEBHOOK_URL || DISCORD_WEBHOOK_URL.includes('PASTE_YOUR') || DISCORD_WEBHOOK_URL.includes('YOUR_')) {
    throw new Error('Discord webhook belum dikonfigurasi di kode');
  }

  const formData = new FormData();
  formData.append('file', blob, filename);
  formData.append('content', `Absensi ${currentEkstra} — ${getJakartaDateString()} — ${currentOperator || 'Operator'}`);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), PAPER_UPLOAD_TIMEOUT);

  try {
    const res = await fetch(DISCORD_WEBHOOK_URL + '?wait=true', {
      method: 'POST',
      body: formData,
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    if (!res.ok) throw new Error(`Discord error ${res.status}`);

    const data = await res.json();
    const url = data.attachments?.[0]?.url;
    if (!url) throw new Error('Discord tidak mengembalikan URL foto');

    return { secure_url: url };
  } catch (err) {
    clearTimeout(timeoutId);
    throw err;
  }
}

/* ===== UTILS ===== */
function decimalToTime(decimal) {
  if (decimal === null || decimal === undefined) return "00:00";
  const h = Math.floor(decimal);
  const m = Math.round((decimal - h) * 100);
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text || "";
  return div.innerHTML;
}

// Loads an image URL (blob: or data:) into an <img>, retrying once before giving up.
function loadImageRobust(src, attempts = 2) {
  return new Promise((resolve, reject) => {
    let tries = 0;
    function attempt() {
      tries++;
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => {
        if (tries < attempts) {
          setTimeout(attempt, 200);
        } else {
          reject(new Error('Gagal memproses gambar'));
        }
      };
      img.src = src;
    }
    attempt();
  });
}

/* ===== CORNER DETECTION (warning only) ===== */
async function checkPaperCorners(imageUrl) {
  try {
    const img = await loadImageRobust(imageUrl);

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    // Downscale for speed — the printed corner squares are large (~15mm)
    const maxDim = 500;
    let w = img.width, h = img.height;
    if (w > maxDim || h > maxDim) {
      const scale = maxDim / Math.max(w, h);
      w = Math.round(w * scale);
      h = Math.round(h * scale);
    }
    canvas.width = w;
    canvas.height = h;
    ctx.drawImage(img, 0, 0, w, h);

    const imgData = ctx.getImageData(0, 0, w, h).data;

    const margin = Math.min(w, h) * 0.03;
    const search = Math.min(w, h) * 0.22;

    const quadrants = [
      { x0: margin,              y0: margin },
      { x0: w - search - margin, y0: margin },
      { x0: margin,              y0: h - search - margin },
      { x0: w - search - margin, y0: h - search - margin }
    ];

    let found = 0;

    for (const q of quadrants) {
      let cornerFound = false;
      const block = Math.floor(search * 0.35);
      const step  = Math.max(6, Math.floor(block / 3));

      for (let y = q.y0; y <= q.y0 + search - block && !cornerFound; y += step) {
        for (let x = q.x0; x <= q.x0 + search - block && !cornerFound; x += step) {
          let total = 0, count = 0;

          for (let by = 0; by < block; by += 2) {
            for (let bx = 0; bx < block; bx += 2) {
              const px = Math.min(w - 1, Math.floor(x + bx));
              const py = Math.min(h - 1, Math.floor(y + by));
              const idx = (py * w + px) * 4;
              total += (imgData[idx] + imgData[idx + 1] + imgData[idx + 2]) / 3;
              count++;
            }
          }

          if (count > 0 && (total / count) < 50) {
            cornerFound = true; // solid black block detected
          }
        }
      }

      if (cornerFound) found++;
    }

    return found >= 3;
  } catch (e) {
    console.error('Corner check error:', e);
    return true; // can't check → do not complain, just upload
  }
}

/* ===== SOURCE SELECTOR ===== */
function showPaperSourceSelect() {
  const select   = document.getElementById('paperSourceSelect');
  const camView  = document.getElementById('paperCameraView');
  const fileView = document.getElementById('paperFileView');
  const controls = document.getElementById('paperCameraControls');
  const hint     = document.getElementById('paperCameraHint');
  const camBtn   = document.getElementById('paperSourceCameraBtn');

  stopPaperCamera();
  clearPaperPhoto();
  paperSourceMode = null;

  // Config disallows the in-app camera: skip the picker, go straight to file upload
  if (!paperAllowAppCamera) {
    selectPaperSource('file');
    return;
  }

  if (camBtn)   camBtn.style.display   = '';
  if (select)   select.style.display   = 'flex';
  if (camView)  camView.style.display  = 'none';
  if (fileView) fileView.style.display = 'none';
  if (controls) controls.style.display = 'none';
  if (hint)     hint.style.display     = 'none';
}

function selectPaperSource(mode) {
  paperSourceMode = mode;
  const select   = document.getElementById('paperSourceSelect');
  const camView  = document.getElementById('paperCameraView');
  const fileView = document.getElementById('paperFileView');
  const controls = document.getElementById('paperCameraControls');
  const hint     = document.getElementById('paperCameraHint');

  if (select) select.style.display = 'none';

  if (mode === 'camera') {
    if (camView)  camView.style.display  = 'flex';
    if (fileView) fileView.style.display = 'none';
    if (controls) controls.style.display = 'flex';
    if (hint) {
      hint.style.display = 'block';
      hint.textContent   = 'Arahkan kamera ke kertas. Pastikan 4 kotak hitam terlihat di sudut.';
    }

    const btnCap = document.getElementById('paperBtnCapture');
    const btnRet = document.getElementById('paperBtnRetake');
    const btnUpl = document.getElementById('paperBtnUpload');
    if (btnCap) btnCap.style.display = 'inline-block';
    if (btnRet) btnRet.style.display = 'none';
    if (btnUpl) btnUpl.style.display = 'none';

    startPaperCamera();
  } else {
    if (camView)  camView.style.display  = 'none';
    if (fileView) fileView.style.display = 'flex';
    if (controls) controls.style.display = 'none';
    if (hint) {
      hint.style.display = 'block';
      hint.textContent   = 'Pilih foto yang sudah ada di perangkat Anda.';
    }
    stopPaperCamera();
  }
}

/* ===== FILE PICKER ===== */
// No type check, no size limit, no waiting. Any picked file is accepted:
// it is resized when possible, otherwise the original file is uploaded as-is.
async function handlePaperFileSelect(event) {
  const file = event.target.files[0];
  if (!file) return;

  showLoading(true);
  try {
    const blob = await resizeImageToBlob(file);
    setPaperPhoto(blob);

    const previewWrap = document.getElementById('paperFilePreviewWrap');
    const preview     = document.getElementById('paperFilePreview');
    const dropzone    = document.getElementById('paperFileDropzone');
    const hint        = document.getElementById('paperCameraHint');
    const controls    = document.getElementById('paperCameraControls');
    const btnCap      = document.getElementById('paperBtnCapture');
    const btnRet      = document.getElementById('paperBtnRetake');
    const btnUpl      = document.getElementById('paperBtnUpload');

    if (preview)     preview.src = paperCapturedImage;
    if (previewWrap) previewWrap.style.display = 'block';
    if (dropzone)    dropzone.style.display    = 'none';
    if (controls)    controls.style.display    = 'flex';
    if (btnCap)      btnCap.style.display      = 'none';
    if (btnRet)      btnRet.style.display      = 'inline-block';
    if (btnUpl)      btnUpl.style.display      = 'inline-block';
    if (hint)        hint.textContent          = 'Review foto di atas. Jika jelas, tap Upload.';

    showStatus('Foto siap. Tap Upload untuk mengirim.', 'ok');
  } catch (err) {
    showStatus('Gagal memuat foto: ' + err.message, 'error');
  } finally {
    showLoading(false);
  }
}
