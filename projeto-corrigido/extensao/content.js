/*
================================================
MEETAI — content.js (PRESERVAÇÃO TOTAL + V8)
================================================
Mantém 100% da lógica original (Patch Nuclear, Heurísticas, Keepalive)
Injeta V8:
1. Filtro de Idiomas (ex: ignora "(Brasil)")
2. Dicionário expandido de lixo UI (format_size, circle, beta, etc)
3. Visibilidade real (ignora role="menuitem")
4. Limpeza robusta de Eco ("Você: Você texto")
5. EXTRATOR DE DELTA (Fix Definitivo para Repetição Cumulativa do Meet)
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
// 4. ATIVAR LEGENDAS
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
// 5. ESCONDER LEGENDAS (VISUAL APENAS)
// ══════════════════════════════════════════════
function hideOrMinimizeCaptions() {
  const id = 'meetai-visual-style';
  if (document.getElementById(id)) return;
  const style = document.createElement('style');
  style.id = id;
  // Oculta da tela, mas permite captura no DOM
  style.innerHTML = `.a4cQT, .pV6u9e, .iOzk7 { opacity: 0 !important; height: 1px !important; pointer-events: none !important; position: absolute !important; }`;
  document.head.appendChild(style);
  console.log('[MeetAI] 👻 Legendas ocultadas visualmente.');
}

// ══════════════════════════════════════════════
// 6. CAPTURAR LEGENDAS (BLINDADO)
// ══════════════════════════════════════════════
let _autoContainer = null;

const UI_PREFIXES = [
  'adicionar outras', 'add others', 'convidar pessoas', 'invite people',
  'copiar link', 'copy link', 'entrou na', 'saiu da', 'joined the', 'left the',
  'está aguardando', 'is waiting', 'foi admitido', 'was admitted',
  'você está', 'you are', 'sua câmera', 'your camera', 'seu microfone', 'your mic',
  'ativar legenda', 'turn on caption', 'desativar legenda', 'turn off caption',
  'gravação iniciada', 'recording started', 'gravação encerrada',
  'ainda sem mensagens', 'voltar à tela inicial',
  'abrir:', 'confiável:', 'ninguém precisa pedir', 'qualquer pessoa pode ligar',
  'idioma da reunião', 'language', 'português', 'sem legendas', 'legenda instantânea',
  'mostra legendas para', 'personalizar as legendas', 'tamanho da fonte', 'padrão',
  'cor da fonte', 'cor do plano de fundo', 'redefinir', 'fonte'
];

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
  'joined', 'left', 'aguardando', 'waiting', 'admitir',
  'silenciar', 'silencioso', 'mensagem', 'message', 'notificação',
  'branco', 'preto', 'azul', 'verde', 'vermelho', 'amarelo', 'ciano', 'magenta',
  'circle', 'settings', 'format_size', 'language', 'beta', 'tamanho', 'fonte', 'configurações',
  'padrão', 'moderado', 'enorme', 'gigante'
]);

function isUIText(text) {
  if (!text) return true;
  const t = text.toLowerCase().trim();
  if (t.length < 2) return true;
  
  if (/\([a-z\u00C0-\u00FF\s]+\)/i.test(t)) return true;
  if (UI_WORDS.has(t)) return true;
  if (UI_PREFIXES.some(p => t.startsWith(p))) return true;
  const words = t.split(/\s+/);
  if (words.length <= 3 && words.every(w => UI_WORDS.has(w))) return true;
  return false;
}

function cleanSpeech(text, speaker) {
  let clean = text.trim();
  const s = speaker ? speaker.trim() : "";
  
  // Limpa "Você:" ou "You:"
  clean = clean.replace(/^(você|you)\s*[:\-\s]+/gi, '').trim();
  clean = clean.replace(/^(você\s*)+/gi, '').trim();
  
  // Limpa o nome da pessoa no início da frase (MUITO MAIS AGRESSIVO)
  if (s && s.toLowerCase() !== 'você') {
    // Escapa caracteres especiais do nome (ex: se tiver parênteses)
    const escapedName = s.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
    
    // Agora apaga o nome do começo mesmo se NÃO TIVER dois pontos
    const nameRegex = new RegExp(`^${escapedName}\\s*[:\\-\\s]*`, 'gi');
    clean = clean.replace(nameRegex, '').trim();
  }
  
  return clean;
}

function captureCaptions() {
  if (!isRecording) return;

  const ariaEls = document.querySelectorAll('[aria-live]');
  let found = false;
  ariaEls.forEach(el => {
    try {
      if (el.closest('[role="complementary"], .R3G9vc, [role="menu"], [role="menuitem"], [role="toolbar"]')) return;
      if (el.closest('[role="alert"], [role="status"], header, nav')) return;
      
      const text = (el.innerText || el.textContent || '').trim();
      if (!text || text.length < 4 || isUIText(text)) return;
      if (text.split(/\s+/).length < 2) return;

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
      if (container.innerText.includes('Tamanho da fonte') || container.innerText.includes('Cor da fonte')) return;
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
    if (!fullText || fullText.length < 2 || isUIText(fullText)) return;

    let speaker = 'Participante'; 
    let speechText = fullText;

    const parts = Array.from(block.querySelectorAll('div, span'))
      .map(el => el.innerText.trim())
      .filter(t => t.length > 0);

    if (parts.length >= 2) {
      const potentialName = parts[0];
      const rest = parts.slice(1).join(' ').trim();

      if (potentialName.length < 40 && rest.length > 1 && !isUIText(potentialName)) {
        speaker = potentialName;
        speechText = cleanSpeech(rest, speaker);
      } else {
        speaker = myRealName || 'Você';
        speechText = cleanSpeech(fullText, speaker);
      }
    } else {
      speaker = myRealName || 'Você';
      speechText = cleanSpeech(fullText, speaker);
    }

    if (speechText.length > 1 && !isUIText(speechText)) {
      sendTranscript(speechText, speaker);
    }
  } catch (e) {
    console.warn('[MeetAI] Erro na extração:', e);
  }
}

function captureByHeuristic() {
  if (_autoContainer && document.contains(_autoContainer)) {
    extractFromContainer(_autoContainer);
    return;
  }
  _autoContainer = null;
  const ariaLive = document.querySelector('[aria-live="polite"], [aria-live="assertive"]');
  if (ariaLive && !ariaLive.closest('[role="complementary"], [role="menu"]')) {
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
      if (!text || text.length < 6 || isUIText(text) || text.split(/\s+/).length < 2) return false;
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
    const cleaned = cleanSpeech(text, myRealName || 'Você');
    if (cleaned.length > 1) sendTranscript(cleaned, myRealName || 'Você');
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
    const cleaned = cleanSpeech(el.innerText.trim(), myRealName || 'Você');
    if (cleaned.length > 1) sendTranscript(cleaned, myRealName || 'Você');
  });
}

// ══════════════════════════════════════════════
// 7. DEDUPLICAÇÃO & EXTRATOR DE DELTA (V8)
// Resolve a falha crônica do Meet repetir texto
// ══════════════════════════════════════════════
const pendingTranscripts = new Map();
const speakerMemory = new Map(); // Lembra a última frase completa dita pelo orador
const memoryTimers = new Map();

function sendTranscript(text, speaker) {
  if (!isRecording) return;
  const cleanText = text.trim();
  if (cleanText.length < 2) return;

  // Cancela timer se a pessoa continuou a falar antes dos 1.5s
  if (pendingTranscripts.has(speaker)) {
    clearTimeout(pendingTranscripts.get(speaker).timer);
  }

  const timer = setTimeout(() => {
    const finalData = pendingTranscripts.get(speaker);
    if (!finalData) return;

    const currentText = finalData.text;
    const previousText = speakerMemory.get(speaker) || "";
    
    let textToSend = currentText;

    // --- ALGORITMO ANTI-REPETIÇÃO CUMULATIVA ---
    // Se temos um texto anterior para este orador, comparamos e extraímos só a parte "nova"
    if (previousText) {
      const norm = (s) => s.toLowerCase().replace(/[^\w\sÀ-ÿ]/gi, '').trim();
      const oldW = previousText.split(/\s+/);
      const newW = currentText.split(/\s+/);
      
      let match = 0;
      for (let i = 0; i < Math.min(oldW.length, newW.length); i++) {
        // Tolerância para formatação/pontuação do Google Meet
        if (norm(oldW[i]) === norm(newW[i])) {
          match++;
        } else if (i === oldW.length - 1 && newW[i].toLowerCase().startsWith(norm(oldW[i]))) {
          // Exemplo: Meet muda "fazendo" para "fazendo..." na última palavra
          match++;
        } else {
          break;
        }
      }
      
      // Se bateu pelo menos parte considerável do texto antigo, cortamos a parte repetida
      if (match > 0 && match >= Math.floor(oldW.length * 0.5)) {
        textToSend = newW.slice(match).join(' ').trim();
      } else if (norm(currentText) === norm(previousText)) {
        textToSend = ""; // Exatamente a mesma frase repetida sem motivo
      }
    }

    // Limpa pontuações isoladas perdidas ("-", ".", etc)
    textToSend = textToSend.replace(/^[^\w\sÀ-ÿ]+/g, '').trim();

    if (textToSend.length > 1) {
      // Salva em memória que enviamos este trecho
      speakerMemory.set(speaker, currentText);
      
      // Limpa a memória após 15 segundos de silêncio do orador
      if (memoryTimers.has(speaker)) clearTimeout(memoryTimers.get(speaker));
      memoryTimers.set(speaker, setTimeout(() => {
         speakerMemory.delete(speaker);
      }, 15000));

      send({ action: 'transcription', text: textToSend, speaker });
      console.log(`[MeetAI] 🚀 DELTA (Palavras Novas) -> ${speaker}: ${textToSend}`);
    }
    
    pendingTranscripts.delete(speaker);
  }, 1500); 

  pendingTranscripts.set(speaker, { text: cleanText, timer });
}

// ══════════════════════════════════════════════
// 8. MUTATION OBSERVER
// ══════════════════════════════════════════════
function startObserver() {
  if (captionObserver) return;
  let throttle = null;
  captionObserver = new MutationObserver(() => {
    try {
      if (_dead) {
        captionObserver?.disconnect();
        captionObserver = null;
        return;
      }
      // Não para quando isRecording=false, apenas ignora
      if (!isRecording) return;
      if (throttle) return;
      // Throttle menor quando em segundo plano para não perder falas
      const delay = document.hidden ? 50 : 100;
      throttle = setTimeout(() => {
        try { throttle = null; captureCaptions(); }
        catch (e) { _dead = true; }
      }, delay);
    } catch (e) {
      _dead = true;
      try { captionObserver?.disconnect(); } catch (_) { }
    }
  });
  captionObserver.observe(document.body, {
    childList: true, subtree: true, characterData: true
  });
  console.log('[MeetAI] 👀 Observer ativo');
}

// ══════════════════════════════════════════════
// 9. INICIAR / PARAR GRAVAÇÃO
// ══════════════════════════════════════════════
function startRecording() {
  if (isRecording) return;
  isRecording = true;
  speakerMemory.clear();

  // Persiste estado para o popup saber mesmo em segundo plano
  try { chrome.storage.local.set({ isRecording: true }); } catch(_) {}

  [0, 1500, 3000].forEach(d =>
    setTimeout(() => { if (_checkCtx() && isRecording && !captionsEnabled) enableCaptions(); }, d)
  );
  startObserver();

  // Polling de backup — garante captura mesmo com throttle em segundo plano
  safeInterval(() => {
    if (!isRecording) return;
    captureCaptions();
  }, 2000);

  // Polling mais agressivo para quando em segundo plano
  safeInterval(() => {
    if (!isRecording) return;
    // Só executa se a aba estiver oculta (em segundo plano)
    if (document.hidden) captureCaptions();
  }, 500);

  send({ action: 'recordingStarted' });
  console.log('[MeetAI] ▶ Gravação iniciada');
}

function stopRecording() {
  if (!isRecording) return;
  isRecording = false;
  if (captionObserver) {
    try { captionObserver.disconnect(); } catch (_) { }
    captionObserver = null;
  }
  captionsEnabled = false;

  // Limpa estado no storage
  try { chrome.storage.local.set({ isRecording: false }); } catch(_) {}

  send({ action: 'recordingStopped' });
  console.log('[MeetAI] ⏹ Gravação parada');
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
  try { chrome.storage.local.set({ isRecording: false }); } catch(_) {}
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