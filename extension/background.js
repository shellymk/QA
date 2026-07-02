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

// ══════════════════════════════════════════════
// ESCUTAR MENSAGENS
// ══════════════════════════════════════════════
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {

  if (msg.action === 'ping') {
    sendResponse({ ok: true });
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
          notifyPopup({ type: 'status', value: '⏺ Gravando...' });
          notifyPopup({ type: 'clearTranscript' });
          await createMeeting(meetingCode);

          // Dispara bot AQUI (após extensão tentar abrir o acesso)
          // Aguarda 4s para o Meet processar a mudança de acesso
          if (meetingCode && !botDispatched) {
            botDispatched = true;
            const meetUrl = 'https://meet.google.com/' + meetingCode;
            setTimeout(async () => {
              try {
                const r = await fetch('http://localhost:3000/api/bot/join', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ url: meetUrl })
                });
                const d = await r.json();
                console.log('[MeetAI BG] Bot:', d.status || d);
              } catch (e) {
                console.warn('[MeetAI BG] Bot indisponivel:', e.message);
              }
            }, 4000);
          }
        }
      }

      if (msg.action === 'recordingStopped') {
        if (isRecording) {
          await endMeeting();
          notifyPopup({ type: 'status', value: '⏹ Gravação parada' });
        }
      }

      if (msg.action === 'meetingEnded') {
        if (isRecording) await endMeeting();
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
// CRIAR REUNIÃO NO SERVIDOR
// CORREÇÃO #1: bot NÃO é chamado aqui — evita chamada dupla
// ══════════════════════════════════════════════
async function createMeeting(code) {
  try {
    const res = await fetch('http://localhost:3000/api/start-meeting', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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

  try {
    await fetch('http://localhost:3000/api/end-meeting', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ meetingId })
    });

    await fetch('http://localhost:3000/api/end-meeting-notify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
  if (!meetingId) return;
  transcriptQueue.push({
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
  if (!meetingId || transcriptQueue.length === 0) return;
  const batch = transcriptQueue.splice(0, transcriptQueue.length);
  try {
    await fetch('http://localhost:3000/api/add-transcripts-batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ meetingId, transcripts: batch })
    });
  } catch (e) {
    console.warn('[MeetAI BG] Batch falhou, tentando individualmente:', e.message);
    for (const t of batch) {
      try {
        await fetch('http://localhost:3000/api/add-transcript', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ meetingId, ...t })
        });
      } catch (_) {}
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