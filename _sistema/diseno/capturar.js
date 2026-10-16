#!/usr/bin/env node
/**
 * NEXO · Capturador CDP de Alta Precisión
 * Usa Chrome DevTools Protocol nativo para capturar vistas de pantalla
 * con emulación de viewport móvil real (390x844 @2x) y escritorio (1440x900).
 */

const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9223; // Usar puerto dedicado

function wait(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

async function capture({ url, width, height, scale, mobile, fullPage, outPath }) {
  const profileDir = path.join('/tmp', `nexo_cdp_${Date.now()}_${Math.floor(Math.random() * 1000)}`);
  fs.mkdirSync(profileDir, { recursive: true });

  const chromeProc = spawn(CHROME_PATH, [
    '--headless=new',
    '--disable-gpu',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profileDir}`,
    '--no-first-run'
  ], { stdio: 'ignore' });

  try {
    let ver = null;
    for (let i = 0; i < 30; i++) {
      await wait(150);
      try {
        ver = await fetchJson(`http://127.0.0.1:${PORT}/json/version`);
        if (ver && ver.webSocketDebuggerUrl) break;
      } catch (e) {}
    }

    if (!ver || !ver.webSocketDebuggerUrl) {
      throw new Error('Chrome CDP no respondió en puerto ' + PORT);
    }

    // Obtener la pestaña activa
    let targets = null;
    for (let i = 0; i < 20; i++) {
      await wait(100);
      try {
        targets = await fetchJson(`http://127.0.0.1:${PORT}/json/list`);
        if (targets && targets.length) break;
      } catch (e) {}
    }

    const pageTarget = targets.find(t => t.type === 'page') || targets[0];
    const ws = new WebSocket(pageTarget.webSocketDebuggerUrl);

    await new Promise((resolve, reject) => {
      ws.onopen = resolve;
      ws.onerror = reject;
    });

    let msgId = 1;
    const pending = new Map();

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && pending.has(msg.id)) {
        const { resolve, reject } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      }
    };

    function send(method, params = {}) {
      return new Promise((resolve, reject) => {
        const id = msgId++;
        pending.set(id, { resolve, reject });
        ws.send(JSON.stringify({ id, method, params }));
      });
    }

    await send('Page.enable');
    await send('Emulation.setDeviceMetricsOverride', {
      width: Math.round(width),
      height: Math.round(height),
      deviceScaleFactor: scale || 1,
      mobile: Boolean(mobile)
    });

    if (mobile) {
      await send('Emulation.setUserAgentOverride', {
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1'
      });
    }

    // Navegar a la URL objetivo y esperar renderizado
    await send('Page.navigate', { url });
    await wait(1200);

    const result = await send('Page.captureScreenshot', {
      format: 'png',
      fromSurface: true,
      captureBeyondViewport: Boolean(fullPage)
    });

    const buffer = Buffer.from(result.data, 'base64');
    fs.writeFileSync(outPath, buffer);
    console.log(`✓ Captura generada: ${outPath} (${width}x${height} @${scale}x${fullPage ? ' full' : ''})`);

    ws.close();
  } finally {
    try { chromeProc.kill('SIGKILL'); } catch (e) {}
    try { fs.rmSync(profileDir, { recursive: true, force: true }); } catch (e) {}
  }
}

async function main() {
  const args = process.argv.slice(2);
  const targetHtml = args[0] || 'http://localhost:8080/_sistema/diseno/muestrario.html';
  const targetUrl = targetHtml.startsWith('http') || targetHtml.startsWith('file://') ? targetHtml : 'file://' + path.resolve(targetHtml);

  const previewDir = path.resolve(__dirname, '../../_preview');
  if (!fs.existsSync(previewDir)) fs.mkdirSync(previewDir, { recursive: true });

  console.log('Capturando vistas del muestrario:', targetUrl);

  // 1. Escritorio 1440px (Viewport inicial)
  await capture({
    url: targetUrl,
    width: 1440,
    height: 1000,
    scale: 1,
    mobile: false,
    fullPage: false,
    outPath: path.join(previewDir, 'muestrario-1440px.png')
  });

  await wait(300);

  // 2. Escritorio 1440px (Página completa con todos los componentes)
  await capture({
    url: targetUrl,
    width: 1440,
    height: 1000,
    scale: 1,
    mobile: false,
    fullPage: true,
    outPath: path.join(previewDir, 'muestrario-1440px-completo.png')
  });

  await wait(300);

  // 3. Móvil iPhone 390px (Viewport inicial)
  await capture({
    url: targetUrl,
    width: 390,
    height: 844,
    scale: 2,
    mobile: true,
    fullPage: false,
    outPath: path.join(previewDir, 'muestrario-390px.png')
  });

  await wait(300);

  // 4. Móvil iPhone 390px (Página completa)
  await capture({
    url: targetUrl,
    width: 390,
    height: 844,
    scale: 2,
    mobile: true,
    fullPage: true,
    outPath: path.join(previewDir, 'muestrario-390px-completo.png')
  });
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});

