// Minimal service worker so the dashboard is installable as an app.
// Deliberately does no caching: every page is authenticated and per-tenant,
// so all requests go straight to the network. Only a navigation that fails
// (phone offline) gets a small offline page instead of the browser's error.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

const OFFLINE_HTML = `<!doctype html><html lang="da"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Magnora</title>
<style>body{font-family:system-ui,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;padding:16px;text-align:center;color:#0f172a}button{margin-top:16px;padding:10px 20px;border:0;border-radius:8px;background:#2563eb;color:#fff;font-size:16px}</style>
</head><body><div><h1>Ingen forbindelse</h1><p>Tjek din internetforbindelse og prøv igen.</p>
<button onclick="location.reload()">Prøv igen</button></div></body></html>`;

self.addEventListener("fetch", (event) => {
  if (event.request.mode !== "navigate") return;
  event.respondWith(
    fetch(event.request).catch(
      () => new Response(OFFLINE_HTML, { headers: { "Content-Type": "text/html; charset=utf-8" } })
    )
  );
});
