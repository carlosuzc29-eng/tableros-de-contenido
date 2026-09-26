# Instrucciones para el agente (Antigravity)

Repositorio de tableros de aprobación de contenidos de **Nexo Agencia Creativa**, publicado en GitHub Pages:
`https://carlosuzc29-eng.github.io/tableros-de-contenido/`

Responde siempre en español latinoamericano neutro, con "tú". Sé breve.

## Ahorro de créditos (obligatorio)

- **No regeneres ni reescribas archivos HTML completos.** Los tableros se construyen con `python3 _sistema/construir.py`, que no usa IA.
- Para un tablero nuevo, tu único trabajo es crear `borradores/<cliente>-<mes>-<año>.json` desde el documento, siguiendo `_sistema/FORMATO-DATOS.md`. Luego ejecuta el script.
- Para cambios de diseño, edita solo el fragmento necesario de `_sistema/plantilla-tablero.html`, con cambios puntuales. No leas ni reescribas el archivo completo si no hace falta.
- No abras los tableros ya generados (`*.html` de la raíz) salvo que se te pida. Son archivos grandes.

## Flujo para un tablero nuevo

1. Leer el documento del mes que te pase Carlos.
2. Crear `borradores/<cliente>-<mes>-<año>.json` (formato en `_sistema/FORMATO-DATOS.md`).
3. Ejecutar `python3 _sistema/construir.py borradores/<archivo>.json --publicar`.
4. Entregar el enlace y el mensaje de WhatsApp que imprime el script.

Cada cliente tiene **un solo enlace**: el tablero del mes nuevo reemplaza al anterior en la misma dirección (el script lo resuelve solo; no pongas `archivo` en el JSON nuevo). Para corregir un tablero ya enviado, edita su JSON y vuelve a ejecutar el mismo comando.

## No tocar en la plantilla

- `__DATA__` y `<script id="board-data" type="application/json">`
- Los id que usa el JavaScript: `list`, `nav`, `who`, `dl`, `dlMini`, `rOk`, `rFix`, `pct`, `sOk`, `sFix`, `sPend`, `dN`, `openLink`, `modal`, `box`, `toast`, `intro`, `reviewed`, `metaTitle`, `empty`
- Las clases `no-js` y `js` y la función `window.__nexoSnapshot`, que hacen que el tablero se vea en la vista previa del iPhone.
- Colores de marca: azul `#1F3549`, verde `#5CB83E` y naranja `#E64A00` como único complementario. El logotipo y el isotipo nunca van juntos.

## Archivos

- `_sistema/plantilla-tablero.html`: plantilla del tablero.
- `_sistema/construir.py`: genera, registra en el panel y publica.
- `panel-*.html`: panel interno de aprobaciones. Pide una clave y lee la hoja de Google.
- `index.html`: portada pública. No debe listar tableros.
- `borradores/`: JSON de trabajo. No se publica (está en `.gitignore`).
- La configuración privada (`../.nexo-config.json`, con endpoint y clave) vive **fuera** del repositorio. Nunca la copies aquí.
