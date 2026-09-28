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
    sys.exit('No encontré Google Chrome. Instálalo o indica la ruta con la variable CHROME.')

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
    data = json.load(open(ruta, encoding='utf-8'))
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
    json.dump(data, open(ruta, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)

    html = open(PLANTILLA, encoding='utf-8').read()
    datos = {k: v for k, v in data.items() if k != 'archivo'}
    html = html.replace('__DATA__', json.dumps(datos, ensure_ascii=False, indent=2).replace('</', '<\\/'))

    tmp = tempfile.NamedTemporaryFile('w', suffix='.html', delete=False, encoding='utf-8'); tmp.write(html); tmp.close()
    extra = ['--no-sandbox'] if os.environ.get('NEXO_NOSANDBOX') else []
    out = subprocess.run([chrome(), *extra, '--headless=new', '--disable-gpu', '--no-first-run', '--virtual-time-budget=5000',
                          '--dump-dom', 'file://' + tmp.name], capture_output=True, text=True, timeout=120).stdout
    os.unlink(tmp.name)
    if 'class="js"' not in out[:400]: sys.exit('Chrome no pudo renderizar el tablero (revisa la plantilla o el JSON).')
    out = '<!DOCTYPE html>\n' + re.sub(r'^\s*<!DOCTYPE html>\s*', '', out, flags=re.I).replace('class="js"', 'class="no-js"', 1)
    tarjetas = len(re.findall(r'<article class="card', out))
    if tarjetas != n: sys.exit(f'Error: se esperaban {n} tarjetas y salieron {tarjetas}.')
    destino = os.path.join(REPO, data['archivo'])
    open(destino, 'w', encoding='utf-8').write(out)
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
