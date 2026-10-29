#!/usr/bin/env python3
"""
NEXO · Módulo de Validación de Esquema y Datos de Tableros.

Valida la estructura, campos requeridos, tipos de datos, seguridad
e integridad de los borradores JSON y tableros HTML antes de publicar.
"""

import json
import re
import sys
import os

MESES_VALIDOS = [
    'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
]

FORMATOS_CANONICOS = {
    'reel': 'Reel',
    'carrusel': 'Carrusel',
    'carrusel con video': 'Carrusel con video',
    'post': 'Post',
    'story': 'Historia',
    'historia': 'Historia',
    'fotografia': 'Fotografía',
    'fotografía': 'Fotografía',
    'folleto': 'Folleto',
    'video': 'Video',
    'tiktok': 'Video'
}

PATRON_XSS = re.compile(r'<\s*script\b|javascript\s*:|on(load|error|click|mouseover)\s*=', re.IGNORECASE)
PATRON_URL = re.compile(r'^https?://', re.IGNORECASE)
PATRON_TOKEN_ID = re.compile(r'^[a-z0-9-]+-[0-9a-f]{4,8}$')

def normalizar_mes(mes_raw):
    if not mes_raw:
        return None
    mes_str = str(mes_raw).strip().capitalize()
    if mes_str.lower() in ('septiembre', 'setiembre'):
        return 'Septiembre'
    for m in MESES_VALIDOS:
        if m.lower() == mes_str.lower():
            return m
    return None

def normalizar_formato(fmt_raw):
    if not fmt_raw:
        return 'Post'
    k = str(fmt_raw).strip().lower()
    return FORMATOS_CANONICOS.get(k, str(fmt_raw).strip())

def sanitizar_texto(texto):
    if not isinstance(texto, str):
        return texto
    # Neutralizar posibles scripts en texto plano
    limpio = texto.replace('<script', '&lt;script').replace('</script', '&lt;/script')
    return limpio

