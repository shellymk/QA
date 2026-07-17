/*
================================
MEETAI — background.js (CORRIGIDO v4)
================================
CORREÇÕES:
1. Bot chamado SOMENTE AQUI — removido do content.js (evita chamada dupla)
2. Bot só é chamado se autoStart estiver ativo
3. meetingCode limpo — sem ?hl=en na URL enviada ao bot
4. Verificação de bot já ativo antes de disparar nova chamada
================================
*/

// ══════════════════════════════════════════════
// ESTADO
// ══════════════════════════════════════════════
let meetingId   = null;
let meetingCode = null;
let participants = [];
let isRecording  = false;
let botDispatched = false; // evita chamadas duplas ao bot

// ── HÍBRIDO (Etapa 3): áudio + linha do tempo de nomes ──────────────────────
// URL do backend (a API). Produção = Render. Pra voltar pro dev local, troque
// por 'http://localhost:3000' AQUI e ajuste o host_permissions do manifest.json.
const SERVIDOR = 'https://transcription-1pcy.onrender.com';
// URLs do PAINEL — de onde a extensão herda o login. A ordem é a de preferência
// (produção primeiro, dev depois). Usadas pra ler o cookie meetai_token via
// chrome.cookies, SEM depender de nenhuma aba do painel estar aberta (blindagem
// de 2026-07-17: antes, o token só chegava se uma aba do painel "nova" rodasse o
// session-bridge — abrir o painel numa aba já existente não pegava).
const PAINEIS = [
  'https://qa-gray.vercel.app/',
  'http://localhost:5173/',
  'http://localhost:3000/',
];
let audioT0 = null;        // Date.now() no início da gravação de áudio (base de tempo)
let nomeEventos = [];      // [{ nome, t }] — quem falou e quando (do content.js)
let meetTabId = null;      // aba do Meet sendo capturada
let offscreenPronto = false; // o offscreen já registrou o listener? (evita corrida)

// ══════════════════════════════════════════════
// AUTENTICAÇÃO — token JWT herdado do login do PAINEL
// O usuário faz login no painel web; o session-bridge.js lê o JWT do
// localStorage do painel e manda pra cá (ação 'painelToken'). A extensão
// NÃO pede chave nem login próprio — reaproveita a sessão do painel.
// Sem token, o servidor responde 401.
// ══════════════════════════════════════════════
let token = '';
let userEmail = '';
// sessaoInvalida: o servidor já recusou este token (401). Fica true até chegar um
// token novo pelo session-bridge — evita seguir "gravando" contra um 401 eterno.
let sessaoInvalida = false;
chrome.storage.local.get(['painelToken', 'painelEmail'], (d) => {
  token = d.painelToken || '';
  userEmail = d.painelEmail || '';
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.painelToken) {
    const novo = changes.painelToken.newValue || '';
    // Token NOVO (o usuário logou de novo no painel): a sessão volta a valer e a
    // fila que ficou presa é reenviada — o texto retido não se perde.
    if (novo && novo !== token) {
      sessaoInvalida = false;
      chrome.storage.local.set({ sessaoInvalida: false });
      try { chrome.action.setBadgeText({ text: '' }); } catch (_) {}
      if (transcriptQueue.length && !flushTimer) {
        tentativasFlush = 0;
        flushTimer = setTimeout(flushTranscripts, 500);
      }
    }
    token = novo;
  }
  if (changes.painelEmail) userEmail = changes.painelEmail.newValue || '';
});
function apiHeaders() {
  const h = { 'Content-Type': 'application/json' };
  if (token) h['Authorization'] = 'Bearer ' + token;
  return h;
}

// PUXADA ATIVA DO TOKEN — lê o cookie do painel direto do navegador.
// O painel (api.ts) grava o JWT tanto no localStorage quanto num cookie
// meetai_token. O cookie fica no cofre do navegador por domínio, então a
// extensão o alcança com chrome.cookies A QUALQUER MOMENTO — sem aba aberta,
// sem session-bridge, independente de qual janela abriu primeiro. É o que
// elimina a dependência que travava quem "só quer dar play".
//
// A ponte antiga (session-bridge empurrando via storage) CONTINUA funcionando
// como reforço; esta é a fonte confiável quando ela não roda.
async function lerCookie(url, nome) {
  try {
    const c = await chrome.cookies.get({ url, name: nome });
    return c && c.value ? c.value : null;
  } catch (_) { return null; }
}

