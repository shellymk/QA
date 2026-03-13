/*
================================
MEETAI — background.js (ATUALIZADO)
================================
*/

let meetingId = null;
let participants = [];
let isRecording = false;

/*
================================
ESCUTAR MENSAGENS
================================
*/

// No Manifest V3, o listener não deve ser async diretamente.
// Usamos uma IIFE async dentro do listener e retornamos true.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {

  if (msg.action === 'ping') return true;

  if (msg.action === 'getStatus') {
    sendResponse({ isRecording, meetingId });
    return false; // Resposta síncrona
  }

  // Para ações assíncronas (fetch), usamos uma função interna
  (async () => {
    try {
      if (msg.action === 'meetingStarted') {
        await createMeeting(msg.meetingCode);
        notifyPopup({ type: 'status', value: '🔴 Gravando reunião...' });
      }

      if (msg.action === 'meetingEnded') {
        await endMeeting();
        notifyPopup({ type: 'status', value: '⏹ Reunião encerrada' });
      }

      if (msg.action === 'participants') {
        participants = msg.list;
      }

      if (msg.action === 'transcription') {
        const speaker = msg.speaker || resolveSpeaker(msg.text);
        await saveTranscript(msg.text, speaker);
        notifyPopup({ type: 'transcription', text: msg.text, speaker: speaker });
      }
    } catch (e) {
      console.error('[MeetAI] Erro ao processar mensagem:', e);
    }
  })();

  return true; // Mantém o canal aberto para operações assíncronas
});

/*
================================
RESOLVER SPEAKER
(fallback quando content.js não identifica)
================================
*/

function resolveSpeaker(text) {
  // Tenta associar texto a um participante (heurística simples)
  if (participants.length === 1) return participants[0];
  return 'Participante';
}

/*
================================
CRIAR REUNIÃO NO SERVIDOR
================================
*/

async function createMeeting(code) {
  try {
    const res = await fetch('http://localhost:3000/api/start-meeting', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Google Meet',
        meetingCode: code
      })
    });

    const data = await res.json();
    meetingId = data.meetingId;
    isRecording = true;

    console.log('✅ Reunião criada:', meetingId);

  } catch (e) {
    console.error('❌ Erro ao criar reunião:', e);
  }
}

/*
================================
FINALIZAR REUNIÃO
================================
*/

async function endMeeting() {
  if (!meetingId) return;

  try {
    await fetch('http://localhost:3000/api/end-meeting', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ meetingId })
    });

    console.log('✅ Reunião finalizada:', meetingId);

  } catch (e) {
    console.error('❌ Erro ao finalizar reunião:', e);
  } finally {
    meetingId = null;
    isRecording = false;
    participants = [];
  }
}

/*
================================
SALVAR TRANSCRIÇÃO
================================
*/

async function saveTranscript(text, speaker) {
  if (!meetingId) return;

  try {
    await fetch('http://localhost:3000/api/add-transcript', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        meetingId: meetingId,
        user: speaker || 'Participante',
        text: text,
        timestamp: new Date()
      })
    });

  } catch (e) {
    console.error('❌ Erro ao salvar transcrição:', e);
  }
}

/*
================================
NOTIFICAR POPUP
================================
*/

function notifyPopup(message) {
  chrome.runtime.sendMessage(message).catch(() => {
    // Popup pode estar fechado — ignora silenciosamente
  });
}

/*
================================
ACEITAR CONEXÃO DE PORTA
(keepalive do content.js)
================================
*/

chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'content-keepalive' || port.name === 'keepalive') {
    // Mantém a porta aberta enquanto o service worker estiver vivo
    port.onDisconnect.addListener(() => {
      // Porta encerrada
    });
  }
});

/*
================================
KEEPALIVE — evita que o service worker
do MV3 adormeça e quebre a comunicação
================================
*/

// Auto-ping a cada 20 segundos para manter vivo
// No MV3, o sendMessage para si mesmo ajuda a resetar o timer de inatividade
setInterval(() => {
  if (isRecording) {
    chrome.runtime.getPlatformInfo(() => {}); // Operação dummy para manter o SW ativo
    chrome.runtime.sendMessage({ action: 'ping' }).catch(() => {});
  }
}, 20000);
