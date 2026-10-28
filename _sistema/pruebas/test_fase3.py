#!/usr/bin/env python3
"""Pruebas unitarias para Fase 3: preparar_clickup.py"""

import os
import sys
import json
import tempfile
import unittest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
from preparar_clickup import procesar, formatear_fecha_legible

class TestFase3(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()

    def tearDown(self):
        self.temp_dir.cleanup()

    def test_formatear_fecha_legible(self):
        self.assertEqual(formatear_fecha_legible('2026-10-28T04:44:48.917Z'), '28/10/2026')
        self.assertEqual(formatear_fecha_legible('2026-11-05'), '05/11/2026')
        self.assertEqual(formatear_fecha_legible(''), '')

    def test_doc_firestore_distinto_tablero_bloquea(self):
        borrador = {
            'id': 'tablero_noviembre_2026',
            'cliente': 'Cliente Prueba',
            'mes': 'Noviembre',
            'anio': 2026,
            'contenidos': [{'id': 'c1', 'titulo': 'Pieza 1', 'formato': 'Reel', 'guion': 'G', 'copy': 'C'}]
        }
        b_path = os.path.join(self.temp_dir.name, 'borrador.json')
        with open(b_path, 'w', encoding='utf-8') as f:
            json.dump(borrador, f)

        # Firestore con ID de otro mes
        fs_data = {
            'id': 'tablero_octubre_2026',
            'estado': 'Aprobado',
            'revisadoPor': 'Carlos',
            'contenidos': [{'id': 'c1', 'estado': 'aprobado', 'guion': 'G', 'copy': 'C'}]
        }
        fs_path = os.path.join(self.temp_dir.name, 'fs.json')
        with open(fs_path, 'w', encoding='utf-8') as f:
            json.dump(fs_data, f)

        out_path, listo = procesar(b_path, fs_path)
        self.assertFalse(listo)
        with open(out_path, 'r', encoding='utf-8') as f:
            res = json.load(f)
        self.assertIn("El documento de Firestore no corresponde a este tablero", res['bloqueantes'])

    def test_tablero_ya_sincronizado_bloquea(self):
        borrador = {
            'id': 'tablero_noviembre_2026',
            'cliente': 'Cliente Prueba',
            'mes': 'Noviembre',
            'anio': 2026,
            'sincronizadoClickup': '2026-10-28T04:44:48.917Z',
            'contenidos': [{'id': 'c1', 'titulo': 'Pieza 1', 'formato': 'Reel', 'guion': 'G', 'copy': 'C'}]
        }
        b_path = os.path.join(self.temp_dir.name, 'borrador.json')
        with open(b_path, 'w', encoding='utf-8') as f:
            json.dump(borrador, f)

        fs_data = {
            'id': 'tablero_noviembre_2026',
            'estado': 'Aprobado',
            'revisadoPor': 'Carlos',
            'contenidos': [{'id': 'c1', 'estado': 'aprobado', 'guion': 'G', 'copy': 'C'}]
        }
        fs_path = os.path.join(self.temp_dir.name, 'fs.json')
        with open(fs_path, 'w', encoding='utf-8') as f:
            json.dump(fs_data, f)

        out_path, listo = procesar(b_path, fs_path)
        self.assertFalse(listo)
        with open(out_path, 'r', encoding='utf-8') as f:
            res = json.load(f)
        bloqueantes_str = " ".join([str(b) for b in res['bloqueantes']])
        self.assertIn("Este tablero ya se sincronizó el 28/10/2026", bloqueantes_str)

    def test_comentarios_clasificacion_y_accion_clickup(self):
        borrador = {
            'id': 'tablero_noviembre_2026',
            'cliente': 'Cliente Prueba',
            'mes': 'Noviembre',
            'anio': 2026,
            'contenidos': [
                {
                    'id': 'c1',
                    'clickupId': 'task-123',
                    'titulo': 'Pieza 1',
                    'formato': 'Reel',
                    'guion': 'Guion original borrador',
                    'copy': 'Copy original borrador'
                },
                {
                    'id': 'c2',
                    'titulo': 'Pieza 2',
                    'formato': 'Carrusel',
                    'guion': 'Guion 2',
                    'copy': 'Copy 2'
                }
            ]
        }
        b_path = os.path.join(self.temp_dir.name, 'borrador.json')
        with open(b_path, 'w', encoding='utf-8') as f:
            json.dump(borrador, f)

        fs_data = {
            'id': 'tablero_noviembre_2026',
            'estado': 'Aprobado',
            'revisadoPor': 'Carlos',
            'contenidos': [
                {
                    'id': 'c1',
                    'estado': 'aprobado',
                    'version': 2,
                    'fechaAprobacion': '2026-10-28T05:00:00.000Z',
                    'fechaCorreccion': '2026-10-28T04:30:00.000Z',
                    'guion': 'Escena 1:Eduardo dice hola',
                    'copy': 'Texto copy corregido',
                    'comentarios': [
                        {
                            'usuario': 'Carlos',
                            'fecha': '2026-10-28T04:00:00.000Z',
                            'texto': 'Cambiar el gancho inicial',
                            'version': 1
                        },
                        {
                            'usuario': 'Carlos',
                            'fecha': '2026-10-28T04:45:00.000Z',
                            'texto': '¡Excelente corrección!',
                            'version': 2
                        }
                    ]
                },
                {
                    'id': 'c2',
                    'estado': 'aprobado',
                    'version': 1,
                    'fechaAprobacion': '2026-10-28T05:00:00.000Z',
                    'guion': 'Guion 2',
                    'copy': 'Copy 2',
                    'comentarios': [
                        {
                            'usuario': 'Carlos',
                            'texto': 'Aprobado de una vez',
                            'version': 1
                        }
                    ]
                }
            ]
        }
        fs_path = os.path.join(self.temp_dir.name, 'fs.json')
        with open(fs_path, 'w', encoding='utf-8') as f:
            json.dump(fs_data, f)

        out_path, listo = procesar(b_path, fs_path)
        self.assertTrue(listo)
        with open(out_path, 'r', encoding='utf-8') as f:
            res = json.load(f)

        c1 = res['contenidos'][0]
        # c1 tiene clickupId -> accionClickup: actualizar
        self.assertEqual(c1['accionClickup'], 'actualizar')
        # Comentario v1 debe estar en historialObservaciones, NO en comentariosAprobacion
        self.assertEqual(len(c1['historialObservaciones']), 1)
        self.assertEqual(c1['historialObservaciones'][0]['texto'], 'Cambiar el gancho inicial')
        self.assertEqual(len(c1['comentariosAprobacion']), 1)
        self.assertEqual(c1['comentariosAprobacion'][0]['texto'], '¡Excelente corrección!')

        # Verificación de descripción con fecha legible
        self.assertIn('28/10/2026', c1['descripcionClickup'])
        self.assertNotIn('2026-10-28T05:00:00', c1['descripcionClickup'])

        # Alertas de c1:
        # Guion difiere de borrador con version > 1 -> "Corregido en Modo Agencia (v2)"
        self.assertIn('Corregido en Modo Agencia (v2)', c1['alertas'])
        # "Escena 1:Eduardo" -> alerta "falta un espacio después de ':'" y NO frases pegadas
        self.assertIn("falta un espacio después de ':'", c1['alertas'])
        self.assertNotIn('Parece haber frases pegadas sin salto de línea en el guion.', c1['alertas'])

        c2 = res['contenidos'][1]
        # c2 no tiene clickupId -> accionClickup: crear
        self.assertEqual(c2['accionClickup'], 'crear')
        self.assertEqual(len(c2['comentariosAprobacion']), 1)
        self.assertEqual(c2['comentariosAprobacion'][0]['texto'], 'Aprobado de una vez')
        self.assertEqual(len(c2['historialObservaciones']), 0)

if __name__ == '__main__':
    unittest.main()
