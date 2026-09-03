// ===== overseer.js =====
let overseerDates = [];
let overseerSelectedDate = null;
let overseerStats = {};
let overseerAlphaData = [];
let overseerWakelMap = {};
let overseerExpandedClass = null;
let overseerAlphaCardExpanded = false;

const BULAN_PARSE = {
  "Januari": 0, "Februari": 1, "Maret": 2, "April": 3, "Mei": 4, "Juni": 5,
  "Juli": 6, "Agustus": 7, "September": 8, "Oktober": 9, "November": 10, "Desember": 11
};

function parseIndonesianDate(dateStr) {
  if (!dateStr) return new Date(0);
  const parts = dateStr.split(' ');
  if (parts.length !== 3) return new Date(0);
  const day = parseInt(parts[0], 10);
  const month = BULAN_PARSE[parts[1]] !== undefined ? BULAN_PARSE[parts[1]] : -1;
  const year = parseInt(parts[2], 10);
  if (isNaN(day) || month === -1 || isNaN(year)) return new Date(0);
  return new Date(year, month, day);
}

async function initOverseer() {
  overseerSelectedDate = null;
  overseerStats = {};
  overseerAlphaData = [];
  overseerWakelMap = {};
  overseerExpandedClass = null;
  await loadOverseerDates();
  await loadOverseerAlpha();
  await loadOverseerEkstra();
}
function toggleAlphaCard() {
  overseerAlphaCardExpanded = !overseerAlphaCardExpanded;
  renderOverseerAlpha();
}

async function loadOverseerDates() {
  showLoading(true);
  try {
    const { data, error } = await sb
      .from('AttendanceV2')
      .select('date')
      .eq('semester', currentSemester);

    if (error) throw error;

    const uniqueDates = [...new Set((data || []).map(d => d.date))];

    // Ensure today is always available even if no AttendanceV2 has been recorded yet
    const today = getJakartaDateString();
    if (!uniqueDates.includes(today)) {
      uniqueDates.push(today);
    }

    uniqueDates.sort((a, b) => parseIndonesianDate(b) - parseIndonesianDate(a));

    overseerDates = uniqueDates;
    overseerSelectedDate = uniqueDates[0]; // defaults to today (or most recent)
    await loadOverseerStats(overseerSelectedDate);
  } catch (err) {
    console.error(err);
    showStatus("Gagal memuat data", "error");
    renderOverseerEmpty();
  }
  showLoading(false);
}
async function loadOverseerStats(date) {
  showLoading(true);
  try {
    const { data, error } = await sb
      .from('AttendanceV2')
      .select('status')
      .eq('semester', currentSemester)
      .eq('date', date);

    if (error) throw error;

    const counts = {};
    let total = 0;

    (data || []).forEach(row => {
      const status = (row.status || 'KOSONG').trim().toUpperCase();
      counts[status] = (counts[status] || 0) + 1;
      total++;
    });

    overseerStats = { counts, total, date };
    renderOverseerStats();
  } catch (err) {
    console.error(err);
    showStatus("Gagal memuat statistik", "error");
  }
  showLoading(false);
}

function renderOverseerStats() {
  const dateLabel = document.getElementById('overseerDateLabel');
  const barWrap = document.getElementById('overseerBarWrap');
  const legend = document.getElementById('overseerLegend');

  if (dateLabel) dateLabel.textContent = overseerSelectedDate || '-';

  if (!overseerStats.total) {
    if (barWrap) barWrap.innerHTML = '<div class="overseer-empty">Tidak ada data absensi</div>';
    if (legend) legend.innerHTML = '';
    return;
  }

  const { counts, total } = overseerStats;

  const colorMap = {
    'HADIR': 'var(--green)',
    'PAGI': 'var(--accent)',
    'TELAT': 'var(--yellow)',
    'TERLAMBAT': 'var(--yellow)',
    'ALPHA': 'var(--red)',
    'SAKIT': '#f472b6',
    'IZIN': '#a78bfa',
    'KOSONG': 'var(--text-secondary)'
  };

  let barHtml = '';
  Object.entries(counts).forEach(([status, count]) => {
    const pct = (count / total) * 100;
    const color = colorMap[status] || 'var(--text-secondary)';
    if (pct > 0) {
      barHtml += `<div class="overseer-bar-seg" style="width:${pct}%;background:${color};" title="${status}: ${count} (${Math.round(pct)}%)"></div>`;
    }
  });
  if (barWrap) barWrap.innerHTML = barHtml;

  let legendHtml = '';
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  sorted.forEach(([status, count]) => {
    const pct = Math.round((count / total) * 100);
    const color = colorMap[status] || 'var(--text-secondary)';
    legendHtml += `
      <div class="overseer-legend-item">
        <div class="overseer-legend-dot" style="background:${color};"></div>
        <span class="overseer-legend-label">${status}</span>
        <span class="overseer-legend-count">${count}</span>
        <span class="overseer-legend-pct">${pct}%</span>
      </div>
    `;
  });

  if (legend) legend.innerHTML = legendHtml;
}

