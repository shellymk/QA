/*
================================================
MEETAI — content.js (v11 — CORRIGIDO)
================================================
CORREÇÕES:
1. Idioma PT-BR forçado com retry robusto
2. autoStart lido UMA VEZ ao carregar (não só no onStart)
3. Chamada do bot REMOVIDA daqui — fica só no background.js
4. URL enviada ao bot sem ?hl=en (causava legendas em inglês)
5. Speaker capturado do nome de login da conta Google
6. Legendas originais do Meet ocultadas corretamente
7. Estado de gravação sobrevive troca de aba
8. Algoritmo delta aprimorado contra repetições
9. Watchdog e keepalive mais robustos
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

// ── autoStart lido UMA VEZ ao carregar ─────────────────────────────────────
// CORREÇÃO #2: antes era lido só dentro de onStart, causando race condition
let autoStartEnabled = false;
if (_checkCtx()) {
  chrome.storage.local.get(['autoStart'], (data) => {
    autoStartEnabled = data.autoStart === true;
  });
  // Atualiza sempre que o popup mudar o valor
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.autoStart !== undefined) {
      autoStartEnabled = changes.autoStart.newValue === true;
    }
  });
}

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
  const selfAttr = document.querySelector('[data-self-name]');
  if (selfAttr) {
    const n = selfAttr.getAttribute('data-self-name')?.trim();
    if (n && n.length > 1) return n;
  }
  for (const tile of document.querySelectorAll('[data-participant-id]')) {
    const label = tile.getAttribute('aria-label') || '';
    if (label.includes('(você)') || label.includes('(you)')) {
      const n = label.replace(/\s*\(você\)|\s*\(you\)/gi, '').trim();
      if (n && n.length > 1) return n;
    }
  }
  const topEl = document.querySelector('.adnwBd, .SK997c');
  if (topEl) {
    const n = topEl.innerText?.split('\n')[0]?.trim();
    if (n && n.length > 1) return n;
  }
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
function enableCaptions(tentativa) {
  tentativa = tentativa || 0;
  if (captionsEnabled) return;
  if (tentativa > 10) { console.warn('[MeetAI] Legendas: máximo de tentativas'); return; }

  // Primeiro verifica se legendas já estão ativas no DOM
  const containerAtivo = document.querySelector(
    '.iOzk7,[jsname="dsyhDe"],.vNKgIf,.CNusmb,.a4cQT,.Mz6pEf'
  );
  if (containerAtivo) {
    captionsEnabled = true;
    console.log('[MeetAI] 📺 Legendas já ativas (container no DOM)');
    tentarForcarPTBR(0);
    setTimeout(() => ocultarLegendas(), 500);
    return;
  }

  // Seletores APENAS para ligar — exclui "Desativar" explicitamente
  const sels = [
    '[aria-label="Ativar legendas"]',
    '[aria-label="Ativar legenda"]',
    '[aria-label="Ativar transcrição"]',
    '[aria-label="Turn on captions"]',
    '[aria-label="Turn on closed captions"]',
    '[aria-label*="Ativar legenda instantânea"]',
    '[jsname="r8qRAd"]',
  ];

  for (const sel of sels) {
    const btn = document.querySelector(sel);
    if (!btn) continue;

    // Garante que é botão de LIGAR (aria-pressed false ou ausente)
    const pressed = btn.getAttribute('aria-pressed');
    if (pressed === 'true') {
      // Botão está no estado "ativo" = legendas já ligadas
      captionsEnabled = true;
      console.log('[MeetAI] 📺 Legendas já ativas (aria-pressed=true)');
      tentarForcarPTBR(0);
      setTimeout(() => ocultarLegendas(), 500);
      return;
    }

    try {
      btn.click();
      captionsEnabled = true;
      console.log('[MeetAI] 📺 Legendas ativadas via:', sel);
      tentarForcarPTBR(0);
      setTimeout(() => ocultarLegendas(), 2000);
      return;
    } catch (e) {}
  }

  // Fallback: procura qualquer botão com texto de legenda que não seja "Desativar"
  const allBtns = document.querySelectorAll('button[aria-label]');
  for (const btn of allBtns) {
    const lbl = btn.getAttribute('aria-label') || '';
    const lblLow = lbl.toLowerCase();
    // Só clica se for para LIGAR (não contém "desativar" nem "turn off")
    if ((lblLow.includes('legenda') || lblLow.includes('caption') || lblLow.includes('transcript')) &&
        !lblLow.includes('desativar') && !lblLow.includes('turn off') && !lblLow.includes('disable')) {
      const pressed = btn.getAttribute('aria-pressed');
      if (pressed === 'true') {
        captionsEnabled = true;
        tentarForcarPTBR(0);
        setTimeout(() => ocultarLegendas(), 500);
        return;
      }
      try {
        btn.click();
        captionsEnabled = true;
        console.log('[MeetAI] 📺 Legendas ativadas (fallback):', lbl);
        tentarForcarPTBR(0);
        setTimeout(() => ocultarLegendas(), 2000);
        return;
      } catch(e) {}
    }
  }

  console.log('[MeetAI] ⏳ Botão de legenda não encontrado, tentativa', tentativa + 1);
  setTimeout(() => enableCaptions(tentativa + 1), 2000);
}

function confirmarEOcultar() {
  const containerAtivo = document.querySelector(
    '.iOzk7,[jsname="dsyhDe"],.vNKgIf,.CNusmb,.a4cQT'
  );
  if (containerAtivo) {
    ocultarLegendas();
  } else {
    setTimeout(() => {
      if (document.querySelector('.iOzk7,[jsname="dsyhDe"],.vNKgIf,.CNusmb,.a4cQT')) {
        ocultarLegendas();
      }
    }, 3000);
  }
}

// FIX PT-BR: 3 estratégias em cascata, retry até conseguir
function tentarForcarPTBR(tentativa) {
  if (tentativa > 12) { console.warn('[MeetAI] PT-BR: desistindo após 12 tentativas'); return; }
  const delay = tentativa === 0 ? 2000 : Math.min(3000 * tentativa, 15000);
  setTimeout(() => {
    const ok = forcarPTBR();
    if (!ok) {
      console.log('[MeetAI] PT-BR tentativa ' + (tentativa+1) + '/12...');
      tentarForcarPTBR(tentativa + 1);
    }
  }, delay);
}

function forcarPTBR() {
  // Estratégia 1: injetar via localStorage antes das legendas iniciarem
  try {
    localStorage.setItem('yt-player-captionstrackSettings', JSON.stringify({ translationLanguage: null, trackKind: 'asr', displayedLanguage: 'pt-BR' }));
    localStorage.setItem('subtitles-preferred-languages', 'pt-BR');
    localStorage.setItem('CAPTION_SETTINGS', JSON.stringify({ language: 'pt-BR' }));
    localStorage.setItem('CAPTION_LANGUAGE', 'pt-BR');
  } catch (_) {}

  // Estratégia 2: clicar no botão de idioma (vários seletores)
  const langSelectors = [
    '[jsname="V68bde"]',
    '[aria-label*="Idioma das legendas"]',
    '[aria-label*="Caption language"]',
    '[aria-label*="caption language"]',
    '[data-tooltip*="language"]',
    '[data-tooltip*="idioma"]',
  ];
  let langBtn = null;
  for (const sel of langSelectors) {
    const el = document.querySelector(sel);
    if (el) { langBtn = el; break; }
  }

  if (!langBtn) return false;

  try {
    langBtn.click();
    setTimeout(() => {
      // Procura opção PT-BR no menu aberto
      const opts = document.querySelectorAll(
        '[role="option"],[role="menuitem"],[role="radio"],li,[role="listitem"]'
      );
      let selecionou = false;
      for (const opt of opts) {
        const txt = (opt.innerText || opt.textContent || '').toLowerCase();
        if (txt.includes('português') || txt.includes('portuguese') || txt.includes('pt-br')) {
          opt.click();
          selecionou = true;
          console.log('[MeetAI] PT-BR ativado!');
          break;
        }
      }
      if (!selecionou) {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      }
    }, 800);
    return true;
  } catch (_) { return false; }
}

// ── OCULTAR LEGENDAS (DOM intacto para captura) ──────────
function ocultarLegendas() {
  const id = 'meetai-caption-style';
  document.getElementById(id)?.remove();
  const s = document.createElement('style');
  s.id = id;
  // Oculta o painel de legendas visualmente MAS mantém o DOM intacto
  // para que o observer continue capturando o texto normalmente.
  // clip-path: inset(0 0 100% 0) = corta 100% do topo, invisível mas presente
  // Cobre todos os seletores conhecidos do Meet (muda entre versões)
  s.textContent = `
    .iOzk7,
    [jsname="dsyhDe"],
    .vNKgIf,
    .CNusmb,
    .a4cQT,
    .Mz6pEf,
    .TBMuR,
    .pV6u9e,
    .Mz6pEf,
    [jscontroller="xXj8Db"],
    [jscontroller="KPn5nb"],
    [jscontroller="F8DlTe"],
    c-wiz[jscontroller*="caption"],
    c-wiz[jscontroller*="Caption"],
    div[jsname="tgaKEf"],
    div[jsname="BjtuNd"],
    div[jsname="SxSOfb"],
    div.TBMuR,
    div.KF4T6b {
      clip-path: inset(0 0 100% 0) !important;
      pointer-events: none !important;
      user-select: none !important;
    }
  `;
  document.head.appendChild(s);
}

// Reaplica a cada 500ms — Meet pode recriar o container ao mudar de aba
safeInterval(() => {
  ocultarLegendas();
}, 500);

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
  'tamanho da fonte','cor da fonte','cor do plano de fundo','redefinir','fonte',
  'arrow_downward','ir para o fim','go to bottom','scroll to bottom',
  'nova mensagem','new message','press ctrl','pressione ctrl',
  'configurações de áudio','configurações de vídeo','audio settings','video settings',
  // Painel "Controles do organizador" e painel de participantes
  'o painel controles','o painel de controles','host controls panel',
  'as pessoas podem participar','people can join','as pessoas só podem',
  'ninguém precisa pedir','anyone can join','qualquer pessoa pode ligar',
  'qualquer pessoa com o link','anyone with the link',
  'participando como','joining as','confiável','trusted',
  'ou compartilhe este link','share this meeting link',
  'as pessoas que usarem este link','people who use this link',
  'precisarão receber sua permissão','will need your permission',
  'adicionar outras pessoas','add other people',
  'compartilhe este link da reunião',
  'meet.google.com/',
  'content_copy','person_add','person_remove',
  'sua reunião está pronta','your meeting is ready',
  'abrir:','confiável:','trusted:',
  // Notificações de entrada/saída de participantes
  'alguém quer participar','someone wants to join',
  'use o botão','use the button',
  'está participando','is joining','joined the call',
  'saiu da chamada','left the call',
  'o painel','the panel','está aberto','is open',
  'painel pessoas','painel controles','painel chat',
  'people panel','host controls panel','chat panel',
  // Configurações de legenda (aparecem quando bot ativa legendas)
  'inglês','english','format_size','tamanho da fonte',
  'cor da fonte','abrir configurações','open caption settings',
  'circle','settings','language',
  // Notificações de participantes
  'está participando','is now participating',
  'meetai',
];
const UI_WORDS = new Set([
  // Ícones Material que aparecem no DOM do Meet
  'mic','microfone','microphone','câmera','camera','video','vídeo','videocam','videocam_off',
  'chat','participantes','participants','ativar','desativar','enable','disable',
  'mute','unmute','share','compartilhar','tela','screen','mais','more','opções','options',
  'sair','leave','encerrar','end','levantar','raise','hand','mão','emoção','emoji',
  'reaction','caption','legenda','transcrição','transcript','recording','gravar','gravação',
  'present','apresentar','breakout','whiteboard','poll','enquete',
  'adicionar','pessoas','add','people','convidar','invite','copiar','copy','link',
  'reunião','meeting','entrou','saiu','joined','left','aguardando','waiting',
  'silenciar','silencioso','mensagem','message','notificação',
  // Nomes de ícones Material Icons (texto literal que aparece no DOM)
  'keyboard_arrow_up','keyboard_arrow_down','keyboard_arrow_left','keyboard_arrow_right',
  'more_vert','more_horiz','close','info','lock_person','apps','computer','computer_arrow_up',
  'mood','back_hand','closed_caption','open_caption','present_to_all','comment',
  'people','group','person','star','thumb_up','emoji_emotions','sentiment_satisfied',
  'wave','waving_hand','call_end','screen_share','stop_screen_share',
  'settings','configurações','circle','format_size','language','beta',
  'padrão','fonte','tamanho','moderado','enorme','gigante','redefinir',
  'cor da fonte','cor do plano','tamanho da fonte',
]);

function isUIText(text) {
  if (!text) return true;
  const t = text.toLowerCase().trim();
  if (t.length < 2) return true;
  // Atalho de teclado entre parênteses
  if (/^\([a-z0-9\u00C0-\u00FF\s+]+\)$/i.test(t)) return true;
  // Nome de ícone exato
  if (UI_WORDS.has(t)) return true;
  // Prefixo de UI
  if (UI_PREFIXES.some(p => t.startsWith(p))) return true;
  // Contém arrow_downward ou variações (aparecem no chat do Meet)
  if (t.includes('arrow_downward') || t.includes('arrow_forward') ||
      t.includes('ir para o fim') || t.includes('go to bottom')) return true;
  // Linhas que são só nomes de ícones (underscore sem espaço = ícone Material)
  if (/_/.test(t) && !/\s/.test(t)) return true;
  // Palavras únicas que são todas UI
  const words = t.split(/\s+/);
  if (words.length <= 3 && words.every(w => UI_WORDS.has(w))) return true;
  // Texto que é só números, símbolos ou muito curto
  if (t.replace(/[^a-zA-ZÀ-ÿ]/g, '').length < 3) return true;
  // URLs
  if (/https?:\/\/|meet\.google\.com\//i.test(t)) return true;
  // E-mails
  if (/@[a-z0-9.-]+\.[a-z]{2,}/i.test(t)) return true;
  // Ícones material concatenados com texto
  if (t.includes('content_copy') || t.includes('person_add') || t.includes('person_remove')) return true;
  // Notificações de participante (ex: "meetai ai está participando")
  if (/\bestá participando\b|\bis (now )?participating\b|\bentrou na chamada\b/.test(t)) return true;
  // Painel de configurações de legenda (language + idioma na mesma linha)
  if (t.includes('format_size') || t.includes('abrir configurações de legenda')) return true;
  return false;
}

function cleanSpeech(text, speaker) {
  if (!text) return '';
  let t = text.trim();
  // Remove qualquer coisa após arrow_downward (botão de scroll do chat)
  t = t.replace(/arrow_downward.*/gi, '').trim();
  t = t.replace(/\s*ir para o fim\s*/gi, '').trim();
  t = t.replace(/\s*go to bottom\s*/gi, '').trim();
  // Remove nome do speaker do início se aparecer duplicado
  if (speaker && speaker !== 'Participante') {
    const esc = speaker.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
    t = t.replace(new RegExp('^' + esc + '\\s*[:\\-\\s]*', 'i'), '').trim();
  }
  // Remove prefixos de UI soltos no início
  t = t.replace(/^(keyboard_arrow_\w+|arrow_\w+|more_\w+|close|info)\s*/gi, '').trim();
  return t;
}

