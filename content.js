/*
================================================
MEETAI — content.js (v10 — opacity-only hide + PT-BR retry)
================================================
CORREÇÕES:
1. Idioma PT-BR forçado nas legendas do Meet
2. Speaker capturado do nome de login da conta Google
3. Legendas originais do Meet ocultadas corretamente
4. Estado de gravação sobrevive troca de aba
5. Algoritmo delta aprimorado contra repetições
6. Watchdog e keepalive mais robustos
================================================
*/

const _intervals = new Set();
const _origSet   = window.setInterval;
const _origClear = window.clearInterval;

window.setInterval = function (fn, ms, ...a) {
  const id = _origSet.call(window, function () {
    if (!_checkCtx()) { _origClear(id); _intervals.delete(id); return; }
    try { fn(...a); } catch (e) { _origClear(id); _intervals.delete(id); }
  }, ms);
  _intervals.add(id);
  return id;
};
window.clearInterval = function (id) { _intervals.delete(id); _origClear.call(window, id); };

function _checkCtx() {
  try { return typeof chrome !== 'undefined' && !!chrome.runtime && !!chrome.runtime.id; }
  catch (e) { return false; }
}
function _killAll() { for (const id of _intervals) _origClear(id); _intervals.clear(); }

let _ctxDead = false;
const _watchdog = _origSet.call(window, () => {
  if (_ctxDead) return;
  if (!_checkCtx()) { _ctxDead = true; _killAll(); _origClear(_watchdog); }
}, 500);

let _dead = false;

// Estado global
let meetingStarted  = false;
let isRecording     = false;
let myRealName      = null;
let captionObserver = null;
let captionsEnabled = false;

function send(msg) {
  if (!_checkCtx()) return;
  try { chrome.runtime.sendMessage(msg).catch(() => {}); } catch (_) {}
}

function safeInterval(fn, ms) {
  const id = setInterval(() => {
    if (_dead) { clearInterval(id); return; }
    try { fn(); } catch (e) { _dead = true; clearInterval(id); }
  }, ms);
  return id;
}

function stopAll() {
  _dead = true;
  stopRecording();
  meetingStarted = false;
  try { document.getElementById('meetai-style')?.remove(); } catch (_) {}
}

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

// ── CAPTURA NOME DE LOGIN DO GOOGLE ──────────────────────
function getMyName() {
  // 1. Atributo data-self-name
  const selfAttr = document.querySelector('[data-self-name]');
  if (selfAttr) {
    const n = selfAttr.getAttribute('data-self-name')?.trim();
    if (n && n.length > 1) return n;
  }
  // 2. Tile com "(você)" ou "(you)" no aria-label
  for (const tile of document.querySelectorAll('[data-participant-id]')) {
    const label = tile.getAttribute('aria-label') || '';
    if (label.includes('(você)') || label.includes('(you)')) {
      const n = label.replace(/\s*\(você\)|\s*\(you\)/gi, '').trim();
      if (n && n.length > 1) return n;
    }
  }
  // 3. Barra superior
  const topEl = document.querySelector('.adnwBd, .SK997c');
  if (topEl) {
    const n = topEl.innerText?.split('\n')[0]?.trim();
    if (n && n.length > 1) return n;
  }
  // 4. Primeiro tile
  for (const tile of document.querySelectorAll('[data-participant-id]')) {
    const n = tile.innerText?.split('\n')[0]?.trim();
    if (n && n.length > 1 && n.length < 60) return n;
  }
  return null;
}

function sendParticipants() {
  const seen = new Set();
  document.querySelectorAll('[data-participant-id], .ZjO7Rb').forEach(el => {
    const n = el.innerText?.split('\n')[0]?.trim();
    if (n && n.length > 1 && n.length < 60) seen.add(n);
  });
  if (myRealName) seen.add(myRealName);
  if (seen.size > 0) send({ action: 'participants', list: [...seen] });
}

