/* ==========================================================================
   SERVICE WORKER DE NEXO (sw.js)
   Estrategia de caché gratuita y navegación offline para tableros e informes
   ========================================================================== */

const CACHE_NAME = 'nexo-cache-v1';
const KILL_SWITCH = false; // Cambiar a true para desinstalar de inmediato en todos los clientes

// Recursos estáticos versionados para precachear en install
const PRECACHE_ASSETS = [
  './',
  './index.html',
  './_sistema/fuentes/jost-var.woff2',
  './_sistema/vendor/sortable.min.js',
  './_sistema/vendor/firebase-app-compat.js',
  './_sistema/vendor/firebase-auth-compat.js',
  './_sistema/vendor/firebase-firestore-compat.js',
  './_sistema/vendor/d3.min.js',
  './_sistema/vendor/html2pdf.bundle.min.js',
  './_sistema/produccion/produccion.css?v=3.1',
  './_sistema/produccion/produccion.js?v=3.1',
  './_sistema/tablero/tablero.css',
  './_sistema/tablero/tablero.js'
];

// Helper para resolver URLs relativas al scope del service worker
const resolveUrl = (path) => new URL(path, self.registration.scope).toString();

// ==========================================================================
// 1. INSTALACIÓN
// ==========================================================================
self.addEventListener('install', (event) => {
  if (KILL_SWITCH) {
    self.skipWaiting();
    return;
  }

  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      const urls = PRECACHE_ASSETS.map(resolveUrl);
      // Precacheo resiliente: si algún asset opcional falla, no abortar la instalación
      return Promise.allSettled(urls.map((url) => {
        return fetch(url).then((response) => {
          if (response.ok) {
            return cache.put(url, response);
          }
        }).catch((err) => {
          console.warn('[SW] No se pudo precachear:', url, err.message);
        });
      }));
    }).then(() => self.skipWaiting())
  );
});

// ==========================================================================
// 2. ACTIVACIÓN Y LIMPIEZA
// ==========================================================================
self.addEventListener('activate', (event) => {
  if (KILL_SWITCH) {
    event.waitUntil(
      caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
        .then(() => self.registration.unregister())
        .then(() => self.clients.claim())
    );
    return;
  }

  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((k) => {
          if (k !== CACHE_NAME) {
            return caches.delete(k);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// ==========================================================================
// 3. ESTRATEGIAS DE FETCH
// ==========================================================================
self.addEventListener('fetch', (event) => {
  if (KILL_SWITCH || event.request.method !== 'GET') {
    return;
  }

  const url = new URL(event.request.url);

  // Kill-switch vía URL ?kill=true
  if (url.searchParams.get('kill') === 'true') {
    self.registration.unregister();
    caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k))));
    return;
  }

  // Network-Only: APIs externas de Firebase / Google y WebSockets
  if (
    url.hostname.includes('firestore.googleapis.com') ||
    url.hostname.includes('identitytoolkit.googleapis.com') ||
    url.hostname.includes('securetoken.googleapis.com') ||
    url.hostname.includes('googleapis.com') ||
    url.hostname.includes('gstatic.com')
  ) {
    return;
  }

  const pathname = url.pathname;
  const isStatic = (
    pathname.includes('/_sistema/') ||
    pathname.endsWith('.woff2') ||
    pathname.endsWith('.woff') ||
    pathname.endsWith('.css') ||
    pathname.endsWith('.js') ||
    pathname.endsWith('.png') ||
    pathname.endsWith('.svg') ||
    pathname.endsWith('.ico')
  );

  if (isStatic) {
    // ESTRATEGIA 1: Cache-First con Stale-While-Revalidate para estáticos
    event.respondWith(
      caches.match(event.request).then((cachedResponse) => {
        if (cachedResponse) {
          // Revalidar en segundo plano silenciosamente
          fetch(event.request).then((networkResponse) => {
            if (networkResponse && networkResponse.status === 200) {
              caches.open(CACHE_NAME).then((cache) => cache.put(event.request, networkResponse));
            }
          }).catch(() => {});
          return cachedResponse;
        }

        return fetch(event.request).then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const clone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return networkResponse;
        });
      })
    );
    return;
  }

  // ESTRATEGIA 2: Network-First con timeout corto (3 s) para HTML y JSONs
  // Permite ver datos frescos si hay señal, o cargar de inmediato si no hay señal en el set
  event.respondWith(
    new Promise((resolve) => {
      let resolved = false;

      const timer = setTimeout(() => {
        if (!resolved) {
          caches.match(event.request).then((cached) => {
            if (cached && !resolved) {
              resolved = true;
              resolve(cached);
            }
          });
        }
      }, 3000);

      fetch(event.request).then((networkResponse) => {
        clearTimeout(timer);
        if (networkResponse && (networkResponse.status === 200 || networkResponse.type === 'opaque')) {
          const clone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        if (!resolved) {
          resolved = true;
          resolve(networkResponse);
        }
      }).catch((fetchErr) => {
        clearTimeout(timer);
        if (!resolved) {
          caches.match(event.request).then((cached) => {
            if (cached) {
              resolved = true;
              resolve(cached);
            } else {
              // Si no hay red ni caché para una página, responder con mensaje offline amigable
              if (event.request.mode === 'navigate') {
                resolved = true;
                resolve(new Response(
                  '<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><title>Sin conexión · Nexo</title><style>body{font-family:sans-serif;background:#0d1821;color:#fff;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;padding:20px;text-align:center}h1{font-size:24px;color:#5cb83e}</style></head><body><div><h1>Sin conexión</h1><p>No se pudo conectar con el servidor y este recurso no está en caché previa.</p></div></body></html>',
                  { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
                ));
              } else {
                resolved = true;
                resolve(Response.error());
              }
            }
          });
        }
      });
    })
  );
});

// ==========================================================================
// 4. MENSAJERÍA DIRECTA (Kill switch o forzar actualización)
// ==========================================================================
self.addEventListener('message', (event) => {
  if (!event.data) return;
  if (event.data.action === 'skipWaiting') {
    self.skipWaiting();
  }
  if (event.data.action === 'kill') {
    self.registration.unregister().then(() => {
      return caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k))));
    });
  }
});

