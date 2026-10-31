// Pruebas automáticas Fase 6: Modo edición libre del administrador y protección contra pérdida de cambios
const path = require('path');
const fs = require('fs');
const os = require('os');
const assert = require('assert');
const { Stub, pack } = require('./fsstub');

let chromium;
try {
  chromium = require('playwright').chromium;
} catch (e) {
  chromium = require(path.join(__dirname, 'node_modules', 'playwright')).chromium;
}

const REPO = path.resolve(__dirname, '../..');
const PLANTILLA = path.join(REPO, '_sistema/plantilla-tablero.html');

function buildTestHtml(tmpDir, overrides = {}) {
  const linkSistema = path.join(tmpDir, '_sistema');
  if (!fs.existsSync(linkSistema)) {
    fs.symlinkSync(path.join(REPO, '_sistema'), linkSistema);
  }

  const tpl = fs.readFileSync(PLANTILLA, 'utf8');
  const items = Array.from({ length: 4 }, (_, i) => ({
    n: i + 1,
    id: 'c' + (i + 1),
    titulo: 'Pieza ' + (i + 1),
    formato: 'Reel',
    canal: i < 2 ? 'Orgánico' : 'Ads',
    pilar: 'Pilar inicial ' + (i + 1),
    fechaPublicacion: '12/11',
    guion: 'Guion original ' + (i + 1) + '\nSegunda línea',
    copy: 'Copy original de la pieza ' + (i + 1),
    hashtags: '#nexo #pieza' + (i + 1),
    referencias: [{ label: 'Ref inicial', url: 'https://instagram.com/p/inicial' + (i + 1) }],
    estado: i === 0 ? 'cambios' : (i === 1 ? 'aprobado' : 'en_revision'),
    comentario: i === 0 ? '[Cliente]: Ajustar cierre del guion' : '',
    aprobacion: i === 1 ? {
      version: 1,
      usuario: 'Cliente QA',
      fecha: '2026-10-28T10:00:00.000Z',
      titulo: 'Pieza 2',
      formato: 'Reel',
      guion: 'Guion original 2\nSegunda línea',
      copy: 'Copy original de la pieza 2',
      hashtags: '#nexo #pieza2'
    } : undefined,
    version: 1
  }));

  const data = {
    cliente: 'Cliente QA Libre',
    cuenta: 'clienteqa',
    mes: 'Noviembre',
    anio: 2026,
    id: 'cliente-qa-libre-2026-noviembre-ab12cd',
    url: 'https://carlosuzc29-eng.github.io/tableros-de-contenido/qa-libre.html',
    firebase: {
      apiKey: 'AIzaFakeKeyForQATesting123456789',
      projectId: 'nexo-qa-inexistente'
    },
    revision: { revisadoPor: 'Cliente QA', fecha: '2026-10-28T12:00:00.000Z' },
    contenidos: items,
    ...overrides
  };

  const html = tpl
    .replace('__CODIGO_CLIENTE__', 'qa-libre-ab12cd')
    .replace('__DATA__', JSON.stringify(data, null, 2).replace(/</g, '\\u003c'));
  const filePath = path.join(tmpDir, 'tablero-fase6.html');
  fs.writeFileSync(filePath, html, 'utf8');

  const docFields = {
    id: data.id,
    cliente: data.cliente,
    mes: data.mes,
    anio: String(data.anio),
    total: items.length,
    aprobados: 1,
    cambios: 1,
    pendientes: 2,
    estado: 'Con cambios',
    revisadoPor: 'Cliente QA',
    ultimaRevision: '2026-10-28T12:00:00.000Z',
    contenidos: JSON.parse(JSON.stringify(items))
  };

  return { filePath, data, docFields };
}

function setAgencySessionInit(page) {
  return page.addInitScript(() => {
    sessionStorage.setItem('nexo_agency_session', JSON.stringify({
      email: 'carlosuzc29@gmail.com',
      idToken: 'fake-agency-jwt',
      refreshToken: 'fake-refresh',
      expiresAt: Date.now() + 3600e3
    }));
  });
}

