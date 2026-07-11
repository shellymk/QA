// ============================================================
// merge-diarizacao.js — NÚCLEO UNIVERSAL do híbrido.
//
// Junta as falas do AssemblyAI (texto de qualidade, mas "Pessoa A/B"
// anônimo) com uma LINHA DO TEMPO de "quem falou quando, por conta"
// (nome + intervalo em ms), que QUALQUER plataforma pode fornecer:
//   - Meet    → nome do autor na legenda
//   - Discord → usuário + indicador "está falando"
//   - Teams/Zoom → indicador de quem fala
//
// Resultado: a mesma transcrição, agora com os NOMES reais.
// Não tem NADA específico de plataforma aqui — é reaproveitável.
// ============================================================

// Sobreposição (ms) entre dois intervalos [aIni,aFim] e [bIni,bFim].
function sobreposicao(aIni, aFim, bIni, bFim) {
  return Math.max(0, Math.min(aFim, bFim) - Math.max(aIni, bIni));
}

// Normaliza a linha do tempo: ordena e garante 'fim'. Se 'fim' faltar,
// estende até o próximo evento (ou +padraoMs no último) — porque os
// adaptadores às vezes só sabem QUANDO alguém começou a falar.
function normalizarLinha(linha, padraoMs = 4000) {
  const ord = [...linha]
    .filter((e) => e && typeof e.inicio === 'number' && e.nome)
    .sort((a, b) => a.inicio - b.inicio);
  return ord.map((e, i) => ({
    nome: e.nome,
    inicio: e.inicio,
    fim: typeof e.fim === 'number' ? e.fim : (ord[i + 1] ? ord[i + 1].inicio : e.inicio + padraoMs),
  }));
}

// Para uma fala (intervalo), qual nome tem MAIS sobreposição de tempo?
function nomePorSobreposicao(ini, fim, linha) {
  const acc = new Map();
  for (const seg of linha) {
    const ov = sobreposicao(ini, fim, seg.inicio, seg.fim);
    if (ov > 0) acc.set(seg.nome, (acc.get(seg.nome) || 0) + ov);
  }
  let melhor = null;
  let max = 0;
  for (const [nome, ov] of acc) if (ov > max) { max = ov; melhor = nome; }
  return melhor; // null se não houver sobreposição
}

// Junta falas (AssemblyAI) + linha do tempo (nomes) → falas com nome.
// falas: [{ speaker, text, start, end, confianca }]  (ms desde o início)
// linhaDoTempo: [{ nome, inicio, fim? }]              (mesma base de tempo)
function juntarFalasComNomes(falas, linhaDoTempo = [], opts = {}) {
  const linha = normalizarLinha(linhaDoTempo, opts.padraoMs);

  // 1) nome provisório por fala (maior sobreposição de tempo)
  const provis = falas.map((f) => ({
    ...f,
    _nome: nomePorSobreposicao(f.start, f.end ?? f.start, linha),
  }));

  // 2) consolida POR speaker do AssemblyAI: cada "Pessoa A" recebe o nome
  //    dominante entre suas falas (robusto a erros pontuais de alinhamento;
  //    também junta over-segmentação — se A e D forem a mesma pessoa, viram o mesmo nome).
  const votos = new Map(); // speaker -> Map(nome -> duração somada)
  for (const f of provis) {
    if (!f._nome) continue;
    const dur = ((f.end ?? f.start) - f.start) || 1;
    if (!votos.has(f.speaker)) votos.set(f.speaker, new Map());
    const m = votos.get(f.speaker);
    m.set(f._nome, (m.get(f._nome) || 0) + dur);
  }
  const speakerParaNome = new Map();
  for (const [speaker, m] of votos) {
    let melhor = null;
    let max = 0;
    for (const [nome, d] of m) if (d > max) { max = d; melhor = nome; }
    if (melhor) speakerParaNome.set(speaker, melhor);
  }

  // 3) rótulo final: nome consolidado do speaker > nome da própria fala > o speaker (fallback anônimo)
  const resultado = provis.map((f) => ({
    user: speakerParaNome.get(f.speaker) || f._nome || f.speaker,
    text: f.text,
    start: f.start,
    end: f.end,
    confianca: f.confianca,
    speakerOriginal: f.speaker,
  }));

  return { falas: resultado, mapa: Object.fromEntries(speakerParaNome) };
}

module.exports = { juntarFalasComNomes, sobreposicao, normalizarLinha };
