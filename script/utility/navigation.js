// ===== ANDROID / PWA BACK BUTTON HANDLING =====
// Prevents the hardware/gesture back button from instantly closing the app.
// Works by watching visibility of existing screens/modals and reusing their
// existing back/close buttons (.icon-btn) — no changes needed elsewhere.
(function () {
  // Full-page screens (toggled via style.display)
  const SCREEN_IDS = [
    'dashboardScreen', 'mainApp', 'listScreen', 'absenMenuScreen', 'registrationScreen',
    'adminScreen', 'helperScreen', 'overseerScreen', 'fixerScreen', 'configScreen',
    'lateRecordScreen', 'danaHistoryScreen', 'syaratScreen', 'daftarScreen',
    'ketuaScreen', 'tatibScreen', 'tatibPaymentScreen', 'tatibHeatmapScreen',
    'tatibBermasalahScreen', 'kelolaSiswaScreen', 'paperScreen', 'adminInputScreen',
    'proofViewerScreen', 'kelolaAbsensiScreen', 'printAbsensiScreen'
  ];

  // Modals/overlays (toggled via 'visible' class, or display on overlay)
  const MODAL_IDS = [
    'summaryModal', 'tatibPaymentModal', 'fixerEditModal', 'danaModal',
    'waReportModal', 'overseerDateModal', 'waPreviewModal', 'removeModal',
    'tanpaEkstraModal', 'expelModal', 'backBlockModal', 'adminInputPickerModal',
    'adminProofDateModal', 'lateConfirmModal', 'searchOverlay'
  ];

  // "Home" level per role — back here asks for confirmation instead of
  // navigating further (there's nowhere else in-app to go back to).
  const BASE_SCREENS = ['loginScreen', 'dashboardScreen', 'adminScreen', 'helperScreen', 'tatibScreen'];

  let suppressNextPush = false; // true right after we click an existing back/close button
  let stackDepth = 0;
  let exitArmed = false;

  function isVisible(el) {
    if (!el) return false;
    if (el.classList && el.classList.contains('modal-overlay')) {
      return el.classList.contains('visible');
    }
    return window.getComputedStyle(el).display !== 'none';
  }

  function currentTopEl() {
    // Modals render on top of screens, so check them first.
    for (const id of MODAL_IDS) {
      const el = document.getElementById(id);
      if (isVisible(el)) return el;
    }
    for (const id of SCREEN_IDS) {
      const el = document.getElementById(id);
      if (isVisible(el)) return el;
    }
    return document.getElementById('loginScreen');
  }

  function findBackControl(el) {
    if (!el) return null;
    // Reuses whatever back/close button already exists in that screen's header.
    return el.querySelector('.icon-btn');
  }

  function onScreenChanged() {
    if (suppressNextPush) { suppressNextPush = false; return; }
    stackDepth++;
    history.pushState({ arknetDepth: stackDepth }, '');
  }

  const observedEls = [...SCREEN_IDS, ...MODAL_IDS]
    .map((id) => document.getElementById(id))
    .filter(Boolean);

  let lastTop = null;
  const mo = new MutationObserver(() => {
    const top = currentTopEl();
    if (top && top !== lastTop) {
      lastTop = top;
      onScreenChanged();
    }
  });
  observedEls.forEach((el) => {
    mo.observe(el, { attributes: true, attributeFilter: ['style', 'class'] });
  });

  // Seed an initial entry so the very first back press is catchable.
  history.replaceState({ arknetDepth: 0 }, '');

  window.addEventListener('popstate', () => {
    const top = currentTopEl();

    if (!top || BASE_SCREENS.includes(top.id)) {
      if (!exitArmed) {
        exitArmed = true;
        if (typeof showStatus === 'function') {
          showStatus('Tekan sekali lagi untuk keluar', 'info');
        }
        history.pushState({ arknetDepth: stackDepth }, ''); // re-arm for one more catch
        setTimeout(() => { exitArmed = false; }, 2000);
      }
      // Second press within 2s: don't re-push — the following physical
      // back press will then actually exit the app.
      return;
    }

    const backBtn = findBackControl(top);
    suppressNextPush = true; // clicking will hide this screen; don't count that as a new push
    if (backBtn) {
      backBtn.click();
    } else if (typeof backToDashboard === 'function') {
      backToDashboard();
    }
  });
})();