// ── CAPTURA ───────────────────────────────────────────
// Estratégia em cascata — do mais específico ao mais genérico.
// Se nenhum seletor fixo funcionar, usa aria-live e heurística de posição.

let _debugCapture = false; // true = loga cada tentativa no console

// Seletores conhecidos do Meet (atualizados periodicamente pelo Google)
const CAPTION_SELECTORS = [
  // Containers principais
  '.iOzk7', '[jsname="dsyhDe"]', '.vNKgIf', '.CNusmb',
  '.a4cQT', '.Mz6pEf', '.TBMuR',
  // Containers alternativos encontrados em versões recentes
  '[jscontroller="KPn5nb"]', '[jscontroller="xXj8Db"]',
  '[data-self-name]',
  // Bloco de fala individual
  '.nMcdL', '[jsname="tS999c"]', '.iTTPOb',
];

// Seletores de speaker dentro de um bloco
const SPEAKER_SELECTORS = [
  '.zs7s8d', '.NWpY1d', '[jsname="bVMoob"]',
  '.nMcdL > span:first-child', '[data-sender-name]',
];

// Seletores de texto dentro de um bloco
const TEXT_SELECTORS = [
  '.ygicle', '.VbkSUe', '.DtJ7e',
  '.nMcdL span:last-child', '.nMcdL',
];

