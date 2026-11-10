// Pruebas automáticas Fase 8: tablero de producción v3 (ficha centrada, notas en vivo y edición en pauta)
//  a) La ficha se abre centrada, muestra la tarjeta correcta y navega con flechas; Esc la cierra
//  b) Notas en vivo: lo escrito en el teléfono A llega al teléfono B y a la tarjeta
//  c) Notas y estado a la vez desde dos teléfonos: no se pisan (escritura por campo)
//  d) Lo que se está escribiendo no se pisa con una versión remota vieja
//  e) Título y guion editables en pauta; título vacío no se guarda
//  f) Checklist: agregar, renombrar y quitar pasos se sincroniza al otro teléfono
//  g) Sin errores de JavaScript ni desborde horizontal a 390 y 1440 px
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const assert = require('assert');

let chromium;
try {
  chromium = require('playwright').chromium;
} catch (e) {
  chromium = require(path.join(__dirname, 'node_modules', 'playwright')).chromium;
}

const REPO = path.resolve(__dirname, '../..');
const PLANTILLA_PROD = path.join(REPO, '_sistema', 'plantilla-produccion.html');

const DATA = {
  fecha: '2026-11-02',
  cliente: 'QA Produccion v3',
  id: 'prod-qa-v3-ab12cd',
  firebase: { apiKey: 'fake-prod-key', projectId: 'nexo-qa-inexistente' },
  contenidos: [
    { id: 'c1', titulo: 'ADS · TARJETA UNO', tipo: 'reel', sede: '', estado: 'todo',
      descripcion: 'Pauta: 02/11 · 2:00 pm\n\nESCENA 1 · 0–3 s\nVisual: Plano general.\nVoz: Hola.\n\nESCENA 2 · 3–6 s\nVisual: Detalle.',
      subtareas: [{ id: 'c1-s1', texto: 'Plano general', done: false }], mediaLinks: [] },
    { id: 'c2', titulo: 'TARJETA DOS', tipo: 'foto', sede: 'El Centro', estado: 'todo', descripcion: 'Texto corrido del guion.', subtareas: [], mediaLinks: [{ label: 'Ref', url: 'https://example.com/ref' }] },
    { id: 'c3', titulo: 'TARJETA TRES', tipo: 'carrusel', sede: '', estado: 'todo', descripcion: '', subtareas: [], mediaLinks: [] }
  ]
};

// ── Firestore simulado: aplica rutas con puntos (tarjetas.c1 y tarjetas.c1.notas) como Firestore ──
const paginasRegistradas = [];

function crearServidor() {
  const clean = c => ({ ...c, notas: c.notas || '' });
  const doc = {
    id: DATA.id, cliente: DATA.cliente, fecha: DATA.fecha,
    orden: DATA.contenidos.map(c => c.id),
    tarjetas: Object.fromEntries(DATA.contenidos.map(c => [c.id, clean(JSON.parse(JSON.stringify(c)))])),
    todo: 3, grabando: 0, listo: 0, eliminadas: []
  };
  const clients = new Set();
  const setPath = (obj, parts, val) => {
    let o = obj;
    for (let i = 0; i < parts.length - 1; i++) { o[parts[i]] = o[parts[i]] || {}; o = o[parts[i]]; }
    const last = parts[parts.length - 1];
    if (val && val._op === 'delete') delete o[last];
    else o[last] = val;
  };
  const notify = (d) => {
    const targetDoc = d || doc;
    paginasRegistradas.forEach(p => {
      if (!p.isClosed()) {
        p.evaluate((remote) => {
          if (typeof window.__onRemoteDoc === 'function') {
            window.__onRemoteDoc(remote);
          }
        }, targetDoc).catch(() => {});
      }
    });
  };
  const handleUpdate = (updates) => {
    for (const [k, v] of Object.entries(updates)) {
      if (k === 'eliminadas' && v && v._op === 'arrayUnion') { if (!doc.eliminadas.includes(v.value)) doc.eliminadas.push(v.value); continue; }
      setPath(doc, k.split('.'), v);
    }
    notify();
  };
  return { doc, notify, handleUpdate };
}