function renderOverseerEmpty() {
  const barWrap = document.getElementById('overseerBarWrap');
  const legend = document.getElementById('overseerLegend');
  const dateLabel = document.getElementById('overseerDateLabel');
  if (dateLabel) dateLabel.textContent = '-';
  if (barWrap) barWrap.innerHTML = '<div class="overseer-empty">Belum ada data absensi</div>';
  if (legend) legend.innerHTML = '';
}

function toggleDatePicker() {
  const modal = document.getElementById('overseerDateModal');
  const list = document.getElementById('overseerDateList');
  if (!modal || !list) return;

  if (modal.classList.contains('visible')) {
    modal.classList.remove('visible');
    return;
  }

  list.innerHTML = overseerDates.map(d => `
    <div class="overseer-date-item ${d === overseerSelectedDate ? 'active' : ''}" onclick="selectOverseerDate('${d}')">
      <span>${d}</span>
      ${d === overseerSelectedDate ? '<span class="overseer-date-check">✓</span>' : ''}
    </div>
  `).join('');

  modal.classList.add('visible');
}

function closeOverseerDateModal() {
  const modal = document.getElementById('overseerDateModal');
  if (modal) modal.classList.remove('visible');
}

async function selectOverseerDate(date) {
  overseerSelectedDate = date;
  closeOverseerDateModal();
  await loadOverseerStats(date);
}

// ===== SECTION 2: SISWA BERMASALAH =====
async function loadOverseerAlpha() {
  const container = document.getElementById('overseerAlphaList');
  if (container) container.innerHTML = '<div class="overseer-empty">Memuat...</div>';

  try {
      const { data: alphaRows, error: alphaErr } = await sb
    .from('AttendanceV2')  // was Attendance
    .select('student_id')
    .eq('semester', currentSemester)
    .eq('status', 'ALPHA');

    if (alphaErr) throw alphaErr;

    const studentAlphaCounts = {};
    (alphaRows || []).forEach(r => {
      studentAlphaCounts[r.student_id] = (studentAlphaCounts[r.student_id] || 0) + 1;
    });

    const studentIds = Object.keys(studentAlphaCounts);
    if (studentIds.length === 0) {
      overseerAlphaData = [];
      renderOverseerAlpha();
      return;
    }

    const { data: students, error: studErr } = await sb
      .from('Database')
      .select('id, nama, kelas')
      .in('id', studentIds);

    if (studErr) throw studErr;

    const byClass = {};
    (students || []).forEach(s => {
      const count = studentAlphaCounts[s.id] || 0;
      if (!byClass[s.kelas]) byClass[s.kelas] = [];
      byClass[s.kelas].push({ id: s.id, nama: s.nama, alphaCount: count });
    });

    Object.values(byClass).forEach(list => {
      list.sort((a, b) => b.alphaCount - a.alphaCount || a.nama.localeCompare(b.nama));
    });

    overseerAlphaData = Object.entries(byClass)
      .map(([kelas, siswa]) => ({
        kelas,
        siswa,
        totalAlpha: siswa.reduce((sum, s) => sum + s.alphaCount, 0)
      }))
      .sort((a, b) => b.totalAlpha - a.totalAlpha);

    const { data: wakelData, error: wakelErr } = await sb
      .from('Wakel')
      .select('kelas, whatsapp');

    if (!wakelErr && wakelData) {
      overseerWakelMap = {};
      wakelData.forEach(w => { overseerWakelMap[w.kelas] = w.whatsapp; });
    } else {
      overseerWakelMap = {};
    }

    renderOverseerAlpha();
  } catch (err) {
    console.error(err);
    if (container) container.innerHTML = '<div class="overseer-empty">Gagal memuat data</div>';
  }
}