function captureCaptions() {
  if (!isRecording) return;

  // Estratégia 1: seletores conhecidos do Meet
  let found = false;
  for (const sel of CAPTION_SELECTORS) {
    const els = document.querySelectorAll(sel);
    if (!els.length) continue;
    els.forEach(el => {
      if (el.innerText?.includes('Tamanho da fonte')) return;
      if (el.innerText?.includes('Font size')) return;
      const text = (el.innerText || '').trim();
      if (!text || text.length < 3) return;
      found = true;
      extractBlock(el);
    });
    if (found) break;
  }
  if (found) return;

  // Estratégia 2: aria-live (Meet sempre usa isso para acessibilidade)
  const liveEls = document.querySelectorAll('[aria-live="polite"],[aria-live="assertive"],[aria-atomic="true"]');
  liveEls.forEach(el => {
    if (el.closest('[role="complementary"],[role="menu"],[role="menuitem"],[role="toolbar"],[role="alert"],header,nav')) return;
    const text = (el.innerText || el.textContent || '').trim();
    if (!text || text.length < 4 || isUIText(text) || text.split(/\s+/).length < 2) return;
    found = true;
    const blocks = el.children.length > 0 ? [...el.children] : [el];
    blocks.forEach(b => { try { extractBlock(b); } catch (_) {} });
  });
  if (found) return;

  // Estratégia 3: heurística de posição (legenda aparece no terço inferior da tela)
  captureByPosition();
}

