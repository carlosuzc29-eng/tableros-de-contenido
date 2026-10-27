#!/usr/bin/env python3
"""
Nexo Agencia Creativa · Preparador de Fuente Única para Sincronización con ClickUp.

Uso:
    python3 _sistema/preparar_clickup.py borradores/<cliente>-<mes>-<año>.json [firestore.json]

Genera:
    borradores/<cliente>-<mes>-<año>.clickup.json

Garantiza una fuente única, verificada e inmutable de los textos aprobados para la skill
sincronizar-aprobados-clickup, respetando la prioridad:
    instantánea de aprobación > Firestore en vivo > borrador local.
"""

import os
import sys
import json
import re
import hashlib
import urllib.request
import urllib.error

REGEX_FRASES_PEGADAS = re.compile(r'[.?!…:][A-ZÁÉÍÓÚÑ¿¡]')
REGEX_NOTA_AGENCIA = re.compile(r'^\s*\[?(Agencia|Nexo Agencia)[\s\S]*', re.IGNORECASE)

def unpack_fs_val(v):
    """Convierte un valor de Firestore REST API a tipos nativos de Python."""
    if not isinstance(v, dict):
        return v
    if 'stringValue' in v:
        return v['stringValue']
    if 'integerValue' in v:
        try:
            return int(v['integerValue'])
        except (ValueError, TypeError):
            return v['integerValue']
    if 'doubleValue' in v:
        try:
            return float(v['doubleValue'])
        except (ValueError, TypeError):
            return v['doubleValue']
    if 'booleanValue' in v:
        return v['booleanValue']
    if 'nullValue' in v:
        return None
    if 'timestampValue' in v:
        return v['timestampValue']
    if 'arrayValue' in v:
        vals = v['arrayValue'].get('values') or []
        return [unpack_fs_val(x) for x in vals]
    if 'mapValue' in v:
        f = v['mapValue'].get('fields') or {}
        return {k: unpack_fs_val(val) for k, val in f.items()}
    return v

def unpack_fs_doc(doc_obj):
    """Desempaqueta un documento completo devuelto por Firestore REST."""
    if not isinstance(doc_obj, dict):
        return {}
    if 'fields' in doc_obj and isinstance(doc_obj['fields'], dict):
        return {k: unpack_fs_val(val) for k, val in doc_obj['fields'].items()}
    # Si ya viene desempaquetado
    return doc_obj

def descargar_firestore_doc(tablero_id, api_key='AIzaSyAsH9TxW0ld2aNQejJw6xxZW7fpZiw212Q', project_id='nexo-tableros-app'):
    """Descarga el documento de Firestore vía API REST pública."""
    url = f"https://firestore.googleapis.com/v1/projects/{project_id}/databases/(default)/documents/tableros/{tablero_id}?key={api_key}"
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'NexoClickupPreparer/1.0'})
        with urllib.request.urlopen(req, timeout=15) as res:
            data = json.loads(res.read().decode('utf-8'))
            return unpack_fs_doc(data)
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"Error HTTP {e.code} ({e.reason}) al consultar Firestore para '{tablero_id}'")
    except Exception as e:
        raise RuntimeError(f"Error de red o conexión ({type(e).__name__}: {e}) al consultar Firestore")

def calc_sha1(texto):
    if texto is None:
        texto = ''
    return hashlib.sha1(str(texto).strip().encode('utf-8')).hexdigest()

def es_nota_agencia(texto):
    if not texto or not isinstance(texto, str):
        return False
    t = texto.strip()
    return bool(REGEX_NOTA_AGENCIA.match(t) or 'Pieza corregida a versión' in t or '✓ Pieza corregida' in t)

def construir_descripcion_clickup(version, fecha_aprobacion, aprobado_por, guion, copy, hashtags):
    """
    Construye la descripción propuesta para ClickUp con formato exacto:
    ✅ VERSIÓN APROBADA v<n> · <fecha> · <aprobadoPor>

    <guion>

    CAPTION

    <copy>

    <hashtags>
    """
    cabecera = f"✅ VERSIÓN APROBADA v{version} · {fecha_aprobacion or 'Fecha no especificada'} · {aprobado_por or 'Cliente'}"
    bloques = [cabecera]

    if guion and guion.strip():
        bloques.append(guion.strip())

    bloques.append("CAPTION")

    if copy and copy.strip():
        bloques.append(copy.strip())

    if hashtags and hashtags.strip():
        bloques.append(hashtags.strip())

    return "\n\n".join(bloques)

