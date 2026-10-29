#!/usr/bin/env python3
import json
import os
import shutil
import subprocess
import tempfile
import unittest

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
VALIDAR_SCRIPT = os.path.join(REPO, '_sistema/validar_tablero.py')
CONSTRUIR_SCRIPT = os.path.join(REPO, '_sistema/construir.py')

class TestFase2(unittest.TestCase):
    def setUp(self):
        self.tmp_dir = tempfile.mkdtemp(prefix='nexo-test-fase2-')
        # Repositorio y configuración aislados: la prueba nunca escribe en el repo real ni en Firestore
        self.repo_tmp = os.path.join(self.tmp_dir, 'repo')
        shutil.copytree(os.path.join(REPO, '_sistema'), os.path.join(self.repo_tmp, '_sistema'),
                        ignore=shutil.ignore_patterns('node_modules'))
        self.config_tmp = os.path.join(self.tmp_dir, 'nexo-config.json')
        with open(self.config_tmp, 'w', encoding='utf-8') as f:
            json.dump({'firebase': {'apiKey': 'fake-qa-api-key', 'projectId': 'nexo-qa-inexistente'},
                       'base_url': 'https://test.nexo.ejemplo/', 'sinFirestore': True}, f)
        self.env = dict(os.environ, NEXO_REPO=self.repo_tmp, NEXO_CONFIG=self.config_tmp)

    def tearDown(self):
        shutil.rmtree(self.tmp_dir, ignore_errors=True)

    def test_copiado_mes_anterior_limpia_datos(self):
        # Crear borrador que simula haber sido copiado de octubre para diciembre
        json_copiado = {
            "cliente": "Moffyns",
            "mes": "Diciembre",
            "anio": 2026,
            "id": "moffyns-2026-octubre-a873",
            "token": "a873",
            "sincronizadoClickup": "2026-10-06T15:00:00Z",
            "huellasClickup": {"c1": "abc12345"},
            "tableroProduccion": "moffyns-prod-old",
            "resetAt": 123456789,
            "contenidos": [
                {
                    "id": "c1",
                    "titulo": "Pieza uno",
                    "formato": "Reel",
                    "guion": "Guion uno",
                    "copy": "Copy uno",
                    "clickupId": "86ajwpj7e",
                    "version": 2,
                    "aprobacion": {"version": 1, "usuario": "Cliente"},
                    "versiones": {"v1": {"guion": "old"}},
                    "historial": [{"version": 1, "accion": "creado"}],
                    "fechaCorreccion": "2026-10-01",
                    "fechaEnvio": "2026-10-01",
                    "fechaAprobacion": "2026-10-02",
                    "estado_aprobacion": "aprobado",
                    "borrador": {"guion": "draft"},
                    "_sync": {"guion": "hash1", "copy": "hash2", "version": 2}
                },
                {
                    "id": "c2",
                    "titulo": "Pieza dos",
                    "formato": "Post",
                    "guion": "Guion dos",
                    "copy": "Copy dos",
                    "clickupId": "86ajwpj7f",
                    "version": 3,
                    "tipoOriginal": "Reel"
                }
            ]
        }
        json_path = os.path.join(self.tmp_dir, "moffyns-diciembre-2026.json")
        with open(json_path, 'w', encoding='utf-8') as f:
            json.dump(json_copiado, f, ensure_ascii=False, indent=2)

        # Ejecutar construir.py (sin --publicar ni red real)
        proc = subprocess.run([
            'python3', CONSTRUIR_SCRIPT, json_path, '--nuevo-enlace'
        ], capture_output=True, text=True, env=self.env)

        out = proc.stdout + proc.stderr
        # 1. Comprobar mensaje de limpieza
        self.assertIn("JSON copiado de octubre: se limpiaron 2 clickupId y la sincronización anterior", out)

        # 2. Comprobar JSON actualizado
        with open(json_path, 'r', encoding='utf-8') as f:
            data_guardada = json.load(f)

        for k in ('sincronizadoClickup', 'huellasClickup', 'tableroProduccion'):
            self.assertNotIn(k, data_guardada, f"{k} debe haber sido eliminado del JSON del nuevo mes")

        for c in data_guardada['contenidos']:
            for k in ('clickupId', 'aprobacion', 'versiones', 'historial', 'fechaCorreccion',
                      'fechaEnvio', 'fechaAprobacion', 'estado_aprobacion', 'borrador'):
                self.assertNotIn(k, c, f"Campo {k} debe haber sido eliminado del contenido")
            self.assertEqual(c.get('version', 1), 1, "La versión debe ser 1 en mes nuevo")

        # 3. Comprobar que en el HTML generado no existan clickupId, tipoOriginal, sincronizadoClickup, huellasClickup, tableroProduccion
        archivo_html = data_guardada['archivo']
        html_path = os.path.join(self.repo_tmp, archivo_html)
        if os.path.exists(html_path):
            try:
                with open(html_path, 'r', encoding='utf-8') as hf:
                    html_content = hf.read()
                # Extraer JSON de board-data
                import re
                m = re.search(r'<script id="board-data"[^>]*>(.*?)</script>', html_content, re.DOTALL)
                self.assertIsNotNone(m, "El HTML debe tener script #board-data")
                board_json = json.loads(m.group(1))
                for k in ('clickupId', 'tipoOriginal', 'sincronizadoClickup', 'huellasClickup', 'tableroProduccion'):
                    self.assertNotIn(k, board_json, f"{k} no debe estar a nivel tablero en HTML")
                for c in board_json.get('contenidos', []):
                    self.assertNotIn('clickupId', c, "clickupId no debe estar en contenidos del HTML")
                    self.assertNotIn('tipoOriginal', c, "tipoOriginal no debe estar en contenidos del HTML")
            finally:
                os.remove(html_path)

        # 4. Comprobar mensaje de WhatsApp
        self.assertIn("Te compartimos la parrilla de contenidos de Diciembre", out)
        self.assertIn("— Equipo Nexo Agencia Creativa", out)

    def test_validar_tablero_avisos_clickup(self):
        # Dos contenidos con el mismo clickupId y mes de JSON distinto a sincronizadoClickup
        data = {
            "cliente": "Moffyns",
            "mes": "Diciembre",
            "anio": 2026,
            "sincronizadoClickup": "2026-10-06T15:00:00Z",
            "contenidos": [
                {
                    "id": "c1",
                    "titulo": "Pieza uno",
                    "formato": "Reel",
                    "clickupId": "86ajwpj7e"
                },
                {
                    "id": "c2",
                    "titulo": "Pieza dos",
                    "formato": "Post",
                    "clickupId": "86ajwpj7e"
                }
            ]
        }
        json_path = os.path.join(self.tmp_dir, "test_validar.json")
        with open(json_path, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)

        proc = subprocess.run([
            'python3', VALIDAR_SCRIPT, json_path
        ], capture_output=True, text=True)

        out = proc.stdout + proc.stderr
        # Debe pasar la validación (aviso sin bloquear)
        self.assertEqual(proc.returncode, 0)
        self.assertIn("mismo clickupId ('86ajwpj7e')", out)
        self.assertIn("es distinto del mes de su sincronizadoClickup", out)

if __name__ == '__main__':
    unittest.main()
