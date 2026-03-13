/*
================================================
MEETAI — content.js (ATUALIZADO)
================================================
*/

// ══════════════════════════════════════════════
// PATCH NUCLEAR — sobrescreve setInterval ANTES
// de qualquer código. Todos os intervals criados
// por este script são rastreados e cancelados
// automaticamente quando o contexto morre.
// ══════════════════════════════════════════════

const _intervals = new Set();
const _origSet = window.setInterval;
const _origClear = window.clearInterval;

window.setInterval = function(fn, ms, ...a) {
  const id = _origSet.call(window, function() {
    // Se contexto morreu, cancela este interval agora
    if (!_checkCtx()) { _origClear(id); _intervals.delete(id); return; }
    try { fn(...a); }
    catch(e) { _origClear(id); _intervals.delete(id); }
  }, ms);
  _intervals.add(id);
  return id;
};

window.clearInterval = function(id) {
  _intervals.delete(id);
  _origClear.call(window, id);
};

function _checkCtx() {
  try { return typeof chrome !== 'undefined' && !!chrome.runtime && !!chrome.runtime.id; }
  catch(e) { return false; }
}

function _killAll() {
  for (const id of _intervals) _origClear(id);
  _intervals.clear();
}

// Detecta morte do contexto via document visibility + ping periódico
// Usa _origSet para não ser rastreado pelo patch acima
let _ctxDead = false;
const _watchdog = _origSet.call(window, () => {
  if (_ctxDead) return;
  if (!_checkCtx()) {
    _ctxDead = true;
    _killAll();
    _origClear(_watchdog);
  }
}, 500);

let _dead = false; // alias para compatibilidade

// ══════════════════════════════════════════════
// ESTADO
// ══════════════════════════════════════════════
let meetingStarted = false;
let myRealName = null;
let captionObserver = null;
let captionsEnabled = false;
let captionsHidden = false;
const lastSentMap = new Map();

// ══════════════════════════════════════════════
// CHROME API SEGURA
// Nunca lança exceção — retorna silenciosamente
// ══════════════════════════════════════════════
function send(msg) {
  if (!_checkCtx()) return;
  try {
    chrome.runtime.sendMessage(msg).catch(() => {});
  } catch(_) {}
}

function storageGet(keys, cb) {
  if (!_checkCtx()) return;
  try {
    chrome.storage.local.get(keys, cb);
  } catch(_) {}
}

// ══════════════════════════════════════════════
// INTERVAL SEGURO
// Cada interval verifica _dead antes de executar
// ══════════════════════════════════════════════
function safeInterval(fn, ms) {
  const id = setInterval(() => {
    if (_dead) { clearInterval(id); return; }
    try {
      fn();
    } catch(e) {
      _dead = true;
      clearInterval(id);
    }
  }, ms);
  return id;
}

// ══════════════════════════════════════════════
// STOP ALL
// ══════════════════════════════════════════════
function stopAll() {
  _dead = true;
  if (captionObserver) {
    try { captionObserver.disconnect(); } catch(_) {}
    captionObserver = null;
  }
  meetingStarted = false;
  try { document.getElementById('meetai-style')?.remove(); } catch(_) {}
}

// ══════════════════════════════════════════════
// 1. UTILS
// ══════════════════════════════════════════════
function getCode() {
  const m = location.href.match(/meet\.google\.com\/([a-z0-9\-]{3,})/);
  return m ? m[1] : null;
}

function insideMeeting() {
  if (!getCode()) return false;
  return !!(
    document.querySelector('[data-participant-id]') ||
    document.querySelector('[jsname="psRWwb"]') ||
    document.querySelector('[jsname="BOHaEe"]') ||
    document.querySelector('[aria-label*="microfone"]') ||
    document.querySelector('[aria-label*="microphone"]')
  );
}

// ══════════════════════════════════════════════
// 2. MEU NOME REAL
// ══════════════════════════════════════════════
function getMyName() {
  const el = document.querySelector('.adnwBd') || document.querySelector('.SK997c') || document.querySelector('[data-self-name]');
  if (el) {
    const name = el.innerText.split('\n')[0].trim();
    if (name.length > 1) return name;
  }
  for (const tile of document.querySelectorAll('[data-participant-id]')) {
    const name = tile.innerText?.split('\n')[0].trim();
    if (name && name.length > 1 && name.length < 60) return name;
  }
  return null;
}

