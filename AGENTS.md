# Instrucciones para el agente (Claude / Antigravity)

Repositorio de tableros de aprobación de contenidos de **Nexo Agencia Creativa**, publicado en GitHub Pages:
`https://carlosuzc29-eng.github.io/tableros-de-contenido/`

Responde siempre en español latinoamericano neutro, con "tú". Sé breve, riguroso y profesional.

## Ahorro de créditos y calidad técnica (obligatorio)

- **No regeneres ni reescribas archivos HTML completos a mano.** Los tableros se construyen automáticamente con `python3 _sistema/construir.py`, que pre-renderiza con Chrome headless para garantizar la vista previa de iPhone y no consume créditos.
- Para un tablero nuevo, tu único trabajo es crear `borradores/<cliente>-<mes>-<año>.json` desde el documento, siguiendo `_sistema/FORMATO-DATOS.md`. Luego ejecuta el script con `--publicar`.
- Para cambios de diseño o lógica, edita **únicamente** `_sistema/plantilla-tablero.html` o `_sistema/fondo-red.js` con cambios quirúrgicos. Luego reconstruye los tableros con `construir.py`.
- **Antes de publicar cualquier cambio en `_sistema/` o `index.html`, ejecutar `node _sistema/pruebas/probar_todo.js`; si falla, no publicar.**
- No toques los tableros HTML de la raíz manualmente; siempre compílalos desde sus borradores para mantener sincronizados el DOM pre-renderizado, el JSON incrustado y el registro en Cloud Firestore.

## Flujo para un tablero nuevo o actualización

1. **Leer el documento del mes** que pase Carlos (guiones, copies, formatos).
2. **Crear o actualizar** `borradores/<cliente>-<mes>-<año>.json` (siguiendo estrictamente `_sistema/FORMATO-DATOS.md` y `CLAUDE.md`).
   - El mes en el nombre de archivo y en el JSON debe ser el nombre del mes (ej. `"Octubre"`), no un número, para evitar IDs inconsistentes.
3. **Validar esquema y datos**:
   ```bash
   python3 _sistema/validar_tablero.py borradores/<cliente>-<mes>-<año>.json
   ```
4. **Construir y publicar**:
   ```bash
   python3 _sistema/construir.py borradores/<cliente>-<mes>-<año>.json --publicar
   ```
5. **Verificar que no existan errores**:
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
2. Reconstruir con `python3 _sistema/construir.py ... --publicar` (el script genera automáticamente un nuevo `resetAt` que invalida borradores locales en navegadores, restablece las métricas en 0 y vacía el campo `contenidos` en Firestore).

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

- `_sistema/tablero/tablero.css`: CSS unificado y centralizado compartido por todos los tableros.
- `_sistema/tablero/tablero.js`: JavaScript unificado con el motor de fondo de red Canvas 2D, gestión de selector multi-mes, modo cliente y Modo Agencia.
- `_sistema/plantilla-tablero.html`: cáscara liviana del tablero (referencia `tablero.css` y `tablero.js`, e incluye el respaldo embebido `board-data`).
- `datos/<codigo-cliente>/indice.json`: índice de meses publicados para cada cliente (ordenado descendente, fija `actual` al mes más reciente).
- `datos/<codigo-cliente>/<aaaa-mm>.json`: datos de cada mes publicados sin campos internos.
- `_sistema/fondo-red.js`: motor de la red de conexiones animada multi-escala.
- `_sistema/construir.py`: motor que genera el JSON del mes en `datos/`, actualiza el `indice.json`, pre-renderiza la cáscara liviana con Chrome headless, registra en Cloud Firestore y publica en git.
- `_sistema/migrar_v2.py`: script de migración para convertir tableros legados a la arquitectura v2 sin tocar Firestore.
- `index.html`: Banco de trabajo interno de Nexo conectado a Firebase en tiempo real.
- `borradores/`: borradores JSON de trabajo (privados, ignorados en git).
- La configuración privada (`../.nexo-config.json`) vive **fuera** del repositorio con credenciales de Firebase. Nunca la copies al repositorio público.

