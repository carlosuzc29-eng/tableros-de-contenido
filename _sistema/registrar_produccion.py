#!/usr/bin/env python3
"""
NEXO · Registra un tablero de producción en Cloud Firestore para sincronización en vivo.

Uso:
    python3 _sistema/registrar_produccion.py produccion/cliente-fecha-codigo.html
"""
import json, os, re, sys, time, urllib.request

AQUI = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(AQUI)
CONFIG = os.path.join(os.path.dirname(REPO), '.nexo-config.json')

def to_fs_value(val):
    if val is None:
        return {'nullValue': None}
    if isinstance(val, bool):
        return {'booleanValue': val}
    if isinstance(val, int):
        return {'integerValue': str(val)}
    if isinstance(val, float):
        return {'doubleValue': val}
    if isinstance(val, str):
        return {'stringValue': val}
    if isinstance(val, list):
        return {'arrayValue': {'values': [to_fs_value(x) for x in val]}}
    if isinstance(val, dict):
        return {'mapValue': {'fields': {k: to_fs_value(v) for k, v in val.items()}}}
    return {'stringValue': str(val)}

def main():
    if len(sys.argv) < 2:
        sys.exit('Uso: python3 _sistema/registrar_produccion.py <ruta/al/tablero.html>')

    ruta = os.path.abspath(sys.argv[1])
    if not os.path.exists(ruta):
        sys.exit(f'Error: no se encontró el archivo: {ruta}')

    if not os.path.exists(CONFIG):
        sys.exit(f'Error: no se encontró la configuración en {CONFIG}')

    cfg = json.load(open(CONFIG, encoding='utf-8'))
    fb = cfg.get('firebase', {})
    if not (fb.get('apiKey') and fb.get('projectId') and fb.get('email') and fb.get('password')):
        sys.exit('Error: credenciales de Firebase incompletas en .nexo-config.json')

    base_url = cfg.get('base_url', 'https://carlosuzc29-eng.github.io/tableros-de-contenido/')
    html = open(ruta, encoding='utf-8').read()

    # Extraer DATA
    match = re.search(r'const DATA = (\{.*?\});', html, flags=re.DOTALL)
    if not match:
        sys.exit('Error: no se encontró el bloque "const DATA = {...};" en el HTML')

    try:
        data = json.loads(match.group(1))
    except Exception as e:
        sys.exit(f'Error parseando JSON de DATA: {e}')

    filename = os.path.basename(ruta)
    doc_id = os.path.splitext(filename)[0]

    # Calcular URL pública
    rel_path = os.path.relpath(ruta, REPO).replace(os.sep, '/')
    url = base_url + rel_path

    # Inyectar id y firebase en DATA si no existen o cambiaron
    data['id'] = doc_id
    data['firebase'] = {
        'apiKey': fb['apiKey'],
        'projectId': fb['projectId']
    }

    # Reinyectar DATA en el HTML usando ensure_ascii=True y re.sub con lambda
    nuevo_json = json.dumps(data, ensure_ascii=True, indent=2)
    nuevo_html = re.sub(r'const DATA = \{.*?\};', lambda m: f'const DATA = {nuevo_json};', html, flags=re.DOTALL)
    with open(ruta, 'w', encoding='utf-8') as f:
        f.write(nuevo_html)

    # 1. Autenticar en Firebase Auth
    auth_url = f"https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key={fb['apiKey']}"
    auth_payload = json.dumps({
        'email': fb['email'],
        'password': fb['password'],
        'returnSecureToken': True
    }).encode()
    auth_req = urllib.request.Request(auth_url, data=auth_payload, headers={'Content-Type': 'application/json'})
    auth_res = json.loads(urllib.request.urlopen(auth_req, timeout=30).read())
    token = auth_res.get('idToken')
    if not token:
        sys.exit('Error: no se pudo obtener token de Firebase Auth')

    # 2. Preparar documento de Firestore
    contenidos = data.get('contenidos', [])
    orden = [c.get('id') for c in contenidos if c.get('id')]
    tarjetas_map = {}
    todo_count = 0
    grabando_count = 0
    listo_count = 0

    for c in contenidos:
        cid = c.get('id')
        if not cid: continue
        st = c.get('estado', 'todo')
        if st == 'grabando': grabando_count += 1
        elif st == 'listo': listo_count += 1
        else: todo_count += 1

        tarjetas_map[cid] = {
            'id': cid,
            'titulo': c.get('titulo', ''),
            'tipo': c.get('tipo', 'otro'),
            'sede': c.get('sede', ''),
            'estado': st,
            'descripcion': c.get('descripcion', ''),
            'subtareas': c.get('subtareas', []),
            'mediaLinks': c.get('mediaLinks', [])
        }

    now_iso = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())

    doc_data = {
        'id': doc_id,
        'cliente': data.get('cliente', ''),
        'fecha': data.get('fecha', ''),
        'url': url,
        'registrado': now_iso,
        'orden': orden,
        'tarjetas': tarjetas_map,
        'todo': todo_count,
        'grabando': grabando_count,
        'listo': listo_count,
        'actualizado': now_iso
    }

    # Convertir a estructura de campos Firestore
    fields = {k: to_fs_value(v) for k, v in doc_data.items()}

    # 3. Guardar documento en Cloud Firestore vía REST
    doc_url = f"https://firestore.googleapis.com/v1/projects/{fb['projectId']}/databases/(default)/documents/produccion/{doc_id}"
    patch_req = urllib.request.Request(doc_url, data=json.dumps({'fields': fields}).encode(), headers={
        'Content-Type': 'application/json',
        'Authorization': f"Bearer {token}"
    }, method='PATCH')

    r = urllib.request.urlopen(patch_req, timeout=30)
    if r.status in (200, 201):
        print(f'✓ Tablero de producción registrado en Cloud Firestore: {doc_id}')
        print(f'  Cliente: {data.get("cliente")}')
        print(f'  Fecha: {data.get("fecha")}')
        print(f'  Tarjetas: {len(orden)} (por hacer: {todo_count}, grabando: {grabando_count}, listo: {listo_count})')
        print(f'  URL: {url}')
    else:
        sys.exit(f'Error en respuesta de Firestore: HTTP {r.status}')

if __name__ == '__main__':
    main()
