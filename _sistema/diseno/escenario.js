/**
 * NEXO AGENCIA CREATIVA · ESCENARIO WEBGL
 * Fondo compartido "Mesa de luz Nexo". Reemplaza a fondo-red.js.
 * Shader WebGL1 con gradiente de malla orgánico y grano fino,
 * con respuesta sutil al puntero, pausado automático y fallback CSS.
 */
(function(root) {
  'use strict';

  var VS_SRC = [
    'attribute vec2 a_pos;',
    'void main() {',
    '  gl_Position = vec4(a_pos, 0.0, 1.0);',
    '}'
  ].join('\n');

  var FS_SRC = [
    'precision mediump float;',
    'uniform vec2 u_res;',
    'uniform float u_time;',
    'uniform vec2 u_mouse;',
    'uniform float u_intensity;',
    '',
    '// Pseudo-random noise for subtle fine film grain',
    'float hash(vec2 p) {',
    '  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453123);',
    '}',
    '',
    'void main() {',
    '  vec2 uv = gl_FragCoord.xy / u_res;',
    '  float aspect = u_res.x / max(u_res.y, 1.0);',
    '  vec2 p = uv;',
    '  p.x *= aspect;',
    '',
    '  // Slower 20s organic drift',
    '  float t = u_time * 0.05;',
    '',
    '  // Mesh centers drifting with time and mouse influence',
    '  vec2 m = (u_mouse - 0.5) * 0.15;',
    '  vec2 c1 = vec2(0.25 * aspect, 0.8) + vec2(sin(t * 0.8), cos(t * 0.7)) * 0.12 + m;',
    '  vec2 c2 = vec2(0.85 * aspect, 0.25) + vec2(cos(t * 0.9), sin(t * 0.6)) * 0.14 - m * 0.8;',
    '  vec2 c3 = vec2(0.55 * aspect, 0.5) + vec2(sin(t * 0.5), sin(t * 1.1)) * 0.10 + m * 0.5;',
    '',
    '  // Distances to mesh nodes',
    '  float d1 = length(p - c1);',
    '  float d2 = length(p - c2);',
    '  float d3 = length(p - c3);',
    '',
    '  // Colors: Stage-0 (#070B10) & Stage-3 (#1F3549)',
    '  vec3 colBase0 = vec3(0.027, 0.043, 0.063);',
    '  vec3 colBase1 = vec3(0.047, 0.075, 0.106);',
    '  vec3 colStage3 = vec3(0.122, 0.208, 0.286);',
    '  // Nexo Green (#5CB83E) at 18% max intensity',
    '  vec3 colGreen = vec3(0.361, 0.722, 0.243) * 0.18 * u_intensity;',
    '  // Nexo Azul-tint (#4A7A9E) at 12% max intensity',
    '  vec3 colTint = vec3(0.290, 0.478, 0.620) * 0.12 * u_intensity;',
    '',
    '  // Soft smooth radial mesh blends',
    '  float w1 = smoothstep(1.1 * aspect, 0.0, d1);',
    '  float w2 = smoothstep(0.95 * aspect, 0.0, d2);',
    '  float w3 = smoothstep(0.85 * aspect, 0.0, d3);',
    '',
    '  vec3 col = mix(colBase0, colBase1, uv.y);',
    '  col = mix(col, colStage3, w1 * 0.65);',
    '  col += colGreen * w2;',
    '  col += colTint * w3;',
    '',
    '  // Subtle vignette',
    '  float vig = 1.0 - length((uv - 0.5) * vec2(1.1, 0.9)) * 0.45;',
    '  col *= clamp(vig, 0.0, 1.0);',
    '',
    '  // Fine film grain to eliminate digital banding',
    '  float grain = (hash(gl_FragCoord.xy + fract(u_time * 1.7)) - 0.5) * 0.024;',
    '  col += grain;',
    '',
    '  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);',
    '}'
  ].join('\n');

  function fallbackCSS(canvas) {
    if (!canvas) return;
    canvas.style.background = [
      'radial-gradient(circle at 18% 22%, rgba(92, 184, 62, 0.07) 0%, transparent 45%)',
      'radial-gradient(circle at 82% 78%, rgba(74, 122, 158, 0.11) 0%, transparent 55%)',
      'radial-gradient(circle at 50% 50%, rgba(31, 53, 73, 0.40) 0%, transparent 70%)',
      '#070B10'
    ].join(', ');
  }

  function montar(canvas, opciones) {
    if (!canvas) return null;
    opciones = opciones || {};
    var intensidad = typeof opciones.intensidad === 'number' ? opciones.intensidad : 1.0;
    var seguirPuntero = opciones.puntero !== false;

    // Detectar prefers-reduced-motion
    var prefersReduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    var gl = null;
    try {
      gl = canvas.getContext('webgl', { alpha: false, depth: false, antialias: false, powerPreference: 'low-power' }) ||
           canvas.getContext('experimental-webgl');
    } catch (e) {
      gl = null;
    }

    if (!gl) {
      fallbackCSS(canvas);
      return { destruir: function() {}, pausar: function() {}, reanudar: function() {} };
    }

    // Compilación de shaders
    function crearShader(tipo, src) {
      var s = gl.createShader(tipo);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        console.warn('NexoEscenario shader error:', gl.getShaderInfoLog(s));
        gl.deleteShader(s);
        return null;
      }
      return s;
    }

    var vs = crearShader(gl.VERTEX_SHADER, VS_SRC);
    var fs = crearShader(gl.FRAGMENT_SHADER, FS_SRC);
    if (!vs || !fs) {
      fallbackCSS(canvas);
      return { destruir: function() {}, pausar: function() {}, reanudar: function() {} };
    }

    var prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.warn('NexoEscenario program link error:', gl.getProgramInfoLog(prog));
      fallbackCSS(canvas);
      return { destruir: function() {}, pausar: function() {}, reanudar: function() {} };
    }

    gl.useProgram(prog);

    // Quad de pantalla completa
    var buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      -1, -1,  1, -1, -1,  1,
      -1,  1,  1, -1,  1,  1
    ]), gl.STATIC_DRAW);

    var aPos = gl.getAttribLocation(prog, 'a_pos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    var uRes = gl.getUniformLocation(prog, 'u_res');
    var uTime = gl.getUniformLocation(prog, 'u_time');
    var uMouse = gl.getUniformLocation(prog, 'u_mouse');
    var uIntensity = gl.getUniformLocation(prog, 'u_intensity');

    gl.uniform1f(uIntensity, intensidad);

    // Estado de la animación y del puntero con resorte lerp
    var mouseTargetX = 0.5;
    var mouseTargetY = 0.5;
    var mouseX = 0.5;
    var mouseY = 0.5;
    var animId = null;
    var activo = true;
    var enPantalla = true;
    var startTime = performance.now();
    var lastFrameTime = 0;

    // Dimensionado con DPR controlado
    function redimensionar() {
      var rect = canvas.getBoundingClientRect();
      var isMobile = (window.innerWidth || 0) <= 768;
      var dpr = Math.min(window.devicePixelRatio || 1, isMobile ? 1.5 : 2.0);
      var w = Math.max(1, Math.floor(rect.width * dpr));
      var h = Math.max(1, Math.floor(rect.height * dpr));

      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        gl.viewport(0, 0, w, h);
        gl.uniform2f(uRes, w, h);
      }
    }

    redimensionar();
    window.addEventListener('resize', redimensionar, { passive: true });

    // Puntero con seguimiento suave
    function onMouseMove(e) {
      if (!seguirPuntero) return;
      mouseTargetX = Math.max(0, Math.min(1, e.clientX / window.innerWidth));
      mouseTargetY = Math.max(0, Math.min(1, 1.0 - (e.clientY / window.innerHeight)));
    }

    if (seguirPuntero && !prefersReduced) {
      window.addEventListener('mousemove', onMouseMove, { passive: true });
    }

    function renderFrame(now) {
      if (!activo) return;

      // Respeto a prefers-reduced-motion: un solo frame estático
      if (prefersReduced) {
        gl.uniform1f(uTime, 2.5);
        gl.uniform2f(uMouse, 0.5, 0.5);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
        return;
      }

      // Limitar a ~30fps en móvil o dispositivos con poca energía
      var elapsed = (now - startTime) * 0.001;

      // Lerp resorte para puntero (0.07 por frame)
      mouseX += (mouseTargetX - mouseX) * 0.07;
      mouseY += (mouseTargetY - mouseY) * 0.07;

      gl.uniform1f(uTime, elapsed);
      gl.uniform2f(uMouse, mouseX, mouseY);
      gl.drawArrays(gl.TRIANGLES, 0, 6);

      if (activo && enPantalla) {
        animId = requestAnimationFrame(renderFrame);
      }
    }

    function reanudar() {
      if (!activo) {
        activo = true;
        if (enPantalla && !animId) {
          animId = requestAnimationFrame(renderFrame);
        }
      }
    }

    function pausar() {
      activo = false;
      if (animId) {
        cancelAnimationFrame(animId);
        animId = null;
      }
    }

    // Pausar fuera de pantalla mediante IntersectionObserver
    var observer = null;
    if ('IntersectionObserver' in window) {
      observer = new IntersectionObserver(function(entries) {
        entries.forEach(function(entry) {
          enPantalla = entry.isIntersecting;
          if (enPantalla && activo && !animId) {
            animId = requestAnimationFrame(renderFrame);
          } else if (!enPantalla && animId) {
            cancelAnimationFrame(animId);
            animId = null;
          }
        });
      }, { threshold: 0.05 });
      observer.observe(canvas);
    }

    // Pausar si la pestaña pasa a segundo plano
    function onVisibilityChange() {
      if (document.hidden) {
        pausar();
      } else {
        reanudar();
      }
    }
    document.addEventListener('visibilitychange', onVisibilityChange);

    // Iniciar loop
    animId = requestAnimationFrame(renderFrame);

    return {
      destruir: function() {
        pausar();
        window.removeEventListener('resize', redimensionar);
        window.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('visibilitychange', onVisibilityChange);
        if (observer) observer.disconnect();
        try {
          gl.deleteProgram(prog);
          gl.deleteShader(vs);
          gl.deleteShader(fs);
          gl.deleteBuffer(buf);
        } catch (e) {}
      },
      pausar: pausar,
      reanudar: reanudar
    };
  }

  root.NexoEscenario = {
    montar: montar,
    fallbackCSS: fallbackCSS
  };

})(typeof window !== 'undefined' ? window : this);
