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
    'story': 'Story',
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
        errores.append(f"Campo 'mes' ('{mes}') inválido. Debe ser uno de: {', '.join(MESES_VALIDOS)}.")
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

    # 5. Validación de identificador del tablero si ya está presente
    b_id = norm.get('id')
    if b_id:
        if not PATRON_TOKEN_ID.match(str(b_id)):
            advertencias.append(f"ID del tablero '{b_id}' no termina en un token hex de 4 a 8 caracteres (requerido por reglas de Firestore).")

    es_valido = len(errores) == 0
    return es_valido, errores, advertencias, norm

def main():
    if len(sys.argv) < 2:
        print("Uso: python3 _sistema/validar_tablero.py <ruta/al/borrador.json>")
        sys.exit(1)

    ruta = sys.argv[1]
    if not os.path.exists(ruta):
        print(f"Error: No se encontró el archivo '{ruta}'")
        sys.exit(1)

    try:
        data = json.load(open(ruta, encoding='utf-8'))
    except Exception as e:
        print(f"Error al parsear JSON en '{ruta}': {e}")
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

    print(f"✓ Validación exitosa: '{ruta}' cumple con el esquema oficial de NEXO.")
    print(f"  Cliente: {normalizado['cliente']} | Periodo: {normalizado['mes']} {normalizado['anio']} | Piezas: {len(normalizado['contenidos'])}")

if __name__ == '__main__':
    main()