// ══════════════════════════════════════════════
// 3. PARTICIPANTES
// ══════════════════════════════════════════════
function sendParticipants() {
  const seen = new Set();
  document.querySelectorAll('[data-participant-id], .ZjO7Rb').forEach(el => {
    const name = el.innerText?.split('\n')[0].trim();
    if (name && name.length > 1 && name.length < 60) seen.add(name);
  });
  if (myRealName) seen.add(myRealName);
  if (seen.size > 0) send({ action: 'participants', list: [...seen] });
}

// ══════════════════════════════════════════════
// 4. ATIVAR LEGENDAS
// ══════════════════════════════════════════════
function enableCaptions() {
  if (captionsEnabled) return;

  // Seletores atualizados para containers de legenda
  if (document.querySelector('.iOzk7') || document.querySelector('[jsname="dsyhDe"]') || document.querySelector('.nMcdL')) {
    captionsEnabled = true;
    hideOrMinimizeCaptions();
    return;
  }

  const ccSelectors = [
    '[aria-label*="Turn on captions"]',
    '[aria-label*="Ativar legendas"]',
    '[aria-label*="Ativar legenda"]',
    '[aria-label*="captions"]',
    '[jsname="r8qRAd"]',
  ];

  for (const sel of ccSelectors) {
    const btn = document.querySelector(sel);
    if (!btn) continue;
    
    // Verifica se já está pressionado (ativo)
    const isPressed = btn.getAttribute('aria-pressed') === 'true' || btn.classList.contains('VfPpkd-ksW4S-mWP9Q-OWXEXe-Tv89id');
    if (isPressed) {
      captionsEnabled = true;
      hideOrMinimizeCaptions();
      return;
    }
    
    // Clique forçado com evento real
    btn.click();
    btn.dispatchEvent(new MouseEvent('click', {view: window, bubbles: true, cancelable: true}));
    
    captionsEnabled = true;
    console.log('[MeetAI] 📺 Legendas ativadas');
    setTimeout(hideOrMinimizeCaptions, 1500);
    return;
  }
}

// ══════════════════════════════════════════════
// 5. ESCONDER LEGENDAS
// ══════════════════════════════════════════════
function hideOrMinimizeCaptions() {
  if (captionsHidden) return;
  storageGet(['captionDisplay'], (data) => {
    const mode = data?.captionDisplay || 'hidden';
    if (mode === 'visible') return;

    let css = '';
    if (mode === 'hidden') {
      css = `
        .iOzk7, [jsname="dsyhDe"], .nMcdL.bj4p3b,
        [jscontroller="KPn5nb"], .vNKgIf.UDinHf {
          opacity: 0.01 !important;
          pointer-events: none !important;
          height: 1px !important;
          overflow: hidden !important;
          padding: 0 !important; margin: 0 !important;
        }`;
    } else if (mode === 'mini') {
      css = `
        .iOzk7, [jsname="dsyhDe"] {
          position: fixed !important;
          bottom: 70px !important; right: 16px !important;
          left: auto !important; width: 280px !important;
          font-size: 11px !important; opacity: 0.75 !important;
          background: rgba(0,0,0,0.65) !important;
          border-radius: 8px !important; padding: 6px 10px !important;
          z-index: 9999 !important;
        }
        .iOzk7 [jscontroller="KPn5nb"],
        [jsname="dsyhDe"] [jscontroller="KPn5nb"] { display:none !important; }`;
    }

    if (css) {
      const style = document.createElement('style');
      style.id = 'meetai-style';
      style.textContent = css;
      document.head.appendChild(style);
      captionsHidden = true;
    }
  });
}

// ══════════════════════════════════════════════
// 6. CAPTURAR LEGENDAS
// ══════════════════════════════════════════════
function captureCaptions() {
  // Seletores atualizados para containers e blocos
  const containers = document.querySelectorAll('.iOzk7, [jsname="dsyhDe"], .vNKgIf');
  
  containers.forEach(container => {
    const blocks = container.querySelectorAll('.nMcdL, [jsname="tS999c"]');
    
    (blocks.length ? blocks : [container]).forEach(block => {
      // Seletores de texto atualizados
      const textEl = block.querySelector('.ygicle, .VbkSUe, .DtJ7e, .XInYyc, [jsname="YS01Ge"]');
      if (!textEl) return;

      const text = textEl.innerText?.trim();
      if (!text || text.length < 2) return;

      // Identificação do falante atualizada
      let rawSpeaker = '';
      const speakerEl = block.querySelector('.zs798c, .j9vN6e, .K6S7ne, [jsname="Gv1pnd"]');
      if (speakerEl) {
        rawSpeaker = speakerEl.innerText.trim();
      } else {
        for (const node of block.childNodes) {
          if (node.nodeType === Node.TEXT_NODE && node.textContent.trim()) {
            rawSpeaker = node.textContent.trim();
            break;
          }
        }
      }

      const low = rawSpeaker.toLowerCase();
      const speaker = (!rawSpeaker || low === 'você' || low === 'you' || low === 'voce')
        ? (myRealName || 'Você')
        : rawSpeaker;

      sendTranscript(text, speaker);
    });
  });
}

