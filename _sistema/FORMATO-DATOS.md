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

## Reglas para pasar el documento del mes a este JSON

- Un objeto por contenido, **en el mismo orden** del documento. La numeración 01, 02… la pone el tablero.
- Documentos de Nexo: `N. FORMATO — TÍTULO` → `formato` es lo de antes de la raya y `titulo` lo de después (en tipo oración, respetando nombres propios). `guion` es todo entre `GUION / TEXTO` y `CAPTION`. `copy` es todo después de `CAPTION`.
- **Copiar literal: no resumir, corregir ni reescribir guiones ni copys.** Si hay errores de tipeo, se avisan aparte, no se corrigen.
- Guion: un párrafo por línea (`\n`), con una línea en blanco antes de cada `Slide N`. Copy: párrafos separados con `\n\n`. Los hashtags del final del copy van en `hashtags`.
- Formatos normalizados: Reel, Carrusel, Post, Story, Video, TikTok. Los compuestos se mantienen ("Reel / Post", "Post meme").
- Campos que no existen en el documento van vacíos: `""` o `[]`.
- Las URLs del contenido van en `referencias`, solo las que empiezan con http/https.
