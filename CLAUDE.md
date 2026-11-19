# Instrucciones del Proyecto NEXO para Claude (CLAUDE.md)

Este repositorio contiene los tableros de revisión, correcciones y aprobación de contenidos de **Nexo Agencia Creativa**, publicados en GitHub Pages:
**URL Base**: `https://carlosuzc29-eng.github.io/tableros-de-contenido/`

---

## 1. Arquitectura y Reglas Fundamentales

- **Fuente de Verdad**: Los contenidos se definen en `borradores/<cliente>-<mes>-<año>.json` y se registran en Cloud Firestore (`tableros/{id}`).
- **Plantilla Maestra**: `_sistema/plantilla-tablero.html`. Nunca crees ni edites archivos HTML en la raíz manualmente; todos los tableros se compilan automáticamente desde su JSON con `_sistema/construir.py`.
- **Pruebas obligatorias**: Antes de publicar cualquier cambio en `_sistema/` o `index.html`, ejecutar `node _sistema/pruebas/probar_todo.js`; si falla, no publicar.
- **Aislamiento de Secretos**: Las credenciales de Firebase viven como secretos de GitHub Actions (`NEXO_FIREBASE_EMAIL`, `NEXO_FIREBASE_PASSWORD`) y, en la Mac, en `../.nexo-config.json` (fuera del repositorio). Nunca expongas credenciales en archivos públicos.
- **Un solo enlace por cliente**: Cada cliente mantiene un único enlace público estable (ej. `milkarf-octubre-2026-f01f.html`). El mes nuevo reutiliza el archivo del tablero anterior para que el cliente siempre acceda a la versión vigente.

---

## 2. Esquema Oficial del Borrador JSON

Los borradores se guardan en `borradores/<cliente>-<mes>-<año>.json` (ejemplo: `borradores/moffyns-octubre-2026.json`).

### Ejemplo Mínimo Válido:

```json
{
  "cliente": "Moffyns",
  "cuenta": "moffyns_cafe",
  "mes": "Octubre",
  "anio": 2026,
  "intro": "Parrilla de contenidos correspondiente a Octubre 2026.",
  "contenidos": [
    {
      "id": "c1",
      "formato": "Reel",
      "pilar": "Antojo y producto",
      "fechaPublicacion": "09/10",
      "titulo": "Nuestras pizzas más pedidas",
      "guionLabel": "Guion / texto",
      "guion": "Línea 1 del guion\nLínea 2 con indicaciones",
      "copy": "Texto del copy o caption aquí.\n\nSegundo párrafo.",
      "hashtags": "#moffyns #pizza",
      "referencias": [
        { "label": "Referencia visual", "url": "https://instagram.com/p/..." }
      ],
      "clickupId": "86ajwpj7e"
    }
  ]
}
```

### Campos y Restricciones:
- `cliente`: Nombre comercial legible (mínimo 2 caracteres).
- `mes`: Nombre completo del mes en español capitalizado (`"Enero"`, `"Febrero"`, ..., `"Octubre"`, `"Noviembre"`, `"Diciembre"`). No usar números.
- `anio`: Entero de 4 dígitos (ej: `2026`).
- `formato`: Uno de: `Reel`, `Carrusel`, `Carrusel con video`, `Post`, `Story`, `Video`.
- `titulo`, `guion`, `copy`: Copiar literales del documento del cliente, sin resumir ni corregir ortografía por iniciativa propia.

---

## 3. Procedimiento Oficial para Crear o Actualizar un Tablero

Sigue rigurosamente estos 4 pasos:

### Paso 1: Crear o editar el borrador JSON
Crea o actualiza `borradores/<cliente>-<mes>-<año>.json` con la información del documento.

### Paso 2: Validar la integridad de los datos
Ejecuta el validador formal de Nexo:
```bash
python3 _sistema/validar_tablero.py borradores/<cliente>-<mes>-<año>.json
```
Si el validador reporta errores, corrígelos antes de continuar.

### Paso 3: Publicar subiendo solo el borrador
Haz commit y push **solo** del borrador (`git add borradores/<cliente>-<mes>-<año>.json`). La GitHub Action "Publicar tableros" ejecuta `construir.py` (sección 8). No uses `--publicar` ni hagas commit a mano de la cáscara o de `datos/`.
*¿Qué hace `construir.py` dentro de la acción?*
1. Valida el esquema y normaliza formatos y meses.
2. Sincroniza desde Firestore para **preservar revisiones, observaciones y versiones previas**.
3. Si Google Chrome está disponible en el entorno, pre-renderiza el DOM para la vista previa de iPhone/WhatsApp. Si no está disponible, genera el tablero en modo dinámico sin fallar.
4. Actualiza o crea el registro en Firestore (`tableros/{id}`).
5. La acción hace el commit de la cáscara, `datos/` y el borrador actualizado, y verifica lo publicado.