async function prepararPagina(browser, serverObj, htmlPath, viewport) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  paginasRegistradas.push(page);
  const errores = [];
  page.on('pageerror', e => errores.push(String(e)));

  await page.exposeFunction('__prodUpdateNode', async (fields) => {
    serverObj.handleUpdate(fields);
  });

  await page.route('**/*', r => {
    const u = r.request().url();
    if (u.includes('firebasejs') || u.includes('vendor/firebase-')) return r.fulfill({ status: 200, contentType: 'application/javascript', body: '// mock' });
    if (u.includes('firestore.googleapis.com')) return r.abort();
    if (u.includes('_sistema/')) {
      const relPath = u.substring(u.indexOf('_sistema/'));
      const filePath = path.join(REPO, relPath.split('?')[0]);
      if (fs.existsSync(filePath)) {
        const ext = path.extname(filePath);
        const ct = ext === '.css' ? 'text/css' : (ext === '.js' ? 'application/javascript' : (ext === '.woff2' ? 'font/woff2' : 'text/plain'));
        return r.fulfill({ status: 200, contentType: ct, body: fs.readFileSync(filePath) });
      }
    }
    return r.continue();
  });
  await page.addInitScript((initialDoc) => {
    window.__lastDoc = initialDoc;
    const listeners = [];
    window.__onRemoteDoc = (doc) => {
      window.__lastDoc = doc;
      listeners.forEach(cb => cb({ data: () => doc, metadata: { fromCache: false, hasPendingWrites: false }, exists: true }));
    };
    window.firebase = {
      apps: [{ name: '[DEFAULT]' }],
      initializeApp: () => window.firebase,
      firestore: function () {
        return {
          enablePersistence: async () => {},
          collection: () => ({
            doc: () => ({
              onSnapshot: (opts, cb) => {
                const callback = typeof opts === 'function' ? opts : cb;
                listeners.push(callback);
                if (window.__lastDoc) setTimeout(() => callback({ data: () => window.__lastDoc, metadata: { fromCache: false, hasPendingWrites: false }, exists: true }), 10);
                return () => {};
              },
              update: async (fields) => {
                if (typeof window.__prodUpdateNode === 'function') {
                  await window.__prodUpdateNode(fields);
                }
              }
            })
          }),
          runTransaction: async (fn) => fn({ get: async () => ({ data: () => window.__lastDoc || {}, exists: true }), update: async () => {}, set: async () => {} })
        };
      }
    };
    window.firebase.firestore.FieldValue = {
      arrayUnion: (v) => ({ _op: 'arrayUnion', value: v }),
      delete: () => ({ _op: 'delete' })
    };
  }, serverObj.doc);
  await page.goto('file://' + htmlPath);
  await page.waitForTimeout(1200);
  return { ctx, page, errores };
}

const esperar = async (cond, ms = 4000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (await cond()) return true; await new Promise(r => setTimeout(r, 100)); }
  return false;
};

