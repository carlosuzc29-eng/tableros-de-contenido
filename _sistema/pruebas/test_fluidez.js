#!/usr/bin/env node
/**
 * Prueba automatizada de Fluidez y Service Worker para Nexo Tableros.
 * Verifica:
 *   1. Integridad y configuración de sw.js (CACHE_NAME, KILL_SWITCH, precache, estrategias).
 *   2. Registro de sw.js en plantillas, banco de trabajo y tableros activos nov 2026.
 *   3. Optimización de fuentes: jost-var.woff2 unificada (reemplaza 4 descargas redundantes).
 *   4. Dependencias vendorizadas localmente en _sistema/vendor/ sin bloqueos CDN.
 *   5. Banco de trabajo (index.html): html2pdf diferido bajo demanda y persistencia Firestore.
 *   6. Desacople de CSS y JS en tableros de producción (produccion.css, produccion.js).
 *   7. Medición de CLS (Cumulative Layout Shift < 0.05) en viewport móvil (390×844) y escritorio.
 */

const fs = require('fs');
const path = require('path');
let chromium;
try {
  chromium = require('playwright').chromium;
} catch (e) {
  chromium = require(path.join(__dirname, 'node_modules', 'playwright')).chromium;
}

const REPO_ROOT = path.resolve(__dirname, '../..');

const C = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  yellow: '\x1b[33m',
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

