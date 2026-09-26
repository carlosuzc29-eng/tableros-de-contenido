/**
 * NEXO · Fondo Dinámico de Red de Conexiones (Canvas 2D)
 * 
 * Componente frontend reutilizable para fondos sutiles de constelación/red de datos.
 * Diseñado específicamente para integrarse en la sección hero oscura de Nexo (--azul: #1F3549)
 * utilizando exclusivamente la paleta de identidad corporativa:
 *   - Fondo: #1F3549 (--azul)
 *   - Acento de pulso y nodos: #5CB83E (--verde)
 *   - Nodos y enlaces base: #E6EBF0 (--azul-soft) y blanco con opacidades calibradas
 * 
 * CARACTERÍSTICAS TÉCNICAS:
 * - Movimiento continuo y orgánico calculado con delta-time (independiente de Hz).
 * - Limitación estricta de 2 a 3 conexiones por punto para evitar mallas saturadas.
 * - Zona de lectura (título, descripción, CTA) despejada mediante atenuación por proximidad focal.
 * - Señales de pulsos luminosos ocasionales que viajan a lo largo de las conexiones activas.
 * - Interacción magnética y luminosa sutil con el cursor en escritorio (sin cursor personalizado).
 * - Adaptación automática en móviles (10-16 nodos, táctil sin seguimiento forzado).
 * - Soporte total para accesibilidad (aria-hidden) y `prefers-reduced-motion: reduce`.
 * - Pausa automática al estar fuera de pantalla (IntersectionObserver) o pestaña oculta.
 * - Límite de devicePixelRatio a máximo 2x para óptimo rendimiento y bajo consumo.
 */

