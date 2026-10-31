# Protocolo de Automatización de Git y Control de Versiones

Este protocolo rige en Antigravity IDE para Carlos Uzcátegui.
Su objetivo es simplificar y automatizar por completo los flujos de sincronización de código entre diferentes computadoras de forma segura, rápida y consistente.

---

## Reglas Obligatorias de Flujo Git

### 1. Detección de Cambios
- Antes de cualquier sincronización o al cerrar una tarea, ejecuta internamente `git status` para verificar el estado del árbol de trabajo (archivos modificados, nuevos o eliminados).

### 2. Auto-Commit Inteligente
- Si se detectan modificaciones pendientes:
  - Añade todos los cambios correspondientes con `git add .` (o archivos relevantes).
  - Redacta de forma autónoma un mensaje de commit breve, profesional y descriptivo basado en los cambios reales (por ejemplo: `feat: actualización de componentes y estilos`, `fix: corrección de enlaces y tipografía`).

### 3. Sincronización Bidireccional
- **Al iniciar sesión o empezar a trabajar** (activadores: *"empezar"*, *"iniciar"*, *"pull"*, *"traer cambios"*, *"comenzar"*):
  - Ejecuta inmediatamente `git pull origin main` (o la rama principal activa).
  - Notifica a Carlos de forma clara si se recibieron cambios nuevos o si el repositorio ya se encontraba al día.
- **Al finalizar o guardar avance** (activadores: *"sincronizar"*, *"guardar y subir"*, *"push"*, *"terminé"*, *"guardar"*):
  - Verifica cambios, realiza el auto-commit si hay modificaciones pendientes y ejecuta `git push origin main`.
  - Confirma a Carlos que el código quedó subido al repositorio remoto.

### 4. Manejo Estricto de Conflictos de Fusión
- Si en cualquier momento ocurre un `merge conflict`:
  - **Detén de inmediato** cualquier acción automática.
  - Informa a Carlos con exactitud qué archivos entraron en conflicto.
  - Analiza y explica las diferencias encontradas (`<<<<<<< HEAD` vs `>>>>>>>`).
  - Propón la resolución recomendada paso a paso para proceder con su autorización.
