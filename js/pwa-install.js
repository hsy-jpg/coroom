// "홈 화면에 추가" 설치 안내 배너
(function () {
  const DISMISS_KEY = 'coroom_install_banner_dismissed_at';
  const DISMISS_DAYS = 7;

  let deferredPrompt = null;

  function isStandalone() {
    return (
      window.matchMedia('(display-mode: standalone)').matches ||
      window.navigator.standalone === true
    );
  }

  function isIos() {
    return /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
  }

  function isIosSafari() {
    const ua = navigator.userAgent;
    const isSafariUA = /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS|OPT\//.test(ua);
    return isIos() && isSafariUA;
  }

  function isDismissedRecently() {
    const raw = localStorage.getItem(DISMISS_KEY);
    if (!raw) return false;
    const dismissedAt = Number(raw);
    if (Number.isNaN(dismissedAt)) return false;
    const elapsedDays = (Date.now() - dismissedAt) / (1000 * 60 * 60 * 24);
    return elapsedDays < DISMISS_DAYS;
  }

  function markDismissed() {
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch (e) {
      /* localStorage 사용 불가 시 무시 */
    }
  }

  function getBannerEl() {
    return document.getElementById('install-banner');
  }

  function hideBanner() {
    const el = getBannerEl();
    if (!el) return;
    el.classList.add('hidden');
    document.body.style.paddingBottom = '';
  }

  function showBanner(message, { showInstallBtn } = {}) {
    const el = getBannerEl();
    if (!el) return;
    const textEl = document.getElementById('install-banner-text');
    const installBtn = document.getElementById('install-btn');
    if (textEl) textEl.textContent = message;
    if (installBtn) installBtn.classList.toggle('hidden', !showInstallBtn);
    el.classList.remove('hidden');
    // 배너가 본문 내용을 가리지 않도록 body 하단 여백 확보
    document.body.style.paddingBottom = `${el.offsetHeight}px`;
  }

  function dismissBanner() {
    markDismissed();
    hideBanner();
  }

  function init() {
    if (isStandalone()) return; // 이미 설치되어 실행 중이면 배너를 띄우지 않음

    const closeBtn = document.getElementById('install-close-btn');
    const installBtn = document.getElementById('install-btn');
    if (closeBtn) closeBtn.addEventListener('click', dismissBanner);
    if (installBtn) {
      installBtn.addEventListener('click', async () => {
        if (!deferredPrompt) return;
        deferredPrompt.prompt();
        try {
          await deferredPrompt.userChoice;
        } catch (e) {
          /* 무시 */
        }
        deferredPrompt = null;
        hideBanner();
      });
    }

    // Android/Chrome 등: 브라우저가 설치 가능하다고 판단하면 이벤트 발생
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      deferredPrompt = e;
      if (!isDismissedRecently()) {
        showBanner('CoRoom을 홈 화면에 설치하고 더 빠르게 이용하세요.', { showInstallBtn: true });
      }
    });

    // iOS Safari: beforeinstallprompt가 없으므로 안내만 표시
    if (isIosSafari() && !isDismissedRecently()) {
      showBanner('홈 화면에 추가하려면 공유 버튼을 누른 뒤 "홈 화면에 추가"를 선택하세요.', {
        showInstallBtn: false,
      });
    }

    window.addEventListener('appinstalled', () => {
      hideBanner();
    });
  }

  init();
})();