async function garantirToken() {
  // Procura o cookie no primeiro painel que tiver sessão válida.
  for (const url of PAINEIS) {
    const t = await lerCookie(url, 'meetai_token');
    if (t) {
      const email = (await lerCookie(url, 'meetai_email')) || userEmail;
      if (t !== token) {
        // Token do cookie difere do que temos: adota, reabilita a sessão e
        // reenvia o que estava preso na fila (se houver).
        token = t;
        sessaoInvalida = false;
        chrome.storage.local.set({ painelToken: t, painelEmail: email || '', sessaoInvalida: false });
        try { chrome.action.setBadgeText({ text: '' }); } catch (_) {}
        if (transcriptQueue.length && !flushTimer) {
          tentativasFlush = 0;
          flushTimer = setTimeout(flushTranscripts, 500);
        }
      }
      if (email) userEmail = email;
      return t;
    }
  }
  return token; // nenhum cookie encontrado — fica com o que já tínhamos (pode ser vazio)
}

// ══════════════════════════════════════════════
// ESCUTAR MENSAGENS
// ══════════════════════════════════════════════
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {

  // Mensagens vindas do documento offscreen (gravação de áudio).
  if (msg && msg.target === 'background') {
    if (msg.type === 'offscreen-ready') { offscreenPronto = true; return false; }
    if (msg.type === 'recording-started') console.log('[MeetAI BG] 🎙️ Gravando' + (msg.comVideo ? ' (vídeo+áudio)' : ' (só áudio)'));
    else if (msg.type === 'recording-note') console.warn('[MeetAI BG] ⚠️', msg.note);
    else if (msg.type === 'recording-error') console.error('[MeetAI BG] ❌ Erro na gravação:', msg.error);
    else if (msg.type === 'upload-done') {
      console.log('[MeetAI BG] ✅ Áudio enviado. Transcrição:', msg.resp);
      notifyPopup({ type: 'status', value: msg.ok ? '✅ Transcrição pronta' : '⚠️ Falha ao transcrever' });
      fecharOffscreen();
    } else if (msg.type === 'upload-error') {
      console.warn('[MeetAI BG] Erro ao enviar áudio:', msg.error);
      notifyPopup({ type: 'status', value: '⚠️ Falha ao enviar áudio' });
      fecharOffscreen();
    }
    return false;
  }

  if (msg.action === 'ping') {
    sendResponse({ ok: true });
    return false;
  }

  // Evento de "quem está falando agora" (content.js lendo a legenda do Meet).
  if (msg.action === 'nomeEvento') {
    if (isRecording && msg.nome) nomeEventos.push({ nome: msg.nome, t: msg.t || Date.now() });
    return false;
  }

  if (msg.action === 'getStatus') {
    sendResponse({ isRecording, meetingId, meetingCode });
    return false;
  }

  // Token do painel (via session-bridge.js). Guarda no storage pra sobreviver
  // ao service worker dormir; o listener de storage acima atualiza a variável.
  if (msg.action === 'painelToken') {
    chrome.storage.local.set({
      painelToken: msg.token || '',
      painelEmail: msg.email || '',
    });
    return false;
  }

  // Estado da sessão pro popup (conectado? qual email?).
  // Puxa o cookie ANTES de responder: assim o popup mostra "Conectado" mesmo
  // que o login tenha sido feito numa aba antiga, ou sem aba nenhuma aberta.
  if (msg.action === 'getSession') {
    garantirToken().then((t) => {
      sendResponse({ conectado: !!t, email: userEmail });
    });
    return true; // resposta assíncrona
  }

  (async () => {
    try {

      // Reunião detectada — salva o código e decide se dispara o bot
      if (msg.action === 'meetingStarted') {
        meetingCode = msg.meetingCode;
        botDispatched = false; // reset para nova reunião
        notifyPopup({ type: 'meetingDetected', meetingCode });
        console.log('[MeetAI BG] 📅 Reunião detectada:', meetingCode);

        // CORREÇÃO #1 + #2: bot disparado AQUI (não no content.js),
        // e só se autoStart estiver ativo
        // Bot sera disparado em recordingStarted (apos extensao abrir o acesso)
      }

      if (msg.action === 'recordingStarted') {
        if (!isRecording) {
          isRecording = true;
          // Sessão nova: zera as travas de aviso e o badge de erro da anterior.
          avisouSemReuniao = false;
          sessaoInvalida = false;
          try { chrome.action.setBadgeText({ text: '' }); } catch (_) {}
          chrome.storage.local.set({ transcriptLines: [], sessaoInvalida: false });
          notifyPopup({ type: 'status', value: '⏺ Transcrevendo...' });
          notifyPopup({ type: 'clearTranscript' });
          // Garante o token FRESCO do cookie antes de criar a reunião — cobre o
          // usuário que logou no painel e foi direto pro Meet sem reabrir nada.
          await garantirToken();
          await createMeeting(meetingCode);
          // SÓ LEGENDA (decisão da usuária): sem gravação de áudio no ao vivo.
          // A transcrição vem da legenda do Meet, agrupada em frases coerentes
          // pelo content.js. O áudio/diarização fica só no "Subir gravação".
        }
      }

      if (msg.action === 'recordingStopped') {
        if (isRecording) {
          await endMeeting();
          notifyPopup({ type: 'status', value: '⏹ Reunião finalizada' });
        }
      }

      if (msg.action === 'meetingEnded') {
        if (isRecording) {
          await endMeeting();
        }
        meetingCode = null;
        botDispatched = false;
        participants = [];
        notifyPopup({ type: 'status', value: '🔴 Reunião encerrada' });
        console.log('[MeetAI BG] 🔴 Reunião encerrada');
      }

      if (msg.action === 'participants') {
        participants = msg.list;
        notifyPopup({ type: 'participants', list: participants });
      }


      if (msg.action === 'transcription') {
        if (!isRecording) return;
        const speaker = msg.speaker || resolveSpeaker(msg.text);
        persistTranscript(msg.text, speaker);
        notifyPopup({ type: 'transcription', text: msg.text, speaker });
        // Chama SEMPRE (era `if (meetingId)`): sem reunião criada, quem avisa o
        // usuário é o próprio saveTranscript. Com a guarda aqui, a fala sumia
        // caladinha antes de chegar em qualquer aviso.
        await saveTranscript(msg.text, speaker);
      }

    } catch (e) {
      console.error('[MeetAI BG] Erro ao processar mensagem:', e);
    }
  })();

  return true;
});

