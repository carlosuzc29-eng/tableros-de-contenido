// Pruebas automáticas Fase 7: edición de la fecha de publicación sin errores
//  a) Fecha imposible o mal escrita: no se guarda y el campo queda marcado
//  b) Fecha válida en otro formato (5-11): se guarda como 05/11 sin cambiar estado ni versión
//  c) Quitar la fecha: se guarda vacía y la etiqueta 📅 desaparece
//  d) "Aprobar versión" con una fecha sin guardar: la guarda y luego aprueba
//  e) Firestore con las piezas en otro orden: cada tarjeta recibe SU fecha (búsqueda por id)
//  f) Python: validador y construir.py (fecha vacía de Firestore y búsqueda por id)
const path = require('path');
const fs = require('fs');
const os = require('os');
const assert = require('assert');
const { execFileSync } = require('child_process');
const { Stub } = require('./fsstub');

let chromium;
try {
  chromium = require('playwright').chromium;
} catch (e) {
  chromium = require(path.join(__dirname, 'node_modules', 'playwright')).chromium;
}

const REPO = path.resolve(__dirname, '../..');
const PLANTILLA = path.join(REPO, '_sistema/plantilla-tablero.html');

function buildTestHtml(tmpDir) {
  const linkSistema = path.join(tmpDir, '_sistema');
  if (!fs.existsSync(linkSistema)) fs.symlinkSync(path.join(REPO, '_sistema'), linkSistema);

  const tpl = fs.readFileSync(PLANTILLA, 'utf8');
  const items = Array.from({ length: 3 }, (_, i) => ({
    n: i + 1,
    id: 'c' + (i + 1),
    titulo: 'Pieza ' + (i + 1),
    formato: 'Reel',
    canal: 'Orgánico',
    fechaPublicacion: '1' + (i + 1) + '/11',
    guion: 'Guion ' + (i + 1),
    copy: 'Copy ' + (i + 1),
    hashtags: '#nexo',
    estado: i === 0 ? 'cambios' : 'en_revision',
    comentario: i === 0 ? '[Cliente]: Cambiar la fecha' : '',
    version: 1
  }));

  const data = {
    cliente: 'Cliente QA Fechas',
    cuenta: 'clienteqa',
    mes: 'Noviembre',
    anio: 2026,
    id: 'cliente-qa-fechas-2026-noviembre-fe7a11',
    url: 'https://carlosuzc29-eng.github.io/tableros-de-contenido/qa-fechas.html',
    firebase: { apiKey: 'AIzaFakeKeyForQATesting123456789', projectId: 'nexo-qa-inexistente' },
    revision: { revisadoPor: 'Cliente QA', fecha: '2026-10-28T12:00:00.000Z' },
    contenidos: items
  };

  const html = tpl
    .replace('__CODIGO_CLIENTE__', 'qa-fechas-fe7a11')
    .replace('__DATA__', JSON.stringify(data, null, 2).replace(/</g, '\\u003c'));
  const filePath = path.join(tmpDir, 'tablero-fase7.html');
  fs.writeFileSync(filePath, html, 'utf8');

  const docFields = {
    id: data.id, cliente: data.cliente, mes: data.mes, anio: String(data.anio),
    total: items.length, aprobados: 0, cambios: 1, pendientes: 2, estado: 'Con cambios',
    revisadoPor: 'Cliente QA', ultimaRevision: '2026-10-28T12:00:00.000Z',
    contenidos: JSON.parse(JSON.stringify(items))
  };
  return { filePath, docFields };
}

function setAgencySessionInit(page) {
  return page.addInitScript(() => {
    sessionStorage.setItem('nexo_agency_session', JSON.stringify({
      email: 'carlosuzc29@gmail.com', idToken: 'fake-agency-jwt', refreshToken: 'fake-refresh', expiresAt: Date.now() + 3600e3
    }));
  });
}

async function abrir(browser, tmpDir, mutarDoc) {
  const { filePath, docFields } = buildTestHtml(tmpDir);
  if (mutarDoc) mutarDoc(docFields);
  const stub = new Stub(docFields);
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const errores = [];
  page.on('pageerror', e => errores.push(String(e)));
  await stub.attach(page);
  await setAgencySessionInit(page);
  await page.goto('file://' + filePath, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1400);
  return { stub, ctx, page, errores };
}