function renderOverseerAlpha() {
  const container = document.getElementById('overseerAlphaList');
  const footer = document.querySelector('.overseer-alpha-footer');
  const toggleBtn = document.getElementById('alphaCardToggle');
  if (!container) return;

  if (toggleBtn) toggleBtn.textContent = overseerAlphaCardExpanded ? '📂' : '📁';

  if (!overseerAlphaData || overseerAlphaData.length === 0) {
    container.innerHTML = '<div class="overseer-empty">Tidak ada siswa alpha</div>';
    if (footer) footer.style.display = 'none';
    return;
  }

  // ===== SHRUNK / COMPACT =====
  if (!overseerAlphaCardExpanded) {
    const totalClasses = overseerAlphaData.length;
    const totalSiswa = overseerAlphaData.reduce((sum, c) => sum + c.siswa.length, 0);
    const totalAlpha = overseerAlphaData.reduce((sum, c) => sum + c.totalAlpha, 0);

    const topClasses = overseerAlphaData.slice(0, 3).map(c => `
      <div class="overseer-compact-class">
        <span class="overseer-compact-name">${escapeHtml(c.kelas)}</span>
        <span class="overseer-compact-count">${c.totalAlpha} alpha</span>
      </div>
    `).join('');

    container.innerHTML = `
      <div class="overseer-compact-wrap">
        <div class="overseer-compact-stats">
          <div class="overseer-compact-stat">
            <div class="overseer-compact-num">${totalClasses}</div>
            <div class="overseer-compact-label">Kelas</div>
          </div>
          <div class="overseer-compact-stat">
            <div class="overseer-compact-num">${totalSiswa}</div>
            <div class="overseer-compact-label">Siswa</div>
          </div>
          <div class="overseer-compact-stat">
            <div class="overseer-compact-num">${totalAlpha}</div>
            <div class="overseer-compact-label">Total Alpha</div>
          </div>
        </div>
        <div class="overseer-compact-top">${topClasses}</div>
        ${overseerAlphaData.length > 3 ? `<div class="overseer-compact-more">+${overseerAlphaData.length - 3} kelas lainnya</div>` : ''}
      </div>
    `;
    if (footer) footer.style.display = 'none';
    return;
  }

  // ===== EXPANDED =====
  if (footer) footer.style.display = 'block';

  container.innerHTML = overseerAlphaData.map(cls => {
    const isExpanded = overseerExpandedClass === cls.kelas;
    const wakelNum = overseerWakelMap[cls.kelas];
    const wakelBtn = wakelNum
      ? `<button class="overseer-wa-class-btn" onclick="event.stopPropagation();sendWakelWa('${escapeHtml(cls.kelas)}')">📤 Kirim ke Wakel</button>`
      : `<div class="overseer-wa-missing">Nomor wakel belum diatur</div>`;

    const studentList = isExpanded ? `
      <div class="overseer-alpha-students">
        ${cls.siswa.map(s => `
          <div class="overseer-alpha-student">
            <span class="overseer-alpha-name">${escapeHtml(s.nama)}</span>
            <span class="overseer-alpha-count">${s.alphaCount}x ALPHA</span>
          </div>
        `).join('')}
        <div class="overseer-alpha-actions">${wakelBtn}</div>
      </div>
    ` : '';

    return `
      <div class="overseer-alpha-class">
        <div class="overseer-alpha-header" onclick="toggleAlphaClass('${escapeHtml(cls.kelas)}')">
          <div class="overseer-alpha-classname">${escapeHtml(cls.kelas)}</div>
          <div class="overseer-alpha-meta">${cls.siswa.length} siswa • ${cls.totalAlpha} alpha</div>
          <div class="overseer-alpha-arrow">${isExpanded ? '▲' : '▼'}</div>
        </div>
        ${studentList}
      </div>
    `;
  }).join('');
}

function toggleAlphaClass(kelas) {
  overseerExpandedClass = overseerExpandedClass === kelas ? null : kelas;
  renderOverseerAlpha();
}

