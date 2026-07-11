// Testa o núcleo de junção (merge-diarizacao.js) com dados sintéticos.
// Uso: node merge-test.js
const assert = require('assert');
const { juntarFalasComNomes } = require('./merge-diarizacao');

let passou = 0;
function cenario(nome, fn) {
  try { fn(); console.log(`✅ ${nome}`); passou++; }
  catch (e) { console.error(`❌ ${nome}\n   ${e.message}`); process.exitCode = 1; }
}

// ── 1) Alinhamento perfeito: A→Sheila, B→Julia, C→Mikaele ──────────────
cenario('alinhamento perfeito atribui os nomes certos', () => {
  const linha = [
    { nome: 'Sheila',  inicio: 0,     fim: 8000 },
    { nome: 'Julia',   inicio: 8000,  fim: 15000 },
    { nome: 'Mikaele', inicio: 15000, fim: 22000 },
    { nome: 'Sheila',  inicio: 22000, fim: 30000 },
  ];
  const falas = [
    { speaker: 'Pessoa A', text: 'bom dia pessoal, vamos começar', start: 500,   end: 7000, confianca: 0.9 },
    { speaker: 'Pessoa B', text: 'bom dia, tudo certo por aqui',    start: 8200,  end: 14000, confianca: 0.8 },
    { speaker: 'Pessoa C', text: 'podemos começar então?',          start: 15500, end: 21000, confianca: 0.7 },
    { speaker: 'Pessoa A', text: 'então sobre o projeto',           start: 22500, end: 29000, confianca: 0.4 },
  ];
  const { falas: out, mapa } = juntarFalasComNomes(falas, linha);
  assert.deepStrictEqual(out.map((f) => f.user), ['Sheila', 'Julia', 'Mikaele', 'Sheila']);
  assert.deepStrictEqual(mapa, { 'Pessoa A': 'Sheila', 'Pessoa B': 'Julia', 'Pessoa C': 'Mikaele' });
  assert.strictEqual(out[3].confianca, 0.4); // preserva a confiança p/ marcar incerto
});

// ── 2) Linha do tempo vazia (gravação offline sem contas) → anônimo ────
cenario('sem linha do tempo mantém Pessoa A/B (anônimo)', () => {
  const falas = [
    { speaker: 'Pessoa A', text: 'oi', start: 0, end: 1000 },
    { speaker: 'Pessoa B', text: 'tchau', start: 1000, end: 2000 },
  ];
  const { falas: out } = juntarFalasComNomes(falas, []);
  assert.deepStrictEqual(out.map((f) => f.user), ['Pessoa A', 'Pessoa B']);
});

// ── 3) Over-segmentação: A e D são a MESMA pessoa (Sheila) → ambos viram Sheila
cenario('junta over-segmentação (A e D = mesma conta)', () => {
  const linha = [{ nome: 'Sheila', inicio: 0, fim: 30000 }];
  const falas = [
    { speaker: 'Pessoa A', text: 'parte um', start: 1000,  end: 5000 },
    { speaker: 'Pessoa D', text: 'parte dois', start: 10000, end: 15000 },
  ];
  const { falas: out } = juntarFalasComNomes(falas, linha);
  assert.deepStrictEqual(out.map((f) => f.user), ['Sheila', 'Sheila']);
});

// ── 4) Fala sem sobreposição usa o nome consolidado do speaker ─────────
cenario('fala fora da linha herda o nome consolidado do speaker', () => {
  const linha = [{ nome: 'Julia', inicio: 0, fim: 5000 }];
  const falas = [
    { speaker: 'Pessoa A', text: 'dentro da janela', start: 1000, end: 4000 }, // vira Julia
    { speaker: 'Pessoa A', text: 'muito depois, sem overlap', start: 60000, end: 62000 }, // herda Julia
  ];
  const { falas: out } = juntarFalasComNomes(falas, linha);
  assert.deepStrictEqual(out.map((f) => f.user), ['Julia', 'Julia']);
});

// ── 5) 'fim' ausente na linha do tempo é estendido até o próximo evento ─
cenario('linha do tempo sem fim é normalizada corretamente', () => {
  const linha = [
    { nome: 'Ana',  inicio: 0 },     // fim vira 6000 (próximo evento)
    { nome: 'Beto', inicio: 6000 },  // fim vira 6000+4000 (padrão)
  ];
  const falas = [
    { speaker: 'Pessoa A', text: 'primeira', start: 1000, end: 3000 },
    { speaker: 'Pessoa B', text: 'segunda',  start: 7000, end: 9000 },
  ];
  const { falas: out } = juntarFalasComNomes(falas, linha);
  assert.deepStrictEqual(out.map((f) => f.user), ['Ana', 'Beto']);
});

console.log(`\n${passou}/5 cenários passaram.`);

// Demonstração visual (o "prova de conceito" que prometi)
console.log('\n─── demonstração ───');
const demoLinha = [
  { nome: 'Sheila', inicio: 0, fim: 9000 },
  { nome: 'Julia', inicio: 9000, fim: 18000 },
];
const demoFalas = [
  { speaker: 'Pessoa A', text: 'É porque a gente precisa gravar pra identificar as vozes', start: 800, end: 8500, confianca: 0.92 },
  { speaker: 'Pessoa B', text: 'Entendo. Você tá falando por cima de mim?', start: 9500, end: 16000, confianca: 0.45 },
];
for (const f of juntarFalasComNomes(demoFalas, demoLinha).falas) {
  const dv = f.confianca != null && f.confianca < 0.5 ? '  ⚠️' : '';
  console.log(`${f.user} (era ${f.speakerOriginal}): ${f.text}${dv}`);
}
