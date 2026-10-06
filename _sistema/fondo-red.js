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

      // Helper de parallax por capa
      function getParallaxY(layer){
        return isStatic ? 0 : (layer === 0 ? scrollY * 0.04 : scrollY * 0.08);
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
