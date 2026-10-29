#!/usr/bin/env node
/**
 * verificar_publicado.js
 *
 * Verifica los tableros publicados contra la web real de GitHub Pages:
 * - Todo recurso local pedido (CSS, JS, datos/...) responde 200
 * - document.body tiene el fondo y el JavaScript cargó
 * - El título muestra el mes de indice.json -> actual
 * - Sin pageerror
 * - Ninguna escritura a Firestore (bloquear todo lo que no sea GET)
 *
 * Uso:
 *   node _sistema/pruebas/verificar_publicado.js [archivo.html ...]
 */

const fs = require('fs');
const path = require('path');

let chromium;
try {
  chromium = require('playwright').chromium;
} catch (e) {
  try {
    chromium = require(path.join(__dirname, 'node_modules', 'playwright')).chromium;
  } catch (err) {
    console.error('❌ No se pudo cargar Playwright:', err.message);
    process.exit(1);
  }
}

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const BASE_URL = 'https://carlosuzc29-eng.github.io/tableros-de-contenido/';

const MESES_MAP = {
  '01': 'Enero', '02': 'Febrero', '03': 'Marzo', '04': 'Abril',
  '05': 'Mayo', '06': 'Junio', '07': 'Julio', '08': 'Agosto',
  '09': 'Septiembre', '10': 'Octubre', '11': 'Noviembre', '12': 'Diciembre'
};

