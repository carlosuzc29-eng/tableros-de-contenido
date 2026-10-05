#!/usr/bin/env python3
"""
NEXO · Construye (y opcionalmente publica) un tablero de aprobación de contenidos.

Uso (desde la carpeta del repositorio, en la terminal de Antigravity):
    python3 _sistema/construir.py borradores/milkarf-noviembre-2026.json
    python3 _sistema/construir.py borradores/milkarf-noviembre-2026.json --publicar
    (--nuevo-enlace: fuerza un enlace distinto en vez de reutilizar el del cliente)

Qué hace:
  1. Lee el JSON con los contenidos (formato en _sistema/FORMATO-DATOS.md).
  2. Le asigna nombre de archivo y enlace y los guarda en el mismo JSON. Cada cliente tiene
     UN solo enlace: el mes nuevo reemplaza al anterior en la misma dirección.
  3. Inserta los datos en _sistema/plantilla-tablero.html.
  4. Pre-renderiza con Google Chrome (para que se vea en la vista previa del iPhone).
  5. Registra el tablero en Cloud Firestore (panel de aprobaciones).
  6. Con --publicar: hace git add + commit + push.
No usa IA: no gasta créditos.
"""
import json, os, re, sys, secrets, subprocess, time, unicodedata, urllib.request, tempfile, shutil

AQUI = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(AQUI)
CONFIG = os.path.join(os.path.dirname(REPO), '.nexo-config.json')   # fuera del repo (privado)
PLANTILLA = os.path.join(AQUI, 'plantilla-tablero.html')

def slug(s):
    s = unicodedata.normalize('NFD', str(s)).encode('ascii', 'ignore').decode()
    return re.sub(r'[^a-z0-9]+', '-', s.lower()).strip('-')

def chrome():
    for c in [os.environ.get('CHROME', ''), '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
              '/Applications/Chromium.app/Contents/MacOS/Chromium', shutil.which('google-chrome') or '', shutil.which('chromium') or '']:
        if c and os.path.exists(c): return c
    return None

def enlace_previo(ruta, cliente):
    """Busca en borradores/ otro JSON del mismo cliente y devuelve su archivo (el más reciente)."""
    carpeta, propio, hallados = os.path.dirname(os.path.abspath(ruta)), os.path.abspath(ruta), []
    for f in os.listdir(carpeta):
        r = os.path.join(carpeta, f)
        if not f.endswith('.json') or r == propio: continue
        try: d = json.load(open(r, encoding='utf-8'))
        except Exception: continue
        if slug(d.get('cliente', '')) == slug(cliente) and d.get('archivo'):
            hallados.append((os.path.getmtime(r), d['archivo']))
    return max(hallados)[1] if hallados else None

FORMATOS_VALIDOS = ['Reel', 'Carrusel', 'Carrusel con video', 'Post', 'Story', 'Video']

def normalizar_formato(fmt):
    """Normaliza un string de formato al valor canónico permitido."""
    if not fmt: return 'Post'
    lower = str(fmt).strip().lower()
    if 'carrusel con video' in lower: return 'Carrusel con video'
    if 'carrusel' in lower: return 'Carrusel'
    if 'reel' in lower: return 'Reel'
    if 'story' in lower: return 'Story'
    if 'video' in lower or 'tiktok' in lower: return 'Video'
    return 'Post'

def parse_fs_val(v):
    """Convierte recursivamente la estructura tipada de Firestore REST a tipos estándar de Python."""
    if not isinstance(v, dict): return v
    if 'stringValue' in v: return v['stringValue']
    if 'integerValue' in v:
        try: return int(v['integerValue'])
        except (ValueError, TypeError): return v['integerValue']
    if 'booleanValue' in v: return bool(v['booleanValue'])
    if 'arrayValue' in v:
        return [parse_fs_val(x) for x in v['arrayValue'].get('values', [])]
    if 'mapValue' in v:
        return {k: parse_fs_val(sub_v) for k, sub_v in v['mapValue'].get('fields', {}).items()}
    return None

