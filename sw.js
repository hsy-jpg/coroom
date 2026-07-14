// CoRoom 서비스 워커
// - 설치 시 앱 셸(정적 자원)을 캐시
// - 같은 출처(same-origin) 요청은 "네트워크 우선, 실패 시 캐시" 전략
// - Supabase 등 cross-origin 요청은 절대 가로채지 않고 그대로 흘려보냄 (오프라인 처리는 앱 코드에서)

const CACHE_VERSION = 'v1';
const CACHE_NAME = `coroom-shell-${CACHE_VERSION}`;

const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './css/style.css',
  './js/app.js',
  './js/auth.js',
  './js/supabaseClient.js',
  './js/sw-register.js',
  './js/pwa-install.js',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon-32.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // GET이 아니거나 다른 출처(예: Supabase API) 요청은 서비스 워커가 개입하지 않음.
  if (req.method !== 'GET' || url.origin !== self.location.origin) {
    return;
  }

  event.respondWith(
    fetch(req)
      .then((response) => {
        const responseClone = response.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(req, responseClone);
        });
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(req);
        if (cached) return cached;
        // 네비게이션 요청(페이지 이동/새로고침)인 경우 앱 셸(index.html)로 폴백
        if (req.mode === 'navigate') {
          const fallback = await caches.match('./index.html');
          if (fallback) return fallback;
        }
        return Response.error();
      })
  );
});
