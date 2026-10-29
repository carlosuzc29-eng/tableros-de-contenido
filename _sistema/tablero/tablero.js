/* ===============================================================
   NEXO TABLERO v2 · JavaScript Unificado (Modo Cliente + Modo Agencia)
   Incluye: Fondo de Red Canvas 2D + Gestor de Tablero y Selector de Meses
   =============================================================== */

/* NEXO-FONDO v2 — motor de red unificado */
/**
 * NEXO · Fondo Dinámico Global de Red de Conexiones a Gran Escala (Canvas 2D v2)
 *
 * Características v2:
 * - 28 nodos en escritorio / 14 en celular.
 * - 26 conexiones activas en escritorio / 10 en celular. Máximo 3 por punto.
 * - Grosor de líneas: grandes 2.4, medianas 1.8, pequeñas 1.2.
 * - baseLineAlpha: 0.30 (tope oscuro 0.45, tope claro 0.28). Clearance elíptico en tarjetas/hero.
 * - Estética futurista sin shadowBlur:
 *   · Halo de 6px (alpha 0.08) + núcleo de 1.6px en enlaces de acento.
 *   · Gradientes lineales con desvanecimiento en extremos (0, 0.15, 0.85, 1).
 *   · Nodos pre-renderizados en sprites offscreen con drawImage.
 *   · 2 capas de profundidad con parallax en scroll (lejana: 60% tamaño/alpha/vel, parallax 4%; cercana: 100%, parallax 8%).
 *   · Cometas de pulso: hasta 4 simultáneos, cola de 48px a 140px/s.
 *   · Conexiones temporales al cursor en escritorio (hasta 2 nodos a <220px, fade 200ms).
 * - Rendimiento estricto:
 *   · Presupuesto <2ms/frame en escritorio.
 *   · Celular limitado a 30fps y DPR 1.5 (escritorio DPR 2).
 *   · Caché de heroBottom en listeners pasivos (cero getBoundingClientRect por cuadro).
 *   · Pausa en pestaña oculta e IntersectionObserver.
 *   · ctx.setTransform(dpr, 0, 0, dpr, 0, 0) para evitar escala acumulada.
 *   · prefers-reduced-motion: cuadro único estático.
 */

(function(global){
  'use strict';

  var DEFAULT_CONFIG = {
    pointCountDesktop: 28,
    pointCountMobile: 14,

    ratioLarge: 0.60,
    ratioMedium: 0.30,
    ratioSmall: 0.10,

    targetConnectionsDesktop: 26,
    targetConnectionsMobile: 10,
    maxConnectionsPerPoint: 3,

    speedLarge: 6.5,
    speedMedium: 9.5,
    speedSmall: 13.5,
    speedVariance: 3.0,

    // Radios de nodos
    radiusLargeDesktop: 3.8,
    radiusMediumDesktop: 2.6,
    radiusSmallDesktop: 1.8,
    radiusLargeMobile: 3.0,
    radiusMediumMobile: 2.0,
    radiusSmallMobile: 1.4,

    // Grosor de líneas
    lineWidthLarge: 2.4,
    lineWidthMedium: 1.8,
    lineWidthSmall: 1.2,

    // Transparencias base y topes
    baseLineAlpha: 0.30,
    alphaCapDark: 0.45,
    alphaCapLight: 0.28,
    baseDotAlpha: 0.70,

    // Paleta de colores Nexo
    dotDefaultDark: 'rgba(230, 240, 250, ',
    lineDefaultDark: 'rgba(210, 230, 248, ',
    dotDefaultLight: 'rgba(31, 53, 73, ',
    lineDefaultLight: 'rgba(31, 53, 73, ',
    dotAccent: 'rgba(92, 184, 62, ',
    lineAccent: 'rgba(92, 184, 62, ',

    accentRatio: 0.25,

    // Pulsos cometa
    pulseEnabled: true,
    pulseMaxConcurrent: 4,
    pulseIntervalMin: 1.6,
    pulseIntervalMax: 3.8,
    pulseSpeed: 140, // px/s
    pulseTailLength: 48, // px

    // Cursor escritorio
    cursorRadius: 220,
    cursorMaxNodes: 2,
    cursorFadeTime: 0.20 // 200ms
  };

  function createNetworkBackground(targetContainer, options){
    var container = targetContainer || document.body;
    var config = Object.assign({}, DEFAULT_CONFIG, options || {});

    // Reutilizar o crear canvas
    var canvas = document.querySelector('.page-network-canvas') ||
                 document.getElementById('nexo-bg-canvas') ||
                 document.getElementById('netCanvas') ||
                 (container && container.querySelector ? container.querySelector('canvas.page-network-canvas') : null);

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
      canvas.style.zIndex = '0';

      if (document.body && document.body.firstChild) {
        document.body.insertBefore(canvas, document.body.firstChild);
      } else if (document.body) {
        document.body.appendChild(canvas);
      }
    } else {
      canvas.setAttribute('aria-hidden', 'true');
      canvas.style.pointerEvents = 'none';
    }

    var ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return null;

    var width = 0;
    var height = 0;
    var dpr = 1;
    var points = [];
    var activeConnectionsMap = new Map();
    var pulses = [];
    var nextPulseTime = performance.now() + 1200;
    var animationFrameId = null;
    var lastTime = performance.now();
    var lastMobileRenderTime = 0;
    var isRunning = false;
    var isVisible = true;
    var isIntersecting = true;
    var pointIdCounter = 0;
    var currentScrollY = window.pageYOffset || document.documentElement.scrollTop || 0;
    var cachedHeroBottom = 0;

    var mouse = { x: -9999, y: -9999, active: false };
    var cursorLinks = [
      { pointId: null, alpha: 0, targetAlpha: 0, dist: 0 },
      { pointId: null, alpha: 0, targetAlpha: 0, dist: 0 }
    ];

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

    // --- SPRITES PRE-RENDERIZADOS OFFSCREEN (cero shadowBlur) ---
    var sprites = {};
    function initSprites(){
      var size = 64;
      function buildSprite(coreColor, haloColor){
        var c = document.createElement('canvas');
        c.width = size;
        c.height = size;
        var sctx = c.getContext('2d');
        var grad = sctx.createRadialGradient(32, 32, 0, 32, 32, 30);
        grad.addColorStop(0, coreColor);
        grad.addColorStop(0.24, coreColor);
        grad.addColorStop(0.55, haloColor);
        grad.addColorStop(1, 'rgba(0,0,0,0)');
        sctx.fillStyle = grad;
        sctx.beginPath();
        sctx.arc(32, 32, 30, 0, Math.PI * 2);
        sctx.fill();
        return c;
      }

      sprites.darkDefault = buildSprite('rgba(230, 240, 250, 0.95)', 'rgba(210, 230, 248, 0.25)');
      sprites.lightDefault = buildSprite('rgba(31, 53, 73, 0.90)', 'rgba(31, 53, 73, 0.20)');
      sprites.accent = buildSprite('rgba(92, 184, 62, 0.98)', 'rgba(92, 184, 62, 0.35)');
      sprites.cometHead = buildSprite('rgba(255, 255, 255, 1)', 'rgba(92, 184, 62, 0.6)');
    }
    initSprites();

    // Actualización en caché de límite inferior del hero (sin lecturas por cuadro)
    function updateHeroBottomCache(){
      var hero = document.querySelector('.hero') ||
                 document.querySelector('.kanban-header') ||
                 document.querySelector('.pub-hero') ||
                 document.querySelector('.ws-hero');
      if (hero) {
        cachedHeroBottom = hero.getBoundingClientRect().bottom;
      } else {
        cachedHeroBottom = 0;
      }
    }

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
        minLarge: w * 0.24,
        maxLarge: w * 0.46,
        minMedium: w * 0.13,
        maxMedium: w * 0.24,
        minSmall: w * 0.05,
        maxSmall: w * 0.13
      };
    }

    // Clearance elíptico en tarjetas y hero para no comprometer legibilidad
    function calculateClearance(px, py, heroBottom){
      if (heroBottom <= 20) return 1.0;
      var heroHeight = Math.min(height, heroBottom);
      var focalX = width * 0.32;
      var focalY = heroHeight * 0.48;
      var rx = width * 0.28;
      var ry = heroHeight * 0.38;
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

      for (var i = 0; i < count; i++) {
        var tier = 'large';
        var randTier = i / count;
        if (randTier >= 0.60 && randTier < 0.88) {
          tier = 'medium';
        } else if (randTier >= 0.88) {
          tier = 'small';
        }

        // Profundidad en 2 capas: 0 = Lejana (60% escala/alpha/vel), 1 = Cercana (100%)
        var layer = (i % 2 === 0) ? 0 : 1;
        var layerScale = (layer === 0) ? 0.60 : 1.0;

        var bleedX = width * 0.08;
        var bleedY = height * 0.08;
        var x = -bleedX + Math.random() * (width + bleedX * 2);
        var y = -bleedY + Math.random() * (height + bleedY * 2);

        var isAccent = (Math.random() < config.accentRatio);
        var baseSpd = (tier === 'large') ? config.speedLarge : ((tier === 'medium') ? config.speedMedium : config.speedSmall);
        var speed = (baseSpd + (Math.random() - 0.5) * config.speedVariance) * layerScale;
        var angle = Math.random() * Math.PI * 2;

        var baseRad = isMobile()
          ? (tier === 'large' ? config.radiusLargeMobile : (tier === 'medium' ? config.radiusMediumMobile : config.radiusSmallMobile))
          : (tier === 'large' ? config.radiusLargeDesktop : (tier === 'medium' ? config.radiusMediumDesktop : config.radiusSmallDesktop));

        var rad = baseRad * layerScale;

        points.push({
          id: ++pointIdCounter,
          tier: tier,
          layer: layer,
          x: x,
          y: y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          angle: angle,
          va: (Math.random() - 0.5) * 0.18,
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

      // iOS: ignorar cambios menores a 150px por colapso de barra URL
      if (isTouchDevice && lastW === w && Math.abs(h - lastH) < 150) {
        return;
      }
      lastW = w;
      lastH = h;

      width = w;
      height = h;

      // Presupuesto: DPR 1.5 en celular, DPR 2 en escritorio
      var isMob = isMobile();
      dpr = isMob ? Math.min(window.devicePixelRatio || 1, 1.5) : Math.min(window.devicePixelRatio || 1, 2);

      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);

      // Usar setTransform en lugar de scale acumulado
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      currentScrollY = window.pageYOffset || document.documentElement.scrollTop || 0;
      updateHeroBottomCache();

      var expectedCount = getPointCount();
      if (!points.length || Math.abs(points.length - expectedCount) > 2) {
        initPoints();
      } else {
        points.forEach(function(p){
          if (p.x > width * 1.1) p.x = width * Math.random();
          if (p.y > height * 1.1) p.y = height * Math.random();
        });
      }

      if (reducedMotionQuery.matches) {
        drawFrame(0, true);
      }
    }

    function spawnPulse(activeList){
      if (!config.pulseEnabled || !activeList.length) return;
      if (pulses.length >= config.pulseMaxConcurrent) return;

      var candidates = activeList.filter(function(c){
        return c.alpha > 0.4 && (c.tier === 'large' || c.tier === 'medium');
      });
      if (!candidates.length) candidates = activeList;

      var conn = candidates[Math.floor(Math.random() * candidates.length)];
      if (!conn) return;

      var dx = (conn.b.x + conn.b.offsetX) - (conn.a.x + conn.a.offsetX);
      var dy = (conn.b.y + conn.b.offsetY) - (conn.a.y + conn.a.offsetY);
      var dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 50) return;

      var p1 = Math.random() < 0.5 ? conn.a : conn.b;
      var p2 = (p1 === conn.a) ? conn.b : conn.a;

      pulses.push({
        p1: p1,
        p2: p2,
        progress: 0,
        speed: config.pulseSpeed / dist,
        tier: conn.tier,
        dist: dist
      });
    }

    function updatePhysics(dt){
      var count = points.length;
      var bleedX = width * 0.09;
      var bleedY = height * 0.09;

      for (var i = 0; i < count; i++) {
        var p = points[i];

        p.angle += p.va * dt;
        p.vx = Math.cos(p.angle) * p.speed;
        p.vy = Math.sin(p.angle) * p.speed;

        p.x += p.vx * dt;
        p.y += p.vy * dt;

        if (p.x < -bleedX) p.x = width + bleedX;
        else if (p.x > width + bleedX) p.x = -bleedX;

        if (p.y < -bleedY) p.y = height + bleedY;
        else if (p.y > height + bleedY) p.y = -bleedY;

        // Repulsión con ratón en escritorio
        if (!isTouchDevice && mouse.active) {
          var mdx = (p.x + p.offsetX) - mouse.x;
          var mdy = (p.y + p.offsetY) - mouse.y;
          var mDist = Math.sqrt(mdx * mdx + mdy * mdy);

          if (mDist < config.cursorRadius && mDist > 0) {
            var factor = (1 - (mDist / config.cursorRadius));
            var push = factor * factor * 20;
            p.targetOffsetX = (mdx / mDist) * push;
            p.targetOffsetY = (mdy / mDist) * push;
            p.targetGlow = 1.0 + factor * 0.45;
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

        p.offsetX += (p.targetOffsetX - p.offsetX) * 0.12;
        p.offsetY += (p.targetOffsetY - p.offsetY) * 0.12;
        p.glow += (p.targetGlow - p.glow) * 0.12;
      }

      // Actualizar enlaces temporales del cursor (hasta 2 nodos más cercanos)
      if (!isTouchDevice && mouse.active) {
        var nearNodes = [];
        for (var n = 0; n < count; n++) {
          var pt = points[n];
          var cdx = (pt.x + pt.offsetX) - mouse.x;
          var cdy = (pt.y + pt.offsetY) - mouse.y;
          var cDist = Math.sqrt(cdx * cdx + cdy * cdy);
          if (cDist < config.cursorRadius) {
            nearNodes.push({ point: pt, dist: cDist });
          }
        }
        nearNodes.sort(function(a, b){ return a.dist - b.dist; });

        for (var cIdx = 0; cIdx < 2; cIdx++) {
          var link = cursorLinks[cIdx];
          if (nearNodes[cIdx]) {
            link.pointId = nearNodes[cIdx].point.id;
            link.dist = nearNodes[cIdx].dist;
            link.targetAlpha = (1 - (nearNodes[cIdx].dist / config.cursorRadius)) * 0.55;
          } else {
            link.targetAlpha = 0;
          }
          link.alpha += (link.targetAlpha - link.alpha) * Math.min(1, dt / config.cursorFadeTime);
        }
      } else {
        for (var j = 0; j < 2; j++) {
          cursorLinks[j].targetAlpha = 0;
          cursorLinks[j].alpha += (0 - cursorLinks[j].alpha) * Math.min(1, dt / config.cursorFadeTime);
        }
      }
    }

    function evaluateConnections(dt){
      var count = points.length;
      var brackets = getDistanceBrackets();
      var targetTotal = getTargetConnections();

      var maxLarge = Math.max(1, Math.round(targetTotal * config.ratioLarge));
      var maxMedium = Math.max(1, Math.round(targetTotal * config.ratioMedium));
      var maxSmall = Math.max(1, Math.round(targetTotal * config.ratioSmall));

      for (var pIdx = 0; pIdx < count; pIdx++) {
        points[pIdx].connectionCount = 0;
      }

      activeConnectionsMap.forEach(function(conn){
        conn.desired = false;
      });

      // 1. Evaluar conexiones existentes
      activeConnectionsMap.forEach(function(conn){
        var ax = conn.a.x + conn.a.offsetX;
        var ay = conn.a.y + conn.a.offsetY;
        var bx = conn.b.x + conn.b.offsetX;
        var by = conn.b.y + conn.b.offsetY;
        var dx = bx - ax;
        var dy = by - ay;
        var dist = Math.sqrt(dx * dx + dy * dy);

        conn.dist = dist;

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

        if (inRange &&
            conn.a.connectionCount < config.maxConnectionsPerPoint &&
            conn.b.connectionCount < config.maxConnectionsPerPoint) {
          conn.desired = true;
          conn.a.connectionCount++;
          conn.b.connectionCount++;
        }
      });

      var currentLarge = 0, currentMedium = 0, currentSmall = 0;
      activeConnectionsMap.forEach(function(conn){
        if (conn.desired) {
          if (conn.tier === 'large') currentLarge++;
          else if (conn.tier === 'medium') currentMedium++;
          else currentSmall++;
        }
      });

      // 2. Buscar nuevos pares candidatos (priorizando enlaces dentro de la misma capa de profundidad)
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
              normDist: normDist,
              sameLayer: (pA.layer === pB.layer)
            });
          }
        }
      }

      candidatePairs.sort(function(c1, c2){
        if (c1.sameLayer !== c2.sameLayer) {
          return c1.sameLayer ? -1 : 1;
        }
        return Math.abs(c1.normDist - 0.5) - Math.abs(c2.normDist - 0.5);
      });

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

      // 3. Suavizado de opacidad
      var activeList = [];
      var keysToDelete = [];

      activeConnectionsMap.forEach(function(conn, key){
        var targetAlpha = 0.0;
        if (conn.desired) {
          var bracketsLocal = getDistanceBrackets();
          var minD, maxD;
          if (conn.tier === 'large') { minD = bracketsLocal.minLarge; maxD = bracketsLocal.maxLarge; }
          else if (conn.tier === 'medium') { minD = bracketsLocal.minMedium; maxD = bracketsLocal.maxMedium; }
          else { minD = bracketsLocal.minSmall; maxD = bracketsLocal.maxSmall; }

          var span = maxD - minD;
          var frac = span > 0 ? ((conn.dist - minD) / span) : 0.5;
          frac = Math.max(0, Math.min(1, frac));
          var taper = Math.sin(frac * Math.PI);
          targetAlpha = 0.35 + 0.65 * taper;
        }

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

      // 4. Gestión de pulsos cometa
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

    function drawFrame(dt, isStatic){
      var tStart = performance.now();
      ctx.clearRect(0, 0, width, height);

      if (!isStatic) {
        updatePhysics(dt);
      }
      var activeConnections = evaluateConnections(dt);
      var count = points.length;
      var heroBottom = cachedHeroBottom;
      var scrollY = isStatic ? 0 : currentScrollY;

      // Detectar si toda la superficie es oscura (ej. Banco de trabajo o Producción dark)
      var isDarkPage = (document.documentElement.getAttribute('data-theme') === 'dark') ||
                       (document.body && document.body.classList.contains('dark-theme')) ||
                       (!document.querySelector('.hero') && !document.querySelector('.kanban-area[data-theme="light"]'));

      // Fondo infinito en toda la pantalla: sin desfase acumulativo por scroll
      function getParallaxY(layer){
        return 0;
      }

      // 1. DIBUJAR CONEXIONES (con gradientes desvanecidos en extremos y doble trazo en acento)
      for (var i = 0; i < activeConnections.length; i++) {
        var conn = activeConnections[i];
        var p1 = conn.a;
        var p2 = conn.b;

        var py1 = getParallaxY(p1.layer);
        var py2 = getParallaxY(p2.layer);

        var x1 = p1.x + p1.offsetX;
        var y1 = p1.y + p1.offsetY - py1;
        var x2 = p2.x + p2.offsetX;
        var y2 = p2.y + p2.offsetY - py2;

        var c1 = calculateClearance(x1, y1, heroBottom);
        var c2 = calculateClearance(x2, y2, heroBottom);
        var clearance = (c1 + c2) * 0.5;

        var glow = (p1.glow + p2.glow) * 0.5;
        var hasAccent = p1.isAccent || p2.isAccent;
        var layerFactor = (p1.layer === 0 && p2.layer === 0) ? 0.60 : 1.0;

        var lWidth = (conn.tier === 'large')
          ? config.lineWidthLarge
          : ((conn.tier === 'medium') ? config.lineWidthMedium : config.lineWidthSmall);
        lWidth = lWidth * layerFactor;

        var effAlpha = config.baseLineAlpha * conn.alpha * clearance * glow * (p1.layer === 0 ? 0.65 : 1.0);
        if (effAlpha <= 0.01) continue;

        var isDarkZone = isDarkPage || (y1 < heroBottom && y2 < heroBottom);
        var cap = isDarkZone ? config.alphaCapDark : config.alphaCapLight;
        var finalAlpha = Math.min(cap, effAlpha);

        // Gradiente con desvanecimiento en extremos (0, 0.15, 0.85, 1)
        var grad = ctx.createLinearGradient(x1, y1, x2, y2);
        var colorBase = hasAccent
          ? config.lineAccent
          : (isDarkZone ? config.lineDefaultDark : config.lineDefaultLight);

        grad.addColorStop(0, colorBase + '0)');
        grad.addColorStop(0.15, colorBase + finalAlpha + ')');
        grad.addColorStop(0.85, colorBase + finalAlpha + ')');
        grad.addColorStop(1, colorBase + '0)');

        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);

        if (hasAccent) {
          // Trazo 1: Halo de 6px con alpha 0.08
          ctx.lineWidth = 6.0 * layerFactor;
          ctx.strokeStyle = config.lineAccent + (0.08 * clearance) + ')';
          ctx.stroke();

          // Trazo 2: Núcleo de 1.6px
          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
          ctx.lineWidth = 1.6 * layerFactor;
          ctx.strokeStyle = grad;
          ctx.stroke();
        } else {
          ctx.lineWidth = lWidth;
          ctx.strokeStyle = grad;
          ctx.stroke();
        }
      }

      // 2. DIBUJAR PULSOS COMETA (cola degradada de 48px a 140px/s)
      if (!isStatic) {
        for (var pIdx = 0; pIdx < pulses.length; pIdx++) {
          var pl = pulses[pIdx];
          var pyA = getParallaxY(pl.p1.layer);
          var pyB = getParallaxY(pl.p2.layer);

          var xA = pl.p1.x + pl.p1.offsetX;
          var yA = pl.p1.y + pl.p1.offsetY - pyA;
          var xB = pl.p2.x + pl.p2.offsetX;
          var yB = pl.p2.y + pl.p2.offsetY - pyB;

          var totalDx = xB - xA;
          var totalDy = yB - yA;
          var totalDist = pl.dist || Math.sqrt(totalDx * totalDx + totalDy * totalDy);
          if (totalDist <= 10) continue;

          var dirX = totalDx / totalDist;
          var dirY = totalDy / totalDist;

          var headDist = totalDist * pl.progress;
          var tailDist = Math.max(0, headDist - config.pulseTailLength);

          var headX = xA + dirX * headDist;
          var headY = yA + dirY * headDist;
          var tailX = xA + dirX * tailDist;
          var tailY = yA + dirY * tailDist;

          var pulseAlpha = Math.sin(pl.progress * Math.PI);
          if (pulseAlpha <= 0.02) continue;

          // Cola del cometa
          var cometGrad = ctx.createLinearGradient(tailX, tailY, headX, headY);
          cometGrad.addColorStop(0, 'rgba(92, 184, 62, 0)');
          cometGrad.addColorStop(0.65, 'rgba(92, 184, 62, ' + (pulseAlpha * 0.40) + ')');
          cometGrad.addColorStop(1, 'rgba(255, 255, 255, ' + (pulseAlpha * 0.95) + ')');

          ctx.beginPath();
          ctx.moveTo(tailX, tailY);
          ctx.lineTo(headX, headY);
          ctx.lineWidth = 2.4;
          ctx.strokeStyle = cometGrad;
          ctx.stroke();

          // Cabeza brillante del cometa (usando sprite offscreen)
          var headSize = 22 * pulseAlpha;
          ctx.globalAlpha = pulseAlpha;
          ctx.drawImage(sprites.cometHead, headX - headSize / 2, headY - headSize / 2, headSize, headSize);
          ctx.globalAlpha = 1.0;
        }
      }

      // 3. CONEXIONES TEMPORALES AL CURSOR EN ESCRITORIO (<220px, fade 200ms)
      if (!isTouchDevice && !isStatic) {
        for (var cL = 0; cL < 2; cL++) {
          var clink = cursorLinks[cL];
          if (clink.alpha > 0.01 && clink.pointId) {
            var targetNode = null;
            for (var pn = 0; pn < count; pn++) {
              if (points[pn].id === clink.pointId) {
                targetNode = points[pn];
                break;
              }
            }
            if (targetNode) {
              var cpy = getParallaxY(targetNode.layer);
              var tX = targetNode.x + targetNode.offsetX;
              var tY = targetNode.y + targetNode.offsetY - cpy;

              var cGrad = ctx.createLinearGradient(mouse.x, mouse.y, tX, tY);
              cGrad.addColorStop(0, 'rgba(92, 184, 62, 0)');
              cGrad.addColorStop(0.25, 'rgba(92, 184, 62, ' + clink.alpha + ')');
              cGrad.addColorStop(0.85, 'rgba(92, 184, 62, ' + (clink.alpha * 0.7) + ')');
              cGrad.addColorStop(1, 'rgba(92, 184, 62, 0)');

              ctx.beginPath();
              ctx.moveTo(mouse.x, mouse.y);
              ctx.lineTo(tX, tY);
              ctx.lineWidth = 1.4;
              ctx.strokeStyle = cGrad;
              ctx.stroke();
            }
          }
        }
      }

      // 4. DIBUJAR NODOS CON SPRITES PRE-RENDERIZADOS (drawImage ultra-rápido)
      for (var n = 0; n < count; n++) {
        var pt = points[n];
        var ppy = getParallaxY(pt.layer);
        var px = pt.x + pt.offsetX;
        var py = pt.y + pt.offsetY - ppy;

        var inDark = isDarkPage || (py < heroBottom);
        var cl = calculateClearance(px, py, heroBottom);
        var layerAlpha = (pt.layer === 0) ? 0.50 : 1.0;
        var baseAlpha = config.baseDotAlpha * cl * pt.glow * layerAlpha;

        var spriteImg = pt.isAccent
          ? sprites.accent
          : (inDark ? sprites.darkDefault : sprites.lightDefault);

        // Diámetro del sprite escalado según el radio del nodo
        var drawSize = pt.radius * 5.6;

        ctx.globalAlpha = Math.min(1.0, Math.max(0, baseAlpha));
        ctx.drawImage(spriteImg, px - drawSize / 2, py - drawSize / 2, drawSize, drawSize);
      }
      ctx.globalAlpha = 1.0;

      var tEnd = performance.now();
      if (!isStatic) {
        if (!window.__nexoPerfHistory) window.__nexoPerfHistory = [];
        if (window.__nexoPerfHistory.length < 90) {
          window.__nexoPerfHistory.push(tEnd - tStart);
          if (window.__nexoPerfHistory.length === 90) {
            var samples = window.__nexoPerfHistory.slice(15);
            var sum = 0;
            for (var si = 0; si < samples.length; si++) sum += samples[si];
            window.__nexoPerf = {
              avgMs: (sum / samples.length).toFixed(2),
              samples: samples.length,
              dpr: dpr,
              isMobile: isMobile()
            };
          }
        }
      }
    }

    function loop(currentTime){
      if (!isRunning) return;

      // Throttling a 30fps en celular para preservar batería y fluidez de scroll
      if (isMobile()) {
        if (currentTime - lastMobileRenderTime < 32) {
          animationFrameId = requestAnimationFrame(loop);
          return;
        }
        lastMobileRenderTime = currentTime;
      }

      var dt = (currentTime - lastTime) / 1000;
      lastTime = currentTime;

      if (dt > 0.1) dt = 0.1;
      if (dt <= 0) dt = 0.016;

      drawFrame(dt, false);
      animationFrameId = requestAnimationFrame(loop);
    }

    function start(){
      if (isRunning) return;
      if (reducedMotionQuery.matches) {
        resize();
        drawFrame(0, true);
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

    // Pausa pasiva al ocultar pestaña
    function onVisibilityChange(){
      if (document.hidden) {
        isVisible = false;
        stop();
      } else {
        isVisible = true;
        if (isIntersecting) start();
      }
    }
    document.addEventListener('visibilitychange', onVisibilityChange);

    // IntersectionObserver para pausar si el canvas no se visualiza
    if ('IntersectionObserver' in window && canvas) {
      var observer = new IntersectionObserver(function(entries){
        if (entries && entries[0]) {
          isIntersecting = entries[0].isIntersecting;
          if (isIntersecting && !document.hidden && !reducedMotionQuery.matches) {
            start();
          } else {
            stop();
          }
        }
      }, { threshold: 0 });
      observer.observe(canvas);
    }

    // Scroll pasivo para parallax y actualización de hero
    window.addEventListener('scroll', function(){
      currentScrollY = window.pageYOffset || document.documentElement.scrollTop || 0;
      updateHeroBottomCache();
    }, { passive: true });

    // Accesibilidad: prefers-reduced-motion
    function onMotionChange(e){
      if (e.matches) {
        stop();
        drawFrame(0, true);
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
      stop: stop,
      drawFrame: drawFrame
    };
    global.NexoNetworkBackground.activeInstance = instance;
    if (typeof window !== 'undefined') window.__nexoBgInstance = instance;
    return instance;
  }

  global.NexoNetworkBackground = {
    init: createNetworkBackground,
    DEFAULT_CONFIG: DEFAULT_CONFIG
  };

})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this));