## Reglas de Arquitectura v2 (Selector Multi-Mes)
1. **Un solo enlace por cliente**: el nombre del archivo HTML (ej. `milkarf-octubre-2026-f01f.html`) se mantiene mes a mes. La carpeta de datos `datos/<codigo-cliente>/` utiliza ese mismo código aleatorio para proteger la privacidad.
2. **Mes actual**: el cliente puede evaluar (aprobar, pedir cambios, añadir comentarios, cambiar formato y enviar revisión). El autorregistro en Firestore está habilitado.
3. **Meses anteriores (`?mes=aaaa-mm`)**: modo **solo lectura** para el cliente.
   - Muestra una franja superior: *"Estás viendo la parrilla de [Mes Año]. Es un mes cerrado: solo lectura."* con un botón para volver al mes actual.
   - Todos los controles de evaluación, input de revisor y dock de envío se ocultan o desactivan.
   - **NUNCA escribir en Firestore desde un mes cerrado**: ni autorregistro ni revisiones de cliente.
   - **Modo Agencia**: Carlos y Andrea con sesión autenticada sí pueden editar y guardar correcciones en meses cerrados.
4. **Respaldo sin JavaScript**: la cáscara lleva el HTML pre-renderizado del mes actual (Chrome headless) y el `<script id="board-data">` de respaldo. Si falla `fetch('datos/...')` o no hay conexión, el tablero funciona de forma idéntica con el respaldo.

## Banco de trabajo (index.html)

El archivo `index.html` es el Banco de Trabajo interno de Nexo para gestionar y visualizar todos los tableros creados:
- Se conecta en tiempo real a Firebase Cloud Firestore (`onSnapshot`) con autenticación Firebase.
- Agrupa los tableros por cliente de forma automática (mes más reciente como principal e historial desplegable para meses previos).
- Detalle por contenido con comentarios del cliente, filtros por estado (Todos, Aprobados, Con cambios, Pendientes) y descargas en Word (.doc) y JSON.
- Pestaña de Producción para seguimiento en vivo de pautas de rodaje.
- **Regla estricta de seguridad**: Nunca se escriben nombres de clientes, URLs de tableros ni claves privadas dentro de archivos del repositorio público.

## Correcciones: reglas de guardado

Para garantizar que ninguna corrección se pierda, no se descarten saltos de línea ni se pisen campos entre personas o pestañas:
1. **Modo Agencia (`plantilla-tablero.html`) — Guardado seguro por pieza (`guardarPiezas`)**:
   - Nunca reconstruye el arreglo `contenidos` desde el estado local de memoria.
   - Realiza un `GET` a Firestore, obtiene `updateTime` y fusiona cada pieza afectada (`Object.assign({}, piezaFirestore, cambios)`), preservando intactos todos los campos no modificados (`historial`, `versiones`, `borrador`, `hashtags`, `referencias`, `pilar`, `fechaPublicacion`, `comentarios[].atendido`).
   - Control de concurrencia optimista (`&currentDocument.updateTime=<updateTime>`) con hasta 3 reintentos automáticos si responde 400/409/412 (`FAILED_PRECONDITION`).
   - Si la escritura falla: **jamás mostrar "✓"**. Se muestra aviso claro ("No se guardó en la nube. Reintentar"), botón de reintento y badge de "Sin guardar".
   - `doSend` (cliente): envía solo `estado`, `comentario`, `revisadoPor`, `formato` y snapshot `aprobacion`. **El cliente nunca envía `guion`, `copy` ni `titulo`.**
   - Notas internas de agencia (ej. "Pieza corregida a versión v2…"): van exclusivamente a `historial`, nunca a `comentario` ni `comentarios`.