function cleanWaNumber(num) {
  if (!num) return '';
  let digits = String(num).replace(/\D/g, '');
  if (digits.startsWith('0')) digits = '62' + digits.slice(1);
  return digits;
}

function formatAlphaReport(kelas, siswaList) {
  const lines = siswaList.map(s => `- ${s.nama} — ALPHA ${s.alphaCount}x`);
  return `*LAPORAN SISWA ALPHA KELAS ${kelas}*\n\n${kelas} • ${siswaList.length} siswa\n${lines.join('\n')}`;
}

function sendWakelWa(kelas) {
  const cls = overseerAlphaData.find(c => c.kelas === kelas);
  const number = overseerWakelMap[kelas];
  if (!cls) return;
  if (!number) {
    showStatus("Nomor wakel tidak tersedia", "error");
    return;
  }
  const text = formatAlphaReport(kelas, cls.siswa);
  const url = `https://wa.me/${cleanWaNumber(number)}?text=${encodeURIComponent(text)}`;
  window.open(url, '_blank');
}

function sendAllWakelWa() {
  if (!overseerAlphaData || overseerAlphaData.length === 0) return;
  let text = `*LAPORAN SISWA ALPHA SEMUA KELAS*\n\n`;
  overseerAlphaData.forEach(cls => {
    text += `*${cls.kelas}* • ${cls.siswa.length} siswa\n`;
    cls.siswa.forEach(s => {
      text += `- ${s.nama} — ALPHA ${s.alphaCount}x\n`;
    });
    text += `\n`;
  });
  const url = `https://wa.me/?text=${encodeURIComponent(text)}`;
  window.open(url, '_blank');
}
// ===== SECTION 3: JUMLAH SISWA PER EKSKUL =====
async function loadOverseerEkstra() {
  const container = document.getElementById('overseerEkstraList');
  if (container) container.innerHTML = '<div class="overseer-empty">Memuat...</div>';

  try {
    const { data, error } = await sb
      .from('Database')
      .select('ekstra');

    if (error) throw error;

    const counts = {};
    (data || []).forEach(s => {
      const e = (s.ekstra || 'Tidak diketahui').trim();
      if (!e || e === '0') {
        counts['(Tanpa Ekskul)'] = (counts['(Tanpa Ekskul)'] || 0) + 1;
      } else {
        counts[e] = (counts[e] || 0) + 1;
      }
    });

    const sorted = Object.entries(counts)
      .map(([ekstra, count]) => ({ ekstra, count }))
      .sort((a, b) => b.count - a.count);

    renderOverseerEkstra(sorted);
  } catch (err) {
    console.error(err);
    if (container) container.innerHTML = '<div class="overseer-empty">Gagal memuat data</div>';
  }
}

function renderOverseerEkstra(list) {
  const container = document.getElementById('overseerEkstraList');
  if (!container) return;

  if (!list || list.length === 0) {
    container.innerHTML = '<div class="overseer-empty">Tidak ada data ekskul</div>';
    return;
  }

  container.innerHTML = list.map(item => `
    <div class="overseer-ekstra-row">
      <div class="overseer-ekstra-name">${escapeHtml(item.ekstra)}</div>
      <div class="overseer-ekstra-count">${item.count} siswa</div>
    </div>
  `).join('');
}
// ===== WA REPORT FROM 1ST CARD =====
let waReportSelectedDate = null;
let waReportData = [];

async function openWaReportModal() {
  if (overseerDates.length === 0) await loadOverseerDates();

  waReportSelectedDate = null;
  waReportData = [];

  document.getElementById('waReportDateStep').style.display = 'block';
  document.getElementById('waReportWarning').style.display = 'none';
  document.getElementById('waReportPreview').style.display = 'none';
  document.getElementById('waReportFooter').style.display = 'none';

  const list = document.getElementById('waReportDateList');
  list.innerHTML = overseerDates.map(d => `
    <div class="overseer-date-item" onclick="selectWaReportDate('${d}')">
      <span>${d}</span>
    </div>
  `).join('');

  document.getElementById('waReportModal').classList.add('visible');
}

function closeWaReportModal() {
  document.getElementById('waReportModal').classList.remove('visible');
}

