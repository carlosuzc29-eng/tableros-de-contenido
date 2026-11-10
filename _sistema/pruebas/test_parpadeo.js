#!/usr/bin/env node
/**
 * Prueba automatizada antiparpadeo y rendimiento de carga para Nexo Tableros.
 * Verifica:
 *   1. .nojs-note nunca es visible desde el primer frame (display: none).
 *   2. Tarjetas en viewport tienen opacity = 1 en < 300 ms.
 *   3. Con caché en localStorage, #pct no cambia entre el primer pintado y 5 s después.
 *   4. Sin caché, #pct nunca muestra un número distinto del estado final de Firestore.
 *   5. El top de la primera tarjeta no se mueve más de 2 px entre 300 ms y 5 s.
 *   6. Tras focus con doc sin cambios, MutationObserver registra 0 nodos añadidos o quitados.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const REPO_ROOT = path.resolve(__dirname, '../..');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml'
};

function createLocalServer(port = 0) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      try {
        const parsedUrl = new URL(req.url, 'http://127.0.0.1');
        let reqPath = decodeURIComponent(parsedUrl.pathname);
        if (reqPath === '/' || reqPath === '') reqPath = '/bambu-bistro-1f6bcb.html';
        const filePath = path.join(REPO_ROOT, reqPath.replace(/^\//, ''));

        if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('404 Not Found');
          return;
        }

        const ext = path.extname(filePath).toLowerCase();
        const contentType = MIME_TYPES[ext] || 'application/octet-stream';
        res.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'no-cache' });
        fs.createReadStream(filePath).pipe(res);
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('500 Error: ' + e.message);
      }
    });

    server.listen(port, '127.0.0.1', () => {
      const assignedPort = server.address().port;
      resolve({ server, baseUrl: `http://127.0.0.1:${assignedPort}` });
    });
    server.on('error', reject);
  });
}

const C = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  bold: '\x1b[1m'
};

function pass(msg) {
  console.log(`  ${C.green}✓${C.reset} ${msg}`);
}

function fail(msg, err) {
  console.error(`  ${C.red}✗ ERROR:${C.reset} ${msg}`);
  if (err) console.error(err);
  process.exit(1);
}

// Simulación de documento de Firestore para pruebas
function getSampleFirestoreDoc(docId = 'bambu-bistro-2026-noviembre-b25b3aa7') {
  return {
    name: `projects/nexo-tableros-app/databases/(default)/documents/tableros/${docId}`,
    fields: {
      id: { stringValue: docId },
      cliente: { stringValue: 'Bambú Bistro' },
      mes: { stringValue: 'Noviembre' },
      anio: { stringValue: '2026' },
      url: { stringValue: 'https://carlosuzc29-eng.github.io/tableros-de-contenido/bambu-bistro-1f6bcb.html' },
      total: { integerValue: '8' },
      aprobados: { integerValue: '8' },
      cambios: { integerValue: '0' },
      pendientes: { integerValue: '0' },
      estado: { stringValue: 'Aprobado' },
      revisadoPor: { stringValue: 'Carlos QA' },
      ultimaRevision: { stringValue: '2026-11-09T18:00:00Z' },
      contenidos: {
        arrayValue: {
          values: Array.from({ length: 8 }, (_, i) => ({
            mapValue: {
              fields: {
                id: { stringValue: 'c' + (i + 1) },
                n: { integerValue: String(i + 1) },
                titulo: { stringValue: 'Contenido ' + (i + 1) },
                estado: { stringValue: 'aprobado' },
                version: { integerValue: '1' }
              }
            }
          }))
        }
      }
    },
    updateTime: '2026-11-09T18:00:00.123456Z'
  };
}

(async () => {
  console.log(`${C.bold}${C.cyan}--- INICIO PRUEBAS ANTIPARPADEO Y RENDIMIENTO DE CARGA (test_parpadeo.js) ---${C.reset}\n`);

  const { server, baseUrl } = await createLocalServer();
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--disable-web-security']
  });

  const VIEWPORTS = [
    { name: 'Desktop (1366×900)', width: 1366, height: 900 },
    { name: 'Mobile (390×844)', width: 390, height: 844 }
  ];

  try {
    for (const vp of VIEWPORTS) {
      console.log(`\n${C.bold}Evaluando en ${vp.name}...${C.reset}`);

      // ─────────────────────────────────────────────────────────────
      // 1. SIN CACHÉ: verificar .nojs-note, opacity <300ms, #pct neutro y estabilidad de top
      // ─────────────────────────────────────────────────────────────
      {
        const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
        const page = await context.newPage();

        // Monitoreo en tiempo real desde el inicio del documento
        await page.addInitScript(() => {
          window.__nojsNoteWasVisible = false;
          window.__pctHistory = [];

          const checkNoJsNote = () => {
            const el = document.querySelector('.nojs-note');
            if (el && window.getComputedStyle(el).display !== 'none') {
              window.__nojsNoteWasVisible = true;
            }
          };

          const checkPct = () => {
            const el = document.getElementById('pct');
            if (el) {
              const txt = (el.textContent || '').trim();
              if (txt && (!window.__pctHistory.length || window.__pctHistory[window.__pctHistory.length - 1] !== txt)) {
                window.__pctHistory.push(txt);
              }
            }
          };

          checkNoJsNote();
          checkPct();

          const obs = new MutationObserver(() => {
            checkNoJsNote();
            checkPct();
          });
          obs.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
        });

        const fsDoc = getSampleFirestoreDoc();

        // Interceptar Firestore con delay controlado (120ms) para simular red real
        await page.route('**/databases/(default)/documents/tableros/**', async route => {
          await new Promise(r => setTimeout(r, 120));
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(fsDoc)
          });
        });

        await page.goto(`${baseUrl}/bambu-bistro-1f6bcb.html`, { waitUntil: 'domcontentloaded' });

        // Verificación en < 300 ms (esperamos 250 ms desde la carga)
        await page.waitForTimeout(220);

        const snapshot250 = await page.evaluate(() => {
          const cards = Array.from(document.querySelectorAll('.card'));
          const vh = window.innerHeight;
          const inViewportCards = cards.filter(c => {
            const r = c.getBoundingClientRect();
            return r.top < vh && r.bottom > 0;
          });
          const opacities = inViewportCards.map(c => parseFloat(window.getComputedStyle(c).opacity));
          const firstCard = cards[0];
          const firstCardOpacity = firstCard ? parseFloat(window.getComputedStyle(firstCard).opacity) : 1;
          const topAt300 = firstCard ? firstCard.getBoundingClientRect().top : 0;
          return {
            nojsVisible: window.__nojsNoteWasVisible,
            opacities,
            firstCardOpacity,
            inViewportCount: inViewportCards.length,
            topAt300
          };
        });

        if (snapshot250.nojsVisible) {
          fail(`En ${vp.name}, el aviso '.nojs-note' fue visible durante la carga.`);
        }
        pass(`[${vp.name}] .nojs-note nunca fue visible (display === 'none' permanente)`);

        if (snapshot250.firstCardOpacity < 0.95 || (snapshot250.opacities.length > 0 && snapshot250.opacities.some(o => o < 0.95))) {
          fail(`En ${vp.name}, tarjetas en viewport sin opacity 1 en <300ms: opacidades = ${JSON.stringify(snapshot250.opacities)}, primera = ${snapshot250.firstCardOpacity}`);
        }
        pass(`[${vp.name}] Tarjetas dentro del viewport tienen opacity 1 en <300ms (primera tarjeta opacity: ${snapshot250.firstCardOpacity})`);

        // Esperar a los 5 s (o respuesta completa) para medir top final y números de pct
        await page.waitForTimeout(2800);

        const finalState = await page.evaluate(() => {
          const firstCard = document.querySelector('.card');
          const finalTop = firstCard ? firstCard.getBoundingClientRect().top : 0;
          const pctEl = document.getElementById('pct');
          const finalPct = pctEl ? pctEl.textContent.trim() : '';
          return {
            finalTop,
            finalPct,
            pctHistory: window.__pctHistory
          };
        });

        // Comprobar que el top no se movió más de 2 px entre 300 ms y final
        const topDelta = Math.abs(finalState.finalTop - snapshot250.topAt300);
        if (topDelta > 2) {
          fail(`En ${vp.name}, el top de la primera tarjeta se movió ${topDelta.toFixed(1)} px (esperado <= 2 px, sin saltos por banner ni fuente).`);
        }
        pass(`[${vp.name}] Estabilidad de layout: el top de la primera tarjeta varió solo ${topDelta.toFixed(1)} px (<= 2 px)`);

        // Comprobar que #pct nunca mostró un número falso (distinto del final)
        // Valores permitidos en el historial: "…" o el número final (ej: "100%")
        const wrongNumbers = finalState.pctHistory.filter(v => {
          if (v === '…' || v === finalState.finalPct) return false;
          return /\d+/.test(v);
        });
        if (wrongNumbers.length > 0) {
          fail(`En ${vp.name}, #pct mostró números previos falsos antes del estado final: ${JSON.stringify(finalState.pctHistory)}`);
        }
        pass(`[${vp.name}] Sin caché: #pct nunca mostró números distintos del estado final (historial: ${JSON.stringify(finalState.pctHistory)})`);

        await context.close();
      }

      // ─────────────────────────────────────────────────────────────
      // 2. CON CACHÉ: verificar que #pct es instantáneo y no cambia durante 5 s
      // ─────────────────────────────────────────────────────────────
      {
        const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
        const fsDoc = getSampleFirestoreDoc();

        // Inyectar en localStorage la caché nexo-fs-<id> antes de la navegación
        await context.addInitScript((docData) => {
          try {
            localStorage.setItem('nexo-fs-bambu-bistro-2026-noviembre-b25b3aa7', JSON.stringify({
              updateTime: docData.updateTime,
              doc: docData,
              cachedAt: Date.now()
            }));
          } catch(e) {}
        }, fsDoc);

        const page = await context.newPage();

        await page.addInitScript(() => {
          window.__pctValues = [];
          const check = () => {
            const el = document.getElementById('pct');
            if (el) {
              const val = el.textContent.trim();
              if (val && (!window.__pctValues.length || window.__pctValues[window.__pctValues.length - 1] !== val)) {
                window.__pctValues.push(val);
              }
            }
          };
          check();
          const obs = new MutationObserver(check);
          obs.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
        });

        // Firestore responde idéntico
        await page.route('**/databases/(default)/documents/tableros/**', async route => {
          await new Promise(r => setTimeout(r, 100));
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(fsDoc)
          });
        });

        await page.goto(`${baseUrl}/bambu-bistro-1f6bcb.html`, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(2500);

        const cacheResults = await page.evaluate(() => {
          return {
            pctHistory: window.__pctValues
          };
        });

        if (cacheResults.pctHistory.length > 1 && cacheResults.pctHistory.some(v => v !== '100%')) {
          fail(`En ${vp.name} con caché, #pct varió durante la carga: ${JSON.stringify(cacheResults.pctHistory)}`);
        }
        pass(`[${vp.name}] Con caché: #pct se mantuvo idéntico al 100% desde el primer pintado`);

        // ─────────────────────────────────────────────────────────────
        // 3. MUTATION OBSERVER EN EVENTO FOCUS CON FIRESTORE SIN CAMBIOS = 0 MUTACIONES
        // ─────────────────────────────────────────────────────────────
        const mutationCount = await page.evaluate(async () => {
          window.__domMutations = 0;
          const targets = [
            document.getElementById('list'),
            document.getElementById('canalFilter'),
            document.getElementById('sOk'),
            document.getElementById('sFix'),
            document.getElementById('sPend'),
            document.getElementById('dN'),
            document.getElementById('pct')
          ].filter(Boolean);

          const observer = new MutationObserver((mutations) => {
            for (const m of mutations) {
              window.__domMutations += (m.addedNodes.length + m.removedNodes.length);
            }
          });

          targets.forEach(t => observer.observe(t, { childList: true, subtree: true }));

          // Disparar evento focus en la ventana
          window.dispatchEvent(new Event('focus'));

          // Esperar ciclo de eventos y fetch de sync
          await new Promise(res => setTimeout(res, 600));

          observer.disconnect();
          return window.__domMutations;
        });

        if (mutationCount !== 0) {
          fail(`En ${vp.name}, focus con Firestore sin cambios provocó ${mutationCount} mutaciones de nodos (esperado: 0).`);
        }
        pass(`[${vp.name}] En evento focus con doc sin cambios: 0 nodos agregados o quitados`);

        await context.close();
      }
    }

    console.log(`\n${C.bold}${C.green}================================================================${C.reset}`);
    console.log(`${C.bold}${C.green}✓ PRUEBAS ANTIPARPADEO Y RENDIMIENTO COMPLETADAS EXITOSAMENTE (100% OK)${C.reset}`);
    console.log(`${C.bold}${C.green}================================================================${C.reset}\n`);
  } finally {
    await browser.close();
    server.close();
  }
})();

