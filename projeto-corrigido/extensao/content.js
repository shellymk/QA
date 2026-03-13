/*
================================================
MEETAI — content.js (COMPLETO E CORRIGIDO)
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

window.setInterval = function (fn, ms, ...a) {
  const id = _origSet.call(window, function () {
    if (!_checkCtx()) { _origClear(id); _intervals.delete(id); return; }
    try { fn(...a); }
    catch (e) { _origClear(id); _intervals.delete(id); }
  }, ms);
  _intervals.add(id);
  return id;
};

window.clearInterval = function (id) {
  _intervals.delete(id);
  _origClear.call(window, id);
};

function _checkCtx() {
  try { return typeof chrome !== 'undefined' && !!chrome.runtime && !!chrome.runtime.id; }
  catch (e) { return false; }
}

function _killAll() {
  for (const id of _intervals) _origClear(id);
  _intervals.clear();
}

// Detecta morte do contexto via watchdog periódico
let _ctxDead = false;
const _watchdog = _origSet.call(window, () => {
  if (_ctxDead) return;
  if (!_checkCtx()) {
    _ctxDead = true;
    _killAll();
    _origClear(_watchdog);
  }
}, 500);

let _dead = false;

// ══════════════════════════════════════════════
// ESTADO
// ══════════════════════════════════════════════
let meetingStarted = false;
let isRecording = false;
let myRealName = null;
let captionObserver = null;
let captionsEnabled = false;
let captionsHidden = false;
const lastSentMap = new Map();

// ══════════════════════════════════════════════
// CHROME API SEGURA
// ══════════════════════════════════════════════
function send(msg) {
  if (!_checkCtx()) return;
  try {
    chrome.runtime.sendMessage(msg).catch(() => { });
  } catch (_) { }
}

function storageGet(keys, cb) {
  if (!_checkCtx()) return;
  try {
    chrome.storage.local.get(keys, cb);
  } catch (_) { }
}

// ══════════════════════════════════════════════
// INTERVAL SEGURO
// ══════════════════════════════════════════════
function safeInterval(fn, ms) {
  const id = setInterval(() => {
    if (_dead) { clearInterval(id); return; }
    try {
      fn();
    } catch (e) {
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
  stopRecording();
  meetingStarted = false;
  try { document.getElementById('meetai-style')?.remove(); } catch (_) { }
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
// 4. ATIVAR LEGENDAS (CORRIGIDO)
// ══════════════════════════════════════════════
function enableCaptions() {
  if (captionsEnabled) return;

  const ccSelectors = [
    '[jsname="r8qRAd"]',
    '[aria-label*="Turn on captions"]',
    '[aria-label*="Ativar legendas"]',
    '[aria-label*="Ativar legenda"]',
    '[aria-label*="Ativar transcrição"]',
    '[aria-label*="captions"]',
    '[aria-label*="transcript"]',
    '[data-tooltip*="captions"]',
    '[data-tooltip*="legenda"]',
  ];

  for (const sel of ccSelectors) {
    const btn = document.querySelector(sel);
    if (!btn) continue;

    const isActive =
      btn.getAttribute('aria-pressed') === 'true' ||
      btn.classList.contains('VfPpkd-ksW4S-mWP9Q-OWXEXe-Tv89id') ||
      btn.getAttribute('data-is-muted') === 'false';

    if (isActive) {
      captionsEnabled = true;
      hideOrMinimizeCaptions();
      return;
    }

    try {
      btn.click();
      btn.dispatchEvent(new MouseEvent('click', { view: window, bubbles: true, cancelable: true }));
      captionsEnabled = true;
      setTimeout(hideOrMinimizeCaptions, 1500);
      return;
    } catch (e) {
      console.warn('[MeetAI] Falha ao clicar:', sel, e);
    }
  }
}

// ══════════════════════════════════════════════
// 5. ESCONDER LEGENDAS
// ══════════════════════════════════════════════
function hideOrMinimizeCaptions() {
  const id = 'meetai-visual-style';
  if (document.getElementById(id)) return;
  const style = document.createElement('style');
  style.id = id;
  style.innerHTML = `.a4cQT { opacity: 0 !important; height: 1px !important; pointer-events: none !important; }`;
  document.head.appendChild(style);


  console.log('[MeetAI] 👻 Legendas ocultadas visualmente.');
}

// ══════════════════════════════════════════════
// 6. CAPTURAR LEGENDAS (BLINDADO CONTRA CHAT)
// ══════════════════════════════════════════════
let _autoContainer = null;
let _autoTextSel = null;
let _autoSpeakSel = null;

const UI_PREFIXES = [
  'adicionar outras', 'add others', 'convidar pessoas', 'invite people',
  'copiar link', 'copy link', 'entrou na', 'saiu da', 'joined the', 'left the',
  'está aguardando', 'is waiting', 'foi admitido', 'was admitted',
  'você está', 'you are', 'sua câmera', 'your camera', 'seu microfone', 'your mic',
  'ativar legenda', 'turn on caption', 'desativar legenda', 'turn off caption',
  'gravação iniciada', 'recording started', 'gravação encerrada',
  'ainda sem mensagens', 'voltar à tela inicial',
  'abrir:', 'confiável:', 'ninguém precisa pedir', 'qualquer pessoa pode ligar'
];

function captureCaptions() {
  if (!isRecording) return;

  const ariaEls = document.querySelectorAll('[aria-live]');
  let found = false;
  ariaEls.forEach(el => {
    try {
      // BLINDAGEM: Ignora se o elemento estiver dentro do painel lateral de chat
      if (el.closest('[role="complementary"]') || el.closest('.R3G9vc')) return;

      if (el.closest('[role="alert"], [role="status"], header, nav')) return;
      const text = (el.innerText || el.textContent || '').trim();
      if (!text || text.length < 8) return;
      if (isUIText(text)) return;
      if (text.split(/\s+/).length < 4) return;

      const blocks = el.children.length > 0 ? [...el.children] : [el];
      blocks.forEach(b => { try { extractBlock(b); } catch (_) { } });
      found = true;
    } catch (_) { }
  });
  if (found) return;

  const containers = document.querySelectorAll(
    '.iOzk7, [jsname="dsyhDe"], .vNKgIf, [jscontroller="KPn5nb"], .a4cQT, .CNusmb, .Mz6pEf'
  );
  if (containers.length > 0) {
    containers.forEach(container => {
      const blocks = container.querySelectorAll('.nMcdL, [jsname="tS999c"], .TBMuR, .iTTPOb');
      (blocks.length ? blocks : [container]).forEach(block => extractBlock(block));
    });
    return;
  }

  captureByHeuristic();
}

function extractBlock(block) {
  try {
    if (!block || typeof block.innerText === 'undefined') return;
    const fullText = (block.innerText || '').trim();
    if (!fullText || fullText.length < 3 || isUIText(fullText)) return;

    let speaker = 'Participante'; 
    let speechText = fullText;

    // Busca todos os spans e divs internos para identificar o nome
    const parts = Array.from(block.querySelectorAll('div, span'))
      .map(el => el.innerText.trim())
      .filter(t => t.length > 0);

    if (parts.length >= 2) {
      const potentialName = parts[0];
      const rest = parts.slice(1).join(' ').trim();

      // Valida se o primeiro item parece um nome real
      if (potentialName.length < 40 && rest.length > 2) {
        speaker = potentialName;
        speechText = rest;
      }
    } else if (myRealName) {
      speaker = myRealName;
    }

    sendTranscript(speechText, speaker);
  } catch (e) {
    console.warn('[MeetAI] Erro na extração:', e);
  }
}

const UI_WORDS = new Set([
  'mic', 'microfone', 'microphone', 'câmera', 'camera', 'video', 'vídeo',
  'chat', 'participantes', 'participants', 'ativar', 'desativar',
  'enable', 'disable', 'mute', 'unmute', 'share', 'compartilhar',
  'tela', 'screen', 'mais', 'more', 'opções', 'options', 'sair', 'leave',
  'encerrar', 'end', 'levantar', 'raise', 'hand', 'mão', 'emoção', 'emoji',
  'reaction', 'caption', 'legenda', 'transcrição', 'transcript',
  'recording', 'gravar', 'gravação', 'present', 'apresentar',
  'breakout', 'whiteboard', 'poll', 'enquete', 'q&a',
  'adicionar', 'pessoas', 'add', 'people', 'convidar', 'invite',
  'copiar', 'copy', 'link', 'reunião', 'meeting', 'entrou', 'saiu',
  'joined', 'left', 'aguardando', 'waiting', 'admitir', 'admit',
  'recusar', 'deny', 'fixar', 'pin', 'destacar', 'spotlight',
  'silenciar', 'silencioso', 'mensagem', 'message', 'notificação'
]);

function isUIText(text) {
  if (!text) return true;
  const t = text.toLowerCase().trim();
  if (t.length < 4) return true;
  if (UI_WORDS.has(t)) return true;
  if (UI_PREFIXES.some(p => t.startsWith(p))) return true;
  const words = t.split(/\s+/);
  if (words.length <= 3 && words.every(w => UI_WORDS.has(w))) return true;
  return false;
}

function captureByHeuristic() {
  if (_autoContainer && document.contains(_autoContainer)) {
    extractFromContainer(_autoContainer);
    return;
  }
  _autoContainer = null;
  const ariaLive = document.querySelector('[aria-live="polite"], [aria-live="assertive"]');
  if (ariaLive) {
    const text = ariaLive.innerText?.trim();
    if (text && text.length > 3 && !isUIText(text)) {
      _autoContainer = ariaLive;
      extractFromContainer(_autoContainer);
      return;
    }
  }

  const viewH = window.innerHeight;
  const allSpans = [...document.querySelectorAll('span, div')]
    .filter(el => {
      if (!el.offsetParent) return false;
      if (el.closest('button, [role="button"], [role="menuitem"], header, nav, [role="toolbar"]')) return false;
      const rect = el.getBoundingClientRect();
      if (rect.top < viewH * 0.45 || rect.top > viewH * 0.92) return false;
      if (rect.height < 10 || rect.height > 150) return false;
      if (el.children.length > 2) return false;
      const text = el.innerText?.trim();
      if (!text || text.length < 6) return false;
      if (isUIText(text)) return false;
      if (text.split(/\s+/).length < 2) return false;
      return true;
    });
  if (allSpans.length === 0) return;

  const byTop = {};
  allSpans.forEach(el => {
    const top = Math.round(el.getBoundingClientRect().top / 30) * 30;
    if (!byTop[top]) byTop[top] = [];
    byTop[top].push(el);
  });
  const groups = Object.values(byTop);
  if (groups.length === 0) return;

  const bestGroup = groups.reduce((a, b) => a.length >= b.length ? a : b);
  bestGroup.forEach(el => {
    const text = el.innerText?.trim();
    if (!text || isUIText(text)) return;
    sendTranscript(text, myRealName || 'Você');
  });
}

function extractFromContainer(container) {
  const spans = [...container.querySelectorAll('span, div')]
    .filter(el => {
      if (el.children.length > 2) return false;
      const t = el.innerText?.trim();
      return t && t.length > 5 && !isUIText(t) && t.split(/\s+/).length >= 2;
    });
  spans.forEach(el => {
    sendTranscript(el.innerText.trim(), myRealName || 'Você');
  });
}

// ══════════════════════════════════════════════
// 7. DEDUPLICAÇÃO
// ══════════════════════════════════════════════
function sendTranscript(text, speaker) {
  if (!isRecording) return;
  const now = Date.now();
  const cleanText = text.trim();

  // Se a última mensagem enviada pelo MESMO speaker for idêntica, ignora
  const key = `${speaker}||${cleanText}`;
  if (lastSentMap.has(key) && (now - lastSentMap.get(key) < 10000)) return; 

  lastSentMap.set(key, now);
  send({ action: 'transcription', text: cleanText, speaker });

  console.log(`[MeetAI] 📝 ${speaker}: ${cleanText}`);
}

// ══════════════════════════════════════════════
// 8. MUTATION OBSERVER
// ══════════════════════════════════════════════
function startObserver() {
  if (captionObserver) return;
  let throttle = null;
  captionObserver = new MutationObserver(() => {
    try {
      if (_dead || !isRecording) {
        captionObserver?.disconnect();
        captionObserver = null;
        return;
      }
      if (throttle) return;
      // Dentro de startObserver() [cite: 85]
      throttle = setTimeout(() => {
        try { throttle = null; captureCaptions(); }
        catch (e) { _dead = true; }
      }, 100); // De 300ms para 100ms
    } catch (e) {
      _dead = true;
      try { captionObserver?.disconnect(); } catch (_) { }
    }
  });
  captionObserver.observe(document.body, {
    childList: true, subtree: true, characterData: true
  });
}

// ══════════════════════════════════════════════
// 9. INICIAR / PARAR GRAVAÇÃO
// ══════════════════════════════════════════════
function startRecording() {
  if (isRecording) return;
  isRecording = true;
  lastSentMap.clear();

  [0, 1000, 2000, 3500, 6000].forEach(d =>
    setTimeout(() => { if (_checkCtx() && isRecording && !captionsEnabled) enableCaptions(); }, d)
  );
  startObserver();
  safeInterval(() => {
    if (!isRecording) return;
    captureCaptions();
  }, 2000);
  send({ action: 'recordingStarted' });
}

function stopRecording() {
  if (!isRecording) return;
  isRecording = false;
  if (captionObserver) {
    try { captionObserver.disconnect(); } catch (_) { }
    captionObserver = null;
  }
  captionsEnabled = false;
  send({ action: 'recordingStopped' });
}

// ══════════════════════════════════════════════
// 10. OUVIR MENSAGENS DO POPUP
// ══════════════════════════════════════════════
if (_checkCtx()) {
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!_checkCtx()) return;

    if (msg.action === 'startRecording') {
      startRecording();
      sendResponse({ ok: true });
    }

    if (msg.action === 'stopRecording') {
      stopRecording();
      sendResponse({ ok: true });
    }

    if (msg.action === 'getStatus') {
      sendResponse({
        meetingStarted,
        isRecording,
        meetingCode: getCode(),
        myName: myRealName,
      });
    }
  });
}

// ══════════════════════════════════════════════
// 11. FIM DA REUNIÃO
// ══════════════════════════════════════════════
function onEnd() {
  if (!meetingStarted) return;
  meetingStarted = false;
  if (isRecording) stopRecording();
  send({ action: 'meetingEnded' });
  stopAll();
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
// 12. INICIAR REUNIÃO
// ══════════════════════════════════════════════
function onStart(code) {
  if (meetingStarted) return;
  if (!_checkCtx()) return;
  meetingStarted = true;
  myRealName = getMyName();
  send({ action: 'meetingStarted', meetingCode: code });
  sendParticipants();
  safeInterval(() => {
    if (!meetingStarted) return;
    if (!myRealName) myRealName = getMyName();
    sendParticipants();
  }, 8000);
  watchEnd();
}

safeInterval(() => {
  if (meetingStarted) return;
  if (getCode() && insideMeeting()) onStart(getCode());
}, 1500);

// ══════════════════════════════════════════════
// KEEPALIVE
// ══════════════════════════════════════════════
let _keepalivePort = null;

function startKeepalive() {
  if (_keepalivePort) return;
  if (!_checkCtx()) return;
  try {
    _keepalivePort = chrome.runtime.connect({ name: 'keepalive' });
    _keepalivePort.onDisconnect.addListener(() => {
      _keepalivePort = null;
    });
    safeInterval(() => {
      if (!_keepalivePort || !_checkCtx()) return;
      try { _keepalivePort.postMessage({ type: 'ping' }); } catch (_) { }
    }, 25000);
  } catch (e) {
    _keepalivePort = null;
  }
}

startKeepalive();