const patches = stub => stub.log.filter(x => x.body).length;

(async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexo-fase7-'));
  const browser = await chromium.launch({
    channel: 'chrome', headless: true,
    args: ['--allow-file-access-from-files', '--disable-web-security']
  });

  try {
    console.log('--- INICIO PRUEBAS FASE 7 (FECHA DE PUBLICACIÓN) ---');

    // a, b, c) Validación, normalización y borrado de la fecha
    {
      const { stub, ctx, page, errores } = await abrir(browser, tmpDir);
      const card1 = page.locator('article.card').first();
      const fecha = card1.locator('.agency-fecha-inp');
      assert.strictEqual(await fecha.isVisible(), true, 'El campo de fecha debe verse en modo Administrador');

      for (const mala of ['31/11', '30/02', '13/13', 'mañana', '5 de nov']) {
        const antes = patches(stub);
        await fecha.fill(mala);
        await card1.locator('.btn-agency-save').click();
        await page.waitForTimeout(350);
        assert.strictEqual(patches(stub), antes, `La fecha "${mala}" no debe guardarse`);
        assert.ok(await fecha.evaluate(n => n.classList.contains('err')), `La fecha "${mala}" debe marcar el campo en error`);
      }
      console.log('✓ a) Fechas imposibles o mal escritas no se guardan y el campo queda marcado');

      await fecha.fill('5-11');
      assert.ok(!(await fecha.evaluate(n => n.classList.contains('err'))), 'Al escribir de nuevo se quita la marca de error');
      await card1.locator('.btn-agency-save').click();
      await page.waitForTimeout(1500);
      let p1 = stub.fields.contenidos.find(x => x.id === 'c1');
      assert.strictEqual(p1.fechaPublicacion, '05/11', 'La fecha debe guardarse normalizada como 05/11');
      assert.strictEqual(p1.estado, 'cambios', 'Cambiar solo la fecha no debe cambiar el estado');
      assert.strictEqual(p1.version, 1, 'Cambiar solo la fecha no debe subir la versión');
      assert.strictEqual(await fecha.inputValue(), '05/11', 'El campo debe mostrar la fecha normalizada');
      assert.ok((await card1.locator('.tag.date').textContent()).includes('05/11'), 'La etiqueta 📅 debe mostrar 05/11');
      const otras = stub.fields.contenidos.filter(x => x.id !== 'c1').map(x => x.fechaPublicacion);
      assert.deepStrictEqual(otras, ['12/11', '13/11'], 'Las demás piezas no deben cambiar de fecha');
      console.log('✓ b) "5-11" se guarda como 05/11 sin tocar estado, versión ni otras piezas');

      await fecha.fill('');
      await card1.locator('.btn-agency-save').click();
      await page.waitForTimeout(1500);
      p1 = stub.fields.contenidos.find(x => x.id === 'c1');
      assert.strictEqual(p1.fechaPublicacion, '', 'Quitar la fecha debe guardarse vacía');
      assert.strictEqual(await card1.locator('.tag.date').isVisible(), false, 'Sin fecha la etiqueta 📅 debe ocultarse');
      console.log('✓ c) Quitar la fecha se guarda vacía y oculta la etiqueta');

      assert.deepStrictEqual(errores, [], 'No debe haber errores de JavaScript: ' + errores.join(' | '));
      await ctx.close();
    }

    // d) Aprobar con una fecha sin guardar
    {
      const { stub, ctx, page, errores } = await abrir(browser, tmpDir);
      const card2 = page.locator('article.card').nth(1);
      await card2.locator('.agency-fecha-inp').fill('20/11');
      await card2.locator('.btn-agency-approve').click();
      await page.waitForTimeout(300);
      assert.ok(await page.locator('#modal.show').isVisible(), 'Debe avisar que hay cambios sin guardar');
      await page.locator('#modal .b-pri').click();
      await page.waitForTimeout(2500);
      const p2 = stub.fields.contenidos.find(x => x.id === 'c2');
      assert.strictEqual(p2.fechaPublicacion, '20/11', 'La fecha debe guardarse antes de aprobar');
      assert.strictEqual(p2.estado, 'aprobado', 'La pieza debe quedar aprobada');
      assert.strictEqual(p2.version, 1, 'Un cambio de fecha no debe subir la versión');
      assert.deepStrictEqual(errores, [], 'No debe haber errores de JavaScript: ' + errores.join(' | '));
      console.log('✓ d) "Aprobar versión" guarda primero la fecha pendiente y luego aprueba');
      await ctx.close();
    }

    // e) Firestore con las piezas en otro orden (n no coincide con la posición del tablero)
    {
      const { ctx, page } = await abrir(browser, tmpDir, doc => {
        doc.contenidos = doc.contenidos.slice().reverse().map((x, i) => Object.assign(x, { n: i + 1 }));
        doc.contenidos.find(x => x.id === 'c1').fechaPublicacion = '01/11';
      });
      const fechas = await page.locator('article.card .agency-fecha-inp').evaluateAll(ns => ns.map(n => n.value));
      const titulos = await page.locator('article.card h2').evaluateAll(ns => ns.map(n => n.textContent.trim()));
      assert.deepStrictEqual(titulos, ['Pieza 1', 'Pieza 2', 'Pieza 3'], 'Cada tarjeta debe conservar su propio título');
      assert.deepStrictEqual(fechas, ['01/11', '12/11', '13/11'], 'Cada tarjeta debe recibir su propia fecha (búsqueda por id)');
      console.log('✓ e) Con Firestore en otro orden, cada tarjeta recibe sus propios datos');
      await ctx.close();
    }

    // f) Python: validador + construir.py
    {
      const py = `
import sys, json, io, urllib.request
sys.path.insert(0, ${JSON.stringify(path.join(REPO, '_sistema'))})
from validar_tablero import normalizar_fecha_publicacion as f
assert f('9/11', 'Noviembre', 2026) == ('09/11', None)
assert f('31/11', 'Noviembre', 2026)[0] is None
assert f('29/02', 'Noviembre', 2026)[0] is None      # febrero 2027
assert f('29/02/2028', 'Noviembre', 2026)[0] == '29/02'
assert f('hoy', 'Noviembre', 2026)[0] is None
import construir
def pk(v):
    if isinstance(v, dict): return {'mapValue': {'fields': {k: pk(x) for k, x in v.items()}}}
    if isinstance(v, list): return {'arrayValue': {'values': [pk(x) for x in v]}}
    if isinstance(v, int): return {'integerValue': str(v)}
    return {'stringValue': str(v)}
fs_cont = [
  {'n': 1, 'id': 'c2', 'titulo': 'B', 'guion': 'gB', 'copy': 'cB', 'estado': 'en_revision', 'fechaPublicacion': '22/11'},
  {'n': 2, 'id': 'c1', 'titulo': 'A', 'guion': 'gA', 'copy': 'cA', 'estado': 'aprobado', 'fechaPublicacion': ''},
]
doc = {'fields': {'contenidos': pk(fs_cont)}}
class R(io.BytesIO):
    def __enter__(self): return self
    def __exit__(self, *a): pass
urllib.request.urlopen = lambda *a, **k: R(json.dumps(doc).encode())
data = {'id': 'qa-fe7a11', 'contenidos': [
  {'id': 'c1', 'titulo': 'A', 'guion': 'gA', 'copy': 'cA', 'fechaPublicacion': '10/11'},
  {'id': 'c2', 'titulo': 'B', 'guion': 'gB', 'copy': 'cB', 'fechaPublicacion': '11/11'},
]}
construir.sincronizar_desde_firestore({'firebase': {}}, data)
c1, c2 = data['contenidos']
assert c1['fechaPublicacion'] == '', c1
assert c1['estado'] == 'aprobado', c1
assert c2['fechaPublicacion'] == '22/11', c2
assert c2['estado'] == 'en_revision', c2
print('ok')
`;
      const out = execFileSync('python3', ['-c', py], { cwd: path.join(REPO, '_sistema'), encoding: 'utf8' });
      assert.ok(out.trim().endsWith('ok'), 'Las comprobaciones de Python deben pasar: ' + out);
      console.log('✓ f) Validador rechaza fechas imposibles y construir.py respeta la fecha de Firestore (también vacía) buscando por id');
    }

    console.log('--- TODAS LAS PRUEBAS DE FASE 7 PASARON CON ÉXITO ---');
  } finally {
    await browser.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
})().catch(err => {
  console.error('✗ FASE 7 FALLÓ:', err && err.message ? err.message : err);
  process.exit(1);
});
