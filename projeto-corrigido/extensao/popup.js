const statusEl = document.getElementById('status');
const transcriptBox = document.getElementById('transcript');
const startBtn = document.getElementById('start');
const stopBtn = document.getElementById('stop');
const clearBtn = document.getElementById('clear');
const captionToggle = document.getElementById('caption-toggle');

/*
==============================
INICIALIZAR
==============================
*/
document.addEventListener('DOMContentLoaded', () => {

  chrome.storage.local.get(['transcript', 'isRecording', 'captionDisplay'], (data) => {

    if (data.transcript) {
      transcriptBox.innerHTML = data.transcript;
      transcriptBox.scrollTop = transcriptBox.scrollHeight;
    }

    if (data.isRecording) setStatus('recording');

    // Restaura preferência de exibição de legenda
    const mode = data.captionDisplay || 'hidden';
    if (captionToggle) captionToggle.value = mode;
  });

  chrome.runtime.sendMessage({ action: 'getStatus' }, (res) => {
    if (res?.isRecording) setStatus('recording');
  });

});

/*
==============================
TOGGLE DE LEGENDAS
==============================
*/
if (captionToggle) {
  captionToggle.addEventListener('change', () => {
    const mode = captionToggle.value;
    chrome.storage.local.set({ captionDisplay: mode });

    // Reaplica o CSS na aba ativa do Meet
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs[0]?.url?.includes('meet.google.com')) return;
      chrome.scripting.executeScript({
        target: { tabId: tabs[0].id },
        func: (newMode) => {
          // Remove estilo anterior
          document.getElementById('meetai-caption-style')?.remove();

          if (newMode === 'visible') return;

          let css = '';
          if (newMode === 'hidden') {
            css = `
              .iOzk7, [jsname="dsyhDe"], .nMcdL.bj4p3b,
              .a4cQT, [jscontroller="KPn5nb"], .vNKgIf.UDinHf {
                opacity: 0 !important;
                pointer-events: none !important;
                height: 0 !important;
                overflow: hidden !important;
                padding: 0 !important;
                margin: 0 !important;
              }
            `;
          } else if (newMode === 'mini') {
            css = `
              .iOzk7, [jsname="dsyhDe"] {
                position: fixed !important;
                bottom: 70px !important;
                right: 16px !important;
                left: auto !important;
                width: 280px !important;
                font-size: 11px !important;
                opacity: 0.75 !important;
                background: rgba(0,0,0,0.65) !important;
                border-radius: 8px !important;
                padding: 6px 10px !important;
                z-index: 9999 !important;
              }
              .iOzk7 [jscontroller="KPn5nb"],
              [jsname="dsyhDe"] [jscontroller="KPn5nb"] {
                display: none !important;
              }
            `;
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

/*
==============================
BOTÃO INICIAR
==============================
*/
startBtn.addEventListener('click', () => {
  setStatus('waiting');
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs[0]?.url?.includes('meet.google.com')) {
      statusEl.innerText = '⚠️ Abra o Google Meet primeiro';
      return;
    }
    // Força redetecção no content.js
    chrome.scripting.executeScript({
      target: { tabId: tabs[0].id },
      func: () => window.dispatchEvent(new CustomEvent('meetai-force-detect'))
    });
  });
});

/*
==============================
BOTÃO PARAR
==============================
*/
stopBtn.addEventListener('click', () => {
  chrome.runtime.sendMessage({ action: 'stopCapture' });
  setStatus('stopped');
});

/*
==============================
BOTÃO LIMPAR
==============================
*/
clearBtn.addEventListener('click', () => {
  transcriptBox.innerHTML = '';
  chrome.storage.local.remove(['transcript']);
});

/*
==============================
RECEBER MENSAGENS
==============================
*/
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'transcription') appendTranscript(msg.text, msg.speaker);
  if (msg.type === 'status') statusEl.innerText = msg.value;
});

/*
==============================
ADICIONAR TEXTO
==============================
*/
function appendTranscript(text, speaker) {
  const entry = document.createElement('div');
  entry.className = 'transcript-entry';

  const speakerEl = document.createElement('span');
  speakerEl.className = 'speaker-name';
  speakerEl.innerText = speaker || 'Participante';

  const textEl = document.createElement('span');
  textEl.className = 'transcript-text';
  textEl.innerText = ' ' + text;

  entry.appendChild(speakerEl);
  entry.appendChild(textEl);
  transcriptBox.appendChild(entry);
  transcriptBox.scrollTop = transcriptBox.scrollHeight;

  chrome.storage.local.get(['transcript'], (data) => {
    chrome.storage.local.set({ transcript: (data.transcript || '') + entry.outerHTML });
  });
}

/*
==============================
STATUS
==============================
*/
function setStatus(state) {
  startBtn.disabled = false;
  stopBtn.disabled = false;
  switch (state) {
    case 'recording':
      statusEl.innerText = '🔴 Gravando...';
      statusEl.className = 'status recording';
      startBtn.disabled = true;
      break;
    case 'waiting':
      statusEl.innerText = '⏳ Aguardando...';
      statusEl.className = 'status waiting';
      break;
    case 'stopped':
      statusEl.innerText = '⏹ Parado';
      statusEl.className = 'status stopped';
      stopBtn.disabled = true;
      break;
    default:
      statusEl.innerText = '⏹ Parado';
  }
}