function captureByPosition() {
  const viewH = window.innerHeight;
  const MIN_Y  = viewH * 0.55; // legenda começa no terço inferior
  const MAX_Y  = viewH * 0.95;
  const candidates = [];

  document.querySelectorAll('div,span').forEach(el => {
    if (!el.offsetParent) return;
    if (el.children.length > 4) return; // containers muito grandes ignorar
    if (el.closest('button,[role="button"],[role="menuitem"],header,nav,[role="toolbar"]')) return;
    const r   = el.getBoundingClientRect();
    if (r.top < MIN_Y || r.top > MAX_Y) return;
    if (r.height < 8 || r.height > 120) return;
    const t = (el.innerText || '').trim();
    if (!t || t.length < 5 || isUIText(t) || t.split(/\s+/).length < 2) return;
    candidates.push({ el, top: r.top });
  });

  if (!candidates.length) return;

  // Agrupa por linha vertical (30px de tolerância)
  const rows = {};
  candidates.forEach(({ el, top }) => {
    const row = Math.round(top / 30) * 30;
    if (!rows[row]) rows[row] = [];
    rows[row].push(el);
  });

  // Usa a linha com mais candidatos (mais provável ser a legenda)
  const best = Object.values(rows).reduce((a, b) => a.length >= b.length ? a : b, []);
  best.forEach(el => {
    const t = (el.innerText || '').trim();
    if (!t || isUIText(t)) return;
    // Tenta extrair speaker da estrutura do elemento
    const lines = t.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    let spk = myRealName || 'Participante';
    let txt = t;
    if (lines.length >= 2 && lines[0].length < 50 && !isUIText(lines[0])) {
      spk = lines[0];
      txt = lines.slice(1).join(' ').trim();
    }
    const clean = cleanSpeech(txt, spk);
    if (clean.length > 2) sendTranscript(clean, spk);
  });
}

