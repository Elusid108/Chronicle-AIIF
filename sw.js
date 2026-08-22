// Kill-switch: previous workers cached a stale HTML shell (Begin Simulation
// looked like a refresh). Clear every cache, unregister, and reload clients
// onto a network document. Do not intercept fetches.
self.addEventListener('install', (event) => {
    event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
    event.waitUntil((async () => {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
        await self.registration.unregister();
        const clients = await self.clients.matchAll({ type: 'window' });
        await Promise.all(clients.map((client) => {
            try {
                const u = new URL(client.url);
                if (u.searchParams.get('fresh') === '1') return null;
                u.searchParams.set('fresh', '1');
                return client.navigate(u.href);
            } catch {
                return client.navigate(client.url);
            }
        }));
    })());
});
