#!/usr/bin/env node
/**
 * Suite de pruebas automáticas completas para tableros de contenido Nexo.
 * Ejecuta los 13 casos de prueba del ciclo de vida:
 * Aprobación → Correcciones → ClickUp → Producción.
 * 
 * Uso:
 *   node _sistema/pruebas/probar_todo.js
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const { execSync } = require('child_process');

// Resolver Playwright localmente
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

const { Stub, pack, unpack } = require('./fsstub');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const PLANTILLA_TABLERO = path.join(REPO_ROOT, '_sistema', 'plantilla-tablero.html');
const PLANTILLA_PROD = path.join(REPO_ROOT, '_sistema', 'plantilla-produccion.html');
const CONSTRUIR_PY = path.join(REPO_ROOT, '_sistema', 'construir.py');
const PREPARAR_CLICKUP_PY = path.join(REPO_ROOT, '_sistema', 'preparar_clickup.py');

// Colores de consola para reporte claro
const C = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
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

// Helper para abrir páginas con configuración estándar y stub
async function abrirPagina(browser, stub, url, agency = false, viewport = { width: 390, height: 844 }) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(e.message));

  if (stub) {
    await stub.attach(page);
  } else {
    // Si no hay stub, abortar cualquier petición a Firestore real
    await page.route('**/*', r => {
      const u = r.request().url();
      if (u.includes('firestore.googleapis.com')) {
        return r.abort();
      }
      return r.continue();
    });
  }

  if (agency) {
    await page.addInitScript(() => {
      sessionStorage.setItem('nexo_agency_session', JSON.stringify({
        email: 'carlosuzc29@gmail.com',
        idToken: 'fake-token-qa',
        refreshToken: 'fake-refresh-qa',
        expiresAt: Date.now() + 3600e3
      }));
    });
  }

  await page.goto(url);
  await page.waitForTimeout(1800);
  return { ctx, page, pageErrors };
}

// Helpers para interactuar con modales y toasts
async function getModalText(page) {
  return await page.evaluate(() => {
    const m = document.getElementById('modal');
    if (!m || getComputedStyle(m).display === 'none') return '';
    return (m.innerText || '').replace(/\s+/g, ' ').trim();
  });
}

