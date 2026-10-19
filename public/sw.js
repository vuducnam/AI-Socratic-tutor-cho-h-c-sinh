// Service worker của PWA Cú (SPEC §14b › Vận hành): PC tắt hoặc app không phản hồi → hiện màn hình
// "Cú đang nghỉ" thay vì lỗi trình duyệt. Chỉ cache trang /offline và icon; KHÔNG cache dữ liệu của con
// (API và trang có dữ liệu luôn đi mạng).
const CACHE = 'cu-offline-v1';
const OFFLINE_URL = '/offline';

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll([OFFLINE_URL, '/icons/owl.svg'])));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.mode !== 'navigate') return;
  event.respondWith(
    fetch(req)
      .then((res) => (res.status >= 502 ? caches.match(OFFLINE_URL).then((r) => r || res) : res))
      .catch(() => caches.match(OFFLINE_URL)),
  );
});