(async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexo-fase8-'));
  const prodDir = path.join(tmpDir, 'produccion');
  fs.mkdirSync(prodDir, { recursive: true });
  fs.symlinkSync(path.join(REPO, '_sistema'), path.join(tmpDir, '_sistema'));
  const htmlPath = path.join(prodDir, 'qa-produccion-v3.html');
  let html = fs.readFileSync(PLANTILLA_PROD, 'utf8').replace(/const DATA = \{[\s\S]*?\};/, () => `const DATA = ${JSON.stringify(DATA, null, 2)};`);
  html = html.replace(/<script[^>]*firebase[^>]*><\/script>/gi, '');
  fs.writeFileSync(htmlPath, html);

  const serverObj = crearServidor();
  const { doc, notify } = serverObj;
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--allow-file-access-from-files'] });

  try {
    console.log('--- INICIO PRUEBAS FASE 8 (PRODUCCIÓN v3) ---');
    const A = await prepararPagina(browser, serverObj, htmlPath, { width: 1440, height: 900 });
    const B = await prepararPagina(browser, serverObj, htmlPath, { width: 390, height: 844 });

    // a) Ficha centrada, navegación y cierre
    {
      const pa = A.page;
      await pa.locator('.card[data-id="c1"]').click();
      await pa.waitForTimeout(400);
      assert.ok(await pa.locator('#side-drawer.show').isVisible(), 'La ficha debe abrirse');
      assert.strictEqual(await pa.locator('#drawer-title').inputValue(), 'ADS · TARJETA UNO', 'La ficha debe mostrar el título de c1');
      assert.strictEqual((await pa.locator('#ps-pos').textContent()).trim(), '1 de 3', 'Debe indicar la posición');
      assert.ok(await pa.locator('#ps-ads').isVisible(), 'Debe marcar ADS');
      assert.ok((await pa.locator('#ps-hora').textContent()).includes('2:00 pm'), 'Debe mostrar la hora de pauta');
      assert.strictEqual(await pa.locator('#drawer-desc .sc').count(), 2, 'El guion debe mostrarse en 2 escenas');
      const box = await pa.locator('#side-drawer .ps-panel').boundingBox();
      const centro = box.x + box.width / 2;
      assert.ok(Math.abs(centro - 720) < 4, `La ficha debe estar centrada (centro=${centro})`);
      await pa.keyboard.press('ArrowRight');
      await pa.waitForTimeout(150);
      assert.strictEqual(await pa.locator('#drawer-title').inputValue(), 'TARJETA DOS', '→ debe pasar a la siguiente tarjeta');
      await pa.keyboard.press('ArrowLeft');
      await pa.waitForTimeout(150);
      await pa.keyboard.press('Escape');
      await pa.waitForTimeout(400);
      assert.ok(!(await pa.locator('#side-drawer.show').count()), 'Esc debe cerrar la ficha');
      console.log('✓ a) Ficha centrada, flechas para navegar y Esc para cerrar');
    }

    // b) Notas en vivo de A hacia B
    {
      await A.page.evaluate(() => openDrawer('c1'));
      await A.page.waitForTimeout(300);
      await A.page.locator('#ps-notes').click();
      await A.page.keyboard.type('Toma 3 es la buena', { delay: 15 });
      assert.ok(await esperar(() => doc.tarjetas.c1.notas === 'Toma 3 es la buena'), 'La nota debe guardarse en Firestore mientras se escribe');
      assert.ok(await esperar(async () => (await B.page.locator('.card[data-id="c1"] .pc-note').count()) === 1), 'La nota debe aparecer en la tarjeta del teléfono B');
      await B.page.evaluate(() => openDrawer('c1'));
      await B.page.waitForTimeout(300);
      assert.strictEqual(await B.page.locator('#ps-notes').inputValue(), 'Toma 3 es la buena', 'B debe ver la nota en la ficha');
      assert.strictEqual(doc.tarjetas.c1.titulo, 'ADS · TARJETA UNO', 'La nota no debe tocar otros campos');
      console.log('✓ b) Notas en vivo: lo escrito en A aparece en B (ficha y tarjeta)');
    }

    // c) A escribe notas mientras B cambia el estado de la misma tarjeta
    {
      await A.page.locator('#ps-notes').click();
      await A.page.keyboard.press('End');
      await A.page.keyboard.type('. Repetir zoom', { delay: 15 });
      await B.page.evaluate(() => window.moverEstado('c1', 'grabando'));
      assert.ok(await esperar(() => doc.tarjetas.c1.notas === 'Toma 3 es la buena. Repetir zoom'), 'La nota completa debe quedar guardada');
      await A.page.locator('#drawer-title').click();
      await A.page.waitForTimeout(800);
      assert.strictEqual(doc.tarjetas.c1.estado, 'grabando', 'El cambio de estado de B no debe perderse');
      assert.ok(await esperar(async () => (await A.page.locator('#side-drawer').getAttribute('data-status')) === 'grabando'), 'A debe ver el estado nuevo en su ficha');
      assert.strictEqual(await A.page.locator('#ps-notes').inputValue(), 'Toma 3 es la buena. Repetir zoom', 'A conserva su nota');
      console.log('✓ c) Nota y estado cambiados a la vez desde dos teléfonos: ninguno se pierde');
    }

    // d) Una versión remota vieja no pisa lo que se está escribiendo
    {
      await A.page.locator('#ps-notes').click();
      await A.page.keyboard.press('End');
      await A.page.keyboard.type(' y luz', { delay: 10 });
      const viejo = JSON.parse(JSON.stringify(doc));
      viejo.tarjetas.c1.notas = 'VERSIÓN VIEJA';
      notify(viejo);
      await A.page.waitForTimeout(250);
      assert.strictEqual(await A.page.locator('#ps-notes').inputValue(), 'Toma 3 es la buena. Repetir zoom y luz', 'Lo que se escribe no debe pisarse');
      assert.ok(await esperar(() => doc.tarjetas.c1.notas === 'Toma 3 es la buena. Repetir zoom y luz'), 'Debe terminar guardada la versión escrita');
      console.log('✓ d) Una actualización remota vieja no pisa lo que se está escribiendo');
    }

    // e) Título y guion editables; título vacío no se guarda
    {
      const pa = A.page;
      await pa.locator('#drawer-title').fill('ADS · TARJETA UNO EDITADA');
      await pa.locator('#ps-notes').click();
      assert.ok(await esperar(() => doc.tarjetas.c1.titulo === 'ADS · TARJETA UNO EDITADA'), 'El título editado debe guardarse');
      await pa.locator('#drawer-title').fill('   ');
      await pa.locator('#ps-notes').click();
      await pa.waitForTimeout(900);
      assert.strictEqual(doc.tarjetas.c1.titulo, 'ADS · TARJETA UNO EDITADA', 'Un título vacío no debe guardarse');
      assert.strictEqual(await pa.locator('#drawer-title').inputValue(), 'ADS · TARJETA UNO EDITADA', 'El título vacío se restaura');

      await pa.locator('#btn-edit-script').click();
      assert.ok(await pa.locator('#ps-script-editor').isVisible(), 'Editar debe mostrar el editor del guion');
      await pa.locator('#ps-script-editor').fill('ESCENA 1 · 0–2 s\nVisual: Nuevo plano');
      await pa.locator('#btn-edit-script').click();
      assert.ok(await esperar(() => doc.tarjetas.c1.descripcion === 'ESCENA 1 · 0–2 s\nVisual: Nuevo plano'), 'El guion editado debe guardarse');
      assert.strictEqual(await pa.locator('#drawer-desc .sc').count(), 1, 'El guion nuevo debe mostrarse formateado');
      assert.ok(await esperar(async () => (await B.page.locator('#drawer-desc').textContent()).includes('Nuevo plano')), 'B debe ver el guion nuevo');
      console.log('✓ e) Título y guion se editan en pauta; un título vacío no se guarda');
    }

    // f) Checklist: agregar, renombrar y quitar
    {
      const pa = A.page;
      await pa.locator('#ps-check-input').fill('Toma de reacción');
      await pa.locator('#ps-check-input').press('Enter');
      assert.ok(await esperar(() => (doc.tarjetas.c1.subtareas || []).some(s => s.texto === 'Toma de reacción')), 'El paso agregado debe guardarse');
      assert.ok(await esperar(async () => (await B.page.locator('#drawer-checklist .ps-check-item').count()) === 2), 'B debe ver el paso nuevo');
      await pa.locator('#btn-edit-checklist').click();
      await pa.locator('.ps-check-edit').first().fill('Plano general abierto');
      await pa.locator('.ps-check-edit').first().press('Enter');
      assert.ok(await esperar(() => doc.tarjetas.c1.subtareas[0].texto === 'Plano general abierto'), 'El paso renombrado debe guardarse');
      await pa.locator('.ps-check-del').nth(1).click();
      assert.ok(await esperar(() => doc.tarjetas.c1.subtareas.length === 1), 'El paso quitado debe borrarse');
      assert.ok(await esperar(async () => (await B.page.locator('#drawer-checklist .ps-check-item').count()) === 1), 'B debe ver la lista actualizada');
      await B.page.locator('#drawer-checklist .ps-check-item').first().click();
      assert.ok(await esperar(() => doc.tarjetas.c1.subtareas[0].done === true), 'Marcar un paso en B debe guardarse');
      console.log('✓ f) Checklist: agregar, renombrar, quitar y marcar se sincroniza entre teléfonos');
    }

    // g) Sin errores ni desborde horizontal
    {
      for (const P of [A, B]) {
        const { sw, cw } = await P.page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
        assert.ok(sw <= cw + 1, `Sin desborde horizontal (${sw} > ${cw})`);
      }
      assert.deepStrictEqual([...A.errores, ...B.errores], [], 'Sin errores de JavaScript: ' + [...A.errores, ...B.errores].join(' | '));
      console.log('✓ g) Sin errores de JavaScript ni desborde horizontal a 390 y 1440 px');
    }

    await A.ctx.close();
    await B.ctx.close();
    console.log('--- TODAS LAS PRUEBAS DE FASE 8 PASARON CON ÉXITO ---');
  } finally {
    await browser.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
})().catch(err => {
  console.error('✗ FASE 8 FALLÓ:', err && err.message ? err.message : err);
  process.exit(1);
});