(function(global){
  'use strict';

  var DEFAULT_CONFIG = {
    // -------------------------------------------------------------
    // 1. DENSIDAD Y CANTIDAD DE PUNTOS
    // -------------------------------------------------------------
    pointCountDesktop: 32,       // Cantidad de puntos en pantallas grandes (25 a 40)
    pointCountMobile: 14,        // Cantidad de puntos en móviles (10 a 16)

    // -------------------------------------------------------------
    // 2. DISTANCIAS Y LÍMITE DE CONEXIONES
    // -------------------------------------------------------------
    maxDistanceDesktop: 135,     // Distancia máxima para trazar línea en escritorio (px)
    maxDistanceMobile: 90,       // Distancia máxima en móvil (px)
    maxConnectionsPerPoint: 3,   // Límite de conexiones por punto (evita saturación)

    // -------------------------------------------------------------
    // 3. VELOCIDAD Y MOVIMIENTO (píxeles por segundo)
    // -------------------------------------------------------------
    baseSpeed: 13,               // Velocidad base de desplazamiento suave
    speedVariance: 6,            // Variación aleatoria entre partículas

    // -------------------------------------------------------------
    // 4. GEOMETRÍA Y TAMAÑOS
    // -------------------------------------------------------------
    minRadius: 1.1,              // Radio mínimo de puntos (px)
    maxRadius: 2.2,              // Radio máximo de puntos (px)
    lineWidth: 0.75,             // Grosor de las líneas conectoras (px)

    // -------------------------------------------------------------
    // 5. PALETA DE COLORES Y OPACIDAD (Nexo Brand Identity)
    // -------------------------------------------------------------
    colorDotDefault: 'rgba(230, 238, 246, ', // Tono azul suave / blanco translúcido
    colorDotAccent: 'rgba(92, 184, 62, ',    // Verde acento Nexo (--verde: #5CB83E)
    colorLineDefault: 'rgba(200, 218, 235, ',// Líneas base
    colorLineAccent: 'rgba(92, 184, 62, ',   // Líneas con acento de marca
    accentRatio: 0.18,           // ~18% de nodos con color de acento verde
    baseLineAlpha: 0.13,         // Opacidad base de líneas (rango 8% - 20%)
    baseDotAlpha: 0.65,          // Opacidad base de puntos

    // -------------------------------------------------------------
    // 6. PULSOS LUMINOSOS (señales viajando por la red)
    // -------------------------------------------------------------
    pulseEnabled: true,
    pulseMaxConcurrent: 2,       // Máximo 1 o 2 pulsos a la vez
    pulseIntervalMin: 3.5,       // Pausa mínima entre pulsos (segundos)
    pulseIntervalMax: 7.0,       // Pausa máxima entre pulsos (segundos)
    pulseSpeed: 105,             // Velocidad del pulso (px por segundo)
    pulseColor: 'rgba(92, 184, 62, 0.95)', // Pulso verde de marca

    // -------------------------------------------------------------
    // 7. INTERACCIÓN CON EL CURSOR (Escritorio)
    // -------------------------------------------------------------
    mouseRadius: 140,            // Radio de influencia (120 a 160 px)
    mousePushStrength: 15,       // Desplazamiento máximo suave (pocos píxeles)
    mouseGlowFactor: 1.45        // Factor de brillo cuando el cursor está cerca
  };

  function createNetworkBackground(container, options){
    if (!container) return null;

    var config = Object.assign({}, DEFAULT_CONFIG, options || {});

    // Crear o reutilizar elemento canvas existente en pre-render
    var canvas = container.querySelector('.hero-network-canvas');
    if (!canvas) {
      canvas = document.createElement('canvas');
      canvas.className = 'hero-network-canvas';
      canvas.setAttribute('aria-hidden', 'true');
      canvas.style.position = 'absolute';
      canvas.style.inset = '0';
      canvas.style.width = '100%';
      canvas.style.height = '100%';
      canvas.style.pointerEvents = 'none';
      canvas.style.zIndex = '0';
      // Máscara suave hacia el borde inferior para fundir el fondo sin cortes
      canvas.style.maskImage = 'linear-gradient(to bottom, rgba(0,0,0,1) 0%, rgba(0,0,0,0.96) 65%, rgba(0,0,0,0.4) 88%, rgba(0,0,0,0) 100%)';
      canvas.style.webkitMaskImage = 'linear-gradient(to bottom, rgba(0,0,0,1) 0%, rgba(0,0,0,0.96) 65%, rgba(0,0,0,0.4) 88%, rgba(0,0,0,0) 100%)';

      // Insertar como primer hijo para que quede detrás del contenido
      if (container.firstChild) {
        container.insertBefore(canvas, container.firstChild);
      } else {
        container.appendChild(canvas);
      }
    }

    var ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return null;

    var width = 0;
    var height = 0;
    var dpr = 1;
    var points = [];
    var pulses = [];
    var nextPulseTime = performance.now() + 2500;
    var animationFrameId = null;
    var lastTime = performance.now();
    var isRunning = false;
    var isVisible = true;
    var isInView = true;

    // Estado del cursor
    var mouse = {
      x: -9999,
      y: -9999,
      active: false
    };

    var reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');

    function isMobile(){
      return (width <= 768) || (window.innerWidth <= 768);
    }

    function getPointCount(){
      return isMobile() ? config.pointCountMobile : config.pointCountDesktop;
    }

    function getMaxDistance(){
      return isMobile() ? config.maxDistanceMobile : config.maxDistanceDesktop;
    }

    // Calcular factor de atenuación según cercanía al área de lectura (título / texto hero)
    function calculateClearance(px, py){
      // El bloque de lectura suele residir en el cuadrante centro-izquierdo
      var focalX = width * 0.28;
      var focalY = height * 0.46;
      var rx = width * 0.24;
      var ry = height * 0.36;
      if (rx <= 0 || ry <= 0) return 1.0;
      var dx = (px - focalX) / rx;
      var dy = (py - focalY) / ry;
      var distSq = dx * dx + dy * dy;
      // Proximidad: valores entre 0.16 (muy cerca del texto) y 1.0 (en bordes y esquinas)
      return Math.min(1.0, Math.max(0.16, Math.sqrt(distSq)));
    }

    // Inicializar o reposicionar puntos
    function initPoints(){
      points = [];
      pulses = [];
      var count = getPointCount();

      for (var i = 0; i < count; i++) {
        var x, y;
        // Distribuir preferentemente (~65%) hacia laterales, esquinas y parte superior/derecha
        if (Math.random() < 0.65) {
          var side = Math.random();
          if (side < 0.35) {
            // Lateral derecho (donde está el ring y la marca de agua)
            x = width * (0.60 + Math.random() * 0.38);
            y = height * (0.05 + Math.random() * 0.90);
          } else if (side < 0.60) {
            // Lateral izquierdo exterior
            x = width * (0.02 + Math.random() * 0.22);
            y = height * (0.05 + Math.random() * 0.90);
          } else if (side < 0.80) {
            // Franja superior
            x = width * (0.05 + Math.random() * 0.90);
            y = height * (0.02 + Math.random() * 0.25);
          } else {
            // Esquinas inferiores
            x = Math.random() < 0.5 ? width * (0.02 + Math.random() * 0.25) : width * (0.75 + Math.random() * 0.23);
            y = height * (0.65 + Math.random() * 0.30);
          }
        } else {
          // Espacio libre natural
          x = width * (0.05 + Math.random() * 0.90);
          y = height * (0.08 + Math.random() * 0.84);
        }

        var isAccent = Math.random() < config.accentRatio;
        var depth = 0.55 + Math.random() * 0.45; // 0.55 a 1.0 (profundidad sutil)
        var speed = (config.baseSpeed + (Math.random() - 0.5) * config.speedVariance) * depth;
        var angle = Math.random() * Math.PI * 2;
        var radius = (config.minRadius + Math.random() * (config.maxRadius - config.minRadius)) * depth;

        points.push({
          x: x,
          y: y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          angle: angle,
          va: (Math.random() - 0.5) * 0.5, // giro armónico muy lento
          speed: speed,
          radius: radius,
          depth: depth,
          isAccent: isAccent,
          // Interacción con ratón (desplazamiento elástico suave)
          offsetX: 0,
          offsetY: 0,
          targetOffsetX: 0,
          targetOffsetY: 0,
          glow: 1.0,
          targetGlow: 1.0,
          connections: [] // Conexiones activas en el frame actual
        });
      }
    }

    // Redimensionar el canvas adaptándolo a Retina/HiDPI
    function resize(){
      var rect = container.getBoundingClientRect();
      var w = Math.round(rect.width);
      var h = Math.round(rect.height);

      if (w <= 0 || h <= 0) return;

      width = w;
      height = h;
      dpr = Math.min(window.devicePixelRatio || 1, 2);

      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.scale(dpr, dpr);

      // Si no hay puntos o cambió drásticamente el tamaño, regenerar
      if (!points.length || Math.abs(points.length - getPointCount()) > 5) {
        initPoints();
      } else {
        // Asegurar que los puntos existentes sigan dentro de los límites
        points.forEach(function(p){
          if (p.x > width) p.x = width * Math.random();
          if (p.y > height) p.y = height * Math.random();
        });
      }

      if (reducedMotionQuery.matches) {
        drawStaticFrame();
      }
    }

    // Gestión del ciclo de animación
    function updatePhysics(dt){
      var maxDist = getMaxDistance();

      // 1. Mover puntos con desplazamiento continuo y orgánico
      points.forEach(function(p){
        p.angle += p.va * dt;
        p.x += (Math.cos(p.angle) * p.speed) * dt;
        p.y += (Math.sin(p.angle) * p.speed) * dt;

        // Rebote suave en los bordes con margen elástico
        var pad = 12;
        if (p.x < pad) { p.x = pad; p.angle = Math.PI - p.angle; }
        else if (p.x > width - pad) { p.x = width - pad; p.angle = Math.PI - p.angle; }
        if (p.y < pad) { p.y = pad; p.angle = -p.angle; }
        else if (p.y > height - pad) { p.y = height - pad; p.angle = -p.angle; }

        // Interacción suave con el cursor
        if (mouse.active && !isMobile()) {
          var curX = p.x + p.offsetX;
          var curY = p.y + p.offsetY;
          var mdx = curX - mouse.x;
          var mdy = curY - mouse.y;
          var mdist = Math.hypot(mdx, mdy);
          if (mdist < config.mouseRadius && mdist > 1) {
            var pushFactor = (1 - mdist / config.mouseRadius);
            p.targetOffsetX = (mdx / mdist) * pushFactor * config.mousePushStrength;
            p.targetOffsetY = (mdy / mdist) * pushFactor * config.mousePushStrength;
            p.targetGlow = 1 + pushFactor * (config.mouseGlowFactor - 1);
          } else {
            p.targetOffsetX = 0;
            p.targetOffsetY = 0;
            p.targetGlow = 1.0;
          }
        } else {
          p.targetOffsetX = 0;
          p.targetOffsetY = 0;
          p.targetGlow = 1.0;
        }

        // Recuperación elástica hacia reposo
        p.offsetX += (p.targetOffsetX - p.offsetX) * 0.08;
        p.offsetY += (p.targetOffsetY - p.offsetY) * 0.08;
        p.glow += (p.targetGlow - p.glow) * 0.08;

        // Limpiar lista de conexiones para este frame
        p.connections = [];
      });

      // 2. Establecer conexiones respetando el límite por punto (máx 2-3)
      var n = points.length;
      var activeConnections = [];

      for (var i = 0; i < n; i++) {
        var pi = points[i];
        if (pi.connections.length >= config.maxConnectionsPerPoint) continue;

        for (var j = i + 1; j < n; j++) {
          var pj = points[j];
          if (pj.connections.length >= config.maxConnectionsPerPoint) continue;

          var xi = pi.x + pi.offsetX;
          var yi = pi.y + pi.offsetY;
          var xj = pj.x + pj.offsetX;
          var yj = pj.y + pj.offsetY;

          var dist = Math.hypot(xj - xi, yj - yi);
          if (dist < maxDist) {
            pi.connections.push(j);
            pj.connections.push(i);
            activeConnections.push({
              i: i,
              j: j,
              dist: dist,
              xi: xi,
              yi: yi,
              xj: xj,
              yj: yj,
              isAccent: pi.isAccent || pj.isAccent,
              glow: Math.max(pi.glow, pj.glow)
            });

            if (pi.connections.length >= config.maxConnectionsPerPoint) break;
          }
        }
      }

      // 3. Gestionar pulsos luminosos en conexiones existentes
      var now = performance.now();
      if (config.pulseEnabled && !reducedMotionQuery.matches && activeConnections.length > 0) {
        if (pulses.length < config.pulseMaxConcurrent && now >= nextPulseTime) {
          // Seleccionar una conexión activa al azar
          var conn = activeConnections[Math.floor(Math.random() * activeConnections.length)];
          pulses.push({
            pFrom: points[conn.i],
            pTo: points[conn.j],
            progress: 0,
            duration: conn.dist / config.pulseSpeed,
            color: config.pulseColor
          });
          nextPulseTime = now + (config.pulseIntervalMin + Math.random() * (config.pulseIntervalMax - config.pulseIntervalMin)) * 1000;
        }
      }

      // Actualizar progreso de pulsos
      for (var k = pulses.length - 1; k >= 0; k--) {
        var pulse = pulses[k];
        pulse.progress += dt / Math.max(0.2, pulse.duration);
        if (pulse.progress >= 1.0) {
          pulses.splice(k, 1);
        }
      }

      return activeConnections;
    }

    // Dibujar el fotograma completo
    function draw(activeConnections){
      ctx.clearRect(0, 0, width, height);
      var maxDist = getMaxDistance();

      // 1. Trazar líneas de conexión
      ctx.lineWidth = config.lineWidth;

      for (var k = 0; k < activeConnections.length; k++) {
        var c = activeConnections[k];
        var distRatio = 1 - (c.dist / maxDist);
        if (distRatio <= 0) continue;

        // Calcular despeje focal respecto a las zonas de lectura
        var midX = (c.xi + c.xj) * 0.5;
        var midY = (c.yi + c.yj) * 0.5;
        var clearance = calculateClearance(midX, midY);

        var alpha = config.baseLineAlpha * distRatio * clearance * c.glow;
        alpha = Math.max(0.02, Math.min(0.28, alpha));

        var colorPrefix = c.isAccent ? config.colorLineAccent : config.colorLineDefault;
        ctx.strokeStyle = colorPrefix + alpha.toFixed(3) + ')';

        ctx.beginPath();
        ctx.moveTo(c.xi, c.yi);
        ctx.lineTo(c.xj, c.yj);
        ctx.stroke();
      }

      // 2. Dibujar pulsos luminosos que recorren las conexiones
      for (var pIdx = 0; pIdx < pulses.length; pIdx++) {
        var pls = pulses[pIdx];
        var pFromX = pls.pFrom.x + pls.pFrom.offsetX;
        var pFromY = pls.pFrom.y + pls.pFrom.offsetY;
        var pToX = pls.pTo.x + pls.pTo.offsetX;
        var pToY = pls.pTo.y + pls.pTo.offsetY;

        var prg = pls.progress;
        var curPx = pFromX + (pToX - pFromX) * prg;
        var curPy = pFromY + (pToY - pFromY) * prg;

        // Desvanecimiento suave al inicio y al final del trayecto
        var pAlpha = Math.sin(prg * Math.PI) * calculateClearance(curPx, curPy);

        if (pAlpha > 0.05) {
          // Halo exterior sutil
          ctx.beginPath();
          ctx.arc(curPx, curPy, 3.8, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(92, 184, 62, ' + (0.28 * pAlpha).toFixed(3) + ')';
          ctx.fill();

          // Núcleo luminoso
          ctx.beginPath();
          ctx.arc(curPx, curPy, 1.6, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(255, 255, 255, ' + (0.90 * pAlpha).toFixed(3) + ')';
          ctx.fill();
        }
      }

      // 3. Dibujar puntos (nodos)
      for (var i = 0; i < points.length; i++) {
        var pt = points[i];
        var posX = pt.x + pt.offsetX;
        var posY = pt.y + pt.offsetY;

        var ptClearance = calculateClearance(posX, posY);
        var ptAlpha = config.baseDotAlpha * pt.depth * ptClearance * Math.min(1.3, pt.glow);
        ptAlpha = Math.max(0.08, Math.min(0.95, ptAlpha));

        var ptColor = pt.isAccent ? config.colorDotAccent : config.colorDotDefault;

        ctx.beginPath();
        ctx.arc(posX, posY, pt.radius, 0, Math.PI * 2);
        ctx.fillStyle = ptColor + ptAlpha.toFixed(3) + ')';
        ctx.fill();
      }
    }

    // Dibujar un fotograma estático (para prefers-reduced-motion)
    function drawStaticFrame(){
      if (!points.length) initPoints();
      var activeConnections = updatePhysics(0.016);
      draw(activeConnections);
    }

    // Bucle principal de animación (requestAnimationFrame)
    function loop(now){
      if (!isRunning) return;

      var dt = Math.min((now - lastTime) / 1000, 0.1);
      lastTime = now;

      // Solo calcular y dibujar si está visible y en viewport
      if (isVisible && isInView && !reducedMotionQuery.matches) {
        var activeConnections = updatePhysics(dt);
        draw(activeConnections);
      }

      animationFrameId = window.requestAnimationFrame(loop);
    }

    function start(){
      if (reducedMotionQuery.matches) {
        drawStaticFrame();
        return;
      }
      if (!isRunning) {
        isRunning = true;
        lastTime = performance.now();
        animationFrameId = window.requestAnimationFrame(loop);
      }
    }

    function stop(){
      isRunning = false;
      if (animationFrameId) {
        window.cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
      }
    }

    // Escuchadores de eventos para interacción con el ratón
    function onPointerMove(e){
      if (e.pointerType === 'touch') return;
      var rect = container.getBoundingClientRect();
      mouse.x = e.clientX - rect.left;
      mouse.y = e.clientY - rect.top;
      mouse.active = true;
    }

    function onPointerLeave(){
      mouse.active = false;
    }

    container.addEventListener('pointermove', onPointerMove, { passive: true });
    container.addEventListener('pointerleave', onPointerLeave, { passive: true });

    // Observar visibilidad en viewport (IntersectionObserver)
    var observer = null;
    if ('IntersectionObserver' in window) {
      observer = new IntersectionObserver(function(entries){
        if (!entries || !entries.length) return;
        isInView = entries[0].isIntersecting;
        if (isInView && isRunning) {
          lastTime = performance.now();
        }
      }, { threshold: 0.05 });
      observer.observe(container);
    }

    // Pausar si la pestaña pasa a segundo plano
    function onVisibilityChange(){
      isVisible = !document.hidden;
      if (isVisible && isRunning) {
        lastTime = performance.now();
      }
    }
    document.addEventListener('visibilitychange', onVisibilityChange);

    // Observar cambios de tamaño del contenedor sin saltos
    var resizeObserver = null;
    if ('ResizeObserver' in window) {
      resizeObserver = new ResizeObserver(function(){
        resize();
      });
      resizeObserver.observe(container);
    } else {
      window.addEventListener('resize', resize, { passive: true });
    }

    // Escuchar preferencia de reducción de movimiento
    function onReducedMotionChange(e){
      if (e.matches) {
        stop();
        drawStaticFrame();
      } else {
        start();
      }
    }
    try {
      reducedMotionQuery.addEventListener('change', onReducedMotionChange);
    } catch(err) {
      try { reducedMotionQuery.addListener(onReducedMotionChange); } catch(e){}
    }

    // Inicializar
    resize();
    start();

    // API pública para control y desmontaje
    return {
      canvas: canvas,
      config: config,
      start: start,
      stop: stop,
      resize: resize,
      setOptions: function(newOpts){
        Object.assign(config, newOpts || {});
        initPoints();
        if (reducedMotionQuery.matches) drawStaticFrame();
      },
      destroy: function(){
        stop();
        container.removeEventListener('pointermove', onPointerMove);
        container.removeEventListener('pointerleave', onPointerLeave);
        document.removeEventListener('visibilitychange', onVisibilityChange);
        if (observer) observer.disconnect();
        if (resizeObserver) resizeObserver.disconnect();
        else window.removeEventListener('resize', resize);
        try {
          reducedMotionQuery.removeEventListener('change', onReducedMotionChange);
        } catch(e) {
          try { reducedMotionQuery.removeListener(onReducedMotionChange); } catch(err){}
        }
        if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
      }
    };
  }

  // Exportar al entorno global
  global.NexoNetworkBackground = {
    init: createNetworkBackground,
    DEFAULT_CONFIG: DEFAULT_CONFIG
  };

})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this));
