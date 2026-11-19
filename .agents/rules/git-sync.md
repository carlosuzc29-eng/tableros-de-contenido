# Protocolo de Automatización de Git y Control de Versiones

Este protocolo rige en Antigravity IDE para Carlos Uzcátegui.
Su objetivo es simplificar y automatizar por completo los flujos de sincronización de código entre diferentes computadoras y la nube (GitHub Actions) de forma segura, rápida y consistente.

---

## Reglas Obligatorias de Flujo Git

### 1. Detección de Cambios
- Antes de cualquier sincronización o al cerrar una tarea, ejecuta internamente `git status` para verificar el estado del árbol de trabajo (archivos modificados, nuevos o eliminados).

### 2. Reglas de Borradores y Publicación en GitHub Actions
- **Borradores versionados**: Los archivos `borradores/<cliente>-<mes>-<año>.json` están versionados en git. Los archivos `*.clickup.json`, `*.firestore.json` y `*.md` permanecen únicamente en esta Mac (ignorados en `.gitignore`).
- **Antes de editar un borrador**: Ejecuta **siempre** `git pull origin main` antes de tocar cualquier archivo en `borradores/`, ya que la GitHub Action reescribe el borrador con la huella `_sync` actualizada después de publicar.
- **Publicación vía GitHub Actions**:
  - Para publicar o actualizar un tablero, haz commit y push **SOLO del borrador** (`git add borradores/<cliente>-<mes>-<año>.json`).
  - **Nunca uses `construir.py --publicar`** ni hagas commit manual de la cáscara `<codigo>.html` ni de `datos/`. La GitHub Action *"Publicar tableros"* se encarga de construir, registrar en Firestore, publicar y verificar.
  - Si ensayas localmente con `python3 _sistema/construir.py borradores/<archivo>.json` (sin `--publicar`), descarta luego los cambios locales en la cáscara y `datos/` (`git checkout -- <codigo>.html datos/`) antes de subir el borrador.
- **Aviso obligatorio en auto-commit**: Si un commit o auto-commit incluye uno o más archivos de `borradores/<cliente>-<mes>-<año>.json`, **avisa explícitamente a Carlos** que subir ese cambio va a disparar una publicación automática del tablero en GitHub Actions.
- **Reinicio de tableros**: Se realiza desde GitHub → Actions → *"Publicar tableros"* → *Run workflow*, indicando el borrador y activando la casilla **`reiniciar`**.
- **Post-publicación**: Una vez que termine la GitHub Action, ejecuta `git pull origin main` para traer el commit generado por la acción (con la nueva huella `_sync`, cáscara y `datos/`).

### 3. Auto-Commit Inteligente
- Si se detectan modificaciones pendientes:
  - Añade los cambios correspondientes con `git add` (respetando la regla de subir solo el borrador cuando se trate de publicar un tablero, y verificando si hay borradores involucrados para avisar a Carlos que dispararán una publicación).
  - Redacta de forma autónoma un mensaje de commit breve, profesional y descriptivo basado en los cambios reales (por ejemplo: `Borrador <cliente> <mes> <año>`, `feat: actualización de componentes y estilos`, `fix: corrección de enlaces y tipografía`).

### 4. Sincronización Bidireccional
- **Al iniciar sesión, empezar a trabajar o antes de editar un borrador** (activadores: *"empezar"*, *"iniciar"*, *"pull"*, *"traer cambios"*, *"comenzar"*, o edición de `borradores/*.json`):
  - Ejecuta inmediatamente `git pull origin main`.
  - Notifica a Carlos de forma clara si se recibieron cambios nuevos o si el repositorio ya se encontraba al día.
- **Al finalizar o guardar avance** (activadores: *"sincronizar"*, *"guardar y subir"*, *"push"*, *"terminé"*, *"guardar"*):
  - Verifica cambios, avisa si algún borrador modificado va a disparar una publicación en GitHub Actions, realiza el auto-commit y ejecuta `git push origin main`.
  - Confirma a Carlos que el código quedó subido al repositorio remoto.

### 5. Manejo Estricto de Conflictos de Fusión
- Si en cualquier momento ocurre un `merge conflict`:
  - **Detén de inmediato** cualquier acción automática.
  - Informa a Carlos con exactitud qué archivos entraron en conflicto.
  - Analiza y explica las diferencias encontradas (`<<<<<<< HEAD` vs `>>>>>>>`).
  - Propón la resolución recomendada paso a paso para proceder con su autorización.
