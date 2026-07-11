// ============================================================
// Integração com AssemblyAI — STT + DIARIZAÇÃO (speaker_labels).
// Modo BATCH (assíncrono): manda o áudio, pede a transcrição com
// separação de vozes e espera terminar. Combina com a decisão de
// "processar no fim e mostrar quando a reunião acabar".
//
// Precisa de ASSEMBLYAI_API_KEY no .env. Node 18+ (fetch global).
// ============================================================
const fs = require('fs');

const BASE = 'https://api.assemblyai.com/v2';

function chave() {
  const k = process.env.ASSEMBLYAI_API_KEY;
  if (!k) throw new Error('ASSEMBLYAI_API_KEY não configurada no .env');
  return k;
}

// 1) Sobe o áudio pro AssemblyAI → devolve a upload_url temporária.
async function subirAudio(bufferOuCaminho) {
  const dados = Buffer.isBuffer(bufferOuCaminho) ? bufferOuCaminho : fs.readFileSync(bufferOuCaminho);
  const r = await fetch(`${BASE}/upload`, {
    method: 'POST',
    headers: { authorization: chave(), 'content-type': 'application/octet-stream' },
    body: dados,
  });
  if (!r.ok) throw new Error(`Upload falhou: HTTP ${r.status} — ${await r.text()}`);
  return (await r.json()).upload_url;
}

// 2) Cria o job de transcrição com diarização ligada.
async function criarTranscricao(audioUrl, { language = 'pt' } = {}) {
  const r = await fetch(`${BASE}/transcript`, {
    method: 'POST',
    headers: { authorization: chave(), 'content-type': 'application/json' },
    body: JSON.stringify({
      audio_url: audioUrl,
      speaker_labels: true,   // ← diarização (separa Pessoa A/B/C…)
      language_code: language,
    }),
  });
  if (!r.ok) throw new Error(`Criar transcrição falhou: HTTP ${r.status} — ${await r.text()}`);
  return (await r.json()).id;
}

// 3) Espera o job terminar (polling).
async function esperar(id, { intervaloMs = 3000, timeoutMs = 600000 } = {}) {
  const ate = Date.now() + timeoutMs;
  while (Date.now() < ate) {
    const r = await fetch(`${BASE}/transcript/${id}`, { headers: { authorization: chave() } });
    const j = await r.json();
    if (j.status === 'completed') return j;
    if (j.status === 'error') throw new Error(`AssemblyAI erro: ${j.error}`);
    await new Promise((res) => setTimeout(res, intervaloMs));
  }
  throw new Error('Timeout esperando a transcrição do AssemblyAI');
}

// Função principal: áudio (buffer OU caminho de arquivo) → falas separadas.
// Retorna { texto, falas: [{ speaker, text, start, end }], id }.
// speaker vem como 'A','B','C'… do AssemblyAI; viramos "Pessoa A/B/C".
async function transcreverAudio(bufferOuCaminho, opts = {}) {
  const url = await subirAudio(bufferOuCaminho);
  const id = await criarTranscricao(url, opts);
  const t = await esperar(id, opts);
  const falas = (t.utterances || []).map((u) => ({
    speaker: `Pessoa ${u.speaker}`,
    text: u.text,
    start: u.start, // ms desde o início
    end: u.end,
    confianca: u.confidence, // 0..1 — baixo = identificação incerta (fala sobreposta/rápida)
  }));
  return { texto: t.text || '', falas, id, duracaoSeg: t.audio_duration };
}

module.exports = { transcreverAudio };
