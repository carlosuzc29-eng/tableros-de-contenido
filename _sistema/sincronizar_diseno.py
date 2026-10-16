#!/usr/bin/env python3
"""
NEXO · Sincronizador del Sistema de Diseño v3
Copia el contenido canónico de _sistema/diseno/ dentro de cada plantilla
entre marcadores NEXO-DISENO:INICIO y NEXO-DISENO:FIN.

Uso:
    python3 _sistema/sincronizar_diseno.py          # Aplica sincronización y muestra diff
    python3 _sistema/sincronizar_diseno.py --check  # Modo verificación CI/git (retorna 0 si está al día, 1 si hay discrepancias)
"""

import os
import sys
import re
import difflib

AQUI = os.path.dirname(os.path.abspath(__file__))
DISENO_DIR = os.path.join(AQUI, 'diseno')
REPO_DIR = os.path.dirname(AQUI)

# Archivos destino a sincronizar cuando contengan marcadores
PLANTILLAS = [
    os.path.join(REPO_DIR, 'index.html'),
    os.path.join(AQUI, 'plantilla-tablero.html'),
    os.path.join(AQUI, 'plantilla-produccion.html'),
    os.path.join(AQUI, 'plantilla-informe.html'),
]

# Fuentes disponibles en _sistema/diseno/
FUENTES = {
    'tokens.css': os.path.join(DISENO_DIR, 'tokens.css'),
    'movimiento.css': os.path.join(DISENO_DIR, 'movimiento.css'),
    'componentes.css': os.path.join(DISENO_DIR, 'componentes.css'),
    'iconos.svg': os.path.join(DISENO_DIR, 'iconos.svg'),
    'escenario.js': os.path.join(DISENO_DIR, 'escenario.js'),
}

def leer_fuente(nombre):
    ruta = FUENTES.get(nombre)
    if not ruta or not os.path.exists(ruta):
        return None
    with open(ruta, 'r', encoding='utf-8') as f:
        return f.read().strip()

def sincronizar_texto(contenido_original, ruta_archivo, solo_check=False):
    """
    Busca bloques marcados y los reemplaza con el contenido de _sistema/diseno/.
    Soporta marcadores CSS (/* ... */) y HTML (<!-- ... -->).
    """
    cambios_detectados = []
    nuevo_contenido = contenido_original

    # Patrón CSS: /* NEXO-DISENO:INICIO archivo */ ... /* NEXO-DISENO:FIN */
    patron_css = re.compile(
        r'(/\*\s*NEXO-DISENO:INICIO\s+([a-zA-Z0-9_.-]+)\s*\*/)(.*?)(/\*\s*NEXO-DISENO:FIN(?:\s+[a-zA-Z0-9_.-]+)?\s*\*/)',
        re.DOTALL
    )

    def reemplazo_css(m):
        marcador_ini = m.group(1)
        nombre_archivo = m.group(2).strip()
        marcador_fin = m.group(4)
        cuerpo_actual = m.group(3).strip()

        fuente = leer_fuente(nombre_archivo)
        if fuente is None:
            return m.group(0)

        bloque_nuevo = f"\n{fuente}\n"
        if cuerpo_actual != fuente:
            diff = list(difflib.unified_diff(
                cuerpo_actual.splitlines(keepends=True),
                fuente.splitlines(keepends=True),
                fromfile=f"{os.path.basename(ruta_archivo)}:{nombre_archivo} (actual)",
                tofile=f"_sistema/diseno/{nombre_archivo} (fuente)",
                n=2
            ))
            cambios_detectados.append((nombre_archivo, ''.join(diff[:25])))

        return f"{marcador_ini}{bloque_nuevo}{marcador_fin}"

    nuevo_contenido = patron_css.sub(reemplazo_css, nuevo_contenido)

    # Patrón HTML: <!-- NEXO-DISENO:INICIO archivo --> ... <!-- NEXO-DISENO:FIN -->
    patron_html = re.compile(
        r'(<!--\s*NEXO-DISENO:INICIO\s+([a-zA-Z0-9_.-]+)\s*-->)(.*?)(<!--\s*NEXO-DISENO:FIN(?:\s+[a-zA-Z0-9_.-]+)?\s*-->)',
        re.DOTALL
    )

    def reemplazo_html(m):
        marcador_ini = m.group(1)
        nombre_archivo = m.group(2).strip()
        marcador_fin = m.group(4)
        cuerpo_actual = m.group(3).strip()

        fuente = leer_fuente(nombre_archivo)
        if fuente is None:
            return m.group(0)

        bloque_nuevo = f"\n{fuente}\n"
        if cuerpo_actual != fuente:
            diff = list(difflib.unified_diff(
                cuerpo_actual.splitlines(keepends=True),
                fuente.splitlines(keepends=True),
                fromfile=f"{os.path.basename(ruta_archivo)}:{nombre_archivo} (actual)",
                tofile=f"_sistema/diseno/{nombre_archivo} (fuente)",
                n=2
            ))
            cambios_detectados.append((nombre_archivo, ''.join(diff[:25])))

        return f"{marcador_ini}{bloque_nuevo}{marcador_fin}"

    nuevo_contenido = patron_html.sub(reemplazo_html, nuevo_contenido)

    return nuevo_contenido, cambios_detectados

def main():
    solo_check = '--check' in sys.argv
    hay_discrepancias = False
    archivos_procesados = 0

    print("┌────────────────────────────────────────────────────────┐")
    print("│  NEXO AGENCIA CREATIVA · Sincronizador de Diseño v3    │")
    print("└────────────────────────────────────────────────────────┘\n")

    for ruta in PLANTILLAS:
        if not os.path.exists(ruta):
            continue
        rel = os.path.relpath(ruta, REPO_DIR)
        with open(ruta, 'r', encoding='utf-8') as f:
            original = f.read()

        nuevo, diffs = sincronizar_texto(original, ruta, solo_check=solo_check)
        archivos_procesados += 1

        if diffs:
            hay_discrepancias = True
            print(f"⚠️  {rel}: detectadas {len(diffs)} sección(es) desincronizada(s):")
            for nombre_sec, d in diffs:
                print(f"   - {nombre_sec}")
                if d.strip():
                    print("     " + "\n     ".join(d.strip().splitlines()[:10]))
            if not solo_check:
                with open(ruta, 'w', encoding='utf-8') as f:
                    f.write(nuevo)
                print(f"   ✓ Sincronizado exitosamente en {rel}\n")
        else:
            # Comprobar si tiene marcadores
            tiene_marcadores = ('NEXO-DISENO:INICIO' in original)
            if tiene_marcadores:
                print(f"✓  {rel}: sistema de diseño al día (en sincronía)")
            else:
                print(f"ℹ  {rel}: aún sin marcadores NEXO-DISENO (pendiente de migración)")

    if solo_check and hay_discrepancias:
        print("\n❌ Error: Hay plantillas con el sistema de diseño desincronizado.")
        sys.exit(1)

    print("\n✓ Proceso completado.")
    sys.exit(0)

if __name__ == '__main__':
    main()
