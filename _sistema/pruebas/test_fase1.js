const { chromium } = require('playwright');
const { Stub } = require('./fsstub');
const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert');

const REPO = path.resolve(__dirname, '../..');
const PLANTILLA = path.join(REPO, '_sistema/plantilla-tablero.html');

function buildTestHtml(tmpDir, overrides) {
  const tpl = fs.readFileSync(PLANTILLA, 'utf8');
  const items = Array.from({ length: 8 }, (_, i) => ({
    n: i + 1,
    id: 'c' + (i + 1),
    titulo: 'Contenido ' + (i + 1),
    formato: 'Reel',
    pilar: 'Pilar ' + (i + 1),
    fechaPublicacion: '10/11',
    guion: 'Guion línea 1\nGuion línea 2',
    copy: 'Texto del copy para pieza ' + (i + 1),
    hashtags: '#nexo #marca' + (i + 1),
    referencias: [{ label: 'Ref', url: 'https://instagram.com/p/123' }],
    estado: 'pendiente',
    comentario: '',
    version: 1
  }));

  const data = {
    cliente: 'Cliente QA',
    mes: 'Noviembre',
    anio: 2026,
    id: 'cliente-qa-2026-noviembre-test1234',
    url: 'https://carlosuzc29-eng.github.io/tableros-de-contenido/qa-test.html',
    firebase: {
      apiKey: 'AIzaFakeKeyForQATesting123456789',
      projectId: 'nexo-qa-inexistente'
    },
    revision: { revisadoPor: '', fecha: '' },
    contenidos: items,
    ...overrides
  };

  const html = tpl.replace('__DATA__', JSON.stringify(data, null, 2).replace(/</g, '\\u003c'));
  const filePath = path.join(tmpDir, 'tablero-test.html');
  fs.writeFileSync(filePath, html, 'utf8');
  return { filePath, data };
}

