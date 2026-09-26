/**
 * NEXO · Fondo Dinámico Global de Red de Conexiones (Canvas 2D)
 * 
 * Capa decorativa interactiva global (viewport-fixed) que acompaña todo el recorrido
 * de la página, unificando la identidad visual entre la sección hero y el cuerpo general:
 *   - En el Hero oscuro (--azul: #1F3549): nodos y enlaces en tonos claros (--azul-soft / blanco) y acento verde (--verde: #5CB83E).
 *   - En el resto de la página clara (--bg: #EEF1F4): nodos y enlaces en tono pizarra tenue (--azul: #1F3549) y acento verde.
 *   - Pulsos luminosos verdes de señal que recorren las conexiones activas en toda la pantalla.
 *   - Las tarjetas de contenido, estadísticas y formularios mantienen fondos sólidos opacos (#ffffff),
 *     garantizando una legibilidad óptima en todo momento.
 */

(function(global){
  'use strict';

  var DEFAULT_CONFIG = {
    // Densidad y cantidad de puntos en viewport
    pointCountDesktop: 36,
    pointCountMobile: 15,

    // Distancias máximas de conexión
    maxDistanceDesktop: 140,
    maxDistanceMobile: 92,
    maxConnectionsPerPoint: 3,

    // Velocidad y movimiento suave (píxeles por segundo)
    baseSpeed: 11,
    speedVariance: 5,

    // Tamaños y trazos
    minRadius: 1.1,
    maxRadius: 2.2,
    lineWidth: 0.75,

    // Paleta en zona oscura (Hero)
    dotDefaultDark: 'rgba(230, 238, 246, ',
    lineDefaultDark: 'rgba(200, 218, 235, ',

    // Paleta en zona clara (Resto de la página)
    dotDefaultLight: 'rgba(31, 53, 73, ',
    lineDefaultLight: 'rgba(31, 53, 73, ',

    // Acento de marca Nexo (--verde: #5CB83E)
    dotAccent: 'rgba(92, 184, 62, ',
    lineAccent: 'rgba(92, 184, 62, ',
    pulseColor: 'rgba(92, 184, 62, 0.95)',

    accentRatio: 0.20,
    baseLineAlpha: 0.12,
    baseDotAlpha: 0.55,

    // Señales luminosas (pulsos)
    pulseEnabled: true,
    pulseMaxConcurrent: 2,
    pulseIntervalMin: 3.0,
    pulseIntervalMax: 6.5,
    pulseSpeed: 100,

    // Interacción con cursor (escritorio)
    mouseRadius: 135,
    mousePushStrength: 14,
    mouseGlowFactor: 1.4
  };

  function createNetworkBackground(targetContainer, options){
    var container = targetContainer || document.body;
    var config = Object.assign({}, DEFAULT_CONFIG, options || {});

    // Crear o reutilizar canvas fijo para evitar duplicados en re-render
    var canvas = document.querySelector('.page-network-canvas') || container.querySelector('.page-network-canvas');
    if (!canvas) {
      canvas = document.createElement('canvas');
      canvas.className = 'page-network-canvas';
      canvas.setAttribute('aria-hidden', 'true');
      canvas.style.position = 'fixed';
      canvas.style.top = '0';
      canvas.style.left = '0';
      canvas.style.width = '100vw';
      canvas.style.height = '100vh';
      canvas.style.pointerEvents = 'none';
      canvas.style.zIndex = '1';

      if (document.body.firstChild) {
        document.body.insertBefore(canvas, document.body.firstChild);
      } else {
        document.body.appendChild(canvas);
      }
    }

    var ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return null;

    var width = 0;
    var height = 0;
    var dpr = 1;
    var points = [];
    var pulses = [];
    var nextPulseTime = performance.now() + 2000;
    var animationFrameId = null;
    var lastTime = performance.now();
    var isRunning = false;
    var isVisible = true;

    var mouse = { x: -9999, y: -9999, active: false };
    var isTouchDevice = false;
    try {
      isTouchDevice = window.matchMedia('(pointer: coarse)').matches || ('ontouchstart' in window);
    } catch(e){}

    var reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');

    function isMobile(){
      return (window.innerWidth <= 768);
    }

    function getPointCount(){
      return isMobile() ? config.pointCountMobile : config.pointCountDesktop;
    }

    function getMaxDistance(){
      return isMobile() ? config.maxDistanceMobile : config.maxDistanceDesktop;
    }

    // Clearance elíptico si el hero está visible en pantalla
    function calculateClearance(px, py, heroBottom){
      if (heroBottom <= 20) return 1.0;
      var heroHeight = Math.min(height, heroBottom);
      var focalX = width * 0.30;
      var focalY = heroHeight * 0.46;
      var rx = width * 0.25;
      var ry = heroHeight * 0.35;
      if (rx <= 0 || ry <= 0) return 1.0;
      var dx = (px - focalX) / rx;
      var dy = (py - focalY) / ry;
      var distSq = dx * dx + dy * dy;
      return Math.min(1.0, Math.max(0.18, Math.sqrt(distSq)));
    }

    function initPoints(){
      points = [];
      pulses = [];
      var count = getPointCount();

      for (var i = 0; i < count; i++) {
        var x, y;
        // Distribuir de manera armónica en toda la pantalla con mayor presencia en laterales y bordes
        if (Math.random() < 0.60) {
          var side = Math.random();
          if (side < 0.35) {
            x = width * (0.68 + Math.random() * 0.30);
            y = height * (0.04 + Math.random() * 0.92);
          } else if (side < 0.70) {
            x = width * (0.02 + Math.random() * 0.28);
            y = height * (0.04 + Math.random() * 0.92);
          } else {
            x = width * (0.04 + Math.random() * 0.92);
            y = Math.random() < 0.5 ? height * (0.02 + Math.random() * 0.20) : height * (0.78 + Math.random() * 0.20);
          }
        } else {
          x = width * (0.05 + Math.random() * 0.90);
          y = height * (0.05 + Math.random() * 0.90);
        }

        var isAccent = Math.random() < config.accentRatio;
        var depth = 0.6 + Math.random() * 0.4;
        var speed = (config.baseSpeed + (Math.random() - 0.5) * config.speedVariance) * depth;
        var angle = Math.random() * Math.PI * 2;
        var radius = (config.minRadius + Math.random() * (config.maxRadius - config.minRadius)) * depth;

        points.push({
          x: x,
          y: y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          angle: angle,
          va: (Math.random() - 0.5) * 0.4,
          speed: speed,
          radius: radius,
          depth: depth,
          isAccent: isAccent,
          offsetX: 0,
          offsetY: 0,
          targetOffsetX: 0,
          targetOffsetY: 0,
          glow: 1.0,
          targetGlow: 1.0,
          connections: []
        });
      }
    }

    function resize(){
      var w = window.innerWidth || document.documentElement.clientWidth || 1024;
      var h = window.innerHeight || document.documentElement.clientHeight || 768;

      if (w <= 0 || h <= 0) return;

      width = w;
      height = h;
      dpr = Math.min(window.devicePixelRatio || 1, 2);

      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.scale(dpr, dpr);

      if (!points.length || Math.abs(points.length - getPointCount()) > 6) {
        initPoints();
      } else {
        points.forEach(function(p){
          if (p.x > width) p.x = width * Math.random();
          if (p.y > height) p.y = height * Math.random();
        });
      }

      if (reducedMotionQuery.matches) {
        drawFrame(0);
      }
    }

    function spawnPulse(activeConnections){
      if (!config.pulseEnabled || !activeConnections.length) return;
      if (pulses.length >= config.pulseMaxConcurrent) return;

      var conn = activeConnections[Math.floor(Math.random() * activeConnections.length)];
      if (!conn) return;

      var dx = conn.b.x - conn.a.x;
      var dy = conn.b.y - conn.a.y;
      var dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 20) return;

      pulses.push({
        p1: conn.a,
        p2: conn.b,
        progress: 0,
        speed: config.pulseSpeed / dist,
        alpha: 1.0
      });
    }

    function update(dt){
      var count = points.length;
      var maxDist = getMaxDistance();
      var maxDistSq = maxDist * maxDist;

      // Resetear conexiones del frame
      for (var i = 0; i < count; i++) {
        points[i].connections = [];
      }

      // 1. Desplazamiento orgánico
      for (var j = 0; j < count; j++) {
        var p = points[j];

        p.angle += p.va * dt;
        p.vx = Math.cos(p.angle) * p.speed;
        p.vy = Math.sin(p.angle) * p.speed;

        p.x += p.vx * dt;
        p.y += p.vy * dt;

        // Rebotar o envolver suavemente en los bordes del viewport
        var pad = 15;
        if (p.x < -pad) p.x = width + pad;
        else if (p.x > width + pad) p.x = -pad;

        if (p.y < -pad) p.y = height + pad;
        else if (p.y > height + pad) p.y = -pad;

        // Interacción con ratón en escritorio
        if (!isTouchDevice && mouse.active) {
          var mdx = (p.x + p.offsetX) - mouse.x;
          var mdy = (p.y + p.offsetY) - mouse.y;
          var mDist = Math.sqrt(mdx * mdx + mdy * mdy);

          if (mDist < config.mouseRadius && mDist > 0) {
            var factor = (1 - (mDist / config.mouseRadius));
            var push = factor * factor * config.mousePushStrength;
            p.targetOffsetX = (mdx / mDist) * push;
            p.targetOffsetY = (mdy / mDist) * push;
            p.targetGlow = 1.0 + factor * (config.mouseGlowFactor - 1.0);
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

        // Suavizado elástico (lerp)
        p.offsetX += (p.targetOffsetX - p.offsetX) * 0.12;
        p.offsetY += (p.targetOffsetY - p.offsetY) * 0.12;
        p.glow += (p.targetGlow - p.glow) * 0.12;
      }

      // 2. Establecer conexiones entre pares cercanos con límite estricto
      var activeConnections = [];
      for (var aIdx = 0; aIdx < count; aIdx++) {
        var pA = points[aIdx];
        if (pA.connections.length >= config.maxConnectionsPerPoint) continue;

        var ax = pA.x + pA.offsetX;
        var ay = pA.y + pA.offsetY;

        for (var bIdx = aIdx + 1; bIdx < count; bIdx++) {
          var pB = points[bIdx];
          if (pB.connections.length >= config.maxConnectionsPerPoint) continue;

          var bx = pB.x + pB.offsetX;
          var by = pB.y + pB.offsetY;

          var ddx = bx - ax;
          var ddy = by - ay;
          var distSq = ddx * ddx + ddy * ddy;

          if (distSq < maxDistSq) {
            var dist = Math.sqrt(distSq);
            var connObj = {
              a: pA,
              b: pB,
              dist: dist,
              normDist: dist / maxDist
            };
            pA.connections.push(pB);
            pB.connections.push(pA);
            activeConnections.push(connObj);

            if (pA.connections.length >= config.maxConnectionsPerPoint) break;
          }
        }
      }

      // 3. Generación y avance de señales luminosas (pulsos)
      var now = performance.now();
      if (now >= nextPulseTime) {
        spawnPulse(activeConnections);
        nextPulseTime = now + (config.pulseIntervalMin + Math.random() * (config.pulseIntervalMax - config.pulseIntervalMin)) * 1000;
      }

      for (var k = pulses.length - 1; k >= 0; k--) {
        var pulse = pulses[k];
        pulse.progress += pulse.speed * dt;
        if (pulse.progress >= 1.0) {
          pulses.splice(k, 1);
        }
      }

      return activeConnections;
    }

    function drawFrame(dt){
      ctx.clearRect(0, 0, width, height);

      // Detectar límite inferior del hero respecto al viewport para contraste perfecto
      var heroEl = document.querySelector('.hero');
      var heroBottom = heroEl ? heroEl.getBoundingClientRect().bottom : 0;

      var activeConnections = update(dt);
      var count = points.length;

      // 1. Dibujar líneas de conexión
      for (var i = 0; i < activeConnections.length; i++) {
        var conn = activeConnections[i];
        var p1 = conn.a;
        var p2 = conn.b;

        var x1 = p1.x + p1.offsetX;
        var y1 = p1.y + p1.offsetY;
        var x2 = p2.x + p2.offsetX;
        var y2 = p2.y + p2.offsetY;

        var midY = (y1 + y2) * 0.5;
        var inHero = midY < heroBottom;

        // Despeje cerca del texto
        var c1 = calculateClearance(x1, y1, heroBottom);
        var c2 = calculateClearance(x2, y2, heroBottom);
        var clearance = (c1 + c2) * 0.5;

        var distFactor = 1 - conn.normDist;
        var glow = (p1.glow + p2.glow) * 0.5;
        var hasAccent = p1.isAccent || p2.isAccent;

        var alpha = config.baseLineAlpha * distFactor * clearance * glow;
        if (alpha <= 0.01) continue;

        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.lineWidth = config.lineWidth;

        if (hasAccent) {
          ctx.strokeStyle = config.lineAccent + Math.min(0.42, alpha * 1.35) + ')';
        } else if (inHero) {
          ctx.strokeStyle = config.lineDefaultDark + Math.min(0.25, alpha) + ')';
        } else {
          ctx.strokeStyle = config.lineDefaultLight + Math.min(0.18, alpha * 0.8) + ')';
        }

        ctx.stroke();
      }

      // 2. Dibujar pulsos luminosos de señal
      for (var pIdx = 0; pIdx < pulses.length; pIdx++) {
        var pl = pulses[pIdx];
        var xA = pl.p1.x + pl.p1.offsetX;
        var yA = pl.p1.y + pl.p1.offsetY;
        var xB = pl.p2.x + pl.p2.offsetX;
        var yB = pl.p2.y + pl.p2.offsetY;

        var curX = xA + (xB - xA) * pl.progress;
        var curY = yA + (yB - yA) * pl.progress;

        var pulseAlpha = Math.sin(pl.progress * Math.PI) * 0.9;
        if (pulseAlpha <= 0.05) continue;

        // Halo difuso suave
        ctx.save();
        ctx.beginPath();
        ctx.arc(curX, curY, 4.5, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(92, 184, 62, ' + (pulseAlpha * 0.35) + ')';
        ctx.fill();

        // Núcleo brillante
        ctx.beginPath();
        ctx.arc(curX, curY, 2.0, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255, 255, 255, ' + pulseAlpha + ')';
        ctx.fill();
        ctx.restore();
      }

      // 3. Dibujar nodos
      for (var n = 0; n < count; n++) {
        var pt = points[n];
        var px = pt.x + pt.offsetX;
        var py = pt.y + pt.offsetY;

        var inHeroZone = py < heroBottom;
        var cl = calculateClearance(px, py, heroBottom);
        var baseAlpha = config.baseDotAlpha * cl * pt.glow;

        ctx.beginPath();
        ctx.arc(px, py, pt.radius, 0, Math.PI * 2);

        if (pt.isAccent) {
          ctx.fillStyle = config.dotAccent + Math.min(0.9, baseAlpha * 1.2) + ')';
        } else if (inHeroZone) {
          ctx.fillStyle = config.dotDefaultDark + Math.min(0.85, baseAlpha) + ')';
        } else {
          ctx.fillStyle = config.dotDefaultLight + Math.min(0.45, baseAlpha * 0.7) + ')';
        }

        ctx.fill();
      }
    }

    function loop(currentTime){
      if (!isRunning) return;

      var dt = (currentTime - lastTime) / 1000;
      lastTime = currentTime;

      // Limitar dt para evitar saltos si la pestaña estuvo momentáneamente ocupada
      if (dt > 0.1) dt = 0.1;
      if (dt <= 0) dt = 0.016;

      drawFrame(dt);
      animationFrameId = requestAnimationFrame(loop);
    }

    function start(){
      if (isRunning) return;
      if (reducedMotionQuery.matches) {
        resize();
        drawFrame(0);
        return;
      }
      isRunning = true;
      lastTime = performance.now();
      animationFrameId = requestAnimationFrame(loop);
    }

    function stop(){
      isRunning = false;
      if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
      }
    }

    // Eventos de ratón
    function onMouseMove(e){
      mouse.x = e.clientX;
      mouse.y = e.clientY;
      mouse.active = true;
    }

    function onMouseLeave(){
      mouse.active = false;
      mouse.x = -9999;
      mouse.y = -9999;
    }

    if (!isTouchDevice) {
      window.addEventListener('mousemove', onMouseMove, { passive: true });
      window.addEventListener('mouseleave', onMouseLeave, { passive: true });
    }

    // Visibilidad de pestaña
    function onVisibilityChange(){
      if (document.hidden) {
        isVisible = false;
        stop();
      } else {
        isVisible = true;
        start();
      }
    }
    document.addEventListener('visibilitychange', onVisibilityChange);

    // Preferencias de accesibilidad
    function onMotionChange(e){
      if (e.matches) {
        stop();
        drawFrame(0);
      } else {
        start();
      }
    }
    if (reducedMotionQuery.addEventListener) {
      reducedMotionQuery.addEventListener('change', onMotionChange);
    }

    window.addEventListener('resize', resize, { passive: true });

    // Inicialización inmediata
    resize();
    start();

    return {
      destroy: function(){
        stop();
        window.removeEventListener('resize', resize);
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseleave', onMouseLeave);
        document.removeEventListener('visibilitychange', onVisibilityChange);
        if (reducedMotionQuery.removeEventListener) {
          reducedMotionQuery.removeEventListener('change', onMotionChange);
        }
        if (canvas && canvas.parentNode) {
          canvas.parentNode.removeChild(canvas);
        }
      },
      resize: resize,
      start: start,
      stop: stop
    };
  }

  global.NexoNetworkBackground = {
    init: createNetworkBackground,
    DEFAULT_CONFIG: DEFAULT_CONFIG
  };

})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this));