async function getToastText(page) {
  return await page.evaluate(() => {
    const t = document.getElementById('toast');
    return t ? t.textContent.trim() : '';
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// EJECUCIÓN PRINCIPAL DE LA SUITE
// ─────────────────────────────────────────────────────────────────────────────
(async () => {
  console.log(`${C.bold}${C.cyan}Iniciando suite de pruebas automatizadas Nexo (13 casos)...${C.reset}\n`);

  // Carpeta temporal aislada para pruebas
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexo-qa-suite-'));
  const borradoresDir = path.join(tmpDir, 'borradores');
  fs.mkdirSync(borradoresDir, { recursive: true });

  const configPath = path.join(tmpDir, '.nexo-config.json');
  fs.writeFileSync(configPath, JSON.stringify({
    firebase: {
      apiKey: 'fake-qa-api-key',
      projectId: 'nexo-qa-inexistente'
    },
    base_url: 'https://test.nexo.ejemplo/'
  }, null, 2));

  const envTest = {
    ...process.env,
    NEXO_REPO: tmpDir,
    NEXO_CONFIG: configPath
  };

  const browser = await chromium.launch({ channel: 'chrome', headless: true });

  let caso5FirestoreDoc = null;
  let caso1HtmlFile = '';
  let caso1DraftPath = '';

  try {
    // ─────────────────────────────────────────────────────────────────────────
    // CASO 1: Mes nuevo
    // ─────────────────────────────────────────────────────────────────────────
    console.log(`${C.bold}1. Mes nuevo:${C.reset} reutilización de enlace, id nuevo, todo pendiente, 8 tarjetas y pre-render`);
    {
      // Archivo del mes anterior para verificar reutilización de enlace
      const octPath = path.join(borradoresDir, 'qa-moffyns-octubre-2026.json');
      fs.writeFileSync(octPath, JSON.stringify({
        cliente: 'QA Moffyns',
        mes: 'Octubre',
        anio: 2026,
        archivo: 'qa-moffyns-f1a2b3.html',
        contenidos: [{ id: 'c1', titulo: 'Pieza vieja' }]
      }, null, 2));

      // Borrador de noviembre sin 'archivo'
      caso1DraftPath = path.join(borradoresDir, 'qa-moffyns-noviembre-2026.json');
      const draftNov = {
        cliente: 'QA Moffyns',
        cuenta: 'moffyns_cafe',
        mes: 'Noviembre',
        anio: 2026,
        intro: 'Parrilla de contenidos Noviembre 2026.',
        contenidos: [
          {
            id: 'c1',
            formato: 'Reel',
            tipoOriginal: 'Reel',
            clickupId: 'clickup-101',
            pilar: 'Producto',
            fechaPublicacion: '05/11',
            titulo: 'Reel 1: Nuevas pizzas',
            guion: 'Escena 1: Mostramos la pizza saliendo del horno.\nEscena 2: Primer plano del queso.',
            copy: '¡Nuestras pizzas más pedidas ahora con masa madre!\n\nDisponibles todos los días en nuestra sede.',
            hashtags: '#moffyns #pizzas #masamadre',
            referencias: [{ label: 'Referencia visual', url: 'https://instagram.com/reel/123' }]
          },
          {
            id: 'c2',
            formato: 'Carrusel',
            tipoOriginal: 'Carrusel',
            pilar: 'Educativo',
            titulo: 'Carrusel 2: 3 secretos del café',
            guion: 'Slide 1: ¿Sabías esto del café?\nSlide 2: Temperatura ideal.\nSlide 3: Molienda fresca.',
            copy: 'El café perfecto tiene ciencia. Desliza para conocer los secretos.',
            hashtags: '#moffyns #cafe'
          },
          {
            id: 'c3',
            formato: 'Video',
            tipoOriginal: 'Video',
            pilar: 'Comunidad',
            titulo: 'Video 3: Un día con nuestro barista',
            guion: 'Inicio del video: bienvenida del barista.\nPreparación del espresso.\nCierre con sonrisa.',
            copy: 'Detrás de cada taza hay pasión y técnica.'
          },
          {
            id: 'c4',
            formato: 'Post',
            pilar: 'Promoción',
            titulo: 'Post 4: Promo de los jueves',
            guion: 'Gráfica fija con 2x1 en postres.',
            copy: 'Los jueves son dulces en Moffyns. Pide tu 2x1.'
          },
          {
            id: 'c5',
            formato: 'Reel',
            pilar: 'Entretenimiento',
            titulo: 'Reel 5: Expectativa vs realidad',
            guion: 'Gancho inicial: Cuando dices solo un café.\nRealidad: mesa llena de postres.',
            copy: 'Todos tenemos ese amigo que solo iba por un café.'
          },
          {
            id: 'c6',
            formato: 'Story',
            pilar: 'Interacción',
            titulo: 'Story 6: Encuesta del día',
            guion: 'Sticker de encuesta: ¿Capuccino o Latte?',
            copy: 'Vota en nuestras historias.'
          },
          {
            id: 'c7',
            formato: 'Video',
            pilar: 'Branding',
            titulo: 'Video 7: Nuestra historia',
            guion: 'Voz en off: Cómo nació Moffyns.\nTomas de archivo.',
            copy: 'Desde 2020 creando momentos inolvidables.'
          },
          {
            id: 'c8',
            formato: 'Carrusel con video',
            pilar: 'Menú',
            titulo: 'Carrusel 8: Nuevos sabores de temporada',
            guion: 'Portada carrusel.\nSlide 2: Video latte calabaza.\nSlide 3: Pie de manzana.',
            copy: 'Llegó el otoño con sabores especiales.'
          }
        ]
      };
      fs.writeFileSync(caso1DraftPath, JSON.stringify(draftNov, null, 2));

      // Ejecutar construir.py
      execSync(`python3 "${CONSTRUIR_PY}" "${caso1DraftPath}"`, { env: envTest, stdio: 'pipe' });

      const updatedDraft = JSON.parse(fs.readFileSync(caso1DraftPath, 'utf8'));
      if (updatedDraft.archivo !== 'qa-moffyns-f1a2b3.html') {
        fail(`No reutilizó el enlace: esperado 'qa-moffyns-f1a2b3.html', obtenido '${updatedDraft.archivo}'`);
      }
      if (!updatedDraft.id.startsWith('qa-moffyns-2026-noviembre-')) {
        fail(`ID no empieza con mes nuevo: '${updatedDraft.id}'`);
      }
      const pendientes = updatedDraft.contenidos.filter(c => c.estado === 'pendiente');
      if (pendientes.length !== 8) {
        fail(`Se esperaban 8 piezas pendientes, hay ${pendientes.length}`);
      }

      caso1HtmlFile = path.join(tmpDir, 'qa-moffyns-f1a2b3.html');
      if (!fs.existsSync(caso1HtmlFile)) {
        fail(`No se generó el HTML pre-renderizado en '${caso1HtmlFile}'`);
      }

      const htmlContent = fs.readFileSync(caso1HtmlFile, 'utf8');
      const cardCountInHtml = (htmlContent.match(/<article class="card/g) || []).length;
      if (cardCountInHtml !== 8) {
        fail(`El HTML pre-renderizado debe contener 8 <article class="card", contiene ${cardCountInHtml}`);
      }

      pass('Enlace reutilizado, id nuevo generado, 8 contenidos pendientes y pre-render validado');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // CASO 2: JSON copiado del mes anterior
    // ─────────────────────────────────────────────────────────────────────────
    console.log(`\n${C.bold}2. JSON copiado del mes anterior:${C.reset} limpieza de clickupId, sincronización y metadatos viejos`);
    {
      const dicPath = path.join(borradoresDir, 'qa-copiado-diciembre-2026.json');
      const draftDic = {
        id: 'qa-copiado-2026-octubre-oldtoken',
        cliente: 'QA Copiado',
        mes: 'Diciembre',
        anio: 2026,
        sincronizadoClickup: '2026-10-15T10:00:00Z',
        huellasClickup: { c1: 'abc', c2: 'def' },
        tableroProduccion: { id: 'prod-old', url: 'https://...' },
        resetAt: 1697364000000,
        contenidos: [
          {
            id: 'c1',
            titulo: 'Reel copiado',
            tipoOriginal: 'Reel',
            clickupId: 'clickup-old-task-1',
            version: 2,
            aprobacion: { usuario: 'Cliente', fecha: '2026-10-10' },
            versiones: { v1: { guion: 'viejo' } },
            historial: [{ version: 1, accion: 'ajuste' }],
            fechaCorreccion: '2026-10-09',
            estado_aprobacion: 'aprobado'
          },
          {
            id: 'c2',
            titulo: 'Post copiado',
            clickupId: 'clickup-old-task-2',
            version: 3
          }
        ]
      };
      fs.writeFileSync(dicPath, JSON.stringify(draftDic, null, 2));

      execSync(`python3 "${CONSTRUIR_PY}" "${dicPath}"`, { env: envTest, stdio: 'pipe' });

      const cleanedDraft = JSON.parse(fs.readFileSync(dicPath, 'utf8'));
      if (cleanedDraft.sincronizadoClickup || cleanedDraft.huellasClickup || cleanedDraft.tableroProduccion || cleanedDraft.resetAt === 1697364000000) {
        fail('El JSON conserva sincronizadoClickup, huellasClickup, tableroProduccion o resetAt antiguo');
      }

      for (const c of cleanedDraft.contenidos) {
        if (c.clickupId || c.version || c.aprobacion || c.versiones || c.historial || c.fechaCorreccion || c.estado_aprobacion) {
          fail(`Contenido ${c.id} conserva campos internos anteriores`);
        }
      }

      const dicHtmlPath = path.join(tmpDir, cleanedDraft.archivo);
      const dicHtml = fs.readFileSync(dicHtmlPath, 'utf8');

      const matchData = dicHtml.match(/<script id="board-data"[^>]*>([\s\S]*?)<\/script>/);
      if (!matchData) {
        fail('No se encontró el bloque <script id="board-data"> en el HTML público');
      }
      const embeddedData = JSON.parse(matchData[1]);
      if (embeddedData.clickupId || embeddedData.tipoOriginal || embeddedData.sincronizadoClickup || embeddedData.huellasClickup || embeddedData.tableroProduccion) {
        fail('El objeto raíz de board-data en el HTML público contiene claves internas');
      }
      for (const c of embeddedData.contenidos || []) {
        if (c.clickupId || c.tipoOriginal) {
          fail(`El contenido ${c.id} en board-data contiene clickupId o tipoOriginal`);
        }
      }
      if (matchData[1].includes('clickup-old-task-1')) {
        fail('El JSON incrustado contiene el ID de ClickUp anterior');
      }

      pass('Campos de sincronización y clickupId eliminados del JSON y ausentes del HTML público');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // CASO 3: Validación: enviar sin evaluar
    // ─────────────────────────────────────────────────────────────────────────
    console.log(`\n${C.bold}3. Validación:${C.reset} modal 'Paso obligatorio' con 8 piezas sin evaluar y sin PATCH`);
    {
      const st = new Stub(null);
      const { ctx, page, pageErrors } = await abrirPagina(browser, st, 'file://' + caso1HtmlFile);

      await page.fill('#who', 'Cliente QA');
      await page.click('#dl');
      await page.waitForTimeout(1000);

      const modalText = await getModalText(page);
      if (!modalText.includes('Paso obligatorio') || !modalText.includes('8')) {
        fail(`Modal no mostró 'Paso obligatorio' con 8 pendientes. Texto: '${modalText}'`);
      }

      const patches = st.log.filter(x => x.body);
      if (patches.length > 0) {
        fail(`Se enviaron ${patches.length} peticiones PATCH sin haber evaluado`);
      }

      // Cerrar modal antes de interactuar con la tarjeta
      await page.evaluate(() => {
        const m = document.getElementById('modal');
        if (m) m.classList.remove('show');
      });
      await page.waitForTimeout(400);

      // Evaluar 1 pieza (aprobar la primera)
      await page.locator('article.card').first().locator('button.approve').click();
      await page.click('#dl');
      await page.waitForTimeout(1000);

      const modalText2 = await getModalText(page);
      if (!modalText2.includes('Paso obligatorio') || !modalText2.includes('7')) {
        fail(`Modal tras evaluar 1 pieza no mostró 7 pendientes. Texto: '${modalText2}'`);
      }

      await ctx.close();
      pass('Validación bloquea el envío con 8 y 7 piezas sin evaluar, sin realizar escrituras');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // CASO 4: Pedir cambios sin comentario
    // ─────────────────────────────────────────────────────────────────────────
    console.log(`\n${C.bold}4. Pedir cambios sin comentario:${C.reset} no se marca sin comentario; se marca con comentario`);
    {
      const st = new Stub(null);
      const { ctx, page } = await abrirPagina(browser, st, 'file://' + caso1HtmlFile);

      const card2 = page.locator('article.card').nth(1);
      await card2.locator('button.change').click();
      await page.waitForTimeout(500);

      const isChangedWithoutComment = await card2.evaluate(el => el.classList.contains('state-change') || el.dataset.state === 'cambios');
      if (isChangedWithoutComment) {
        fail('La tarjeta se marcó como cambios sin haber ingresado comentario');
      }

      // Llenar comentario
      await card2.locator('textarea').first().fill('Ajustar el orden de los slides, por favor');
      await card2.locator('button.change').click();
      await page.waitForTimeout(500);

      const isChangedWithComment = await card2.evaluate(el => el.classList.contains('state-change') || el.dataset.state === 'cambios');
      if (!isChangedWithComment) {
        fail('La tarjeta no se marcó como cambios tras ingresar comentario');
      }

      await ctx.close();
      pass('Requisito de comentario obligatorio validado correctamente');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // CASO 5: Flujo completo (e2e)
    // ─────────────────────────────────────────────────────────────────────────
    console.log(`\n${C.bold}5. Flujo completo (e2e):${C.reset} aprobación de 6 y cambios en 2 → corrección agencia → review corregidos → aprobación final`);
    {
      const st = new Stub(null);

      // Paso A: Cliente aprueba 6 y pide cambios en 2 (#3 y #5)
      let { ctx, page } = await abrirPagina(browser, st, 'file://' + caso1HtmlFile);
      const cards = page.locator('article.card');

      for (let i = 0; i < 8; i++) {
        const c = cards.nth(i);
        if (i === 2 || i === 4) {
          const com = i === 2 ? 'Cambiar el gancho inicial del video' : 'Cambiar el llamado a la acción al final';
          await c.locator('textarea').first().fill(com);
          await c.locator('button.change').click();
        } else {
          await c.locator('button.approve').click();
        }
      }

      await page.fill('#who', 'María');
      await page.click('#dl');
      await page.waitForTimeout(2000);

      if (st.fields.aprobados !== 6 || st.fields.cambios !== 2 || st.fields.estado !== 'Con cambios') {
        fail(`Estado Firestore cliente incorrecto: ok=${st.fields.aprobados}, cambios=${st.fields.cambios}, estado='${st.fields.estado}'`);
      }
      await ctx.close();

      // Paso B: Agencia corrige #3 y #5 con saltos de línea (Enter)
      ({ ctx, page } = await abrirPagina(browser, st, 'file://' + caso1HtmlFile, true));

      for (const i of [2, 4]) {
        const c = page.locator('article.card').nth(i);
        const g = c.locator('.guion p').first();
        await g.click();
        await page.keyboard.press('Meta+A');
        await page.keyboard.press('Control+A');
        await page.keyboard.type(i === 2 ? 'Nuevo gancho v2 para video' : 'Nuevo llamado a la acción v2');
        await page.keyboard.press('Enter');
        await page.keyboard.type('Segunda línea corregida por agencia.');
        await c.locator('.btn-agency-save').click();
        await page.waitForTimeout(1500);
      }

      const c3 = st.fields.contenidos[2];
      const c5 = st.fields.contenidos[4];
      if (c3.version !== 2 || !c3.guion.includes('\n') || c3.estado !== 'corregido') {
        fail(`Corrección c3 inválida: v=${c3.version}, estado=${c3.estado}, guion='${c3.guion}'`);
      }
      await ctx.close();

      // Paso C: Cliente abre enlace con ?review=corregidos&piezas=3,5
      const urlCorregidos = `file://${caso1HtmlFile}?review=corregidos&piezas=3,5`;
      ({ ctx, page } = await abrirPagina(browser, st, urlCorregidos, false));

      const visibles = await page.evaluate(() => {
        return [...document.querySelectorAll('article.card')]
          .filter(c => c.offsetParent !== null)
          .map(c => c.dataset.pieceNum || c.id);
      });

      if (visibles.length !== 2 || !visibles.includes('3') || !visibles.includes('5')) {
        fail(`Enlace corregidos no mostró únicamente piezas 3 y 5: visibles = [${visibles.join(',')}]`);
      }

      const textoC3 = await page.locator('article.card').nth(2).locator('.guion p').first().textContent();
      if (!textoC3.includes('Nuevo gancho v2') || !textoC3.includes('Segunda línea corregida')) {
        fail(`El cliente no vio el texto corregido en pieza 3: '${textoC3}'`);
      }

      // Cliente aprueba las 2 piezas corregidas
      for (const i of [2, 4]) {
        await page.locator('article.card').nth(i).locator('button.approve').click();
      }

      await page.fill('#who', 'María');
      await page.click('#dl');
      await page.waitForTimeout(2000);

      if (st.fields.estado !== 'Aprobado' || st.fields.aprobados !== 8 || st.fields.cambios !== 0) {
        fail(`Estado final no fue Aprobado: ok=${st.fields.aprobados}, cambios=${st.fields.cambios}, estado='${st.fields.estado}'`);
      }

      const c3Final = st.fields.contenidos[2];
      if (!c3Final.aprobacion || !c3Final.aprobacion.guion || !c3Final.aprobacion.guion.includes('Nuevo gancho v2')) {
        fail(`Instantánea aprobacion c3 no capturó el guion corregido: ${JSON.stringify(c3Final.aprobacion)}`);
      }

      caso5FirestoreDoc = st.doc();
      await ctx.close();
      pass('Flujo completo exitoso: 8 aprobados, versiones en v2 e instantánea de aprobación con texto corregido');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // CASO 6: Hashtags
    // ─────────────────────────────────────────────────────────────────────────
    console.log(`\n${C.bold}6. Hashtags:${C.reset} corregir guion no contamina copy y preserva hashtags en pantalla`);
    {
      const st = new Stub(caso5FirestoreDoc ? {
        ...caso5FirestoreDoc.fields,
        contenidos: caso5FirestoreDoc.fields.contenidos ? unpack(caso5FirestoreDoc.fields.contenidos) : []
      } : null);

      const origCopy = '¡Nuestras pizzas más pedidas ahora con masa madre!\n\nDisponibles todos los días en nuestra sede.';
      const origHashtags = '#moffyns #pizzas #masamadre';

      const { ctx, page } = await abrirPagina(browser, st, 'file://' + caso1HtmlFile, true);

      // Editar solo el guion en la tarjeta 1
      const card1 = page.locator('article.card').first();
      const g = card1.locator('.guion p').first();
      await g.click();
      await page.keyboard.press('Meta+A');
      await page.keyboard.press('Control+A');
      await page.keyboard.type('Nuevo guion reel 1 editado por agencia.');
      await card1.locator('.btn-agency-save').click();
      await page.waitForTimeout(1800);

      const c1 = st.fields.contenidos[0];
      if (c1.copy.trim() !== origCopy.trim()) {
        fail(`El copy fue modificado o contaminado: esperado '${origCopy}', obtenido '${c1.copy}'`);
      }
      if (c1.copy.includes('#moffyns')) {
        fail(`Los hashtags se pegaron dentro del campo copy: '${c1.copy}'`);
      }
      if (c1.hashtags !== origHashtags) {
        fail(`Hashtags alterados: esperado '${origHashtags}', obtenido '${c1.hashtags}'`);
      }

      // Verificar que los hashtags sigan visibles en pantalla
      const hashVisible = await card1.locator('.hash').first().textContent();
      if (!hashVisible.includes('#moffyns')) {
        fail(`El elemento .hash en pantalla no muestra los hashtags: '${hashVisible}'`);
      }

      await ctx.close();
      pass('Copy y hashtags aislados: copy intacto y hashtags visibles tras sincronización');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // CASO 7: Aprobar con edición sin guardar
    // ─────────────────────────────────────────────────────────────────────────
    console.log(`\n${C.bold}7. Aprobar con edición sin guardar:${C.reset} modal de advertencia y aprobación del texto nuevo`);
    {
      const st = new Stub(caso5FirestoreDoc ? {
        ...caso5FirestoreDoc.fields,
        contenidos: caso5FirestoreDoc.fields.contenidos ? unpack(caso5FirestoreDoc.fields.contenidos) : []
      } : null);

      const { ctx, page } = await abrirPagina(browser, st, 'file://' + caso1HtmlFile, true);

      const card2 = page.locator('article.card').nth(1);
      const g2 = card2.locator('.guion p').first();
      await g2.click();
      await page.keyboard.press('End');
      await page.keyboard.type(' TEXTO EDITADO PENDIENTE DE GUARDAR');

      // Intentar aprobar sin guardar
      await card2.locator('.btn-agency-approve').click();
      await page.waitForTimeout(1000);

      const modalText = await getModalText(page);
      if (!modalText.includes('Tienes cambios sin guardar') || !modalText.includes('Guardar la corrección y aprobar')) {
        fail(`No se mostró el modal de confirmación. Texto: '${modalText}'`);
      }

      // Confirmar 'Guardar y aprobar'
      await page.locator('#modal button:has-text("Guardar y aprobar")').click();
      await page.waitForTimeout(2000);

      const c2 = st.fields.contenidos[1];
      if (c2.estado !== 'aprobado' || !c2.guion.includes('TEXTO EDITADO PENDIENTE DE GUARDAR')) {
        fail(`No se guardó ni aprobó el nuevo texto en Firestore: estado=${c2.estado}, guion='${c2.guion}'`);
      }
      if (!c2.aprobacion || !c2.aprobacion.guion || !c2.aprobacion.guion.includes('TEXTO EDITADO PENDIENTE DE GUARDAR')) {
        fail(`La instantánea aprobacion no tiene el texto nuevo: ${JSON.stringify(c2.aprobacion)}`);
      }

      await ctx.close();
      pass('Modal advirtió de cambios pendientes y guardó y aprobó el texto nuevo exitosamente');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // CASO 8: Guardar sin cambios
    // ─────────────────────────────────────────────────────────────────────────
    console.log(`\n${C.bold}8. Guardar sin cambios:${C.reset} no escribe a Firestore ni agrega historial`);
    {
      const st = new Stub(caso5FirestoreDoc ? {
        ...caso5FirestoreDoc.fields,
        contenidos: caso5FirestoreDoc.fields.contenidos ? unpack(caso5FirestoreDoc.fields.contenidos) : []
      } : null);

      const { ctx, page } = await abrirPagina(browser, st, 'file://' + caso1HtmlFile, true);

      const patchCountBefore = st.log.filter(x => x.body).length;
      const histLengthBefore = (st.fields.contenidos[1].historial || []).length;

      // Click en guardar sin haber editado nada
      await page.locator('article.card').nth(1).locator('.btn-agency-save').click();
      await page.waitForTimeout(1000);

      const toast = await getToastText(page);
      if (!toast.includes('Sin cambios para guardar')) {
        fail(`Toast no mostró 'Sin cambios para guardar'. Obtenido: '${toast}'`);
      }

      const patchCountAfter = st.log.filter(x => x.body).length;
      if (patchCountAfter !== patchCountBefore) {
        fail('Se envió un PATCH a Firestore a pesar de no haber cambios');
      }

      const histLengthAfter = (st.fields.contenidos[1].historial || []).length;
      if (histLengthAfter !== histLengthBefore) {
        fail('Se agregó una entrada al historial sin cambios');
      }

      await ctx.close();
      pass('Guardar sin cambios detectado: no escribió en Firestore ni ensució el historial');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // CASO 9: Concurrencia, sin señal y error 500
    // ─────────────────────────────────────────────────────────────────────────
    console.log(`\n${C.bold}9. Concurrencia, sin señal y error 500:${C.reset} protección de datos y sin confirmaciones falsas`);
    {
      // 9A: Concurrencia
      {
        const st = new Stub(caso5FirestoreDoc ? {
          ...caso5FirestoreDoc.fields,
          contenidos: caso5FirestoreDoc.fields.contenidos ? unpack(caso5FirestoreDoc.fields.contenidos) : []
        } : null);

        const { ctx, page } = await abrirPagina(browser, st, 'file://' + caso1HtmlFile, false);

        // Agencia actualiza pieza 2 en Firestore mientras el cliente tiene la página abierta
        st.fields.contenidos[1].guion = 'GUION ACTUALIZADO POR AGENCIA REMOTAMENTE';
        st.bump();

        // Cliente intenta enviar aprobación
        await page.fill('#who', 'Cliente Concurrente');
        await page.click('#dl');
        await page.waitForTimeout(1500);

        // Precondition falló: Firestore conserva el texto de la agencia
        if (st.fields.contenidos[1].guion !== 'GUION ACTUALIZADO POR AGENCIA REMOTAMENTE') {
          fail('El cliente sobreescribió el texto de la agencia en colisión de concurrencia');
        }

        await ctx.close();
      }

      // 9B: Sin señal
      {
        const st = new Stub(caso5FirestoreDoc ? {
          ...caso5FirestoreDoc.fields,
          contenidos: caso5FirestoreDoc.fields.contenidos ? unpack(caso5FirestoreDoc.fields.contenidos) : []
        } : null);

        const { ctx, page } = await abrirPagina(browser, st, 'file://' + caso1HtmlFile, false);
        st.failGet = 99; // Simular caída de red

        await page.fill('#who', 'Cliente Desconectado');
        await page.click('#dl');
        await page.waitForTimeout(1500);

        const modal = await getModalText(page);
        if (!modal.toLowerCase().includes('conexión') && !modal.toLowerCase().includes('internet')) {
          fail(`No se mostró mensaje de error de conexión. Obtenido: '${modal}'`);
        }
        if (modal.includes('✓') || modal.includes('¡Revisión enviada!')) {
          fail('Se mostró confirmación de éxito falsa sin conexión a internet');
        }

        await ctx.close();
      }

      // 9C: Error 500 al guardar en agencia
      {
        const st = new Stub(caso5FirestoreDoc ? {
          ...caso5FirestoreDoc.fields,
          contenidos: caso5FirestoreDoc.fields.contenidos ? unpack(caso5FirestoreDoc.fields.contenidos) : []
        } : null);

        const { ctx, page } = await abrirPagina(browser, st, 'file://' + caso1HtmlFile, true);
        st.failPatch = 5; // Simular error de servidor

        const card = page.locator('article.card').first();
        const g = card.locator('.guion p').first();
        await g.click();
        await page.keyboard.type(' Cambio fallido');
        await card.locator('.btn-agency-save').click();
        await page.waitForTimeout(2000);

        const toast = await getToastText(page);
        const modal = await getModalText(page);
        if (toast.includes('✓') || toast.includes('Guardado')) {
          fail('Se mostró toast de éxito falso ante error 500 del servidor');
        }
        if (!modal.toLowerCase().includes('no pudimos') && !modal.toLowerCase().includes('error')) {
          fail(`No se mostró modal de error honesto ante fallo 500. Modal: '${modal}'`);
        }

        await ctx.close();
      }

      pass('Concurrencia con updateTime protegida, error de señal honesto y sin falsos positivos en 500');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // CASO 10: Documento inexistente al enviar (404)
    // ─────────────────────────────────────────────────────────────────────────
    console.log(`\n${C.bold}10. Documento inexistente al enviar (404):${C.reset} autorregistro automático y guardado de revisión`);
    {
      const st = new Stub(null); // Documento no existe inicialmente
      const { ctx, page } = await abrirPagina(browser, st, 'file://' + caso1HtmlFile, false);

      // Aprobar todas las tarjetas
      const approves = page.locator('button.approve');
      for (let i = 0; i < await approves.count(); i++) {
        await approves.nth(i).click();
      }

      await page.fill('#who', 'Cliente Nuevo');
      await page.click('#dl');
      await page.waitForTimeout(2500);

      const modal = await getModalText(page);
      if (!modal.includes('¡Revisión enviada!') && !modal.includes('aprobados')) {
        fail(`La revisión no se guardó ante 404. Modal: '${modal}'`);
      }

      if (!st.fields || st.fields.aprobados !== 8) {
        fail(`Firestore no tiene el registro completado: ${JSON.stringify(st.fields)}`);
      }

      await ctx.close();
      pass('El cliente ante 404 ejecutó el autorregistro y completó la revisión exitosamente');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // CASO 11: preparar_clickup.py
    // ─────────────────────────────────────────────────────────────────────────
    console.log(`\n${C.bold}11. preparar_clickup.py:${C.reset} fuente aprobacion, fecha legible, accionClickup y bloqueo de tablero ajeno`);
    {
      // Guardar el documento del Caso 5 en un JSON temporal para simular lectura de Firestore
      const fsNovDocPath = path.join(tmpDir, 'fs-nov-doc.json');
      fs.writeFileSync(fsNovDocPath, JSON.stringify(caso5FirestoreDoc, null, 2));

      // 11A: Tablero correspondiente
      execSync(`python3 "${PREPARAR_CLICKUP_PY}" "${caso1DraftPath}" "${fsNovDocPath}"`, { env: envTest, stdio: 'pipe' });
      const clickupJsonPath = caso1DraftPath.replace('.json', '.clickup.json');
      const prepOk = JSON.parse(fs.readFileSync(clickupJsonPath, 'utf8'));

      if (!prepOk.listo) {
        fail(`preparar_clickup respondió listo: false: ${JSON.stringify(prepOk.bloqueantes)}`);
      }

      const c3Clickup = prepOk.contenidos.find(c => c.id === 'c3');
      if (!c3Clickup || c3Clickup.fuenteTexto !== 'aprobacion') {
        fail(`Pieza 3 corregida no tiene fuente 'aprobacion': ${JSON.stringify(c3Clickup)}`);
      }
      if (!c3Clickup.guion || !c3Clickup.guion.includes('Nuevo gancho v2')) {
        fail(`Pieza 3 no tomó el guion aprobado: '${c3Clickup.guion}'`);
      }

      const descHeader = c3Clickup.descripcionClickup || '';
      if (!descHeader.includes('28/10/2026')) {
        fail(`La descripción no contiene fecha legible DD/MM/YYYY: '${descHeader.slice(0, 100)}'`);
      }

      if (!c3Clickup.accionClickup || (c3Clickup.accionClickup !== 'crear' && c3Clickup.accionClickup !== 'actualizar')) {
        fail(`Campo accionClickup ausente o inválido: '${c3Clickup.accionClickup}'`);
      }

      // 11B: Tablero ajeno
      const fsAjenoDoc = JSON.parse(JSON.stringify(caso5FirestoreDoc));
      fsAjenoDoc.fields.id = { stringValue: 'tablero-otro-cliente-2026-octubre-9999' };
      const fsAjenoPath = path.join(tmpDir, 'fs-ajeno-doc.json');
      fs.writeFileSync(fsAjenoPath, JSON.stringify(fsAjenoDoc, null, 2));

      execSync(`python3 "${PREPARAR_CLICKUP_PY}" "${caso1DraftPath}" "${fsAjenoPath}"`, { env: envTest, stdio: 'pipe' });
      const prepAjeno = JSON.parse(fs.readFileSync(clickupJsonPath, 'utf8'));

      if (prepAjeno.listo !== false) {
        fail('preparar_clickup no bloqueó un documento con ID de otro tablero');
      }
      const hasIdError = prepAjeno.bloqueantes.some(b => typeof b === 'string' && b.includes('no corresponde a este tablero'));
      if (!hasIdError) {
        fail(`No se encontró el error de tablero ajeno en bloqueantes: ${JSON.stringify(prepAjeno.bloqueantes)}`);
      }

      pass('preparar_clickup validó correspondencia de id, texto de aprobacion, fecha legible y accionClickup');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // CASO 12: Producción
    // ─────────────────────────────────────────────────────────────────────────
    console.log(`\n${C.bold}12. Producción:${C.reset} sincronización atómica por tarjeta, soporte offline, estado y subida de faltantes`);
    {
      // Mock server HTTP en memoria para simular Firestore en producción
      let prodDoc = {
        id: 'prod-test-qa',
        tarjetas: {
          c1: { id: 'c1', titulo: 'Tarjeta 1', estado: 'todo' },
          c2: { id: 'c2', titulo: 'Tarjeta 2', estado: 'todo' },
          c3: { id: 'c3', titulo: 'Tarjeta 3', estado: 'todo' },
          c4: { id: 'c4', titulo: 'Tarjeta 4', estado: 'todo' }
        },
        orden: ['c1', 'c2', 'c3', 'c4'],
        eliminadas: [],
        actualizado: new Date().toISOString()
      };

      const clients = new Set();

      function notifyClients(metadata = { fromCache: false, hasPendingWrites: false }) {
        const payload = JSON.stringify({ doc: prodDoc, metadata });
        for (const res of clients) {
          res.write(`data: ${payload}\n\n`);
        }
      }

      const server = http.createServer((req, res) => {
        const url = new URL(req.url, `http://${req.headers.host}`);
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

        if (req.method === 'OPTIONS') {
          res.writeHead(204);
          return res.end();
        }

        if (url.pathname === '/prod-events') {
          res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive'
          });
          clients.add(res);
          res.write(`data: ${JSON.stringify({ doc: prodDoc, metadata: { fromCache: false, hasPendingWrites: false } })}\n\n`);
          req.on('close', () => clients.delete(res));
          return;
        }

        if (url.pathname === '/prod-update' && req.method === 'POST') {
          let body = '';
          req.on('data', chunk => body += chunk);
          req.on('end', () => {
            const updates = JSON.parse(body);
            for (const [k, v] of Object.entries(updates)) {
              if (k.startsWith('tarjetas.')) {
                const cardId = k.split('.')[1];
                if (v && v._op === 'delete') {
                  delete prodDoc.tarjetas[cardId];
                } else if (v) {
                  prodDoc.tarjetas[cardId] = { ...(prodDoc.tarjetas[cardId] || {}), ...v };
                }
              } else if (k === 'orden') {
                prodDoc.orden = v;
              } else if (k === 'eliminadas' && v && v._op === 'arrayUnion') {
                if (!prodDoc.eliminadas.includes(v.value)) prodDoc.eliminadas.push(v.value);
              }
            }
            prodDoc.actualizado = new Date().toISOString();
            notifyClients();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true }));
          });
          return;
        }

        res.writeHead(404);
        res.end();
      });

      await new Promise(r => server.listen(0, '127.0.0.1', r));
      const srvPort = server.address().port;

      // Generar HTML de producción de prueba
      const prodHtmlPath = path.join(tmpDir, 'qa-produccion.html');
      let plantillaProdHtml = fs.readFileSync(PLANTILLA_PROD, 'utf8');
      const prodData = {
        fecha: "2026-11-01",
        cliente: "QA Produccion",
        id: "prod-test-qa",
        firebase: { apiKey: "fake-prod-key", projectId: "nexo-qa-inexistente" },
        contenidos: [
          { id: 'c1', titulo: 'Tarjeta 1', tipo: 'reel', estado: 'todo', subtareas: [], mediaLinks: [] },
          { id: 'c2', titulo: 'Tarjeta 2', tipo: 'reel', estado: 'todo', subtareas: [], mediaLinks: [] },
          { id: 'c3', titulo: 'Tarjeta 3', tipo: 'reel', estado: 'todo', subtareas: [], mediaLinks: [] },
          { id: 'c4', titulo: 'Tarjeta 4', tipo: 'reel', estado: 'todo', subtareas: [], mediaLinks: [] }
        ]
      };
      plantillaProdHtml = plantillaProdHtml.replace(/const DATA = \{[\s\S]*?\};/, `const DATA = ${JSON.stringify(prodData, null, 2)};`);
      fs.writeFileSync(prodHtmlPath, plantillaProdHtml);

      // Script inyectado para simular Firebase Firestore conectándose al mock server
      async function setupMockFirebase(page) {
        await page.route('**/*', r => {
          const u = r.request().url();
          if (u.includes('firebasejs')) {
            return r.fulfill({ status: 200, contentType: 'application/javascript', body: '// Firebase mock' });
          }
          if (u.includes('firestore.googleapis.com')) return r.abort();
          return r.continue();
        });

        await page.addInitScript((port) => {
          window.__mockPort = port;
          window.__isOffline = false;
          window.__pendingQueue = [];

          const listeners = [];
          const es = new EventSource(`http://127.0.0.1:${port}/prod-events`);
          es.onmessage = (e) => {
            const data = JSON.parse(e.data);
            window.__lastDoc = data.doc;
            const metadata = window.__isOffline
              ? { fromCache: true, hasPendingWrites: window.__pendingQueue.length > 0 }
              : data.metadata;
            listeners.forEach(cb => cb({
              data: () => data.doc,
              metadata,
              exists: true
            }));
          };

          window.__setOffline = function(offline) {
            window.__isOffline = offline;
            const metadata = offline
              ? { fromCache: true, hasPendingWrites: window.__pendingQueue.length > 0 }
              : { fromCache: false, hasPendingWrites: false };
            listeners.forEach(cb => cb({
              data: () => window.__lastDoc || {},
              metadata,
              exists: true
            }));

            if (!offline && window.__pendingQueue.length > 0) {
              const queue = [...window.__pendingQueue];
              window.__pendingQueue = [];
              queue.forEach(item => {
                fetch(`http://127.0.0.1:${port}/prod-update`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(item)
                });
              });
            }
          };

          window.firebase = {
            apps: [{ name: '[DEFAULT]' }],
            initializeApp: () => window.firebase,
            firestore: function() {
              return {
                settings: () => {},
                enablePersistence: async () => {},
                collection: () => ({
                  doc: () => ({
                    onSnapshot: (opts, cb) => {
                      const callback = typeof opts === 'function' ? opts : cb;
                      listeners.push(callback);
                      if (window.__lastDoc) {
                        setTimeout(() => {
                          const metadata = window.__isOffline
                            ? { fromCache: true, hasPendingWrites: window.__pendingQueue.length > 0 }
                            : { fromCache: false, hasPendingWrites: false };
                          callback({
                            data: () => window.__lastDoc,
                            metadata,
                            exists: true
                          });
                        }, 10);
                      }
                      return () => {
                        const idx = listeners.indexOf(callback);
                        if (idx >= 0) listeners.splice(idx, 1);
                      };
                    },
                    update: async (fields) => {
                      if (window.__isOffline) {
                        window.__pendingQueue.push(fields);
                        return;
                      }
                      await fetch(`http://127.0.0.1:${port}/prod-update`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(fields)
                      });
                    }
                  })
                }),
                runTransaction: async (fn) => {
                  return fn({
                    get: async () => ({
                      data: () => window.__lastDoc || {},
                      exists: true
                    }),
                    update: async (ref, fields) => {}
                  });
                }
              };
            }
          };
          window.firebase.firestore.FieldValue = {
            arrayUnion: (v) => ({ _op: 'arrayUnion', value: v }),
            delete: () => ({ _op: 'delete' }),
            serverTimestamp: () => new Date().toISOString()
          };
        }, srvPort);
      }

      // Contexto A y Contexto B
      const ctxA = await browser.newContext({ viewport: { width: 390, height: 844 } });
      const pageA = await ctxA.newPage();
      await setupMockFirebase(pageA);
      await pageA.goto('file://' + prodHtmlPath);
      await pageA.waitForTimeout(1500);

      const ctxB = await browser.newContext({ viewport: { width: 390, height: 844 } });
      const pageB = await ctxB.newPage();
      await setupMockFirebase(pageB);
      await pageB.goto('file://' + prodHtmlPath);
      await pageB.waitForTimeout(1500);

      // Contexto A mueve tarjeta 1 a 'grabando'
      await pageA.evaluate(() => window.moverEstado('c1', 'grabando'));
      await pageA.waitForTimeout(1000);

      // Contexto B mueve tarjeta 2 a 'listo'
      await pageB.evaluate(() => window.moverEstado('c2', 'listo'));
      await pageB.waitForTimeout(1000);

      if (prodDoc.tarjetas.c1.estado !== 'grabando' || prodDoc.tarjetas.c2.estado !== 'listo') {
        fail(`Concurrencia en producción falló: c1=${prodDoc.tarjetas.c1.estado}, c2=${prodDoc.tarjetas.c2.estado}`);
      }

      // Modo sin conexión en Contexto A
      await pageA.evaluate(() => window.__setOffline(true));
      await pageA.waitForTimeout(500);

      const labelOffline = await pageA.locator('#live-indicator-label').textContent();
      if (!labelOffline.toLowerCase().includes('sin conexión')) {
        fail(`Indicador no mostró 'Sin conexión' en modo offline: '${labelOffline}'`);
      }

      // Contexto A offline mueve c3 y c4 a 'listo'
      await pageA.evaluate(() => {
        window.moverEstado('c3', 'listo');
        window.moverEstado('c4', 'listo');
      });
      await pageA.waitForTimeout(500);

      // Reconectar Contexto A
      await pageA.evaluate(() => window.__setOffline(false));
      await pageA.waitForTimeout(1200);

      const labelOnline = await pageA.locator('#live-indicator-label').textContent();
      if (!labelOnline.toLowerCase().includes('en vivo')) {
        fail(`Indicador no volvió a 'En vivo' tras reconectar: '${labelOnline}'`);
      }

      if (prodDoc.tarjetas.c3.estado !== 'listo' || prodDoc.tarjetas.c4.estado !== 'listo') {
        fail('Los cambios offline no se subieron al reconectar');
      }
      if (prodDoc.tarjetas.c2.estado !== 'listo') {
        fail('La reconexión revirtió el cambio concurrente de la tarjeta 2');
      }

      // Subir tarjetas locales faltantes en Firestore
      const prodHtmlFaltantes = path.join(tmpDir, 'qa-produccion-extra.html');
      const prodDataExtra = JSON.parse(JSON.stringify(prodData));
      prodDataExtra.contenidos.push({ id: 'c5', titulo: 'Tarjeta Extra', tipo: 'reel', estado: 'todo', subtareas: [], mediaLinks: [] });

      let htmlExtra = fs.readFileSync(PLANTILLA_PROD, 'utf8').replace(/const DATA = \{[\s\S]*?\};/, `const DATA = ${JSON.stringify(prodDataExtra, null, 2)};`);
      fs.writeFileSync(prodHtmlFaltantes, htmlExtra);

      const ctxC = await browser.newContext({ viewport: { width: 390, height: 844 } });
      const pageC = await ctxC.newPage();
      pageC.on('pageerror', err => console.log('pageC error:', err.message));
      await pageC.addInitScript(() => localStorage.clear());
      await setupMockFirebase(pageC);
      await pageC.goto('file://' + prodHtmlFaltantes);

      for (let wait = 0; wait < 25; wait++) {
        if (prodDoc.tarjetas.c5) break;
        await new Promise(r => setTimeout(r, 200));
      }

      if (!prodDoc.tarjetas.c5) {
        fail('La tarjeta local c5 que faltaba en remoto no fue subida automáticamente');
      }

      await ctxA.close();
      await ctxB.close();
      await ctxC.close();
      server.close();
      pass('Concurrencia atómica, cola offline y sincronización de tarjetas faltantes validadas');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // CASO 13: Regresión visual y chequeo de sintaxis
    // ─────────────────────────────────────────────────────────────────────────
    console.log(`\n${C.bold}13. Regresión visual y sintaxis:${C.reset} sin desborde ni pageerror a 390/1440 px y node --check`);
    {
      const paginasRegresion = [
        caso1HtmlFile,
        path.join(REPO_ROOT, 'produccion', 'bambu-bistro-2026-10-03-09f962.html'),
        path.join(REPO_ROOT, 'index.html'),
        path.join(REPO_ROOT, 'informes', 'gestion', 'pachamama-2026-09-ca30b8.html'),
        path.join(REPO_ROOT, 'informes', 'meta-ads', 'burger-house-2026-10-e43bfb.html')
      ];

      for (const p of paginasRegresion) {
        if (!fs.existsSync(p)) continue;
        const nombrePagina = path.basename(p);

        for (const w of [390, 1440]) {
          const ctx = await browser.newContext({ viewport: { width: w, height: w === 390 ? 844 : 900 } });
          const page = await ctx.newPage();
          const errors = [];
          page.on('pageerror', e => errors.push(e.message));

          await page.route('**/*', r => {
            const u = r.request().url();
            if (u.startsWith('file:') || /cdn\.jsdelivr|cdnjs|gstatic\.com\/firebasejs|fonts\.googleapis|fonts\.gstatic/.test(u)) {
              return r.continue();
            }
            return r.abort();
          });

          await page.goto('file://' + p);
          await page.waitForTimeout(1500);

          const { scrollWidth, clientWidth } = await page.evaluate(() => ({
            scrollWidth: document.documentElement.scrollWidth,
            clientWidth: document.documentElement.clientWidth
          }));

          if (errors.length > 0) {
            fail(`Error de página en ${nombrePagina} a ${w}px: ${errors.join('; ')}`);
          }

          if (scrollWidth > clientWidth + 1) {
            fail(`Desplazamiento horizontal en ${nombrePagina} a ${w}px: scrollWidth=${scrollWidth} > clientWidth=${clientWidth}`);
          }

          await ctx.close();
        }
      }

      // Verificación de sintaxis node --check en scripts de plantillas
      const archivosConScripts = [
        PLANTILLA_TABLERO,
        PLANTILLA_PROD,
        path.join(REPO_ROOT, 'index.html'),
        path.join(REPO_ROOT, '_sistema', 'snippet-registro-informe.html')
      ];

      for (const archivo of archivosConScripts) {
        if (!fs.existsSync(archivo)) continue;
        const contenido = fs.readFileSync(archivo, 'utf8');
        const scriptMatches = contenido.matchAll(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/gi);
        let scriptIndex = 1;

        for (const match of scriptMatches) {
          const rawScript = match[1];
          // Evitar scripts JSON como type="application/json"
          if (match[0].includes('application/json') || rawScript.trim().startsWith('{')) continue;

          // Reemplazar marcadores de plantilla para que node --check valide la sintaxis
          const sanitized = rawScript
            .replace(/__DATA__/g, '{}')
            .replace(/__CONFIG__/g, '{}');

          const tmpScript = path.join(tmpDir, `check_${path.basename(archivo)}_${scriptIndex++}.js`);
          fs.writeFileSync(tmpScript, sanitized);

          try {
            execSync(`node --check "${tmpScript}"`, { stdio: 'pipe' });
          } catch (err) {
            fail(`Fallo de sintaxis en script de ${path.basename(archivo)}: ${err.message}`);
          }
        }
      }

      pass('Regresión visual limpia a 390/1440 px y chequeo de sintaxis node --check aprobado');
    }

    console.log(`\n${C.bold}${C.green}================================================================${C.reset}`);
    console.log(`${C.bold}${C.green}✓ TODOS LOS 13 CASOS DE PRUEBA PASARON EXITOSAMENTE (100% OK)${C.reset}`);
    console.log(`${C.bold}${C.green}================================================================${C.reset}\n`);

  } catch (err) {
    fail('Excepción no controlada durante la suite de pruebas', err);
  } finally {
    await browser.close();
    // Limpieza de carpeta temporal
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (_) {}
  }
})();