function extractBlock(block) {
  try {
    if (!block || typeof block.innerText === 'undefined') return;
    const fullText = (block.innerText || '').trim();
    if (!fullText || fullText.length < 2 || isUIText(fullText)) return;

    let speaker    = myRealName || 'Participante';
    let speechText = fullText;

    // Tenta extrair speaker com seletores conhecidos
    let speakerEl = null;
    for (const sel of SPEAKER_SELECTORS) {
      speakerEl = block.querySelector(sel);
      if (speakerEl) break;
    }

    if (speakerEl) {
      const n = (speakerEl.innerText || '').trim();
      if (n && n.length > 0 && n.length < 60 && !isUIText(n)) {
        speaker = n;
        const clone = block.cloneNode(true);
        for (const sel of SPEAKER_SELECTORS) {
          clone.querySelector(sel)?.remove();
        }
        speechText = cleanSpeech((clone.innerText || '').trim(), speaker);
      }
    } else {
      // Tenta extrair speaker pela estrutura (primeira linha curta = nome)
      const lines = fullText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
      if (lines.length >= 2 && lines[0].length < 50 && !isUIText(lines[0])) {
        speaker    = lines[0];
        speechText = cleanSpeech(lines.slice(1).join(' ').trim(), speaker);
      } else {
        speechText = cleanSpeech(fullText, speaker);
      }
    }

    if (speechText.length > 1 && !isUIText(speechText)) sendTranscript(speechText, speaker);
  } catch (e) { /* silencioso */ }
}