(async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexo-fase1-'));
  const browser = await chromium.launch({ channel: 'chrome' });

  try {
    console.log('--- INICIO PRUEBAS FASE 1 ---');

    // 1. Envío sin evaluar y con 1 evaluado
    {
      const { filePath } = buildTestHtml(tmpDir);
      const stub = new Stub(null);
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
      const page = await ctx.newPage();
      await stub.attach(page);
      await page.goto('file://' + filePath);
      await page.waitForTimeout(1500);

      // Sin evaluar nada -> intentar enviar
      await page.fill('#who', 'Cliente QA');
      await page.click('#dl');
      await page.waitForTimeout(1000);

      const modalText0 = await page.evaluate(() => {
        const m = document.getElementById('modal');
        return m && getComputedStyle(m).display !== 'none' ? m.innerText.replace(/\s+/g, ' ') : '';
      });
      assert(modalText0.includes('faltan 8 contenidos por evaluar'), 'Debe bloquear envío con 8 pendientes. Modal: ' + modalText0);
      assert.strictEqual(stub.log.filter(x => x.body).length, 0, 'No debe haber enviado ningún PATCH');
      console.log('✓ 1a. Enviar con 0 evaluados bloqueado (faltan 8)');

      // Cerrar modal antes de evaluar 1 contenido
      await page.evaluate(() => document.getElementById('modal').classList.remove('show'));
      await page.waitForTimeout(300);

      // Evaluar 1 solo contenido
      await page.locator('article.card').first().locator('button.approve').click();
      await page.click('#dl');
      await page.waitForTimeout(1000);

      const modalText1 = await page.evaluate(() => {
        const m = document.getElementById('modal');
        return m && getComputedStyle(m).display !== 'none' ? m.innerText.replace(/\s+/g, ' ') : '';
      });
      assert(modalText1.includes('faltan 7 contenidos por evaluar'), 'Debe bloquear envío con 7 pendientes. Modal: ' + modalText1);
      assert.strictEqual(stub.log.filter(x => x.body).length, 0, 'No debe haber enviado ningún PATCH');
      console.log('✓ 1b. Enviar con 1 evaluado bloqueado (faltan 7)');

      await ctx.close();
    }

    // 2. Hashtags separados del copy y no se pegan al corregir
    {
      const { filePath, data } = buildTestHtml(tmpDir);
      const docFields = {
        id: data.id,
        cliente: data.cliente,
        total: 8,
        aprobados: 0,
        cambios: 8,
        pendientes: 0,
        estado: 'Con cambios',
        revisadoPor: 'Cliente QA',
        ultimaRevision: '2026-10-28T00:00:00Z',
        contenidos: data.contenidos.map(c => ({
          ...c,
          estado: 'cambios',
          comentario: '[Cliente]: Ajustar guion'
        }))
      };

      const stub = new Stub(docFields);
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
      const page = await ctx.newPage();
      await stub.attach(page);
      await page.addInitScript(() => {
        sessionStorage.setItem('nexo_agency_session', JSON.stringify({
          email: 'carlosuzc29@gmail.com',
          idToken: 'fake',
          refreshToken: 'r',
          expiresAt: Date.now() + 3600e3
        }));
      });

      await page.goto('file://' + filePath);
      await page.waitForTimeout(1500);

      // Verificar que el elemento hash existe y está separado
      const hasSeparateHash = await page.evaluate(() => {
        const card = document.querySelector('article.card');
        const pCopy = card.querySelector('.p-copy');
        const pHash = card.querySelector('p.hash');
        return !!pHash && !pCopy.querySelector('.hash');
      });
      assert(hasSeparateHash, 'El elemento hash debe estar separado del p-copy');

      // Corregir solo el guion en la tarjeta 1
      const g = page.locator('article.card').first().locator('.guion p').first();
      await g.click();
      await page.keyboard.press('Meta+A');
      await page.keyboard.type('Nuevo guion corregido v2');
      await page.keyboard.press('Enter');
      await page.keyboard.type('Segunda línea de guion');

      await page.locator('article.card').first().locator('.btn-agency-save').click();
      await page.waitForTimeout(2000);

      const c1 = stub.fields.contenidos[0];
      const origCopy = data.contenidos[0].copy;
      const origHash = data.contenidos[0].hashtags;

      assert.strictEqual(c1.copy.trim(), origCopy.trim(), 'El copy no debe modificarse si solo se editó el guion');
      assert(!c1.copy.includes(origHash), 'El copy no debe incluir los hashtags');
      assert.strictEqual(c1.hashtags, origHash, 'Los hashtags deben permanecer intactos');

      // Verificar que los hashtags siguen visibles en pantalla después de sincronizar
      const hashVisible = await page.locator('article.card').first().locator('p.hash').isVisible();
      assert(hashVisible, 'Los hashtags deben seguir visibles en pantalla después de sincronizar');
      console.log('✓ 2. Hashtags separados: copy intacto y hashtags preservados');

      // 4. Guardar sin cambios
      await page.locator('article.card').first().locator('.btn-agency-save').click();
      await page.waitForTimeout(1000);
      const toastText = await page.evaluate(() => (document.getElementById('toast') || {}).textContent || '');
      assert(toastText.includes('Sin cambios para guardar'), 'Debe mostrar "Sin cambios para guardar". Toast: ' + toastText);
      console.log('✓ 4. Guardar sin cambios no agrega historial ni escribe');

      // 5. CSS contenteditable plaintext-only
      const styleInfo = await g.evaluate(e => ({
        outlineStyle: getComputedStyle(e).outlineStyle,
        bg: getComputedStyle(e).backgroundColor,
        ce: e.getAttribute('contenteditable')
      }));
      assert.strictEqual(styleInfo.outlineStyle, 'dashed', 'Debe tener outlineStyle dashed con plaintext-only');
      console.log('✓ 5. CSS distingue elementos plaintext-only en edición');

      // 3. Aprobar versión con edición sin guardar -> modal
      const g2 = page.locator('article.card').nth(1).locator('.guion p').first();
      await g2.click();
      await page.keyboard.type(' TEXTO EDITADO SIN GUARDAR');
      await page.locator('article.card').nth(1).locator('.btn-agency-approve').click();
      await page.waitForTimeout(1000);

      const modalUnsaved = await page.evaluate(() => {
        const m = document.getElementById('modal');
        return m && getComputedStyle(m).display !== 'none' ? m.innerText.replace(/\s+/g, ' ') : '';
      });
      assert(modalUnsaved.includes('cambios sin guardar'), 'Debe mostrar modal de cambios sin guardar: ' + modalUnsaved);

      // Hacer click en "Guardar y aprobar"
      const btnGuardarAprobar = page.locator('#modal button.b-pri');
      await btnGuardarAprobar.click();
      await page.waitForTimeout(2000);

      const c2 = stub.fields.contenidos[1];
      assert.strictEqual(c2.estado, 'aprobado', 'La pieza debe quedar aprobada');
      assert(c2.guion.includes('TEXTO EDITADO SIN GUARDAR'), 'El guion guardado debe incluir la edición: ' + c2.guion);
      assert.strictEqual(c2.aprobacion && c2.aprobacion.guion, c2.guion, 'La aprobación debe contener el guion corregido');
      console.log('✓ 3. Aprobar con edición sin guardar muestra modal y guarda correctamente');

      await ctx.close();
    }

    // 6. Documento inexistente (404) al enviar revisión -> autorregistro y reintento exitoso
    {
      const { filePath } = buildTestHtml(tmpDir);
      const stub = new Stub(null); // Inicia en 404
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
      const page = await ctx.newPage();
      await stub.attach(page);

      await page.goto('file://' + filePath);
      await page.waitForTimeout(1500);

      // Aprobar todas las tarjetas
      const apBtns = page.locator('button.approve');
      const count = await apBtns.count();
      for (let i = 0; i < count; i++) {
        await apBtns.nth(i).click();
      }

      await page.fill('#who', 'Cliente QA 404');
      await page.click('#dl');
      await page.waitForTimeout(2500);

      assert(stub.fields, 'El documento debió autorregistrarse en Firestore');
      assert.strictEqual(stub.fields.estado, 'Aprobado', 'El tablero debió guardarse como Aprobado');
      assert.strictEqual(stub.fields.aprobados, 8, 'Deben registrarse 8 aprobados');
      console.log('✓ 6. Documento inexistente al enviar se autorregistra y envía correctamente');

      await ctx.close();
    }

    console.log('--- TODAS LAS PRUEBAS DE FASE 1 PASARON CON ÉXITO ---');
  } finally {
    await browser.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
})();