def validar_datos_tablero(data, modo_estricto=True):
    """
    Valida un diccionario con datos de un tablero.
    Retorna: (es_valido, errores, advertencias, datos_normalizados)
    """
    errores = []
    advertencias = []
    norm = json.loads(json.dumps(data))  # Copia profunda

    # 1. Validación de Cliente
    cliente = norm.get('cliente')
    if not cliente or not isinstance(cliente, str) or len(cliente.strip()) < 2:
        errores.append("Campo 'cliente' es obligatorio y debe tener al menos 2 caracteres.")
    else:
        norm['cliente'] = cliente.strip()

    # 2. Validación de Mes
    mes = norm.get('mes')
    mes_norm = normalizar_mes(mes)
    if not mes_norm:
        errores.append(f"Mes no reconocido: {mes}")
    else:
        norm['mes'] = mes_norm

    # 3. Validación de Año
    anio = norm.get('anio')
    if not anio:
        errores.append("Campo 'anio' es obligatorio.")
    else:
        try:
            anio_int = int(str(anio).strip())
            if anio_int < 2024 or anio_int > 2035:
                errores.append(f"Año '{anio}' fuera de rango razonable (2024-2035).")
            else:
                norm['anio'] = anio_int
        except ValueError:
            errores.append(f"Campo 'anio' ('{anio}') no es un número válido.")

    # 4. Validación de Contenidos
    contenidos = norm.get('contenidos')
    if not isinstance(contenidos, list) or len(contenidos) == 0:
        errores.append("Campo 'contenidos' debe ser una lista con al menos una pieza.")
    else:
        ids_vistos = set()
        clickup_ids_vistos = {}
        sinc_clickup_raw = norm.get('sincronizadoClickup')
        mes_sincronizado = None
        if sinc_clickup_raw:
            m_match = re.search(r'\d{4}-(\d{2})', str(sinc_clickup_raw))
            if m_match:
                m_num = int(m_match.group(1))
                if 1 <= m_num <= 12:
                    mes_sincronizado = MESES_VALIDOS[m_num - 1]
            if not mes_sincronizado:
                for mv in MESES_VALIDOS:
                    if mv.lower() in str(sinc_clickup_raw).lower():
                        mes_sincronizado = mv
                        break

        for idx, c in enumerate(contenidos):
            num = idx + 1
            if not isinstance(c, dict):
                errores.append(f"Contenido #{num} no es un objeto válido.")
                continue

            # ID de pieza
            c_id = str(c.get('id') or f"c{num}").strip()
            if c_id in ids_vistos:
                errores.append(f"Contenido #{num} tiene un ID duplicado: '{c_id}'.")
            ids_vistos.add(c_id)
            c['id'] = c_id

            # clickupId: validación de duplicados y coherencia con mes de sincronización
            cid = c.get('clickupId')
            if cid:
                cid_str = str(cid).strip()
                c['clickupId'] = cid_str
                if cid_str in clickup_ids_vistos:
                    advertencias.append(
                        f"Contenido #{num} tiene el mismo clickupId ('{cid_str}') que el contenido #{clickup_ids_vistos[cid_str]}."
                    )
                else:
                    clickup_ids_vistos[cid_str] = num

                c_sinc = c.get('sincronizadoClickup') or sinc_clickup_raw
                c_mes_sinc = mes_sincronizado
                if c.get('sincronizadoClickup'):
                    m_c = re.search(r'\d{4}-(\d{2})', str(c.get('sincronizadoClickup')))
                    if m_c:
                        c_num = int(m_c.group(1))
                        if 1 <= c_num <= 12:
                            c_mes_sinc = MESES_VALIDOS[c_num - 1]
                if c_sinc and c_mes_sinc and mes_norm and c_mes_sinc.lower() != mes_norm.lower():
                    advertencias.append(
                        f"Contenido #{num} trae clickupId ('{cid_str}') y el mes del JSON ('{mes_norm}') es distinto del mes de su sincronizadoClickup ('{c_mes_sinc}')."
                    )

            # Título
            titulo = c.get('titulo')
            if not titulo or not isinstance(titulo, str) or not titulo.strip():
                errores.append(f"Contenido #{num} ({c_id}) debe tener un 'titulo' no vacío.")
            else:
                c['titulo'] = sanitizar_texto(titulo.strip())
                if PATRON_XSS.search(titulo):
                    advertencias.append(f"Contenido #{num}: se neutralizaron caracteres potencialmente inseguros en el título.")

            # Formato
            fmt = c.get('formato')
            c['formato'] = normalizar_formato(fmt)

            # Canal (Ads u Orgánico)
            canal = str(c.get('canal') or '').strip()
            if canal:
                canal_l = canal.lower()
                if 'ads' in canal_l or 'pauta' in canal_l:
                    c['canal'] = 'Ads'
                elif canal_l.startswith('org'):
                    c['canal'] = 'Orgánico'
                else:
                    advertencias.append(f"Contenido #{num}: canal '{canal}' no reconocido (usa 'Ads' u 'Orgánico').")

            # Guion y Copy
            c['guion'] = sanitizar_texto(str(c.get('guion') or ''))
            c['copy'] = sanitizar_texto(str(c.get('copy') or ''))

            # Estado
            c_est = str(c.get('estado') or 'pendiente').strip().lower()
            if c_est not in ('pendiente', 'aprobado', 'cambios', 'corregido', 'en_correccion', 'en_revision', 'borrador'):
                advertencias.append(f"Contenido #{num}: estado '{c_est}' normalizado a 'pendiente'.")
                c['estado'] = 'pendiente'
            else:
                c['estado'] = c_est

            # Versión
            try:
                c_ver = int(c.get('version') or 1)
                c['version'] = max(1, c_ver)
            except (ValueError, TypeError):
                c['version'] = 1

            # Referencias
            refs = c.get('referencias')
            if refs is not None:
                if not isinstance(refs, list):
                    advertencias.append(f"Contenido #{num}: 'referencias' debe ser una lista.")
                    c['referencias'] = []
                else:
                    refs_validas = []
                    for r in refs:
                        if isinstance(r, dict) and r.get('url'):
                            u = str(r['url']).strip()
                            if PATRON_URL.match(u):
                                refs_validas.append({'label': str(r.get('label') or 'Referencia').strip(), 'url': u})
                            else:
                                advertencias.append(f"Contenido #{num}: URL de referencia ignorada por no ser http/https ('{u}').")
                    c['referencias'] = refs_validas
            else:
                c['referencias'] = []

            # Aceptación de campos extendidos del flujo de guardado seguro
            # _sync: huella de sincronización
            if '_sync' in c and not isinstance(c['_sync'], dict):
                advertencias.append(f"Contenido #{num}: '_sync' debe ser un objeto con huellas de sincronización.")
                c.pop('_sync', None)

            # aprobacion: snapshot de aprobación congelada
            if 'aprobacion' in c and c['aprobacion'] is not None:
                if not isinstance(c['aprobacion'], dict):
                    advertencias.append(f"Contenido #{num}: 'aprobacion' debe ser un objeto.")
                else:
                    # Sanitizar campos de texto si existen en la instantánea
                    for f in ('titulo', 'guion', 'copy', 'hashtags', 'usuario'):
                        if f in c['aprobacion'] and isinstance(c['aprobacion'][f], str):
                            c['aprobacion'][f] = sanitizar_texto(c['aprobacion'][f])

            # historial: registro de correcciones y eventos de la pieza
            if 'historial' in c and c['historial'] is not None:
                if not isinstance(c['historial'], list):
                    advertencias.append(f"Contenido #{num}: 'historial' debe ser una lista.")
                    c['historial'] = []

            # hashtags: texto plano opcional
            if 'hashtags' in c and c['hashtags'] is not None:
                c['hashtags'] = sanitizar_texto(str(c['hashtags']))

    # 4b. Orden oficial (Orgánicos primero, luego Ads; cada bloque por fecha)
    try:
        sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
        from orden_tablero import revisar_orden
        advertencias.extend(revisar_orden(norm))
    except Exception as e:
        advertencias.append(f"No se pudo revisar el orden de las piezas ({e}).")

    # 5. Validación de identificador del tablero si ya está presente
    b_id = norm.get('id')
    if b_id:
        if not PATRON_TOKEN_ID.match(str(b_id)):
            advertencias.append(f"ID del tablero '{b_id}' no termina en un token hex de 4 a 8 caracteres (requerido por reglas de Firestore).")

    es_valido = len(errores) == 0
    return es_valido, errores, advertencias, norm