// ══════════════════════════════════════════════
// RESOLVER SPEAKER (fallback)
// ══════════════════════════════════════════════
function resolveSpeaker(text) {
  if (participants.length === 1) return participants[0];
  return 'Participante';
}

// ══════════════════════════════════════════════
// HÍBRIDO (Etapa 3) — ÁUDIO (offscreen) + LINHA DO TEMPO DE NOMES
// ══════════════════════════════════════════════
async function ensureOffscreen() {
  const tem = await chrome.offscreen.hasDocument?.();
  if (tem) return;
  offscreenPronto = false;
  await chrome.offscreen.createDocument({
    url: 'offscreen.html',
    reasons: ['USER_MEDIA'],
    justification: 'Gravar a reunião para transcrição com diarização.',
  });
  // ESPERA o offscreen.js registrar o listener e sinalizar 'pronto' — senão o
  // 'start-recording' chega antes do listener existir e se PERDE (bug da corrida).
  for (let i = 0; i < 60 && !offscreenPronto; i++) await new Promise((r) => setTimeout(r, 50));
  if (!offscreenPronto) console.warn('[MeetAI BG] ⚠️ offscreen não sinalizou pronto a tempo');
}

async function fecharOffscreen() {
  try { if (await chrome.offscreen.hasDocument?.()) await chrome.offscreen.closeDocument(); }
  catch (_) {}
}

