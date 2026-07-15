/*
================================================
MEETAI — offscreen.js
Grava o ÁUDIO da aba da reunião (Etapa 3c) e envia pro servidor.
Roda num documento offscreen porque o service worker (MV3) não pode
usar getUserMedia/MediaRecorder.
================================================
*/
let recorder = null;
let chunks = [];
let audioCtx = null;
let comVideo = true; // se o vídeo da aba falhar, cai pra só-áudio (transcrição é o essencial)

chrome.runtime.onMessage.addListener((msg) => {
  if (!msg || msg.target !== 'offscreen') return;
  if (msg.type === 'start-recording') iniciar(msg.streamId);
  else if (msg.type === 'stop-recording') parar(msg.uploadUrl, msg.token);
});

// Avisa o background que o listener JÁ está registrado (evita a corrida de
// perder o 'start-recording' quando o documento offscreen acabou de ser criado).
try { chrome.runtime.sendMessage({ target: 'background', type: 'offscreen-ready' }); } catch (_) {}

async function iniciar(streamId) {
  const audioC = { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId } };
  const videoC = { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId } };

  // Etapa 5: tenta VÍDEO + ÁUDIO. Se o vídeo falhar, cai pra SÓ ÁUDIO —
  // assim a transcrição SEMPRE funciona (antes o vídeo obrigatório derrubava tudo).
  let stream = null;
  comVideo = true;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: audioC, video: videoC });
  } catch (e1) {
    comVideo = false;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: audioC });
      envia({ type: 'recording-note', note: 'vídeo indisponível — gravando só áudio (' + ((e1 && e1.message) || e1) + ')' });
    } catch (e2) {
      envia({ type: 'recording-error', error: 'áudio+vídeo falhou: ' + ((e1 && e1.message) || e1) + ' | áudio-só falhou: ' + ((e2 && e2.message) || e2) });
      return;
    }
  }

  try {
    // Capturar a aba MUTA o áudio pro usuário; reproduzimos de volta pra ele continuar ouvindo.
    audioCtx = new AudioContext();
    audioCtx.createMediaStreamSource(stream).connect(audioCtx.destination);
  } catch (_) {}

  chunks = [];
  const mime = comVideo
    ? (MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus') ? 'video/webm;codecs=vp9,opus' : 'video/webm')
    : (MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm');
  recorder = new MediaRecorder(stream, { mimeType: mime });
  recorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
  recorder.start(1000); // junta dados a cada 1s
  envia({ type: 'recording-started', comVideo });
}

async function parar(uploadUrl, token) {
  if (!recorder) { envia({ type: 'upload-error', error: 'gravação não estava ativa' }); return; }
  const rec = recorder;
  recorder = null;
  await new Promise((res) => { rec.onstop = res; try { rec.stop(); } catch (_) { res(); } });
  try { rec.stream.getTracks().forEach((t) => t.stop()); } catch (_) {}
  try { if (audioCtx) await audioCtx.close(); } catch (_) {}

  const tipo = comVideo ? 'video/webm' : 'audio/webm';
  const blob = new Blob(chunks, { type: tipo });
  chunks = [];
  if (!blob.size) { envia({ type: 'upload-error', error: 'gravação vazia' }); return; }

  try {
    const r = await fetch(uploadUrl, {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + (token || ''), 'Content-Type': tipo },
      body: blob,
    });
    const j = await r.json().catch(() => ({}));
    envia({ type: 'upload-done', ok: r.ok, status: r.status, resp: j });
  } catch (e) {
    envia({ type: 'upload-error', error: String((e && e.message) || e) });
  }
}

function envia(payload) {
  chrome.runtime.sendMessage({ target: 'background', ...payload });
}