2. **Preservación de saltos de línea (`leerTextoEditable`)**:
   - Los campos editables usan `contenteditable="plaintext-only"` y `leerTextoEditable`, que convierte `<br>` y `<div>/<p>/<li>` en `\n`, normaliza espacios y descarta líneas en blanco excesivas.
   - Validación previa con alerta visual no bloqueante si se detectan frases pegadas sin salto (`/[.?!…:][A-ZÁÉÍÓÚÑ¿¡]/`).
3. **Banco de trabajo (`index.html`) — Transacciones atómicas (`actualizarPieza`)**:
   - Toda mutación de contenidos en `index.html` se ejecuta mediante `db.runTransaction`, leyendo el documento fresco de Firestore y recalculando contadores y estado general de forma atómica.
   - Si una pieza tiene un `borrador` de corrección pendiente distinto del texto actual, se bloquea la aprobación advirtiendo al usuario.
4. **Instantánea de aprobación congelada (`aprobacion`)**:
   - Cada vez que una pieza pasa a `aprobado` (cliente, agencia o banco), se guarda:
     `{version, usuario, fecha, titulo, formato, guion, copy, hashtags}` tomando el texto exacto aprobado en Firestore.
5. **Seguimiento en `construir.py` con huella `_sync`**:
   - Guarda la huella sha1 de `guion` y `copy` en `_sync`.
   - Si el JSON no cambió localmente desde la última sincronización, **Firestore manda**: se sincronizan textos y estados sin reabrir piezas aprobadas.
   - Solo si el JSON cambió localmente a mano y la pieza está `aprobado` en Firestore, se archiva la aprobación previa en `versiones['v' + fs_version]` y se pasa a `v+1` `corregido`.
   - La huella `_sync` se almacena solo en el JSON local y nunca se inyecta en el HTML publicado.
6. **Fuente única para ClickUp (`_sistema/preparar_clickup.py`)**:
   - Genera `borradores/<cliente>-<mes>-<año>.clickup.json` con prioridad: instantánea `aprobacion` > `firestore` > `borrador`.
   - Determina `listo: true` solo si todas las piezas están aprobadas y no hay bloqueantes. Produce la descripción formateada exacta para ClickUp.



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

## Informes

- **Carpetas**:
  - `informes/gestion/`: Informes de Gestión y Rendimiento.
  - `informes/meta-ads/`: Informes de Meta Ads.
- **Formato del nombre**:
  - `<cliente-slug>-<aaaa-mm>-<código>.html` (por ejemplo: `cliente-ejemplo-2026-10-000000.html`).
  - El cliente se escribe en minúsculas separado por guiones (`<cliente-slug>`).
  - La fecha sigue el formato numérico de año de cuatro dígitos y mes de dos dígitos (`<aaaa-mm>`).
  - Código único al final (`<código>`).
- **Etiquetas meta obligatorias y autorregistro**:
  - Cada informe debe llevar estas 3 etiquetas meta en el `<head>`:
    - `<meta name="nexo-informe" content="gestion">` (o `content="meta-ads"` según el tipo de informe).
    - `<meta name="nexo-cliente" content="Nombre del Cliente">` (nombre oficial en formato legible).
    - `<meta name="nexo-periodo" content="aaaa-mm">` (ej. `2026-10`).
  - Cada informe debe incluir antes de `</body>` el snippet de registro contenido en `_sistema/snippet-registro-informe.html`. Esto permite que el informe se autorregistre de forma silenciosa y sin credenciales en la colección `informes` de Cloud Firestore la primera vez que se abre.
- **Regla estricta de no enlazar el resto de la web**:
  - Los informes son páginas independientes para cada cliente con directiva `<meta name="robots" content="noindex, nofollow">`.
  - **No enlazar el resto de la web**: No deben incluir enlaces hacia el Banco de trabajo (`index.html`), hacia el Espacio Creativo ni hacia otros clientes o tableros de la web.
  - En el Banco de trabajo (`index.html`) está terminantemente prohibido escribir nombres de clientes o enlaces en el código HTML; el listado se consulta y sincroniza de forma dinámica y en tiempo real desde la colección `informes` de Cloud Firestore con sesión iniciada.

