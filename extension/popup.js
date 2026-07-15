/*
================================================
MEETAI — popup.js (CORRIGIDO v4)
================================================
CORREÇÕES:
1. Estado dos botões persiste ao trocar de aba/janela
2. Botão Iniciar NÃO desativa antes de confirmar start
3. Sincronização confiável via chrome.storage.local
4. Botões: Iniciar desativado ENQUANTO grava,
           Parar  desativado ENQUANTO NÃO grava
================================================
*/

const statusEl      = document.getElementById('status');
const transcriptBox = document.getElementById('transcript');
const startBtn      = document.getElementById('start');
const stopBtn       = document.getElementById('stop');
const clearBtn      = document.getElementById('clear');
const sessaoStatus  = document.getElementById('sessao-status');

// URL do PAINEL (Vercel) pra onde mandamos o usuário logar — NÃO é o backend.
// Deve bater com uma das origens do session-bridge (manifest). Dev local: localhost:5173.
const PAINEL_URL = 'https://qa-gray.vercel.app';

// ── SESSÃO — login herdado do painel (session-bridge.js) ──────────
// A extensão NÃO pede chave nem login: reaproveita o JWT que o usuário já
// tem no painel. Aqui só mostramos se está conectado.
function atualizarSessao() {
  chrome.runtime.sendMessage({ action: 'getSession' }, (res) => {
    if (chrome.runtime.lastError || !res) {
      sessaoStatus.innerHTML = '⚠️ Sem conexão com a extensão';
      sessaoStatus.style.color = '#F87171';
      return;
    }
    if (res.conectado) {
      sessaoStatus.innerHTML = '✅ Conectado' + (res.email ? ' como <b>' + res.email + '</b>' : '');
      sessaoStatus.style.color = '#86EFAC';
    } else {
      sessaoStatus.innerHTML = '⚠️ Faça login no <a href="' + PAINEL_URL + '" target="_blank">painel</a> pra ativar';
      sessaoStatus.style.color = '#FBBF24';
    }
  });
}
atualizarSessao();
// Reflete login/logout feito no painel enquanto o popup está aberto.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.painelToken) atualizarSessao();
});

// ── INICIALIZAR ───────────────────────────────────────────
// Fonte única de verdade: chrome.storage.local
// O popup SEMPRE lê o estado do storage ao abrir.
document.addEventListener('DOMContentLoaded', () => {

  chrome.storage.local.get(['transcriptLines', 'captionDisplay', 'isRecording', 'transcriptSession'], (data) => {

    // Nunca restaura transcrições de sessões anteriores ao abrir o popup
    // transcriptLines só é mostrado se gravação está ativa E sessionId bate
    chrome.storage.local.set({ transcriptLines: [], sessionId: null });
    transcriptBox.innerHTML = '';

    // ↓↓ CORREÇÃO PRINCIPAL ↓↓
    // O estado vem do storage — o popup não precisa "adivinhar".
    // Se isRecording=true no storage, mostra como gravando sem consultar content.js.
    if (data.isRecording === true) {
      setStatus('recording');
    } else {
      // Confirma com a aba do Meet se realmente não está gravando
      getActiveMeetTab((tab) => {
        if (!tab) { setStatus('no-meet'); return; }
        chrome.tabs.sendMessage(tab.id, { action: 'getStatus' }, (res) => {
          if (chrome.runtime.lastError || !res) { setStatus('in-meeting'); return; }
          if (res.isRecording) {
            // Limpa transcrições anteriores ANTES de iniciar nova sessão
    chrome.storage.local.set({ isRecording: true, transcriptLines: [] });
    transcriptBox.innerHTML = '';
            setStatus('recording');
          } else {
            setStatus('in-meeting');
          }
        });
      });
    }
  });
});

// ── HELPER: aba do Meet ───────────────────────────────────
function getActiveMeetTab(cb) {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs[0];
    if (tab?.url?.includes('meet.google.com')) { cb(tab); return; }
    chrome.tabs.query({ url: 'https://meet.google.com/*' }, (meetTabs) => {
      cb(meetTabs?.[0] || null);
    });
  });
}

// Legendas ocultadas automaticamente pelo content.js

// ── BOTÃO INICIAR ─────────────────────────────────────────
startBtn.addEventListener('click', () => {
  // Desativa imediatamente para evitar duplo clique
  startBtn.disabled = true;

  getActiveMeetTab((tab) => {
    if (!tab) { setStatus('no-meet'); startBtn.disabled = false; return; }

    setStatus('waiting');

    function sendStart() {
      chrome.tabs.sendMessage(tab.id, { action: 'startRecording' }, (res) => {
        if (chrome.runtime.lastError) {
          // Content.js não carregou — injeta e tenta de novo
          chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] }, () => {
            if (chrome.runtime.lastError) {
              console.warn('[MeetAI] Falha ao injetar content.js:', chrome.runtime.lastError.message);
              setStatus('error');
              return;
            }
            setTimeout(() => chrome.tabs.sendMessage(tab.id, { action: 'startRecording' }, () => {}), 500);
          });
        }
      });
    }

    sendStart();
    // SÓ LEGENDA (sem áudio): avisa o background pra criar a reunião. A
    // transcrição vem da legenda do Meet, agrupada em frases coerentes.
    chrome.runtime.sendMessage({ action: 'recordingStarted' });
    // Persiste estado ANTES do servidor responder — popup reabre corretamente
    chrome.storage.local.set({ isRecording: true });
    setStatus('recording');
  });
});