def validar_tablero_publicado_v2(codigo_cliente, mes_key=None, repo_dir=None):
    """
    Valida la estructura publicada v2 de un tablero:
      1. datos/<codigo>/indice.json existe y tiene 'cliente', 'actual' y 'meses'.
      2. El mes_key existe en el índice y tiene su archivo datos/<codigo>/<mes_key>.json.
      3. El JSON publicado no tiene campos internos prohibidos.
      4. La cáscara HTML <codigo>.html referencia tablero.css y tablero.js.
    Retorna: (es_valido, errores, advertencias)
    """
    repo = repo_dir or os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    dir_datos = os.path.join(repo, 'datos', codigo_cliente)
    ruta_indice = os.path.join(dir_datos, 'indice.json')
    errores = []
    advertencias = []

    if not os.path.exists(ruta_indice):
        errores.append(f"No existe el archivo de índice '{ruta_indice}'.")
        return False, errores, advertencias

    try:
        indice = json.load(open(ruta_indice, 'r', encoding='utf-8'))
    except Exception as e:
        errores.append(f"Error al parsear '{ruta_indice}': {e}")
        return False, errores, advertencias

    for campo in ('cliente', 'actual', 'meses'):
        if campo not in indice:
            errores.append(f"El índice '{ruta_indice}' carece del campo obligatorio '{campo}'.")

    meses = indice.get('meses', [])
    if not isinstance(meses, list) or len(meses) == 0:
        errores.append(f"El índice '{ruta_indice}' debe tener una lista 'meses' no vacía.")

    mes_a_validar = mes_key or indice.get('actual')
    mes_encontrado = None
    for m in meses:
        if m.get('mes') == mes_a_validar:
            mes_encontrado = m
            break

    if not mes_encontrado:
        errores.append(f"El mes '{mes_a_validar}' no está registrado en el índice '{ruta_indice}'.")
    else:
        ruta_mes = os.path.join(dir_datos, f"{mes_a_validar}.json")
        if not os.path.exists(ruta_mes):
            errores.append(f"No existe el archivo de datos del mes '{ruta_mes}'.")
        else:
            try:
                datos_mes = json.load(open(ruta_mes, 'r', encoding='utf-8'))
                campos_prohibidos_raiz = {'archivo', 'token', 'clickupId', 'tipoOriginal', 'sincronizadoClickup', 'huellasClickup', 'tableroProduccion'}
                hallados_raiz = campos_prohibidos_raiz.intersection(datos_mes.keys())
                if hallados_raiz:
                    errores.append(f"El archivo '{ruta_mes}' contiene campos internos prohibidos en la raíz: {hallados_raiz}")

                for idx, c in enumerate(datos_mes.get('contenidos', [])):
                    if isinstance(c, dict):
                        campos_prohibidos_pieza = {'_sync', 'clickupId', 'tipoOriginal'}
                        hallados_pieza = campos_prohibidos_pieza.intersection(c.keys())
                        if hallados_pieza:
                            errores.append(f"Pieza #{idx+1} en '{ruta_mes}' contiene campos internos prohibidos: {hallados_pieza}")
            except Exception as e:
                errores.append(f"Error al leer '{ruta_mes}': {e}")

    # Validar cáscara HTML
    archivo_html = f"{codigo_cliente}.html"
    ruta_html = os.path.join(repo, archivo_html)
    if not os.path.exists(ruta_html):
        advertencias.append(f"No se encontró la cáscara HTML '{ruta_html}'.")
    else:
        try:
            html = open(ruta_html, 'r', encoding='utf-8').read()
            if 'tablero.css' not in html:
                errores.append(f"La cáscara '{archivo_html}' no referencia 'tablero.css'.")
            if 'tablero.js' not in html:
                errores.append(f"La cáscara '{archivo_html}' no referencia 'tablero.js'.")
            if f'content="{codigo_cliente}"' not in html and f'content=\'{codigo_cliente}\'' not in html:
                errores.append(f"La cáscara '{archivo_html}' no tiene la meta nexo-tablero con el código '{codigo_cliente}'.")
            for proh in ('clickupId', 'sincronizadoClickup', 'huellasClickup', 'tableroProduccion'):
                if proh in html:
                    errores.append(f"La cáscara '{archivo_html}' contiene el campo interno prohibido '{proh}'.")
        except Exception as e:
            errores.append(f"Error al leer '{ruta_html}': {e}")

    return len(errores) == 0, errores, advertencias

