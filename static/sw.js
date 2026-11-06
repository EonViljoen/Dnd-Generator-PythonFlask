// Service worker: keeps a copy of the pages and their files so the site opens instantly
// even while the free Render server is waking up (the app then shows a "waking up" screen
// until the API answers).
//
// Strategy for same-origin GETs (pages, scripts, styles, images), never the /api:
//   network first; if the server hasn't answered within TIMEOUT and we have a saved copy,
//   use the saved copy. Successful responses refresh the saved copy, so a deploy shows up
//   on the next visit while the server is awake.

const CACHE = 'dnd-shell-v2'; // bump when the list of saved files changes
const TIMEOUT = 2500;
const SHELL = [
    '/', '/cards',
    '/styles/style.css',
    '/scripts/theme.js', '/scripts/app.js', '/scripts/data.js', '/scripts/dice.js', '/scripts/initiative.js', '/scripts/edits.js',
    '/images/favicon.svg', '/images/favicon.ico', '/images/icon-192.png', '/images/icon-512.png',
    '/manifest.webmanifest',
    '/vendor/bootstrap/bootstrap.min.css', '/vendor/bootstrap/bootstrap.bundle.min.js',
    '/vendor/bootstrap-icons/bootstrap-icons.min.css',
    '/vendor/bootstrap-icons/fonts/bootstrap-icons.woff2?dd67030699838ea613ee6dbda90effa6',
    '/vendor/fonts/fonts.css',
    '/vendor/fonts/cinzel-97f503ba.woff2', '/vendor/fonts/eb-garamond-fbc7eeae.woff2', '/vendor/fonts/eb-garamond-0c00b5f8.woff2',
];

self.addEventListener('install', (event) => {
    // Best effort: if the server is asleep during install, the pages get saved on the next visit
    event.waitUntil(
        caches.open(CACHE)
            .then((cache) => Promise.allSettled(SHELL.map((url) => cache.add(url))))
            .then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
            .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (event) => {
    const request = event.request;
    if (request.method !== 'GET') return;
    const url = new URL(request.url);
    if (url.origin !== self.location.origin || url.pathname.startsWith('/api/') || url.pathname === '/sw.js') return;
    event.respondWith(networkFirst(event, request));
});

async function networkFirst(event, request) {
    const cache = await caches.open(CACHE);
    const network = fetch(request).then((response) => {
        if (response.ok && response.type === 'basic') cache.put(request, response.clone());
        return response;
    });
    event.waitUntil(network.catch(() => {})); // keep refreshing the saved copy in the background
    const cached = await cache.match(request, { ignoreSearch: request.mode === 'navigate' });
    if (!cached) return network; // nothing saved yet: wait for the server
    const slow = new Promise((resolve) => setTimeout(() => resolve(null), TIMEOUT));
    // A waking server may answer with an error page (502/503): prefer the saved copy then too
    const good = network.then((response) => (response.ok ? response : null));
    try {
        return (await Promise.race([good, slow])) || cached;
    } catch {
        return cached; // offline or server error: use the saved copy
    }
}