// ══════════════════════════════════════════════
// 7. DEDUPLICAÇÃO
// ══════════════════════════════════════════════
function sendTranscript(text, speaker) {
  if (!text || text.length < 2) return;
  const now = Date.now();

  for (const [k, t] of lastSentMap) {
    if (now - t > 15000) lastSentMap.delete(k);
  }

  for (const [prevKey] of lastSentMap) {
    const sep = prevKey.indexOf('||');
    const pSpk = prevKey.slice(0, sep);
    const pTxt = prevKey.slice(sep + 2);
    if (pSpk !== speaker) continue;
    
    // Se o novo texto começa com o anterior, substitui (está completando a frase)
    if (text.startsWith(pTxt)) { lastSentMap.delete(prevKey); break; }
    // Se o texto anterior já contém o novo, ignora
    if (pTxt.includes(text)) return;
  }

  const key = `${speaker}||${text}`;
  if (lastSentMap.has(key)) return;
  lastSentMap.set(key, now);

  send({ action: 'transcription', text, speaker });
  console.log(`[MeetAI] 📝 ${speaker}: ${text}`);
}

// ══════════════════════════════════════════════
// 8. MUTATION OBSERVER
// ══════════════════════════════════════════════
function startObserver() {
  if (captionObserver) return;
  let throttle = null;
  captionObserver = new MutationObserver(() => {
    try {
      if (_dead) { captionObserver?.disconnect(); return; }
      if (throttle) return;
      throttle = setTimeout(() => {
        try { throttle = null; captureCaptions(); }
        catch(e) { _dead = true; }
      }, 300);
    } catch(e) {
      _dead = true;
      try { captionObserver?.disconnect(); } catch(_) {}
    }
  });
  captionObserver.observe(document.body, {
    childList: true, subtree: true, characterData: true
  });
  console.log('[MeetAI] 👀 Observer ativo');
}

// ══════════════════════════════════════════════
// 9. FIM DA REUNIÃO
// ══════════════════════════════════════════════
function onEnd() {
  if (!meetingStarted) return;
  meetingStarted = false;
  send({ action: 'meetingEnded' });
  stopAll();
  console.log('[MeetAI] 🔴 Encerrada');
}

function watchEnd() {
  let lastUrl = location.href;

  safeInterval(() => {
    if (!meetingStarted) return;
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      if (!getCode()) onEnd();
    }
  }, 1000);

  document.addEventListener('click', (e) => {
    if (_dead) return;
    const btn = e.target.closest('button');
    if (!btn) return;
    const lbl = (btn.getAttribute('aria-label') || '').toLowerCase();
    if (lbl.includes('sair') || lbl.includes('leave') || lbl.includes('end call')) {
      setTimeout(onEnd, 2000);
    }
  }, true);
}

// ══════════════════════════════════════════════
// 10. INICIAR
// ══════════════════════════════════════════════
function onStart(code) {
  if (meetingStarted) return;
  if (!_checkCtx()) return; // contexto já morto, nem tenta
  meetingStarted = true;

  myRealName = getMyName();
  console.log('[MeetAI] ✅ Iniciado:', code, '| Usuário:', myRealName);

  // Cada setTimeout verifica contexto antes de executar
  setTimeout(() => { if (_checkCtx() && !myRealName) myRealName = getMyName(); }, 3000);

  send({ action: 'meetingStarted', meetingCode: code });

  [500, 1500, 3000, 5000, 8000].forEach(d =>
    setTimeout(() => { if (_checkCtx() && !captionsEnabled) enableCaptions(); }, d)
  );

  startObserver();

  safeInterval(() => {
    if (!meetingStarted) return;
    if (!myRealName) myRealName = getMyName();
    if (!captionsEnabled) enableCaptions();
    captureCaptions();
  }, 2000);

  safeInterval(() => {
    if (!meetingStarted) return;
    sendParticipants();
  }, 8000);

  setTimeout(() => { if (_checkCtx()) sendParticipants(); }, 2000);
  watchEnd();
}

// ══════════════════════════════════════════════
// 11. DETECÇÃO DE INÍCIO
// ══════════════════════════════════════════════
safeInterval(() => {
  if (meetingStarted) return;
  if (getCode() && insideMeeting()) onStart(getCode());
}, 1500);

console.log('[MeetAI] 🚀 Carregado');