(async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexo-fase6-'));
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--allow-file-access-from-files', '--disable-web-security']
  });

  try {
    console.log('--- INICIO PRUEBAS FASE 6 (MODO EDICIÓN LIBRE) ---');

    // Seguridad inicial: sin sesión de agencia nada del modo libre es visible ni utilizable
    {
      const { filePath, docFields } = buildTestHtml(tmpDir);
      const stub = new Stub(docFields);
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
      const page = await ctx.newPage();
      await stub.attach(page);
      await page.goto('file://' + filePath, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1200);

      const freeBtnCount = await page.locator('#btnFreeEditMode').count();
      const stripVis = await page.locator('.card-free-edit-strip').first().isVisible();
      const pilarVis = await page.locator('.agency-pilar-inp').first().isVisible();
      const refsEdVis = await page.locator('.agency-refs-editor').first().isVisible();
      assert.strictEqual(freeBtnCount, 0, 'Sin agencia no debe existir #btnFreeEditMode');
      assert.strictEqual(stripVis, false, 'Sin agencia no debe verse la franja de edición libre');
      assert.strictEqual(pilarVis, false, 'Sin agencia no debe verse el input de pilar');
      assert.strictEqual(refsEdVis, false, 'Sin agencia no debe verse el editor de referencias');
      console.log('✓ 0. Sin sesión de agencia, nada de Edición libre es visible');
      await ctx.close();
    }

    // Caso a) Edición libre en una pieza 'cambios': estado y versión no cambian, y texto, pilar y referencias se guardan
    {
      const { filePath, docFields } = buildTestHtml(tmpDir);
      const stub = new Stub(docFields);
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      const page = await ctx.newPage();
      await stub.attach(page);
      await setAgencySessionInit(page);
      await page.goto('file://' + filePath, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1400);

      const freeBtn = page.locator('#btnFreeEditMode');
      assert.strictEqual(await freeBtn.isVisible(), true, 'Con agencyUser debe verse el botón de Edición libre');
      assert.strictEqual((await freeBtn.textContent()).trim(), '✎ Edición libre: OFF', 'Por defecto debe iniciar en OFF');
      assert.strictEqual(await page.locator('.card-free-edit-strip').first().isVisible(), false, 'Con OFF la franja debe estar oculta');
      assert.strictEqual(await page.locator('.agency-pilar-inp').first().isVisible(), false, 'Con OFF pilar editable debe estar oculto');

      // Activar Edición libre: ON
      await freeBtn.click();
      assert.strictEqual((await freeBtn.textContent()).trim(), '✎ Edición libre: ON', 'Debe cambiar a ON');
      const storedState = await page.evaluate(() => sessionStorage.getItem('nexo_agency_free_edit'));
      assert.strictEqual(storedState, '1', 'Debe persistir estado ON en sessionStorage');

      const card1 = page.locator('article.card').first();
      assert.strictEqual(await card1.locator('.card-free-edit-strip').isVisible(), true, 'Con ON cada tarjeta debe mostrar franja "Edición libre"');
      assert.strictEqual(await card1.locator('.agency-pilar-inp').isVisible(), true, 'Con ON debe mostrarse input de pilar');
      assert.strictEqual(await card1.locator('.agency-refs-editor').isVisible(), true, 'Con ON debe mostrarse editor de referencias');
      assert.strictEqual(await card1.locator('.btn-agency-send-correction').isVisible(), true, 'Con ON debe mostrarse "Enviar al cliente como corrección"');

      // Editar guion, pilar y referencias en pieza 1 (estado: 'cambios', version: 1)
      const guionEl = card1.locator('.guion p.p-guion');
      await guionEl.click();
      await page.keyboard.press('Meta+A');
      await page.keyboard.type('Guion editado en modo libre sin tocar estado');

      await card1.locator('.agency-pilar-inp').fill('Autoridad y confianza');

      // Quitar referencia inicial y probar primero validación URL sin http
      await card1.locator('.btn-agency-ref-remove').first().click();
      await card1.locator('.btn-agency-ref-add').click();
      await card1.locator('.agency-ref-label').first().fill('Ejemplo Reel');
      await card1.locator('.agency-ref-url').first().fill('instagram.com/sin-http');

      const patchBeforeInvalid = stub.log.filter(x => x.body).length;
      await card1.locator('.btn-agency-save').click();
      await page.waitForTimeout(400);
      assert.strictEqual(stub.log.filter(x => x.body).length, patchBeforeInvalid, 'Debe bloquear guardado si URL no empieza con http');

      // Corregir URL válida con https y agregar una segunda referencia
      await card1.locator('.agency-ref-url').first().fill('https://instagram.com/reel/libre1');
      await card1.locator('.btn-agency-ref-add').click();
      await card1.locator('.agency-ref-label').nth(1).fill('Audio tendencia');
      await card1.locator('.agency-ref-url').nth(1).fill('http://ejemplo.com/audio');

      await card1.locator('.btn-agency-save').click();
      await page.waitForTimeout(1600);

      const p1 = stub.fields.contenidos.find(x => x.id === 'c1');
      assert.strictEqual(p1.estado, 'cambios', 'El estado NO debe cambiar en modo libre');
      assert.strictEqual(p1.version, 1, 'La versión NO debe cambiar en modo libre');
      assert.strictEqual(p1.fechaCorreccion, undefined, 'fechaCorreccion NO debe asignarse en modo libre');
      assert.strictEqual(stub.fields.revisadoPor, 'Cliente QA', 'revisadoPor del tablero NO debe borrarse en modo libre');
      assert.strictEqual(stub.fields.ultimaRevision, '2026-10-28T12:00:00.000Z', 'ultimaRevision NO debe borrarse en modo libre');
      assert.strictEqual(p1.guion, 'Guion editado en modo libre sin tocar estado', 'El guion debe guardarse');
      assert.strictEqual(p1.pilar, 'Autoridad y confianza', 'El pilar debe guardarse');
      assert.deepStrictEqual(p1.referencias, [
        { label: 'Ejemplo Reel', url: 'https://instagram.com/reel/libre1' },
        { label: 'Audio tendencia', url: 'http://ejemplo.com/audio' }
      ], 'Las referencias deben guardarse');

      const lastHist = p1.historial[p1.historial.length - 1];
      assert.strictEqual(lastHist.accion, 'Edición libre del equipo', 'Historial debe registrar "Edición libre del equipo"');
      assert(Array.isArray(lastHist.campos), 'Historial debe incluir arreglo campos');
      assert(lastHist.campos.includes('guion') && lastHist.campos.includes('pilar') && lastHist.campos.includes('referencias'),
        'campos debe listar guion, pilar y referencias: ' + JSON.stringify(lastHist.campos));

      const editandoAfterSave = await page.evaluate(() => document.querySelector('article.card').__cObj.editando);
      assert.strictEqual(editandoAfterSave, false, 'cObj.editando debe desactivarse tras guardado exitoso');

      // También probar pieza 2 ('aprobado'): con ON NO muestra modal de aprobada y actualiza pieza.aprobacion
      const card2 = page.locator('article.card').nth(1);
      await card2.locator('.guion p.p-guion').click();
      await page.keyboard.press('Meta+A');
      await page.keyboard.type('Guion ajustado en aprobada sin modal');
      await card2.locator('.btn-agency-save').click();
      await page.waitForTimeout(1400);

      const modalVis = await page.evaluate(() => document.getElementById('modal').classList.contains('show'));
      assert.strictEqual(modalVis, false, 'Con ON no debe mostrar modal de pieza aprobada');
      const p2 = stub.fields.contenidos.find(x => x.id === 'c2');
      assert.strictEqual(p2.estado, 'aprobado', 'Pieza 2 debe seguir aprobada');
      assert.strictEqual(p2.version, 1, 'Pieza 2 debe seguir en v1');
      assert.strictEqual(p2.aprobacion.guion, 'Guion ajustado en aprobada sin modal', 'pieza.aprobacion debe actualizarse');

      console.log('✓ a) Edición libre en pieza "cambios" (y "aprobado"): estado/versión intactos, texto, pilar, referencias e historial guardados');

      // Caso b) Un sync con datos viejos mientras cObj.editando === true no borra el texto editado
      await guionEl.click();
      await page.keyboard.press('Meta+A');
      await page.keyboard.type('Texto en edición protegida contra sync');
      await card1.locator('.agency-pilar-inp').fill('Pilar en curso');

      const isEditingNow = await page.evaluate(() => document.querySelector('article.card').__cObj.editando);
      assert.strictEqual(isEditingNow, true, 'cObj.editando debe ser true tras editar');

      // Verificar beforeunload activo mientras cObj.editando === true
      const unloadPrevented = await page.evaluate(() => {
        const ev = new Event('beforeunload', { cancelable: true });
        window.dispatchEvent(ev);
        return ev.defaultPrevented;
      });
      assert.strictEqual(unloadPrevented, true, 'beforeunload debe avisar si hay cObj.editando === true');

      // Mientras un campo dentro de .card tiene foco, syncAndRegisterBoard no debe ejecutarse
      await card1.locator('.agency-pilar-inp').focus();
      let getCountWhileFocused = 0;
      stub.fields.contenidos[0].guion = 'DATO VIEJO DEL SERVIDOR';
      stub.fields.contenidos[0].pilar = 'PILAR VIEJO';
      page.on('request', req => {
        if (req.method() === 'GET' && req.url().includes('/tableros/')) getCountWhileFocused++;
      });
      await page.evaluate(() => window.dispatchEvent(new Event('focus')));
      await page.waitForTimeout(500);
      assert.strictEqual(getCountWhileFocused, 0, 'syncAndRegisterBoard no debe ejecutarse con un input enfocado en tarjeta');

      // Quitar foco del campo (blur), forzando un sync real con datos viejos mientras cObj.editando === true
      await page.evaluate(() => document.activeElement && document.activeElement.blur());
      await page.evaluate(() => {
        // Marcar unsaved para comprobar que sync tampoco llama a setUnsavedState(false)
        document.querySelector('article.card').__cObj.setUnsavedState(true);
        window.dispatchEvent(new Event('focus'));
      });
      await page.waitForTimeout(900);
      assert(getCountWhileFocused >= 1, 'Sin foco en tarjeta sí debe correr el GET de sync');

      const domGuionAfterStaleSync = await guionEl.textContent();
      const domPilarAfterStaleSync = await card1.locator('.agency-pilar-inp').inputValue();
      const stillUnsaved = await card1.locator('.card-unsaved-badge').isVisible();
      const stillEditing = await page.evaluate(() => document.querySelector('article.card').__cObj.editando);
      assert.strictEqual(domGuionAfterStaleSync, 'Texto en edición protegida contra sync', 'El sync viejo NO debe borrar el texto editado');
      assert.strictEqual(domPilarAfterStaleSync, 'Pilar en curso', 'El sync viejo NO debe pisar el pilar editado');
      assert.strictEqual(stillUnsaved, true, 'El sync NO debe llamar a setUnsavedState(false) si cObj.editando === true');
      assert.strictEqual(stillEditing, true, 'cObj.editando debe seguir en true');

      // Restaurar stub.fields[0] al último valor legítimo guardado y probar "Descartar cambios"
      stub.fields.contenidos[0].guion = 'Guion editado en modo libre sin tocar estado';
      stub.fields.contenidos[0].pilar = 'Autoridad y confianza';
      await card1.locator('.btn-agency-discard').click();
      await page.waitForTimeout(300);
      assert.strictEqual(await guionEl.textContent(), 'Guion editado en modo libre sin tocar estado', '"Descartar cambios" debe restaurar it.guion');
      assert.strictEqual(await card1.locator('.agency-pilar-inp').inputValue(), 'Autoridad y confianza', '"Descartar cambios" debe restaurar it.pilar');
      assert.strictEqual(await page.evaluate(() => document.querySelector('article.card').__cObj.editando), false, '"Descartar cambios" debe desactivar cObj.editando');

      // Probar que "Reintentar" del modal de error conserva meta (modo: 'libre', pilar, referencias)
      await guionEl.click();
      await page.keyboard.press('Meta+A');
      await page.keyboard.type('Guion tras reintento conservando meta');
      await card1.locator('.agency-pilar-inp').fill('Pilar tras reintento');
      stub.failPatch = 1;
      await card1.locator('.btn-agency-save').click();
      await page.waitForTimeout(1200);
      const errModalTxt = await page.locator('#modal').innerText();
      assert(errModalTxt.includes('No se guardó en la nube'), 'Debe mostrar modal de error ante fallo 500');
      await page.locator('#box button', { hasText: 'Reintentar' }).click();
      await page.waitForTimeout(1500);
      const p1Retry = stub.fields.contenidos.find(x => x.id === 'c1');
      assert.strictEqual(p1Retry.estado, 'cambios', 'Reintentar debe conservar meta.modo = "libre" (estado intacto)');
      assert.strictEqual(p1Retry.version, 1, 'Reintentar debe conservar versión 1');
      assert.strictEqual(p1Retry.pilar, 'Pilar tras reintento', 'Reintentar debe conservar meta.pilar');

      console.log('✓ b) Sync con datos viejos no pisa cObj.editando === true; foco/beforeunload/Descartar/Reintentar verificados');

      // Caso c) "Enviar al cliente como corrección": estado 'corregido' y version +1
      await guionEl.click();
      await page.keyboard.press('Meta+A');
      await page.keyboard.type('Guion definitivo v2 para revisión del cliente');
      await card1.locator('.btn-agency-send-correction').click();
      await page.waitForTimeout(1600);

      const p1Corr = stub.fields.contenidos.find(x => x.id === 'c1');
      assert.strictEqual(p1Corr.estado, 'corregido', '"Enviar al cliente como corrección" debe dejar estado "corregido"');
      assert.strictEqual(p1Corr.version, 2, '"Enviar al cliente como corrección" debe incrementar version +1 (a 2)');
      assert.strictEqual(p1Corr.guion, 'Guion definitivo v2 para revisión del cliente', 'Debe guardar el nuevo guion de la corrección');
      assert.strictEqual(stub.fields.revisadoPor, '', 'En modo corrección debe limpiar revisadoPor del tablero');
      console.log('✓ c) "Enviar al cliente como corrección": estado "corregido" y version +1 verificados');

      await ctx.close();
    }

    // Verificación de discrepancia en savedDoc (muestra modal de error en vez de toast de éxito)
    {
      const { filePath, docFields } = buildTestHtml(tmpDir);
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
      const page = await ctx.newPage();
      await page.route('**/*', async r => {
        const req = r.request(), u = req.url(), m = req.method();
        if (u.startsWith('file:') || /cdn\.jsdelivr|cdnjs|fonts\.googleapis|fonts\.gstatic/.test(u)) return r.continue();
        if (u.includes('firestore.googleapis.com') && u.includes('/tableros/')) {
          const staleDoc = {
            name: 'projects/nexo-qa-inexistente/databases/(default)/documents/tableros/doc',
            fields: Object.fromEntries(Object.entries(docFields).map(([k, v]) => [k, pack(v)])),
            updateTime: '2026-10-28T00:00:01.000000Z'
          };
          // Tanto GET como PATCH devuelven doc viejo sin reflejar el cambio enviado
          return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(staleDoc) });
        }
        return r.abort();
      });
      await setAgencySessionInit(page);
      await page.addInitScript(() => sessionStorage.setItem('nexo_agency_free_edit', '1'));
      await page.goto('file://' + filePath, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1200);

      // Verificar sin desborde horizontal en móvil 390px con Edición libre ON
      const noOverflowMobile = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
      assert.strictEqual(noOverflowMobile, true, 'No debe haber overflow horizontal en móvil 390px con Edición libre ON');

      const card1 = page.locator('article.card').first();
      await card1.locator('.guion p.p-guion').click();
      await page.keyboard.type(' texto que el servidor ignora');
      await card1.locator('.btn-agency-save').click();
      await page.waitForTimeout(1200);

      const toastTxt = await page.evaluate(() => (document.getElementById('toast') || {}).textContent || '');
      const modalTxt = await page.evaluate(() => {
        const m = document.getElementById('modal');
        return m && m.classList.contains('show') ? m.innerText : '';
      });
      assert(!toastTxt.includes('✓'), 'No debe mostrar toast de éxito si savedDoc no coincide');
      assert(modalTxt.includes('No se guardó en la nube'), 'Debe mostrar modal de error si savedDoc no coincide');
      assert.strictEqual(await page.evaluate(() => document.querySelector('article.card').__cObj.editando), true, 'cObj.editando debe mantenerse true si falla verificación');
      console.log('✓ d) Verificación de savedDoc detecta discrepancia, muestra modal de error y conserva edición');

      await ctx.close();
    }

    console.log('--- TODAS LAS PRUEBAS DE FASE 6 PASARON CON ÉXITO ---');
  } finally {
    await browser.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
})();

