#!/usr/bin/env python3
"""Pruebas unitarias para Fase 4: Producción (plantilla, script y reglas)"""

import os
import sys
import re
import json
import unittest

AQUI = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(AQUI))

class TestFase4(unittest.TestCase):
    def test_firestore_rules_produccion_y_tableros(self):
        rules_path = os.path.join(REPO, 'firestore.rules')
        with open(rules_path, 'r', encoding='utf-8') as f:
            rules_content = f.read()

        # Tableros: delete bloqueado
        self.assertIn('match /tableros/{tableroId}', rules_content)
        # Debe contener allow delete: if false; en tableros
        match_tableros = re.search(r'match /tableros/\{tableroId\}[\s\S]*?allow delete:\s*if\s*false;', rules_content)
        self.assertIsNotNone(match_tableros, "tableros debe tener 'allow delete: if false;'")

        # Producción: eliminadas en create y update
        match_prod = re.search(r'match /produccion/\{prodId\}[\s\S]*?affectedKeys\(\)\.hasOnly\(\[([\s\S]*?)\]\)', rules_content)
        self.assertIsNotNone(match_prod, "produccion debe tener affectedKeys().hasOnly")
        self.assertIn("'eliminadas'", match_prod.group(1))

    def test_plantilla_produccion_sincronizacion_y_estados(self):
        plantilla_path = os.path.join(REPO, '_sistema', 'plantilla-produccion.html')
        with open(plantilla_path, 'r', encoding='utf-8') as f:
            content = f.read()

        # 1. onSnapshot con includeMetadataChanges: true
        self.assertIn('includeMetadataChanges: true', content)

        # 2. Indicadores
        self.assertIn('Sin conexión · guardado en este teléfono', content)
        self.assertIn('Sincronizando…', content)
        self.assertIn('En vivo', content)
        self.assertIn('.live-status.syncing', content)
        self.assertIn('.live-status.offline', content)

        # 3. Sincronización atómica por tarjeta
        self.assertIn("['tarjetas.' + cardId]", content)
        self.assertIn("function syncCardToFirestore", content)
        self.assertIn("function syncOrderToFirestore", content)
        self.assertIn("function recalcularContadoresRemotos", content)

        # 4. Eliminadas con arrayUnion
        self.assertIn("firebase.firestore.FieldValue.arrayUnion(cardId)", content)
        self.assertIn("eliminadasSet", content)
        self.assertIn("!eliminadasSet.has", content)

    def test_registrar_produccion_no_reinicia(self):
        script_path = os.path.join(REPO, '_sistema', 'registrar_produccion.py')
        with open(script_path, 'r', encoding='utf-8') as f:
            script_content = f.read()

        # Verifica que haga GET antes de decidir
        self.assertIn("method='GET'", script_content)
        # Maneja doc_existente
        self.assertIn("if doc_existente:", script_content)
        # Usa updateMask para tarjetas nuevas y orden
        self.assertIn("updateMask.fieldPaths", script_content)
        self.assertIn("tarjetas.{cid}", script_content)
        self.assertIn("tarjetas_nuevas", script_content)

if __name__ == '__main__':
    unittest.main()
