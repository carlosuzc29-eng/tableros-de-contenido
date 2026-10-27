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

**Un enlace por cliente.** El JSON de un mes nuevo se crea sin `archivo`: `construir.py` toma el del mes anterior del mismo cliente (buscándolo en `borradores/`), así el cliente siempre usa el mismo enlace y ve el mes nuevo al recargar. Si el JSON se copió de otro mes, el script limpia la revisión anterior. Para forzar un enlace distinto: `--nuevo-enlace`.

`construir.py` agrega solo: `archivo` (nombre con código aleatorio, uno por cliente), `id`, `url`, `endpoint`, `estado`, `comentario` y `revision`.

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

- Un objeto por contenido, **en el mismo orden** del documento. La numeración 01, 02… la pone el tablero.
- Documentos de Nexo: `N. FORMATO — TÍTULO` → `formato` es lo de antes de la raya y `titulo` lo de después (en tipo oración, respetando nombres propios). `guion` es todo entre `GUION / TEXTO` y `CAPTION`. `copy` es todo después de `CAPTION`.
- **Copiar literal: no resumir, corregir ni reescribir guiones ni copys.** Si hay errores de tipeo, se avisan aparte, no se corrigen.
- Guion: un párrafo por línea (`\n`), con una línea en blanco antes de cada `Slide N`. Copy: párrafos separados con `\n\n`. Los hashtags del final del copy van en `hashtags`.
- Formatos normalizados: Reel, Carrusel, Post, Story, Video, TikTok. Los compuestos se mantienen ("Reel / Post", "Post meme").
- Campos que no existen en el documento van vacíos: `""` o `[]`.
- Las URLs del contenido van en `referencias`, solo las que empiezan con http/https.