// ── ATIVAR LEGENDAS + FORÇAR PT-BR ───────────────────────
function enableCaptions() {
  if (captionsEnabled) return;
  const sels = [
    '[aria-label*="Ativar legendas"]','[aria-label*="Ativar legenda"]',
    '[aria-label*="Ativar transcrição"]','[aria-label*="Turn on captions"]',
    '[aria-label*="captions"]','[jsname="r8qRAd"]',
    '[data-tooltip*="legenda"]','[data-tooltip*="captions"]',
  ];
  for (const sel of sels) {
    const btn = document.querySelector(sel);
    if (!btn) continue;
    const isActive = btn.getAttribute('aria-pressed') === 'true' ||
      btn.classList.contains('VfPpkd-ksW4S-mWP9Q-OWXEXe-Tv89id');
    if (isActive) {
      captionsEnabled = true;
      setTimeout(forcarPTBR, 1000);
      setTimeout(ocultarLegendas, 1500);
      return;
    }
    try {
      btn.click();
      btn.dispatchEvent(new MouseEvent('click', { view: window, bubbles: true, cancelable: true }));
      captionsEnabled = true;
      setTimeout(forcarPTBR, 2000);
      setTimeout(ocultarLegendas, 2500);
      return;
    } catch (e) {}
  }
}

function forcarPTBR(tentativa = 0) {
  if (tentativa > 5) return; // máximo 5 tentativas
  const langBtn = document.querySelector(
    '[jsname="V68bde"],[aria-label*="Idioma das legendas"],[aria-label*="Caption language"],' +
    '[aria-label*="caption language"],[data-tooltip*="idioma"],[data-tooltip*="language"]'
  );
  if (!langBtn) {
    // Tenta de novo em 3s — botão pode ainda não ter aparecido
    setTimeout(() => forcarPTBR(tentativa + 1), 3000);
    return;
  }
  try {
    langBtn.click();
    setTimeout(() => {
      const opts = document.querySelectorAll('[role="option"],[role="menuitem"],[role="radio"],li');
      let selecionou = false;
      opts.forEach(opt => {
        const txt = (opt.innerText || opt.textContent || '').trim();
        if (txt.includes('Português') || txt.includes('Portuguese (Brazil)') || txt.includes('pt-BR')) {
          opt.click();
          selecionou = true;
          console.log('[MeetAI] 🌎 PT-BR ativado nas legendas');
        }
      });
      // Se não achou a opção, tenta de novo
      if (!selecionou) {
        // Fecha menu atual
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        setTimeout(() => forcarPTBR(tentativa + 1), 4000);
      }
    }, 1000);
  } catch (_) {
    setTimeout(() => forcarPTBR(tentativa + 1), 3000);
  }
}

// ── OCULTAR LEGENDAS (DOM intacto para captura) ──────────
function ocultarLegendas() {
  const id = 'meetai-caption-style';
  if (document.getElementById(id)) return;
  const s = document.createElement('style');
  s.id = id;
  // IMPORTANTE: usa apenas opacity e visibility — NÃO altera height/position
  // porque o Meet monitora dimensões e desativa legendas se sumirem da tela
  s.textContent = `
    .a4cQT,.pV6u9e,.iOzk7,[jsname="dsyhDe"],.vNKgIf,.CNusmb,.Mz6pEf {
      opacity:0!important;
      visibility:hidden!important;
      pointer-events:none!important;
    }`;
  document.head.appendChild(s);
  console.log('[MeetAI] 👻 Legendas ocultadas (opacity only).');
}

// Re-aplica caso o Meet remova
safeInterval(() => {
  if (!isRecording) return;
  if (!document.getElementById('meetai-caption-style')) ocultarLegendas();
}, 3000);

