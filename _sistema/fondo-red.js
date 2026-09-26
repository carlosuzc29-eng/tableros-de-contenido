/**
 * NEXO · Fondo Dinámico Global de Red de Conexiones a Gran Escala (Canvas 2D)
 * 
 * Red decorativa interactiva global (viewport-fixed) con presencia visual amplia y protagónica:
 * - Estructuras de gran envergadura (60% de la composición): conexiones que abarcan entre el 25% y 45% del ancho de pantalla.
 * - Conexiones medianas (30%): articulan y enlazan las distintas zonas visuales.
 * - Conexiones pequeñas (10%): detalles secundarios y satélites.
 * - Pocos nodos estratégicos con límite de 2 conexiones por punto para evitar mallas saturadas.
 * - Movimiento lento, sereno y orgánico, diferenciado según la escala.
 * - Transición cromática suave (hero oscuro con nodos claros vs cuerpo claro con tono pizarra) y acento verde Nexo (#5CB83E).
 * - Pulsos luminosos que recorren las conexiones extensas.
 */

(function(global){
  'use strict';

  var DEFAULT_CONFIG = {
    // Cantidad de nodos optimizada para dar espacio a estructuras amplias
    pointCountDesktop: 17,
    pointCountMobile: 8,

    // Proporciones objetivo de conexiones
    ratioLarge: 0.60,
    ratioMedium: 0.30,
    ratioSmall: 0.10,

    // Conexiones totales activas simultáneas en pantalla
    targetConnectionsDesktop: 12,
    targetConnectionsMobile: 5,
    maxConnectionsPerPoint: 2,

    // Velocidades según escala (píxeles por segundo) - movimiento lento y cinematográfico
    speedLarge: 6.5,
    speedMedium: 9.5,
    speedSmall: 13.5,
    speedVariance: 3.0,

    // Tamaños de nodos por escala
    radiusLargeDesktop: 2.6,
    radiusMediumDesktop: 1.8,
    radiusSmallDesktop: 1.2,

    radiusLargeMobile: 2.2,
    radiusMediumMobile: 1.5,
    radiusSmallMobile: 1.0,

    // Grosor de líneas por escala
    lineWidthLarge: 1.0,
    lineWidthMedium: 0.85,
    lineWidthSmall: 0.70,

    // Paleta en zona oscura (Hero --azul: #1F3549)
    dotDefaultDark: 'rgba(230, 240, 250, ',
    lineDefaultDark: 'rgba(210, 230, 248, ',

    // Paleta en zona clara (Cuerpo --bg: #EEF1F4)
    dotDefaultLight: 'rgba(31, 53, 73, ',
    lineDefaultLight: 'rgba(31, 53, 73, ',

    // Acento de marca Nexo (--verde: #5CB83E)
    dotAccent: 'rgba(92, 184, 62, ',
    lineAccent: 'rgba(92, 184, 62, ',
    pulseColor: 'rgba(92, 184, 62, 0.95)',

    accentRatio: 0.25,
    baseLineAlpha: 0.18,
    baseDotAlpha: 0.65,

    // Señales luminosas (pulsos)
    pulseEnabled: true,
    pulseMaxConcurrent: 2,
    pulseIntervalMin: 2.5,
    pulseIntervalMax: 5.5,
    pulseSpeed: 110, // px/s a lo largo de conexiones grandes

    // Interacción con cursor (escritorio)
    mouseRadius: 150,
    mousePushStrength: 18,
    mouseGlowFactor: 1.35
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
    var activeConnectionsMap = new Map();
    var pulses = [];
    var nextPulseTime = performance.now() + 1500;
    var animationFrameId = null;
    var lastTime = performance.now();
    var isRunning = false;
    var isVisible = true;
    var pointIdCounter = 0;

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

    function getTargetConnections(){
      return isMobile() ? config.targetConnectionsMobile : config.targetConnectionsDesktop;
    }

    // Rangos de escala basados en el ancho visible de la ventana
    function getDistanceBrackets(){
      var w = width || 1024;
      if (isMobile()) {
        return {
          minLarge: w * 0.25,
          maxLarge: w * 0.46,
          minMedium: w * 0.14,
          maxMedium: w * 0.25,
          minSmall: w * 0.06,
          maxSmall: w * 0.14
        };
      }
      return {
        // Conexiones grandes: 25% a 45% del ancho de pantalla (ej. 360px a 650px en 1440px)
        minLarge: w * 0.24,
        maxLarge: w * 0.46,
        // Conexiones medianas: 13% a 24% del ancho
        minMedium: w * 0.13,
        maxMedium: w * 0.24,
        // Conexiones pequeñas: 5% a 13% del ancho
        minSmall: w * 0.05,
        maxSmall: w * 0.13
      };
    }

    // Clearance elíptico en el hero para que los textos principales respiren
    function calculateClearance(px, py, heroBottom){
      if (heroBottom <= 20) return 1.0;
      var heroHeight = Math.min(height, heroBottom);
      var focalX = width * 0.32;
      var focalY = heroHeight * 0.48;
      var rx = width * 0.26;
      var ry = heroHeight * 0.36;
      if (rx <= 0 || ry <= 0) return 1.0;
      var dx = (px - focalX) / rx;
      var dy = (py - focalY) / ry;
      var distSq = dx * dx + dy * dy;
      return Math.min(1.0, Math.max(0.25, Math.sqrt(distSq)));
    }

    function initPoints(){
      points = [];
      activeConnectionsMap.clear();
      pulses = [];
      var count = getPointCount();

      // Proporción de nodos estructurales (~60% macro, ~30% medio, ~10% satélite)
      for (var i = 0; i < count; i++) {
        var tier = 'large';
        var randTier = i / count;
        if (randTier >= 0.60 && randTier < 0.88) {
          tier = 'medium';
        } else if (randTier >= 0.88) {
          tier = 'small';
        }

        // Permitir que algunos puntos nazcan en o salgan hacia los bordes externos (-8% a 108%)
        // para dar continuidad visual más allá del marco de la ventana
        var bleedX = width * 0.08;
        var bleedY = height * 0.08;
        var x = -bleedX + Math.random() * (width + bleedX * 2);
        var y = -bleedY + Math.random() * (height + bleedY * 2);

        var isAccent = (Math.random() < config.accentRatio);
        var baseSpd = (tier === 'large') ? config.speedLarge : ((tier === 'medium') ? config.speedMedium : config.speedSmall);
        var speed = baseSpd + (Math.random() - 0.5) * config.speedVariance;
        var angle = Math.random() * Math.PI * 2;

        var rad = isMobile()
          ? (tier === 'large' ? config.radiusLargeMobile : (tier === 'medium' ? config.radiusMediumMobile : config.radiusSmallMobile))
          : (tier === 'large' ? config.radiusLargeDesktop : (tier === 'medium' ? config.radiusMediumDesktop : config.radiusSmallDesktop));

        points.push({
          id: ++pointIdCounter,
          tier: tier,
          x: x,
          y: y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          angle: angle,
          va: (Math.random() - 0.5) * 0.18, // Curvatura angular lenta y orgánica
          speed: speed,
          radius: rad,
          isAccent: isAccent,
          offsetX: 0,
          offsetY: 0,
          targetOffsetX: 0,
          targetOffsetY: 0,
          glow: 1.0,
          targetGlow: 1.0,
          connectionCount: 0
        });
      }
    }

    var lastW = 0;
    var lastH = 0;

    function resize(){
      var w = window.innerWidth || document.documentElement.clientWidth || 1024;
      var h = window.innerHeight || document.documentElement.clientHeight || 768;

      if (w <= 0 || h <= 0) return;

      // En dispositivos móviles, evitar recalcular canvas en cambios menores de altura causados por el colapso de la barra de navegación al hacer scroll
      if (isTouchDevice && lastW === w && Math.abs(h - lastH) < 150) {
        return;
      }
      lastW = w;
      lastH = h;

      width = w;
      height = h;
      dpr = Math.min(window.devicePixelRatio || 1, 2);

      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.scale(dpr, dpr);

      var expectedCount = getPointCount();
      if (!points.length || Math.abs(points.length - expectedCount) > 2) {
        initPoints();
      } else {
        // Adaptar posiciones al nuevo ancho manteniendo proporciones
        points.forEach(function(p){
          if (p.x > width * 1.1) p.x = width * Math.random();
          if (p.y > height * 1.1) p.y = height * Math.random();
        });
      }

      if (reducedMotionQuery.matches) {
        drawFrame(0);
      }
    }

    function spawnPulse(activeList){
      if (!config.pulseEnabled || !activeList.length) return;
      if (pulses.length >= config.pulseMaxConcurrent) return;

      // Preferir conexiones grandes o medianas para los pulsos
      var candidates = activeList.filter(function(c){ return c.alpha > 0.4 && (c.tier === 'large' || c.tier === 'medium'); });
      if (!candidates.length) candidates = activeList;

      var conn = candidates[Math.floor(Math.random() * candidates.length)];
      if (!conn) return;

      var dx = (conn.b.x + conn.b.offsetX) - (conn.a.x + conn.a.offsetX);
      var dy = (conn.b.y + conn.b.offsetY) - (conn.a.y + conn.a.offsetY);
      var dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 40) return;

      // Elegir aleatoriamente sentido de avance
      var p1 = Math.random() < 0.5 ? conn.a : conn.b;
      var p2 = (p1 === conn.a) ? conn.b : conn.a;

      pulses.push({
        p1: p1,
        p2: p2,
        progress: 0,
        speed: config.pulseSpeed / dist,
        alpha: 1.0,
        tier: conn.tier
      });
    }

    function updatePhysics(dt){
      var count = points.length;
      var bleedX = width * 0.09;
      var bleedY = height * 0.09;

      // 1. Desplazamiento orgánico y suave de nodos
      for (var i = 0; i < count; i++) {
        var p = points[i];

        p.angle += p.va * dt;
        p.vx = Math.cos(p.angle) * p.speed;
        p.vy = Math.sin(p.angle) * p.speed;

        p.x += p.vx * dt;
        p.y += p.vy * dt;

        // Envolver suavemente con margen exterior para permitir que salgan y vuelvan
        if (p.x < -bleedX) p.x = width + bleedX;
        else if (p.x > width + bleedX) p.x = -bleedX;

        if (p.y < -bleedY) p.y = height + bleedY;
        else if (p.y > height + bleedY) p.y = -bleedY;

        // Repulsión e interacción con cursor en escritorio
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
        p.offsetX += (p.targetOffsetX - p.offsetX) * 0.10;
        p.offsetY += (p.targetOffsetY - p.offsetY) * 0.10;
        p.glow += (p.targetGlow - p.glow) * 0.10;
      }
    }

    function evaluateConnections(dt){
      var count = points.length;
      var brackets = getDistanceBrackets();
      var targetTotal = getTargetConnections();

      // Cuotas según las proporciones solicitadas:
      // Grandes: ~60% | Medianas: ~30% | Pequeñas: ~10%
      var maxLarge = Math.max(1, Math.round(targetTotal * config.ratioLarge));
      var maxMedium = Math.max(1, Math.round(targetTotal * config.ratioMedium));
      var maxSmall = Math.max(1, Math.round(targetTotal * config.ratioSmall));

      // Resetear contador de conexiones por punto
      for (var pIdx = 0; pIdx < count; pIdx++) {
        points[pIdx].connectionCount = 0;
      }

      // Marcar conexiones existentes
      activeConnectionsMap.forEach(function(conn){
        conn.desired = false;
      });

      // 1. Evaluar conexiones existentes para mantener estabilidad y evitar parpadeos
      activeConnectionsMap.forEach(function(conn, key){
        var ax = conn.a.x + conn.a.offsetX;
        var ay = conn.a.y + conn.a.offsetY;
        var bx = conn.b.x + conn.b.offsetX;
        var by = conn.b.y + conn.b.offsetY;
        var dx = bx - ax;
        var dy = by - ay;
        var dist = Math.sqrt(dx * dx + dy * dy);

        conn.dist = dist;

        // Comprobar si todavía está en el rango permitido (con un 12% de holgura de histéresis)
        var inRange = false;
        var minBound, maxBound;

        if (conn.tier === 'large') {
          minBound = brackets.minLarge * 0.90;
          maxBound = brackets.maxLarge * 1.10;
        } else if (conn.tier === 'medium') {
          minBound = brackets.minMedium * 0.90;
          maxBound = brackets.maxMedium * 1.10;
        } else {
          minBound = brackets.minSmall * 0.90;
          maxBound = brackets.maxSmall * 1.10;
        }

        if (dist >= minBound && dist <= maxBound) {
          inRange = true;
        }

        if (inRange && conn.a.connectionCount < config.maxConnectionsPerPoint && conn.b.connectionCount < config.maxConnectionsPerPoint) {
          conn.desired = true;
          conn.a.connectionCount++;
          conn.b.connectionCount++;
        }
      });

      // Contar activas por categoría
      var currentLarge = 0, currentMedium = 0, currentSmall = 0;
      activeConnectionsMap.forEach(function(conn){
        if (conn.desired) {
          if (conn.tier === 'large') currentLarge++;
          else if (conn.tier === 'medium') currentMedium++;
          else currentSmall++;
        }
      });

      // 2. Si faltan conexiones para cumplir las cuotas, buscar nuevos pares candidatos
      var candidatePairs = [];
      for (var i = 0; i < count; i++) {
        var pA = points[i];
        var ax = pA.x + pA.offsetX;
        var ay = pA.y + pA.offsetY;

        for (var j = i + 1; j < count; j++) {
          var pB = points[j];
          var key = (pA.id < pB.id) ? (pA.id + '_' + pB.id) : (pB.id + '_' + pA.id);
          if (activeConnectionsMap.has(key) && activeConnectionsMap.get(key).desired) continue;

          var bx = pB.x + pB.offsetX;
          var by = pB.y + pB.offsetY;
          var ddx = bx - ax;
          var ddy = by - ay;
          var d = Math.sqrt(ddx * ddx + ddy * ddy);

          var tier = null;
          var normDist = 0;

          if (d >= brackets.minLarge && d <= brackets.maxLarge) {
            tier = 'large';
            normDist = (d - brackets.minLarge) / (brackets.maxLarge - brackets.minLarge);
          } else if (d >= brackets.minMedium && d < brackets.maxLarge) {
            tier = 'medium';
            normDist = (d - brackets.minMedium) / (brackets.maxMedium - brackets.minMedium);
          } else if (d >= brackets.minSmall && d < brackets.minMedium) {
            tier = 'small';
            normDist = (d - brackets.minSmall) / (brackets.maxSmall - brackets.minSmall);
          }

          if (tier) {
            candidatePairs.push({
              key: key,
              a: pA,
              b: pB,
              dist: d,
              tier: tier,
              normDist: normDist
            });
          }
        }
      }

      // Ordenar candidatos por proximidad al centro óptimo de su escala
      candidatePairs.sort(function(c1, c2){
        var score1 = Math.abs(c1.normDist - 0.5);
        var score2 = Math.abs(c2.normDist - 0.5);
        return score1 - score2;
      });

      // Seleccionar nuevos enlaces respetando límites
      for (var cIdx = 0; cIdx < candidatePairs.length; cIdx++) {
        var cand = candidatePairs[cIdx];
        if (cand.a.connectionCount >= config.maxConnectionsPerPoint || cand.b.connectionCount >= config.maxConnectionsPerPoint) continue;

        var canAdd = false;
        if (cand.tier === 'large' && currentLarge < maxLarge) {
          canAdd = true;
          currentLarge++;
        } else if (cand.tier === 'medium' && currentMedium < maxMedium) {
          canAdd = true;
          currentMedium++;
        } else if (cand.tier === 'small' && currentSmall < maxSmall) {
          canAdd = true;
          currentSmall++;
        }

        if (canAdd) {
          cand.a.connectionCount++;
          cand.b.connectionCount++;

          if (activeConnectionsMap.has(cand.key)) {
            var existing = activeConnectionsMap.get(cand.key);
            existing.desired = true;
            existing.dist = cand.dist;
          } else {
            activeConnectionsMap.set(cand.key, {
              key: cand.key,
              a: cand.a,
              b: cand.b,
              dist: cand.dist,
              tier: cand.tier,
              alpha: 0.0,
              desired: true
            });
          }
        }
      }

      // 3. Interpolación suave de opacidad (fade-in / fade-out sin saltos bruscos)
      var activeList = [];
      var keysToDelete = [];

      activeConnectionsMap.forEach(function(conn, key){
        var targetAlpha = 0.0;
        if (conn.desired) {
          // Curva campana suave según la distancia dentro de su bracket
          var brackets = getDistanceBrackets();
          var minD, maxD;
          if (conn.tier === 'large') { minD = brackets.minLarge; maxD = brackets.maxLarge; }
          else if (conn.tier === 'medium') { minD = brackets.minMedium; maxD = brackets.maxMedium; }
          else { minD = brackets.minSmall; maxD = brackets.maxSmall; }

          var span = maxD - minD;
          var frac = span > 0 ? ((conn.dist - minD) / span) : 0.5;
          frac = Math.max(0, Math.min(1, frac));
          // Atenuación suave en los extremos
          var taper = Math.sin(frac * Math.PI);
          targetAlpha = 0.35 + 0.65 * taper;
        }

        // Lerp de opacidad
        conn.alpha += (targetAlpha - conn.alpha) * Math.min(1, dt * 2.8);

        if (conn.alpha > 0.01) {
          activeList.push(conn);
        } else if (!conn.desired) {
          keysToDelete.push(key);
        }
      });

      for (var dIdx = 0; dIdx < keysToDelete.length; dIdx++) {
        activeConnectionsMap.delete(keysToDelete[dIdx]);
      }

      // 4. Gestión de pulsos luminosos de señal
      var now = performance.now();
      if (now >= nextPulseTime) {
        spawnPulse(activeList);
        nextPulseTime = now + (config.pulseIntervalMin + Math.random() * (config.pulseIntervalMax - config.pulseIntervalMin)) * 1000;
      }

      for (var k = pulses.length - 1; k >= 0; k--) {
        var pulse = pulses[k];
        pulse.progress += pulse.speed * dt;
        if (pulse.progress >= 1.0) {
          pulses.splice(k, 1);
        }
      }

      return activeList;
    }

    function drawFrame(dt){
      ctx.clearRect(0, 0, width, height);

      // Detectar límite inferior del hero respecto al viewport para transición perfecta
      var heroEl = document.querySelector('.hero');
      var heroBottom = heroEl ? heroEl.getBoundingClientRect().bottom : 0;

      updatePhysics(dt);
      var activeConnections = evaluateConnections(dt);
      var count = points.length;

      // 1. Dibujar conexiones de red (Líneas amplias y protagonistas)
      for (var i = 0; i < activeConnections.length; i++) {
        var conn = activeConnections[i];
        var p1 = conn.a;
        var p2 = conn.b;

        var x1 = p1.x + p1.offsetX;
        var y1 = p1.y + p1.offsetY;
        var x2 = p2.x + p2.offsetX;
        var y2 = p2.y + p2.offsetY;

        var c1 = calculateClearance(x1, y1, heroBottom);
        var c2 = calculateClearance(x2, y2, heroBottom);
        var clearance = (c1 + c2) * 0.5;

        var glow = (p1.glow + p2.glow) * 0.5;
        var hasAccent = p1.isAccent || p2.isAccent;

        // Ancho de línea diferenciado por escala
        var lWidth = (conn.tier === 'large')
          ? config.lineWidthLarge
          : ((conn.tier === 'medium') ? config.lineWidthMedium : config.lineWidthSmall);

        var effAlpha = config.baseLineAlpha * conn.alpha * clearance * glow;
        if (effAlpha <= 0.01) continue;

        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.lineWidth = lWidth;

        // Tratamiento cromático refinado
        var isCrossing = (y1 < heroBottom && y2 >= heroBottom) || (y2 < heroBottom && y1 >= heroBottom);

        if (hasAccent) {
          // Acento verde Nexo (#5CB83E)
          ctx.strokeStyle = config.lineAccent + Math.min(0.55, effAlpha * 1.5) + ')';
        } else if (isCrossing) {
          // Gradiente lineal suave al atravesar el límite del hero
          var grad = ctx.createLinearGradient(x1, y1, x2, y2);
          var alphaDark = Math.min(0.35, effAlpha * 1.25);
          var alphaLight = Math.min(0.24, effAlpha * 0.95);

          if (y1 < heroBottom) {
            grad.addColorStop(0, config.lineDefaultDark + alphaDark + ')');
            grad.addColorStop(1, config.lineDefaultLight + alphaLight + ')');
          } else {
            grad.addColorStop(0, config.lineDefaultLight + alphaLight + ')');
            grad.addColorStop(1, config.lineDefaultDark + alphaDark + ')');
          }
          ctx.strokeStyle = grad;
        } else if (y1 < heroBottom) {
          // Zona oscura del Hero
          ctx.strokeStyle = config.lineDefaultDark + Math.min(0.32, effAlpha * 1.2) + ')';
        } else {
          // Zona clara del resto de la página
          ctx.strokeStyle = config.lineDefaultLight + Math.min(0.22, effAlpha * 0.9) + ')';
        }

        ctx.stroke();
      }

      // 2. Dibujar pulsos luminosos recorriendo las conexiones amplias
      for (var pIdx = 0; pIdx < pulses.length; pIdx++) {
        var pl = pulses[pIdx];
        var xA = pl.p1.x + pl.p1.offsetX;
        var yA = pl.p1.y + pl.p1.offsetY;
        var xB = pl.p2.x + pl.p2.offsetX;
        var yB = pl.p2.y + pl.p2.offsetY;

        var curX = xA + (xB - xA) * pl.progress;
        var curY = yA + (yB - yA) * pl.progress;

        var pulseAlpha = Math.sin(pl.progress * Math.PI);
        if (pulseAlpha <= 0.05) continue;

        ctx.save();
        // Halo difuso esmeralda
        ctx.beginPath();
        ctx.arc(curX, curY, 5.5, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(92, 184, 62, ' + (pulseAlpha * 0.40) + ')';
        ctx.fill();

        // Núcleo brillante blanco
        ctx.beginPath();
        ctx.arc(curX, curY, 2.2, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255, 255, 255, ' + (pulseAlpha * 0.95) + ')';
        ctx.fill();
        ctx.restore();
      }

      // 3. Dibujar nodos proporcionados
      for (var n = 0; n < count; n++) {
        var pt = points[n];
        var px = pt.x + pt.offsetX;
        var py = pt.y + pt.offsetY;

        var inHeroZone = (py < heroBottom);
        var cl = calculateClearance(px, py, heroBottom);
        var baseAlpha = config.baseDotAlpha * cl * pt.glow;

        ctx.beginPath();
        ctx.arc(px, py, pt.radius, 0, Math.PI * 2);

        if (pt.isAccent) {
          ctx.fillStyle = config.dotAccent + Math.min(0.95, baseAlpha * 1.3) + ')';
        } else if (inHeroZone) {
          ctx.fillStyle = config.dotDefaultDark + Math.min(0.85, baseAlpha * 1.1) + ')';
        } else {
          ctx.fillStyle = config.dotDefaultLight + Math.min(0.48, baseAlpha * 0.8) + ')';
        }

        ctx.fill();
      }
    }

    function loop(currentTime){
      if (!isRunning) return;

      var dt = (currentTime - lastTime) / 1000;
      lastTime = currentTime;

      // Limitar dt para evitar saltos bruscos
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

    // Eventos de ratón para escritorio
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

    // Pausa al ocultar la pestaña para máximo rendimiento
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

    // Preferencias de accesibilidad de movimiento reducido
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