async function selectWaReportDate(date) {
  waReportSelectedDate = date;
  showLoading(true);

  try {
    // 1. All students
    const { data: allStudents, error: studErr } = await sb
      .from('Database')
      .select('id, nama, kelas');
    if (studErr) throw studErr;

        // 2. AttendanceV2 for selected date
    const { data: attendance, error: attErr } = await sb
      .from('AttendanceV2')          // ← KEEP the V2! This is the table name.
      .select('student_id, status')
      .eq('date', date)
      .eq('semester', currentSemester);
    if (attErr) throw attErr;

    const attMap = {};
    (attendance || []).forEach(a => {   // ← lowercase `attendance` (the variable)
      attMap[a.student_id] = (a.status || '').trim().toUpperCase();
    });

    // 3. Convert NULL → ALPHA, TELAT → ALPHA
    let emptyCount = 0;
    let telatCount = 0;

    const processed = (allStudents || []).map(s => {
      const raw = attMap[s.id] || '';
      let status = raw;

      if (!status) {
        status = 'ALPHA';
        emptyCount++;
      } else if (status === 'TELAT') {
        status = 'ALPHA';
        telatCount++;
      }

      return { ...s, reportStatus: status };
    });

    // 4. Keep only ALPHA, TERLAMBAT, PAGI
    waReportData = processed.filter(s =>
      ['ALPHA', 'TERLAMBAT', 'PAGI'].includes(s.reportStatus)
    );

    // 5. Build preview HTML (grouped by kelas)
    const byClass = {};
    waReportData.forEach(s => {
      if (!byClass[s.kelas]) byClass[s.kelas] = [];
      byClass[s.kelas].push(s);
    });

    let previewHtml = '';
    Object.keys(byClass).sort().forEach(kelas => {
      previewHtml += `<div style="font-weight:700;margin:12px 0 6px;color:var(--accent);font-size:14px;">${escapeHtml(kelas)}</div>`;
      byClass[kelas].forEach(s => {
        const color = s.reportStatus === 'ALPHA' ? 'var(--red)' :
                     s.reportStatus === 'TERLAMBAT' ? 'var(--yellow)' : 'var(--accent)';
        previewHtml += `
          <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border);font-size:13px;">
            <span>${escapeHtml(s.nama)}</span>
            <span style="color:${color};font-weight:700;">${s.reportStatus}</span>
          </div>`;
      });
    });

    if (waReportData.length === 0) {
      previewHtml = `<div style="text-align:center;padding:20px;color:var(--text-secondary);font-size:14px;">Tidak ada siswa dengan status ALPHA, TERLAMBAT, atau PAGI</div>`;
    }

    document.getElementById('waReportPreviewContent').innerHTML = previewHtml;

    // 6. Show warning if there are empty/TELAT records
    if (emptyCount > 0 || telatCount > 0) {
      document.getElementById('waReportDateStep').style.display = 'none';
      document.getElementById('waReportWarning').style.display = 'block';
      document.getElementById('waReportWarningText').textContent =
        `${emptyCount} siswa kosong, ${telatCount} siswa telat akan dianggap ALPHA`;
    } else {
      showWaReportPreview();
    }
  } catch (err) {
    showStatus('Error: ' + err.message, 'error');
  }

  showLoading(false);
}

function proceedWaReport() {
  document.getElementById('waReportWarning').style.display = 'none';
  showWaReportPreview();
}

function showWaReportPreview() {
  document.getElementById('waReportPreview').style.display = 'block';
  document.getElementById('waReportFooter').style.display = 'flex';
}

function sendWaReport() {
  if (!waReportSelectedDate || !waReportData) return;

  let text = `*LAPORAN KEHADIRAN*\n📅 ${waReportSelectedDate}\n\n`;

  const byClass = {};
  waReportData.forEach(s => {
    if (!byClass[s.kelas]) byClass[s.kelas] = [];
    byClass[s.kelas].push(s);
  });

  Object.entries(byClass).forEach(([kelas, siswa]) => {
    text += `*${kelas}*\n`;
    siswa.forEach(s => {
      text += `- ${s.nama} (${s.reportStatus})\n`;
    });
    text += '\n';
  });

  if (waReportData.length === 0) {
    text += 'Tidak ada siswa dengan status ALPHA, TERLAMBAT, atau PAGI.\n';
  }

  const url = `https://wa.me/?text=${encodeURIComponent(text)}`;
  window.open(url, '_blank');
}
