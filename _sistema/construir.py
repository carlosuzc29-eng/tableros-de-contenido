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
  5. Registra el tablero en la hoja de Google (panel de aprobaciones).
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
        data['id'] = id_mes
        data['revision'] = {'revisadoPor': '', 'fecha': ''}
        for c in data.get('contenidos', []):
            for k in ('id', 'estado', 'comentario', 'comentarios', 'revisadoPor', 'formatoOriginal'): c.pop(k, None)
    data['id'] = id_mes
    data['url'] = base + data['archivo']
    if cfg.get('endpoint'): data['endpoint'] = cfg['endpoint']
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

    if cfg.get('endpoint') and cfg.get('clave'):
        body = json.dumps({'action': 'registrar', 'clave': cfg['clave'], 'id': data['id'], 'cliente': data['cliente'],
                           'mes': data['mes'], 'anio': data['anio'], 'url': data['url'], 'total': n}).encode()
        try:
            r = urllib.request.urlopen(urllib.request.Request(cfg['endpoint'], data=body, headers={'Content-Type': 'text/plain'}), timeout=60)
            print('✓ Registrado en el panel' if json.loads(r.read()).get('ok') else '⚠ La hoja no aceptó el registro (revisa la clave)')
        except Exception as e:
            print('⚠ No se pudo registrar en el panel:', e)

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