/* ===============================================================
   LÓGICA DEL TABLERO V2 CON SELECTOR DE MESES Y SOPORTE MULTI-MES
   =============================================================== */
(function(){
  'use strict';

  document.addEventListener('touchstart', function(){}, {passive:true});
  document.documentElement.className = document.documentElement.className.replace(/\bno-js\b/, 'js');

  var DATA = null;
  var items = [];
  var cards = [];
  var KEY = '';
  // Piezas que el cliente evaluó o comentó y aún no envió: { idPieza: versión evaluada }.
  // La sincronización con Firestore no pisa su decisión ni sus comentarios mientras la versión no cambie.
  var sinEnviar = {};
  var FB = {
    apiKey: "AIzaSyAsH9TxW0ld2aNQejJw6xxZW7fpZiw212Q",
    projectId: "nexo-tableros-app"
  };
  var indiceData = null;
  var activeMes = null;
  var isClosedMonth = false;
  var monthsCache = {};
  var codigoCliente = '';

  var LBL = {
    borrador: 'Borrador',
    en_revision: 'En revisión',
    pendiente: 'En revisión',
    cambios: 'Cambios solicitados',
    en_correccion: 'En corrección',
    corregido: 'Corregido',
    aprobado: 'Aprobado'
  };
  var C = 2 * Math.PI * 82;
  var $ = function(id){ return document.getElementById(id); };
  var list = null, nav = null;

  var LBL = {
    borrador: 'Borrador',
    en_revision: 'En revisión',
    pendiente: 'En revisión',
    cambios: 'Cambios solicitados',
    en_correccion: 'En corrección',
    corregido: 'Corregido',
    aprobado: 'Aprobado'
  };
  var C = 2 * Math.PI * 82;
  var $ = function(id){ return document.getElementById(id); };
  [].forEach.call(document.querySelectorAll('[data-logo]'), function(d){ d.innerHTML = $('nexo-logo').innerHTML; });
  try { $('fav').href = 'data:image/svg+xml,' + encodeURIComponent($('nexo-iso').innerHTML.trim()); } catch (e) {}

  // Configuración de Firebase
  var FB = {
    apiKey: 'AIzaSyAsH9TxW0ld2aNQejJw6xxZW7fpZiw212Q',
    projectId: 'nexo-tableros-app'
  };

  // Autenticación de Agencia (Carlos y Andrea)
  var AGENCY_ALLOWED = ['carlosuzc29@gmail.com', 'andrevmuedit@gmail.com'];
  var AGENCY_SESSION_KEY = 'nexo_agency_session';
  var agencySession = null;
  var agencyUser = null;

  // Limpiar claves legadas inseguras
  try {
    localStorage.removeItem('nexo_agency_logged_user');
    sessionStorage.removeItem('nexo_agency_logged_user');
    localStorage.removeItem('nexo_reviewer_name');
  } catch(e) {}

  function clearAgencySession(){
    agencySession = null;
    agencyUser = null;
    try {
      sessionStorage.removeItem(AGENCY_SESSION_KEY);
      localStorage.removeItem('nexo_agency_logged_user');
      sessionStorage.removeItem('nexo_agency_logged_user');
    } catch(e) {}
  }

  function saveAgencySession(sess){
    agencySession = sess;
    agencyUser = sess ? sess.email : null;
    try {
      if (sess) {
        sessionStorage.setItem(AGENCY_SESSION_KEY, JSON.stringify(sess));
      } else {
        sessionStorage.removeItem(AGENCY_SESSION_KEY);
      }
    } catch(e) {}
  }

  function refreshAgencyToken(refreshToken){
    var url = 'https://securetoken.googleapis.com/v1/token?key=' + encodeURIComponent(FB.apiKey);
    var body = 'grant_type=refresh_token&refresh_token=' + encodeURIComponent(refreshToken);
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body
    })
    .then(function(res){
      if (!res.ok) {
        throw new Error('Refresh failed HTTP ' + res.status);
      }
      return res.json();
    })
    .then(function(data){
      var newIdToken = data.id_token || data.idToken;
      var newRefreshToken = data.refresh_token || data.refreshToken || refreshToken;
      var expiresInSec = parseInt(data.expires_in || data.expiresIn || '3600', 10);
      if (!newIdToken) throw new Error('No idToken in refresh response');
      var updatedSession = {
        idToken: newIdToken,
        refreshToken: newRefreshToken,
        email: (agencySession && agencySession.email) || (agencyUser || ''),
        expiresAt: Date.now() + (expiresInSec * 1000)
      };
      saveAgencySession(updatedSession);
      return updatedSession;
    })
    .catch(function(err){
      clearAgencySession();
      if (typeof updateAgencyUI === 'function') updateAgencyUI();
      throw err;
    });
  }

  function getValidAgencyToken(){
    if (!agencySession || !agencySession.idToken) return Promise.resolve(null);
    if (agencySession.expiresAt && Date.now() < (agencySession.expiresAt - 60000)) {
      return Promise.resolve(agencySession.idToken);
    }
    if (agencySession.refreshToken) {
      return refreshAgencyToken(agencySession.refreshToken).then(function(sess){
        return sess.idToken;
      }).catch(function(){
        return null;
      });
    }
    clearAgencySession();
    if (typeof updateAgencyUI === 'function') updateAgencyUI();
    return Promise.resolve(null);
  }

  // Carga inicial de sesión
  try {
    var rawAgencySess = sessionStorage.getItem(AGENCY_SESSION_KEY);
    if (rawAgencySess) {
      var parsedAgencySess = JSON.parse(rawAgencySess);
      if (parsedAgencySess && parsedAgencySess.idToken && parsedAgencySess.email && AGENCY_ALLOWED.indexOf(parsedAgencySess.email) !== -1) {
        if (parsedAgencySess.expiresAt && Date.now() < parsedAgencySess.expiresAt) {
          agencySession = parsedAgencySess;
          agencyUser = parsedAgencySess.email;
        } else if (parsedAgencySess.refreshToken) {
          refreshAgencyToken(parsedAgencySess.refreshToken).then(function(){
            if (typeof updateAgencyUI === 'function') updateAgencyUI();
          }).catch(function(){});
        } else {
          clearAgencySession();
        }
      } else {
        clearAgencySession();
      }
    }
  } catch(e) {
    clearAgencySession();
  }

  // Formatos exclusivos de trabajo: únicamente estos 4 formatos
  var FORMATOS = ['Reel', 'Carrusel', 'Carrusel con video', 'Post'];
  function normalizeFormato(fmt) {
    if (!fmt) return 'Post';
    var lower = String(fmt).trim().toLowerCase();
    if (lower.indexOf('carrusel con video') >= 0) return 'Carrusel con video';
    if (lower.indexOf('carrusel') >= 0) return 'Carrusel';
    if (lower.indexOf('reel') >= 0) return 'Reel';
    return 'Post';
  }

  function esSinEvaluar(estado) {
    return !estado || estado === 'pendiente' || estado === 'en_revision' || estado === 'borrador';
  }

  function isCorrectionNote(cm) {
    if (!cm) return false;
    var t = ((cm.texto || '') + ' ' + (cm.autor || '')).toLowerCase();
    return t.indexOf('pieza corregida') >= 0 || t.indexOf('versión v') >= 0;
  }

  function parseComentarios(str, defaultAuthor){
    if (!str || !String(str).trim()) return [];
    var lines = String(str).split(/\r?\n/);
    var result = [], cur = null;
    lines.forEach(function(line){
      var t = line.trim();
      if (!t) return;
      var m = t.match(/^\[(.*?)\]:\s*(.*)$/);
      if (m) {
        if (cur) result.push(cur);
        cur = { autor: m[1].trim(), texto: m[2].trim(), fecha: '' };
      } else {
        if (cur) { cur.texto += '\n' + t; }
        else { cur = { autor: defaultAuthor || 'Cliente', texto: t, fecha: '' }; }
      }
    });
    if (cur) result.push(cur);
    var filtered = result.filter(function(c){ return !isCorrectionNote(c); });
    return filtered.length ? filtered : (result.length ? [] : [{ autor: defaultAuthor || 'Cliente', texto: String(str).trim(), fecha: '' }]);
  }

  function formatComentariosString(list){
    if (!list || !list.length) return '';
    return list.filter(function(c){ return !isCorrectionNote(c); }).map(function(c){
      return (c.autor ? '[' + c.autor + ']: ' : '') + (c.texto || '');
    }).join('\n\n');
  }

  function formatRelTime(isoStr){
    if (!isoStr) return '';
    try {
      var d = new Date(isoStr);
      if (isNaN(d.getTime())) return '';
      return d.toLocaleDateString('es-VE', {day:'2-digit', month:'short'}) + ' ' + d.toLocaleTimeString('es-VE', {hour:'2-digit', minute:'2-digit'});
    } catch(e){ return ''; }
  }

  // DETECCIÓN DE ENVÍO DE CORRECCIONES / FILTRO SELECTIVO DE PIEZAS
  var urlParams = new URLSearchParams(window.location.search);
  var piezasParam = urlParams.get('piezas');
  var isReviewShipment = urlParams.get('review') === 'corregidos' || urlParams.get('filtro') === 'corregido' || urlParams.get('filtro') === 'corregidos' || !!piezasParam;
  var targetPieceNumbers = null;
  if (piezasParam) {
    targetPieceNumbers = piezasParam.split(',').map(function(s){ return parseInt(s.trim(), 10); }).filter(function(n){ return !isNaN(n) && n > 0; });
  }

  function getReviewerName(){
    if (agencyUser) {
      return 'Agencia (' + (agencyUser === 'carlosuzc29@gmail.com' ? 'Carlos' : 'Andrea') + ')';
    }
    var whoEl = $('who');
    var w = whoEl ? whoEl.value.trim() : '';
    if (w && w.indexOf('Agencia (') !== 0) return w;
    try {
      var boardKey = 'nexo_reviewer_name_' + (DATA.id || 'board');
      var stored = localStorage.getItem(boardKey) || sessionStorage.getItem(boardKey);
      if (stored && stored.trim() && stored.trim().indexOf('Agencia (') !== 0) return stored.trim();
    } catch(e){}
    return '';
  }

  function setReviewerName(name){
    var trimmed = (name || '').trim();
    if (trimmed.indexOf('Agencia (') === 0) return;
    DATA.revision.revisadoPor = trimmed;
    var whoEl = $('who');
    if (whoEl) whoEl.value = trimmed;
    try {
      if (trimmed) {
        var boardKey = 'nexo_reviewer_name_' + (DATA.id || 'board');
        localStorage.setItem(boardKey, trimmed);
        sessionStorage.setItem(boardKey, trimmed);
      }
    } catch(e){}
  }



  function saveDraft(){
    try {
      var whoVal = getReviewerName();
      if (whoVal && whoVal.indexOf('Agencia (') === 0) whoVal = '';
      var o = {who: whoVal, items: {}, resetAt: DATA.resetAt || 0, sinEnviar: sinEnviar};
      items.forEach(function(it){
        o.items[it.id] = {
          estado: it.estado,
          comentario: it.comentario,
          formato: it.formato,
          comentarios: it.comentarios,
          revisadoPor: it.revisadoPor,
          guion: it.guion,
          copy: it.copy,
          version: it.version,
          fechaCorreccion: it.fechaCorreccion
        };
      });
      localStorage.setItem(KEY, JSON.stringify(o));
      if (whoVal && whoVal.indexOf('Agencia (') !== 0) {
        localStorage.setItem('nexo_reviewer_name_' + (DATA.id || 'board'), whoVal);
      }
    } catch (e) {}
  }

  function marcarSinEnviar(it){
    if (agencyUser) return;
    sinEnviar[it.id] = parseInt(it.version, 10) || 1;
  }

  function el(tag, cls, txt){ var e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }
  function pad(n){ return (n < 10 ? '0' : '') + n; }
  function safeUrl(u){ return /^https?:\/\//i.test(u || '') ? u : null; }
  function escapeHtml(s){
    return String(s || '').replace(/[&<>'"]/g, function(t){
      return {'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[t];
    });
  }

  function copyTextToClipboard(text, cb){
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function(){
        if (cb) cb(true);
      }).catch(function(){
        fallbackCopyText(text, cb);
      });
    } else {
      fallbackCopyText(text, cb);
    }
  }
  function fallbackCopyText(text, cb){
    try {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      var ok = document.execCommand('copy');
      document.body.removeChild(ta);
      if (cb) cb(ok);
    } catch(e) {
      if (cb) cb(false);
    }
  }

  function getReviewCorregidosUrl(){
    var corregidosNums = items.map(function(it, idx){
      return it.estado === 'corregido' ? (idx + 1) : null;
    }).filter(Boolean);

    var base = (DATA.url && DATA.url.indexOf('http') === 0)
      ? DATA.url
      : window.location.href.split('?')[0].split('#')[0];

    var sep = base.indexOf('?') === -1 ? '?' : '&';
    var finalUrl = base + sep + 'review=corregidos';
    if (activeMes) {
      finalUrl += '&mes=' + encodeURIComponent(activeMes);
    }
    if (corregidosNums.length > 0) {
      finalUrl += '&piezas=' + corregidosNums.join(',');
    }
    return finalUrl;
  }



  function updateClosedMonthBanner(){
    var existing = document.getElementById('closedMonthBanner');
    if (isClosedMonth) {
      if (!existing) {
        existing = document.createElement('div');
        existing.id = 'closedMonthBanner';
        existing.className = 'closed-month-banner';
        var topbar = document.querySelector('.topbar');
        if (topbar && topbar.nextSibling) {
          topbar.parentNode.insertBefore(existing, topbar.nextSibling);
        } else {
          document.body.insertBefore(existing, document.body.firstChild);
        }
      }
      var label = '';
      if (indiceData && indiceData.meses) {
        for (var mi = 0; mi < indiceData.meses.length; mi++) {
          if (indiceData.meses[mi].mes === activeMes) {
            label = indiceData.meses[mi].etiqueta;
            break;
          }
        }
      }
      if (!label && DATA) label = (DATA.mes ? DATA.mes : '') + ' ' + (DATA.anio || '');
      var isClosedReview = isClosedMonth && isReviewShipment;
      if (isClosedReview) {
        existing.innerHTML = '<span>Estás revisando los ajustes de <strong>' + escapeHtml(label) + '</strong>.</span> ' +
          '<button type="button" class="btn-go-current-month" id="btnGoCurrentMonth">Ir al mes actual ↗</button>';
      } else {
        existing.innerHTML = '<span>Estás viendo la parrilla de <strong>' + escapeHtml(label) + '</strong>. Es un mes cerrado: solo lectura.</span> ' +
          '<button type="button" class="btn-go-current-month" id="btnGoCurrentMonth">Ir al mes actual ↗</button>';
      }
      var btn = existing.querySelector('#btnGoCurrentMonth');
      if (btn) {
        btn.onclick = function(){
          if (indiceData && indiceData.actual) {
            switchMonth(indiceData.actual);
          }
        };
      }
      existing.style.display = 'flex';
    } else {
      if (existing) existing.style.display = 'none';
    }
  }

  function updateMonthSelector(){
    var wrap = document.getElementById('monthSelectorWrap');
    if (!indiceData || !indiceData.meses || indiceData.meses.length <= 1) {
      if (wrap) wrap.style.display = 'none';
      return;
    }
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.id = 'monthSelectorWrap';
      wrap.className = 'month-selector-wrap';
      var metaEl = document.querySelector('.topbar .meta');
      if (metaEl) {
        metaEl.appendChild(wrap);
      }
    }
    wrap.innerHTML = '<label class="month-selector-pill" for="monthSelect" title="Seleccionar mes de parrilla">' +
      '<span>🗓️</span>' +
      '<select id="monthSelect" class="month-select" aria-label="Seleccionar mes"></select>' +
      '</label>';
    var select = wrap.querySelector('#monthSelect');
    if (select) {
      indiceData.meses.forEach(function(m){
        var opt = document.createElement('option');
        opt.value = m.mes;
        opt.textContent = m.etiqueta || m.mes;
        if (m.mes === activeMes) opt.selected = true;
        select.appendChild(opt);
      });
      select.onchange = function(){
        switchMonth(select.value);
      };
    }
    wrap.style.display = 'inline-flex';
  }

  function updateHeader(){
    var periodo = [DATA.mes, DATA.anio].filter(Boolean).join(' ');
    var mt = $('metaTitle');
    if (mt) {
      mt.innerHTML = '';
      mt.textContent = (DATA.cliente || '') + ' · ';
      var ii = el('i', null, periodo);
      mt.appendChild(ii);
    }
    document.title = 'Revisión de contenidos · ' + (DATA.cliente || '') + ' · ' + periodo;
    if ($('intro')) {
      $('intro').textContent = DATA.intro || 'Revisa cada pieza con calma. Apruébala o cuéntanos qué ajustar, y al terminar, envíanos tu revisión con el botón de abajo.';
    }

    var whoEl = $('who');
    var currentStoredReviewer = getReviewerName();
    if (whoEl) {
      if (!agencyUser && currentStoredReviewer && currentStoredReviewer.indexOf('Agencia (') !== 0) {
        whoEl.value = currentStoredReviewer;
      } else {
        whoEl.value = '';
      }
    }

    var revEl = $('reviewed');
    if (revEl) {
      if (DATA.revision && DATA.revision.fecha && !agencyUser) {
        var d = new Date(DATA.revision.fecha);
        revEl.textContent = '✓ Revisado por ' + (DATA.revision.revisadoPor || currentStoredReviewer || 'el cliente') + ' el ' + d.toLocaleDateString('es-VE', {day:'2-digit', month:'long', year:'numeric'}) + ' a las ' + d.toLocaleTimeString('es-VE', {hour:'2-digit', minute:'2-digit'});
        revEl.classList.add('show');
      } else {
        revEl.classList.remove('show');
      }
    }

    var openLink = $('openLink');
    if (openLink && DATA.url) {
      openLink.href = DATA.url;
      openLink.classList.add('show');
    }
  }

  function normalizeItems(){
    items.forEach(function(it, i){
      if (!it.id) it.id = 'c' + (i + 1);
      if (!it.version) it.version = 1;
      it.version = parseInt(it.version, 10) || 1;
      if (['borrador', 'en_revision', 'pendiente', 'cambios', 'en_correccion', 'corregido', 'aprobado'].indexOf(it.estado) < 0) {
        it.estado = 'en_revision';
      }
      if (it.estado === 'pendiente') it.estado = 'en_revision';
      it.formato = normalizeFormato(it.formato || it.formatoOriginal);
      it.formatoOriginal = it.formato;
      if (typeof it.comentario !== 'string') it.comentario = '';
      if (!Array.isArray(it.comentarios)) it.comentarios = [];
      if (it.comentario && !it.comentarios.length) {
        it.comentarios = parseComentarios(it.comentario, it.revisadoPor || (DATA.revision ? DATA.revision.revisadoPor : '') || '');
      } else {
        it.comentarios = it.comentarios.filter(function(c){ return !isCorrectionNote(c); });
      }
    });
    DATA.revision = DATA.revision || {revisadoPor:'', fecha:''};
  }

  function recoverDraft(){
    try {
      var saved = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (saved && DATA.resetAt && (!saved.resetAt || saved.resetAt < DATA.resetAt)) {
        localStorage.removeItem(KEY);
        saved = null;
        if ($('who')) $('who').value = '';
      }
      if (saved && saved.items) {
        if (saved.sinEnviar && typeof saved.sinEnviar === 'object') sinEnviar = saved.sinEnviar;
        var hasCorr = items.some(function(x){ return x.estado === 'corregido'; });
        items.forEach(function(it){
          var s = saved.items[it.id];
          if (s) {
            it.estado = s.estado;
            it.comentario = s.comentario;
            if (s.formato) {
              it.formato = normalizeFormato(s.formato);
              it.formatoOriginal = it.formato;
            }
            if (Array.isArray(s.comentarios) && s.comentarios.length) {
              it.comentarios = s.comentarios.filter(function(c){ return !isCorrectionNote(c); });
            }
            if (s.revisadoPor) it.revisadoPor = s.revisadoPor;
            if (s.guion != null) it.guion = s.guion;
            if (s.copy != null) it.copy = s.copy;
            if (s.version != null) it.version = s.version;
            if (s.fechaCorreccion) it.fechaCorreccion = s.fechaCorreccion;
          }
        });
        if (saved.who && !isReviewShipment && !hasCorr && !agencyUser) {
          if (saved.who.indexOf('Agencia (') !== 0) {
            DATA.revision.revisadoPor = saved.who;
            setReviewerName(saved.who);
          }
        }
        setTimeout(function(){ toast('Recuperamos tu revisión en curso'); }, 600);
      }
    } catch (e) {}
  }

  function buildAllCards(){
    list = $('list');
    nav = $('nav');
    if (list) list.innerHTML = '';
    if (nav) nav.innerHTML = '';
    cards = [];
    var handle = (DATA.cuenta || DATA.cliente || '').replace(/^@/, '');

  items.forEach(function(it, i){
    var pieceNum = i + 1;
    var num = pad(pieceNum);
    it._estadoInicial = it._estadoInicial || it.estado;
    var isIncludedInShipment = (!targetPieceNumbers || targetPieceNumbers.indexOf(pieceNum) !== -1);
    var isCorregidoEditable = (!isClosedMonth || (isReviewShipment && it._estadoInicial === 'corregido' && isIncludedInShipment));
    var card = el('article', 'card' + (isCorregidoEditable ? ' is-corregido-editable' : '')); card.id = it.id; card.dataset.state = it.estado;
    card.dataset.pieceNum = pieceNum;

    var top = el('div', 'c-top');
    top.appendChild(el('div', 'big', num));
    var tw = el('div'); var tags = el('div', 'tags');

    // Formato de contenido:
    // Para el cliente: etiqueta estática
    // Para la agencia: la etiqueta misma es clickeable y abre un popover con los 4 formatos
    var fmtWrap = el('div', null); fmtWrap.style.cssText = 'position:relative;display:inline-block';
    var fmtTag = el('span', 'tag fmt', it.formato || 'Post');
    var fmtPopover = el('div', 'fmt-popover');

    function buildPopover() {
      fmtPopover.innerHTML = '';
      FORMATOS.forEach(function(x){
        var opt = el('div', 'fmt-popover-opt' + (x === it.formato ? ' active' : ''), x);
        opt.addEventListener('mousedown', function(e){
          e.preventDefault();
          var newFmt = x;
          it.formato = newFmt;
          it.formatoOriginal = newFmt;
          fmtTag.textContent = newFmt;
          closeFmtPopover();
          saveDraft();
          toast('Guardando tipo de contenido (' + newFmt + ')…');
          saveAgencyFormatoChange(it, newFmt);
        });
        fmtPopover.appendChild(opt);
      });
    }

    var fmtPopoverOpen = false;
    function openFmtPopover(){
      buildPopover();
      fmtPopover.classList.add('open');
      fmtPopoverOpen = true;
      setTimeout(function(){ document.addEventListener('click', closeFmtOnOutside); }, 0);
    }
    function closeFmtPopover(){
      fmtPopover.classList.remove('open');
      fmtPopoverOpen = false;
      document.removeEventListener('click', closeFmtOnOutside);
    }
    function closeFmtOnOutside(e){
      if (!fmtWrap.contains(e.target)) closeFmtPopover();
    }

    fmtWrap.appendChild(fmtTag);
    fmtWrap.appendChild(fmtPopover);
    tags.appendChild(fmtWrap);

    // fw/fs oculto: sólo se mantiene para compatibilidad interna, nunca visible
    var fw = el('label', 'fmt-wrap');
    var fs = el('select', 'fmt-sel');
    fs.setAttribute('aria-label', 'Tipo de contenido');
    FORMATOS.forEach(function(x){
      var o = el('option', null, x); o.value = x;
      if (x === it.formato) o.setAttribute('selected', '');
      fs.appendChild(o);
    });
    fs.value = it.formato || 'Post';
    fw.appendChild(fs);
    tags.appendChild(fw);

    if (agencyUser) {
      fmtTag.classList.add('agency-editable');
      fmtTag.addEventListener('click', function(e){
        e.stopPropagation();
        if (fmtPopoverOpen) { closeFmtPopover(); } else { openFmtPopover(); }
      });
    }

    if (it.pilar) tags.appendChild(el('span', 'tag', it.pilar));
    if (it.fechaPublicacion) tags.appendChild(el('span', 'tag date', '📅 ' + it.fechaPublicacion));

    // Versión concreta y contexto de revisión
    var vNum = parseInt(it.version, 10) || 1;
    var vTag = el('span', 'tag version', 'v' + vNum);
    tags.appendChild(vTag);
    var isCorrectionReview = vNum > 1;
    var ctxTag = el('span', 'tag ' + (isCorrectionReview ? 'ctx-correction' : 'ctx-first'), isCorrectionReview ? '🔄 Revisión de correcciones' : '✨ Primera revisión');
    tags.appendChild(ctxTag);
    if (it.fechaCorreccion || it.fechaEnvio) {
      tags.appendChild(el('span', 'tag date', '🚀 ' + formatRelTime(it.fechaCorreccion || it.fechaEnvio)));
    }

    tw.appendChild(tags);
    var h2Title = el('h2', null, it.titulo || 'Contenido ' + num);
    tw.appendChild(h2Title);
    top.appendChild(tw);
    var badge = el('span', 'badge', LBL[it.estado] || it.estado); top.appendChild(badge);
    card.appendChild(top);

    var hasCopy = (it.copy || it.hashtags);
    var body = el('div', 'c-body' + (hasCopy ? '' : ' single'));
    var g = el('div', 'guion');
    g.appendChild(el('span', 'lbl', it.guionLabel || 'Guion / descripción'));
    var pGuion = el('p', 'p-guion', it.guion || '');
    if (!it.guion) pGuion.style.display = agencyUser ? 'block' : 'none';
    g.appendChild(pGuion);

    var refs = (it.referencias || []).filter(function(r){ return safeUrl(r.url); });
    if (refs.length) {
      var rw = el('div', 'refs');
      refs.forEach(function(r){ var a = el('a', null, r.label || 'Referencia'); a.href = r.url; a.target = '_blank'; a.rel = 'noopener'; rw.appendChild(a); });
      g.appendChild(rw);
    }
    body.appendChild(g);

    var cw = el('div', 'copy-wrap');
    cw.appendChild(el('span', 'lbl', 'Copy'));
    var post = el('div', 'post'); var ph = el('div', 'post-h');
    ph.appendChild(el('div', 'av', (handle || 'N').charAt(0).toUpperCase()));
    var pn = el('div'); pn.appendChild(el('b', null, handle || 'tu cuenta')); pn.appendChild(el('small', null, 'Vista previa del copy'));
    ph.appendChild(pn); post.appendChild(ph);
    var pCopy = el('p', 'p-copy', it.copy || '');
    if (!it.copy) pCopy.style.display = agencyUser ? 'block' : 'none';
    var pHash = el('p', 'hash', it.hashtags || '');
    if (!it.hashtags) pHash.style.display = agencyUser ? 'block' : 'none';
    if (!hasCopy) cw.style.display = agencyUser ? 'block' : 'none';
    post.appendChild(pCopy); post.appendChild(pHash); cw.appendChild(post); body.appendChild(cw);
    card.appendChild(body);

    var rv = el('div', 'review');

    // Resumen de versión corregida
    if ((parseInt(it.version, 10) || 1) > 1) {
      var corrBox = el('div', 'correction-summary-box');
      corrBox.style.cssText = 'margin-bottom:12px;background:rgba(2,132,199,0.08);border:1px solid rgba(56,189,248,0.25);border-radius:8px;padding:10px 12px;';
      var lastH = Array.isArray(it.historial) && it.historial.length ? it.historial[it.historial.length - 1] : null;
      var hAction = (lastH && lastH.accion) ? lastH.accion : 'Ajustes realizados por el equipo según las observaciones de la versión anterior.';
      corrBox.innerHTML = '<div style="display:flex;align-items:center;gap:6px;font-size:12px;font-weight:700;color:#38BDF8;margin-bottom:4px;">' +
        '<span>🔄 Versión corregida (v' + it.version + ')</span>' +
        (it.fechaCorreccion ? '<span style="font-weight:400;color:rgba(255,255,255,0.5);font-size:11px;">· ' + formatRelTime(it.fechaCorreccion) + '</span>' : '') +
      '</div>' +
      '<div style="font-size:12px;color:rgba(255,255,255,0.85);line-height:1.4;">' +
        escapeHtml(hAction) +
      '</div>';
      rv.appendChild(corrBox);
    }

    // 1. BLOQUE DE COMENTARIOS (ARRIBA)
    var cmBox = el('div', 'comment-box');
    var cmHead = el('div', 'cm-head');
    cmHead.appendChild(el('h4', null, '💬 Comentarios y observaciones'));
    cmHead.appendChild(el('span', 'cm-sub', 'Cualquier persona del equipo puede dejar comentarios'));
    cmBox.appendChild(cmHead);

    var cmThread = el('div', 'cm-thread');
    cmBox.appendChild(cmThread);

    function renderThread(newComment){
      cmThread.innerHTML = '';
      var visibleComms = (it.comentarios || []).filter(function(cm){
        return !isCorrectionNote(cm);
      });
      visibleComms.forEach(function(cm){
        var isNew = (newComment && cm === newComment);
        var bubble = el('div', 'cm-bubble' + (isNew ? ' cm-new' : ''));
        var initial = (cm.autor || 'C').trim().charAt(0).toUpperCase();
        bubble.appendChild(el('div', 'cm-av', initial || 'C'));
        var r = el('div', 'cm-right');
        var topRow = el('div', 'cm-top');
        topRow.appendChild(el('b', 'cm-author', cm.autor || 'Cliente'));
        if (cm.fecha) topRow.appendChild(el('span', 'cm-date', formatRelTime(cm.fecha)));
        var delBtn = el('button', 'cm-del', '×');
        delBtn.type = 'button';
        delBtn.title = 'Eliminar este comentario';
        delBtn.onclick = function(){
          if (isClosedMonth && !agencyUser) {
            if (!isReviewShipment || it._estadoInicial !== 'corregido' || (targetPieceNumbers && targetPieceNumbers.indexOf(pieceNum) === -1)) {
              return;
            }
          }
          var origIdx = it.comentarios.indexOf(cm);
          if (origIdx >= 0) it.comentarios.splice(origIdx, 1);
          it.comentario = formatComentariosString(it.comentarios);
          marcarSinEnviar(it);
          renderThread(); saveDraft();
        };
        topRow.appendChild(delBtn);
        r.appendChild(topRow);
        r.appendChild(el('p', 'cm-txt', cm.texto));
        bubble.appendChild(r);
        cmThread.appendChild(bubble);
      });
      cmThread.style.display = visibleComms.length ? 'grid' : 'none';
    }

    var cmForm = el('div', 'cm-form');
    var ta = el('textarea', 'cm-textarea');
    ta.placeholder = 'Escribe aquí tu comentario, ajuste o sugerencia…';
    cmForm.appendChild(ta);

    var formFoot = el('div', 'cm-form-foot');
    var hint = el('span', 'hint', '✎ Si pides cambios, debes detallar qué ajustar para poder enviar.');
    formFoot.appendChild(hint);

    var btnAdd = el('button', 'btn-add-cm', '+ Agregar comentario');
    btnAdd.type = 'button';

    function addCommentFromInput(){
      var txt = ta.value.trim();
      if (!txt) return false;
      var auth = getReviewerName() || '';
      it.comentarios = it.comentarios || [];
      var newCm = { autor: auth, texto: txt, fecha: new Date().toISOString(), version: parseInt(it.version, 10) || 1 };
      it.comentarios.push(newCm);
      it.comentario = formatComentariosString(it.comentarios);
      if (auth) it.revisadoPor = auth;
      ta.value = '';
      card.classList.remove('warn');
      marcarSinEnviar(it);
      renderThread(newCm);
      saveDraft();
      toast('✓ Comentario registrado');
      return true;
    }

    btnAdd.onclick = function(){
      if (isClosedMonth && !agencyUser) {
        if (!isReviewShipment || it._estadoInicial !== 'corregido' || (targetPieceNumbers && targetPieceNumbers.indexOf(pieceNum) === -1)) {
          return;
        }
      }
      addCommentFromInput();
    };
    formFoot.appendChild(btnAdd);
    cmForm.appendChild(formFoot);
    cmBox.appendChild(cmForm);
    rv.appendChild(cmBox);

    // 2. BLOQUE DE DECISIÓN (ABAJO DEL COMENTARIO — PASO OBLIGATORIO)
    var decSec = el('div', 'review-decision');
    var decHead = el('div', 'dec-head');
    decHead.appendChild(el('h4', null, '¿Cuál es tu decisión sobre este contenido?'));
    decHead.appendChild(el('span', 'req-badge', '* Paso obligatorio'));
    decSec.appendChild(decHead);

    var seg = el('div', 'seg');
    var ap = el('button', 'approve'); ap.type = 'button'; ap.innerHTML = '<span class="ic">✓</span>Aprobar esta versión';
    var ch = el('button', 'change'); ch.type = 'button'; ch.innerHTML = '<span class="ic">✎</span>Solicitar cambios';
    seg.appendChild(ap); seg.appendChild(ch);
    decSec.appendChild(seg);

    var decStatus = el('div', 'dec-status', '• Pendiente de evaluación (obligatorio)');
    decSec.appendChild(decStatus);
    rv.appendChild(decSec);
    card.appendChild(rv);

    list.appendChild(card);

    var a = el('a'); a.href = '#' + it.id; a.dataset.state = it.estado;
    a.appendChild(el('span', 'n', num)); a.appendChild(el('span', 't', it.titulo || 'Contenido ' + num));
    nav.appendChild(a);

    renderThread();

    function paint(){
      card.dataset.state = it.estado; a.dataset.state = it.estado;
      var curSt = it.estado;
      if (curSt === 'pendiente') curSt = 'en_revision';
      var stLabel = LBL[curSt] || curSt;
      if (curSt === 'en_revision') {
        stLabel = (it.version > 1) ? 'En revisión (v' + it.version + ')' : 'En revisión (v1)';
      }
      badge.textContent = (curSt === 'corregido' && !agencyUser) ? 'En revisión (v' + (it.version || 1) + ')' : stLabel;
      ap.classList.toggle('on', curSt === 'aprobado'); ch.classList.toggle('on', curSt === 'cambios');
      ap.setAttribute('aria-pressed', curSt === 'aprobado'); ch.setAttribute('aria-pressed', curSt === 'cambios');

      if (curSt === 'aprobado') {
        decStatus.className = 'dec-status ok';
        var revWho = (it.aprobacion && it.aprobacion.usuario) || it.revisadoPor || getReviewerName() || 'Cliente';
        var revWhen = (it.aprobacion && it.aprobacion.fecha) || DATA.revision.fecha || '';
        decStatus.textContent = '✓ Versión v' + (it.version || 1) + ' aprobada' + (revWho ? ' por ' + revWho : '') + (revWhen ? ' el ' + formatRelTime(revWhen) : '');
      } else if (curSt === 'cambios') {
        decStatus.className = 'dec-status fix';
        decStatus.textContent = '✎ Marcado para Solicitar cambios (observaciones registradas)';
      } else if (curSt === 'en_correccion') {
        decStatus.className = 'dec-status fix';
        decStatus.textContent = '⚙ En corrección por el equipo';
      } else if (curSt === 'corregido') {
        decStatus.className = 'dec-status ok';
        decStatus.textContent = '🔄 Ajustes terminados (v' + (it.version || 1) + ') · Pendiente de envío';
      } else {
        decStatus.className = 'dec-status';
        decStatus.textContent = '• Pendiente de evaluación (obligatorio)';
      }
    }

    function set(s){
      if (isClosedMonth && !agencyUser) {
        if (!isReviewShipment || it._estadoInicial !== 'corregido' || (targetPieceNumbers && targetPieceNumbers.indexOf(pieceNum) === -1)) {
          return;
        }
      }
      if (s === 'cambios') {
        if (ta.value.trim()) addCommentFromInput();
        var hasComments = (it.comentarios && it.comentarios.length > 0 && it.comentarios.some(function(x){ return x.texto && x.texto.trim(); }));
        if (!hasComments) {
          ta.placeholder = 'Cuéntanos qué te gustaría ajustar (requerido para pedir cambios)…';
          ta.focus({preventScroll:true});
          toast('Por favor escribe qué cambios solicitas antes de enviar');
          card.classList.add('warn');
          return;
        }
        delete it.aprobacion;
        it.estado = 'cambios';
        marcarSinEnviar(it);
        card.classList.remove('warn');
        paint(); refresh(); updateApartadoCorregidos(); applyFilter(); saveDraft();
        toast('✎ Cambios solicitados para versión v' + (it.version || 1));
        if (agencyUser && typeof saveAgencyDecisionChange === 'function') {
          saveAgencyDecisionChange(it, 'cambios');
        }
        return;
      }

      if (ta.value.trim()) addCommentFromInput();

      if (s === 'aprobado') {
        var revWho = getReviewerName() || (agencyUser ? ('Agencia (' + (agencyUser === 'carlosuzc29@gmail.com' ? 'Carlos' : 'Andrea') + ')') : 'Cliente');
        var nowIso = new Date().toISOString();
        it.aprobacion = {
          version: parseInt(it.version, 10) || 1,
          usuario: revWho,
          fecha: nowIso
        };
        it.revisadoPor = revWho;
        it.fechaAprobacion = nowIso;
        it.estado = 'aprobado';
        marcarSinEnviar(it);
        card.classList.remove('warn');
        paint(); refresh(); updateApartadoCorregidos(); applyFilter(); saveDraft();
        toast('✓ Versión v' + (it.version || 1) + ' aprobada');
        if (agencyUser && typeof saveAgencyDecisionChange === 'function') {
          saveAgencyDecisionChange(it, 'aprobado');
        }
        return;
      }

      it.estado = s;
      marcarSinEnviar(it);
      card.classList.remove('warn');
      paint(); refresh(); updateApartadoCorregidos(); applyFilter(); saveDraft();
      if (agencyUser && typeof saveAgencyDecisionChange === 'function') {
        saveAgencyDecisionChange(it, s);
      }
    }

    ap.onclick = function(){ set('aprobado'); };
    ch.onclick = function(){ set('cambios'); };

    // Guardar referencia a la función de auto-commit para validación global
    card.__commitDraftComment = addCommentFromInput;

    var unsavedBadge = el('div', 'card-unsaved-badge', '⚠️ Sin guardar en la nube');
    unsavedBadge.style.display = 'none';
    card.appendChild(unsavedBadge);
    function setUnsavedState(isUnsaved){
      card.classList.toggle('card-unsaved', !!isUnsaved);
      unsavedBadge.style.display = isUnsaved ? 'inline-flex' : 'none';
    }

    paint();
    cards.push({
      card: card,
      nav: a,
      it: it,
      setDecision: set,
      setUnsavedState: setUnsavedState,
      commitComment: addCommentFromInput,
      renderThread: renderThread,
      paint: paint,
      fmtTag: fmtTag,
      openFmtPopover: openFmtPopover,
      closeFmtPopover: closeFmtPopover,
      fw: fw,
      fs: fs,
      h2Title: h2Title,
      tagsEl: tags,
      vTag: vTag,
      ctxTag: ctxTag,
      guionParagraph: pGuion,
      copyParagraph: pCopy,
      hashParagraph: pHash,
      copyContainer: cw
    });
  });


  // Insertar controles de edición de agencia directamente en cada tarjeta (contenteditable inline)
  cards.forEach(function(cObj){
    var it = cObj.it;
    var card = cObj.card;

    // Añadir etiqueta de ayuda sobre el guion
    if (cObj.guionParagraph && cObj.guionParagraph.parentNode) {
      var gHint = el('div', 'card-agency-edit-hint', '✎ Haz clic en el texto para editar el guion');
      cObj.guionParagraph.parentNode.insertBefore(gHint, cObj.guionParagraph);
    }
    // Añadir etiqueta de ayuda sobre el copy
    if (cObj.copyParagraph && cObj.copyParagraph.parentNode) {
      var cHint = el('div', 'card-agency-edit-hint', '✎ Haz clic en el texto para editar el copy');
      cObj.copyParagraph.parentNode.insertBefore(cHint, cObj.copyParagraph);
    }
    // Añadir etiqueta de ayuda sobre los hashtags
    if (cObj.hashParagraph && cObj.hashParagraph.parentNode) {
      var hHint = el('div', 'card-agency-edit-hint', '✎ Haz clic en el texto para editar los hashtags');
      cObj.hashParagraph.parentNode.insertBefore(hHint, cObj.hashParagraph);
    }

    // Barra inferior de acciones de agencia con botones Guardar y Aprobar
    var agencyBar = el('div', 'card-agency-bar');
    agencyBar.style.display = 'none';

    var vNum = parseInt(it.version, 10) || 1;
    var barInfo = el('span', 'agency-bar-info');
    function updateAgencyBarText(){
      var nv = parseInt(it.version, 10) || 1;
      if (it.estado === 'aprobado') {
        barInfo.textContent = '✓ Aprobado por agencia · v' + nv;
      } else if (it.estado === 'corregido') {
        barInfo.textContent = '🔄 Versión corregida (v' + nv + ')';
      } else {
        barInfo.textContent = '✎ Modo corrección agencia · v' + nv + ' actual';
      }
      if (cObj.vTag) cObj.vTag.textContent = 'v' + nv;
    }
    updateAgencyBarText();
    cObj.updateAgencyBarText = updateAgencyBarText;
    agencyBar.appendChild(barInfo);

    var agencyBtns = el('div', 'card-agency-actions');

    var btnSave = el('button', 'btn-agency-save');
    btnSave.type = 'button';
    btnSave.textContent = '💾 Guardar cambios';
    btnSave.title = 'Guarda el guion y copy corregidos en Firestore';
    btnSave.onclick = function(){
      var newTitle = cObj.h2Title ? leerTextoEditable(cObj.h2Title).replace(/[\r\n]+/g, ' ').trim() : (it.titulo || '').trim();
      var newGuion = cObj.guionParagraph ? leerTextoEditable(cObj.guionParagraph) : (it.guion || '');
      var newCopy = cObj.copyParagraph ? leerTextoEditable(cObj.copyParagraph) : (it.copy || '');
      var newHash = cObj.hashParagraph ? leerTextoEditable(cObj.hashParagraph).replace(/[\r\n]+/g, ' ').trim() : (it.hashtags || '').trim();

      var curTitle = (it.titulo || '').trim();
      var curGuion = (it.guion || '').trim();
      var curCopy = (it.copy || '').trim();
      var curHash = (it.hashtags || '').trim();

      if (newTitle.trim() === curTitle && newGuion.trim() === curGuion && newCopy.trim() === curCopy && newHash.trim() === curHash) {
        toast('Sin cambios para guardar');
        return;
      }

      if (REGEX_FRASES_PEGADAS.test(newGuion) || REGEX_FRASES_PEGADAS.test(newCopy)) {
        toast('⚠️ Parece que faltan saltos de línea: revisa antes de guardar');
      }

      saveCardCorrection(it, cObj, newGuion, newCopy, newTitle, btnSave, newHash);
      setTimeout(function(){
        updateAgencyBarText();
      }, 300);
    };
    agencyBtns.appendChild(btnSave);

    var btnApprove = el('button', 'btn-agency-approve');
    btnApprove.type = 'button';
    btnApprove.textContent = '✓ Aprobar versión';
    btnApprove.title = 'Aprobar esta versión y sincronizarla directamente en Firestore';
    btnApprove.onclick = function(){
      var newTitle = cObj.h2Title ? leerTextoEditable(cObj.h2Title).replace(/[\r\n]+/g, ' ').trim() : (it.titulo || '').trim();
      var newGuion = cObj.guionParagraph ? leerTextoEditable(cObj.guionParagraph) : (it.guion || '');
      var newCopy = cObj.copyParagraph ? leerTextoEditable(cObj.copyParagraph) : (it.copy || '');
      var newHash = cObj.hashParagraph ? leerTextoEditable(cObj.hashParagraph).replace(/[\r\n]+/g, ' ').trim() : (it.hashtags || '').trim();

      var curTitle = (it.titulo || '').trim();
      var curGuion = (it.guion || '').trim();
      var curCopy = (it.copy || '').trim();
      var curHash = (it.hashtags || '').trim();

      var hasUnsaved = (newTitle.trim() !== curTitle) || (newGuion.trim() !== curGuion) || (newCopy.trim() !== curCopy) || (newHash.trim() !== curHash);

      if (hasUnsaved) {
        modal({
          kind: 'warn',
          icon: '!',
          title: 'Tienes cambios sin guardar',
          text: '¿Guardar la corrección y aprobar?',
          buttons: [
            {
              label: 'Guardar y aprobar',
              primary: true,
              fn: function(){
                saveCardCorrection(it, cObj, newGuion, newCopy, newTitle, btnApprove, newHash).then(function(){
                  saveAgencyDecisionChange(it, 'aprobado', btnApprove);
                });
              }
            },
            { label: 'Cancelar' }
          ]
        });
        return;
      }

      it.titulo = newTitle;
      if (newGuion) it.guion = newGuion;
      if (newCopy) it.copy = newCopy;
      if (newHash) it.hashtags = newHash;
      saveAgencyDecisionChange(it, 'aprobado', btnApprove);
    };
    agencyBtns.appendChild(btnApprove);

    agencyBar.appendChild(agencyBtns);
    card.appendChild(agencyBar);

    cObj.updateAgencyActions = function(active){
      if (active) {
        card.classList.add('card-agency-edit-mode');
        agencyBar.style.display = 'flex';
        updateAgencyBarText();
        if (cObj.guionParagraph) cObj.guionParagraph.style.display = 'block';
        if (cObj.copyContainer) cObj.copyContainer.style.display = 'block';
        if (cObj.fmtTag) {
          cObj.fmtTag.classList.add('agency-editable');
          if (!cObj.fmtTag._agencyClickBound) {
            cObj.fmtTag._agencyClickBound = true;
            cObj.fmtTag.addEventListener('click', function(e){
              e.stopPropagation();
              if (cObj.openFmtPopover) cObj.openFmtPopover();
            });
          }
        }
        if (cObj.h2Title) {
          setupPlainTextEditable(cObj.h2Title, true);
          cObj.h2Title.setAttribute('title', 'Haz clic para editar el título');
        }
        if (cObj.guionParagraph) {
          setupPlainTextEditable(cObj.guionParagraph, false);
        }
        if (cObj.copyParagraph) {
          setupPlainTextEditable(cObj.copyParagraph, false);
        }
        if (cObj.hashParagraph) {
          cObj.hashParagraph.style.display = 'block';
          setupPlainTextEditable(cObj.hashParagraph, true);
        }
      } else {
        card.classList.remove('card-agency-edit-mode');
        agencyBar.style.display = 'none';
        if (cObj.fmtTag) {
          cObj.fmtTag.classList.remove('agency-editable');
          if (cObj.closeFmtPopover) cObj.closeFmtPopover();
        }
        if (cObj.h2Title) {
          cObj.h2Title.removeAttribute('contenteditable');
          cObj.h2Title.removeAttribute('spellcheck');
        }
        if (cObj.guionParagraph) {
          cObj.guionParagraph.removeAttribute('contenteditable');
          cObj.guionParagraph.removeAttribute('spellcheck');
        }
        if (cObj.copyParagraph) {
          cObj.copyParagraph.removeAttribute('contenteditable');
          cObj.copyParagraph.removeAttribute('spellcheck');
        }
        if (cObj.hashParagraph) {
          cObj.hashParagraph.removeAttribute('contenteditable');
          cObj.hashParagraph.removeAttribute('spellcheck');
          if (!it.hashtags) cObj.hashParagraph.style.display = 'none';
        }
      }
    };
  });

  }


  function counts(){
    var o = {aprobado:0, cambios:0, pendiente:0, corregido:0};
    var evaluatedItems = (targetPieceNumbers && targetPieceNumbers.length > 0)
      ? items.filter(function(it, idx){ return targetPieceNumbers.indexOf(idx + 1) !== -1; })
      : items;
    evaluatedItems.forEach(function(it){
      var st = it.estado || 'pendiente';
      if (esSinEvaluar(st)) {
        o.pendiente = (o.pendiente || 0) + 1;
      } else {
        o[st] = (o[st] || 0) + 1;
      }
    });
    return o;
  }
  function refresh(){
    var evaluatedItems = (targetPieceNumbers && targetPieceNumbers.length > 0)
      ? items.filter(function(it, idx){ return targetPieceNumbers.indexOf(idx + 1) !== -1; })
      : items;
    var n = evaluatedItems.length || 1, k = counts();
    $('sOk').textContent = k.aprobado; $('sFix').textContent = k.cambios; $('sPend').textContent = k.pendiente;
    $('dN').textContent = (k.aprobado + k.cambios) + '/' + evaluatedItems.length;
    $('pct').textContent = Math.round((k.aprobado + k.cambios) / n * 100) + '%';
    var lo = C * k.aprobado / n, lf = C * k.cambios / n;
    $('rOk').setAttribute('stroke-dasharray', lo + ' ' + C);
    $('rFix').setAttribute('stroke-dasharray', lf + ' ' + C);
    $('rFix').setAttribute('stroke-dashoffset', -lo);
    $('rOk').setAttribute('stroke-opacity', k.aprobado ? 1 : 0); $('rFix').setAttribute('stroke-opacity', k.cambios ? 1 : 0);

    var chipCount = $('chipCountCorregidos');
    var filterBtn = $('filterCorregidos');
    if (chipCount) chipCount.textContent = k.corregido || 0;
    if (filterBtn) filterBtn.style.display = (k.corregido > 0) ? 'inline-flex' : 'none';
  }

  var f = 'all';
  function applyFilter(){
    var vis = 0;
    cards.forEach(function(c, cIdx){
      var pieceNum = parseInt(c.card.dataset.pieceNum || (cIdx + 1), 10);
      var isIncludedInShipment = (!targetPieceNumbers || targetPieceNumbers.indexOf(pieceNum) !== -1);
      var matchesFilter = (f === 'all') || (c.it.estado === f);
      if (isClosedMonth && isReviewShipment) {
        matchesFilter = (c.it._estadoInicial === 'corregido');
      }
      var v = isIncludedInShipment && matchesFilter;
      c.card.style.display = v ? '' : 'none';
      c.nav.style.display = isIncludedInShipment ? (v ? '' : 'none') : 'none';
      if (v) vis++;
    });
    if ($('empty')) $('empty').style.display = vis ? 'none' : 'block';

    [].forEach.call(document.querySelectorAll('.chip'), function(x){
      x.classList.toggle('on', x.dataset.f === f);
    });

    var btnVerSolo = $('btnVerSoloCorregidos');
    if (btnVerSolo) {
      var corregidosCount = items.filter(function(it){ return it.estado === 'corregido'; }).length;
      if (f === 'corregido') {
        btnVerSolo.textContent = 'Ver todos los contenidos';
        btnVerSolo.classList.add('active');
      } else {
        btnVerSolo.textContent = '👁️ Ver solo corregidos (' + corregidosCount + ')';
        btnVerSolo.classList.remove('active');
      }
    }
  }

  function updateApartadoCorregidos(){
    var apartado = $('apartadoCorregidos');
    var pillsContainer = $('apartadoCorregidosPills');
    var chipCount = $('chipCountCorregidos');
    var apartadoCount = $('apartadoCount');
    var filterBtn = $('filterCorregidos');
    var btnVerSolo = $('btnVerSoloCorregidos');
    var btnCopy = $('btnCopiarLinkCorregidos');
    var btnWa = $('btnWhatsAppCorregidos');

    var corregidos = items.filter(function(it, idx){
      var isIncludedInShipment = (!targetPieceNumbers || targetPieceNumbers.indexOf(idx + 1) !== -1);
      return isIncludedInShipment && (it.estado === 'corregido');
    });

    var count = corregidos.length;
    if (chipCount) chipCount.textContent = count;
    if (apartadoCount) apartadoCount.textContent = count;

    if (filterBtn) {
      filterBtn.style.display = count > 0 ? 'inline-flex' : 'none';
    }

    if (!apartado) return;

    // Si estamos en modo envío de revisión para el cliente, no mostramos el bloque de agencia
    if (isReviewShipment && targetPieceNumbers && targetPieceNumbers.length > 0) {
      apartado.style.display = 'none';
      return;
    }

    if (count > 0) {
      apartado.style.display = 'block';

      if (btnCopy) {
        btnCopy.onclick = function(){
          var targetUrl = getReviewCorregidosUrl();
          copyTextToClipboard(targetUrl, function(ok){
            if (ok) {
              btnCopy.classList.add('copied');
              btnCopy.innerHTML = '<span class="btn-copy-ic">✓</span> <span class="btn-copy-txt">¡Link copiado!</span>';
              toast('📋 Enlace exclusivo copiado: Al abrirlo, el cliente verá solo los ' + count + ' contenidos corregidos para su visto bueno.');
              setTimeout(function(){
                btnCopy.classList.remove('copied');
                btnCopy.innerHTML = '<span class="btn-copy-ic">📋</span> <span class="btn-copy-txt">Copiar link para cliente</span>';
              }, 3000);
            } else {
              prompt('Copia este enlace para el cliente:', targetUrl);
            }
          });
        };
      }

      if (btnWa) {
        btnWa.onclick = function(){
          var targetUrl = getReviewCorregidosUrl();
          var clientName = DATA.cliente || 'tu parrilla';
          var msg = '¡Hola! 👋 Ya están listos los contenidos corregidos de ' + clientName + '. Puedes revisarlos y aprobarlos directamente aquí:\n\n' + targetUrl;
          window.open('https://api.whatsapp.com/send?text=' + encodeURIComponent(msg), '_blank');
        };
      }

      if (btnVerSolo) {
        if (f === 'corregido') {
          btnVerSolo.textContent = 'Ver todos los contenidos';
          btnVerSolo.classList.add('active');
        } else {
          btnVerSolo.textContent = '👁️ Ver solo corregidos (' + count + ')';
          btnVerSolo.classList.remove('active');
        }
        btnVerSolo.onclick = function(){
          f = (f === 'corregido') ? 'all' : 'corregido';
          applyFilter();
        };
      }
      if (pillsContainer) {
        pillsContainer.innerHTML = '';
        corregidos.forEach(function(it){
          var pieceIdx = items.indexOf(it);
          var num = (pieceIdx + 1 < 10 ? '0' : '') + (pieceIdx + 1);
          var vStr = 'v' + (it.version || 2);
          var a = el('a', 'pill-corregido');
          a.href = '#' + (it.id || ('c' + (pieceIdx + 1)));
          a.innerHTML = '<span style="color:#7c3aed;font-weight:800;">#' + num + '</span> ' +
            '<span>' + (it.titulo || 'Contenido') + '</span> ' +
            '<span class="pill-v">' + vStr + '</span>';
          a.onclick = function(e){
            e.preventDefault();
            var targetCard = $('list').querySelector('#' + (it.id || ('c' + (pieceIdx + 1))));
            if (targetCard) {
              if (f !== 'all' && f !== 'corregido') {
                f = 'all';
                applyFilter();
              }
              targetCard.scrollIntoView({behavior:'smooth', block:'center'});
              targetCard.classList.add('highlight-pulse');
              setTimeout(function(){ targetCard.classList.remove('highlight-pulse'); }, 1500);
            }
          };
          pillsContainer.appendChild(a);
        });
      }
    } else {
      apartado.style.display = 'none';
      if (f === 'corregido') {
        f = 'all';
        applyFilter();
      }
    }
  }

  [].forEach.call(document.querySelectorAll('.chip'), function(b){
    b.onclick = function(){
      f = b.dataset.f;
      applyFilter();
    };
  });

  try {
    var io = new IntersectionObserver(function(es){ es.forEach(function(e){ if (e.isIntersecting) e.target.classList.add('in'); }); }, {threshold:.05});
    var navContainer = $('nav');
    var act = new IntersectionObserver(function(es){
      es.forEach(function(e){
        if (e.isIntersecting) {
          cards.forEach(function(c){
            c.nav.classList.remove('active');
            if (c.card === e.target) {
              c.nav.classList.add('active');
              // Centrar el chip activo únicamente en el contenedor horizontal sin mover el scroll vertical de la ventana
              if (navContainer && window.innerWidth <= 980) {
                var targetLeft = c.nav.offsetLeft - (navContainer.clientWidth - c.nav.clientWidth) / 2;
                if (navContainer.scrollTo) {
                  navContainer.scrollTo({ left: targetLeft, behavior: 'smooth' });
                } else {
                  navContainer.scrollLeft = targetLeft;
                }
              }
            }
          });
        }
      });
    }, {rootMargin:'-45% 0px -50% 0px'});
    cards.forEach(function(c){ io.observe(c.card); act.observe(c.card); });
  } catch (e) {}
  setTimeout(function(){ cards.forEach(function(c){ c.card.classList.add('in'); }); }, 1200);

  $('who').addEventListener('input', function(){ this.classList.remove('err'); saveDraft(); });

  // Modal / toast
  var tt;
  function toast(msg){ var t = $('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(tt); tt = setTimeout(function(){ t.classList.remove('show'); }, 3200); }
  function modal(opts){
    var b = $('box'); b.innerHTML = '';
    b.appendChild(el('div', 'ico ' + (opts.kind || 'ok') + (opts.celebrate ? ' celebrate' : ''), opts.icon || '✓'));
    b.appendChild(el('h3', null, opts.title));
    if (opts.text) b.appendChild(el('p', null, opts.text));
    if (opts.list && opts.list.length) { var ul = el('ul'); opts.list.forEach(function(x){ ul.appendChild(el('li', null, x)); }); b.appendChild(ul); }
    var row = el('div', 'row');
    (opts.buttons || []).forEach(function(bt){ var x = el('button', bt.primary ? 'b-pri' : 'b-sec', bt.label); x.type = 'button'; x.onclick = function(){ closeModal(); if (bt.fn) bt.fn(); }; row.appendChild(x); });
    b.appendChild(row); $('modal').classList.add('show');
  }
  function closeModal(){ $('modal').classList.remove('show'); }
  $('modal').addEventListener('click', function(e){ if (e.target === this) closeModal(); });

  function slug(s){ return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, ''); }

  function commitAllDraftComments(){
    cards.forEach(function(c){
      if (c.commitComment) c.commitComment();
    });
  }

  // Copia estática del tablero (se ve aunque el visor no ejecute JavaScript, p. ej. vista previa del iPhone)
  function buildHTML(){
    commitAllDraftComments();
    DATA.contenidos = items;
    var root = document.documentElement.cloneNode(true);
    root.className = root.className.replace(/\bjs\b/, 'no-js');
    var liveTa = document.querySelectorAll('#list textarea'), cloneTa = root.querySelectorAll('#list textarea');
    for (var i = 0; i < liveTa.length; i++) cloneTa[i].textContent = liveTa[i].value;
    var liveSel = document.querySelectorAll('#list select'), cloneSel = root.querySelectorAll('#list select');
    for (var j = 0; j < liveSel.length; j++) { var v = liveSel[j].value; [].forEach.call(cloneSel[j].options, function(o){ if (o.value === v) o.setAttribute('selected', ''); else o.removeAttribute('selected'); }); }
    [].forEach.call(root.querySelectorAll('.card, #nav a'), function(n){ n.removeAttribute('style'); n.classList.remove('warn'); });
    [].forEach.call(root.querySelectorAll('.card'), function(n){ n.classList.add('in'); });
    root.querySelector('#empty').removeAttribute('style');
    root.querySelector('#modal').classList.remove('show');
    var tc = root.querySelector('#toast'); tc.classList.remove('show'); tc.textContent = '';
    root.querySelector('#who').setAttribute('value', $('who').value);
    [].forEach.call(root.querySelectorAll('.chip'), function(c, k){ c.classList.toggle('on', k === 0); });
    root.querySelector('#board-data').textContent = '\n' + JSON.stringify(DATA, null, 2).replace(/</g, '\\u003c') + '\n';
    return '<!DOCTYPE html>\n' + root.outerHTML;
  }
  window.__nexoSnapshot = buildHTML;

  var SEND = !!(FB && FB.projectId);
  if (SEND) { document.body.classList.add('has-send'); $('dl').textContent = 'Enviar revisión ✓'; }

  function unpackFsValue(v){
    if (!v || typeof v !== 'object') return v;
    if ('stringValue' in v) return v.stringValue;
    if ('integerValue' in v) return parseInt(v.integerValue, 10);
    if ('doubleValue' in v) return (typeof v.doubleValue === 'number' ? v.doubleValue : parseFloat(v.doubleValue));
    if ('booleanValue' in v) return v.booleanValue;
    if ('nullValue' in v) return null;
    if ('timestampValue' in v) return v.timestampValue;
    if ('mapValue' in v) {
      var m = {};
      var mFields = (v.mapValue && v.mapValue.fields) || {};
      for (var k in mFields) m[k] = unpackFsValue(mFields[k]);
      return m;
    }
    if ('arrayValue' in v) {
      var arr = (v.arrayValue && v.arrayValue.values) || [];
      return arr.map(unpackFsValue);
    }
    return v;
  }

  function packFsValue(v){
    if (v === undefined) return undefined;
    if (v === null) return { nullValue: null };
    if (typeof v === 'boolean') return { booleanValue: v };
    if (typeof v === 'number') {
      if (Number.isInteger(v)) {
        return { integerValue: String(v) };
      }
      return { doubleValue: v };
    }
    if (typeof v === 'string') return { stringValue: v };
    if (Array.isArray(v)) {
      var vals = [];
      for (var i = 0; i < v.length; i++) {
        var pv = packFsValue(v[i]);
        if (pv !== undefined) vals.push(pv);
      }
      return { arrayValue: vals.length ? { values: vals } : {} };
    }
    if (typeof v === 'object') {
      var f = {};
      for (var k in v) {
        if (Object.prototype.hasOwnProperty.call(v, k)) {
          var pf = packFsValue(v[k]);
          if (pf !== undefined) f[k] = pf;
        }
      }
      return { mapValue: { fields: f } };
    }
    return { stringValue: String(v) };
  }

  function leerTextoEditable(el){
    if (!el) return '';
    var clone = el.cloneNode(true);
    var hashes = clone.querySelectorAll('.hash');
    for (var h = 0; h < hashes.length; h++) {
      hashes[h].remove();
    }
    var brs = clone.querySelectorAll('br');
    for (var i = 0; i < brs.length; i++) {
      brs[i].replaceWith('\n');
    }
    var blocks = clone.querySelectorAll('div, p, li');
    for (var j = 0; j < blocks.length; j++) {
      if (j > 0 || blocks[j] !== clone.firstChild) {
        blocks[j].before('\n');
      }
    }
    var text = clone.textContent || '';
    text = text.replace(/\u00a0/g, ' ');
    text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    var lines = text.split('\n').map(function(l){ return l.replace(/[ \t]+$/, ''); });
    text = lines.join('\n');
    text = text.replace(/\n{3,}/g, '\n\n');
    return text.trim();
  }

  var REGEX_FRASES_PEGADAS = /[.?!…:][A-ZÁÉÍÓÚÑ¿¡]/;

  function setupPlainTextEditable(node, isSingleLine){
    if (!node) return;
    try {
      node.contentEditable = 'plaintext-only';
    } catch(e) {
      node.setAttribute('contenteditable', 'true');
    }
    if (node.contentEditable !== 'plaintext-only') {
      node.setAttribute('contenteditable', 'true');
    }
    node.setAttribute('spellcheck', 'true');
    if (!node._agencyKeyBound) {
      node._agencyKeyBound = true;
      node.addEventListener('keydown', function(e){
        if (e.key === 'Enter') {
          if (isSingleLine) {
            e.preventDefault();
          } else {
            e.preventDefault();
            if (document.queryCommandSupported && document.queryCommandSupported('insertLineBreak')) {
              document.execCommand('insertLineBreak');
            } else {
              document.execCommand('insertText', false, '\n');
            }
          }
        }
      });
      node.addEventListener('paste', function(e){
        if (node.contentEditable !== 'plaintext-only') {
          e.preventDefault();
          var clip = (e.clipboardData || window.clipboardData);
          var text = clip ? clip.getData('text/plain') : '';
          if (isSingleLine) text = text.replace(/[\r\n]+/g, ' ');
          document.execCommand('insertText', false, text);
        }
      });
    }
  }

  function guardarPiezas(cambiosPorId, opciones){
    opciones = opciones || {};
    var intentosMax = 3;
    var intentoActual = opciones.intento || 1;

    if (!FB || !FB.projectId || !DATA.id) {
      return Promise.reject(new Error('Firebase no está configurado en este tablero.'));
    }

    var docUrl = 'https://firestore.googleapis.com/v1/projects/' + encodeURIComponent(FB.projectId) +
      '/databases/(default)/documents/tableros/' + encodeURIComponent(DATA.id) +
      '?key=' + encodeURIComponent(FB.apiKey);

    return getValidAgencyToken().then(function(token){
      var getHeaders = {};
      if (token) getHeaders['Authorization'] = 'Bearer ' + token;
      return fetch(docUrl, { headers: getHeaders }).then(function(res){
        if (!res.ok) {
          if (res.status === 404 && !opciones._autoRegistrado && !isClosedMonth) {
            var nowIso = new Date().toISOString();
            var initialFields = {
              id: { stringValue: String(DATA.id) },
              cliente: { stringValue: String(DATA.cliente || '') },
              mes: { stringValue: String(DATA.mes || '') },
              anio: { stringValue: String(DATA.anio || '') },
              url: { stringValue: String(DATA.url || window.location.href.split('?')[0].split('#')[0]) },
              total: { integerValue: String(items.length) },
              aprobados: { integerValue: '0' },
              cambios: { integerValue: '0' },
              pendientes: { integerValue: String(items.length) },
              estado: { stringValue: 'Sin revisar' },
              revisadoPor: { stringValue: '' },
              ultimaRevision: { stringValue: '' },
              registrado: { stringValue: nowIso },
              contenidos: { arrayValue: {} }
            };

            var createUrl = 'https://firestore.googleapis.com/v1/projects/' + encodeURIComponent(FB.projectId) +
              '/databases/(default)/documents/tableros?documentId=' + encodeURIComponent(DATA.id) +
              '&key=' + encodeURIComponent(FB.apiKey);

            return fetch(createUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ fields: initialFields })
            }).then(function(postRes){
              if (!postRes.ok && postRes.status !== 409) {
                var errReg = new Error('No pudimos registrar tu revisión. Descarga una copia y envíala por WhatsApp.');
                errReg.isRegistrationFailure = true;
                throw errReg;
              }
              return guardarPiezas(cambiosPorId, Object.assign({}, opciones, { _autoRegistrado: true }));
            });
          }
          if (res.status === 404) {
            var err404 = new Error('No pudimos registrar tu revisión. Descarga una copia y envíala por WhatsApp.');
            err404.isRegistrationFailure = true;
            throw err404;
          }
          return res.json().catch(function(){ return {}; }).then(function(j){
            throw new Error((j.error && j.error.message) || ('HTTP ' + res.status + ' al leer tablero'));
          });
        }
        return res.json();
      });
    }).then(function(doc){
      if (!doc || !doc.fields) return doc;
      var updateTime = doc.updateTime;
      var f = {};
      var docFields = doc.fields || {};
      for (var k in docFields) f[k] = unpackFsValue(docFields[k]);

      var rawContenidos = Array.isArray(f.contenidos) ? f.contenidos : [];
      var baseContenidos = [];

      // Si contenidos está vacío en Firestore (primera revisión), parte de items con todos sus campos
      if (rawContenidos.length === 0) {
        baseContenidos = items.map(function(it, i){
          var baseObj = Object.assign({}, it);
          baseObj.n = i + 1;
          baseObj.id = it.id || ('c' + (i + 1));
          return baseObj;
        });
      } else {
        baseContenidos = rawContenidos.map(function(item){
          return Object.assign({}, item);
        });
      }

      // Fusionar cambios por pieza sin borrar claves que no conoce
      baseContenidos.forEach(function(pieza, idx){
        var n = pieza.n || (idx + 1);
        var id = pieza.id || ('c' + n);
        var rawCambio = (cambiosPorId && (cambiosPorId[id] || cambiosPorId[n] || cambiosPorId[String(n)])) || null;

        if (rawCambio) {
          var cambios = (typeof rawCambio === 'function') ? rawCambio(pieza) : Object.assign({}, rawCambio);

          // Si el cambio aprueba y hay un borrador del banco distinto de guion/copy, bloquear
          if (cambios.estado === 'aprobado' && pieza.borrador) {
            var bGuion = pieza.borrador.guion || '';
            var bCopy = pieza.borrador.copy || '';
            var curGuion = pieza.guion || '';
            var curCopy = pieza.copy || '';
            if ((bGuion && bGuion !== curGuion) || (bCopy && bCopy !== curCopy)) {
              throw new Error('Hay una corrección sin terminar en el Banco de trabajo');
            }
          }

          if (cambios.solicitarAprobacionSnapshot) {
            var snapVersion = parseInt(pieza.version, 10) || 1;
            var snapFecha = (opciones.tableroFields && opciones.tableroFields.ultimaRevision) || new Date().toISOString();
            var snapUsuario = cambios.aprobadorNombre || cambios.revisadoPor || 'Cliente';
            pieza.aprobacion = {
              version: snapVersion,
              usuario: snapUsuario,
              fecha: snapFecha,
              titulo: pieza.titulo || '',
              formato: pieza.formato || '',
              guion: pieza.guion || '',
              copy: pieza.copy || '',
              hashtags: pieza.hashtags || ''
            };
            delete cambios.solicitarAprobacionSnapshot;
            delete cambios.aprobadorNombre;
          }

          Object.assign(pieza, cambios);
          if (cambios.aprobacion === null) {
            delete pieza.aprobacion;
          }
        }
      });

      // Recalcular contadores a partir del arreglo fusionado
      var totalOk = baseContenidos.filter(function(x){ return x.estado === 'aprobado'; }).length;
      var totalFix = baseContenidos.filter(function(x){ return x.estado === 'cambios' || x.estado === 'en_correccion'; }).length;
      var totalCorr = baseContenidos.filter(function(x){ return x.estado === 'corregido'; }).length;
      var totalPend = baseContenidos.filter(function(x){
        return esSinEvaluar(x.estado);
      }).length;

      var estadoGeneral = (totalFix > 0) ? 'Con cambios' :
                          (totalCorr > 0 ? 'En revisión' :
                          ((totalOk === baseContenidos.length && baseContenidos.length > 0) ? 'Aprobado' : (totalOk > 0 ? 'Parcial' : 'Sin revisar')));

      var patchFields = {
        aprobados: totalOk,
        cambios: totalFix,
        pendientes: totalPend,
        estado: estadoGeneral,
        contenidos: baseContenidos
      };

      if (opciones.tableroFields) {
        for (var tf in opciones.tableroFields) {
          patchFields[tf] = opciones.tableroFields[tf];
        }
      }

      var updateMask = 'updateMask.fieldPaths=aprobados&updateMask.fieldPaths=cambios&updateMask.fieldPaths=pendientes&updateMask.fieldPaths=estado&updateMask.fieldPaths=contenidos';
      if (opciones.tableroFields) {
        for (var tfKey in opciones.tableroFields) {
          updateMask += '&updateMask.fieldPaths=' + encodeURIComponent(tfKey);
        }
      }

      var patchUrl = 'https://firestore.googleapis.com/v1/projects/' + encodeURIComponent(FB.projectId) +
        '/databases/(default)/documents/tableros/' + encodeURIComponent(DATA.id) +
        '?' + updateMask +
        (updateTime ? ('&currentDocument.updateTime=' + encodeURIComponent(updateTime)) : '') +
        '&key=' + encodeURIComponent(FB.apiKey);

      var packedFields = {};
      for (var pf in patchFields) {
        var pv = packFsValue(patchFields[pf]);
        if (pv !== undefined) packedFields[pf] = pv;
      }

      return getValidAgencyToken().then(function(token){
        var patchHeaders = { 'Content-Type': 'application/json' };
        if (token) patchHeaders['Authorization'] = 'Bearer ' + token;
        return fetch(patchUrl, {
          method: 'PATCH',
          headers: patchHeaders,
          body: JSON.stringify({ fields: packedFields })
        });
      }).then(function(patchRes){
        if (!patchRes.ok) {
          return patchRes.json().catch(function(){ return {}; }).then(function(errJson){
            var errMsg = (errJson.error && errJson.error.message) || ('HTTP ' + patchRes.status);
            var isPrecondition = (patchRes.status === 400 || patchRes.status === 409 || patchRes.status === 412) ||
              (errJson.error && (errJson.error.status === 'FAILED_PRECONDITION' || errJson.error.status === 'ABORTED'));

            if (isPrecondition && intentoActual < intentosMax) {
              console.warn('Reintento por precondición (' + intentoActual + '/' + intentosMax + ')...');
              var reintentarOpciones = Object.assign({}, opciones, { intento: intentoActual + 1 });
              return guardarPiezas(cambiosPorId, reintentarOpciones);
            }
            throw new Error(errMsg);
          });
        }
        return patchRes.json();
      }).then(function(savedDoc){
        syncBoardWithFirestore(savedDoc);
        return savedDoc;
      });
    });
  }

  function syncBoardWithFirestore(doc){
    if (!doc || !doc.fields) return;
    var f = {};
    for (var k in doc.fields) f[k] = unpackFsValue(doc.fields[k]);

    var fsContenidos = Array.isArray(f.contenidos) ? f.contenidos : [];
    var revPor = f.revisadoPor || '';
    var revFecha = f.ultimaRevision || '';

    var hasReview = (f.aprobados > 0 || f.cambios > 0 || revPor || revFecha || (f.estado && f.estado !== 'Sin revisar') || fsContenidos.length > 0);
    if (!hasReview) return;

    var fsHasCorregidos = fsContenidos.some(function(x){ return x.estado === 'corregido'; });
    if (isReviewShipment || fsHasCorregidos || agencyUser || f.estado === 'En revisión' || f.estado === 'Sin revisar') {
      DATA.revision.revisadoPor = '';
      if ($('who')) $('who').value = '';
      if ($('reviewed')) $('reviewed').classList.remove('show');
    } else {
      if (revPor) {
        DATA.revision.revisadoPor = revPor;
      }
      if (revFecha) {
        DATA.revision.fecha = revFecha;
        var d = new Date(revFecha);
        if (!isNaN(d.getTime())) {
          var revBanner = $('reviewed');
          if (revBanner) {
            revBanner.textContent = '✓ Revisado por ' + (revPor || 'el cliente') + ' el ' + d.toLocaleDateString('es-VE', {day:'2-digit', month:'long', year:'numeric'}) + ' a las ' + d.toLocaleTimeString('es-VE', {hour:'2-digit', minute:'2-digit'});
            revBanner.classList.add('show');
          }
        }
      }
    }

    if (fsContenidos.length > 0) {
      var piezasActualizadas = [];
      cards.forEach(function(cObj, idx){
        var it = cObj.it;
        var n = idx + 1;
        var fsItem = fsContenidos.find(function(x){
          return (+x.n === n) || (x.id && x.id === it.id) || (x.titulo && x.titulo === it.titulo);
        });

        if (fsItem) {
          // Decisión y comentarios del cliente sin enviar: se conservan salvo que Nexo haya subido otra versión
          var conservarLocal = !agencyUser && Object.prototype.hasOwnProperty.call(sinEnviar, it.id);
          if (conservarLocal && sinEnviar[it.id] !== (parseInt(fsItem.version, 10) || 1)) {
            delete sinEnviar[it.id];
            conservarLocal = false;
            piezasActualizadas.push(n);
          }
          if (cObj.setUnsavedState) cObj.setUnsavedState(false);
          if (!conservarLocal && fsItem.estado && ['borrador', 'en_revision', 'pendiente', 'cambios', 'en_correccion', 'corregido', 'aprobado'].indexOf(fsItem.estado) >= 0) {
            it.estado = (fsItem.estado === 'pendiente') ? 'en_revision' : fsItem.estado;
          }
          if (fsItem.version) {
            it.version = parseInt(fsItem.version, 10);
            if (cObj.vTag) cObj.vTag.textContent = 'v' + it.version;
            if (cObj.ctxTag) {
              var isCorr = it.version > 1;
              cObj.ctxTag.className = 'tag ' + (isCorr ? 'ctx-correction' : 'ctx-first');
              cObj.ctxTag.textContent = isCorr ? '🔄 Revisión de correcciones' : '✨ Primera revisión';
            }
          }
          if (!conservarLocal && fsItem.aprobacion) {
            it.aprobacion = fsItem.aprobacion;
          }
          if (!conservarLocal && fsItem.comentario != null) {
            it.comentario = fsItem.comentario;
            it.comentarios = parseComentarios(it.comentario, it.revisadoPor || revPor || 'Cliente');
          }
          if (fsItem.formato) {
            var normFmt = normalizeFormato(fsItem.formato);
            it.formato = normFmt;
            it.formatoOriginal = normFmt;
            if (cObj.fs) cObj.fs.value = normFmt;
            if (cObj.fmtTag) cObj.fmtTag.textContent = normFmt;
          }
          if (fsItem.titulo) {
            it.titulo = fsItem.titulo;
            if (cObj.h2Title) cObj.h2Title.textContent = fsItem.titulo;
          }
          if (fsItem.guion != null) {
            it.guion = fsItem.guion;
            if (cObj.guionParagraph) cObj.guionParagraph.textContent = fsItem.guion;
          }
          if (fsItem.copy != null) {
            it.copy = fsItem.copy;
            if (cObj.copyParagraph) cObj.copyParagraph.textContent = fsItem.copy;
          }
          if (fsItem.hashtags != null) {
            it.hashtags = fsItem.hashtags;
            if (cObj.hashParagraph) {
              cObj.hashParagraph.textContent = fsItem.hashtags;
              if (fsItem.hashtags || agencyUser) {
                cObj.hashParagraph.style.display = 'block';
              } else {
                cObj.hashParagraph.style.display = 'none';
              }
            }
          }
          if (fsItem.fechaCorreccion) {
            it.fechaCorreccion = fsItem.fechaCorreccion;
          }

          // Preservar campos ricos de Firestore para que nunca se pierdan
          if (fsItem.historial) it.historial = fsItem.historial;
          if (fsItem.versiones) it.versiones = fsItem.versiones;
          if (fsItem.borrador) it.borrador = fsItem.borrador;
          if (fsItem.referencias) it.referencias = fsItem.referencias;
          if (fsItem.pilar) it.pilar = fsItem.pilar;
          if (fsItem.fechaPublicacion) it.fechaPublicacion = fsItem.fechaPublicacion;
          if (fsItem.tipoOriginal) it.tipoOriginal = fsItem.tipoOriginal;
          if (fsItem.clickupId) it.clickupId = fsItem.clickupId;

          // Filtrar notas de corrección internas del comentario
          if (!conservarLocal) {
            var rawComment = it.comentario || '';
            var filteredComments = parseComentarios(rawComment, it.revisadoPor || revPor || 'Cliente');
            it.comentarios = filteredComments;
          }

          if (cObj.renderThread) cObj.renderThread();
          if (cObj.paint) cObj.paint();
        }
      });

      if (piezasActualizadas.length) {
        toast('Nexo actualizó ' + (piezasActualizadas.length === 1 ? 'la pieza ' : 'las piezas ') + piezasActualizadas.join(', ') + (piezasActualizadas.length === 1 ? ': revísala' : ': revísalas') + ' de nuevo antes de enviar.');
      }

      refresh();
      updateApartadoCorregidos();
      applyFilter();
      saveDraft();
    }
  }


  function syncAndRegisterBoard(){
    if (!DATA || !DATA.id || !FB || !FB.projectId || !FB.apiKey) return;
    try {
      var checkUrl = 'https://firestore.googleapis.com/v1/projects/' + encodeURIComponent(FB.projectId) +
        '/databases/(default)/documents/tableros/' + encodeURIComponent(DATA.id) +
        '?key=' + encodeURIComponent(FB.apiKey);

      fetch(checkUrl)
        .then(function(res){
          if (res.status === 200) {
            return res.json().then(function(doc){
              syncBoardWithFirestore(doc);
            });
          } else if (res.status === 404) {
            // REGLA FUNDAMENTAL: NUNCA escribir en Firestore desde un mes anterior/cerrado
            if (isClosedMonth) return;

            var nowIso = new Date().toISOString();
            var initialFields = {
              id: { stringValue: String(DATA.id) },
              cliente: { stringValue: String(DATA.cliente || '') },
              mes: { stringValue: String(DATA.mes || '') },
              anio: { stringValue: String(DATA.anio || '') },
              url: { stringValue: String(DATA.url || window.location.href.split('?')[0].split('#')[0]) },
              total: { integerValue: String(items.length) },
              aprobados: { integerValue: '0' },
              cambios: { integerValue: '0' },
              pendientes: { integerValue: String(items.length) },
              estado: { stringValue: 'Sin revisar' },
              revisadoPor: { stringValue: '' },
              ultimaRevision: { stringValue: '' },
              registrado: { stringValue: nowIso },
              contenidos: { arrayValue: {} }
            };

            var createUrl = 'https://firestore.googleapis.com/v1/projects/' + encodeURIComponent(FB.projectId) +
              '/databases/(default)/documents/tableros?documentId=' + encodeURIComponent(DATA.id) +
              '&key=' + encodeURIComponent(FB.apiKey);

            return fetch(createUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ fields: initialFields })
            });
          }
        })
        .catch(function(){
          // Silencioso
        });
    } catch(e) {}
  }

  // Mantener sincronización periódica pasiva
  document.addEventListener('visibilitychange', function(){
    if (!document.hidden) syncAndRegisterBoard();
  });
  window.addEventListener('focus', function(){
    syncAndRegisterBoard();
  });
  setInterval(function(){
    if (!document.hidden) syncAndRegisterBoard();
  }, 30000);

  function doDownload(){
    commitAllDraftComments();
    var revName = getReviewerName() || 'Cliente';
    if (!DATA.revision.fecha) DATA.revision = {revisadoPor: revName, fecha: new Date().toISOString()};
    var html = buildHTML();
    var name = 'Revision-' + slug(DATA.cliente) + '-' + slug(DATA.mes) + '-' + (DATA.anio || '') + '.html';
    var blob = new Blob([html], {type:'text/html;charset=utf-8'});
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click();
    setTimeout(function(){ URL.revokeObjectURL(url); a.remove(); }, 1500);
    var k = counts();
    modal({kind:'ok', icon:'✓', title:'¡Revisión descargada!', text:'Se guardó el archivo "' + name + '" con ' + k.aprobado + ' aprobados y ' + k.cambios + ' con cambios.' + (SEND ? ' Es una copia para ti: tu revisión se registra al tocar "Enviar revisión".' : ' Envíanoslo por WhatsApp o correo para empezar a producir.'), buttons:[{label:'Entendido', primary:true}]});
  }

  // Envío directo a Firebase Cloud Firestore
  function doSend(){
    if (isClosedMonth && !isReviewShipment) {
      toast('Este es un mes cerrado (solo lectura). No se pueden enviar revisiones.');
      return;
    }
    commitAllDraftComments();
    var revName = getReviewerName() || 'Cliente';
    DATA.revision = {revisadoPor: revName, fecha: new Date().toISOString()};

    var btn = $('dl');
    btn.disabled = true; btn.textContent = 'Enviando…';

    function ok(){
      evaluatedItems.forEach(function(it){ delete sinEnviar[it.id]; });
      btn.disabled = false; btn.textContent = 'Enviar revisión ✓'; saveDraft();
      var k = counts();
      modal({
        kind:'ok',
        icon:'✓',
        title:'¡Revisión enviada!',
        text:'Nexo ya recibió tus respuestas: ' + k.aprobado + ' aprobados y ' + k.cambios + ' con cambios.' + (isReviewShipment ? ' (Envío de revisión procesado).' : '') + ' Si cambias algo, puedes volver a enviarla.',
        celebrate: true,
        buttons:[{label:'Descargar una copia', fn:doDownload}, {label:'Listo', primary:true}]
      });
    }

    function fail(err){
      console.error('Error enviando revisión a Firestore:', err);
      btn.disabled = false; btn.textContent = 'Enviar revisión ✓';
      var isRegFail = err && (err.isRegistrationFailure || (err.message && err.message.indexOf('No pudimos registrar tu revisión') !== -1));
      var errorText = isRegFail
        ? 'No pudimos registrar tu revisión. Descarga una copia y envíala por WhatsApp.'
        : 'Revisa tu conexión e inténtalo de nuevo. Si el problema continúa, descarga una copia y compártela por WhatsApp.';
      modal({
        kind:'warn',
        icon:'!',
        title: isRegFail ? 'No pudimos registrar tu revisión' : 'No pudimos enviarla',
        text: errorText,
        buttons:[{label:'Descargar copia', fn:doDownload}, {label:'Reintentar', primary:true, fn:doSend}]
      });
    }

    var evaluatedItems = (targetPieceNumbers && targetPieceNumbers.length > 0)
      ? items.filter(function(it, idx){ return targetPieceNumbers.indexOf(idx + 1) !== -1; })
      : items;

    if (isClosedMonth && isReviewShipment) {
      evaluatedItems = evaluatedItems.filter(function(it){ return it._estadoInicial === 'corregido'; });
    }

    var cambiosPorId = {};
    evaluatedItems.forEach(function(it){
      var cList = (it.comentarios && it.comentarios.length) ? it.comentarios : (it.comentario ? [{ autor: it.revisadoPor || revName, texto: it.comentario, fecha: '' }] : []);
      var fullComment = formatComentariosString(cList) || it.comentario || '';
      var lastAuthor = (cList.length && cList[cList.length - 1].autor) ? cList[cList.length - 1].autor : (it.revisadoPor || revName);

      var itemCambios = {
        estado: esSinEvaluar(it.estado) ? 'pendiente' : (it.estado || 'pendiente'),
        comentario: fullComment,
        revisadoPor: lastAuthor,
        formato: it.formato || '',
        formatoOriginal: it.formatoOriginal || it.formato || ''
      };

      if (it.estado === 'aprobado') {
        itemCambios.solicitarAprobacionSnapshot = true;
        itemCambios.aprobadorNombre = revName;
      } else {
        itemCambios.aprobacion = null;
      }

      cambiosPorId[it.id] = itemCambios;
    });

    var opciones = {
      tableroFields: {
        revisadoPor: revName,
        ultimaRevision: DATA.revision.fecha
      }
    };

    guardarPiezas(cambiosPorId, opciones).then(function(){
      ok();
    }).catch(function(err){
      fail(err);
    });
  }

  // VALIDACIÓN OBLIGATORIA (EN PC Y CELULARES)
  function validate(next, label){
    commitAllDraftComments();

    // Evaluar solo las piezas del envío si estamos en modo revisión específica
    var cardsToValidate = (targetPieceNumbers && targetPieceNumbers.length > 0)
      ? cards.filter(function(c){ return targetPieceNumbers.indexOf(parseInt(c.card.dataset.pieceNum, 10)) !== -1; })
      : cards;

    // 1. PASO OBLIGATORIO: Todos los contenidos evaluables deben estar evaluados (Aprobar o Solicitar cambios)
    var pend = cardsToValidate.filter(function(c){ return esSinEvaluar(c.it.estado); });
    if (pend.length) {
      f = 'all'; applyFilter();
      [].forEach.call(document.querySelectorAll('.chip'), function(x){ x.classList.toggle('on', x.dataset.f === 'all'); });
      cards.forEach(function(c){ c.card.classList.remove('warn'); });
      pend.forEach(function(c){ c.card.classList.add('warn'); });
      pend[0].card.scrollIntoView({behavior:'smooth', block:'center'});

      modal({
        kind: 'warn',
        icon: '!',
        title: pend.length === 1 ? 'Paso obligatorio: falta 1 contenido por evaluar' : 'Paso obligatorio: faltan ' + pend.length + ' contenidos por evaluar',
        text: 'Debes evaluar todos los contenidos del envío (Aprobar o Solicitar cambios) antes de enviar la revisión. No se pueden dejar contenidos pendientes.',
        list: pend.map(function(c){ return c.nav.textContent.replace(/^(\d+)/, '$1 · '); }),
        buttons: [{
          label: 'Evaluar pendientes ahora',
          primary: true,
          fn: function(){
            f = 'all'; applyFilter();
            pend[0].card.scrollIntoView({behavior:'smooth', block:'center'});
          }
        }]
      });
      return;
    }

    // Si hay contenidos corregidos aún sin evaluación del cliente (Aprobar o Pedir cambios)
    var corrPendientes = cardsToValidate.filter(function(c){ return c.it.estado === 'corregido'; });
    if (corrPendientes.length) {
      f = 'corregido'; applyFilter();
      [].forEach.call(document.querySelectorAll('.chip'), function(x){ x.classList.toggle('on', x.dataset.f === 'corregido'); });
      cards.forEach(function(c){ c.card.classList.remove('warn'); });
      corrPendientes.forEach(function(c){ c.card.classList.add('warn'); });
      corrPendientes[0].card.scrollIntoView({behavior:'smooth', block:'center'});

      modal({
        kind: 'warn',
        icon: '🔄',
        title: corrPendientes.length === 1 ? 'Falta dar visto bueno a 1 contenido corregido' : 'Falta dar visto bueno a ' + corrPendientes.length + ' contenidos corregidos',
        text: 'La agencia preparó los ajustes en estas piezas. Por favor márcalas como "Aprobado" o "Solicitar cambios" antes de enviar tu visto bueno definitivo.',
        list: corrPendientes.map(function(c){ return c.nav.textContent.replace(/^(\d+)/, '$1 · '); }),
        buttons: [{
          label: 'Evaluar corregidos ahora',
          primary: true,
          fn: function(){
            f = 'corregido'; applyFilter();
            corrPendientes[0].card.scrollIntoView({behavior:'smooth', block:'center'});
          }
        }]
      });
      return;
    }

    // 2. PASO OBLIGATORIO: Si se solicitaron cambios, debe existir comentario explicando qué ajustar
    var sinComentario = cardsToValidate.filter(function(c){
      if (c.it.estado !== 'cambios') return false;
      var hasComments = (c.it.comentarios && c.it.comentarios.length > 0 && c.it.comentarios.some(function(x){ return x.texto && x.texto.trim(); }));
      var hasSingle = !!(c.it.comentario && c.it.comentario.trim());
      return !hasComments && !hasSingle;
    });

    if (sinComentario.length) {
      f = 'all'; applyFilter();
      [].forEach.call(document.querySelectorAll('.chip'), function(x){ x.classList.toggle('on', x.dataset.f === 'all'); });
      cards.forEach(function(c){ c.card.classList.remove('warn'); });
      sinComentario.forEach(function(c){ c.card.classList.add('warn'); });
      sinComentario[0].card.scrollIntoView({behavior:'smooth', block:'center'});

      modal({
        kind: 'warn',
        icon: '✎',
        title: 'Cuéntanos qué debemos ajustar',
        text: 'Marcaste "Pedir cambios" pero es obligatorio indicar el ajuste solicitado en:',
        list: sinComentario.map(function(c){ return c.nav.textContent.replace(/^(\d+)/, '$1 · '); }),
        buttons: [{
          label: 'Escribir detalle del cambio',
          primary: true,
          fn: function(){
            f = 'all'; applyFilter();
            sinComentario[0].card.scrollIntoView({behavior:'smooth', block:'center'});
            var ta = sinComentario[0].card.querySelector('.cm-textarea');
            if (ta) ta.focus({preventScroll:true});
          }
        }]
      });
      return;
    }

    // 3. PASO FINAL: Solicitar el nombre del cliente UNA SOLA VEZ
    var who = $('who');
    var reviewerName = getReviewerName();
    if (!reviewerName) {
      who.classList.remove('err'); void who.offsetWidth; who.classList.add('err');
      toast('Escribe tu nombre para finalizar y enviar');
      modal({
        kind: 'warn',
        icon: '👤',
        title: 'Introduce tu nombre para enviar',
        text: '¡Casi listo! Solo necesitamos tu nombre o el de tu equipo una sola vez para registrar quién realizó esta revisión.',
        buttons: [{
          label: 'Escribir mi nombre',
          primary: true,
          fn: function(){
            who.scrollIntoView({behavior:'smooth', block:'center'});
            setTimeout(function(){ who.focus(); }, 350);
          }
        }]
      });
      return;
    }

    // Asociar nombre a la revisión, a todos los ítems y comentarios pendientes de autor
    setReviewerName(reviewerName);
    items.forEach(function(it){
      if (!it.revisadoPor) it.revisadoPor = reviewerName;
      if (Array.isArray(it.comentarios)) {
        it.comentarios.forEach(function(cm){
          if (!cm.autor) cm.autor = reviewerName;
        });
        it.comentario = formatComentariosString(it.comentarios) || it.comentario;
      }
    });
    saveDraft();
    cards.forEach(function(c){ if (c.renderThread) c.renderThread(); });

    next();
  }

  $('dl').onclick = function(){ if (SEND) validate(doSend, 'Enviar'); else validate(doDownload, 'Descargar'); };
  $('dlMini').onclick = function(){ doDownload(); };

  refresh(); updateApartadoCorregidos(); applyFilter();
  if (typeof NexoNetworkBackground !== 'undefined') {
    NexoNetworkBackground.init(document.body);
  }

  // ==============================================================


  // MÓDULO EXCLUSIVO DE AGENCIA: CORRECCIONES DIRECTAS EN EL TABLERO
  // Usuarios permitidos: carlosuzc29@gmail.com, andrevmuedit@gmail.com
  // Clave autorizada: Caracas0327 (configurada en Firebase Auth)
  // ==============================================================
  function updateAgencyUI(){
    var isAgency = !!agencyUser;
    var accessBtn = $('btnAgencyAccess');
    var accessBtnFooter = $('btnAgencyAccessFooter');
    var activeBar = $('agencyActiveBarWrap');
    var userLbl = $('agencyUserLabel');

    if (accessBtn) {
      accessBtn.classList.toggle('active', isAgency);
      accessBtn.textContent = isAgency ? '✓ Modo Administrador activo' : '🔒 Acceso Administrador';
    }
    if (accessBtnFooter) {
      accessBtnFooter.classList.toggle('active', isAgency);
      accessBtnFooter.textContent = isAgency ? '✓ Modo Agencia activo' : 'Acceso equipo Nexo';
    }
    if (activeBar) {
      activeBar.style.display = isAgency ? 'block' : 'none';
    }
    if (userLbl && agencyUser) {
      userLbl.textContent = agencyUser + ' (Modo Correcciones)';
    }

    if (isAgency) {
      if ($('who')) $('who').value = '';
      DATA.revision.revisadoPor = '';
      if ($('reviewed')) $('reviewed').classList.remove('show');
    }

    // Actualizar cada tarjeta para mostrar u ocultar la barra de corrección de agencia y alternar formato
    cards.forEach(function(cObj){
      if (cObj.updateAgencyActions) cObj.updateAgencyActions(isAgency);
    });
  }

  // Modal Login de Agencia
  var modalLogin = $('modalAgencyLogin');
  var passInp = $('agencyPassword');
  var emailSel = $('agencyEmailSelect');
  var errEl = $('agencyLoginErr');
  var btnLoginSubmit = $('btnAgencyModalSubmit');
  var btnLoginCancel = $('btnAgencyModalCancel');
  var btnAgencyAccess = $('btnAgencyAccess');
  var btnAgencyAccessFooter = $('btnAgencyAccessFooter');
  var btnAgencyLogout = $('btnAgencyLogout');

  function openAgencyLogin(){
    if (modalLogin) {
      if (passInp) passInp.value = '';
      if (errEl) errEl.classList.remove('show');
      modalLogin.classList.add('show');
      setTimeout(function(){ if (passInp) passInp.focus(); }, 150);
    }
  }
  function closeAgencyLogin(){
    if (modalLogin) modalLogin.classList.remove('show');
  }

  if (btnAgencyAccess) {
    btnAgencyAccess.onclick = function(){
      if (agencyUser) {
        toast('Modo editor de agencia ya activo');
      } else {
        openAgencyLogin();
      }
    };
  }
  if (btnAgencyAccessFooter) {
    btnAgencyAccessFooter.onclick = function(){
      if (agencyUser) {
        toast('Modo editor de agencia ya activo');
      } else {
        openAgencyLogin();
      }
    };
  }

  if (btnLoginCancel) btnLoginCancel.onclick = closeAgencyLogin;
  if (modalLogin) {
    modalLogin.addEventListener('click', function(e){
      if (e.target === this) closeAgencyLogin();
    });
  }

  function handleAgencyLogin(){
    var email = (emailSel ? emailSel.value : '').toLowerCase().trim();
    var pass = (passInp ? passInp.value : '').trim();

    if (!email || !pass) {
      if (errEl) { errEl.textContent = 'Correo o contraseña incorrectos'; errEl.classList.add('show'); }
      return;
    }

    if (btnLoginSubmit) {
      btnLoginSubmit.disabled = true;
      btnLoginSubmit.textContent = 'Verificando…';
    }
    if (errEl) errEl.classList.remove('show');

    var authUrl = 'https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=' + encodeURIComponent(FB.apiKey);
    fetch(authUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: email,
        password: pass,
        returnSecureToken: true
      })
    })
    .then(function(res){
      if (!res.ok) {
        throw new Error('Auth failed HTTP ' + res.status);
      }
      return res.json();
    })
    .then(function(data){
      if (btnLoginSubmit) {
        btnLoginSubmit.disabled = false;
        btnLoginSubmit.textContent = 'Ingresar al modo editor';
      }
      var returnedEmail = (data.email || '').toLowerCase().trim();
      if (!returnedEmail || AGENCY_ALLOWED.indexOf(returnedEmail) === -1) {
        if (errEl) {
          errEl.textContent = 'Usuario no autorizado para realizar correcciones';
          errEl.classList.add('show');
        }
        return;
      }
      var expiresInSec = parseInt(data.expiresIn || '3600', 10);
      var sess = {
        idToken: data.idToken,
        refreshToken: data.refreshToken,
        email: returnedEmail,
        expiresAt: Date.now() + (expiresInSec * 1000)
      };
      saveAgencySession(sess);
      closeAgencyLogin();
      updateAgencyUI();
      toast('✓ Acceso de agencia verificado: ¡Modo corrección activo!');
    })
    .catch(function(){
      if (btnLoginSubmit) {
        btnLoginSubmit.disabled = false;
        btnLoginSubmit.textContent = 'Ingresar al modo editor';
      }
      if (errEl) {
        errEl.textContent = 'Correo o contraseña incorrectos';
        errEl.classList.add('show');
      }
      if (passInp) {
        passInp.focus();
        passInp.select();
      }
    });
  }

  if (btnLoginSubmit) btnLoginSubmit.onclick = handleAgencyLogin;
  if (passInp) {
    passInp.addEventListener('keydown', function(e){
      if (e.key === 'Enter') handleAgencyLogin();
    });
  }

  
  // Control modal Envío por Separado en Modo Agencia
  var btnAgencyShipment = $('btnAgencyShipment');
  var agencyShipmentModal = $('agencyShipmentModal');
  var btnCloseAgencyShipment = $('btnCloseAgencyShipment');
  var btnCancelAgencyShipment = $('btnCancelAgencyShipment');
  var btnToggleAllAgencyShipment = $('btnToggleAllAgencyShipment');
  var agencyShipmentItemsList = $('agencyShipmentItemsList');
  var agencyShipmentUrlInp = $('agencyShipmentUrlInp');
  var btnCopyAgencyShipment = $('btnCopyAgencyShipment');

  function updateAgencyShipmentUrl(){
    if (!agencyShipmentItemsList) return '';
    var cbs = agencyShipmentItemsList.querySelectorAll('.cb-board-shipment:checked');
    var nums = Array.from(cbs).map(function(x){ return parseInt(x.getAttribute('data-n'), 10); });
    var baseUrl = window.location.origin + window.location.pathname;
    var finalUrl = baseUrl;
    if (nums.length > 0) {
      finalUrl += '?piezas=' + nums.join(',') + '&review=corregidos';
    }
    if (agencyShipmentUrlInp) agencyShipmentUrlInp.value = finalUrl;
    return finalUrl;
  }

  function openAgencyShipmentModal(){
    if (!agencyShipmentModal) return;
    if (agencyShipmentItemsList) {
      var hasFix = items.some(function(it){ return it.estado === 'cambios' || (it.version && it.version > 1); });
      var h = '';
      items.forEach(function(it, idx){
        var n = idx + 1;
        var nStr = (n < 10 ? '0' : '') + n;
        var isTarget = (it.estado === 'cambios' || (it.version && it.version > 1));
        var isChecked = hasFix ? (isTarget ? 'checked' : '') : 'checked';
        var stBadge = '';
        if (it.estado === 'cambios') stBadge = '<span style="background:rgba(230,74,0,0.2);color:#ff7a45;padding:2px 6px;border-radius:6px;font-size:10px;">Con cambios</span>';
        else if (it.version && it.version > 1) stBadge = '<span style="background:rgba(92,184,62,0.2);color:#86efac;padding:2px 6px;border-radius:6px;font-size:10px;">v' + it.version + ' Corregido</span>';
        else if (it.estado === 'aprobado') stBadge = '<span style="background:rgba(92,184,62,0.2);color:#86efac;padding:2px 6px;border-radius:6px;font-size:10px;opacity:.75;">Aprobado</span>';
        else stBadge = '<span style="background:rgba(255,255,255,0.08);color:rgba(255,255,255,0.6);padding:2px 6px;border-radius:6px;font-size:10px;">Pendiente</span>';

        var titleClean = String(it.titulo || 'Contenido').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        var fmtClean = String(it.formato || 'Post').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

        h += '<label style="display:flex;align-items:center;gap:10px;padding:7px 10px;background:rgba(255,255,255,0.04);border-radius:8px;cursor:pointer;font-size:12px;">' +
          '<input type="checkbox" class="cb-board-shipment" data-n="' + n + '" ' + isChecked + ' style="accent-color:#0284c7;width:15px;height:15px;cursor:pointer;">' +
          '<span style="font-weight:700;color:#bae6fd;">#' + nStr + '</span>' +
          '<span style="flex:1;color:#fff;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + titleClean + ' <small style="opacity:.6;">(' + fmtClean + ')</small></span>' +
          stBadge +
        '</label>';
      });
      agencyShipmentItemsList.innerHTML = h;

      var cbs = agencyShipmentItemsList.querySelectorAll('.cb-board-shipment');
      cbs.forEach(function(cb){ cb.onchange = updateAgencyShipmentUrl; });
    }

    if (btnToggleAllAgencyShipment) {
      btnToggleAllAgencyShipment.onclick = function(){
        var cbs = agencyShipmentItemsList.querySelectorAll('.cb-board-shipment');
        var allChecked = Array.from(cbs).every(function(x){ return x.checked; });
        cbs.forEach(function(x){ x.checked = !allChecked; });
        btnToggleAllAgencyShipment.textContent = allChecked ? 'Seleccionar todas' : 'Deseleccionar todas';
        updateAgencyShipmentUrl();
      };
    }

    updateAgencyShipmentUrl();
    agencyShipmentModal.style.display = 'flex';
  }

  function closeAgencyShipmentModal(){
    if (agencyShipmentModal) agencyShipmentModal.style.display = 'none';
  }

  if (btnAgencyShipment) btnAgencyShipment.onclick = openAgencyShipmentModal;
  if (btnCloseAgencyShipment) btnCloseAgencyShipment.onclick = closeAgencyShipmentModal;
  if (btnCancelAgencyShipment) btnCancelAgencyShipment.onclick = closeAgencyShipmentModal;
  if (agencyShipmentModal) {
    agencyShipmentModal.onclick = function(e){
      if (e.target === agencyShipmentModal) closeAgencyShipmentModal();
    };
  }

  if (btnCopyAgencyShipment) {
    btnCopyAgencyShipment.onclick = function(){
      var cbs = agencyShipmentItemsList.querySelectorAll('.cb-board-shipment:checked');
      var nums = Array.from(cbs).map(function(x){ return parseInt(x.getAttribute('data-n'), 10); });
      if (!nums.length) {
        toast('Selecciona al menos una pieza para enviar.');
        return;
      }
      var targetUrl = updateAgencyShipmentUrl();
      var cliente = DATA.cliente || 'Estimado cliente';
      var periodo = (DATA.mes || '') + (DATA.anio ? ' ' + DATA.anio : '');

      var msg = '¡Hola ' + cliente + '! 👋\n\n' +
        'Hemos preparado y ajustado los contenidos solicitados de tu parrilla (*' + periodo + '*).\n\n' +
        'Piezas listas para tu visto bueno (' + nums.length + '):\n';

      nums.forEach(function(n){
        var it = items[n - 1];
        if (it) {
          var nStr = (n < 10 ? '0' : '') + n;
          msg += '• #' + nStr + ' - ' + (it.titulo || 'Contenido') + ' (' + (it.formato || 'Post') + (it.version ? ' · v' + it.version : '') + ')\n';
        }
      });

      msg += '\nPuedes revisar y dar tu visto bueno directamente en este enlace:\n' + targetUrl + '\n\n' +
        '¡Quedamos atentos a tus comentarios!';

      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(msg).then(function(){
          toast('✓ ¡Enlace exclusivo y mensaje copiados!');
          closeAgencyShipmentModal();
        });
      } else {
        var ta = document.createElement('textarea');
        ta.value = msg; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta);
        toast('✓ ¡Enlace exclusivo y mensaje copiados!');
        closeAgencyShipmentModal();
      }
    };
  }


  if (btnAgencyLogout) {
    btnAgencyLogout.onclick = function(){
      clearAgencySession();
      updateAgencyUI();
      toast('Sesión de agencia cerrada');
    };
  }

  // Guardar cambio de formato directo en Firestore (Modo Agencia)
  function saveAgencyFormatoChange(it, newFormato){
    if (!FB || !FB.projectId || !DATA.id) {
      toast('Formato cambiado localmente (sin conexión a Firestore)');
      return;
    }

    var cObj = cards.find(function(c){ return c.it === it; });
    var cambiosPorId = {};
    cambiosPorId[it.id] = {
      formato: newFormato,
      formatoOriginal: newFormato
    };

    guardarPiezas(cambiosPorId).then(function(){
      if (cObj && cObj.setUnsavedState) cObj.setUnsavedState(false);
      toast('✓ Tipo de contenido (' + newFormato + ') sincronizado en Firestore');
    }).catch(function(err){
      console.error('Error guardando formato en Firestore:', err);
      if (cObj && cObj.setUnsavedState) cObj.setUnsavedState(true);
      modal({
        kind: 'warn',
        icon: '!',
        title: 'No se guardó en la nube',
        text: 'No se pudo sincronizar el formato (' + newFormato + ') en Firestore. Revisa tu conexión.',
        buttons: [
          { label: 'Reintentar', primary: true, fn: function(){ saveAgencyFormatoChange(it, newFormato); } },
          { label: 'Cerrar' }
        ]
      });
    });
  }

  // Guardar corrección directa en Firestore y actualizar tarjeta
  function saveCardCorrection(it, cObj, newGuion, newCopy, newTitle, btnSave, newHash){
    if (btnSave) { btnSave.disabled = true; btnSave.textContent = 'Guardando…'; }

    var nowIso = new Date().toISOString();
    var cambiosPorId = {};
    cambiosPorId[it.id] = function(piezaFs){
      var curV = parseInt(piezaFs.version, 10) || 1;
      var curGuion = piezaFs.guion || '';
      var curCopy = piezaFs.copy || '';
      var curTitle = piezaFs.titulo || '';
      var curHash = piezaFs.hashtags || '';

      var valHash = (newHash !== undefined) ? newHash : curHash;
      var textoCambio = (newGuion.trim() !== curGuion.trim()) || (newCopy.trim() !== curCopy.trim()) || (newTitle.trim() !== curTitle.trim()) || (valHash.trim() !== curHash.trim());
      var nextVersion = (textoCambio && piezaFs.estado !== 'corregido') ? (curV + 1) : curV;

      var hist = Array.isArray(piezaFs.historial) ? piezaFs.historial.slice() : [];
      if (textoCambio || piezaFs.estado !== 'corregido') {
        hist.push({
          version: nextVersion,
          accion: 'Corrección guardada (v' + nextVersion + ')',
          usuario: agencyUser ? ('Agencia (' + agencyUser + ')') : 'Equipo Nexo',
          fecha: nowIso
        });
      }

      return {
        titulo: newTitle,
        guion: newGuion,
        copy: newCopy,
        hashtags: valHash,
        formato: (cObj && cObj.fs) ? cObj.fs.value : (piezaFs.formato || it.formato),
        formatoOriginal: (cObj && cObj.fs) ? cObj.fs.value : (piezaFs.formatoOriginal || it.formatoOriginal),
        version: nextVersion,
        estado: 'corregido',
        fechaCorreccion: nowIso,
        aprobacion: null,
        historial: hist
      };
    };

    var opciones = {
      tableroFields: {
        revisadoPor: '',
        ultimaRevision: ''
      }
    };

    return guardarPiezas(cambiosPorId, opciones).then(function(savedDoc){
      if (btnSave) { btnSave.disabled = false; btnSave.textContent = '💾 Guardar cambios'; }
      if (cObj && cObj.setUnsavedState) cObj.setUnsavedState(false);
      if ($('reviewed')) $('reviewed').classList.remove('show');
      toast('✓ Corrección guardada (v' + it.version + ') y sincronizada en el tablero');
      if (cObj && cObj.updateAgencyBarText) cObj.updateAgencyBarText();
      return savedDoc;
    }).catch(function(err){
      console.error('Error guardando corrección en Firestore:', err);
      if (btnSave) { btnSave.disabled = false; btnSave.textContent = '💾 Guardar cambios'; }
      if (cObj && cObj.setUnsavedState) cObj.setUnsavedState(true);
      modal({
        kind: 'warn',
        icon: '!',
        title: 'No se guardó en la nube',
        text: 'Ocurrió un error al guardar la corrección en Firestore (' + (err.message || 'error de conexión') + '). Tus cambios están guardados en tu navegador.',
        buttons: [
          {
            label: 'Reintentar',
            primary: true,
            fn: function(){
              saveCardCorrection(it, cObj, newGuion, newCopy, newTitle, btnSave, newHash);
            }
          },
          { label: 'Cerrar' }
        ]
      });
      throw err;
    });
  }

  // Sincronizar decisión de aprobación/cambios directamente en Firestore (Modo Agencia)
  function saveAgencyDecisionChange(it, decision, btn){
    if (btn) btn.disabled = true;

    var cObj = cards.find(function(c){ return c.it === it; });
    var pieceNum = items.indexOf(it) + 1;

    var cambiosPorId = {};
    if (decision === 'aprobado') {
      cambiosPorId[it.id] = function(piezaFs){
        if (piezaFs.borrador) {
          var bGuion = piezaFs.borrador.guion || '';
          var bCopy = piezaFs.borrador.copy || '';
          var curGuion = piezaFs.guion || '';
          var curCopy = piezaFs.copy || '';
          if ((bGuion && bGuion !== curGuion) || (bCopy && bCopy !== curCopy)) {
            throw new Error('Hay una corrección sin terminar en el Banco de trabajo');
          }
        }
        var vNum = parseInt(piezaFs.version, 10) || 1;
        var revWho = agencyUser ? ('Agencia (' + agencyUser + ')') : 'Equipo Nexo';
        var nowIso = new Date().toISOString();
        return {
          estado: 'aprobado',
          revisadoPor: revWho,
          fechaAprobacion: nowIso,
          aprobacion: {
            version: vNum,
            usuario: revWho,
            fecha: nowIso,
            titulo: piezaFs.titulo || it.titulo || '',
            formato: piezaFs.formato || it.formato || '',
            guion: piezaFs.guion || it.guion || '',
            copy: piezaFs.copy || it.copy || '',
            hashtags: piezaFs.hashtags || it.hashtags || ''
          }
        };
      };
    } else {
      cambiosPorId[it.id] = {
        estado: decision,
        aprobacion: null
      };
    }

    guardarPiezas(cambiosPorId).then(function(){
      if (btn) btn.disabled = false;
      if (cObj && cObj.setUnsavedState) cObj.setUnsavedState(false);
      toast('✓ Contenido #' + (pieceNum < 10 ? '0' : '') + pieceNum + ' marcado como ' + (decision === 'aprobado' ? 'Aprobado' : decision) + ' y sincronizado');
      if (cObj && cObj.updateAgencyBarText) cObj.updateAgencyBarText();
    }).catch(function(err){
      console.error('Error sincronizando estado en Firestore:', err);
      if (btn) btn.disabled = false;
      if (cObj && cObj.setUnsavedState) cObj.setUnsavedState(true);
      modal({
        kind: 'warn',
        icon: '!',
        title: 'No se guardó en la nube',
        text: 'No se pudo actualizar el estado en Firestore (' + (err.message || 'error') + ').',
        buttons: [
          {
            label: 'Reintentar',
            primary: true,
            fn: function(){
              saveAgencyDecisionChange(it, decision, btn);
            }
          },
          { label: 'Cerrar' }
        ]
      });
    });
  }



  function renderActiveMonth(monthData, isClosed){
    DATA = monthData;
    items = DATA.contenidos || [];
    KEY = 'nexo-revision-' + (DATA.id || (DATA.cliente + '-' + DATA.mes + '-' + DATA.anio));
    if (DATA.firebase) FB = DATA.firebase;
    isClosedMonth = !!isClosed;
    var isClosedReview = isClosedMonth && isReviewShipment;

    if (isClosedMonth) {
      document.body.classList.add('is-closed-month');
    } else {
      document.body.classList.remove('is-closed-month');
    }

    if (isClosedReview) {
      document.body.classList.add('is-review-corregidos-closed');
    } else {
      document.body.classList.remove('is-review-corregidos-closed');
    }

    updateClosedMonthBanner();
    updateMonthSelector();
    updateHeader();
    normalizeItems();

    if (!isClosedMonth && (!DATA.revision || !DATA.revision.fecha)) {
      recoverDraft();
    }

    buildAllCards();
    syncAndRegisterBoard();

    counts();
    refresh();
    applyFilter('todas');
    updateApartadoCorregidos();
    updateAgencyUI();

    // Comprobación de Sortable opcional para que no rompa si no está cargado
    if (typeof Sortable !== 'undefined' && Sortable && Sortable.create && nav) {
      try {
        Sortable.create(nav, {
          animation: 150,
          ghostClass: 'sortable-ghost',
          disabled: isClosedMonth && !agencyUser
        });
      } catch(e) {}
    }

    // Si viene ?review=corregidos
    if (isReviewShipment) {
      applyFilter();
      var firstCorr = document.querySelector('.card.status-corregido');
      if (firstCorr) {
        setTimeout(function(){
          firstCorr.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 400);
      }
    }
  }

  function switchMonth(newMes){
    if (!newMes || newMes === activeMes) return;
    activeMes = newMes;
    var newUrl = new URL(window.location.href);
    newUrl.searchParams.set('mes', newMes);
    newUrl.searchParams.delete('review');
    newUrl.searchParams.delete('piezas');
    window.history.replaceState(null, '', newUrl.toString());
    isReviewShipment = false;
    targetPieceNumbers = null;
    document.body.classList.remove('is-review-corregidos-closed');

    if (monthsCache[newMes]) {
      var isClosed = (indiceData && indiceData.actual) ? (newMes !== indiceData.actual) : false;
      renderActiveMonth(monthsCache[newMes], isClosed);
    } else if (codigoCliente) {
      fetch('datos/' + encodeURIComponent(codigoCliente) + '/' + encodeURIComponent(newMes) + '.json', { cache: 'no-cache' })
        .then(function(res){
          if (!res.ok) throw new Error('HTTP ' + res.status);
          return res.json();
        })
        .then(function(data){
          monthsCache[newMes] = data;
          var isClosed = (indiceData && indiceData.actual) ? (newMes !== indiceData.actual) : false;
          renderActiveMonth(data, isClosed);
        })
        .catch(function(err){
          toast('No se pudieron cargar los datos del mes seleccionado.');
        });
    }
  }

  // Carga inicial y respaldo offline
  var MESES_MAP = {
    enero:'01', febrero:'02', marzo:'03', abril:'04', mayo:'05', junio:'06',
    julio:'07', agosto:'08', septiembre:'09', setiembre:'09', octubre:'10', noviembre:'11', diciembre:'12'
  };
  function getMesKey(m, a){
    if (!m) return '';
    var s = String(m).toLowerCase().trim();
    var num = MESES_MAP[s] || (s.length === 2 ? s : '');
    if (!num) return '';
    return String(a || '2026') + '-' + num;
  }

  function initTablero(){
    list = $('list');
    nav = $('nav');
    [].forEach.call(document.querySelectorAll('[data-logo]'), function(d){ if ($('nexo-logo')) d.innerHTML = $('nexo-logo').innerHTML; });
    try { if ($('fav') && $('nexo-iso')) $('fav').href = 'data:image/svg+xml,' + encodeURIComponent($('nexo-iso').innerHTML.trim()); } catch (e) {}

    var metaTag = document.querySelector('meta[name="nexo-tablero"]');
    codigoCliente = metaTag ? metaTag.getAttribute('content') : '';
    if (!codigoCliente) {
      var pathParts = window.location.pathname.split('/');
      var lastPart = pathParts[pathParts.length - 1] || '';
      if (lastPart.indexOf('.html') !== -1) {
        codigoCliente = lastPart.replace(/\.html$/i, '');
      }
    }

    var urlParams = new URLSearchParams(window.location.search);
    var requestedMes = urlParams.get('mes');

    var boardDataScript = document.getElementById('board-data');
    var embeddedData = null;
    try {
      if (boardDataScript && boardDataScript.textContent) {
        embeddedData = JSON.parse(boardDataScript.textContent);
      }
    } catch(e) {}
    var embMesKey = embeddedData ? getMesKey(embeddedData.mes, embeddedData.anio) : '';

    // 1. Renderizado síncrono inicial con respaldo si existe (pre-renderizado inmediato para Chrome headless y LCP rápido)
    if (embeddedData) {
      var isReqAnotherMonth = !!(requestedMes && requestedMes !== embMesKey);
      indiceData = {
        cliente: embeddedData.cliente,
        cuenta: (embeddedData.cuenta || '').replace('@', ''),
        actual: embMesKey,
        meses: [{
          mes: embMesKey,
          etiqueta: [embeddedData.mes, embeddedData.anio].filter(Boolean).join(' '),
          id: embeddedData.id
        }]
      };
      activeMes = embMesKey;
      monthsCache[activeMes] = embeddedData;
      renderActiveMonth(embeddedData, isReqAnotherMonth);
    }

    // 2. Carga asíncrona de datos multi-mes si hay codigoCliente
    if (codigoCliente) {
      fetch('datos/' + encodeURIComponent(codigoCliente) + '/indice.json', { cache: 'no-cache' })
        .then(function(res){
          if (!res.ok) throw new Error('Error al leer indice');
          return res.json();
        })
        .then(function(ind){
          indiceData = ind || {};

          // Si hay board-data embebido y el mes embebido es más nuevo que indice.actual, manda el embebido
          if (embeddedData && embMesKey) {
            if (!indiceData.actual || embMesKey > indiceData.actual) {
              indiceData.actual = embMesKey;
              if (!indiceData.meses) indiceData.meses = [];
              var found = indiceData.meses.some(function(m){ return m.mes === embMesKey; });
              if (!found) {
                indiceData.meses.unshift({
                  mes: embMesKey,
                  etiqueta: [embeddedData.mes, embeddedData.anio].filter(Boolean).join(' '),
                  id: embeddedData.id
                });
              }
            }
          }

          if (requestedMes && indiceData.meses && !indiceData.meses.some(function(m){ return m.mes === requestedMes; })) {
            return;
          }

          var targetMes = requestedMes || indiceData.actual || (indiceData.meses && indiceData.meses[0] ? indiceData.meses[0].mes : null);
          var isClosed = (targetMes !== indiceData.actual);

          // Si el mes pedido es diferente al que ya se pintó, o si aún no se había pintado
          if (targetMes !== activeMes || !embeddedData) {
            return fetch('datos/' + encodeURIComponent(codigoCliente) + '/' + encodeURIComponent(targetMes) + '.json', { cache: 'no-cache' })
              .then(function(res){
                if (!res.ok) throw new Error('Error al leer mes');
                return res.json();
              })
              .then(function(monthData){
                activeMes = targetMes;
                monthsCache[activeMes] = monthData;
                renderActiveMonth(monthData, isClosed);
              });
          } else {
            // El mes activo ya está pintado, solo actualizar el selector si hay múltiples meses
            updateMonthSelector();
          }
        })
        .catch(function(){
          // Respaldo sin conexión / bloqueo de ruta: ya está activo embeddedData
        });
    } else if (!embeddedData) {
      console.warn('Nexo Tablero: no se encontraron datos de inicialización.');
    }

    updateAgencyUI();

    // Si se abre con ?agencia=1, #agencia, ?admin=1 o #admin y aún no está iniciada la sesión, abrir modal de autenticación inmediatamente
    if (window.location.search.indexOf('agencia=1') !== -1 || window.location.hash.indexOf('agencia') !== -1 ||
        window.location.search.indexOf('admin=1') !== -1 || window.location.hash.indexOf('admin') !== -1) {
      if (!agencyUser) {
        setTimeout(function(){
          openAgencyLogin();
        }, 400);
      }
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initTablero);
  } else {
    initTablero();
  }

  if (typeof window !== 'undefined') {
    window.switchMonth = switchMonth;
    window.getReviewCorregidosUrl = getReviewCorregidosUrl;
  }
})();
