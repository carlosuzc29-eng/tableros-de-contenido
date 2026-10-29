#!/usr/bin/env python3
"""
NEXO · Migración de Tableros a v2 (diseño separado + selector de meses).

Lee todos los borradores en borradores/*.json (ignorando .clickup.json y .firestore.json)
que tengan 'archivo' e 'id', y genera para cada cliente:
  - datos/<codigo>/<aaaa-mm>.json (con exclusiones de campos internos)
  - datos/<codigo>/indice.json
  - <archivo>.html (cáscara liviana pre-renderizada con Chrome headless)
No modifica Firestore ni los IDs existentes.
"""
import os
import sys
import glob
import json
import re
import secrets
import unicodedata
import subprocess
import shutil

AQUI = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(AQUI)
BORRADORES_DIR = os.path.join(REPO, 'borradores')
DATOS_DIR = os.path.join(REPO, 'datos')
PLANTILLA = os.path.join(AQUI, 'plantilla-tablero.html')

MESES_NUM = {
    'enero': '01', 'febrero': '02', 'marzo': '03', 'abril': '04',
    'mayo': '05', 'junio': '06', 'julio': '07', 'agosto': '08',
    'septiembre': '09', 'octubre': '10', 'noviembre': '11', 'diciembre': '12'
}

def slug(s):
    s = unicodedata.normalize('NFD', str(s)).encode('ascii', 'ignore').decode()
    return re.sub(r'[^a-z0-9]+', '-', s.lower()).strip('-')

def obtener_mes_key(mes_str, anio_val):
    s_mes = slug(mes_str).lower()
    num = MESES_NUM.get(s_mes, '10')
    anio = str(anio_val or '2026')
    return f"{anio}-{num}"

def chrome():
    for c in [os.environ.get('CHROME', ''), '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
              '/Applications/Chromium.app/Contents/MacOS/Chromium', shutil.which('google-chrome') or '', shutil.which('chromium') or '']:
        if c and os.path.exists(c): return c
    return None

def filtrar_datos_publicos(data):
    """Excluye campos internos del JSON publicado y del respaldo de la cáscara."""
    claves_excluir_raiz = {'archivo', 'clickupId', 'tipoOriginal', 'sincronizadoClickup', 'huellasClickup', 'tableroProduccion'}
    datos = json.loads(json.dumps({k: v for k, v in data.items() if k not in claves_excluir_raiz}))
    for c in datos.get('contenidos', []):
        if isinstance(c, dict):
            for k in ('_sync', 'clickupId', 'tipoOriginal'):
                c.pop(k, None)
    return datos

def prerenderizar_html(html_str, n_piezas):
    chrome_bin = chrome()
    if not chrome_bin:
        print('  ℹ Google Chrome no detectado: usando plantilla base.')
        return html_str
    tmp_path = os.path.join(REPO, f".tmp_prerender_{secrets.token_hex(4)}.html")
    with open(tmp_path, 'w', encoding='utf-8') as f:
        f.write(html_str)
    extra = ['--no-sandbox'] if os.environ.get('NEXO_NOSANDBOX') else []
    try:
        res = subprocess.run([chrome_bin, *extra, '--headless=new', '--disable-gpu', '--no-first-run',
                              '--allow-file-access-from-files', '--virtual-time-budget=5000',
                              '--dump-dom', 'file://' + tmp_path], capture_output=True, text=True, timeout=120)
        out = res.stdout
        if 'class="js"' in out[:400]:
            out = '<!DOCTYPE html>\n' + re.sub(r'^\s*<!DOCTYPE html>\s*', '', out, flags=re.I).replace('class="js"', 'class="no-js"', 1)
            tarjetas = len(re.findall(r'<article class="card', out))
            if tarjetas == n_piezas:
                print(f'  ✓ Pre-renderizado con Google Chrome exitoso ({tarjetas} tarjetas)')
                return out
            else:
                print(f'  ⚠️ Discrepancia de tarjetas en Chrome ({tarjetas}/{n_piezas}), usando plantilla base.')
        else:
            print('  ⚠️ Chrome headless no devolvió el DOM esperado, usando plantilla base.')
    except Exception as e:
        print(f'  ⚠️ Fallo en Chrome headless ({e}), usando plantilla base.')
    finally:
        if os.path.exists(tmp_path):
            os.unlink(tmp_path)
    return html_str

