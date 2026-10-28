// Pruebas unitarias para Fase 5: Banco de trabajo (index.html) y snippet de informes
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const REPO = path.resolve(__dirname, '../..');
const indexHtml = fs.readFileSync(path.join(REPO, 'index.html'), 'utf8');

// 1. btn-open-merge-client no debe existir
assert.strictEqual(indexHtml.includes('btn-open-merge-client'), false, 'btn-open-merge-client debe ser eliminado');

// 2. delete() no debe llamarse sobre tableros
assert.strictEqual(
  /db\.collection\(['"]tableros['"]\)\.doc\([^)]+\)\.delete\(/.test(indexHtml),
  false,
  'No debe haber llamadas a delete() sobre la coleccion tableros'
);

// 3. EMBEDDED_BOARDS_DATA debe estar vacío
const matchEmb = indexHtml.match(/var EMBEDDED_BOARDS_DATA = (\{[\s\S]*?\});/);
assert.ok(matchEmb, 'EMBEDDED_BOARDS_DATA debe existir');
const embData = JSON.parse(matchEmb[1]);
assert.deepStrictEqual(embData, {}, 'EMBEDDED_BOARDS_DATA debe ser {}');

// Ningún nombre de cliente en index.html
const clientRegex = /milkarf|trina|bambu|moffyns|burger|pachamama/i;
assert.strictEqual(clientRegex.test(indexHtml), false, 'index.html no debe contener nombres de clientes');

// 4. calcularResumen y esSinEvaluar
assert.ok(indexHtml.includes('function esSinEvaluar('), 'Debe existir esSinEvaluar');
assert.ok(indexHtml.includes('function calcularResumen('), 'Debe existir calcularResumen');

// 5. Pautas de produccion con archivado: true
assert.ok(indexHtml.includes('archivado: true'), 'Debe marcar archivado: true en produccion');
assert.ok(indexHtml.includes('if (!d.archivado) docs.push(d);'), 'Debe ocultar pautas archivadas');

// 6. Snippet de informes
const snippetHtml = fs.readFileSync(path.join(REPO, '_sistema', 'snippet-registro-informe.html'), 'utf8');
assert.ok(snippetHtml.includes('fetch(baseDocUrl'), 'Snippet debe hacer fetch GET inicial');
assert.ok(snippetHtml.includes('res.status === 404'), 'Snippet debe verificar 404 antes de POST');

console.log('✓ Todas las verificaciones de Fase 5 pasaron con éxito.');
