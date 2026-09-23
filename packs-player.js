// ============================================================
// packs-player.js — Reproductor protegido para mis-packs.html
//
// Responsabilidades:
//   · Verificar sesión activa y obtener email del usuario
//   · Cargar órdenes completadas del usuario y sus audio_assets
//     (todo respetando RLS desde el cliente)
//   · Renderizar lista de packs con playlist (título + duración)
//   · Reproducir audio llamando a get-pack-audio (URL firmada 300s)
//   · Al terminar una pista, avanzar a la siguiente (pide URL nueva)
//   · Manejo de estados: sin compras, error de firma, sesión expirada
//   · Marca de agua fija con email y "acceso personal e intransferible"
//   · Protección UX: controlsList=nodownload, menú contextual desactivado
// ============================================================

(() => {
  'use strict';

  /* ------------------------------------------------------------
     Config (reusa CONFIG de app.js — mismo proyecto)
     ------------------------------------------------------------ */
  const SUPABASE_URL     = CONFIG.SUPABASE_URL;
  const SUPABASE_ANON    = CONFIG.SUPABASE_ANON_KEY;
  const EDGE_GET_AUDIO   = SUPABASE_URL.replace('supabase.co', 'functions.supabase.co') + '/get-pack-audio';

  /* ------------------------------------------------------------
     Estado local
     ------------------------------------------------------------ */
  let session     = null;
  let userPacks   = [];      // [{ id, name, audio_assets: [...] }, …]
  let currentPack = -1;      // índice del pack que se está reproduciendo
  let currentTrack = -1;     // índice de la pista dentro del pack
  let _playing    = false;   // anti doble clic
  let _supabase   = null;    // cliente lazy

  /* ------------------------------------------------------------
     $ alias local
     ------------------------------------------------------------ */
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  /* ------------------------------------------------------------
     Lazy Supabase client (reutiliza SDK de app.js)
     ------------------------------------------------------------ */
  async function getSupabase() {
    if (_supabase) return _supabase;
    if (window.supabase) {
      _supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON);
      return _supabase;
    }
    // Esperar a que app.js lo cargue (ya debería estar en window.supabase)
    return await new Promise((resolve) => {
      const check = () => {
        if (window.supabase) {
          _supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON);
          resolve(_supabase);
        } else {
          setTimeout(check, 100);
        }
      };
      check();
    });
  }

  /* ------------------------------------------------------------
     Sesión
     ------------------------------------------------------------ */
  async function getSession() {
    const client = await getSupabase();
    if (!client) return null;
    const { data } = await client.auth.getSession();
    return data?.session ?? null;
  }

  /* ------------------------------------------------------------
     Cargar packs del usuario
     ------------------------------------------------------------ */
  async function loadUserPacks() {
    const container = $('#mis-packs');
    if (!container) return;

    try {
      container.innerHTML = '<p class="promise">Cargando tus packs…</p>';
      session = await getSession();

      // Sin sesión → CTA inline (no redirige; el usuario elige ir a login)
      if (!session) {
        renderLoginCTA(container);
        return;
      }

      // Pintar email en la marca de agua
      const wm = $('#watermark');
      if (wm && session.user?.email) {
        wm.textContent = session.user.email + ' · acceso personal e intransferible';
      }

      // --- Obtener órdenes completadas del usuario (vía RLS y anon key) ---
      const client = await getSupabase();

      const { data: orders, error: ordersError } = await client
        .from('orders')
        .select('pack_id')
        .eq('status', 'completed')
        .eq('user_id', session.user.id)
        .order('created_at', { ascending: false });

      if (ordersError) throw ordersError;

      if (!orders || orders.length === 0) {
        renderNoPacks(container);
        return;
      }

      // IDs únicos de packs comprados
      const packIds = [...new Set(orders.map(o => o.pack_id).filter(Boolean))];

      // --- Obtener datos del pack ---
      const { data: packsData, error: packsError } = await client
        .from('packs')
        .select('id, name, cover_path')
        .in('id', packIds);

      if (packsError) throw packsError;

      const packsMap = new Map((packsData || []).map(p => [p.id, p]));

      // --- Obtener audio_assets (RLS filtra solo los comprados) ---
      const { data: assets, error: assetsError } = await client
        .from('audio_assets')
        .select('*')
        .in('product_id', packIds)
        .eq('activo', true)
        .order('orden', { ascending: true });

      if (assetsError) throw assetsError;

      // --- Agrupar por pack siguiendo el orden de órdenes ---
      const seen = new Set();
      userPacks = [];

      for (const order of orders) {
        const pid = order.pack_id;
        if (!pid || seen.has(pid)) continue;
        seen.add(pid);

        const pack = packsMap.get(pid);
        if (!pack) continue;

        const audioAssets = (assets || [])
          .filter(a => a.product_id === pid && a.activo)
          .map(a => ({
            id: a.id,
            titulo: a.titulo,
            duracion_seg: a.duracion_seg || null,
            storage_path: a.storage_path,
            orden: a.orden,
            product_id: a.product_id
          }));

        if (audioAssets.length === 0) continue; // no saltar a mostrar packs sin audios

        userPacks.push({
          id: pid,
          name: pack.name,
          cover_path: pack.cover_path,
          audio_assets: audioAssets
        });
      }

      if (userPacks.length === 0) {
        renderNoPacks(container);
        return;
      }

      renderPacks(container);

    } catch (err) {
      console.error('[loadUserPacks]', err);
      renderError(container, 'No pudimos cargar tus packs. Verifica tu conexión e inténtalo de nuevo.', () => { loadUserPacks(); });
    }
  }

  /* ------------------------------------------------------------
     Render: sin compras
     ------------------------------------------------------------ */
  function renderNoPacks(container) {
    container.innerHTML = `
      <div class="empty-state">
        <p>Aún no tienes packs comprados.</p>
        <a href="index.html#catalogo" class="btn btn-primary">Ir al catálogo</a>
      </div>
    `;
  }

  /* ------------------------------------------------------------
     Render: sin sesión — CTA inline
     ------------------------------------------------------------ */
  function renderLoginCTA(container) {
    container.innerHTML = `
      <div class="empty-state">
        <p>Inicia sesión para ver tus packs comprados.</p>
        <a href="login.html?next=${encodeURIComponent('mis-packs.html')}" class="btn btn-primary">Ir a login</a>
      </div>
    `;
  }

  /* ------------------------------------------------------------
     Render: error
     ------------------------------------------------------------ */
  function renderError(container, message, retryFn) {
    container.innerHTML = `
      <div class="error-state">
        <p>${message}</p>
        ${retryFn ? '<button class="btn btn-primary" id="packs-retry">Reintentar</button>' : ''}
      </div>
    `;
    const retryBtn = $('#packs-retry');
    if (retryBtn && retryFn) {
      retryBtn.addEventListener('click', retryFn);
    }
  }

  /* ------------------------------------------------------------
     Render: lista de packs con playlist
     ------------------------------------------------------------ */
  function renderPacks(container) {
    // Barra de audio fija (sticky) con el reproductor
    const audioBar = `
      <div class="audio-bar">
        <audio id="pack-audio" controls controlsList="nodownload"
               contextmenu="return false"
               oncontextmenu="return false"
               preload="none"></audio>
      </div>
    `;

    const sections = userPacks.map((pack, pIdx) => {
      const coverSrc = pack.cover_path
        ? `${SUPABASE_URL}/storage/v1/object/public/covers/${pack.cover_path}`
        : `assets/covers/${pack.id}.svg`;

      const tracks = pack.audio_assets.map((track, tIdx) => {
        const dur = track.duracion_seg
          ? Math.floor(track.duracion_seg / 60) + ':' + String(track.duracion_seg % 60).padStart(2, '0')
          : '';
        return `
          <button class="track-btn"
                  data-pack-idx="${pIdx}"
                  data-track-idx="${tIdx}"
                  data-asset-id="${track.id}"
                  title="${track.titulo}${dur ? ' (' + dur + ')' : ''}">
            <span class="track-number">${tIdx + 1}</span>
            <span class="track-title">${track.titulo}</span>
            ${dur ? '<span class="track-duration">' + dur + '</span>' : ''}
            <svg class="play-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" width="20" height="20">
              <path d="M8 5v14l11-7z"/>
            </svg>
          </button>
        `;
      }).join('');

      return `
        <section class="pack-section" data-pack-idx="${pIdx}">
          <h2 class="pack-section-title">
            <img src="${coverSrc}" alt="" class="pack-cover-thumb" width="48" height="48" loading="lazy">
            ${pack.name}
          </h2>
          <div class="track-list">${tracks}</div>
        </section>
      `;
    }).join('');

    container.innerHTML = audioBar + sections;

    // Cache ref al audio
    const audio = $('#pack-audio');
    if (!audio) return;

    // --- Eventos del audio ---
    audio.addEventListener('ended', onTrackEnded);
    audio.addEventListener('error', onAudioError);

    // --- Eventos de los botones ---
    container.addEventListener('click', (e) => {
      const btn = e.target.closest('.track-btn');
      if (!btn) return;
      const pIdx = parseInt(btn.dataset.packIdx, 10);
      const tIdx = parseInt(btn.dataset.trackIdx, 10);
      playTrack(pIdx, tIdx);
    });

    // Seleccionar primera pista como activa (sin reproducir)
    highlightTrack(0, 0);
  }

  /* ------------------------------------------------------------
     Highlight de pista activa
     ------------------------------------------------------------ */
  function highlightTrack(pIdx, tIdx) {
    $$('.track-btn').forEach(b => b.classList.remove('active'));
    const btn = $(`.track-btn[data-pack-idx="${pIdx}"][data-track-idx="${tIdx}"]`);
    if (btn) btn.classList.add('active');
  }

  /* ------------------------------------------------------------
     Reproducir pista
     ------------------------------------------------------------ */
  async function playTrack(pIdx, tIdx) {
    if (_playing) return; // anti doble clic
    _playing = true;

    try {
      const pack = userPacks[pIdx];
      if (!pack) throw new Error('Pack no encontrado');

      const track = pack.audio_assets[tIdx];
      if (!track) throw new Error('Pista no encontrada');

      highlightTrack(pIdx, tIdx);

      // Obtener URL firmada
      const signedUrl = await fetchSignedUrl(track.id);
      if (!signedUrl) throw new Error('No se pudo obtener el enlace del audio');

      // Reproducir
      const audio = $('#pack-audio');
      if (!audio) throw new Error('Reproductor no disponible');

      audio.src = signedUrl;
      await audio.play();

      currentPack = pIdx;
      currentTrack = tIdx;

    } catch (err) {
      console.error('[playTrack]', err);
      // Error genérico + reintento
      showTrackError(pIdx, tIdx);
    } finally {
      _playing = false;
    }
  }

  /* ------------------------------------------------------------
     Avanzar a siguiente pista (llamado al terminar)
     ------------------------------------------------------------ */
  function onTrackEnded() {
    const next = getNextTrack(currentPack, currentTrack);
    if (next) {
      playTrack(next.pIdx, next.tIdx);
    }
    // Si no hay siguiente, el audio se queda en pause
  }

  function getNextTrack(pIdx, tIdx) {
    const pack = userPacks[pIdx];
    if (!pack) return null;
    if (tIdx + 1 < pack.audio_assets.length) {
      return { pIdx, tIdx: tIdx + 1 };
    }
    if (pIdx + 1 < userPacks.length) {
      return { pIdx: pIdx + 1, tIdx: 0 };
    }
    return null; // Fin de todos los packs
  }

  /* ------------------------------------------------------------
     Error de audio
     ------------------------------------------------------------ */
  function onAudioError() {
    const audio = $('#pack-audio');
    const errMsg = audio?.error?.message || 'Error desconocido';
    console.warn('[audio error]', errMsg);

    const container = $('#mis-packs');
    if (!container) return;

    // Insertar mensaje de error sobre el audio bar
    const existing = $('.audio-error-msg');
    if (!existing) {
      const msg = document.createElement('div');
      msg.className = 'audio-error-msg';
      msg.style.cssText = 'margin-top:var(--sp-1);font-size:var(--fs-small);color:var(--error, red);text-align:center';
      msg.textContent = 'No se pudo reproducir este audio. Intenta de nuevo.';
      const bar = $('.audio-bar');
      if (bar) bar.after(msg);
    }
  }

  /* ------------------------------------------------------------
     Mostrar error en la pista + reintento
     ------------------------------------------------------------ */
  function showTrackError(pIdx, tIdx) {
    const btn = $(`.track-btn[data-pack-idx="${pIdx}"][data-track-idx="${tIdx}"]`);
    if (!btn) return;

    btn.classList.add('track-error');

    // Reemplazar contenido con mensaje de error + reintento
    btn.innerHTML = `
      <span class="track-number" style="background:var(--error,#d32f2f);color:white">!</span>
      <span class="track-title">Error al reproducir. Toca para reintentar.</span>
      <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20" style="flex-shrink:0;color:var(--error,#d32f2f)">
        <path d="M17.65 6.35A7.96 7.96 0 0012 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0112 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/>
      </svg>
    `;

    // El reintento se maneja por delegación de eventos en el contenedor (renderPacks).
    // Los data-atributos del <button> se conservan, así que al hacer clic
    // el flujo normal de playTrack se ejecuta de nuevo.
  }

  /* ------------------------------------------------------------
     Llamar a get-pack-audio Edge Function
     ------------------------------------------------------------ */
  async function fetchSignedUrl(audioAssetId) {
    const currentSession = await getSession();
    if (!currentSession) {
      window.location.href = 'login.html?next=' + encodeURIComponent('mis-packs.html');
      throw new Error('Sesión perdida');
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    try {
      const res = await fetch(EDGE_GET_AUDIO, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + currentSession.access_token,
        },
        body: JSON.stringify({ audio_asset_id: audioAssetId }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        if (res.status === 401) {
          window.location.href = 'login.html?next=' + encodeURIComponent('mis-packs.html');
          throw new Error('Sesión expirada');
        }
        if (res.status === 429) {
          throw new Error('Demasiadas solicitudes. Espera un momento antes de reproducir otro audio.');
        }
        throw new Error(body.error || 'Error al obtener el audio (' + res.status + ')');
      }

      const data = await res.json();
      return data.signedUrl;
    } catch (err) {
      if (err.name === 'AbortError') {
        throw new Error('La solicitud tardó demasiado. Verifica tu conexión.');
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  }

  /* ------------------------------------------------------------
     Inicio
     ------------------------------------------------------------ */
  async function init() {
    // Esperar DOM
    if (document.readyState === 'loading') {
      await new Promise(r => document.addEventListener('DOMContentLoaded', r));
    }

    // Solo actuar en mis-packs.html
    const container = $('#mis-packs');
    if (!container) return;

    // Desactivar menú contextual en toda el área del player
    container.addEventListener('contextmenu', (e) => e.preventDefault());

    await loadUserPacks();
  }

  init();
})();