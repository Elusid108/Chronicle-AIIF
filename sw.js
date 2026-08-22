const CACHE = 'chronicle-shell-v4';

const PRECACHE = [
    './',
    './index.html',
    './src/main.js',
    './src/html.js',
    './src/App.js',
    './src/constants.js',
    './src/api/gemini.js',
    './src/engine/prompt.js',
    './src/engine/memory.js',
    './src/engine/session.js',
    './src/utils/storage.js',
    './src/utils/idb.js',
    './src/utils/audio.js',
    './src/utils/images.js',
    './src/workers/compress-image.js',
    './src/components/ui.js',
    './src/components/ApiKeyModal.js',
    './src/components/SetupView.js',
    './src/components/SettingsPanel.js',
    './src/components/Panels.js',
    './src/components/GameView.js',
    'https://esm.sh/react@18.2.0',
    'https://esm.sh/react-dom@18.2.0?external=react',
    'https://esm.sh/react-dom@18.2.0/client?external=react',
    'https://esm.sh/htm@3.1.1',
    'https://esm.sh/lucide-react@0.344.0?external=react',
    'https://cdn.tailwindcss.com',
    'https://fonts.googleapis.com/css2?family=Cinzel:wght@400;700&family=Inter:wght@300;400;600&family=Merriweather:ital,wght@0,300;0,400;0,700;1,400&display=swap',
];

const isApiHost = (url) => {
    const host = url.hostname;
    return host === 'generativelanguage.googleapis.com' || host.endsWith('.googleapis.com')
        || host === 'image.pollinations.ai' || host.endsWith('pollinations.ai');
};

const isCdnHost = (url) => {
    const host = url.hostname;
    return host === 'esm.sh' || host === 'cdn.tailwindcss.com'
        || host === 'fonts.googleapis.com' || host === 'fonts.gstatic.com';
};

self.addEventListener('install', (event) => {
    event.waitUntil((async () => {
        const cache = await caches.open(CACHE);
        await Promise.all(PRECACHE.map(async (url) => {
            try { await cache.add(url); } catch { /* optional asset */ }
        }));
        self.skipWaiting();
    })());
});

self.addEventListener('activate', (event) => {
    event.waitUntil((async () => {
        const keys = await caches.keys();
        await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
        self.clients.claim();
    })());
});

self.addEventListener('fetch', (event) => {
    const req = event.request;
    if (req.method !== 'GET') return;
    const url = new URL(req.url);

    if (isApiHost(url)) return;

    event.respondWith((async () => {
        const cache = await caches.open(CACHE);
        const cached = await cache.match(req);
        const isLocalCode = url.origin === self.location.origin &&
            (url.pathname.endsWith('.js') || url.pathname.endsWith('.html') || url.pathname.endsWith('/') || url.pathname.endsWith('sw.js'));

        // Always revalidate app JS/HTML so a broken parse cannot stick in cache.
        if (isLocalCode) {
            try {
                const fresh = await fetch(req, { cache: 'no-store' });
                if (fresh && fresh.ok) cache.put(req, fresh.clone());
                return fresh;
            } catch (e) {
                if (cached) return cached;
                throw e;
            }
        }

        if (cached && isCdnHost(url)) return cached;
        try {
            const fresh = await fetch(req);
            if (fresh && fresh.ok && isCdnHost(url)) cache.put(req, fresh.clone());
            return fresh;
        } catch (e) {
            if (cached) return cached;
            throw e;
        }
    })());
});
