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
const captionToggle = document.getElementById('caption-toggle');

// ── INICIALIZAR ───────────────────────────────────────────
// Fonte única de verdade: chrome.storage.local
// O popup SEMPRE lê o estado do storage ao abrir.
document.addEventListener('DOMContentLoaded', () => {

  chrome.storage.local.get(['transcriptLines', 'captionDisplay', 'isRecording'], (data) => {

    // Restaura transcrições salvas
    if (data.transcriptLines?.length > 0) {
      transcriptBox.innerHTML = '';
      data.transcriptLines.forEach(line => appendTranscript(line.text, line.speaker, false));
    }

    // Restaura preferência de legenda
    if (captionToggle) captionToggle.value = data.captionDisplay || 'hidden';

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
            chrome.storage.local.set({ isRecording: true });
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

// ── TOGGLE LEGENDAS ──────────────────────────────────────
if (captionToggle) {
  captionToggle.addEventListener('change', () => {
    const mode = captionToggle.value;
    chrome.storage.local.set({ captionDisplay: mode });
    getActiveMeetTab((tab) => {
      if (!tab) return;
      chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: (newMode) => {
          document.getElementById('meetai-caption-style')?.remove();
          document.getElementById('meetai-visual-style')?.remove();
          if (newMode === 'visible') return;
          let css = '';
          if (newMode === 'hidden') {
            css = `
              .a4cQT,.pV6u9e,.iOzk7,[jsname="dsyhDe"],.vNKgIf,.CNusmb,.Mz6pEf {
                opacity:0!important;height:0!important;min-height:0!important;
                overflow:hidden!important;pointer-events:none!important;
                position:absolute!important;top:-9999px!important;left:-9999px!important;
              }`;
          } else if (newMode === 'mini') {
            css = `
              .iOzk7,[jsname="dsyhDe"] {
                position:fixed!important;bottom:70px!important;right:16px!important;
                left:auto!important;width:280px!important;font-size:11px!important;
                opacity:0.75!important;background:rgba(0,0,0,0.85)!important;
                border-radius:8px!important;padding:8px!important;
                z-index:9999!important;color:white!important;
                top:auto!important;height:auto!important;
                min-height:unset!important;overflow:visible!important;
              }
              .iOzk7 [jscontroller="KPn5nb"] { display:none!important; }`;
          }
          if (css) {
            const style = document.createElement('style');
            style.id = 'meetai-visual-style';
            style.textContent = css;
            document.head.appendChild(style);
          }
        },
        args: [mode]
      });
    });
  });
}

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
    chrome.runtime.sendMessage({ action: 'recordingStarted' });
    // Persiste estado ANTES do servidor responder — popup reabre corretamente
    chrome.storage.local.set({ isRecording: true });
    setStatus('recording');
  });
});

// ── BOTÃO PARAR ───────────────────────────────────────────
stopBtn.addEventListener('click', () => {
  getActiveMeetTab((tab) => {
    if (tab) chrome.tabs.sendMessage(tab.id, { action: 'stopRecording' }, () => {});
    chrome.runtime.sendMessage({ action: 'recordingStopped' });
    chrome.storage.local.set({ isRecording: false });
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
