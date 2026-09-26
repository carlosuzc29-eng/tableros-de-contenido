# Instrucciones para el agente (Claude / Antigravity)

Repositorio de tableros de aprobación de contenidos de **Nexo Agencia Creativa**, publicado en GitHub Pages:
`https://carlosuzc29-eng.github.io/tableros-de-contenido/`

Responde siempre en español latinoamericano neutro, con "tú". Sé breve, riguroso y profesional.

## Ahorro de créditos y calidad técnica (obligatorio)

- **No regeneres ni reescribas archivos HTML completos a mano.** Los tableros se construyen automáticamente con `python3 _sistema/construir.py`, que pre-renderiza con Chrome headless para garantizar la vista previa de iPhone y no consume créditos.
- Para un tablero nuevo, tu único trabajo es crear `borradores/<cliente>-<mes>-<año>.json` desde el documento, siguiendo `_sistema/FORMATO-DATOS.md`. Luego ejecuta el script con `--publicar`.
- Para cambios de diseño o lógica, edita **únicamente** `_sistema/plantilla-tablero.html` o `_sistema/fondo-red.js` con cambios quirúrgicos. Luego reconstruye los tableros con `construir.py`.
- No toques los tableros HTML de la raíz manualmente; siempre compílalos desde sus borradores para mantener sincronizados el DOM pre-renderizado, el JSON incrustado y el registro en Google Sheets.

## Flujo para un tablero nuevo o actualización

1. **Leer el documento del mes** que pase Carlos (guiones, copies, formatos).
2. **Crear o actualizar** `borradores/<cliente>-<mes>-<año>.json` (siguiendo estrictamente `_sistema/FORMATO-DATOS.md`).
   - El mes en el nombre de archivo y en el JSON debe ser el nombre del mes (ej. `"Octubre"`), no un número, para evitar IDs inconsistentes.
3. **Construir y publicar**:
   ```bash
   python3 _sistema/construir.py borradores/<cliente>-<mes>-<año>.json --publicar
   ```
4. **Verificar que no existan errores**:
   - Tablero con 0 revisiones previas (estado inicial limpio: 0 aprobados, 0 con cambios, todos pendientes).
   - En móviles: desplazamiento vertical completamente fluido sin rebotes ni saltos a la parte superior.
   - Sincronizado en el panel interno (`panel-*.html`) sin duplicados de tarjeta.
5. **Entregar al usuario**:
   - Enlace final de GitHub Pages.
   - Mensaje listo para WhatsApp formateado.

## Reinicio de tableros para clientes

Si Carlos pide **reiniciar un tablero**:
1. Asegurar en `borradores/<cliente>-<mes>-<año>.json`:
   - `"revision": { "revisadoPor": "", "fecha": "" }`
   - Todos los contenidos en `"estado": "pendiente"` y `"comentario": ""`
2. Reconstruir con `python3 _sistema/construir.py ... --publicar` (el script genera automáticamente un nuevo `resetAt` que invalida borradores viejos en los navegadores de prueba).
3. Restablecer la fila en la hoja de cálculo de Google a través del endpoint si habían revisiones previas registradas.

## Reglas críticas de UX/UI y Frontend

- **Prohibido usar `scrollIntoView` en la barra fija o navegación durante el scroll:** El centrado del selector numérico horizontal debe hacerse exclusivamente con `navContainer.scrollTo({ left: targetLeft, behavior: 'smooth' })` o `navContainer.scrollLeft`. Jamás usar `c.nav.scrollIntoView()`, ya que en iOS Safari provoca que toda la ventana salte hacia arriba.
- **Evitar dobles `overflow-x: hidden`:** Usar `overflow-x: clip` en el body para prevenir desbordes horizontales sin bloquear el scroll de inercia ni `position: sticky`.
- **Canvas dinámico responsivo:** El canvas de red debe ignorar cambios menores de altura (< 150px) en dispositivos táctiles para no parpadear ni recalcularse cuando la barra del navegador móvil se colapsa.
- **Paso obligatorio de evaluación:** Todo contenido debe ser evaluado (Aprobar o Solicitar cambios) antes de enviar. Si se solicitan cambios, es obligatorio detallar el comentario. El nombre del cliente se pide una sola vez al final.

## No tocar en la plantilla

- `__DATA__` y `<script id="board-data" type="application/json">`
- Los id que usa el JavaScript: `list`, `nav`, `who`, `dl`, `dlMini`, `rOk`, `rFix`, `pct`, `sOk`, `sFix`, `sPend`, `dN`, `openLink`, `modal`, `box`, `toast`, `intro`, `reviewed`, `metaTitle`, `empty`
- Colores de marca: azul `#1F3549`, verde Nexo `#5CB83E` y naranja `#E64A00` como único complementario.

## Archivos clave

- `_sistema/plantilla-tablero.html`: plantilla maestra del tablero.
- `_sistema/fondo-red.js`: motor de la red de conexiones animada multi-escala.
- `_sistema/construir.py`: motor que genera, pre-renderiza con Chrome, registra en Google Sheets y publica en git.
- `panel-*.html`: panel interno de aprobaciones de Nexo.
- `borradores/`: borradores JSON de trabajo (privados, ignorados en git).
- La configuración privada (`../.nexo-config.json`) vive **fuera** del repositorio. Nunca la copies al repositorio público.
