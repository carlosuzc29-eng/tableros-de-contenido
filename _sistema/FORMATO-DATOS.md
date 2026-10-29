# Formato del JSON de un tablero

Un archivo por tablero en `borradores/` (esa carpeta no se publica). Ejemplo: `borradores/milkarf-noviembre-2026.json`.

```json
{
  "cliente": "Milkarf",
  "cuenta": "milkarfood",
  "mes": "Noviembre",
  "anio": 2026,
  "intro": "",
  "contenidos": [
    {
      "formato": "Reel",
      "pilar": "",
      "fechaPublicacion": "",
      "titulo": "Experiencias reales",
      "guionLabel": "Guion / texto",
      "guion": "Línea 1\nLínea 2",
      "copy": "Párrafo 1\n\nPárrafo 2",
      "hashtags": "",
      "referencias": [{ "label": "Reel de referencia", "url": "https://..." }]
    }
  ]
}
```

**Un enlace por cliente y selector multi-mes (v2).** El enlace de cada cliente no cambia nunca (ej. `milkarf-octubre-2026-f01f.html`). El diseño está desacoplado de los datos:
- `_sistema/tablero/tablero.css`: estilos CSS compartidos por todos los tableros.
- `_sistema/tablero/tablero.js`: motor JS unificado (modo cliente + Modo Agencia).
- `_sistema/plantilla-tablero.html`: cáscara liviana pre-renderizada con Chrome headless del mes actual como respaldo offline.
- `datos/<codigo-cliente>/indice.json`: índice de meses del cliente (ordenado de más reciente a más antiguo, con `actual` fijado al mes en curso).
- `datos/<codigo-cliente>/<aaaa-mm>.json`: datos de cada mes publicados sin campos internos.

### Selector de meses y reglas de solo lectura:
- **Mes actual:** el cliente evalúa (aprueba, pide cambios, comenta, cambia formato, envía revisión). Autorregistro en Firestore habilitado.
- **Meses anteriores (`?mes=aaaa-mm`):** modo **solo lectura** para el cliente. Muestra una franja superior: *"Estás viendo la parrilla de [Mes Año]. Es un mes cerrado: solo lectura."* con botón para ir al mes actual. Se ocultan y bloquean los controles de evaluación, nombre y envío. **Nunca se escribe en Firestore desde un mes cerrado**.
- **Modo Agencia en meses anteriores:** Carlos y Andrea con sesión activa sí pueden ver y editar textos/correcciones en meses cerrados.

`construir.py` agrega: `archivo` (nombre con código aleatorio, uno por cliente), `id`, `url`, `endpoint`, `estado`, `comentario` y `revision`.

## Campos opcionales y extendidos del flujo de aprobación
- `aprobacion`: Objeto con la instantánea congelada del texto en el momento exacto en que fue aprobado:
  ```json
  {
    "version": 1,
    "usuario": "Cliente (o Agencia)",
    "fecha": "2026-10-27T10:00:00.000Z",
    "titulo": "Título de la pieza",
    "formato": "Reel",
    "guion": "Texto exacto aprobado...",
    "copy": "Texto exacto de copy aprobado...",
    "hashtags": "#nexo #contenido"
  }
  ```
  Permite a la skill de ClickUp leer exactamente qué texto aprobó el cliente sin adivinar versiones ni verse afectado por ediciones posteriores.
- `historial`: Lista de eventos de corrección y revisiones internas de la pieza (fecha, versión, notas técnicas de agencia). Las notas automáticas de corrección viven aquí y no en `comentario`/`comentarios`.
- `_sync`: Objeto interno de control en los archivos JSON de `borradores/`:
  ```json
  {
    "guion": "sha1_hash...",
    "copy": "sha1_hash...",
    "version": 1
  }
  ```
  Permite a `construir.py` determinar si el JSON fue editado a mano tras la última sincronización con Firestore. Si no cambió, Firestore manda y no se reabren aprobados. **Nunca se publica en el HTML final**.
- `huellasClickup`: Diccionario opcional en el borrador `{ "c1": "sha1_hash...", "c2": "..." }` para registrar qué piezas ya fueron subidas a ClickUp y permitir re-sincronizaciones parciales marcando piezas como `sin_cambios` o `texto_cambio`.
- `borrador`: Objeto temporal utilizado en el Banco de trabajo (`index.html`) para almacenar una edición de guion/copy en curso antes de "Guardar como corregido". Si una pieza tiene un `borrador` activo, el sistema bloquea su aprobación hasta resolverlo.

## Reglas para pasar el documento del mes a este JSON

- **Orden oficial** (lo revisa `validar_tablero.py` y lo aplica `python3 _sistema/orden_tablero.py <borrador> --ordenar`): primero todas las piezas Orgánicas y después todas las de Ads; dentro de cada bloque, por fecha de publicación; a igual fecha, por número de `CONTENIDO N` y luego por fecha de creación en ClickUp; sin fecha, al final del bloque. La numeración 01, 02… la pone el tablero.
- Documentos de Nexo: `N. FORMATO — TÍTULO` → `formato` es lo de antes de la raya y `titulo` lo de después (en tipo oración, respetando nombres propios). `guion` es todo entre `GUION / TEXTO` y `CAPTION`. `copy` es todo después de `CAPTION`.
- **Copiar literal: no resumir, corregir ni reescribir guiones ni copys.** Si hay errores de tipeo, se avisan aparte, no se corrigen.
- Guion: un párrafo por línea (`\n`), con una línea en blanco antes de cada `Slide N`. Copy: párrafos separados con `\n\n`. Los hashtags del final del copy van en `hashtags`.
- Formatos (los mismos del campo "Tipo de contenido" de ClickUp): `Reel`, `Carrusel`, `Carrusel con video`, `Post`, `Historia`, `Fotografía`, `Folleto`. Se copian tal cual vienen de ClickUp, sin reducirlos a Post.
- `canal`: `"Ads"` si la pieza es de publicidad paga (etiqueta `ads` en ClickUp) u `"Orgánico"` si no. El tablero muestra la etiqueta en cada tarjeta y, si hay piezas de los dos canales, un filtro Todos / Orgánicos / Ads. Para que se vean en dos bloques, ordenar el JSON con los orgánicos primero y luego los de Ads.
- Campos que no existen en el documento van vacíos: `""` o `[]`.
- Las URLs del contenido van en `referencias`, solo las que empiezan con http/https.