def main():
    if len(sys.argv) < 2:
        print("Uso: python3 _sistema/validar_tablero.py <ruta/al/borrador.json o codigo-cliente>")
        sys.exit(1)

    arg = sys.argv[1]
    repo = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

    # Si es un código de cliente directo o archivo HTML
    if not os.path.exists(arg) and os.path.exists(os.path.join(repo, 'datos', arg)):
        codigo = arg
        valido_v2, errs_v2, advs_v2 = validar_tablero_publicado_v2(codigo, repo_dir=repo)
        if advs_v2:
            print("⚠️ Advertencias v2:")
            for w in advs_v2: print(f"  - {w}")
        if not valido_v2:
            print("❌ Errores v2 encontrados:")
            for err in errs_v2: print(f"  - {err}")
            sys.exit(1)
        print(f"✓ Tablero v2 '{codigo}' validado exitosamente.")
        sys.exit(0)

    if not os.path.exists(arg):
        print(f"Error: No se encontró el archivo '{arg}'")
        sys.exit(1)

    try:
        data = json.load(open(arg, encoding='utf-8'))
    except Exception as e:
        print(f"Error al parsear JSON en '{arg}': {e}")
        sys.exit(1)

    valido, errores, advertencias, normalizado = validar_datos_tablero(data)

    if advertencias:
        print("⚠️ Advertencias:")
        for w in advertencias:
            print(f"  - {w}")

    if not valido:
        print("❌ Errores de validación encontrados:")
        for err in errores:
            print(f"  - {err}")
        sys.exit(1)

    print(f"✓ Validación exitosa: '{arg}' cumple con el esquema oficial de NEXO.")
    print(f"  Cliente: {normalizado['cliente']} | Periodo: {normalizado['mes']} {normalizado['anio']} | Piezas: {len(normalizado['contenidos'])}")

    # Si el borrador ya tiene archivo generado, validar también la estructura v2
    if normalizado.get('archivo'):
        codigo = os.path.splitext(normalizado['archivo'])[0]
        dir_cliente = os.path.join(repo, 'datos', codigo)
        if os.path.exists(dir_cliente):
            valido_v2, errs_v2, advs_v2 = validar_tablero_publicado_v2(codigo, repo_dir=repo)
            if advs_v2:
                for w in advs_v2: print(f"  ⚠️ v2: {w}")
            if not valido_v2:
                print("❌ Errores en estructura v2 publicada:")
                for err in errs_v2: print(f"  - {err}")
                sys.exit(1)
            print(f"✓ Estructura v2 publicada para '{codigo}' validada exitosamente.")

if __name__ == '__main__':
    main()