function normalizarTexto(txt) {
  return String(txt || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

async function obtenerTablerosAComprobar(args) {
  if (args.length > 0) {
    return args.map(a => path.basename(a));
  }
  const files = fs.readdirSync(REPO_ROOT).filter(f => f.endsWith('.html'));
  const tableros = [];
  for (const f of files) {
    const fullPath = path.join(REPO_ROOT, f);
    const content = fs.readFileSync(fullPath, 'utf8');
    if (content.includes('<meta name="nexo-tablero"')) {
      tableros.push(f);
    }
  }
  return tableros;
}

(async () => {
  const args = process.argv.slice(2);
  const tableros = await obtenerTablerosAComprobar(args);

  if (tableros.length === 0) {
    console.log('No se encontraron tableros para verificar.');
    process.exit(0);
  }

  console.log(`Verificando ${tableros.length} tablero(s) publicado(s) en GitHub Pages...\nURL Base: ${BASE_URL}\n`);

  const browser = await chromium.launch({ headless: true });
  let hasErrors = false;

  for (const file of tableros) {
    const fullPath = path.join(REPO_ROOT, file);
    if (!fs.existsSync(fullPath)) {
      console.error(`❌ Archivo local no encontrado: ${file}`);
      hasErrors = true;
      continue;
    }

    const htmlContent = fs.readFileSync(fullPath, 'utf8');
    const matchMeta = htmlContent.match(/<meta\s+name=["']nexo-tablero["']\s+content=["']([^"']+)["']/i);
    const codigoCliente = matchMeta ? matchMeta[1] : '';

    let mesActualEtiqueta = '';
    if (codigoCliente) {
      const indicePath = path.join(REPO_ROOT, 'datos', codigoCliente, 'indice.json');
      if (fs.existsSync(indicePath)) {
        try {
          const indiceData = JSON.parse(fs.readFileSync(indicePath, 'utf8'));
          const actualKey = indiceData.actual || '';
          const mesObj = (indiceData.meses || []).find(m => m.mes === actualKey);
          if (mesObj && mesObj.etiqueta) {
            mesActualEtiqueta = mesObj.etiqueta;
          } else if (actualKey) {
            const parts = actualKey.split('-');
            if (parts.length === 2) {
              const mm = parts[1];
              const aaaa = parts[0];
              mesActualEtiqueta = `${MESES_MAP[mm] || ''} ${aaaa}`.trim();
            }
          }
        } catch (_) {}
      }
    }

    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const pageErrors = [];
    const resourceErrors = [];
    let blockedFirestoreWrites = 0;

    page.on('pageerror', err => pageErrors.push(err.message));

    page.on('response', resp => {
      const u = resp.url();
      if (u.startsWith(BASE_URL) && !u.includes('?v=')) {
        if (resp.status() >= 400) {
          resourceErrors.push(`HTTP ${resp.status()} en recurso: ${u}`);
        }
      }
    });

    // Bloquear todo lo que no sea GET a Firestore
    await page.route('**/*firestore*/**', route => {
      const method = route.request().method();
      if (method !== 'GET') {
        blockedFirestoreWrites++;
        route.abort();
      } else {
        route.continue();
      }
    });

    const targetUrl = `${BASE_URL}${file}?v=${Date.now()}`;
    console.log(`Testing ${file} -> ${targetUrl}`);

    try {
      const resp = await page.goto(targetUrl, { waitUntil: 'networkidle', timeout: 30000 });
      if (!resp || resp.status() !== 200) {
        throw new Error(`Página principal respondió con HTTP ${resp ? resp.status() : 'sin respuesta'}`);
      }

      const evaluation = await page.evaluate(() => {
        const bg = window.getComputedStyle(document.body).backgroundImage;
        const canvas = document.querySelector('.page-network-canvas, canvas');
        const jsLoaded = (typeof window.__nexoSnapshot !== 'undefined') || (typeof window.switchMonth !== 'undefined');
        const cardsCount = document.querySelectorAll('article.card, article').length;
        const title = document.title;
        const logo = document.querySelector('.logo svg');
        const logoHeight = logo ? logo.getBoundingClientRect().height : 0;
        return {
          bg,
          hasCanvas: !!canvas,
          jsLoaded,
          cardsCount,
          title,
          logoHeight
        };
      });

      // Validaciones
      const erroresTablero = [];

      if (resourceErrors.length > 0) {
        erroresTablero.push(`Recursos con error: ${resourceErrors.join(', ')}`);
      }
      if (pageErrors.length > 0) {
        erroresTablero.push(`Errores JS (pageerror): ${pageErrors.join(', ')}`);
      }
      if (!evaluation.jsLoaded) {
        erroresTablero.push('El JavaScript del tablero (_sistema/tablero/tablero.js) no cargó');
      }
      if (evaluation.cardsCount === 0) {
        erroresTablero.push('No hay tarjetas de contenido visibles');
      }
      if (evaluation.logoHeight > 200) {
        erroresTablero.push(`El logo SVG mide ${evaluation.logoHeight}px de alto (CSS no aplicado)`);
      }
      if (blockedFirestoreWrites > 0) {
        erroresTablero.push(`Se detectaron ${blockedFirestoreWrites} intentos de escritura a Firestore`);
      }
      if (mesActualEtiqueta) {
        const normTitle = normalizarTexto(evaluation.title);
        const normMes = normalizarTexto(mesActualEtiqueta);
        const mesNombre = normMes.split(' ')[0];
        if (!normTitle.includes(mesNombre)) {
          erroresTablero.push(`El título "${evaluation.title}" no contiene el mes actual esperado "${mesActualEtiqueta}"`);
        }
      }

      if (erroresTablero.length > 0) {
        console.error(`  ❌ FALLO en ${file}:`);
        erroresTablero.forEach(e => console.error(`     - ${e}`));
        hasErrors = true;
      } else {
        console.log(`  ✓ OK: ${evaluation.cardsCount} tarjetas, JS cargado, mes "${mesActualEtiqueta || 'OK'}", sin errores`);
      }
    } catch (err) {
      console.error(`  ❌ Error durante la prueba de ${file}: ${err.message}`);
      hasErrors = true;
    } finally {
      await page.close();
    }
  }

  await browser.close();

  if (hasErrors) {
    console.error('\n❌ La verificación de tableros publicados encontró errores.');
    process.exit(1);
  } else {
    console.log('\n✓ Todos los tableros publicados en GitHub Pages fueron verificados con éxito.');
    process.exit(0);
  }
})();