def procesar(borrador_path, firestore_path=None):
    if not os.path.exists(borrador_path):
        sys.exit(f"❌ Error: No se encontró el archivo borrador '{borrador_path}'.")

    try:
        with open(borrador_path, 'r', encoding='utf-8') as f:
            borrador = json.load(f)
    except Exception as e:
        sys.exit(f"❌ Error al leer JSON del borrador '{borrador_path}': {e}")

    tablero_id = borrador.get('id')
    if not tablero_id:
        sys.exit(f"❌ Error: El borrador '{borrador_path}' no contiene un campo 'id' de tablero.")

    # 1. Obtener documento de Firestore
    fs_data = {}
    if firestore_path:
        if not os.path.exists(firestore_path):
            sys.exit(f"❌ Error: No se encontró el archivo de Firestore especificado '{firestore_path}'.")
        try:
            with open(firestore_path, 'r', encoding='utf-8') as f:
                raw_fs = json.load(f)
                fs_data = unpack_fs_doc(raw_fs)
        except Exception as e:
            sys.exit(f"❌ Error al leer JSON de Firestore '{firestore_path}': {e}")
    else:
        print(f"Descargando estado de Firestore para tablero '{tablero_id}'...")
        try:
            fs_data = descargar_firestore_doc(tablero_id)
        except Exception as e:
            sys.exit(
                f"❌ No se pudo descargar el documento de Firestore vía REST API ({e}).\n"
                f"Pasa la ruta al archivo JSON exportado como segundo argumento:\n"
                f"  python3 _sistema/preparar_clickup.py {borrador_path} <firestore.json>"
            )

    fs_contenidos = fs_data.get('contenidos') or []
    fs_map = {}
    for item in fs_contenidos:
        if not isinstance(item, dict):
            continue
        if item.get('id'):
            fs_map[str(item['id'])] = item
        if item.get('n'):
            fs_map[int(item['n'])] = item

    borrador_contenidos = borrador.get('contenidos') or []
    total_borrador = len(borrador_contenidos)

    # Evaluación de bloqueo y preparación de piezas
    bloqueantes = []
    items_clickup = []

    estado_general_fs = fs_data.get('estado') or 'Sin revisar'
    revisado_por_general = fs_data.get('revisadoPor') or borrador.get('revision', {}).get('revisadoPor') or ''
    fecha_revision_general = fs_data.get('ultimaRevision') or borrador.get('revision', {}).get('fecha') or ''

    huellas_previas_clickup = borrador.get('huellasClickup') or {}
    sincronizado_previo = borrador.get('sincronizadoClickup') or {}

    for i, c_borrador in enumerate(borrador_contenidos):
        n = i + 1
        cid = str(c_borrador.get('id') or f'c{n}')
        c_fs = fs_map.get(cid) or fs_map.get(n) or {}

        estado_pieza = c_fs.get('estado') or c_borrador.get('estado') or 'pendiente'
        titulo_pieza = c_borrador.get('titulo') or c_fs.get('titulo') or f'Pieza #{n}'

        # Extraer último comentario del cliente si existe
        ultimo_comentario = ''
        comentarios_fs = c_fs.get('comentarios') or []
        for com in reversed(comentarios_fs):
            if isinstance(com, dict) and com.get('texto') and not es_nota_agencia(com.get('texto')):
                ultimo_comentario = com['texto']
                break
        if not ultimo_comentario and c_fs.get('comentario') and not es_nota_agencia(c_fs.get('comentario')):
            ultimo_comentario = c_fs['comentario']

        if estado_pieza != 'aprobado':
            bloqueantes.append({
                'n': n,
                'id': cid,
                'titulo': titulo_pieza,
                'estado': estado_pieza,
                'ultimoComentario': ultimo_comentario
            })

        # Selección de textos con orden de prioridad: aprobacion > firestore > borrador
        aprobacion_snap = c_fs.get('aprobacion') or {}
        fuente_texto = 'borrador'
        guion = ''
        copy = ''
        hashtags = ''
        formato = c_borrador.get('formato') or 'Post'
        version = int(c_fs.get('version') or c_borrador.get('version') or 1)

        if isinstance(aprobacion_snap, dict) and (aprobacion_snap.get('guion') or aprobacion_snap.get('copy')):
            fuente_texto = 'aprobacion'
            guion = aprobacion_snap.get('guion') or ''
            copy = aprobacion_snap.get('copy') or ''
            hashtags = aprobacion_snap.get('hashtags') or c_fs.get('hashtags') or c_borrador.get('hashtags') or ''
            formato = aprobacion_snap.get('formato') or c_fs.get('formato') or c_borrador.get('formato') or formato
            titulo_pieza = aprobacion_snap.get('titulo') or c_fs.get('titulo') or titulo_pieza
            version = int(aprobacion_snap.get('version') or version)
        elif c_fs.get('guion') or c_fs.get('copy'):
            fuente_texto = 'firestore'
            guion = c_fs.get('guion') or ''
            copy = c_fs.get('copy') or ''
            hashtags = c_fs.get('hashtags') or c_borrador.get('hashtags') or ''
            formato = c_fs.get('formato') or c_borrador.get('formato') or formato
            titulo_pieza = c_fs.get('titulo') or titulo_pieza
            version = int(c_fs.get('version') or version)
        else:
            fuente_texto = 'borrador'
            guion = c_borrador.get('guion') or ''
            copy = c_borrador.get('copy') or ''
            hashtags = c_borrador.get('hashtags') or ''
            formato = c_borrador.get('formato') or formato

        aprobado_por = ''
        fecha_aprobacion = ''
        if isinstance(aprobacion_snap, dict) and aprobacion_snap.get('usuario'):
            aprobado_por = aprobacion_snap['usuario']
            fecha_aprobacion = aprobacion_snap.get('fecha') or ''
        elif c_fs.get('revisadoPor'):
            aprobado_por = c_fs['revisadoPor']
            fecha_aprobacion = c_fs.get('fechaAprobacion') or c_fs.get('fechaEnvio') or fecha_revision_general
        else:
            aprobado_por = revisado_por_general
            fecha_aprobacion = fecha_revision_general

        # Separar comentarios de aprobación (solo cliente sobre versión aprobada) vs historial de observaciones
        comentarios_aprobacion = []
        historial_observaciones = []

        if isinstance(comentarios_fs, list):
            for com in comentarios_fs:
                if not isinstance(com, dict):
                    continue
                texto_com = com.get('texto') or ''
                if not texto_com or es_nota_agencia(texto_com):
                    continue
                com_ver = int(com.get('version') or 1)
                com_obj = {
                    'usuario': com.get('usuario') or 'Cliente',
                    'fecha': com.get('fecha') or '',
                    'texto': texto_com,
                    'version': com_ver
                }
                if com_ver == version:
                    comentarios_aprobacion.append(com_obj)
                else:
                    historial_observaciones.append(com_obj)

        if not comentarios_aprobacion and c_fs.get('comentario') and not es_nota_agencia(c_fs.get('comentario')):
            comentarios_aprobacion.append({
                'usuario': aprobado_por or 'Cliente',
                'fecha': fecha_aprobacion,
                'texto': c_fs['comentario'],
                'version': version
            })

        # Alertas de calidad
        alertas = []
        if not guion.strip() and not copy.strip():
            alertas.append('Texto vacío: guion y copy se encuentran en blanco.')

        if REGEX_FRASES_PEGADAS.search(guion):
            alertas.append('Parece haber frases pegadas sin salto de línea en el guion.')
        if REGEX_FRASES_PEGADAS.search(copy):
            alertas.append('Parece haber frases pegadas sin salto de línea en el copy.')

        if version > 1 and not c_fs.get('fechaCorreccion') and not c_borrador.get('fechaCorreccion'):
            alertas.append('Versión mayor a 1 sin registro de fecha de corrección.')

        guion_fs = (c_fs.get('guion') or '').strip()
        guion_borrador = (c_borrador.get('guion') or '').strip()
        if guion_fs and guion_borrador and guion_fs != guion_borrador:
            alertas.append('Guion en Firestore difiere del borrador local.')

        huella_texto = calc_sha1(f"{guion.strip()}\n---\n{copy.strip()}")

        estado_cambio_clickup = 'nuevo'
        if cid in huellas_previas_clickup:
            if huellas_previas_clickup[cid] == huella_texto:
                estado_cambio_clickup = 'sin_cambios'
            else:
                estado_cambio_clickup = 'texto_cambio'
        elif cid in sincronizado_previo:
            estado_cambio_clickup = 'texto_cambio'

        desc_clickup = construir_descripcion_clickup(
            version=version,
            fecha_aprobacion=fecha_aprobacion,
            aprobado_por=aprobado_por,
            guion=guion,
            copy=copy,
            hashtags=hashtags
        )

        item_resumen = {
            'id': cid,
            'n': n,
            'clickupId': c_borrador.get('clickupId') or c_fs.get('clickupId') or '',
            'titulo': titulo_pieza,
            'formato': formato,
            'tipoOriginal': c_borrador.get('tipoOriginal') or formato,
            'fechaPublicacion': c_borrador.get('fechaPublicacion') or '',
            'version': version,
            'guion': guion,
            'copy': copy,
            'hashtags': hashtags,
            'referencias': c_borrador.get('referencias') or c_fs.get('referencias') or [],
            'fuenteTexto': fuente_texto,
            'aprobadoPor': aprobado_por,
            'fechaAprobacion': fecha_aprobacion,
            'comentariosAprobacion': comentarios_aprobacion,
            'historialObservaciones': historial_observaciones,
            'huella': huella_texto,
            'estadoClickup': estado_cambio_clickup,
            'alertas': alertas,
            'descripcionClickup': desc_clickup
        }
        items_clickup.append(item_resumen)

    # Criterio estricto de LISTO:
    # 1. Estado general != 'Sin revisar'
    # 2. Hay revisadoPor
    # 3. len(contenidos_fs) == total_piezas == len(borrador_contenidos)
    # 4. Todos los contenidos están 'aprobado' (bloqueantes vacío)
    total_fs = len(fs_contenidos)
    cumple_total = (total_fs == total_borrador) if total_fs > 0 else False
    listo = (
        estado_general_fs != 'Sin revisar' and
        bool(revisado_por_general) and
        cumple_total and
        len(bloqueantes) == 0
    )

    salida_clickup = {
        'cliente': borrador.get('cliente'),
        'mes': borrador.get('mes'),
        'anio': borrador.get('anio'),
        'tableroId': tablero_id,
        'estadoGeneral': estado_general_fs,
        'revisadoPor': revisado_por_general,
        'ultimaRevision': fecha_revision_general,
        'totalContenidos': total_borrador,
        'listo': listo,
        'bloqueantes': bloqueantes,
        'contenidos': items_clickup
    }

    # Guardar archivo .clickup.json
    out_path = borrador_path.replace('.json', '.clickup.json')
    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(salida_clickup, f, ensure_ascii=False, indent=2)

    # Imprimir resumen en consola
    print("\n" + "=" * 65)
    print(f"📦 RESUMEN CLICKUP: {borrador.get('cliente')} ({borrador.get('mes')} {borrador.get('anio')})")
    print(f"📄 Archivo generado: {out_path}")
    print(f"🔒 Tablero Firestore: {tablero_id}")
    print(f"👤 Revisado por: {revisado_por_general or '(nadie todavía)'}")
    print(f"🚦 Estado general: {estado_general_fs}")
    print(f"✅ ¿Listo para sincronizar a ClickUp?: {'SÍ' if listo else 'NO'}")
    print("=" * 65)

    if bloqueantes:
        print(f"\n⚠️ PIEZAS BLOQUEANTES ({len(bloqueantes)}):")
        for b in bloqueantes:
            com = f" | Obs: \"{b['ultimoComentario']}\"" if b['ultimoComentario'] else ""
            print(f"  • #{b['n']} [{b['id']}] {b['titulo']} -> Estado: {b['estado']}{com}")

    print("\n📋 DETALLE DE PIEZAS PROCESADAS:")
    for it in items_clickup:
        alert_str = f" ⚠️ ({'; '.join(it['alertas'])})" if it['alertas'] else ""
        print(f"  [{it['id']}] #{it['n']} {it['titulo']} | v{it['version']} | Fuente: {it['fuenteTexto']} | ClickUp: {it['estadoClickup']}{alert_str}")

    print("=" * 65 + "\n")
    return out_path, listo

def main():
    if len(sys.argv) < 2:
        print("Uso: python3 _sistema/preparar_clickup.py borradores/<cliente>-<mes>-<año>.json [firestore.json]")
        sys.exit(1)

    borrador_arg = sys.argv[1]
    fs_arg = sys.argv[2] if len(sys.argv) > 2 else None
    procesar(borrador_arg, fs_arg)

if __name__ == '__main__':
    main()
