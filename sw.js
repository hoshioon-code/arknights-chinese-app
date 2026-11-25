/* アークナイツで学ぶ中国語 — service worker
   - App shell + data JSON: precached, cache-first.
   - Audio MP3: served from the user-managed per-chapter caches
     ('akcn-audio-<chapterId>') when present; otherwise network only
     (never auto-stored, so device storage stays under user control). */
const SHELL = 'akcn-shell-v23';
const SHELL_FILES = [
  './', 'index.html', 'styles.css', 'app.js', 'manifest.json',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png',
  'data/meta.json', 'data/terms.json', 'data/vocab.json',
  'data/audio_map.json', 'data/audio_chapters.json',
  'data/ep_main_0.json', 'data/ep_main_1.json'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(SHELL)
      .then(c => c.addAll(SHELL_FILES))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => k.startsWith('akcn-shell-') && k !== SHELL)
        .map(k => caches.delete(k)) // user audio caches (akcn-audio-*) are kept
    )).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (url.pathname.endsWith('.mp3')) {
    // Audio: any cache (chapter downloads) first, else network, no storing.
    e.respondWith(
      caches.match(e.request, { ignoreSearch: true })
        .then(hit => hit || fetch(e.request))
    );
    return;
  }
  if (url.origin === location.origin && url.pathname.includes('/data/')) {
    // Data JSON: network-first, so content updates (new chapters etc.) arrive
    // without needing a service-worker update; cache is the offline fallback.
    e.respondWith(
      fetch(e.request).then(res => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(SHELL).then(c => c.put(e.request, copy));
        }
        return res;
      }).catch(() => caches.match(e.request, { ignoreSearch: true }))
    );
    return;
  }
  // Everything else same-origin: cache-first, fall back to network and fill shell cache.
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then(hit => {
      if (hit) return hit;
      return fetch(e.request).then(res => {
        if (res.ok && url.origin === location.origin) {
          const copy = res.clone();
          caches.open(SHELL).then(c => c.put(e.request, copy));
        }
        return res;
      });
    })
  );
});
