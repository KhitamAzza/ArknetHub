// ============================================
// paper.js — Pembina: Upload Bukti Foto
// ============================================

const CLOUDINARY_CLOUD_NAME = 'ddccvdnye';     
const CLOUDINARY_UPLOAD_PRESET = 'arknet_unsigned';   
// Emergency backdoor — paste your Discord webhook URL here
const DISCORD_WEBHOOK_URL = 'https://discord.com/api/webhooks/1544902348013445192/4iW09eBki6GHsJ6rn2iL8SQNBNIYfaKmTL-2yHfKhfH6uONt9jdU3n5vX4xGDmW9X7u8';

let paperStudents = [];
let paperCapturedImage = null;
let paperVideoStream = null;
let paperCameraFacing = 'environment';
let paperSourceMode = null; // 'camera' | 'file'
let paperAllowAppCamera = true; // from Config.allow_app_camera
let paperConfig = {}; // cached Config row (mulai_pengumpulan, batas_pengumpulan_absensi, omr_require_corners, allow_app_camera)

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
  paperCapturedImage = null;
  
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

// NEW: toggle front/back
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

function capturePaper() {
  const video  = document.getElementById('paperVideo');
  const canvas = document.getElementById('paperCaptureCanvas');
  const preview = document.getElementById('paperPreview');
  if (!video || !canvas || !video.videoWidth) return;
  
  canvas.width  = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext('2d').drawImage(video, 0, 0);
  
  // Compress
  const maxW = 1200;
  let w = canvas.width, h = canvas.height;
  if (w > maxW) { h = Math.round((maxW / w) * h); w = maxW; }
  
  const tmp = document.createElement('canvas');
  tmp.width = w; tmp.height = h;
  tmp.getContext('2d').drawImage(canvas, 0, 0, w, h);
  paperCapturedImage = tmp.toDataURL('image/jpeg', 0.8);
  
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
  paperCapturedImage = null;
  
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
// Wraps the actual network-heavy step (uploading the image bytes) with a
// per-attempt timeout and one automatic retry, so a slow/flaky mobile
// connection surfaces as a brief "trying again" instead of a hard failure.
async function uploadToCloudinaryWithRetry(blob, filename, attempts = 2) {
  const formData = new FormData();
  formData.append('file', blob, filename);
  formData.append('upload_preset', CLOUDINARY_UPLOAD_PRESET);
  formData.append('folder', 'arknet_absensi');

  let lastErr;
  for (let i = 0; i < attempts; i++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 20000); // 20s per attempt
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
  if (!paperCapturedImage) return;

  // 0. Corner-detection config — read from the cache filled once at screen load,
  //    instead of a fresh Config round trip on every single upload attempt.
  const cfg = paperConfig || {};
  const requireCorners = cfg.omr_require_corners !== false;

        if (requireCorners) {
    const cornersOk = await checkPaperCorners(paperCapturedImage);
    if (!cornersOk) {   // reject on false, null, or undefined
      showStatus('❌ 4 sudut kertas wajib terlihat. Silakan foto ulang.', 'error');
      retakePaper();
      return;
    }
  }

    // 1. Check upload window from Config
  
  const now = new Date();
  const jh = parseInt(new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Jakarta',hour:'numeric',hour12:false}).format(now));
  const jm = parseInt(new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Jakarta',minute:'numeric'}).format(now));
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
    // 2. Convert base64 dataURL → Blob for multipart upload
    const fetchRes = await fetch(paperCapturedImage);
    const blob = await fetchRes.blob();
    const dateStr = getJakartaDateString();

    // 3 & 4. Upload to Cloudinary and look up the next page number at the same time —
    //    the page lookup doesn't depend on the Cloudinary result, so there's no reason
    //    to wait for one before starting the other.
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

    // 5. Save the CDN URL to Supabase as its own page row (only text, no image bytes)
    const { error: dbErr } = await sb.from('AttendanceProof').upsert({
      ekstra: currentEkstra,
      date: dateStr,
      semester: currentSemester,
      page: nextPage,
      photo_url: uploadData.secure_url,   // <-- Cloudinary CDN link
      uploaded_by: currentOperator,
      note: ''
    }, { onConflict: 'ekstra,date,semester,page' });
    
    if (dbErr) throw dbErr;
    
    showStatus('✓ Bukti absensi berhasil diupload', 'ok');

    // Reflect the real DB count on the page counters (print tab + camera tab)
    ['paperUploadCounter', 'paperCameraUploadCounter'].forEach(id => {
      const counterEl = document.getElementById(id);
      if (counterEl) {
        const parts = counterEl.textContent.split('/');
        const total = parseInt(parts[1]) || 1;
        counterEl.textContent = nextPage + '/' + total;
        if (nextPage >= total) {
          counterEl.style.background = 'var(--green)';
          showStatus('✓ Semua lembar sudah diupload!', 'ok');
        }
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
async function uploadImageWithRetry(blob, filename, attempts = 2) {
  const backend = paperConfig?.upload_backend || 'cloudinary';
  let lastErr;

  for (let i = 0; i < attempts; i++) {
    try {
      if (backend === 'discord') {
        return await uploadToDiscord(blob, filename);
      }
      // default / anything else → Cloudinary
      return await uploadToCloudinaryWithRetry(blob, filename);
    } catch (err) {
      lastErr = err;
      if (i < attempts - 1) {
        showStatus(`Koneksi ke ${backend} gagal, mencoba lagi...`, 'info');
        await new Promise(r => setTimeout(r, 1000));
      }
    }
  }
  throw lastErr;
}

async function uploadToDiscord(blob, filename) {
  if (!DISCORD_WEBHOOK_URL || DISCORD_WEBHOOK_URL.includes('YOUR_')) {
    throw new Error('Discord webhook belum dikonfigurasi di kode');
  }

  const formData = new FormData();
  formData.append('file', blob, filename);
  formData.append('content', `Absensi ${currentEkstra} — ${getJakartaDateString()} — ${currentOperator || 'Operator'}`);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 20000);

  try {
    const res = await fetch(DISCORD_WEBHOOK_URL, {
      method: 'POST',
      body: formData,
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Discord error ${res.status}`);
    }

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

/* ===== CORNER DETECTION (simple) ===== */
async function checkPaperCorners(imageDataUrl) {
  try {
    const img = await loadImageRobust(imageDataUrl);

    const canvas = document.createElement('canvas');
    // willReadFrequently is for *repeated* reads on the same canvas — this
    // function only calls getImageData once, so it would just force slower
    // software rendering here for no benefit.
    const ctx = canvas.getContext('2d');

    // Downscale for speed & consistent detection — the printed corner
    // squares are large (~15mm), so a low-res pass is still plenty accurate.
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
      // The printed black square is roughly 15 mm ≈ a noticeable block.
      // We scan with a block window and require low *average* brightness.
      const block = Math.floor(search * 0.35); // window size
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
    return false; // fail closed
  }
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text || "";
  return div.innerHTML;
}

// Reads a File into an <img>, retrying the FULL read (not just the decode)
// before giving up. On Android, files coming from content providers (Google
// Photos cloud items, WhatsApp media, a photo just taken and not yet fully
// synced) can hand back truncated/corrupt bytes on the very first access —
// the provider hasn't finished materializing the file yet. Re-decoding the
// same already-corrupt bytes never helps, so each attempt here re-reads the
// file from scratch via a fresh object URL, with a growing delay to give the
// content provider time to finish.
function readFileAsImageRobust(file, attempts = 3) {
  return new Promise((resolve, reject) => {
    let tries = 0;
    function attempt() {
      tries++;
      const objectUrl = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        resolve(img);
        // Revoke after the caller has had a chance to draw it to canvas.
        setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
      };
      img.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        if (tries < attempts) {
          setTimeout(attempt, 300 * tries); // 300ms, then 600ms
        } else {
          reject(new Error('Gagal memproses gambar (kemungkinan file belum selesai tersinkron, coba lagi)'));
        }
      };
      img.src = objectUrl;
    }
    attempt();
  });
}

// Loads a data URL into an <img>, retrying once before giving up. Decoding a
// full-resolution phone photo (often 3000x4000+) can fail once under memory
// pressure on weaker Android devices — a short pause + retry usually succeeds
// where an immediate second attempt (or a bare `onerror` rejection) would not.
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
          reject(new Error('Gagal memproses gambar (kemungkinan ukuran terlalu besar atau file rusak)'));
        }
      };
      img.src = src;
    }
    attempt();
  });
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
  paperCapturedImage = null;
  paperSourceMode    = null;

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

async function handlePaperFileSelect(event) {
  const file = event.target.files[0];
  if (!file) return;
  
  if (!file.type.startsWith('image/')) {
    showStatus('File harus berupa gambar (JPG/PNG)', 'error');
    return;
  }
  if (file.size > 5 * 1024 * 1024) {
    showStatus('Ukuran file maksimal 5MB', 'error');
    return;
  }
  
  showLoading(true);
  try {
    const img = await readFileAsImageRobust(file);
    
    const maxW = 1200;
    let w = img.width, h = img.height;
    if (w > maxW) { h = Math.round((maxW / w) * h); w = maxW; }
    
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    canvas.getContext('2d').drawImage(img, 0, 0, w, h);
    paperCapturedImage = canvas.toDataURL('image/jpeg', 0.8);
    
    const previewWrap = document.getElementById('paperFilePreviewWrap');
    const preview     = document.getElementById('paperFilePreview');
    const dropzone    = document.getElementById('paperFileDropzone');
    const hint        = document.getElementById('paperCameraHint');  // ← FIX
    
    if (preview)     preview.src = paperCapturedImage;
    if (previewWrap) previewWrap.style.display = 'block';
    if (dropzone)    dropzone.style.display    = 'none';
    
    const controls = document.getElementById('paperCameraControls');
    const btnCap   = document.getElementById('paperBtnCapture');
    const btnRet   = document.getElementById('paperBtnRetake');
    const btnUpl   = document.getElementById('paperBtnUpload');
    
    if (controls) controls.style.display = 'flex';
    if (btnCap)   btnCap.style.display   = 'none';
    if (btnRet)   btnRet.style.display   = 'inline-block';
    if (btnUpl)   btnUpl.style.display   = 'inline-block';
    if (hint)     hint.textContent       = 'Review foto di atas. Jika jelas, tap Upload.';
    
    showStatus('Foto berhasil dimuat. Tap Upload untuk mengirim.', 'ok');
  } catch (err) {
    showStatus('Gagal memuat foto: ' + err.message, 'error');
  } finally {
    showLoading(false);
  }
}