// Inicia a gravação do áudio da aba do Meet (via offscreen) e zera a linha do tempo.
// Recebe o streamId JÁ PRONTO do popup — não tenta mais obtê-lo aqui (o service
// worker não tem o gesto do usuário e isso falhava, deixando a gravação muda).
async function iniciarCapturaAudio(streamId) {
  try {
    if (!streamId) throw new Error('streamId ausente');
    await ensureOffscreen();
    audioT0 = Date.now();
    nomeEventos = [];
    chrome.runtime.sendMessage({ target: 'offscreen', type: 'start-recording', streamId });
    console.log('[MeetAI BG] 🎙️ Captura de áudio iniciada');
  } catch (e) {
    console.warn('[MeetAI BG] Falha ao iniciar captura de áudio:', e.message);
    notifyPopup({ type: 'status', value: '⚠️ Sem áudio — usando a legenda' });
  }
}

// No fim: envia a linha do tempo de nomes e manda o offscreen subir o áudio.
async function pararAudioEProcessar(mid) {
  if (!mid || audioT0 == null) return;
  const t0 = audioT0;
  // converte cada evento p/ "ms desde o início do áudio" (mesma base do AssemblyAI)
  const timeline = nomeEventos.map((e) => ({ nome: e.nome, inicio: Math.max(0, e.t - t0) }));
  try {
    await fetch(`${SERVIDOR}/api/reuniao/${mid}/timeline`, {
      method: 'POST', headers: apiHeaders(), body: JSON.stringify({ timeline }),
    });
  } catch (e) { console.warn('[MeetAI BG] Falha ao enviar timeline:', e.message); }

  // manda o offscreen parar e SUBIR a gravação (vídeo+áudio) direto pro servidor
  chrome.runtime.sendMessage({
    target: 'offscreen', type: 'stop-recording',
    uploadUrl: `${SERVIDOR}/api/reuniao/${mid}/media`, token,
  });

  audioT0 = null;
  nomeEventos = [];
}

