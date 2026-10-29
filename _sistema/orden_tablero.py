#!/usr/bin/env python3
"""
Orden oficial de las piezas de un tablero de Nexo.

  1. Primero todas las piezas Orgánicas, después todas las de Ads
     (las que no tienen canal van al final).
  2. Dentro de cada bloque, por fecha de publicación (DD/MM) de la más
     próxima a la más lejana; los meses anteriores al mes del tablero se
     cuentan como del año siguiente (ej. 05/01 en un tablero de diciembre).
  3. Misma fecha: se conserva el orden que traía el JSON (la skill lo arma
     por número de CONTENIDO N y luego por fecha de creación en ClickUp).
  4. Sin fecha: al final de su bloque.

Uso:
  python3 _sistema/orden_tablero.py borradores/<archivo>.json            # solo revisa
  python3 _sistema/orden_tablero.py borradores/<archivo>.json --ordenar  # ordena y guarda
  python3 _sistema/orden_tablero.py borradores/<archivo>.json --ordenar --renumerar
      # además deja los id c1…cN en el nuevo orden. Solo si el documento de
      # Firestore del mes todavía no tiene 'contenidos' (tablero sin revisar).
"""
import json, re, sys

MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
         'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']


def canal_bloque(c):
    v = str(c.get('canal') or '').strip().lower()
    if v.startswith('org'):
        return 0
    if 'ads' in v or 'pauta' in v:
        return 1
    return 2


def mes_tablero(data):
    m = str(data.get('mes') or '').strip().lower().replace('setiembre', 'septiembre')
    return MESES.index(m) + 1 if m in MESES else None


def clave_fecha(c, mes_base):
    f = str(c.get('fechaPublicacion') or '').strip()
    m = re.match(r'^(\d{1,2})/(\d{1,2})', f)
    if not m:
        return (1, 0, 0)  # sin fecha: al final del bloque
    dia, mes = int(m.group(1)), int(m.group(2))
    if mes_base and mes < mes_base:
        mes += 12
    return (0, mes, dia)


def clave(c, idx, mes_base):
    return (canal_bloque(c), clave_fecha(c, mes_base), idx)


def ordenados(data):
    cs = data.get('contenidos') or []
    mes_base = mes_tablero(data)
    pares = sorted(enumerate(cs), key=lambda p: clave(p[1], p[0], mes_base))
    return [c for _, c in pares]


def revisar_orden(data):
    """Devuelve una lista de avisos si el JSON no sigue el orden oficial."""
    cs = data.get('contenidos') or []
    esperado = ordenados(data)
    if [id(c) for c in cs] == [id(c) for c in esperado]:
        return []
    avisos = ["El orden no es el oficial (Orgánicos primero, luego Ads; cada bloque por fecha). "
              "Ejecuta: python3 _sistema/orden_tablero.py <borrador> --ordenar"]
    for pos, (a, b) in enumerate(zip(cs, esperado), 1):
        if a is not b:
            avisos.append(f"Posición {pos}: está '{a.get('titulo')}' y debería ir '{b.get('titulo')}'.")
            break
    return avisos


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    if not args:
        sys.exit(__doc__)
    ruta = args[0]
    data = json.load(open(ruta, encoding='utf-8'))
    avisos = revisar_orden(data)
    if '--ordenar' not in sys.argv:
        if avisos:
            print('⚠️ ' + '\n   '.join(avisos))
            sys.exit(1)
        print(f'✓ Orden oficial correcto ({len(data.get("contenidos") or [])} piezas).')
        return
    data['contenidos'] = ordenados(data)
    if '--renumerar' in sys.argv:
        for i, c in enumerate(data['contenidos'], 1):
            c['id'] = f'c{i}'
            c.pop('_sync', None)
    json.dump(data, open(ruta, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
    for i, c in enumerate(data['contenidos'], 1):
        canal = c.get('canal') or 'sin canal'
        print(f"{i:02d} {c.get('id', ''):>4} {canal:<9} {c.get('fechaPublicacion') or '--/--':<6} {c.get('formato', ''):<18} {c.get('titulo', '')}")
    print(f'✓ Ordenado ({len(data["contenidos"])} piezas){" y renumerado" if "--renumerar" in sys.argv else ""}.')


if __name__ == '__main__':
    main()
