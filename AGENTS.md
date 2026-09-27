# Instrucciones para el agente (Claude / Antigravity)

Repositorio de tableros de aprobación de contenidos de **Nexo Agencia Creativa**, publicado en GitHub Pages:
`https://carlosuzc29-eng.github.io/tableros-de-contenido/`

Responde siempre en español latinoamericano neutro, con "tú". Sé breve, riguroso y profesional.

## Ahorro de créditos y calidad técnica (obligatorio)

- **No regeneres ni reescribas archivos HTML completos a mano.** Los tableros se construyen automáticamente con `python3 _sistema/construir.py`, que pre-renderiza con Chrome headless para garantizar la vista previa de iPhone y no consume créditos.
- Para un tablero nuevo, tu único trabajo es crear `borradores/<cliente>-<mes>-<año>.json` desde el documento, siguiendo `_sistema/FORMATO-DATOS.md`. Luego ejecuta el script con `--publicar`.
- Para cambios de diseño o lógica, edita **únicamente** `_sistema/plantilla-tablero.html` o `_sistema/fondo-red.js` con cambios quirúrgicos. Luego reconstruye los tableros con `construir.py`.
- No toques los tableros HTML de la raíz manualmente; siempre compílalos desde sus borradores para mantener sincronizados el DOM pre-renderizado, el JSON incrustado y el registro en Cloud Firestore.

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
   - Sincronizado en tiempo real en el Banco de trabajo (`index.html`).
5. **Entregar al usuario**:
   - Enlace final de GitHub Pages.
   - Mensaje listo para WhatsApp formateado.

## Reinicio de tableros para clientes

Si Carlos pide **reiniciar un tablero**:
1. Asegurar en `borradores/<cliente>-<mes>-<año>.json`:
   - `"revision": { "revisadoPor": "", "fecha": "" }`
   - Todos los contenidos en `"estado": "pendiente"` y `"comentario": ""`
2. Reconstruir con `python3 _sistema/construir.py ... --publicar` (el script genera automáticamente un nuevo `resetAt` que invalida borradores viejos en los navegadores de prueba).
3. Restablecer el documento en Cloud Firestore si habían revisiones previas registradas.

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

- `_sistema/plantilla-tablero.html`: plantilla maestra del tablero (envía revisiones directamente a Cloud Firestore vía REST).
- `_sistema/fondo-red.js`: motor de la red de conexiones animada multi-escala.
- `_sistema/construir.py`: motor que genera, pre-renderiza con Chrome, registra en Cloud Firestore y publica en git.
- `index.html`: Banco de trabajo interno de Nexo conectado a Firebase en tiempo real.
- `borradores/`: borradores JSON de trabajo (privados, ignorados en git).
- La configuración privada (`../.nexo-config.json`) vive **fuera** del repositorio con credenciales de Firebase. Nunca la copies al repositorio público.

## Banco de trabajo (index.html)

El archivo `index.html` es el Banco de Trabajo interno de Nexo para gestionar y visualizar todos los tableros creados:
- Se conecta en tiempo real a Firebase Cloud Firestore (`onSnapshot`) con autenticación Firebase.
- Agrupa los tableros por cliente de forma automática (mes más reciente como principal e historial desplegable para meses previos).
- **Regla estricta de seguridad**: Nunca se escriben nombres de clientes, URLs de tableros ni claves privadas dentro de archivos del repositorio público.


## Tableros de producción (días de pauta)

- **Plantilla**: `_sistema/plantilla-produccion.html` (Kanban móvil interactivo: Por hacer / Grabando / Listo). Claude la usa desde este repositorio; los cambios de diseño y funcionalidad se hacen aquí con ediciones puntuales sin alterar la estructura general.
- **Lo que NO se debe tocar**:
  - El marcador exacto `// ESTOS SON LOS DATOS BASE QUE CLAUDE DEBE REEMPLAZAR CADA VEZ QUE LO USES` y la estructura base del bloque `const DATA = {...}`. Solo se agregan campos opcionales `id` y `firebase: {apiKey, projectId}`.
  - Las funciones principales de interacción: `openViewModal`, `moverEstado`, `LS_KEY` y la configuración de Sortable (`delayOnTouchOnly`).
- **Modelo de datos en Firestore (`produccion/{id}`)**:
  - Cada tablero se registra en la colección `produccion` bajo el id del archivo sin `.html` (ej. `bambu-bistro-2026-10-03-a1b2c3`).
  - **Campos**:
    - `id`: string identificador único del tablero.
    - `cliente`: string con el nombre del cliente.
    - `fecha`: string con la fecha del rodaje o pauta.
    - `url`: string con la URL pública publicada en GitHub Pages.
    - `registrado`: string con fecha ISO de creación.
    - `orden`: arreglo de strings con los IDs de las tarjetas según el orden del tablero.
    - `tarjetas`: mapa `{ [idTarjeta]: objetoTarjeta }` donde cada tarjeta incluye `titulo`, `tipo`, `sede`, `estado`, `descripcion`, `subtareas` y `mediaLinks`. Se usa un mapa por tarjeta (en lugar de un arreglo) para permitir actualizaciones concurrentes atómicas con notación de punto (`tarjetas.<id>`) sin pisar cambios de otros usuarios.
    - `todo`, `grabando`, `listo`: números enteros con el total por columna.
    - `actualizado`: timestamp del servidor (`serverTimestamp()`).
- **Sincronización en vivo y modo sin señal**:
  - `enablePersistence({ synchronizeTabs: true })` de Firestore permite operar sin conexión a internet y sincroniza cambios pendientes automáticamente al reconectarse.
  - `onSnapshot` escucha cambios remotos reconstruyendo `state.contenidos` a partir de `orden` + `tarjetas`, ignorando cambios locales con `metadata.hasPendingWrites` para evitar parpadeos.
  - Indicador de estado en cabecera: punto visual "En vivo" (verde `#5CB83E`) o "Sin conexión" (gris).
- **Script de registro**:
  - `_sistema/registrar_produccion.py <ruta/al/tablero.html>`
  - Lee el bloque `DATA` del HTML, inicia sesión mediante REST API con las credenciales de `../.nexo-config.json`, inyecta `DATA.id` y `DATA.firebase` en el archivo local, y crea o reemplaza el documento `produccion/{id}` en Firestore con su estado inicial.
- **Publicación**:
  - Los tableros generados se publican en `produccion/<cliente>-<fecha>-<código>.html` (enlace privado, `noindex`).