def sincronizar_desde_firestore(cfg, data):
    """
    Lee el documento de Firestore y sincroniza con el JSON de data:
    - Preserva estados, formatos, versiones, aprobaciones, observaciones e historial.
    - Si un contenido fue aprobado y el borrador local cambia guion/copy, se genera una
      nueva versión (vX+1) archivando la aprobada en 'versiones', sin pisar la aprobación.
    """
    fb = cfg.get('firebase', {})
    api_key = fb.get('apiKey') or 'AIzaSyAsH9TxW0ld2aNQejJw6xxZW7fpZiw212Q'
    project_id = fb.get('projectId') or 'nexo-tableros-app'
    doc_id = data.get('id')
    if not doc_id:
        return
    try:
        doc_url = (f'https://firestore.googleapis.com/v1/projects/{project_id}'
                   f'/databases/(default)/documents/tableros/{doc_id}?key={api_key}')
        req = urllib.request.Request(doc_url)
        with urllib.request.urlopen(req, timeout=10) as res:
            doc_obj = json.loads(res.read().decode())
        doc_fields = doc_obj.get('fields', {})

        # Preservar atributos de tablero
        fs_tipo = parse_fs_val(doc_fields.get('tipo', {}))
        if fs_tipo: data['tipo'] = fs_tipo

        fs_rev_por = parse_fs_val(doc_fields.get('revisadoPor', {}))
        fs_ult_rev = parse_fs_val(doc_fields.get('ultimaRevision', {}))
        if fs_rev_por or fs_ult_rev:
            data.setdefault('revision', {})
            if fs_rev_por: data['revision']['revisadoPor'] = fs_rev_por
            if fs_ult_rev: data['revision']['fecha'] = fs_ult_rev

        fs_contenidos_raw = parse_fs_val(doc_fields.get('contenidos', {})) or []
        if not fs_contenidos_raw or not isinstance(fs_contenidos_raw, list):
            return

        # Mapa indexado por n e id
        fs_map = {}
        for item in fs_contenidos_raw:
            if not isinstance(item, dict): continue
            item_n = item.get('n')
            item_id = item.get('id')
            if item_n: fs_map[int(item_n)] = item
            if item_id: fs_map[str(item_id)] = item

        cambios = 0
        for i, contenido in enumerate(data.get('contenidos', [])):
            n = i + 1
            cid = contenido.get('id') or f'c{n}'
            fs_item = fs_map.get(n) or fs_map.get(cid)
            if not fs_item:
                continue

            fs_estado = fs_item.get('estado')
            fs_version = int(fs_item.get('version') or 1)
            fs_formato = normalizar_formato(fs_item.get('formato'))
            local_formato = normalizar_formato(contenido.get('formato') or contenido.get('formatoOriginal'))

            # Preservar historial rico si existe
            if fs_item.get('versiones'):
                contenido['versiones'] = fs_item['versiones']
            if fs_item.get('aprobacion'):
                contenido['aprobacion'] = fs_item['aprobacion']
            if fs_item.get('historial_aprobacion'):
                contenido['historial_aprobacion'] = fs_item['historial_aprobacion']
            if fs_item.get('observaciones_historial'):
                contenido['observaciones_historial'] = fs_item['observaciones_historial']
            if fs_item.get('fechaCorreccion'):
                contenido['fechaCorreccion'] = fs_item['fechaCorreccion']
            if fs_item.get('estado_aprobacion'):
                contenido['estado_aprobacion'] = fs_item['estado_aprobacion']
            if fs_item.get('estado_produccion'):
                contenido['estado_produccion'] = fs_item['estado_produccion']

            # Si el contenido ya fue aprobado en Firestore
            if fs_estado == 'aprobado':
                # Comprobar si el borrador propone un texto distinto
                texto_local_cambio = (
                    (contenido.get('guion') and fs_item.get('guion') and contenido['guion'].strip() != fs_item['guion'].strip()) or
                    (contenido.get('copy') and fs_item.get('copy') and contenido['copy'].strip() != fs_item['copy'].strip())
                )
                if texto_local_cambio:
                    # No sobrescribir silenciosamente la versión aprobada: archivamos en versiones y subimos versión
                    contenido.setdefault('versiones', {})
                    contenido['versiones'][f'v{fs_version}'] = {
                        'version': fs_version,
                        'guion': fs_item.get('guion', ''),
                        'copy': fs_item.get('copy', ''),
                        'formato': fs_formato,
                        'estado': 'aprobado',
                        'aprobacion': fs_item.get('aprobacion') or {
                            'usuario': fs_item.get('revisadoPor') or 'Cliente',
                            'fecha': fs_item.get('fechaAprobacion') or ''
                        }
                    }
                    contenido['version'] = fs_version + 1
                    contenido['estado'] = 'corregido'
                    contenido['estado_aprobacion'] = 'corregido'
                    cambios += 1
                    print(f"  ↑ Contenido #{n} ({contenido.get('titulo')}): Aprobación previa de v{fs_version} archivada; preparado como v{contenido['version']} corregido.")
                else:
                    contenido['estado'] = 'aprobado'
                    contenido['version'] = fs_version
                    if fs_item.get('guion'): contenido['guion'] = fs_item['guion']
                    if fs_item.get('copy'): contenido['copy'] = fs_item['copy']
            elif fs_estado and fs_estado in ('corregido', 'cambios', 'en_correccion', 'en_revision', 'pendiente'):
                if contenido.get('estado') != fs_estado:
                    contenido['estado'] = fs_estado
                    cambios += 1
                if fs_estado == 'corregido':
                    if fs_item.get('guion'): contenido['guion'] = fs_item['guion']
                    if fs_item.get('copy'): contenido['copy'] = fs_item['copy']
                    if fs_item.get('version'): contenido['version'] = fs_version
                    cambios += 1

            if fs_formato and fs_formato != local_formato:
                contenido['formato'] = fs_formato
                contenido['formatoOriginal'] = fs_formato
                cambios += 1

            if fs_item.get('comentario') and not contenido.get('comentario'):
                contenido['comentario'] = fs_item['comentario']
            if fs_item.get('revisadoPor') and not contenido.get('revisadoPor'):
                contenido['revisadoPor'] = fs_item['revisadoPor']

        if cambios:
            print(f'  ↑ Sincronizados {cambios} cambio(s) desde Firestore al JSON (versiones, formatos, estados)')
    except Exception as e:
        print(f'  (No se pudo leer Firestore para sincronizar: {e})')