// ══════════════════════════════════════════════
// CRIAR REUNIÃO NO SERVIDOR
// CORREÇÃO #1: bot NÃO é chamado aqui — evita chamada dupla
// ══════════════════════════════════════════════
async function createMeeting(code) {
  try {
    const res = await fetch(`${SERVIDOR}/api/start-meeting`, {
      method: 'POST',
      headers: apiHeaders(),
      body: JSON.stringify({
        title: 'Google Meet',
        meetingCode: code || 'unknown'
      })
    });

    // 401 NÃO é "offline" — é falta de login. O servidor respondeu, mas sem token
    // válido (usuário não logou no painel, ou o token expirou).
    // Antes daqui saía só um aviso discreto e um `return`: o meetingId ficava nulo,
    // a captura continuava rodando e TODA fala era descartada em silêncio (a
    // reunião perdida de 2026-07-17). Agora para a gravação e avisa de verdade.
    if (res.status === 401) {
      avisarSessaoInvalida();
      return;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = await res.json();
    meetingId  = data.meetingId;
    sessaoInvalida = false;

    console.log('[MeetAI BG] ✅ Reunião criada:', meetingId);

  } catch (e) {
    console.error('[MeetAI BG] ❌ Erro ao criar reunião:', e);
    // TypeError = o fetch nem completou (servidor fora, URL errada, rede, ou a
    // Render acordando do sleep). Aí sim é "indisponível" — não confundir com 401.
    const msg = (e instanceof TypeError)
      ? '⏳ Servidor indisponível (acordando?) — tente de novo em ~30s'
      : 'Erro ao conectar ao servidor';
    notifyPopup({ type: 'error', value: msg });
  }
}

// ══════════════════════════════════════════════
// FINALIZAR REUNIÃO
// ══════════════════════════════════════════════
async function endMeeting() {
  if (!meetingId) {
    isRecording = false;
    return;
  }

  const endedId = meetingId;

  // Esvazia a fila ANTES de zerar o meetingId — senão o texto que ficou na fila
  // (ex.: a última frase, emitida no Parar) era descartado e a reunião vinha zerada.
  await flushTranscripts();

  try {
    await fetch(`${SERVIDOR}/api/end-meeting`, {
      method: 'POST',
      headers: apiHeaders(),
      body: JSON.stringify({ meetingId })
    });

    await fetch(`${SERVIDOR}/api/end-meeting-notify`, {
      method: 'POST',
      headers: apiHeaders(),
      body: JSON.stringify({ meetingId: endedId })
    }).catch(() => {});

    console.log('[MeetAI BG] ✅ Reunião finalizada:', endedId);

  } catch (e) {
    console.error('[MeetAI BG] ❌ Erro ao finalizar reunião:', e);
  } finally {
    meetingId   = null;
    isRecording  = false;
    participants = [];
    botDispatched = false;
  }
}

// ══════════════════════════════════════════════
// SALVAR TRANSCRIÇÃO — com batching
// CORREÇÃO PERF: agrupa transcrições em lote a cada 2s
// em vez de uma request HTTP por frase
// ══════════════════════════════════════════════
const transcriptQueue = [];
let flushTimer = null;
let avisouSemReuniao = false; // trava do aviso "reunião não criada" (1x por sessão)

function saveTranscript(text, speaker) {
  const mid = meetingId;
  // Sem meetingId não há onde gravar. Antes isso era um `return` mudo — e foi
  // assim que a reunião de 2026-07-17 evaporou: o createMeeting levou 401, saiu
  // sem definir meetingId, e cada fala seguinte caiu aqui e foi descartada calada.
  // Agora o usuário é avisado; o texto segue salvo em transcriptLines.
  if (!mid) {
    // Uma vez só — isto roda a cada fala capturada; sem a trava viraria spam.
    // Se a sessão caiu (401), o avisarSessaoInvalida já falou: não duplica.
    if (!sessaoInvalida && !avisouSemReuniao) {
      avisouSemReuniao = true;
      notifyPopup({ type: 'error', value: '⚠️ Reunião não foi criada no servidor — nada está sendo salvo. Pare e inicie a gravação de novo.' });
    }
    return;
  }
  avisouSemReuniao = false;
  // FIXA o meetingId no momento da fala. Assim, se a reunião for finalizada
  // enquanto ainda há texto na fila, cada item sabe pra qual reunião vai — não
  // se perde na corrida do "encerrar" (era uma das causas do "vinha zerado").
  transcriptQueue.push({
    meetingId: mid,
    user: speaker || 'Participante',
    text,
    timestamp: new Date().toISOString()
  });
  if (!flushTimer) {
    // 1s (era 2s): somado ao agrupamento do content.js, o texto chegava ao painel
    // ~8s atrás da conversa. O batch continua existindo (não é 1 request por
    // frase), só que com janela menor.
    flushTimer = setTimeout(flushTranscripts, 1000);
  }
}

// PERDA SILENCIOSA — o bug que custou a reunião de 2026-07-17.
// O código antigo dava `splice` na fila (tirando o texto de lá) e mandava o POST
// dentro de um try/catch. Só que `fetch` NÃO lança exceção em 401/500 — ele
// resolve normalmente com res.status=401. Ou seja: o catch nunca rodava, ninguém
// olhava o `res.ok`, e o texto já tinha saído da fila. Resultado: 401 = transcrição
// jogada fora em silêncio, com a bolinha vermelha acesa fingindo que gravava.
// Agora: só sai da fila o que o servidor CONFIRMOU ter recebido. O resto volta.
let tentativasFlush = 0;

async function flushTranscripts() {
  flushTimer = null;
  if (transcriptQueue.length === 0) return;
  const batch = transcriptQueue.splice(0, transcriptQueue.length);
  // Agrupa por reunião (normalmente uma só) usando o meetingId fixado em cada fala.
  const porReuniao = new Map();
  for (const t of batch) {
    if (!porReuniao.has(t.meetingId)) porReuniao.set(t.meetingId, []);
    porReuniao.get(t.meetingId).push({ user: t.user, text: t.text, timestamp: t.timestamp });
  }

  const naoEnviados = [];
  let deu401 = false;

  for (const [mid, items] of porReuniao) {
    try {
      const res = await fetch(`${SERVIDOR}/api/add-transcripts-batch`, {
        method: 'POST',
        headers: apiHeaders(),
        body: JSON.stringify({ meetingId: mid, transcripts: items })
      });
      if (res.status === 401) { deu401 = true; }
      if (!res.ok) {
        // NÃO descarta: devolve pra fila e tenta de novo mais tarde.
        for (const it of items) naoEnviados.push({ meetingId: mid, ...it });
        console.warn(`[MeetAI BG] add-transcripts-batch HTTP ${res.status} — ${items.length} fala(s) mantidas na fila`);
      }
    } catch (e) {
      // TypeError = rede caiu / servidor fora / Render acordando. Também devolve.
      for (const it of items) naoEnviados.push({ meetingId: mid, ...it });
      console.warn('[MeetAI BG] Falha de rede no batch — mantendo na fila:', e.message);
    }
  }

  if (naoEnviados.length) {
    // Volta pro INÍCIO da fila, preservando a ordem cronológica das falas.
    transcriptQueue.unshift(...naoEnviados);
    // Teto de memória: nunca deixa a fila crescer sem limite se o servidor sumiu
    // de vez (o texto continua salvo em transcriptLines pelo persistTranscript).
    if (transcriptQueue.length > 2000) transcriptQueue.splice(0, transcriptQueue.length - 2000);
  }

  if (deu401) {
    // Sessão inválida: não adianta insistir, e o usuário PRECISA saber agora —
    // continuar "gravando" sem salvar foi exatamente o que perdeu a reunião.
    avisarSessaoInvalida();
    return;
  }

  if (naoEnviados.length) {
    // Backoff: 2s, 4s, 8s… até 30s. Reenvia sozinho quando o servidor voltar
    // (cobre o cold start da Render, que era diagnosticado como "perdeu tudo").
    tentativasFlush++;
    const espera = Math.min(2000 * 2 ** (tentativasFlush - 1), 30000);
    if (!flushTimer) flushTimer = setTimeout(flushTranscripts, espera);
  } else {
    tentativasFlush = 0;
  }
}

// Sessão inválida (401): para a gravação e avisa de forma VISÍVEL.
// Antes isso era um aviso discreto no popup e a captura seguia rodando à toa.
function avisarSessaoInvalida() {
  sessaoInvalida = true;
  notifyPopup({
    type: 'error',
    value: '🔑 Sessão expirada — abra o painel e faça login. A gravação foi PAUSADA (nada está sendo salvo).'
  });
  // Badge vermelho no ícone: aparece mesmo com o popup fechado.
  try {
    chrome.action.setBadgeText({ text: '!' });
    chrome.action.setBadgeBackgroundColor({ color: '#d93025' });
  } catch (_) {}
  // Para a captura na aba do Meet — melhor parar avisando do que fingir que grava.
  if (meetTabId != null) {
    chrome.tabs.sendMessage(meetTabId, { action: 'stopRecording', motivo: 'sessao' }).catch(() => {});
  }
  isRecording = false;
  chrome.storage.local.set({ isRecording: false, sessaoInvalida: true });
}

// ══════════════════════════════════════════════
// NOTIFICAR POPUP
// ══════════════════════════════════════════════
function notifyPopup(message) {
  chrome.runtime.sendMessage(message).catch(() => {});
}

function persistTranscript(text, speaker) {
  chrome.storage.local.get(['transcriptLines'], (data) => {
    const lines = data.transcriptLines || [];
    lines.push({ text, speaker, ts: Date.now() });
    if (lines.length > 500) lines.splice(0, lines.length - 500);
    chrome.storage.local.set({ transcriptLines: lines });
  });
}

// ══════════════════════════════════════════════
// KEEPALIVE — MV3 via porta persistente
// ══════════════════════════════════════════════
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'keepalive') return;

  port.onMessage.addListener((msg) => {
    if (msg.type === 'ping') port.postMessage({ type: 'pong' });
  });

  port.onDisconnect.addListener(() => {});
});