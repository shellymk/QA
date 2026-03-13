const statusEl     = document.getElementById('status');
const transcriptBox = document.getElementById('transcript');
const startBtn     = document.getElementById('start');
const stopBtn      = document.getElementById('stop');
const clearBtn     = document.getElementById('clear');
const captionToggle = document.getElementById('caption-toggle');

// ══════════════════════════════════════════════
// INICIALIZAR
// ══════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {

  // Restaura transcrição salva (linhas estruturadas) e preferência de legenda
  chrome.storage.local.get(['transcriptLines', 'captionDisplay'], (data) => {
    // Carrega linhas salvas pelo background (funciona mesmo com popup fechado)
    if (data.transcriptLines && data.transcriptLines.length > 0) {
      transcriptBox.innerHTML = '';
      data.transcriptLines.forEach(line => appendTranscript(line.text, line.speaker));
    }
    if (captionToggle) captionToggle.value = data.captionDisplay || 'hidden';
  });

  // Pergunta ao background o estado atual
  chrome.runtime.sendMessage({ action: 'getStatus' }, (res) => {
    if (chrome.runtime.lastError) return;
    if (res?.isRecording) {
      setStatus('recording');
    } else {
      // Verifica se está em reunião mas não gravando
      getActiveMeetTab((tab) => {
        if (tab) {
          setStatus('in-meeting');
        } else {
          setStatus('stopped');
        }
      });
    }
  });

});

// ══════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════
function getActiveMeetTab(cb) {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs[0];
    if (tab?.url?.includes('meet.google.com')) cb(tab);
    else cb(null);
  });
}

// ══════════════════════════════════════════════
// TOGGLE DE LEGENDAS
// ══════════════════════════════════════════════
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
          if (newMode === 'visible') return;
          let css = '';
          if (newMode === 'hidden') {
            css = `
              .iOzk7, [jsname="dsyhDe"], .nMcdL.bj4p3b,
              .a4cQT, [jscontroller="KPn5nb"], .vNKgIf.UDinHf {
                opacity: 0 !important; pointer-events: none !important;
                height: 0 !important; overflow: hidden !important;
                padding: 0 !important; margin: 0 !important;
              }`;
          } else if (newMode === 'mini') {
            css = `
              .iOzk7, [jsname="dsyhDe"] {
                position: fixed !important; bottom: 70px !important;
                right: 16px !important; left: auto !important;
                width: 280px !important; font-size: 11px !important;
                opacity: 0.75 !important; background: rgba(0,0,0,0.65) !important;
                border-radius: 8px !important; padding: 6px 10px !important;
                z-index: 9999 !important;
              }
              .iOzk7 [jscontroller="KPn5nb"],
              [jsname="dsyhDe"] [jscontroller="KPn5nb"] { display: none !important; }`;
          }
          if (css) {
            const style = document.createElement('style');
            style.id = 'meetai-caption-style';
            style.textContent = css;
            document.head.appendChild(style);
          }
        },
        args: [mode]
      });
    });
  });
}

// ══════════════════════════════════════════════
// BOTÃO INICIAR
// Manda startRecording direto pro content.js da
// aba ativa. O content.js ativa legendas, inicia
// observer e avisa o background via recordingStarted.
// ══════════════════════════════════════════════
startBtn.addEventListener('click', () => {
  getActiveMeetTab((tab) => {
    if (!tab) {
      setStatus('no-meet');
      return;
    }

    setStatus('waiting');

    // Envia pro content.js da aba do Meet
    chrome.tabs.sendMessage(tab.id, { action: 'startRecording' }, (res) => {
      if (chrome.runtime.lastError || !res?.ok) {
        // content.js pode não estar pronto ainda — tenta injetar
        chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['content.js']
        }, () => {
          // Tenta de novo após injeção
          setTimeout(() => {
            chrome.tabs.sendMessage(tab.id, { action: 'startRecording' }, (res2) => {
              if (!res2?.ok) setStatus('error');
            });
          }, 800);
        });
      }
      // Status será atualizado quando background confirmar via recordingStarted
    });
  });
});