def registrar_en_firestore(cfg, data, total_contenidos):
    fb = cfg.get('firebase', {})
    if not (fb.get('apiKey') and fb.get('projectId') and fb.get('email') and fb.get('password')):
        print('  Se registrará solo al abrirlo por primera vez')
        return
    try:
        # Autenticar en Firebase Auth con las credenciales privadas
        auth_url = f"https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key={fb['apiKey']}"
        auth_payload = json.dumps({'email': fb['email'], 'password': fb['password'], 'returnSecureToken': True}).encode()
        auth_req = urllib.request.Request(auth_url, data=auth_payload, headers={'Content-Type': 'application/json'})
        auth_res = json.loads(urllib.request.urlopen(auth_req, timeout=15).read())
        token = auth_res.get('idToken')
        if not token:
            print('  Se registrará solo al abrirlo por primera vez')
            return

        doc_id = data['id']
        doc_url = f"https://firestore.googleapis.com/v1/projects/{fb['projectId']}/databases/(default)/documents/tableros/{doc_id}"

        # Verificar si el documento ya existe
        doc_existe = False
        doc_fields = {}
        try:
            get_req = urllib.request.Request(f"{doc_url}?key={fb['apiKey']}")
            with urllib.request.urlopen(get_req, timeout=15) as g_res:
                doc_obj = json.loads(g_res.read().decode())
                doc_fields = doc_obj.get('fields', {})
                doc_existe = True
        except Exception:
            pass

        now_iso = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
        tiene_revision_previa = bool(
            doc_fields.get('revisadoPor', {}).get('stringValue') or
            doc_fields.get('ultimaRevision', {}).get('stringValue') or
            int(doc_fields.get('aprobados', {}).get('integerValue', '0')) > 0 or
            int(doc_fields.get('cambios', {}).get('integerValue', '0')) > 0 or
            len(doc_fields.get('contenidos', {}).get('arrayValue', {}).get('values', [])) > 0
        )

        es_reinicio = ('--reiniciar' in sys.argv) or (not doc_existe and not data.get('revision', {}).get('fecha'))

        fields = {
            'id': {'stringValue': data['id']},
            'cliente': {'stringValue': data['cliente']},
            'mes': {'stringValue': data['mes']},
            'anio': {'stringValue': str(data['anio'])},
            'url': {'stringValue': data['url']},
            'total': {'integerValue': str(total_contenidos)}
        }

        if es_reinicio:
            fields.update({
                'aprobados': {'integerValue': '0'},
                'cambios': {'integerValue': '0'},
                'pendientes': {'integerValue': str(total_contenidos)},
                'estado': {'stringValue': 'Sin revisar'},
                'revisadoPor': {'stringValue': ''},
                'ultimaRevision': {'stringValue': ''},
                'registrado': {'stringValue': now_iso},
                'contenidos': {'arrayValue': {}}
            })
        elif tiene_revision_previa:
            print(f"  ℹ Conservando revisión existente en Firestore ({doc_fields.get('aprobados',{}).get('integerValue','0')} ok, {doc_fields.get('cambios',{}).get('integerValue','0')} cambios)")

        mask_params = '&'.join([f"updateMask.fieldPaths={k}" for k in fields.keys()])
        patch_url = f"{doc_url}?{mask_params}&key={fb['apiKey']}"
        patch_body = json.dumps({'fields': fields}).encode()
        patch_req = urllib.request.Request(patch_url, data=patch_body, headers={
            'Content-Type': 'application/json',
            'Authorization': f"Bearer {token}"
        }, method='PATCH')
        r = urllib.request.urlopen(patch_req, timeout=15)
        if r.status in (200, 201):
            print(f'✓ Registrado en Cloud Firestore ({data["id"]})')
        else:
            print('  Se registrará solo al abrirlo por primera vez')
    except Exception:
        print('  Se registrará solo al abrirlo por primera vez')