// ── FILTROS UI ────────────────────────────────────────────
const UI_PREFIXES = [
  'adicionar outras','add others','convidar pessoas','invite people',
  'copiar link','copy link','entrou na','saiu da','joined the','left the',
  'está aguardando','is waiting','foi admitido','was admitted',
  'você está','you are','sua câmera','your camera','seu microfone','your mic',
  'ativar legenda','turn on caption','desativar legenda','turn off caption',
  'gravação iniciada','recording started','gravação encerrada',
  'ainda sem mensagens','voltar à tela inicial',
  'idioma da reunião','language','português','sem legendas','legenda instantânea',
  'tamanho da fonte','cor da fonte','cor do plano de fundo','redefinir','fonte'
];
const UI_WORDS = new Set([
  'mic','microfone','microphone','câmera','camera','video','vídeo',
  'chat','participantes','participants','ativar','desativar',
  'enable','disable','mute','unmute','share','compartilhar',
  'tela','screen','mais','more','opções','options','sair','leave',
  'encerrar','end','levantar','raise','hand','mão','emoção','emoji',
  'reaction','caption','legenda','transcrição','transcript',
  'recording','gravar','gravação','present','apresentar',
  'breakout','whiteboard','poll','enquete','q&a',
  'adicionar','pessoas','add','people','convidar','invite',
  'copiar','copy','link','reunião','meeting','entrou','saiu',
  'joined','left','aguardando','waiting','admitir',
  'silenciar','silencioso','mensagem','message','notificação',
  'circle','settings','format_size','language','beta','tamanho','fonte',
  'configurações','padrão','moderado','enorme','gigante'
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
  const s = (speaker || '').trim();
  clean = clean.replace(/^(você|you)\s*[:\-\s]+/gi, '').trim();
  clean = clean.replace(/^(você\s*)+/gi, '').trim();
  if (s && s.toLowerCase() !== 'você') {
    const esc = s.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
    clean = clean.replace(new RegExp(`^${esc}\\s*[:\\-\\s]*`, 'gi'), '').trim();
  }
  return clean;
}

// ── CAPTURA ───────────────────────────────────────────────
let _autoContainer = null;

function captureCaptions() {
  if (!isRecording) return;
  const containers = document.querySelectorAll(
    '.iOzk7,[jsname="dsyhDe"],.vNKgIf,[jscontroller="KPn5nb"],.a4cQT,.CNusmb,.Mz6pEf'
  );
  if (containers.length > 0) {
    containers.forEach(c => {
      if (c.innerText.includes('Tamanho da fonte') || c.innerText.includes('Cor da fonte')) return;
      const blocks = c.querySelectorAll('.nMcdL,[jsname="tS999c"],.TBMuR,.iTTPOb');
      (blocks.length ? blocks : [c]).forEach(b => extractBlock(b));
    });
    return;
  }
  const ariaEls = document.querySelectorAll('[aria-live]');
  let found = false;
  ariaEls.forEach(el => {
    try {
      if (el.closest('[role="complementary"],.R3G9vc,[role="menu"],[role="menuitem"],[role="toolbar"]')) return;
      if (el.closest('[role="alert"],[role="status"],header,nav')) return;
      const text = (el.innerText || el.textContent || '').trim();
      if (!text || text.length < 4 || isUIText(text) || text.split(/\s+/).length < 2) return;
      const blocks = el.children.length > 0 ? [...el.children] : [el];
      blocks.forEach(b => { try { extractBlock(b); } catch (_) {} });
      found = true;
    } catch (_) {}
  });
  if (!found) captureByHeuristic();
}

function extractBlock(block) {
  try {
    if (!block || typeof block.innerText === 'undefined') return;
    const fullText = (block.innerText || '').trim();
    if (!fullText || fullText.length < 2 || isUIText(fullText)) return;

    let speaker   = myRealName || 'Participante';
    let speechText = fullText;

    // Seletor específico de speaker do Meet
    const speakerEl = block.querySelector('.zs7s8d,.NWpY1d,[jsname="bVMoob"]');
    if (speakerEl) {
      const n = speakerEl.innerText?.trim();
      if (n && n.length > 0 && n.length < 60 && !isUIText(n)) {
        speaker = n;
        const clone = block.cloneNode(true);
        clone.querySelector('.zs7s8d,.NWpY1d,[jsname="bVMoob"]')?.remove();
        speechText = cleanSpeech((clone.innerText || '').trim(), speaker);
      }
    } else {
      const parts = Array.from(block.querySelectorAll('div,span'))
        .map(el => el.innerText?.trim()).filter(t => t && t.length > 0);
      if (parts.length >= 2) {
        const potentialName = parts[0];
        const rest = parts.slice(1).join(' ').trim();
        if (potentialName.length < 40 && rest.length > 1 && !isUIText(potentialName)) {
          speaker    = potentialName;
          speechText = cleanSpeech(rest, speaker);
        } else {
          speechText = cleanSpeech(fullText, speaker);
        }
      } else {
        speechText = cleanSpeech(fullText, speaker);
      }
    }

    if (speechText.length > 1 && !isUIText(speechText)) sendTranscript(speechText, speaker);
  } catch (e) { console.warn('[MeetAI] extractBlock error:', e); }
}

function captureByHeuristic() {
  if (_autoContainer && document.contains(_autoContainer)) {
    extractFromContainer(_autoContainer); return;
  }
  _autoContainer = null;
  const al = document.querySelector('[aria-live="polite"],[aria-live="assertive"]');
  if (al && !al.closest('[role="complementary"],[role="menu"]')) {
    const t = al.innerText?.trim();
    if (t && t.length > 3 && !isUIText(t)) { _autoContainer = al; extractFromContainer(al); return; }
  }
  const viewH = window.innerHeight;
  const spans = [...document.querySelectorAll('span,div')].filter(el => {
    if (!el.offsetParent) return false;
    if (el.closest('button,[role="button"],[role="menuitem"],header,nav,[role="toolbar"]')) return false;
    const r = el.getBoundingClientRect();
    if (r.top < viewH * 0.45 || r.top > viewH * 0.92) return false;
    if (r.height < 10 || r.height > 150) return false;
    if (el.children.length > 2) return false;
    const t = el.innerText?.trim();
    return t && t.length >= 6 && !isUIText(t) && t.split(/\s+/).length >= 2;
  });
  if (!spans.length) return;
  const byTop = {};
  spans.forEach(el => {
    const top = Math.round(el.getBoundingClientRect().top / 30) * 30;
    if (!byTop[top]) byTop[top] = [];
    byTop[top].push(el);
  });
  const best = Object.values(byTop).reduce((a, b) => a.length >= b.length ? a : b, []);
  best.forEach(el => {
    const t = el.innerText?.trim();
    if (!t || isUIText(t)) return;
    const c = cleanSpeech(t, myRealName || 'Você');
    if (c.length > 1) sendTranscript(c, myRealName || 'Você');
  });
}

function extractFromContainer(c) {
  [...c.querySelectorAll('span,div')].filter(el => {
    if (el.children.length > 2) return false;
    const t = el.innerText?.trim();
    return t && t.length > 5 && !isUIText(t) && t.split(/\s+/).length >= 2;
  }).forEach(el => {
    const c2 = cleanSpeech(el.innerText.trim(), myRealName || 'Você');
    if (c2.length > 1) sendTranscript(c2, myRealName || 'Você');
  });
}

// ── DEDUPLICAÇÃO / DELTA ──────────────────────────────────
const pendingTranscripts = new Map();
const speakerMemory      = new Map();
const memoryTimers       = new Map();

function sendTranscript(text, speaker) {
  if (!isRecording) return;
  const cleanText = text.trim();
  if (cleanText.length < 2) return;
  if (pendingTranscripts.has(speaker)) clearTimeout(pendingTranscripts.get(speaker).timer);
  const timer = setTimeout(() => {
    const fd = pendingTranscripts.get(speaker);
    if (!fd) return;
    const cur  = fd.text;
    const prev = speakerMemory.get(speaker) || '';
    let out    = cur;
    if (prev) {
      const norm = s => s.toLowerCase().replace(/[^\w\sÀ-ÿ]/gi, '').trim();
      const oW = prev.split(/\s+/), nW = cur.split(/\s+/);
      let m = 0;
      for (let i = 0; i < Math.min(oW.length, nW.length); i++) {
        if (norm(oW[i]) === norm(nW[i])) m++;
        else if (i === oW.length - 1 && nW[i].toLowerCase().startsWith(norm(oW[i]))) m++;
        else break;
      }
      if (m > 0 && m >= Math.floor(oW.length * 0.5)) out = nW.slice(m).join(' ').trim();
      else if (norm(cur) === norm(prev)) out = '';
    }
    out = out.replace(/^[^\w\sÀ-ÿ]+/g, '').trim();
    if (out.length > 1) {
      speakerMemory.set(speaker, cur);
      if (memoryTimers.has(speaker)) clearTimeout(memoryTimers.get(speaker));
      memoryTimers.set(speaker, setTimeout(() => speakerMemory.delete(speaker), 15000));
      send({ action: 'transcription', text: out, speaker });
      console.log(`[MeetAI] 🚀 ${speaker}: ${out}`);
    }
    pendingTranscripts.delete(speaker);
  }, 1500);
  pendingTranscripts.set(speaker, { text: cleanText, timer });
}

// ── OBSERVER ─────────────────────────────────────────────
function startObserver() {
  if (captionObserver) return;
  let throttle = null;
  captionObserver = new MutationObserver(() => {
    try {
      if (_dead) { captionObserver?.disconnect(); captionObserver = null; return; }
      if (!isRecording) return;
      if (throttle) return;
      const delay = document.hidden ? 50 : 100;
      throttle = setTimeout(() => { try { throttle = null; captureCaptions(); } catch (e) { _dead = true; } }, delay);
    } catch (e) { _dead = true; try { captionObserver?.disconnect(); } catch (_) {} }
  });
  captionObserver.observe(document.body, { childList: true, subtree: true, characterData: true });
  console.log('[MeetAI] 👀 Observer ativo');
}

// ── GRAVAR / PARAR ────────────────────────────────────────
function startRecording() {
  if (isRecording) return;
  isRecording = true;
  speakerMemory.clear();
  try { chrome.storage.local.set({ isRecording: true }); } catch (_) {}
  if (!myRealName) myRealName = getMyName();
  [0, 1500, 3000].forEach(d =>
    setTimeout(() => { if (_checkCtx() && isRecording && !captionsEnabled) enableCaptions(); }, d)
  );
  startObserver();
  safeInterval(() => { if (!isRecording) return; captureCaptions(); }, 2000);
  safeInterval(() => { if (!isRecording) return; if (document.hidden) captureCaptions(); }, 500);
  safeInterval(() => { if (!myRealName) myRealName = getMyName(); }, 5000);
  send({ action: 'recordingStarted' });
  console.log('[MeetAI] ▶ Iniciada — usuário:', myRealName || '(desconhecido)');
}

function stopRecording() {
  if (!isRecording) return;
  isRecording = false;
  if (captionObserver) { try { captionObserver.disconnect(); } catch (_) {} captionObserver = null; }
  captionsEnabled = false;
  try { chrome.storage.local.set({ isRecording: false }); } catch (_) {}
  send({ action: 'recordingStopped' });
  console.log('[MeetAI] ⏹ Parada');
}

// ── MENSAGENS ─────────────────────────────────────────────
if (_checkCtx()) {
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!_checkCtx()) return;
    if (msg.action === 'startRecording') { startRecording(); sendResponse({ ok: true, myName: myRealName }); }
    if (msg.action === 'stopRecording')  { stopRecording();  sendResponse({ ok: true }); }
    if (msg.action === 'getStatus') {
      sendResponse({ meetingStarted, isRecording, meetingCode: getCode(), myName: myRealName });
    }
    return true;
  });
}