### Paso 4: Entregar el resultado
El resumen de la ejecución en GitHub (pestaña Actions) muestra la URL de GitHub Pages y el mensaje listo para enviar al cliente por WhatsApp.

---

## 4. Manejo de Tableros Existentes y Aprobaciones Previas

- **Preservación Incondicional y Sincronización con Firestore (`_sync`)**:
  `construir.py` consulta Firestore antes de compilar y compara la huella sha1 del texto local (`guion` y `copy`) con el campo `_sync` del JSON:
  - **Si el JSON no cambió desde la última sincronización** (su huella coincide con `_sync` o todavía no existe `_sync`): **Firestore manda**. Se copian al JSON `titulo`, `guion`, `copy`, `formato`, `version`, `hashtags`, `referencias`, `fechaCorreccion` y `aprobacion` en cualquier estado. Las piezas aprobadas en Firestore **no se reabren**.
  - **Solo si el JSON cambió localmente después de la última sincronización** (huella distinta de `_sync`) y la pieza está `aprobado` en Firestore: se archiva la versión aprobada previa en `versiones['v' + version]` y se avanza a `v+1` en estado `corregido`.
  - La huella técnica `_sync` se almacena exclusivamente en el archivo JSON local del borrador y nunca se inyecta en el HTML final ni en Firestore.
- **Reinicio Forzado a Solicitud de Carlos**:
  Solo si Carlos solicita explícitamente reiniciar un tablero a cero: GitHub → Actions → "Publicar tableros" → Run workflow, con la ruta del borrador y la casilla **reiniciar**.

---

## 5. Tableros de Producción en Vivo e Informes

- **Tableros de Producción**: Se definen a partir de `_sistema/plantilla-produccion.html` y se registran con `python3 _sistema/registrar_produccion.py <archivo.html>`.
- **Informes**: Se ubican en `informes/gestion/` o `informes/meta-ads/` con el snippet `_sistema/snippet-registro-informe.html` para autorregistro silencioso.

---

## 6. Comprobaciones antes de considerar el trabajo terminado

1. El archivo HTML fue generado en la raíz o carpeta correspondiente.
2. Git muestra el commit y push completados hacia `origin/main`.
3. **Después de publicar, ejecutar `verificar_publicado.js`. Si falla, avisar a Carlos de inmediato.**
4. El documento de Firestore (`tableros/{id}`) está registrado o actualizado.
5. Los contadores en el Banco de Trabajo (`index.html`) reflejan exactamente un único tablero activo para este cliente y mes.

---

## 7. Service Worker y Kill-Switch de Emergencia

El repositorio incluye un Service Worker (`sw.js`) que ofrece caché local gratuita y navegación offline para tableros e informes:
- **Estrategias**: Cache-First (Stale-While-Revalidate) para estáticos versionados (`_sistema/*`), Network-First (timeout 3 s) para HTML y JSONs.
- **Kill-Switch de Emergencia**:
  Si se requiere desinstalar inmediatamente el Service Worker en todos los clientes:
  1. En `sw.js`, cambiar `const KILL_SWITCH = false;` a `true;` y hacer push a `main`. Al activarse en los clientes, desregistra el Service Worker y purga todas las cachés.
  2. Alternativamente, acceder con el parámetro `?kill=true` en cualquier URL para forzar la purga y desinstalación local inmediata.

---

## 8. Publicación desde la nube (GitHub Actions)

- Los borradores principales (`borradores/<cliente>-<mes>-<año>.json`) **se versionan en el repositorio**. Las exportaciones `*.clickup.json`, `*.firestore.json` y las notas `*.md` siguen solo en la Mac (ignoradas en git).
- La acción `.github/workflows/publicar-tableros.yml` se dispara con cada push a `main` que agregue o modifique un borrador: valida, corre `construir.py` con las credenciales de Firebase guardadas como secretos (`NEXO_FIREBASE_EMAIL`, `NEXO_FIREBASE_PASSWORD`), registra en Firestore, hace commit de la cáscara + `datos/` + el borrador actualizado (con `_sync`) y verifica lo publicado con `verificar_publicado.js`.
- Para publicar desde cualquier computadora o desde Claude en la nube basta con hacer push del borrador; **no** se usa `--publicar` ni hace falta `.github-token`.
- Para reiniciar o reconstruir un tablero: Actions → "Publicar tableros" → Run workflow, con la ruta del borrador (y "reiniciar" si Carlos lo pidió).
- Antes de editar un borrador en la Mac, hacer `git pull`: la acción vuelve a escribir el borrador con la huella `_sync` nueva.
- El pre-render de `construir.py` corre **sin acceso a Firestore**: la cáscara refleja solo el JSON (que ya se sincronizó con Firestore al construir). La cáscara también embebe la lista de meses (`mesesIndice`) para que el selector de meses salga desde el primer render, sin saltos de diseño.
