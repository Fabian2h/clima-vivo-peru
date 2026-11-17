/* Clima Vivo Perú — service worker
   - App (HTML, íconos, librerías): se guarda al instalar y se sirve aunque no haya señal.
   - Datos climáticos (NASA POWER, Open-Meteo): primero la red; si falla, la última copia guardada.
*/
const VERSION = 'cvp-v6';
const SHELL = `${VERSION}-shell`;
const DATA = `${VERSION}-data`;
const SHELL_FILES = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png', './icon-maskable-512.png', './apple-touch-icon.png'];
const CDN_FILES = [
  'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css'
];
const DATA_HOSTS = ['open-meteo.com', 'power.larc.nasa.gov'];
const CDN_HOSTS = ['cdnjs.cloudflare.com', 'fonts.googleapis.com', 'fonts.gstatic.com', 'unpkg.com'];
const DATE_PARAMS = ['start', 'end', 'start_date', 'end_date'];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(SHELL);
    await c.addAll(SHELL_FILES);
    await Promise.all(CDN_FILES.map(u => fetch(u, { mode: 'cors' }).then(r => r.ok && c.put(u, r)).catch(() => {})));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (!k.startsWith(VERSION)) await caches.delete(k);
    await self.clients.claim();
  })());
});

/* Las consultas de NASA llevan fechas que cambian cada día; se normaliza la clave
   para que, sin señal, se encuentre la última copia del mismo punto. */
function dataKey(url) {
  const u = new URL(url);
  DATE_PARAMS.forEach(p => u.searchParams.delete(p));
  u.searchParams.sort();
  return u.toString();
}

async function networkFirstData(req) {
  const cache = await caches.open(DATA);
  const key = dataKey(req.url);
  try {
    const res = await fetch(req);
    if (res.ok) {
      const body = await res.clone().blob();
      const headers = new Headers(res.headers);
      headers.set('x-cvp-saved', new Date().toISOString());
      headers.set('Access-Control-Expose-Headers', 'x-cvp-saved');
      await cache.put(key, new Response(body, { status: 200, headers }));
    }
    return res;
  } catch (err) {
    const hit = await cache.match(key);
    if (!hit) throw err;
    /* Se marca la copia con su fecha para que la app avise «datos guardados el …». */
    try {
      const j = await hit.json();
      j._cvp_saved = hit.headers.get('x-cvp-saved');
      return new Response(JSON.stringify(j), { status: 200, headers: { 'Content-Type': 'application/json' } });
    } catch (e) { return cache.match(key); }
  }
}

async function staleWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req, { ignoreVary: true });
  const net = fetch(req).then(res => { if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone()); return res; }).catch(() => null);
  return hit || (await net) || new Response('', { status: 504 });
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (DATA_HOSTS.some(h => url.hostname.endsWith(h))) { e.respondWith(networkFirstData(req)); return; }
  if (CDN_HOSTS.some(h => url.hostname.endsWith(h))) { e.respondWith(staleWhileRevalidate(req, SHELL)); return; }
  if (url.origin === self.location.origin) {
    if (req.mode === 'navigate') {
      /* 'no-cache': siempre pregunta a GitHub si hay versión nueva (evita la copia vieja del navegador). */
      e.respondWith(fetch(new Request(req.url, { cache: 'no-cache', credentials: 'same-origin' })).then(r => { if (r.ok) { const copy = r.clone(); caches.open(SHELL).then(c => c.put('./index.html', copy)); } return r; })
        .catch(() => caches.match('./index.html')));
      return;
    }
    e.respondWith(staleWhileRevalidate(req, SHELL));
  }
  /* Teselas del mapa y demás: directo a la red (sin guardar). */
});
