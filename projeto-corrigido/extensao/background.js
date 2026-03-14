/*
================================
MEETAI — background.js (CORRIGIDO v3)
================================
Mantém 100% da sua lógica original de servidor (fetch), 
créditos e persistência, corrigindo apenas a identificação 
de múltiplos falantes.
*/

// ══════════════════════════════════════════════
// ESTADO
// ══════════════════════════════════════════════
let meetingId   = null;
let meetingCode = null;       // ← salva o código ao detectar a reunião
let participants = [];
let isRecording  = false;

// ══════════════════════════════════════════════
// ESCUTAR MENSAGENS
// ══════════════════════════════════════════════
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {

  // ── Resposta síncrona — não precisa de async ──
  if (msg.action === 'ping') {
    sendResponse({ ok: true });
    return false;
  }

  if (msg.action === 'getStatus') {
    sendResponse({ isRecording, meetingId, meetingCode });
    return false;
  }

  // ── Resposta assíncrona ──
  (async () => {
    try {

      // Reunião detectada pelo content.js — apenas salva o código e avisa o popup.
      // NÃO cria a meeting nem inicia gravação aqui.
      if (msg.action === 'meetingStarted') {
        meetingCode = msg.meetingCode;
        notifyPopup({ type: 'meetingDetected', meetingCode });
        console.log('[MeetAI BG] 📅 Reunião detectada:', meetingCode);
      }

      // Gravação iniciada — marca isRecording IMEDIATAMENTE,
      // antes mesmo do servidor responder, para não perder transcrições.
      if (msg.action === 'recordingStarted') {
        if (!isRecording) {
          isRecording = true;                          // ← imediato
          notifyPopup({ type: 'status', value: '⏺ Gravando...' });
          await createMeeting(meetingCode);            // servidor em paralelo
        }
      }

      // Gravação parada pelo popup ou pelo content.js
      if (msg.action === 'recordingStopped') {
        if (isRecording) {
          await endMeeting();
          notifyPopup({ type: 'status', value: '⏹ Gravação parada' });
        }
      }

      // Reunião encerrada (saiu do Meet)
      if (msg.action === 'meetingEnded') {
        if (isRecording) await endMeeting();
        meetingCode = null;
        participants = [];
        notifyPopup({ type: 'status', value: '🔴 Reunião encerrada' });
        console.log('[MeetAI BG] 🔴 Reunião encerrada');
      }

      // Lista de participantes — atualiza sempre
      if (msg.action === 'participants') {
        participants = msg.list;
        notifyPopup({ type: 'participants', list: participants });
      }

      // Transcrição — repassa ao popup SEMPRE que estiver gravando.
      // Salva no storage local para o popup exibir ao abrir.
      // Salva no servidor só se meetingId existir (servidor pode estar offline).
      if (msg.action === 'transcription') {
        if (!isRecording) return;
        
        // CORREÇÃO: Usa o speaker enviado pelo content.js. 
        // Se não houver, tenta resolver, mas o content_fixed.js já envia o nome correto agora.
        const speaker = msg.speaker || resolveSpeaker(msg.text);
        
        // Salva no storage para o popup recuperar mesmo se estava fechado
        persistTranscript(msg.text, speaker);
        
        // Tenta notificar popup em tempo real (falha silenciosamente se fechado)
        notifyPopup({ type: 'transcription', text: msg.text, speaker });
        
        // Servidor recebe só se meetingId disponível
        if (meetingId) await saveTranscript(msg.text, speaker);
      }

    } catch (e) {
      console.error('[MeetAI BG] Erro ao processar mensagem:', e);
    }
  })();

  return true; // mantém canal aberto para o async
});

// ══════════════════════════════════════════════
// RESOLVER SPEAKER (fallback)
// ══════════════════════════════════════════════
function resolveSpeaker(text) {
  // Se só tem uma pessoa na lista, assume que é ela
  if (participants.length === 1) return participants[0];
  return 'Participante';
}

// ══════════════════════════════════════════════
// CRIAR REUNIÃO NO SERVIDOR
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
    // isRecording já foi setado antes — não sobrescreve

    console.log('[MeetAI BG] ✅ Reunião criada:', meetingId);

  } catch (e) {
    console.error('[MeetAI BG] ❌ Erro ao criar reunião:', e);
    // Avisa o popup para ele poder mostrar o erro ao usuário
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

  try {
    await fetch('http://localhost:3000/api/end-meeting', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ meetingId })
    });

    console.log('[MeetAI BG] ✅ Reunião finalizada:', meetingId);

  } catch (e) {
    console.error('[MeetAI BG] ❌ Erro ao finalizar reunião:', e);
  } finally {
    meetingId   = null;
    isRecording  = false;
    participants = [];
  }
}

// ══════════════════════════════════════════════
// SALVAR TRANSCRIÇÃO
// ══════════════════════════════════════════════
async function saveTranscript(text, speaker) {
  if (!meetingId) return;

  try {
    await fetch('http://localhost:3000/api/add-transcript', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        meetingId,
        user: speaker || 'Participante',
        text,
        timestamp: new Date()
      })
    });

  } catch (e) {
    console.error('[MeetAI BG] ❌ Erro ao salvar transcrição:', e);
  }
}

// ══════════════════════════════════════════════
// NOTIFICAR POPUP
// ══════════════════════════════════════════════
function notifyPopup(message) {
  chrome.runtime.sendMessage(message).catch(() => {
    // Popup pode estar fechado — ignora silenciosamente
  });
}

// Salva transcrição no storage para o popup recuperar ao abrir
function persistTranscript(text, speaker) {
  chrome.storage.local.get(['transcriptLines'], (data) => {
    const lines = data.transcriptLines || [];
    lines.push({ text, speaker, ts: Date.now() });
    // Máximo 500 linhas
    if (lines.length > 500) lines.splice(0, lines.length - 500);
    chrome.storage.local.set({ transcriptLines: lines });
  });
}

// ══════════════════════════════════════════════
// KEEPALIVE — MV3 via porta persistente
// O content.js abre uma porta 'keepalive' e envia
// ping a cada 25s. Mantém o SW vivo sem chrome.alarms.
// ══════════════════════════════════════════════
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'keepalive') return;

  port.onMessage.addListener((msg) => {
    if (msg.type === 'ping') port.postMessage({ type: 'pong' });
  });

  port.onDisconnect.addListener(() => {
    // porta encerrada — SW pode adormecer
  });
});