def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    if not args: sys.exit(__doc__)
    ruta = args[0]
    cfg = json.load(open(CONFIG, encoding='utf-8')) if os.path.exists(CONFIG) else {}
    base = cfg.get('base_url', 'https://carlosuzc29-eng.github.io/tableros-de-contenido/')
    
    try:
        data = json.load(open(ruta, encoding='utf-8'))
    except Exception as e:
        sys.exit(f"Error al leer JSON en '{ruta}': {e}")

    # Validación formal del esquema antes de procesar
    try:
        try:
            from validar_tablero import validar_datos_tablero
        except ImportError:
            from _sistema.validar_tablero import validar_datos_tablero

        es_valido, errores, advertencias, normalizado = validar_datos_tablero(data)
        if advertencias:
            for w in advertencias:
                print(f"  ⚠️ {w}")
        if not es_valido:
            print("❌ Errores de validación en el JSON antes de construir:")
            for err in errores:
                print(f"   - {err}")
            sys.exit(1)
        data = normalizado
    except Exception as e:
        print(f"  (Advertencia: validador no disponible: {e})")

    n = len(data.get('contenidos', []))
    if not n: sys.exit('El JSON no tiene contenidos.')

    # Un solo enlace por cliente: cada mes nuevo reutiliza el archivo del tablero anterior.
    if not data.get('archivo') and '--nuevo-enlace' not in sys.argv:
        previo = enlace_previo(ruta, data['cliente'])
        if previo:
            data['archivo'] = previo
            print(f'↻ Mismo enlace que el mes anterior: {previo}')
    if not data.get('archivo'):
        data['archivo'] = f"{slug(data['cliente'])}-{secrets.token_hex(3)}.html"
    id_mes = f"{slug(data['cliente'])}-{data['anio']}-{slug(data['mes'])}"
    if not str(data.get('id', '')).startswith(id_mes):
        # JSON copiado de otro mes: se limpia la revisión para que el tablero salga como nuevo.
        data['token'] = secrets.token_hex(4)
        data['id'] = f"{id_mes}-{data['token']}"
        data['revision'] = {'revisadoPor': '', 'fecha': ''}
        for c in data.get('contenidos', []):
            for k in ('id', 'estado', 'comentario', 'comentarios', 'revisadoPor', 'formatoOriginal'): c.pop(k, None)
    if not data.get('token'):
        data['token'] = secrets.token_hex(4)
    data['id'] = f"{id_mes}-{data['token']}"
    data['url'] = base + data['archivo']
    data.pop('endpoint', None)
    fb = cfg.get('firebase', {})
    data['firebase'] = {
        'apiKey': fb.get('apiKey') or 'AIzaSyAsH9TxW0ld2aNQejJw6xxZW7fpZiw212Q',
        'projectId': fb.get('projectId') or 'nexo-tableros-app'
    }
    data.setdefault('revision', {'revisadoPor': '', 'fecha': ''})
    if not data['revision'].get('fecha'):
        data['resetAt'] = int(time.time() * 1000)
    for i, c in enumerate(data['contenidos']):
        c.setdefault('id', f'c{i + 1}'); c.setdefault('estado', 'pendiente'); c.setdefault('comentario', '')

    # Sincronizar cambios de Firestore (correcciones de agencia, cambios de formato, versiones) al JSON
    if '--reiniciar' not in sys.argv:
        sincronizar_desde_firestore(cfg, data)

    json.dump(data, open(ruta, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)

    html = open(PLANTILLA, encoding='utf-8').read()
    datos = {k: v for k, v in data.items() if k != 'archivo'}
    html = html.replace('__DATA__', json.dumps(datos, ensure_ascii=False, indent=2).replace('</', '<\\/'))

    chrome_bin = chrome()
    if chrome_bin:
        tmp = tempfile.NamedTemporaryFile('w', suffix='.html', delete=False, encoding='utf-8')
        tmp.write(html)
        tmp.close()
        extra = ['--no-sandbox'] if os.environ.get('NEXO_NOSANDBOX') else []
        try:
            res = subprocess.run([chrome_bin, *extra, '--headless=new', '--disable-gpu', '--no-first-run', '--virtual-time-budget=5000',
                                  '--dump-dom', 'file://' + tmp.name], capture_output=True, text=True, timeout=120)
            out = res.stdout
            if 'class="js"' in out[:400]:
                out = '<!DOCTYPE html>\n' + re.sub(r'^\s*<!DOCTYPE html>\s*', '', out, flags=re.I).replace('class="js"', 'class="no-js"', 1)
                tarjetas = len(re.findall(r'<article class="card', out))
                if tarjetas == n:
                    html = out
                    print(f'✓ Pre-renderizado con Google Chrome exitoso ({tarjetas} tarjetas)')
                else:
                    print(f'  ⚠️ Aviso: discrepancia de tarjetas en Chrome ({tarjetas}/{n}), usando renderizado dinámico.')
            else:
                print('  ⚠️ Aviso: Chrome headless no devolvió el DOM esperado, usando renderizado dinámico.')
        except Exception as e:
            print(f'  ⚠️ Aviso: fallo en Chrome headless ({e}), usando renderizado dinámico.')
        finally:
            if os.path.exists(tmp.name):
                os.unlink(tmp.name)
    else:
        print('  ℹ Google Chrome no detectado en el entorno: tablero generado en modo dinámico de plantilla.')

    destino = os.path.join(REPO, data['archivo'])
    open(destino, 'w', encoding='utf-8').write(html)
    print(f'✓ Tablero generado: {data["archivo"]} ({n} contenidos)')

    registrar_en_firestore(cfg, data, n)

    if '--publicar' in sys.argv:
        subprocess.run(['git', '-C', REPO, 'add', data['archivo']], check=True)
        subprocess.run(['git', '-C', REPO, 'commit', '-m', f"Tablero {data['cliente']} {data['mes']} {data['anio']}"], check=False)
        subprocess.run(['git', '-C', REPO, 'pull', '--rebase', 'origin', 'main'], check=False)
        subprocess.run(['git', '-C', REPO, 'push', 'origin', 'main'], check=True)
        print('✓ Publicado (GitHub tarda 1-2 minutos en actualizar)')

    print('\nEnlace:', data['url'])
    print(f"\nMensaje para WhatsApp:\n¡Hola! 👋 Te comparto la parrilla de contenidos de {data['mes']}: {data['url']}\n"
          "Ábrela en tu navegador, revisa cada contenido y márcalo como *Aprobado* o *Pedir cambios* (puedes dejarnos comentarios "
          "y cambiar el tipo de contenido si lo prefieres en otro formato). Al terminar, escribe tu nombre abajo y toca *Enviar revisión*. ¡Gracias! 💚")

if __name__ == '__main__':
    main()