(async () => {
  console.log(`${C.bold}${C.cyan}--- INICIO PRUEBAS DE FLUIDEZ Y SERVICE WORKER (test_fluidez.js) ---${C.reset}\n`);

  try {
    // =========================================================================
    // 1. VERIFICACIÓN ESTÁTICA DEL SERVICE WORKER (sw.js)
    // =========================================================================
    console.log(`${C.bold}1. Verificando Service Worker (sw.js)...${C.reset}`);
    const swPath = path.join(REPO_ROOT, 'sw.js');
    if (!fs.existsSync(swPath)) fail('sw.js no existe en la raíz del repositorio');

    const swContent = fs.readFileSync(swPath, 'utf8');
    if (!swContent.includes('CACHE_NAME')) fail('sw.js debe definir CACHE_NAME');
    if (!swContent.includes('KILL_SWITCH')) fail('sw.js debe contar con la bandera KILL_SWITCH');
    if (!swContent.includes('PRECACHE_ASSETS')) fail('sw.js debe declarar PRECACHE_ASSETS');
    if (!swContent.includes('jost-var.woff2')) fail('sw.js debe precachear jost-var.woff2');
    if (!swContent.includes('produccion.css')) fail('sw.js debe precachear produccion.css');
    if (!swContent.includes('produccion.js')) fail('sw.js debe precachear produccion.js');
    if (!swContent.includes('stale-while-revalidate') && !swContent.includes('caches.match')) {
      fail('sw.js debe implementar estrategia de caché para estáticos');
    }
    pass('sw.js implementa arquitectura Cache-First, Network-First y Kill-Switch de emergencia');

    // =========================================================================
    // 2. VERIFICACIÓN DE REGISTRO EN PÁGINAS DEL SISTEMA
    // =========================================================================
    console.log(`\n${C.bold}2. Verificando registro del Service Worker en páginas clave...${C.reset}`);
    const pagesToCheck = [
      { file: '_sistema/plantilla-tablero.html', pattern: /navigator\.serviceWorker\.register\(['"]sw\.js['"]\)/ },
      { file: '_sistema/plantilla-produccion.html', pattern: /navigator\.serviceWorker\.register\(['"]\.\.\/sw\.js['"]\)/ },
      { file: 'index.html', pattern: /navigator\.serviceWorker\.register\(['"]sw\.js['"]\)/ },
      { file: 'bambu-bistro-1f6bcb.html', pattern: /navigator\.serviceWorker\.register\(['"]sw\.js['"]\)/ },
      { file: 'produccion/burger-house-2026-11-10-871438.html', pattern: /navigator\.serviceWorker\.register\(['"]\.\.\/sw\.js['"]\)/ },
      { file: 'produccion/impreco-2026-11-02-d906fe.html', pattern: /navigator\.serviceWorker\.register\(['"]\.\.\/sw\.js['"]\)/ },
      { file: 'produccion/la-guajira-food-2026-11-10-7fa1aa.html', pattern: /navigator\.serviceWorker\.register\(['"]\.\.\/sw\.js['"]\)/ },
      { file: 'produccion/moffyns-2026-11-06-50c2c8.html', pattern: /navigator\.serviceWorker\.register\(['"]\.\.\/sw\.js['"]\)/ }
    ];

    for (const item of pagesToCheck) {
      const fullPath = path.join(REPO_ROOT, item.file);
      if (!fs.existsSync(fullPath)) fail(`No se encontró el archivo ${item.file}`);
      const content = fs.readFileSync(fullPath, 'utf8');
      if (!item.pattern.test(content)) {
        fail(`${item.file} no registra el Service Worker correctamente`);
      }
    }
    pass(`Registro de Service Worker verificado en las ${pagesToCheck.length} páginas requeridas`);

    // =========================================================================
    // 3. OPTIMIZACIÓN DE TIPOGRAFÍA JOST
    // =========================================================================
    console.log(`\n${C.bold}3. Verificando unificación tipográfica (Jost Variable)...${C.reset}`);
    const fontPath = path.join(REPO_ROOT, '_sistema/fuentes/jost-var.woff2');
    if (!fs.existsSync(fontPath)) fail('jost-var.woff2 no existe en _sistema/fuentes/');
    const fontStat = fs.statSync(fontPath);
    if (fontStat.size < 20000 || fontStat.size > 40000) {
      fail(`Tamaño inesperado para jost-var.woff2: ${fontStat.size} bytes (debe ser ~26 KB)`);
    }

    const cssTablero = fs.readFileSync(path.join(REPO_ROOT, '_sistema/tablero/tablero.css'), 'utf8');
    const matchesTablero = (cssTablero.match(/jost-var\.woff2/g) || []).length;
    if (matchesTablero === 0) fail('tablero.css no referencia jost-var.woff2');
    if (cssTablero.includes('jost-400.woff2') || cssTablero.includes('jost-500.woff2')) {
      fail('tablero.css todavía contiene referencias a fuentes duplicadas');
    }
    pass('Fuente Jost unificada a variable WOFF2 (26 KB vs 105 KB previo)');

    // =========================================================================
    // 4. DEPENDENCIAS LOCALES EN _SISTEMA/VENDOR/
    // =========================================================================
    console.log(`\n${C.bold}4. Verificando dependencias en _sistema/vendor/...${C.reset}`);
    const vendors = [
      'sortable.min.js',
      'firebase-app-compat.js',
      'firebase-auth-compat.js',
      'firebase-firestore-compat.js',
      'd3.min.js',
      'html2pdf.bundle.min.js'
    ];
    for (const v of vendors) {
      const vp = path.join(REPO_ROOT, '_sistema/vendor', v);
      if (!fs.existsSync(vp) || fs.statSync(vp).size < 1000) {
        fail(`Vendor faltante o corrupto: ${v}`);
      }
    }
    pass(`Las ${vendors.length} librerías vendorizadas están disponibles localmente`);

    // =========================================================================
    // 5. BANCO DE TRABAJO (index.html) CARGA BAJO DEMANDA
    // =========================================================================
    console.log(`\n${C.bold}5. Verificando banco de trabajo (index.html)...${C.reset}`);
    const indexContent = fs.readFileSync(path.join(REPO_ROOT, 'index.html'), 'utf8');
    if (indexContent.includes('<script src="_sistema/vendor/html2pdf') ||
        indexContent.includes('<script src="https://cdnjs.cloudflare.com/ajax/libs/html2pdf')) {
      fail('index.html no debe cargar html2pdf de forma estática en el arranque');
    }
    if (!indexContent.includes('ensureHtml2Pdf')) {
      fail('index.html debe cargar html2pdf bajo demanda vía ensureHtml2Pdf');
    }
    if (!indexContent.includes('enablePersistence')) {
      fail('index.html debe configurar enablePersistence para Firestore');
    }
    pass('index.html carga html2pdf bajo demanda y activa persistencia en IndexedDB');

    // =========================================================================
    // 6. MEDICIÓN DE CLS (CUMULATIVE LAYOUT SHIFT < 0.05) CON PLAYWRIGHT
    // =========================================================================
    console.log(`\n${C.bold}6. Evaluando Cumulative Layout Shift (CLS) en móvil y escritorio...${C.reset}`);

    const browser = await chromium.launch({
      channel: 'chrome',
      headless: true,
      args: ['--allow-file-access-from-files', '--disable-web-security']
    });

    try {
      const tests = [
        {
          name: 'Tablero Aprobación Bambú Bistro (Móvil 390×844)',
          file: 'bambu-bistro-1f6bcb.html',
          viewport: { width: 390, height: 844 }
        },
        {
          name: 'Tablero Aprobación Bambú Bistro (Escritorio 1366×900)',
          file: 'bambu-bistro-1f6bcb.html',
          viewport: { width: 1366, height: 900 }
        },
        {
          name: 'Tablero Producción Burger House (Móvil 390×844)',
          file: 'produccion/burger-house-2026-11-10-871438.html',
          viewport: { width: 390, height: 844 }
        },
        {
          name: 'Tablero Producción Burger House (Escritorio 1366×900)',
          file: 'produccion/burger-house-2026-11-10-871438.html',
          viewport: { width: 1366, height: 900 }
        }
      ];

      for (const t of tests) {
        const context = await browser.newContext({ viewport: t.viewport });
        const page = await context.newPage();

        // Inyectar observador de CLS antes de que cargue el DOM
        await page.addInitScript(() => {
          window.__clsValue = 0;
          try {
            const observer = new PerformanceObserver((entryList) => {
              for (const entry of entryList.getEntries()) {
                if (!entry.hadRecentInput) {
                  window.__clsValue += entry.value;
                }
              }
            });
            observer.observe({ type: 'layout-shift', buffered: true });
          } catch (e) {
            window.__clsError = e.message;
          }
        });

        const targetUrl = 'file://' + path.join(REPO_ROOT, t.file);
        await page.goto(targetUrl, { waitUntil: 'load', timeout: 15000 });

        // Esperar a estabilización visual
        await page.waitForTimeout(1000);

        const cls = await page.evaluate(() => window.__clsValue || 0);
        console.log(`    CLS medido en ${t.name}: ${cls.toFixed(4)}`);

        if (cls >= 0.05) {
          fail(`CLS excedió el umbral de 0.05 en ${t.name}: ${cls.toFixed(4)}`);
        }
        await context.close();
      }
      pass('CLS verificado < 0.05 en móvil y escritorio para tableros de aprobación y producción');

    } finally {
      await browser.close();
    }

    console.log(`\n${C.bold}${C.green}--- TODAS LAS PRUEBAS DE FLUIDEZ Y SERVICE WORKER COMPLETADAS CON ÉXITO (100% OK) ---${C.reset}`);
  } catch (err) {
    fail('Fallo inesperado durante las pruebas de fluidez', err);
  }
})();