// ── BOTÃO PARAR ───────────────────────────────────────────
stopBtn.addEventListener('click', () => {
  getActiveMeetTab((tab) => {
    // Só o content dispara 'recordingStopped' (DEPOIS de esvaziar as falas do
    // buffer). Se o popup mandasse também, poderia encerrar a reunião ANTES do
    // texto final ser salvo — outra causa do "vinha zerado".
    if (tab) chrome.tabs.sendMessage(tab.id, { action: 'stopRecording' }, () => {});
    // Limpa transcrições do storage ao parar — próxima sessão começa limpa
    chrome.storage.local.set({ isRecording: false, transcriptLines: [] });
    transcriptBox.innerHTML = '';
    setStatus('stopped');
  });
});

// ── BOTÃO LIMPAR ──────────────────────────────────────────
clearBtn.addEventListener('click', () => {
  transcriptBox.innerHTML = '';
  chrome.storage.local.set({ transcriptLines: [] });
});



// ── MENSAGENS EM TEMPO REAL ───────────────────────────────
chrome.runtime.onMessage.addListener((msg) => {

  if (msg.type === 'meetingDetected') {
    chrome.storage.local.get(['isRecording'], (data) => {
      if (!data.isRecording) setStatus('in-meeting');
    });
  }

  if (msg.type === 'status') {
    if (msg.value?.includes('Gravando') || msg.value?.includes('gravando')) {
      setStatus('recording');
    } else if (msg.value?.includes('encerrada') || msg.value?.includes('parada')) {
      chrome.storage.local.set({ isRecording: false });
      setStatus('stopped');
    }
  }

  if (msg.type === 'transcription') {
    appendTranscript(msg.text, msg.speaker, true);
  }

  if (msg.type === 'error') {
    setStatus('error');
  }

  if (msg.type === 'clearTranscript') {
    transcriptBox.innerHTML = '';
  }
});

// ── ADICIONAR LINHA NA TRANSCRIÇÃO ───────────────────────
function appendTranscript(text, speaker, scroll = true) {
  const entry = document.createElement('div');
  entry.className = 'transcript-entry';
  entry.style.marginBottom = '6px';

  const speakerEl = document.createElement('b');
  speakerEl.innerText = (speaker || 'Participante') + ': ';
  speakerEl.style.color = '#8B5CF6';

  const textEl = document.createElement('span');
  textEl.innerText = text;
  textEl.style.color = '#D1D5DB';

  entry.appendChild(speakerEl);
  entry.appendChild(textEl);
  transcriptBox.appendChild(entry);

  if (scroll) transcriptBox.scrollTop = transcriptBox.scrollHeight;
}

// ── setStatus — FONTE ÚNICA DE VERDADE PARA BOTÕES ───────
// REGRA:
//   Gravando  → Iniciar DESATIVADO, Parar ATIVO
//   Não gravando → Iniciar ATIVO,    Parar DESATIVADO
function setStatus(state) {
  statusEl.className = 'status';
  // Reset seguro
  startBtn.disabled = false;
  stopBtn.disabled  = true;

  switch (state) {

    case 'recording':
      statusEl.innerText = '🔴 Gravando...';
      statusEl.className = 'status recording';
      startBtn.disabled  = true;   // ← desativado enquanto grava
      stopBtn.disabled   = false;  // ← ativo para poder parar
      break;

    case 'waiting':
      statusEl.innerText = '⏳ Iniciando...';
      statusEl.className = 'status waiting';
      startBtn.disabled  = true;   // ← desativado enquanto aguarda
      stopBtn.disabled   = false;
      break;

    case 'in-meeting':
      statusEl.innerText = '🟢 Em reunião — clique Iniciar';
      statusEl.className = 'status waiting';
      startBtn.disabled  = false;  // ← pode iniciar
      stopBtn.disabled   = true;
      break;

    case 'stopped':
      statusEl.innerText = '⏹ Parado';
      statusEl.className = 'status stopped';
      startBtn.disabled  = false;
      stopBtn.disabled   = true;
      break;

    case 'no-meet':
      statusEl.innerText = '⚠️ Abra o Google Meet';
      statusEl.className = 'status error';
      startBtn.disabled  = true;
      stopBtn.disabled   = true;
      break;

    case 'error':
      statusEl.innerText = '⚠️ Erro — servidor offline?';
      statusEl.className = 'status error';
      startBtn.disabled  = false;
      stopBtn.disabled   = true;
      break;
  }
}