// ══════════════════════════════════════════════
// BOTÃO PARAR
// ══════════════════════════════════════════════
stopBtn.addEventListener('click', () => {
  getActiveMeetTab((tab) => {
    if (tab) {
      // Avisa o content.js para parar
      chrome.tabs.sendMessage(tab.id, { action: 'stopRecording' }, () => {
        chrome.runtime.lastError; // limpa erro silenciosamente
      });
    }
    // Avisa o background diretamente também (garante consistência)
    chrome.runtime.sendMessage({ action: 'recordingStopped' }, () => {
      chrome.runtime.lastError;
    });
    setStatus('stopped');
  });
});

// ══════════════════════════════════════════════
// BOTÃO LIMPAR
// ══════════════════════════════════════════════
clearBtn.addEventListener('click', () => {
  transcriptBox.innerHTML = '';
  chrome.storage.local.remove(['transcriptLines']);
});

// ══════════════════════════════════════════════
// RECEBER MENSAGENS DO BACKGROUND
// ══════════════════════════════════════════════
chrome.runtime.onMessage.addListener((msg) => {

  // Reunião detectada pelo content.js — habilita o botão iniciar
  if (msg.type === 'meetingDetected') {
    if (statusEl.innerText.includes('Parado') || statusEl.innerText.includes('Meet')) {
      setStatus('in-meeting');
    }
  }

  // Background confirmou que a gravação começou no servidor
  if (msg.type === 'status') {
    if (msg.value?.includes('Gravando')) setStatus('recording');
    else if (msg.value?.includes('parada') || msg.value?.includes('encerrada')) setStatus('stopped');
    else statusEl.innerText = msg.value;
  }

  // Transcrição chegou
  if (msg.type === 'transcription') {
    appendTranscript(msg.text, msg.speaker);
    // Se ainda estava em "Aguardando", confirma que está gravando
    if (statusEl.innerText.includes('Aguardando')) setStatus('recording');
  }

  // Participantes atualizados
  if (msg.type === 'participants') {
    // Opcional: mostrar lista de participantes
  }

  // Erro do servidor
  if (msg.type === 'error') {
    statusEl.innerText = '⚠️ ' + msg.value;
    statusEl.className = 'status error';
    setStatus('stopped');
  }
});

// ══════════════════════════════════════════════
// ADICIONAR TRANSCRIÇÃO
// ══════════════════════════════════════════════
function appendTranscript(text, speaker) {
  const entry = document.createElement('div');
  entry.className = 'transcript-entry';

  const speakerEl = document.createElement('span');
  speakerEl.className = 'speaker-name';
  speakerEl.innerText = (speaker || 'Participante') + ': ';

  const textEl = document.createElement('span');
  textEl.className = 'transcript-text';
  textEl.innerText = text;

  entry.appendChild(speakerEl);
  entry.appendChild(textEl);
  transcriptBox.appendChild(entry);
  transcriptBox.scrollTop = transcriptBox.scrollHeight;

  // Persiste no storage
  // Não precisa salvar aqui — background já persiste em transcriptLines
}

// ══════════════════════════════════════════════
// GERENCIAR STATUS E BOTÕES
// ══════════════════════════════════════════════
function setStatus(state) {
  // Reset botões
  startBtn.disabled = false;
  stopBtn.disabled  = true;

  statusEl.className = 'status';

  switch (state) {

    case 'recording':
      statusEl.innerText = '🔴 Gravando...';
      statusEl.className = 'status recording';
      startBtn.disabled  = true;
      stopBtn.disabled   = false;
      break;

    case 'waiting':
      statusEl.innerText = '⏳ Iniciando...';
      statusEl.className = 'status waiting';
      startBtn.disabled  = true;   // ← não permite clicar de novo enquanto espera
      stopBtn.disabled   = false;
      break;

    case 'in-meeting':
      statusEl.innerText = '🟢 Em reunião — clique Iniciar para gravar';
      statusEl.className = 'status waiting';
      startBtn.disabled  = false;
      stopBtn.disabled   = true;
      break;

    case 'stopped':
      statusEl.innerText = '⏹ Parado';
      statusEl.className = 'status stopped';
      startBtn.disabled  = false;
      stopBtn.disabled   = true;
      break;

    case 'no-meet':
      statusEl.innerText = '⚠️ Abra o Google Meet primeiro';
      statusEl.className = 'status error';
      startBtn.disabled  = false;
      stopBtn.disabled   = true;
      break;

    case 'error':
      statusEl.className = 'status error';
      startBtn.disabled  = false;
      stopBtn.disabled   = true;
      break;

    default:
      statusEl.innerText = '⏹ Parado';
      statusEl.className = 'status stopped';
  }
}