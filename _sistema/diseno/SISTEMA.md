# Sistema de Diseño Nexo v3 · "Mesa de luz Nexo"

Guía canónica del sistema visual unificado de **Nexo Agencia Creativa**.
Todos los tableros, portales, informes y herramientas internas comparten esta única fuente de verdad.

---

## 1. Identidad de Marca Institucional

El manual de marca de Nexo prima sobre cualquier iniciativa estética.

### Colores Oficiales
| Token | Valor Hex | Especificación | Uso |
|---|---|---|---|
| `--azul` | `#1F3549` | PANTONE 2189 C | Estructural institucional, títulos, botones de navegación |
| `--verde` | `#5CB83E` | PANTONE 2271 C | Acento primario, llamadas a la acción, estado aprobado/listo |
| `--naranja` | `#E64A00` | PANTONE 021 C | Único complementario (máx. 20% del área). Cambios pedidos, alertas, urgencia |
| `--gris` | `#979797` | Cool Gray 7 C | Texto secundario y estados neutros/pendientes |
| `--verde-dk` | `#3F8A27` | Ajuste contraste | Solo para texto verde sobre fondo claro (cumple AA) |
| `--azul-tint` | `#4A7A9E` | Tinte de apoyo | Estado "corregido" y "en curso". Da contraste sobre oscuro |

> **Prohibiciones absolutas:** Violetas (`#7C3AED` y derivados), cyanes (`#38BDF8`, `#22d3ee`), esmeraldas genéricos, ámbar genérico, texto con gradiente, texto con contorno (`-webkit-text-stroke`) e itálicas decorativas.

### Tipografía
- **Familia principal:** `'Futura', 'Jost', 'Century Gothic', sans-serif`.
  - Peso 400/500 para texto corriente; peso 600/700 para encabezados y botones.
- **Códigos y datos técnicos:** `'JetBrains Mono', ui-monospace, monospace`.
- **Cifras numéricas, fechas e identificadores:** Siempre con `font-variant-numeric: tabular-nums`.

### Logotipo
El logo institucional de Nexo se presenta plano, en vector puro, respetando 2 módulos de área de protección. **Nunca se rota, nunca en 3D, sin sombra y sin distorsión.**

---

## 2. Dirección de Arte: "Mesa de luz Nexo"

Todo lo que produce Nexo (piezas de contenido, rodajes, informes) son **objetos físicos sobre una mesa de luz de estudio fotográfico**:
- **Escenario oscuro:** Fondo profundo (`--stage-0` a `--stage-3`) con malla viva WebGL y grano fino de película.
- **Papel claro:** Guiones, copies extensos y tablas densas van sobre fondo claro (`--paper-0` / `--paper-1`) con tinta contrastada (`--ink`) para evitar fatiga visual.
- **Profundidad 3D real:** Las tarjetas tienen grosor físico (`translateZ(-6px)`), doble sombra (contacto + ambiental) y responden al puntero con un resorte sutil (máx. ±8°).

---

## 3. Estados Semánticos Unificados

Todos los tableros e informes usan exactamente la misma convención de color:
- **Pendiente:** `--st-pendiente` (`#979797` / gris)
- **En curso / Corregido:** `--st-curso` / `--st-corregido` (`#4A7A9E` / azul-tint)
- **Aprobado / Listo:** `--st-aprobado` / `--st-listo` (`#5CB83E` / verde)
- **Con cambios pedidos:** `--st-cambios` (`#E64A00` / naranja)

---

## 4. Presupuesto y Reglas de Movimiento

El movimiento comunica estado y física, nunca adorno:

| Frecuencia | Ejemplos | Comportamiento permitido |
|---|---|---|
| Cientos de veces al día | Atajos, filtros, tabs | Inmediato o 120ms sin rebote |
| Decenas de veces al día | Hover tarjetas, abrir drawer, mover kanban | Sutil: 150–240ms |
| Ocasional | Modales, toasts, aprobar pieza | 200–300ms, resorte suave |
| Una vez por sesión | Entrar al tablero, sellar pieza, portada informe | Expresivo: 3D, stagger, hasta 900ms |

### Curvas Físicas
```css
--ease-out: cubic-bezier(0.23, 1, 0.32, 1);
--ease-in-out: cubic-bezier(0.77, 0, 0.175, 1);
--ease-drawer: cubic-bezier(0.32, 0.72, 0, 1);
--spring: linear(0, 0.009, 0.035 2.1%, 0.141, 0.281 6.7%, 0.723 12.9%, 0.938 16.7%, 1.017, 1.077, 1.121, 1.149 24.3%, 1.159, 1.163, 1.161, 1.154 29.9%, 1.129 32.8%, 1.051 39.6%, 1.017 43.1%, 0.991, 0.977 51%, 0.974 53.8%, 0.975 57.1%, 0.997 69.8%, 1.003 76.9%, 1);
```

### Reglas Técnicas
1. Animar únicamente `transform`, `opacity` y `clip-path`.
2. Prohibido `transition: all` y transiciones `ease-in` en UI.
3. Todo elemento interactivo lleva `:active { transform: scale(.97); }` en 140ms.
4. Efectos de puntero encapsulados en `@media (hover: hover) and (pointer: fine)`.
5. Soporte incondicional a `prefers-reduced-motion: reduce`: transiciones reducidas a fade de 180ms y elementos 3D fijados en su posición plana final.

---

## 5. Componentes Canónicos

1. **Botones (`.btn`):** `.btn-primary` (verde), `.btn-secondary` (escenario 1px luz), `.btn-ghost`, `.btn-danger`.
2. **Segmentado (`.segmented`):** Pastilla contenedora con indicador flotante deslizante (`.segmented-thumb`).
3. **Pill de estado (`.status-pill`):** Etiqueta compacta con punto de color y texto en mayúsculas tabulares.
4. **Entradas (`.input`, `.textarea`):** Versión sobre escenario oscuro y versión `.input-paper` sobre lectura clara. Foco con anillo verde de 2px; error en naranja con vibración de 300ms.
5. **Modales y Drawers:** Backdrop con `backdrop-filter: blur(12px)` y apertura con resorte.
6. **Iconos:** Sprite SVG canónico (`_sistema/diseno/iconos.svg`) con trazo de 1.5px y `stroke="currentColor"`. Prohibido el uso de emojis en interfaces.
7. **Escenario (`_sistema/diseno/escenario.js`):** WebGL1 ultraligero que se pausa fuera de vista y al cambiar de pestaña.

---

## 6. Sincronización Automática

Para actualizar las plantillas maestras sin errores humanos:
```bash
python3 _sistema/sincronizar_diseno.py          # Aplica cambios
python3 _sistema/sincronizar_diseno.py --check  # Valida sincronización
```