// ── DEDUPLICAÇÃO / DELTA ──────────────────────────────────
const pendingTranscripts = new Map();
const speakerMemory      = new Map();
const memoryTimers       = new Map();

function sendTranscript(text, speaker) {
  if (!isRecording) return;
  const cleanText = text.trim();
  if (cleanText.length < 2) return;

  const existing = pendingTranscripts.get(speaker);
  if (existing) {
    // Atualiza o texto acumulado e reseta o timer de silêncio
    clearTimeout(existing.timer);
    existing.text  = cleanText;
    existing.timer = setTimeout(existing.flush, 6000); // 6s de silêncio = pausa
    return;
  }

  const flush = () => _processPending(speaker);
  // maxWait: fala muito longa — usa o mesmo flush() para evitar duplo envio
  const maxWait = setTimeout(flush, 15000); // 15s fala muito longa
  const timer = setTimeout(flush, 6000);   // 6s silêncio = nova linha
  pendingTranscripts.set(speaker, { text: cleanText, timer, flush, maxWait });
}

function _enviarDelta(speaker, cur) {
  if (!cur || cur.length < 2) return;
  const prev = speakerMemory.get(speaker) || '';

  // Sempre atualiza memória
  speakerMemory.set(speaker, cur);
  if (memoryTimers.has(speaker)) clearTimeout(memoryTimers.get(speaker));
  memoryTimers.set(speaker, setTimeout(() => speakerMemory.delete(speaker), 30000));

  if (!prev) {
    send({ action: 'transcription', text: cur, speaker });
    return;
  }

  const norm = t => t.toLowerCase().replace(/[^\wÀ-ÿ\s]/gi, ' ').replace(/\s+/g, ' ').trim();
  const prevN = norm(prev);
  const curN  = norm(cur);
  if (curN === prevN) return;

  // Extrai só palavras novas (o Meet acumula a legenda)
  const pW = prevN.split(' ');
  const cW = curN.split(' ');
  let match = 0;
  for (let i = 0; i < Math.min(pW.length, cW.length); i++) {
    if (pW[i] === cW[i]) match++;
    else break;
  }

  let out;
  if (match > 0 && match >= Math.ceil(pW.length * 0.6)) {
    out = cW.slice(match).join(' ').trim();
  } else {
    out = cur; // frase nova completamente diferente
  }

  if (out && out.length > 1) {
    send({ action: 'transcription', text: out, speaker });
    console.log('[MeetAI] ' + speaker + ': ' + out);
  }
}

function _processPending(speaker) {
  const fd = pendingTranscripts.get(speaker);
  if (!fd) return;
  clearTimeout(fd.maxWait);
  pendingTranscripts.delete(speaker);
  _enviarDelta(speaker, fd.text);
}


// ── OBSERVER ─────────────────────────────────────────────
function startObserver() {
  if (captionObserver) return;
  let throttle = null;
  captionObserver = new MutationObserver(() => {
    try {
      if (!_checkCtx()) return;
      if (!isRecording) return;
      if (throttle) return;
      const delay = document.hidden ? 50 : 100;
      throttle = setTimeout(() => {
        try { throttle = null; captureCaptions(); }
        catch (e) {
          throttle = null;
          console.warn('[MeetAI] captureCaptions erro (continuando):', e.message);
        }
      }, delay);
    } catch (e) {
      // Nao mata o observer permanentemente — apenas loga
      console.warn('[MeetAI] Observer erro (continuando):', e.message);
    }
  });
  captionObserver.observe(document.body, { childList: true, subtree: true, characterData: true });
  console.log('[MeetAI] 👀 Observer ativo');
}