def main():
    print("=== INICIANDO MIGRACIÓN A TABLEROS V2 ===")
    plantilla_html = open(PLANTILLA, 'r', encoding='utf-8').read()

    # Buscar borradores válidos
    archivos_json = sorted(glob.glob(os.path.join(BORRADORES_DIR, '*.json')))
    clientes_meses = {}

    for ruta in archivos_json:
        nom = os.path.basename(ruta)
        if nom.endswith('.clickup.json') or nom.endswith('.firestore.json'):
            continue
        try:
            d = json.load(open(ruta, 'r', encoding='utf-8'))
        except Exception as e:
            print(f"Error al leer {nom}: {e}")
            continue

        if not d.get('archivo') or not d.get('id'):
            print(f"Ignorando {nom}: falta 'archivo' o 'id'")
            continue

        codigo = os.path.splitext(d['archivo'])[0]
        mes_key = obtener_mes_key(d.get('mes'), d.get('anio'))
        clientes_meses.setdefault(codigo, []).append((mes_key, d, ruta))

    print(f"Clientes detectados para migración: {len(clientes_meses)}")

    for codigo, meses_lista in clientes_meses.items():
        print(f"\nProcesando cliente '{codigo}' ({len(meses_lista)} meses)...")
        dir_cliente = os.path.join(DATOS_DIR, codigo)
        os.makedirs(dir_cliente, exist_ok=True)

        meses_lista.sort(key=lambda x: x[0], reverse=True)
        mes_actual_key, mes_actual_data, _ = meses_lista[0]

        entradas_indice = []
        for mes_key, data, ruta in meses_lista:
            # 1. Guardar datos/<codigo>/<aaaa-mm>.json
            datos_pub = filtrar_datos_publicos(data)
            ruta_mes = os.path.join(dir_cliente, f"{mes_key}.json")
            with open(ruta_mes, 'w', encoding='utf-8') as f:
                json.dump(datos_pub, f, ensure_ascii=False, indent=2)
            print(f"  ✓ Generado datos/{codigo}/{mes_key}.json ({len(data.get('contenidos', []))} piezas)")

            etiqueta = f"{str(data.get('mes', '')).capitalize()} {data.get('anio', '')}".strip()
            entradas_indice.append({
                "mes": mes_key,
                "etiqueta": etiqueta,
                "id": data.get('id')
            })

        # 2. Guardar datos/<codigo>/indice.json
        indice_obj = {
            "cliente": mes_actual_data.get('cliente', ''),
            "cuenta": str(mes_actual_data.get('cuenta', '')).replace('@', ''),
            "actual": mes_actual_key,
            "meses": entradas_indice
        }
        ruta_indice = os.path.join(dir_cliente, "indice.json")
        with open(ruta_indice, 'w', encoding='utf-8') as f:
            json.dump(indice_obj, f, ensure_ascii=False, indent=2)
        print(f"  ✓ Generado datos/{codigo}/indice.json (actual: {mes_actual_key})")

        # 3. Regenerar cáscara <archivo>.html
        datos_actual_pub = filtrar_datos_publicos(mes_actual_data)
        html_cascara = plantilla_html.replace('__CODIGO_CLIENTE__', codigo)
        html_cascara = html_cascara.replace('__DATA__', json.dumps(datos_actual_pub, ensure_ascii=False, indent=2).replace('</', '<\\/'))

        n_piezas = len(mes_actual_data.get('contenidos', []))
        html_final = prerenderizar_html(html_cascara, n_piezas)

        ruta_html = os.path.join(REPO, mes_actual_data['archivo'])
        with open(ruta_html, 'w', encoding='utf-8') as f:
            f.write(html_final)
        print(f"  ✓ Cáscara regenerada: {mes_actual_data['archivo']}")

    print("\n=== MIGRACIÓN A V2 COMPLETADA EXITOSAMENTE ===")

if __name__ == '__main__':
    main()
