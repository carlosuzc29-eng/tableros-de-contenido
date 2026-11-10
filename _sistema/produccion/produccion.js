(function(window, document) {
  'use strict';

  // ── DATOS BASE ──────────────────────────────────────────────────────────
  const DATA = (typeof window !== 'undefined' && window.DATA) ? window.DATA : (typeof DATA !== 'undefined' ? DATA : { fecha: "", cliente: "", contenidos: [] });
    // Tipos de formato y paletas temáticas refinadas
    const TIPOS = {
      reel: { label: 'Reel', bg: 'rgba(230, 74, 0, 0.14)', color: 'var(--nexo-orange)', border: 'rgba(230, 74, 0, 0.28)' },
      carrusel: { label: 'Carrusel', bg: 'rgba(168, 85, 247, 0.14)', color: '#C084FC', border: 'rgba(168, 85, 247, 0.28)' },
      tiktok: { label: 'TikTok', bg: 'rgba(56, 189, 248, 0.14)', color: 'var(--nexo-cyan)', border: 'rgba(56, 189, 248, 0.28)' },
      foto: { label: 'Foto', bg: 'rgba(92, 184, 62, 0.14)', color: 'var(--nexo-green)', border: 'rgba(92, 184, 62, 0.28)' },
      otro: { label: 'Otro', bg: 'rgba(148, 163, 184, 0.14)', color: 'var(--text-muted)', border: 'rgba(148, 163, 184, 0.28)' }
    };

    // Claves de almacenamiento
    const LS_KEY = 'nexo-tablero-prod-' + (DATA.id || 'default');

    let state = {
      fecha: DATA.fecha || '',
      cliente: DATA.cliente || '',
      contenidos: []
    };

    let currentDrawerCardId = null;
    let searchQuery = '';
    let sortableInstances = [];
    let isDragging = false;
    let currentActiveMenuId = null;
    let modalPreselectedStatus = 'todo';

    // ── GESTIÓN DE TEMAS (DARK / LIGHT STUDIO) ─────────────────────────────
    // Shim ultraligero de Lucide para compatibilidad sin dependencias externas
    window.lucide = {
      createIcons: function() {
        document.querySelectorAll('i[data-lucide]').forEach(el => {
          const name = el.getAttribute('data-lucide');
          if (!name) return;
          const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
          svg.setAttribute('class', 'ico ' + (el.className || ''));
          svg.setAttribute('aria-hidden', 'true');
          const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
          use.setAttribute('href', '#i-' + name);
          svg.appendChild(use);
          el.replaceWith(svg);
        });
      }
    };

    function toggleTheme() {
      const current = document.documentElement.getAttribute('data-theme') || 'dark';
      const next = current === 'dark' ? 'light' : 'dark';
      setTheme(next);
    }

    function setTheme(theme) {
      document.documentElement.setAttribute('data-theme', theme);
      localStorage.setItem('nexo-tablero-theme', theme);
      const icon = document.getElementById('theme-toggle-icon');
      if (icon) {
        icon.innerHTML = `<use href="#i-${theme === 'dark' ? 'sun' : 'moon'}"></use>`;
      }
    }

    // ── FIREBASE FIRESTORE SYNC (COMPAT) ───────────────────────────────────
    let db = null;
    let prodDocRef = null;
    let isFirestoreOnline = false;

    function initFirebase() {
      const fb = DATA.firebase;
      if (!fb || !fb.apiKey || !fb.projectId || !DATA.id) return;
      const fbSdk = (typeof window !== 'undefined' && window.firebase) ? window.firebase : (typeof firebase !== 'undefined' ? firebase : null);
      if (!fbSdk) return;

      try {
        if (!fbSdk.apps || !fbSdk.apps.length) {
          fbSdk.initializeApp({
            apiKey: fb.apiKey,
            projectId: fb.projectId
          });
        }
        db = fbSdk.firestore();
        if (db && typeof db.enablePersistence === 'function') {
          db.enablePersistence({ synchronizeTabs: true }).catch((err) => {
            console.warn('Persistencia Firestore:', err && err.code ? err.code : err);
          });
        }
        // Colección 'produccion': la que permiten las reglas y la que lee el banco de trabajo
        prodDocRef = db.collection('produccion').doc(DATA.id);

        const liveEl = document.getElementById('live-indicator');
        if (liveEl) liveEl.style.display = 'inline-flex';

        let isFirstSync = true;
        prodDocRef.onSnapshot({ includeMetadataChanges: true }, (doc) => {
          if (!doc) return;
          if (doc.metadata) {
            updateLiveIndicator(doc.metadata);
          }
          if (doc.exists) {
            const remote = doc.data();
            if (isFirstSync) {
              isFirstSync = false;
              // En la primera sincronización, sube solo las tarjetas con avance local
              // cuyo estado remoto sea todo, una por una con tarjetas.<id>
              const remoteTarjetas = remote.tarjetas || {};
              state.contenidos.forEach(localCard => {
                const rCard = remoteTarjetas[localCard.id];
                const tieneAvanceLocal = (localCard.estado === 'grabando' || localCard.estado === 'listo');
                const remotoEsTodo = !rCard || rCard.estado === 'todo';
                if (tieneAvanceLocal && remotoEsTodo) {
                  syncCardToFirestore(localCard.id);
                }
              });
            }
            if (doc.metadata && doc.metadata.hasPendingWrites) {
              // Modificación local en tránsito, evitar parpadeos
              return;
            }
            if (remote.actualizado && remote.actualizado === lastLocalActualizado) {
              // Modificación local completada por nosotros, evitar re-renderizado
              if (!isFirstSyncDone) finishFirstSync();
              return;
            }
            applyRemoteUpdate(remote);
            if (!isFirstSyncDone) finishFirstSync();
          } else {
            seedFirestoreInitial();
            if (!isFirstSyncDone) finishFirstSync();
          }
        }, (err) => {
          console.warn('Firestore offline o reglas restringidas:', err);
          updateLiveIndicator({ fromCache: true });
          if (!isFirstSyncDone) finishFirstSync();
        });
      } catch (e) {
        console.warn('Error inicializando Firebase:', e);
        updateLiveIndicator({ fromCache: true });
        if (!isFirstSyncDone) finishFirstSync();
      }
    }

    let hasEverConnected = false;
    let offlineTimer = null;
    let syncingTimer = null;

    function updateLiveIndicator(metadata) {
      const live = document.getElementById('live-indicator');
      const label = document.getElementById('live-indicator-label');
      if (!live) return;
      live.classList.remove('online', 'offline', 'syncing', 'connecting');

      const isOfflineMode = (typeof window !== 'undefined' && window.__isOffline) || !navigator.onLine;

      if (isOfflineMode) {
        showOffline();
        return;
      }

      if (!metadata || metadata.fromCache) {
        if (hasEverConnected) {
          showOffline();
        } else {
          live.classList.add('connecting');
          live.setAttribute('aria-label', 'Conectando…');
          live.setAttribute('title', 'Conectando…');
          if (label) label.textContent = 'Conectando…';
          if (!offlineTimer) {
            offlineTimer = setTimeout(() => {
              showOffline();
            }, 4000);
          }
        }
      } else if (metadata.hasPendingWrites) {
        hasEverConnected = true;
        if (!syncingTimer) {
          syncingTimer = setTimeout(() => {
            live.classList.remove('online', 'offline', 'connecting');
            live.classList.add('syncing');
            live.setAttribute('aria-label', 'Sincronizando');
            live.setAttribute('title', 'Sincronizando…');
            if (label) label.textContent = 'Sincronizando…';
          }, 600);
        }
      } else {
        hasEverConnected = true;
        if (offlineTimer) { clearTimeout(offlineTimer); offlineTimer = null; }
        if (syncingTimer) { clearTimeout(syncingTimer); syncingTimer = null; }
        live.classList.add('online');
        live.setAttribute('aria-label', 'En vivo');
        live.setAttribute('title', 'En vivo');
        if (label) label.textContent = 'En vivo';
        isFirestoreOnline = true;
      }

      function showOffline() {
        if (offlineTimer) { clearTimeout(offlineTimer); offlineTimer = null; }
        if (syncingTimer) { clearTimeout(syncingTimer); syncingTimer = null; }
        live.classList.remove('online', 'syncing', 'connecting');
        live.classList.add('offline');
        live.setAttribute('aria-label', 'Sin conexión');
        live.setAttribute('title', 'Sin conexión · guardado en este teléfono');
        if (label) label.textContent = 'Sin conexión · guardado en este teléfono';
        isFirestoreOnline = false;
      }
    }

    function setFirestoreStatus(online) {
      updateLiveIndicator(online ? { fromCache: false, hasPendingWrites: false } : { fromCache: true });
    }

    window.addEventListener('online', () => {
      if (prodDocRef) {
        updateLiveIndicator({ fromCache: false, hasPendingWrites: false });
      }
    });

    window.addEventListener('offline', () => {
      const live = document.getElementById('live-indicator');
      const label = document.getElementById('live-indicator-label');
      if (live) {
        live.classList.remove('online', 'syncing', 'connecting');
        live.classList.add('offline');
        live.setAttribute('aria-label', 'Sin conexión');
        live.setAttribute('title', 'Sin conexión · guardado en este teléfono');
        if (label) label.textContent = 'Sin conexión · guardado en este teléfono';
      }
      isFirestoreOnline = false;
    });

    function buildTarjetas(forceTodo) {
      const orden = [];
      const tarjetas = {};
      const counts = { todo: 0, grabando: 0, listo: 0 };
      state.contenidos.forEach(raw => {
        const c = cleanCard(raw);
        if (!c || !c.id) return;
        if (forceTodo) {
          c.estado = 'todo';
          c.subtareas.forEach(st => st.done = false);
        }
        if (!(c.estado in counts)) c.estado = 'todo';
        orden.push(c.id);
        tarjetas[c.id] = c;
        counts[c.estado]++;
      });
      return { orden, tarjetas, counts };
    }

    let isSeeding = false;
    function seedFirestoreInitial() {
      if (!prodDocRef || !db || isSeeding) return;
      isSeeding = true;
      // Autorregistro: las reglas exigen que el documento nazca con todo en "Por hacer"
      const b = buildTarjetas(true);
      const nowIso = new Date().toISOString();
      const docData = {
        id: String(DATA.id),
        cliente: String(DATA.cliente || ''),
        fecha: String(DATA.fecha || ''),
        url: String(window.location.href.split('?')[0].split('#')[0]),
        registrado: nowIso,
        actualizado: nowIso,
        orden: b.orden,
        tarjetas: b.tarjetas,
        todo: b.orden.length,
        grabando: 0,
        listo: 0,
        eliminadas: []
      };
      db.runTransaction(tx => tx.get(prodDocRef).then(d => {
        if (!d.exists) tx.set(prodDocRef, docData);
      })).then(() => {
        isSeeding = false;
        updateLiveIndicator({ fromCache: false, hasPendingWrites: false });
        // Si ya había avance local antes del registro, subir solo tarjetas con avance
        state.contenidos.forEach(localCard => {
          if (localCard.estado === 'grabando' || localCard.estado === 'listo') {
            syncCardToFirestore(localCard.id);
          }
        });
      }).catch(err => {
        isSeeding = false;
        console.warn('Autorregistro produccion fallido:', err);
        updateLiveIndicator({ fromCache: true });
      });
    }

    function applyRemoteUpdate(remote) {
      if (!remote || !remote.tarjetas || typeof remote.tarjetas !== 'object') return;
      const eliminadasSet = new Set(Array.isArray(remote.eliminadas) ? remote.eliminadas : []);
      const remoteTarjetas = remote.tarjetas;
      remoteCardIds = new Set(Object.keys(remoteTarjetas).filter(id => remoteTarjetas[id]));
      remoteTarjetasCache = remoteTarjetas;
      const orden = Array.isArray(remote.orden) ? remote.orden : Object.keys(remoteTarjetas);
      const remoteList = [];
      orden.forEach(id => { if (remoteTarjetas[id]) remoteList.push(remoteTarjetas[id]); });
      Object.keys(remoteTarjetas).forEach(id => { if (!orden.includes(id)) remoteList.push(remoteTarjetas[id]); });

      let changed = false;

      // 1. Aplicar actualizaciones desde remoto a tarjetas locales existentes o agregar nuevas remotas
      remoteList.forEach(rCard => {
        if (eliminadasSet.has(rCard.id)) return;
        const local = state.contenidos.find(c => c.id === rCard.id);
        if (local) {
          if (local.estado !== rCard.estado) {
            local.estado = rCard.estado;
            changed = true;
          }
          if (rCard.subtareas && Array.isArray(rCard.subtareas) && !isFieldLocked(local.id, 'subtareas')) {
            // Si cambió la lista (pasos agregados, renombrados o quitados en otro teléfono) se toma la remota;
            // si solo cambiaron las marcas, se copian una por una como antes
            const firma = arr => JSON.stringify((arr || []).map(s => [String(s.id || ''), String(s.texto || '')]));
            if (firma(rCard.subtareas) !== firma(local.subtareas)) {
              local.subtareas = rCard.subtareas.map(s => ({ id: String(s.id || ''), texto: String(s.texto || ''), done: Boolean(s.done) }));
              changed = true;
            } else {
              rCard.subtareas.forEach(rSub => {
                const lSub = (local.subtareas || []).find(s => s.id === rSub.id);
                if (lSub && lSub.done !== rSub.done) {
                  lSub.done = rSub.done;
                  changed = true;
                }
              });
            }
          }
          if (typeof rCard.descripcion === 'string' && local.descripcion !== rCard.descripcion && !isFieldLocked(local.id, 'descripcion')) {
            local.descripcion = rCard.descripcion;
            changed = true;
          }
          if (rCard.titulo && local.titulo !== rCard.titulo && !isFieldLocked(local.id, 'titulo')) {
            local.titulo = rCard.titulo;
            changed = true;
          }
          if (typeof rCard.notas === 'string' && (local.notas || '') !== rCard.notas && !isFieldLocked(local.id, 'notas')) {
            local.notas = rCard.notas;
            changed = true;
          }
          if (typeof rCard.sede === 'string' && (local.sede || '') !== rCard.sede) {
            local.sede = rCard.sede;
            changed = true;
          }
          if (rCard.tipo && local.tipo !== rCard.tipo) {
            local.tipo = rCard.tipo;
            changed = true;
          }
          if (Array.isArray(rCard.mediaLinks) && JSON.stringify(rCard.mediaLinks) !== JSON.stringify(local.mediaLinks || [])) {
            local.mediaLinks = rCard.mediaLinks.map(m => ({ label: String(m.label || ''), url: String(m.url || '') }));
            changed = true;
          }
        } else {
          const cc = cleanCard(rCard);
          if (cc) { state.contenidos.push(cc); changed = true; }
        }
      });

      // 2. Si alguna tarjeta local fue marcada en eliminadas en Firestore, eliminarla localmente
      const beforeFilter = state.contenidos.length;
      state.contenidos = state.contenidos.filter(c => !eliminadasSet.has(c.id));
      if (state.contenidos.length !== beforeFilter) changed = true;

      // Mantener el orden canónico dictado por Firestore
      const indexMap = new Map();
      orden.forEach((id, i) => indexMap.set(id, i));
      state.contenidos.sort((a, b) => {
        const ia = indexMap.has(a.id) ? indexMap.get(a.id) : 9999;
        const ib = indexMap.has(b.id) ? indexMap.get(b.id) : 9999;
        return ia - ib;
      });

      // 3. Tarjetas locales que falten en remoto: subirlas con tarjetas.<id>, salvo que su id esté en eliminadas
      state.contenidos.forEach(localCard => {
        if (!remoteTarjetas[localCard.id] && !eliminadasSet.has(localCard.id)) {
          syncCardToFirestore(localCard.id);
        }
      });

      if (changed) {
        renderCards();
        saveStateLocalOnly();
        if (currentDrawerCardId) {
          const curr = state.contenidos.find(c => c.id === currentDrawerCardId);
          if (curr) updateDrawerContent(curr);
        }
      }
    }

    let lastLocalActualizado = null;

    function getLocalCounts() {
      let todo = 0, grabando = 0, listo = 0;
      state.contenidos.forEach(c => {
        if (c.estado === 'grabando') grabando++;
        else if (c.estado === 'listo') listo++;
        else todo++;
      });
      return { todo, grabando, listo };
    }

    function syncCardToFirestore(cardId) {
      if (!prodDocRef) return;
      const card = state.contenidos.find(c => c.id === cardId);
      if (!card) return;
      const clean = cleanCard(card);
      const counts = getLocalCounts();
      const nowIso = new Date().toISOString();
      lastLocalActualizado = nowIso;
      const updateData = {
        ['tarjetas.' + cardId]: clean,
        todo: counts.todo,
        grabando: counts.grabando,
        listo: counts.listo,
        actualizado: nowIso
      };
      prodDocRef.update(updateData).catch(err => {
        console.warn('Sync tarjeta en cola/offline:', err);
      });
    }

    function syncOrderToFirestore(cardIdMover) {
      if (!prodDocRef) return;
      const orden = state.contenidos.map(c => c.id);
      const counts = getLocalCounts();
      const nowIso = new Date().toISOString();
      lastLocalActualizado = nowIso;
      const updateData = {
        orden: orden,
        todo: counts.todo,
        grabando: counts.grabando,
        listo: counts.listo,
        actualizado: nowIso
      };
      if (cardIdMover) {
        const card = state.contenidos.find(c => c.id === cardIdMover);
        if (card) updateData['tarjetas.' + cardIdMover] = cleanCard(card);
      }
      prodDocRef.update(updateData).catch(err => {
        console.warn('Sync orden en cola/offline:', err);
      });
    }

    function recalcularContadoresRemotos() {
      // Unificado en escrituras únicas
    }

    function syncToFirestore(cardId, isFullSync) {
      if (cardId) {
        syncCardToFirestore(cardId);
      } else if (isFullSync) {
        syncOrderToFirestore();
      }
    }

    // ── LECTURA DEL GUION (v3) ─────────────────────────────────────────────
    // Solo presentación: el texto original nunca se modifica ni se pierde.
    const RE_ESCENA = /^((?:ESCENA|ESC\.?|SLIDE|PLANO|TOMA|PARTE)\s*\d+)\s*(?:[·•\-–—:|.]\s*)?(.*)$/i;
    const RE_TIEMPO = /^(\d+(?:[.,]\d+)?\s*[–\-]\s*\d+(?:[.,]\d+)?\s*s(?:eg)?\.?)\s*(?:[·•\-–—:|]\s*)?(.*)$/i;
    const RE_ETIQUETA = /^([A-Za-zÁÉÍÓÚÑÜáéíóúñü][A-Za-zÁÉÍÓÚÑÜáéíóúñü0-9 /().]{0,27}):\s+(\S.*)$/;
    const TONO_ETIQUETA = {
      'visual': 'cyan', 'plano': 'cyan', 'toma': 'cyan', 'imagen': 'cyan', 'video': 'cyan',
      'voz': 'orange', 'voz en off': 'orange', 'audio': 'orange', 'diálogo': 'orange', 'dialogo': 'orange', 'locución': 'orange', 'locucion': 'orange',
      'texto en pantalla': 'green', 'texto': 'green', 'copy': 'green', 'cta': 'green'
    };

    function esEncabezadoMayus(line) {
      const letras = line.replace(/[^A-Za-zÁÉÍÓÚÑÜáéíóúñü]/g, '');
      return letras.length >= 4 && line.length <= 64 && letras === letras.toUpperCase() && !/[.?!]$/.test(line);
    }

    function analizarGuion(texto) {
      const lines = String(texto || '').replace(/\r\n?/g, '\n').split('\n');
      let html = '';
      let escenas = 0;
      let enEscena = false;
      let parrafo = [];
      const cerrarParrafo = () => {
        if (parrafo.length) {
          html += `<p class="sc-p">${parrafo.map(escapeHTML).join('<br>')}</p>`;
          parrafo = [];
        }
      };
      const cerrarEscena = () => {
        cerrarParrafo();
        if (enEscena) { html += '</div>'; enEscena = false; }
      };

      lines.forEach(raw => {
        const line = raw.trim();
        if (!line) { cerrarParrafo(); return; }
        const mEsc = line.match(RE_ESCENA);
        if (mEsc && line.length <= 90) {
          cerrarEscena();
          escenas++;
          let resto = (mEsc[2] || '').trim();
          let tiempo = '';
          const mT = resto.match(RE_TIEMPO);
          if (mT) { tiempo = mT[1]; resto = (mT[2] || '').trim(); }
          html += `<div class="sc"><div class="sc-head"><span class="sc-tag">${escapeHTML(mEsc[1].toUpperCase())}</span>` +
            (tiempo ? `<span class="sc-time">${escapeHTML(tiempo)}</span>` : '') +
            (resto ? `<span class="sc-head-rest">${escapeHTML(resto)}</span>` : '') + '</div>';
          enEscena = true;
          return;
        }
        const mEt = line.match(RE_ETIQUETA);
        if (mEt && mEt[1].trim().split(/\s+/).length <= 4) {
          cerrarParrafo();
          const etiqueta = mEt[1].trim();
          const tono = TONO_ETIQUETA[etiqueta.toLowerCase()] || 'neutral';
          html += `<div class="sc-line"><span class="sc-label sc-${tono}">${escapeHTML(etiqueta)}</span><span class="sc-val">${escapeHTML(mEt[2])}</span></div>`;
          return;
        }
        if (esEncabezadoMayus(line)) {
          cerrarParrafo();
          html += `<div class="sc-sub">${escapeHTML(line)}</div>`;
          return;
        }
        parrafo.push(line);
      });
      cerrarEscena();
      return { html, escenas };
    }

    // Hora de pauta ("Pauta: 02/11 · 2:00 pm") y "Sube a Ads: DD/MM" escritas en la descripción
    function extraerPauta(texto) {
      const m = String(texto || '').match(/^\s*Pauta:\s*(.+)$/im);
      if (!m) return '';
      const partes = m[1].split('·').map(x => x.trim()).filter(Boolean);
      return partes.length > 1 ? partes[partes.length - 1] : partes[0] || '';
    }
    function esAds(c) {
      return c.ads === true || /^\s*ADS\s*[·•\-–—:|]/i.test(c.titulo || '') || /(^|\s)ADS(\s|$)/.test(c.titulo || '');
    }
    function tituloVisible(c) {
      return String(c.titulo || '').replace(/^\s*ADS\s*[·•\-–—:|]\s*/i, '');
    }
    function vistaPreviaGuion(texto) {
      return String(texto || '').split('\n')
        .map(l => l.trim())
        .filter(l => l && !/^pauta:/i.test(l) && !(RE_ESCENA.test(l) && l.length <= 90))
        .join(' · ');
    }

    // ── RENDER DE TARJETAS KANBAN (v3 - DIFERENCIAL KEYED) ─────────────────
    function getCardInnerHtml(c, index) {
      const tipoCfg = TIPOS[c.tipo] || TIPOS['otro'];
      const total = c.subtareas ? c.subtareas.length : 0;
      const done = c.subtareas ? c.subtareas.filter(s => s.done).length : 0;
      const pct = total ? Math.round((done / total) * 100) : 0;
      const refs = c.mediaLinks ? c.mediaLinks.length : 0;
      const seqNum = String(index + 1).padStart(2, '0');
      const hora = extraerPauta(c.descripcion);
      const escenas = analizarGuion(c.descripcion).escenas;
      const preview = vistaPreviaGuion(c.descripcion);
      const nota = String(c.notas || '').trim();

      const estadoHtml = c.estado === 'grabando'
        ? `<span class="pc-state pc-state-rec"><span class="pc-rec-dot"></span>Grabando</span>`
        : (c.estado === 'listo' ? `<span class="pc-state pc-state-ok"><svg class="ico"><use href="#i-check"></use></svg>Listo</span>` : '');

      let meta = '';
      if (hora) meta += `<span class="pc-meta"><svg class="ico"><use href="#i-clock"></use></svg>${escapeHTML(hora)}</span>`;
      if (escenas) meta += `<span class="pc-meta"><svg class="ico"><use href="#i-clapperboard"></use></svg>${escenas} escena${escenas > 1 ? 's' : ''}</span>`;
      if (refs) meta += `<span class="pc-meta" title="${refs} referencia(s)"><svg class="ico"><use href="#i-link"></use></svg>${refs}</span>`;
      if (total) meta += `<span class="pc-meta pc-progress" title="${done} de ${total} pasos"><svg class="ico"><use href="#i-list-checks"></use></svg>${done}/${total}<span class="pc-bar"><span style="width:${pct}%"></span></span></span>`;

      return `
        <div class="card-top pc-top">
          <span class="pc-num">${seqNum}</span>
          <span class="card-type-badge pc-type" style="background:${tipoCfg.bg}; color:${tipoCfg.color}; border:1px solid ${tipoCfg.border}">${escapeHTML(tipoCfg.label)}</span>
          ${esAds(c) ? '<span class="pc-chip pc-chip-ads">ADS</span>' : ''}
          ${c.sede && c.sede.trim() ? `<span class="pc-chip"><svg class="ico"><use href="#i-map-pin"></use></svg>${escapeHTML(c.sede)}</span>` : ''}
          <span class="pc-spacer"></span>
          ${estadoHtml}
          <div class="card-actions">
            <button class="btn-card-action" onclick="toggleCardMenu(event, '${escapeHTML(c.id)}')" title="Opciones" aria-label="Opciones">
              <svg class="ico"><use href="#i-more-horizontal"></use></svg>
            </button>
            <div class="card-popover-menu" id="menu-${escapeHTML(c.id)}">
              <button class="popover-item" onclick="openDrawer('${escapeHTML(c.id)}')">
                <svg class="ico"><use href="#i-maximize-2"></use></svg> Abrir ficha
              </button>
              <button class="popover-item" onclick="openModal('${escapeHTML(c.id)}')">
                <svg class="ico"><use href="#i-sliders-horizontal"></use></svg> Editar todo
              </button>
              <div class="popover-divider"></div>
              ${c.estado !== 'todo' ? `
                <button class="popover-item" onclick="quickMoveCard('${escapeHTML(c.id)}', 'todo')">
                  <svg class="ico"><use href="#i-circle-dashed"></use></svg> Mover a Por hacer
                </button>` : ''}
              ${c.estado !== 'grabando' ? `
                <button class="popover-item" onclick="quickMoveCard('${escapeHTML(c.id)}', 'grabando')">
                  <svg class="ico" style="color:var(--nexo-orange);"><use href="#i-video"></use></svg> Mover a Grabando
                </button>` : ''}
              ${c.estado !== 'listo' ? `
                <button class="popover-item" onclick="quickMoveCard('${escapeHTML(c.id)}', 'listo')">
                  <svg class="ico" style="color:var(--nexo-green);"><use href="#i-check-circle-2"></use></svg> Mover a Listo
                </button>` : ''}
              <div class="popover-divider"></div>
              <button class="popover-item danger" onclick="deleteCard('${escapeHTML(c.id)}')">
                <svg class="ico"><use href="#i-trash-2"></use></svg> Eliminar
              </button>
            </div>
          </div>
        </div>
        <div class="card-title pc-title">${escapeHTML(tituloVisible(c))}</div>
        ${preview ? `<div class="card-desc-preview pc-preview">${escapeHTML(preview)}</div>` : ''}
        ${nota ? `<div class="pc-note"><svg class="ico"><use href="#i-notebook-pen"></use></svg><span>${escapeHTML(nota)}</span></div>` : ''}
        <div class="card-bottom-row pc-foot">
          <div class="pc-metas">${meta}</div>
          <div class="card-drag-indicator" title="Arrastrar para mover"><svg class="ico"><use href="#i-grip-vertical"></use></svg></div>
        </div>
      `;
    }

    function getCardSignature(c, index) {
      const doneCount = (c.subtareas || []).filter(s => s.done).length;
      const totalCount = (c.subtareas || []).length;
      const refsCount = (c.mediaLinks || []).length;
      return [
        index,
        c.id,
        c.estado,
        c.titulo,
        c.tipo,
        c.sede || '',
        c.notas || '',
        c.descripcion || '',
        doneCount,
        totalCount,
        refsCount,
        c.id === currentDrawerCardId
      ].join('||');
    }

    function createCardElement(c, index) {
      const el = document.createElement('article');
      el.className = 'card pc' + (c.id === currentDrawerCardId ? ' is-active-drawer' : '');
      el.dataset.id = escapeHTML(c.id);
      el.dataset.cardStatus = escapeHTML(c.estado || 'todo');
      el.dataset.signature = getCardSignature(c, index);
      el.tabIndex = 0;
      el.setAttribute('role', 'button');
      el.setAttribute('aria-label', 'Abrir ' + tituloVisible(c));
      el.innerHTML = getCardInnerHtml(c, index);

      // Clic o Enter para abrir la ficha (distinguiendo de arrastre)
      el.addEventListener('click', (e) => {
        if (isDragging) return;
        if (e.target.closest('.card-actions') || e.target.closest('.card-popover-menu')) return;
        openDrawer(c.id);
      });
      el.addEventListener('keydown', (e) => {
        if ((e.key === 'Enter' || e.key === ' ') && e.target === el) {
          e.preventDefault();
          openDrawer(c.id);
        }
      });

      return el;
    }

    function toggleCardMenu(e, cardId) {
      e.stopPropagation();
      const menu = document.getElementById('menu-' + cardId);
      if (!menu) return;
      const isOpen = menu.classList.contains('show');
      closeAllCardMenus();
      if (!isOpen) {
        menu.classList.add('show');
        currentActiveMenuId = cardId;
      }
    }

    function closeAllCardMenus() {
      document.querySelectorAll('.card-popover-menu.show').forEach(m => m.classList.remove('show'));
      currentActiveMenuId = null;
    }

    document.addEventListener('click', (e) => {
      if (!e.target.closest('.card-actions')) closeAllCardMenus();
    });

    function quickMoveCard(cardId, newStatus) {
      closeAllCardMenus();
      const card = state.contenidos.find(c => c.id === cardId);
      if (!card || card.estado === newStatus) return;
      card.estado = newStatus;
      if (newStatus === 'listo') card.subtareas.forEach(s => s.done = true);
      else if (newStatus === 'todo') card.subtareas.forEach(s => s.done = false);
      updateUI();
      syncCardToFirestore(cardId);
      if (currentDrawerCardId === cardId) updateDrawerContent(card);
    }
    window.quickMoveCard = quickMoveCard;
    window.moverEstado = quickMoveCard;

    function openModalWithStatus(status) {
      modalPreselectedStatus = status || 'todo';
      openModal();
    }

    const emptyConfig = {
      todo: {
        icon: 'film',
        title: 'Sin contenidos pendientes',
        sub: 'Crea nuevas ideas o guiones listos para pre-producción',
        status: 'todo'
      },
      grabando: {
        icon: 'video',
        title: 'Nada en rodaje actualmente',
        sub: 'Arrastra tarjetas aquí al iniciar la grabación en set',
        status: 'grabando'
      },
      listo: {
        icon: 'check-circle-2',
        title: 'Aún no hay piezas listas',
        sub: 'Los contenidos grabados y aprobados aparecerán aquí',
        status: 'listo'
      }
    };

    function getOrCreateEmptyState(col, status) {
      let empty = col.querySelector(':scope > .k-empty-state');
      if (!empty) {
        const conf = emptyConfig[status];
        empty = document.createElement('div');
        empty.className = 'k-empty-state';
        empty.id = 'empty-' + status;
        empty.innerHTML = `
          <div class="k-empty-icon-wrap"><svg class="ico"><use href="#i-${conf.icon}"></use></svg></div>
          <div class="k-empty-title">${conf.title}</div>
          <div class="k-empty-sub">${conf.sub}</div>
          <button class="k-empty-action-btn" onclick="openModalWithStatus('${conf.status}')">
            <svg class="ico"><use href="#i-plus"></use></svg> Crear tarjeta
          </button>
        `;
        col.appendChild(empty);
      }
      return empty;
    }

    function renderSkeletons() {
      const cols = ['col-todo', 'col-grabando', 'col-listo'];
      cols.forEach(colId => {
        const col = document.getElementById(colId);
        if (!col) return;
        col.querySelectorAll('.card, .k-empty-state').forEach(el => el.remove());
        for (let i = 0; i < 3; i++) {
          const sk = document.createElement('div');
          sk.className = 'card-skeleton';
          sk.innerHTML = `
            <div class="card-skeleton-line short"></div>
            <div class="card-skeleton-line title"></div>
            <div class="card-skeleton-line full"></div>
          `;
          col.appendChild(sk);
        }
      });
      ['count-todo', 'count-grabando', 'count-listo', 'm-count-todo', 'm-count-grabando', 'm-count-listo'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.textContent = '…';
      });
      const countEl = document.getElementById('hp-count');
      if (countEl) countEl.textContent = '…';
    }

    let hasLocalSnapshot = false;
    let isFirstSyncDone = false;
    let firstSyncTimeout = null;

    function finishFirstSync() {
      if (isFirstSyncDone) return;
      isFirstSyncDone = true;
      if (firstSyncTimeout) { clearTimeout(firstSyncTimeout); firstSyncTimeout = null; }
      document.querySelectorAll('.card-skeleton').forEach(s => s.remove());
      renderCards();
      setTimeout(function() {
        document.body.classList.remove('is-entering');
      }, 150);
    }

    function renderCards() {
      if (!isFirstSyncDone && !hasLocalSnapshot) {
        return; // Esperar primer snapshot o timeout mostrando skeletons
      }
      const cols = {
        todo: document.getElementById('col-todo'),
        grabando: document.getElementById('col-grabando'),
        listo: document.getElementById('col-listo')
      };
      if (!cols.todo || !cols.grabando || !cols.listo) return;

      // Retirar skeletons residuales
      document.querySelectorAll('.card-skeleton').forEach(s => s.remove());

      const counts = { todo: 0, grabando: 0, listo: 0 };
      const validIdsInFilter = new Set();
      const cardsToRender = [];

      state.contenidos.forEach((c, idx) => {
        if (searchQuery) {
          const text = (c.titulo + ' ' + (c.descripcion || '')).toLowerCase();
          const subText = c.subtareas ? c.subtareas.map(s => s.texto).join(' ').toLowerCase() : '';
          const refText = c.mediaLinks ? c.mediaLinks.map(r => (r.label + ' ' + r.url)).join(' ').toLowerCase() : '';
          if (!text.includes(searchQuery) && !subText.includes(searchQuery) && !refText.includes(searchQuery)) return;
        }
        if (!c.estado) c.estado = 'todo';
        if (!c.subtareas) c.subtareas = [];
        if (!c.mediaLinks) c.mediaLinks = [];
        counts[c.estado] = (counts[c.estado] || 0) + 1;
        validIdsInFilter.add(c.id);
        cardsToRender.push({ card: c, index: idx });
      });

      const byCol = { todo: [], grabando: [], listo: [] };
      cardsToRender.forEach(item => {
        if (byCol[item.card.estado]) byCol[item.card.estado].push(item);
      });

      ['todo', 'grabando', 'listo'].forEach(status => {
        const col = cols[status];
        const items = byCol[status];
        const emptyEl = getOrCreateEmptyState(col, status);

        for (let i = 0; i < items.length; i++) {
          const { card, index } = items[i];
          let cardEl = document.querySelector(`.card[data-id="${card.id}"]`);
          const sig = getCardSignature(card, index);

          if (cardEl) {
            if (cardEl.dataset.signature !== sig) {
              cardEl.className = 'card pc' + (card.id === currentDrawerCardId ? ' is-active-drawer' : '');
              cardEl.dataset.cardStatus = card.estado;
              cardEl.setAttribute('aria-label', 'Abrir ' + tituloVisible(card));
              cardEl.innerHTML = getCardInnerHtml(card, index);
              cardEl.dataset.signature = sig;
            }
            const currentChildAtPos = col.children[i];
            if (cardEl !== currentChildAtPos) {
              col.insertBefore(cardEl, currentChildAtPos || emptyEl);
            }
          } else {
            cardEl = createCardElement(card, index);
            const currentChildAtPos = col.children[i];
            col.insertBefore(cardEl, currentChildAtPos || emptyEl);
          }
        }

        emptyEl.style.display = items.length === 0 ? 'flex' : 'none';
      });

      // Eliminar del DOM las tarjetas que ya no existan o no coincidan con el filtro
      document.querySelectorAll('.kanban-column .card, .k-col-cards .card').forEach(el => {
        if (!validIdsInFilter.has(el.dataset.id)) {
          el.remove();
        }
      });

      // Actualizar contadores en encabezados y pestañas móviles
      document.getElementById('count-todo').textContent = counts.todo;
      document.getElementById('count-grabando').textContent = counts.grabando;
      document.getElementById('count-listo').textContent = counts.listo;

      const mTodo = document.getElementById('m-count-todo');
      const mGrabando = document.getElementById('m-count-grabando');
      const mListo = document.getElementById('m-count-listo');
      if (mTodo) mTodo.textContent = counts.todo;
      if (mGrabando) mGrabando.textContent = counts.grabando;
      if (mListo) mListo.textContent = counts.listo;

      // Actualizar progreso global
      const total = state.contenidos.length;
      const pct = total ? Math.round((counts.listo / total) * 100) : 0;
      const countEl = document.getElementById('hp-count');
      const fillEl = document.getElementById('hp-fill');
      if (countEl) countEl.textContent = `${counts.listo} de ${total}`;
      if (fillEl) fillEl.style.width = `${pct}%`;
    }

    function updateUI() {
      renderCards();
      saveState();
    }

    // ── FICHA CENTRADA DE LA TARJETA (v3) ───────────────────────────────
    // Reemplaza al panel lateral. Mantiene openDrawer / closeDrawer / updateDrawerContent
    // y los id drawer-* para no romper la lógica ni los enlaces #card-<id>.
    let sheetCloseTimer = null;
    let sheetReturnFocus = null;
    let scriptEditMode = false;
    let checklistEditMode = false;
    const pendingEdits = {};            // 'cardId|campo' -> { timer, run }
    let remoteCardIds = new Set();      // tarjetas que ya existen en Firestore
    let remoteTarjetasCache = {};       // última versión remota conocida de cada tarjeta

    const $id = (x) => document.getElementById(x);

    function autoGrow(el) {
      if (!el) return;
      el.style.height = 'auto';
      el.style.height = el.scrollHeight + 'px';
    }

    function sheetOrder() {
      const ids = Array.from(document.querySelectorAll('#col-todo .card, #col-grabando .card, #col-listo .card'))
        .map(e => e.dataset.id).filter(Boolean);
      if (currentDrawerCardId && !ids.includes(currentDrawerCardId)) return state.contenidos.map(c => c.id);
      return ids.length ? ids : state.contenidos.map(c => c.id);
    }

    // ── Guardado por campo con espera corta (escritura en tiempo real) ──
    function hasPending(cardId, campo) {
      return Boolean(pendingEdits[cardId + '|' + campo]);
    }
    function scheduleFieldSave(cardId, campo, getter, delay) {
      const key = cardId + '|' + campo;
      if (pendingEdits[key]) clearTimeout(pendingEdits[key].timer);
      const run = () => {
        if (pendingEdits[key]) clearTimeout(pendingEdits[key].timer);
        delete pendingEdits[key];
        commitField(cardId, campo, getter());
      };
      pendingEdits[key] = { timer: setTimeout(run, delay), run };
    }
    function flushPendingEdits(cardId, campo) {
      Object.keys(pendingEdits).forEach(key => {
        const [kId, kCampo] = key.split('|');
        if ((cardId && kId !== cardId) || (campo && kCampo !== campo)) return;
        const p = pendingEdits[key];
        if (p) p.run();
      });
    }
    function campoEnFoco() {
      const ae = document.activeElement;
      if (!ae) return '';
      if (ae.id === 'drawer-title') return 'titulo';
      if (ae.id === 'ps-notes') return 'notas';
      if (ae.id === 'ps-script-editor') return 'descripcion';
      const list = $id('drawer-checklist');
      if (list && list.contains(ae) && ae.tagName === 'INPUT') return 'subtareas';
      return '';
    }
    function isFieldLocked(cardId, campo) {
      return hasPending(cardId, campo) || (currentDrawerCardId === cardId && campoEnFoco() === campo);
    }

    function commitField(cardId, campo, valor) {
      const card = state.contenidos.find(c => c.id === cardId);
      if (!card) return;
      if (campo === 'titulo') {
        valor = String(valor || '').replace(/\s+/g, ' ').trim();
        if (!valor) return; // el título es obligatorio: se conserva el anterior
      }
      const remoto = remoteTarjetasCache[cardId];
      const igualLocal = card[campo] === valor;
      const igualRemoto = !prodDocRef || (remoto && remoto[campo] === valor);
      if (igualLocal && igualRemoto) {
        if (campo === 'notas') setNotesStatus('saved');
        return;
      }
      card[campo] = valor;
      saveState();
      renderCards();
      syncCardFieldsToFirestore(cardId, [campo]);
      if (campo === 'notas') setNotesStatus('saved');
    }

    // Escribe solo los campos indicados (tarjetas.<id>.<campo>) para no pisar
    // cambios que otro teléfono hizo en otros campos de la misma tarjeta.
    function syncCardFieldsToFirestore(cardId, campos) {
      if (!prodDocRef) return;
      if (!remoteCardIds.has(cardId)) { syncCardToFirestore(cardId); return; }
      const card = state.contenidos.find(c => c.id === cardId);
      if (!card) return;
      const clean = cleanCard(card);
      const counts = getLocalCounts();
      const nowIso = new Date().toISOString();
      lastLocalActualizado = nowIso;
      const updateData = {
        todo: counts.todo,
        grabando: counts.grabando,
        listo: counts.listo,
        actualizado: nowIso
      };
      campos.forEach(campo => { updateData['tarjetas.' + cardId + '.' + campo] = clean[campo]; });
      prodDocRef.update(updateData).catch(err => {
        console.warn('Sync de campo en cola/offline:', err);
      });
    }

    function setNotesStatus(kind) {
      const el = $id('ps-notes-status');
      if (!el) return;
      el.classList.remove('is-pending', 'is-saved', 'is-local');
      if (kind === 'pending') {
        el.textContent = 'Escribiendo…';
        el.classList.add('is-pending');
      } else if (kind === 'saved') {
        if (!prodDocRef) { el.textContent = '✓ Guardado en este dispositivo'; el.classList.add('is-local'); }
        else if (!isFirestoreOnline || !navigator.onLine) { el.textContent = 'Guardado en este teléfono · se sube al reconectar'; el.classList.add('is-local'); }
        else { el.textContent = '✓ Guardado en vivo'; el.classList.add('is-saved'); }
      } else {
        el.textContent = prodDocRef ? 'Se ve en todos los teléfonos' : '';
      }
    }

    // ── Abrir / cerrar ──
    function openDrawer(cardId) {
      closeAllCardMenus();
      const card = state.contenidos.find(c => c.id === cardId);
      if (!card) return;
      const sheet = $id('side-drawer');
      const back = $id('drawer-backdrop');
      const wasOpen = Boolean(currentDrawerCardId);
      if (wasOpen && currentDrawerCardId !== cardId) flushPendingEdits(currentDrawerCardId);

      currentDrawerCardId = cardId;
      scriptEditMode = false;
      checklistEditMode = false;

      document.querySelectorAll('.card').forEach(el => {
        el.classList.toggle('is-active-drawer', el.dataset.id === cardId);
      });

      clearTimeout(sheetCloseTimer);
      sheet.classList.remove('is-closing');
      back.classList.remove('is-closing');
      if (!wasOpen) {
        sheetReturnFocus = document.activeElement;
        sheet.classList.add('show');
        back.classList.add('show');
        sheet.setAttribute('aria-hidden', 'false');
        document.body.classList.add('ps-open');
      }

      updateDrawerContent(card, true);
      setNotesStatus('');
      ['.ps-body', '.ps-main', '.ps-side'].forEach(sel => {
        const n = sheet.querySelector(sel);
        if (n) n.scrollTop = 0;
      });
      if (!wasOpen) {
        requestAnimationFrame(() => {
          const panel = sheet.querySelector('.ps-panel');
          if (panel) panel.focus({ preventScroll: true });
        });
      }
      try { history.replaceState(null, '', '#card-' + cardId); } catch (e) {}
    }

    function closeDrawer() {
      const sheet = $id('side-drawer');
      const back = $id('drawer-backdrop');
      if (!sheet || !back) return;
      if (!currentDrawerCardId) return;
      flushPendingEdits();
      const id = currentDrawerCardId;
      currentDrawerCardId = null;
      scriptEditMode = false;
      checklistEditMode = false;

      sheet.classList.add('is-closing');
      back.classList.add('is-closing');
      sheet.classList.remove('show');
      back.classList.remove('show');
      sheet.setAttribute('aria-hidden', 'true');
      document.body.classList.remove('ps-open');
      clearTimeout(sheetCloseTimer);
      sheetCloseTimer = setTimeout(() => {
        sheet.classList.remove('is-closing');
        back.classList.remove('is-closing');
      }, 280);

      document.querySelectorAll('.card.is-active-drawer').forEach(c => c.classList.remove('is-active-drawer'));
      try {
        if (window.location.hash.indexOf('#card-') === 0) history.replaceState(null, '', window.location.pathname + window.location.search);
      } catch (e) {}

      const back2 = (sheetReturnFocus && document.contains(sheetReturnFocus) && sheetReturnFocus !== document.body)
        ? sheetReturnFocus
        : document.querySelector('.card[data-id="' + id + '"]');
      sheetReturnFocus = null;
      if (back2 && back2.focus) {
        try { back2.focus({ preventScroll: true }); } catch (e) {}
      }
    }

    function navigateSheet(dir) {
      if (!currentDrawerCardId) return;
      const orden = sheetOrder();
      if (orden.length < 2) return;
      const i = orden.indexOf(currentDrawerCardId);
      const next = orden[((i < 0 ? 0 : i) + dir + orden.length) % orden.length];
      if (next) openDrawer(next);
    }

    // ── Contenido de la ficha ──
    function updateDrawerContent(card, fresh) {
      if (!card) return;
      const sheet = $id('side-drawer');
      if (sheet) sheet.dataset.status = card.estado || 'todo';

      const idx = state.contenidos.indexOf(card);
      const num = $id('ps-num');
      if (num) num.textContent = String((idx < 0 ? 0 : idx) + 1).padStart(2, '0');

      const tipoCfg = TIPOS[card.tipo] || TIPOS['otro'];
      const badge = $id('drawer-type-badge');
      if (badge) {
        badge.textContent = tipoCfg.label;
        badge.style.background = tipoCfg.bg;
        badge.style.color = tipoCfg.color;
        badge.style.border = '1px solid ' + tipoCfg.border;
      }
      const ads = $id('ps-ads');
      if (ads) ads.style.display = esAds(card) ? 'inline-flex' : 'none';
      const hora = $id('ps-hora');
      const horaTxt = extraerPauta(card.descripcion);
      if (hora) {
        hora.innerHTML = horaTxt ? `<svg class="ico"><use href="#i-clock"></use></svg>${escapeHTML(horaTxt)}` : '';
        hora.style.display = horaTxt ? 'inline-flex' : 'none';
      }
      const sedePill = $id('drawer-sede-pill');
      if (sedePill) {
        if (card.sede && card.sede.trim()) {
          sedePill.innerHTML = `<svg class="ico"><use href="#i-map-pin"></use></svg>${escapeHTML(card.sede)}`;
          sedePill.style.display = 'inline-flex';
        } else {
          sedePill.style.display = 'none';
        }
      }

      const orden = sheetOrder();
      const pos = orden.indexOf(card.id);
      const posEl = $id('ps-pos');
      if (posEl) posEl.textContent = pos >= 0 ? `${pos + 1} de ${orden.length}` : '';
      ['ps-prev', 'ps-next'].forEach(b => { const n = $id(b); if (n) n.disabled = orden.length < 2; });

      // Título (no se pisa mientras se escribe)
      const t = $id('drawer-title');
      if (t && (fresh || (document.activeElement !== t && !hasPending(card.id, 'titulo')))) {
        t.value = card.titulo || '';
        autoGrow(t);
      }

      // Estado
      document.querySelectorAll('.status-seg-btn').forEach(btn => {
        const on = btn.dataset.status === card.estado;
        btn.classList.toggle('active', on);
        btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      });

      renderScriptSection(card, fresh);

      // Notas en vivo
      const n = $id('ps-notes');
      if (n && (fresh || (document.activeElement !== n && !hasPending(card.id, 'notas')))) {
        n.value = card.notas || '';
        autoGrow(n);
      }

      // Checklist (no se reconstruye mientras se edita un paso)
      const list = $id('drawer-checklist');
      const ae = document.activeElement;
      const editandoPaso = list && list.contains(ae) && ae.tagName === 'INPUT';
      if (fresh || !editandoPaso) renderChecklist(card);
      const subs = card.subtareas || [];
      const doneCount = subs.filter(s => s.done).length;
      const cc = $id('drawer-check-count');
      if (cc) cc.textContent = subs.length ? `${doneCount}/${subs.length}` : '';
      const fill = $id('ps-check-fill');
      if (fill) fill.style.width = (subs.length ? Math.round(doneCount / subs.length * 100) : 0) + '%';
      if (fill && fill.parentElement) fill.parentElement.style.display = subs.length ? '' : 'none';

      // Referencias
      const mediaSection = $id('drawer-media-section');
      const mediaGrid = $id('drawer-media-grid');
      if (mediaGrid) {
        mediaGrid.innerHTML = '';
        const links = card.mediaLinks || [];
        mediaSection.style.display = links.length ? 'flex' : 'none';
        links.forEach(l => {
          const a = document.createElement('a');
          a.className = 'ps-media-link';
          a.href = l.url;
          a.target = '_blank';
          a.rel = 'noopener noreferrer';
          let host = '';
          try { host = new URL(l.url).hostname.replace(/^www\./, ''); } catch (e) {}
          a.innerHTML = `
            <span class="ps-media-ico"><svg class="ico"><use href="#i-external-link"></use></svg></span>
            <span class="ps-media-txt"><b>${escapeHTML(l.label || 'Referencia')}</b><small>${escapeHTML(host || l.url)}</small></span>
            <svg class="ico ps-media-go"><use href="#i-arrow-up-right"></use></svg>`;
          mediaGrid.appendChild(a);
        });
      }

      // Botón de avance
      const nextLabel = $id('drawer-next-label');
      const advIcon = $id('ps-advance-icon');
      const adv = $id('btn-drawer-next-step');
      let icono = 'play';
      if (card.estado === 'todo') { nextLabel.textContent = 'Comenzar rodaje'; icono = 'play'; }
      else if (card.estado === 'grabando') { nextLabel.textContent = 'Marcar como listo'; icono = 'check'; }
      else { nextLabel.textContent = 'Reiniciar rodaje'; icono = 'rotate-ccw'; }
      if (adv) adv.dataset.next = card.estado === 'todo' ? 'grabando' : (card.estado === 'grabando' ? 'listo' : 'todo');
      if (advIcon) advIcon.innerHTML = `<svg class="ico"><use href="#i-${icono}"></use></svg>`;

      if (window.lucide) lucide.createIcons();
    }

    function renderScriptSection(card, fresh) {
      const view = $id('drawer-desc');
      const editor = $id('ps-script-editor');
      const empty = $id('ps-script-empty');
      const meta = $id('ps-script-meta');
      const btn = $id('btn-edit-script');
      if (!view || !editor) return;
      const texto = card.descripcion || '';
      const r = analizarGuion(texto);
      if (meta) meta.textContent = r.escenas ? `${r.escenas} escena${r.escenas > 1 ? 's' : ''}` : '';
      if (scriptEditMode) {
        view.style.display = 'none';
        empty.style.display = 'none';
        editor.style.display = 'block';
        if (fresh || (document.activeElement !== editor && !hasPending(card.id, 'descripcion'))) {
          editor.value = texto;
        }
        autoGrow(editor);
        if (btn) btn.innerHTML = '<svg class="ico"><use href="#i-check"></use></svg> <span>Listo</span>';
        if (btn) btn.classList.add('is-on');
      } else {
        editor.style.display = 'none';
        if (texto.trim()) {
          view.innerHTML = r.html;
          view.style.display = '';
          empty.style.display = 'none';
        } else {
          view.innerHTML = '';
          view.style.display = 'none';
          empty.style.display = 'flex';
        }
        if (btn) btn.innerHTML = '<svg class="ico"><use href="#i-pencil"></use></svg> <span>Editar</span>';
        if (btn) btn.classList.remove('is-on');
      }
    }

    function toggleScriptEdit(force) {
      const card = state.contenidos.find(c => c.id === currentDrawerCardId);
      if (!card) return;
      const next = (typeof force === 'boolean') ? force : !scriptEditMode;
      if (!next) flushPendingEdits(card.id, 'descripcion');
      scriptEditMode = next;
      renderScriptSection(card, true);
      if (window.lucide) lucide.createIcons();
      if (next) {
        const ed = $id('ps-script-editor');
        if (ed) { ed.focus({ preventScroll: true }); autoGrow(ed); }
      }
    }

    function renderChecklist(card) {
      const list = $id('drawer-checklist');
      const editBtn = $id('btn-edit-checklist');
      if (!list) return;
      list.innerHTML = '';
      list.classList.toggle('is-editing', checklistEditMode);
      const subs = card.subtareas || [];
      if (editBtn) {
        editBtn.style.display = subs.length ? 'inline-flex' : 'none';
        editBtn.innerHTML = checklistEditMode ? '<svg class="ico"><use href="#i-check"></use></svg> <span>Listo</span>' : '<svg class="ico"><use href="#i-pencil"></use></svg> <span>Editar</span>';
        editBtn.classList.toggle('is-on', checklistEditMode);
      }
      if (!subs.length) {
        const vacio = document.createElement('div');
        vacio.className = 'ps-check-empty';
        vacio.textContent = 'Sin pasos todavía. Agrega tomas o tareas aquí abajo.';
        list.appendChild(vacio);
        return;
      }
      subs.forEach(sub => {
        if (checklistEditMode) {
          const row = document.createElement('div');
          row.className = 'ps-check-row';
          const inp = document.createElement('input');
          inp.type = 'text';
          inp.className = 'ps-check-edit';
          inp.value = sub.texto;
          inp.setAttribute('aria-label', 'Editar paso');
          inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); inp.blur(); } });
          inp.addEventListener('change', () => renameSubtask(card.id, sub.id, inp.value));
          const del = document.createElement('button');
          del.type = 'button';
          del.className = 'ps-check-del';
          del.title = 'Quitar paso';
          del.setAttribute('aria-label', 'Quitar paso');
          del.innerHTML = '<svg class="ico"><use href="#i-x"></use></svg>';
          del.onclick = () => removeSubtask(card.id, sub.id);
          row.appendChild(inp);
          row.appendChild(del);
          list.appendChild(row);
        } else {
          const item = document.createElement('button');
          item.type = 'button';
          item.className = 'ps-check-item' + (sub.done ? ' done' : '');
          item.setAttribute('aria-pressed', sub.done ? 'true' : 'false');
          item.innerHTML = `<span class="ps-check-box"><svg class="ico"><use href="#i-check"></use></svg></span><span class="ps-check-text">${escapeHTML(sub.texto)}</span>`;
          item.onclick = () => toggleSubtask(card.id, sub.id);
          list.appendChild(item);
        }
      });
    }

    function toggleChecklistEdit() {
      const card = state.contenidos.find(c => c.id === currentDrawerCardId);
      if (!card) return;
      checklistEditMode = !checklistEditMode;
      renderChecklist(card);
      if (window.lucide) lucide.createIcons();
    }

    function guardarSubtareas(card) {
      saveState();
      renderCards();
      if (currentDrawerCardId === card.id) updateDrawerContent(card);
      syncCardFieldsToFirestore(card.id, ['subtareas']);
    }

    function addSubtaskFromSheet(e) {
      if (e) e.preventDefault();
      const card = state.contenidos.find(c => c.id === currentDrawerCardId);
      const inp = $id('ps-check-input');
      if (!card || !inp) return;
      const texto = inp.value.trim();
      if (!texto) return;
      if (!Array.isArray(card.subtareas)) card.subtareas = [];
      card.subtareas.push({ id: 'sub_' + Math.random().toString(36).substr(2, 7), texto, done: false });
      inp.value = '';
      guardarSubtareas(card);
      inp.focus({ preventScroll: true });
    }

    function renameSubtask(cardId, subId, texto) {
      const card = state.contenidos.find(c => c.id === cardId);
      if (!card) return;
      const sub = (card.subtareas || []).find(s => s.id === subId);
      if (!sub) return;
      const limpio = String(texto || '').trim();
      if (!limpio || limpio === sub.texto) return;
      sub.texto = limpio;
      guardarSubtareas(card);
    }

    function removeSubtask(cardId, subId) {
      const card = state.contenidos.find(c => c.id === cardId);
      if (!card) return;
      card.subtareas = (card.subtareas || []).filter(s => s.id !== subId);
      if (!card.subtareas.length) checklistEditMode = false;
      guardarSubtareas(card);
    }

    function setCardStatusFromDrawer(newStatus) {
      if (!currentDrawerCardId) return;
      quickMoveCard(currentDrawerCardId, newStatus);
    }

    function advanceCardFromDrawer() {
      if (!currentDrawerCardId) return;
      const card = state.contenidos.find(c => c.id === currentDrawerCardId);
      if (!card) return;
      if (card.estado === 'todo') quickMoveCard(card.id, 'grabando');
      else if (card.estado === 'grabando') quickMoveCard(card.id, 'listo');
      else quickMoveCard(card.id, 'todo');
    }

    function toggleSubtask(cardId, subId) {
      const card = state.contenidos.find(c => c.id === cardId);
      if (!card || !card.subtareas) return;
      const sub = card.subtareas.find(s => s.id === subId);
      if (!sub) return;
      sub.done = !sub.done;

      updateUI();
      syncCardToFirestore(cardId);
      if (currentDrawerCardId === cardId) updateDrawerContent(card);
    }

    function copyDrawerScript() {
      const card = state.contenidos.find(c => c.id === currentDrawerCardId);
      const editor = $id('ps-script-editor');
      const desc = scriptEditMode && editor ? editor.value : (card ? card.descripcion || '' : '');
      if (!desc) return;
      const btn = $id('btn-copy-script');
      const listo = () => {
        if (!btn) return;
        btn.innerHTML = `<svg class="ico"><use href="#i-check"></use></svg> <span>Copiado</span>`;
        btn.classList.add('is-ok');
        if (window.lucide) lucide.createIcons();
        setTimeout(() => {
          btn.innerHTML = `<svg class="ico"><use href="#i-copy"></use></svg> <span>Copiar</span>`;
          btn.classList.remove('is-ok');
          if (window.lucide) lucide.createIcons();
        }, 1800);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(desc).then(listo).catch(err => console.error('Error al copiar:', err));
      }
    }

    function editFromDrawer() {
      if (!currentDrawerCardId) return;
      const id = currentDrawerCardId;
      closeDrawer();
      openModal(id);
    }

    function deleteFromDrawer() {
      if (!currentDrawerCardId) return;
      const id = currentDrawerCardId;
      closeDrawer();
      deleteCard(id);
    }

    function isTypingTarget(el) {
      if (!el) return false;
      const tag = (el.tagName || '').toUpperCase();
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
    }

    // Enlaza los campos editables de la ficha (una sola vez)
    function setupSheet() {
      const t = $id('drawer-title');
      if (t) {
        t.addEventListener('input', () => {
          autoGrow(t);
          const id = currentDrawerCardId;
          if (id) scheduleFieldSave(id, 'titulo', () => t.value, 700);
        });
        t.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); t.blur(); } });
        t.addEventListener('blur', () => {
          const id = currentDrawerCardId;
          if (!id) return;
          flushPendingEdits(id, 'titulo');
          const card = state.contenidos.find(c => c.id === id);
          if (card && !t.value.trim()) { t.value = card.titulo || ''; autoGrow(t); }
        });
      }

      const n = $id('ps-notes');
      if (n) {
        n.addEventListener('input', () => {
          autoGrow(n);
          const id = currentDrawerCardId;
          if (!id) return;
          setNotesStatus('pending');
          scheduleFieldSave(id, 'notas', () => n.value, 600);
        });
        n.addEventListener('blur', () => { if (currentDrawerCardId) flushPendingEdits(currentDrawerCardId, 'notas'); });
      }

      const ed = $id('ps-script-editor');
      if (ed) {
        ed.addEventListener('input', () => {
          autoGrow(ed);
          const id = currentDrawerCardId;
          if (id) scheduleFieldSave(id, 'descripcion', () => ed.value, 800);
        });
        ed.addEventListener('blur', () => { if (currentDrawerCardId) flushPendingEdits(currentDrawerCardId, 'descripcion'); });
      }

      // Flechas para pasar de tarjeta cuando la ficha está abierta (sin animación: acción repetida)
      document.addEventListener('keydown', e => {
        if (!currentDrawerCardId || isTypingTarget(e.target)) return;
        const modal = $id('modal-card');
        if (modal && modal.classList.contains('show')) return;
        if (e.key === 'ArrowLeft') { e.preventDefault(); navigateSheet(-1); }
        else if (e.key === 'ArrowRight') { e.preventDefault(); navigateSheet(1); }
      });

      // Guardar lo pendiente si se cierra o se oculta la pestaña
      window.addEventListener('pagehide', () => flushPendingEdits());
      document.addEventListener('visibilitychange', () => { if (document.hidden) flushPendingEdits(); });
      window.addEventListener('resize', () => {
        ['drawer-title', 'ps-notes', 'ps-script-editor'].forEach(x => autoGrow($id(x)));
      });
    }

    // ── MODAL DE CREACIÓN / EDICIÓN ─────────────────────────────────────
    function openModal(cardId) {
      const modal = document.getElementById('modal-card');
      const title = document.getElementById('modal-card-title');
      const form = document.getElementById('form-card');
      form.reset();

      if (cardId) {
        const c = state.contenidos.find(x => x.id === cardId);
        if (!c) return;
        title.textContent = 'Editar tarjeta de producción';
        document.getElementById('card-id').value = c.id;
        document.getElementById('card-title').value = c.titulo || '';
        document.getElementById('card-type').value = c.tipo || 'reel';
        document.getElementById('card-state').value = c.estado || 'todo';
        document.getElementById('card-sede').value = c.sede || '';
        document.getElementById('card-desc').value = c.descripcion || '';

        const subs = (c.subtareas || []).map(s => s.texto).join('\n');
        document.getElementById('card-subtasks-input').value = subs;

        const links = (c.mediaLinks || []).map(l => l.label ? `${l.label} | ${l.url}` : l.url).join('\n');
        document.getElementById('card-links-input').value = links;
      } else {
        title.textContent = 'Nueva tarjeta de producción';
        document.getElementById('card-id').value = '';
        document.getElementById('card-state').value = modalPreselectedStatus || 'todo';
      }

      modal.classList.add('show');
      setTimeout(() => document.getElementById('card-title').focus(), 50);
    }

    function closeModal() {
      document.getElementById('modal-card').classList.remove('show');
    }

    function handleModalOverlayClick(e) {
      if (e.target.id === 'modal-card') closeModal();
    }

    function handleFormSubmit(e) {
      e.preventDefault();
      const id = document.getElementById('card-id').value;
      const titulo = document.getElementById('card-title').value.trim();
      if (!titulo) return;

      const tipo = document.getElementById('card-type').value;
      const estado = document.getElementById('card-state').value;
      const sede = document.getElementById('card-sede').value.trim();
      const descripcion = document.getElementById('card-desc').value.trim();

      // Subtareas
      const subLines = document.getElementById('card-subtasks-input').value.split('\n').map(s => s.trim()).filter(Boolean);
      let subtareas = [];
      if (id) {
        const prev = state.contenidos.find(x => x.id === id);
        const prevSubs = prev ? (prev.subtareas || []) : [];
        subtareas = subLines.map((line, idx) => {
          const matched = prevSubs.find(s => s.texto === line);
          return {
            id: matched ? matched.id : 'sub_' + Math.random().toString(36).substr(2, 7),
            texto: line,
            done: matched ? matched.done : false
          };
        });
      } else {
        subtareas = subLines.map(line => ({
          id: 'sub_' + Math.random().toString(36).substr(2, 7),
          texto: line,
          done: false
        }));
      }

      // Enlaces multimedia
      const linkLines = document.getElementById('card-links-input').value.split('\n').map(s => s.trim()).filter(Boolean);
      const mediaLinks = linkLines.map(l => {
        if (l.includes('|')) {
          const parts = l.split('|');
          return { label: parts[0].trim(), url: parts[1].trim() };
        }
        return { label: 'Referencia', url: l };
      });

      if (id) {
        const card = state.contenidos.find(x => x.id === id);
        if (card) {
          card.titulo = titulo;
          card.tipo = tipo;
          card.estado = estado;
          card.sede = sede;
          card.descripcion = descripcion;
          card.subtareas = subtareas;
          card.mediaLinks = mediaLinks;
        }
        closeModal();
        updateUI();
        syncCardToFirestore(id);
      } else {
        const newCard = {
          id: 'c_' + Math.random().toString(36).substr(2, 8),
          titulo,
          tipo,
          estado,
          sede,
          descripcion,
          subtareas,
          mediaLinks
        };
        state.contenidos.unshift(newCard);
        closeModal();
        updateUI();
        syncCardToFirestore(newCard.id);
        syncOrderToFirestore();
      }
    }

    function deleteCard(cardId) {
      if (!confirm('¿Estás seguro de eliminar esta tarjeta de producción?')) return;
      state.contenidos = state.contenidos.filter(c => c.id !== cardId);
      if (currentDrawerCardId === cardId) closeDrawer();
      updateUI();
      if (prodDocRef) {
        const fbSdk = (typeof window !== 'undefined' && window.firebase) ? window.firebase : (typeof firebase !== 'undefined' ? firebase : null);
        const fv = (fbSdk && fbSdk.firestore && fbSdk.firestore.FieldValue) ? fbSdk.firestore.FieldValue : null;
        const updateData = {
          eliminadas: fv ? fv.arrayUnion(cardId) : [cardId],
          ['tarjetas.' + cardId]: fv ? fv.delete() : null,
          actualizado: new Date().toISOString()
        };
        prodDocRef.update(updateData).then(() => {
          recalcularContadoresRemotos();
        }).catch(err => {
          console.warn('Error al eliminar tarjeta en remoto:', err);
        });
      }
    }

    // ── DRAG AND DROP (SORTABLEJS) ──────────────────────────────────────────
    function initDragAndDrop() {
      const cols = ['col-todo', 'col-grabando', 'col-listo'];
      sortableInstances.forEach(s => s.destroy());
      sortableInstances = [];

      cols.forEach(colId => {
        const el = document.getElementById(colId);
        if (!el) return;

        const s = new Sortable(el, {
          group: 'kanban-board',
          animation: 180,
          ghostClass: 'sortable-ghost',
          chosenClass: 'sortable-chosen',
          handle: '.card-drag-indicator, .card-title, .card-top',
          delay: 150,
          delayOnTouchOnly: true,
          touchStartThreshold: 8,
          onStart: () => {
            isDragging = true;
            closeAllCardMenus();
          },
          onEnd: (evt) => {
            setTimeout(() => { isDragging = false; }, 50);
            const cardId = evt.item.dataset.id;
            const targetStatus = evt.to.dataset.status;
            if (!cardId || !targetStatus) return;

            const card = state.contenidos.find(c => c.id === cardId);
            if (card) {
              card.estado = targetStatus;
              if (targetStatus === 'listo') card.subtareas.forEach(s => s.done = true);
              // Reordenar state.contenidos según el orden visual en las columnas
              const domCardEls = Array.from(document.querySelectorAll('.kanban-column .card'));
              const domIds = domCardEls.map(el => el.dataset.id).filter(Boolean);
              if (domIds.length) {
                const map = new Map(state.contenidos.map(c => [c.id, c]));
                const newOrdered = [];
                domIds.forEach(id => { if (map.has(id)) newOrdered.push(map.get(id)); });
                state.contenidos.forEach(c => { if (!domIds.includes(c.id)) newOrdered.push(c); });
                state.contenidos = newOrdered;
              }
              updateUI();
              syncOrderToFirestore(cardId);
            }
          }
        });
        sortableInstances.push(s);
      });
    }

    // ── BUSCADOR ────────────────────────────────────────────────────────────
    function setupSearch() {
      const input = document.getElementById('search-input');
      const mobileInput = document.getElementById('mobile-search-input');
      const clearBtn = document.getElementById('search-clear');
      const mobileClearBtn = document.getElementById('mobile-search-clear');

      function onSearch(val) {
        searchQuery = (val || '').trim().toLowerCase();
        if (input) input.value = val;
        if (mobileInput) mobileInput.value = val;

        const hasVal = Boolean(searchQuery);
        if (clearBtn) clearBtn.style.display = hasVal ? 'flex' : 'none';
        if (mobileClearBtn) mobileClearBtn.style.display = hasVal ? 'flex' : 'none';

        renderCards();
      }

      if (input) input.addEventListener('input', e => onSearch(e.target.value));
      if (mobileInput) mobileInput.addEventListener('input', e => onSearch(e.target.value));

      // Atajo de teclado ⌘K o Ctrl+K
      document.addEventListener('keydown', (e) => {
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
          e.preventDefault();
          if (input) {
            input.focus();
            input.select();
          }
        } else if (e.key === 'Escape') {
          closeAllCardMenus();
          closeDrawer();
          closeModal();
        }
      });
    }

    function clearSearch() {
      searchQuery = '';
      const input = document.getElementById('search-input');
      const mobileInput = document.getElementById('mobile-search-input');
      if (input) input.value = '';
      if (mobileInput) mobileInput.value = '';
      document.getElementById('search-clear').style.display = 'none';
      const mClear = document.getElementById('mobile-search-clear');
      if (mClear) mClear.style.display = 'none';
      renderCards();
    }

    function toggleMobileSearch() {
      const bar = document.getElementById('mobile-search-bar');
      if (!bar) return;
      bar.classList.toggle('show');
      if (bar.classList.contains('show')) {
        const inp = document.getElementById('mobile-search-input');
        if (inp) inp.focus();
      }
    }

    // ── ADAPTACIÓN MÓVIL (PESTAÑAS) ─────────────────────────────────────────
    function switchMobileTab(tabKey) {
      document.querySelectorAll('.m-tab-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tabKey);
      });

      const colMap = {
        todo: 'section-todo',
        grabando: 'section-grabando',
        listo: 'section-listo'
      };

      document.querySelectorAll('.k-col').forEach(col => {
        col.classList.toggle('mobile-active', col.id === colMap[tabKey]);
      });
    }

    // ── DENSIDAD VISUAL ─────────────────────────────────────────────────────
    function setDensity(density) {
      const b = document.body;
      const btnCompact = document.getElementById('btn-density-compact');
      const btnComfortable = document.getElementById('btn-density-comfortable');

      if (density === 'comfortable') {
        b.classList.remove('density-compact');
        b.classList.add('density-comfortable');
        if (btnCompact) btnCompact.classList.remove('active');
        if (btnComfortable) btnComfortable.classList.add('active');
      } else {
        b.classList.remove('density-comfortable');
        b.classList.add('density-compact');
        if (btnComfortable) btnComfortable.classList.remove('active');
        if (btnCompact) btnCompact.classList.add('active');
      }
      localStorage.setItem('nexo-tablero-density-v2', density);
    }

    // ── EXPORTACIÓN JSON ────────────────────────────────────────────────────
    function exportData() {
      const dataToExport = {
        cliente: state.cliente,
        fecha: state.fecha,
        exportedAt: new Date().toISOString(),
        totalContenidos: state.contenidos.length,
        contenidos: state.contenidos
      };

      const blob = new Blob([JSON.stringify(dataToExport, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `produccion-${slugify(state.cliente || 'nexo')}-${state.fecha || 'tablero'}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }

    // ── UTILIDADES ─────────────────────────────────────────────────────────
    function escapeHTML(str) {
      if (!str) return '';
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    }

    function slugify(s) {
      return String(s || '').toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
    }

    function formatDateFriendly(dateStr) {
      if (!dateStr) return 'Sin fecha';
      const m = String(dateStr).match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (m) {
        const meses = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
        const day = m[3];
        const month = meses[parseInt(m[2], 10) - 1] || m[2];
        const year = m[1];
        return `${day} ${month} ${year}`;
      }
      return dateStr;
    }

    function cleanCard(c) {
      if (!c || typeof c !== 'object') return null;
      return {
        id: String(c.id || ''),
        titulo: String(c.titulo || ''),
        tipo: String(c.tipo || 'otro'),
        sede: String(c.sede || ''),
        estado: String(c.estado || 'todo'),
        descripcion: String(c.descripcion || ''),
        subtareas: Array.isArray(c.subtareas) ? c.subtareas.map(s => ({
          id: String(s.id || ''),
          texto: String(s.texto || ''),
          done: Boolean(s.done)
        })) : [],
        mediaLinks: Array.isArray(c.mediaLinks) ? c.mediaLinks.map(m => ({
          label: String(m.label || ''),
          url: String(m.url || '')
        })) : [],
        notas: String(c.notas || ''),
        ...(c.ads === true ? { ads: true } : {}),
        ...(c.subidaAds ? { subidaAds: String(c.subidaAds) } : {})
      };
    }

    function saveState() {
      try {
        const snapshot = {
          cliente: state.cliente,
          fecha: state.fecha,
          actualizado: state.actualizado || new Date().toISOString(),
          orden: state.contenidos.map(c => c.id),
          tarjetas: Object.fromEntries(state.contenidos.map(c => [c.id, cleanCard(c)])),
          eliminadas: Array.from(state.eliminadas || []),
          contenidos: state.contenidos
        };
        localStorage.setItem(LS_KEY, JSON.stringify(snapshot));
      } catch (e) {
        console.warn('Error guardando en localStorage:', e);
      }
    }

    function saveStateLocalOnly() {
      saveState();
    }

    // ── FONDO ANIMADO DE CONEXIONES NEXO (CANVAS 2D NEXO-FONDO v2) ─────────
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


    function initNexoBackground() {
      if (typeof NexoNetworkBackground !== 'undefined') {
        NexoNetworkBackground.init(document.body);
      }
    }

    // ── INICIALIZACIÓN GENERAL ─────────────────────────────────────────────
    function init() {
      if (typeof window !== 'undefined' && window.DATA) {
        Object.assign(DATA, window.DATA);
      }
      document.addEventListener('touchstart', function(){}, {passive:true});
      // Tema por defecto: dark (Dark Studio creativo)
      const savedTheme = localStorage.getItem('nexo-tablero-theme') || 'dark';
      setTheme(savedTheme);

      const savedDensity = localStorage.getItem('nexo-tablero-density-v2') || 'comfortable';
      setDensity(savedDensity);

      const local = localStorage.getItem(LS_KEY);
      if (local) {
        try {
          const parsed = JSON.parse(local);
          if (parsed && (parsed.fecha === DATA.fecha || !DATA.fecha) && (parsed.cliente === DATA.cliente || !DATA.cliente)) {
            hasLocalSnapshot = true;
            isFirstSyncDone = true;
            state = {
              fecha: DATA.fecha || parsed.fecha || '',
              cliente: DATA.cliente || parsed.cliente || '',
              actualizado: parsed.actualizado || '',
              eliminadas: Array.isArray(parsed.eliminadas) ? parsed.eliminadas : [],
              contenidos: []
            };

            const eliminadasSet = new Set(state.eliminadas);

            if (Array.isArray(parsed.contenidos) && parsed.contenidos.length > 0) {
              state.contenidos = parsed.contenidos.map(c => cleanCard(c)).filter(c => c && c.id && !eliminadasSet.has(c.id));
            } else if (parsed.tarjetas && typeof parsed.tarjetas === 'object') {
              const orden = Array.isArray(parsed.orden) ? parsed.orden : Object.keys(parsed.tarjetas);
              orden.forEach(id => {
                if (parsed.tarjetas[id] && !eliminadasSet.has(id)) {
                  state.contenidos.push(cleanCard(parsed.tarjetas[id]));
                }
              });
            }

            (DATA.contenidos || []).forEach(dc => {
              if (!state.contenidos.find(c => c.id === dc.id) && !eliminadasSet.has(dc.id)) {
                state.contenidos.push(cleanCard(dc));
              }
            });
          }
        } catch (e) {
          console.warn('Error parseando snapshot local:', e);
          hasLocalSnapshot = false;
        }
      }

      if (!hasLocalSnapshot) {
        state = JSON.parse(JSON.stringify(DATA));
        if (!Array.isArray(state.contenidos)) state.contenidos = [];
        state.contenidos.forEach((c, i) => {
          if (!c.id) c.id = 'c' + (i + 1);
          if (!c.estado) c.estado = 'todo';
          if (!c.subtareas) c.subtareas = [];
          if (!c.mediaLinks) c.mediaLinks = [];
        });
      }

      // Renderizar datos del cliente y fecha en encabezado
      if (state.cliente) document.getElementById('hdr-client').textContent = state.cliente;
      if (state.fecha) document.getElementById('hdr-date').textContent = formatDateFriendly(state.fecha);

      if (hasLocalSnapshot) {
        renderCards();
        setTimeout(function() {
          document.body.classList.remove('is-entering');
        }, 450);
      } else {
        renderSkeletons();
        firstSyncTimeout = setTimeout(finishFirstSync, 2500);
      }

      initDragAndDrop();
      setupSearch();
      setupSheet();
      initFirebase();
      initNexoBackground();

      // Deep linking con hash: #card-c1 abre el drawer
      if (window.location.hash) {
        const hash = window.location.hash.replace('#', '');
        if (hash.startsWith('card-')) {
          const cId = hash.replace('card-', '');
          setTimeout(() => openDrawer(cId), 150);
        }
      }
    }

    if (typeof document !== 'undefined' && document.readyState === 'loading') {
      window.addEventListener('DOMContentLoaded', init);
    } else {
      init();
    }

  // Exponer métodos para eventos onclick / API pública
  window.toggleTheme = toggleTheme;
  window.setTheme = setTheme;
  window.setDensity = setDensity;
  window.clearSearch = clearSearch;
  window.toggleMobileSearch = toggleMobileSearch;
  window.exportData = exportData;
  window.openModal = openModal;
  window.closeModal = closeModal;
  window.switchMobileTab = switchMobileTab;
  window.openModalWithStatus = openModalWithStatus;
  window.closeDrawer = closeDrawer;
  window.openDrawer = openDrawer;
  window.navigateSheet = navigateSheet;
  window.editFromDrawer = editFromDrawer;
  window.deleteFromDrawer = deleteFromDrawer;
  window.setCardStatusFromDrawer = setCardStatusFromDrawer;
  window.toggleScriptEdit = toggleScriptEdit;
  window.copyDrawerScript = copyDrawerScript;
  window.toggleChecklistEdit = toggleChecklistEdit;
  window.addSubtaskFromSheet = addSubtaskFromSheet;
  window.advanceCardFromDrawer = advanceCardFromDrawer;
  window.handleModalOverlayClick = handleModalOverlayClick;
  window.handleFormSubmit = handleFormSubmit;
  window.toggleCardMenu = toggleCardMenu;
  window.quickMoveCard = quickMoveCard;
  window.moverEstado = quickMoveCard;
  window.deleteCard = deleteCard;
  window.renderCards = renderCards;

})(typeof window !== 'undefined' ? window : this, typeof document !== 'undefined' ? document : {});