// ── FIM DA REUNIÃO ────────────────────────────────────────
function onEnd() {
  if (!meetingStarted) return;
  meetingStarted = false;
  if (isRecording) stopRecording();
  try { chrome.storage.local.set({ isRecording: false }); } catch (_) {}
  send({ action: 'meetingEnded' });
  stopAll();
}

function watchEnd() {
  let lastUrl = location.href;
  safeInterval(() => {
    if (!meetingStarted) return;
    if (location.href !== lastUrl) { lastUrl = location.href; if (!getCode()) onEnd(); }
  }, 1000);
  document.addEventListener('click', (e) => {
    if (_dead) return;
    const btn = e.target.closest('button');
    if (!btn) return;
    const lbl = (btn.getAttribute('aria-label') || '').toLowerCase();
    if (lbl.includes('sair') || lbl.includes('leave') || lbl.includes('end call')) setTimeout(onEnd, 2000);
  }, true);
}

function onStart(code) {
  if (meetingStarted) return;
  if (!_checkCtx()) return;
  meetingStarted = true;
  myRealName = getMyName();
  send({ action: 'meetingStarted', meetingCode: code, myName: myRealName });
  sendParticipants();
  safeInterval(() => {
    if (!meetingStarted) return;
    if (!myRealName) myRealName = getMyName();
    sendParticipants();
  }, 8000);
  watchEnd();
}

safeInterval(() => { if (meetingStarted) return; if (getCode() && insideMeeting()) onStart(getCode()); }, 1500);

// ── KEEPALIVE ─────────────────────────────────────────────
let _keepalivePort = null;
function startKeepalive() {
  if (_keepalivePort) return;
  if (!_checkCtx()) return;
  try {
    _keepalivePort = chrome.runtime.connect({ name: 'keepalive' });
    _keepalivePort.onDisconnect.addListener(() => { _keepalivePort = null; });
    safeInterval(() => {
      if (!_keepalivePort || !_checkCtx()) return;
      try { _keepalivePort.postMessage({ type: 'ping' }); } catch (_) {}
    }, 25000);
  } catch (e) { _keepalivePort = null; }
}
startKeepalive();
