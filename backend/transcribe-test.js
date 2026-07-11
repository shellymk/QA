// ============================================================
// transcribe-test.js — testa a diarização do AssemblyAI com QUALQUER
// arquivo de áudio local, sem precisar do resto do sistema.
//
// Uso:  node transcribe-test.js caminho/do/audio.mp3
//
// Serve pra você validar HOJE se a separação de vozes ("Pessoa A/B/C")
// atende — antes de investir na captura de áudio da extensão.
// Precisa de ASSEMBLYAI_API_KEY no .env.
// ============================================================
require('dotenv').config();
const { transcreverAudio } = require('./transcribe-assemblyai');

(async () => {
  const arquivo = process.argv[2];
  if (!arquivo) {
    console.error('Uso: node transcribe-test.js <arquivo-de-audio>  (ex.: gravacao.mp3, .m4a, .wav)');
    process.exit(1);
  }

  console.log('⏳ Enviando pro AssemblyAI e aguardando a diarização (pode levar ~1 min)…');
  const { texto, falas } = await transcreverAudio(arquivo, { language: 'pt' });

  const pessoas = new Set(falas.map((f) => f.speaker));
  console.log(`\n✅ ${falas.length} trecho(s), ${pessoas.size} pessoa(s) identificada(s):\n`);
  for (const f of falas) {
    const seg = Math.round(f.start / 1000);
    const hora = `${String(Math.floor(seg / 60)).padStart(2, '0')}:${String(seg % 60).padStart(2, '0')}`;
    // Marca trechos incertos (fala sobreposta/rápida) — a "indicação do gargalo".
    const duvida = f.confianca != null && f.confianca < 0.5 ? '  ⚠️ (identificação incerta)' : '';
    console.log(`[${hora}] ${f.speaker}: ${f.text}${duvida}`);
  }
  console.log('\n─── texto corrido ───\n' + texto);
})().catch((e) => { console.error('❌', e.message); process.exit(1); });