// ── LIBERAR ACESSO DA REUNIÃO PARA O BOT ────────────────────
// Chamada ANTES de disparar o bot — abre o acesso se usuário for organizador
function liberarAcessoReuniao(callback) {
  // PAUSA a captura durante a operação para não capturar conteúdo do painel
  const wasRecording = isRecording;
  isRecording = false;

  const done = (result) => {
    setTimeout(() => {
      // Só reativa se gravação ainda não foi parada pelo usuário
      if (wasRecording) isRecording = isRecording || wasRecording;
      speakerMemory.clear();
      pendingTranscripts.forEach((fd) => {
        clearTimeout(fd.timer);
        clearTimeout(fd.maxWait);
      });
      pendingTranscripts.clear();
      console.log('[MeetAI] Captura reativada após liberar acesso');
    }, 6000);
    if (callback) callback(result);
  };

  try {
    const hostControlsSelectors = [
      '[aria-label*="Controles do organizador"]',
      '[aria-label*="Host controls"]',
      '[data-tooltip*="organizador"]',
      '[jsname="c4Albe"]',
    ];

    let hostBtn = null;
    for (const sel of hostControlsSelectors) {
      hostBtn = document.querySelector(sel);
      if (hostBtn) break;
    }

    if (!hostBtn) {
      // Não é organizador — bot vai pedir para participar
      console.log('[MeetAI] Nao e organizador — bot usara "Pedir para participar"');
      done(false);
      return;
    }

    // Abre controles do organizador
    hostBtn.click();
    console.log('[MeetAI] Abrindo controles do organizador...');

    setTimeout(() => {
      try {
        // Procura toggle de restrição de acesso
        // O Meet tem diferentes seletores dependendo da versão
        const restrictionSelectors = [
          '[aria-label*="Gerenciar quem pode participar"]',
          '[aria-label*="Manage who can join"]',
          '[aria-label*="acesso"]',
          '[aria-label*="access"]',
          '[aria-label*="Quick access"]',
          '[aria-label*="Acesso rápido"]',
        ];

        let toggle = null;
        for (const sel of restrictionSelectors) {
          toggle = document.querySelector(sel);
          if (toggle) break;
        }

        // Tenta por role=switch também
        if (!toggle) {
          const switches = document.querySelectorAll('[role="switch"]');
          for (const sw of switches) {
            const lbl = (sw.getAttribute('aria-label') || '').toLowerCase();
            if (lbl.includes('acesso') || lbl.includes('participar') || lbl.includes('join') || lbl.includes('access')) {
              toggle = sw;
              break;
            }
          }
        }

        if (toggle) {
          const isOn = toggle.getAttribute('aria-checked') === 'true' ||
                       toggle.getAttribute('aria-pressed') === 'true';
          if (isOn) {
            // Restrição está ativa — desativa para permitir o bot
            toggle.click();
            console.log('[MeetAI] Restricao de acesso desativada para o bot');
          } else {
            console.log('[MeetAI] Acesso ja esta aberto');
          }
        } else {
          console.log('[MeetAI] Toggle de acesso nao encontrado — bot tentara mesmo assim');
        }

        // Fecha o painel de controles
        setTimeout(() => {
          document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
          done(true);
        }, 800);

      } catch (e) {
        console.warn('[MeetAI] Erro ao liberar acesso:', e.message);
        done(false);
      }
    }, 1500);

  } catch (e) {
    console.warn('[MeetAI] liberarAcessoReuniao erro:', e.message);
    done(false);
  }
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
  safeInterval(() => { if (!isRecording) return; captureCaptions(); }, 1000); // CORRIGIDO: era 2000ms
  safeInterval(() => { if (!isRecording) return; if (document.hidden) captureCaptions(); }, 500);
  safeInterval(() => { if (!myRealName) myRealName = getMyName(); }, 5000);
  // Abre acesso da reunião para o bot ANTES de disparar
  liberarAcessoReuniao((unlocked) => {
    send({ action: 'recordingStarted', accessUnlocked: unlocked });
  });
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
    if (msg.action === 'unlockAccess') {
      liberarAcessoReuniao((ok) => sendResponse({ ok }));
      return true;
    }
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

// ── INÍCIO DA REUNIÃO ─────────────────────────────────────
// CORREÇÃO #3: Bot NÃO é chamado daqui.
// Apenas informa o background.js via 'meetingStarted' com o código limpo.
// O background.js decide se chama o bot (sem duplicação).
function onStart(code) {
  if (meetingStarted) return;
  if (!_checkCtx()) return;
  meetingStarted = true;
  myRealName = getMyName();

  // CORREÇÃO #4: URL sem ?hl=en — não força idioma inglês no Meet
  const meetingCode = code; // apenas o código, sem parâmetros extras
  send({ action: 'meetingStarted', meetingCode, myName: myRealName });
  sendParticipants();

  // autoStart: apenas notifica o background — NÃO inicia gravação local automaticamente
  // A gravação local só começa quando o usuário clica Iniciar no popup
  // O bot será disparado pelo background.js com base na configuração autoStart

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