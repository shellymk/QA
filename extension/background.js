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
const SERVIDOR = 'http://localhost:3000';
let audioT0 = null;        // Date.now() no início da gravação de áudio (base de tempo)
let nomeEventos = [];      // [{ nome, t }] — quem falou e quando (do content.js)
let meetTabId = null;      // aba do Meet sendo capturada
let offscreenPronto = false; // o offscreen já registrou o listener? (evita corrida)

// ══════════════════════════════════════════════
// API KEY — autenticação da extensão no servidor
// A chave é colada uma vez no popup e guardada em chrome.storage.local.
// Sem ela, o servidor responde 401 (a API agora exige autenticação).
// ══════════════════════════════════════════════
let apiKey = '';
chrome.storage.local.get(['apiKey'], (d) => { apiKey = d.apiKey || ''; });
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.apiKey) apiKey = changes.apiKey.newValue || '';
});
function apiHeaders() {
  return { 'Content-Type': 'application/json', 'X-API-Key': apiKey };
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
          chrome.storage.local.set({ transcriptLines: [] });
          notifyPopup({ type: 'status', value: '⏺ Transcrevendo...' });
          notifyPopup({ type: 'clearTranscript' });
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
        if (meetingId) await saveTranscript(msg.text, speaker);
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
    uploadUrl: `${SERVIDOR}/api/reuniao/${mid}/media`, apiKey,
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
    const res = await fetch('http://localhost:3000/api/start-meeting', {
      method: 'POST',
      headers: apiHeaders(),
      body: JSON.stringify({
        title: 'Google Meet',
        meetingCode: code || 'unknown'
      })
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = await res.json();
    meetingId  = data.meetingId;

    console.log('[MeetAI BG] ✅ Reunião criada:', meetingId);

  } catch (e) {
    console.error('[MeetAI BG] ❌ Erro ao criar reunião:', e);
    notifyPopup({ type: 'error', value: 'Erro ao conectar ao servidor' });
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
    await fetch('http://localhost:3000/api/end-meeting', {
      method: 'POST',
      headers: apiHeaders(),
      body: JSON.stringify({ meetingId })
    });

    await fetch('http://localhost:3000/api/end-meeting-notify', {
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

function saveTranscript(text, speaker) {
  const mid = meetingId;
  if (!mid) return;
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
    flushTimer = setTimeout(flushTranscripts, 2000);
  }
}

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
  for (const [mid, items] of porReuniao) {
    try {
      await fetch('http://localhost:3000/api/add-transcripts-batch', {
        method: 'POST',
        headers: apiHeaders(),
        body: JSON.stringify({ meetingId: mid, transcripts: items })
      });
    } catch (e) {
      console.warn('[MeetAI BG] Batch falhou, tentando individualmente:', e.message);
      for (const it of items) {
        try {
          await fetch('http://localhost:3000/api/add-transcript', {
            method: 'POST',
            headers: apiHeaders(),
            body: JSON.stringify({ meetingId: mid, ...it })
          });
        } catch (_) {}
      }
    }
  }
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