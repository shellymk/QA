// ============================================================
// reset-db.js — ZERA os dados de teste do MeetAI.
// Apaga TODAS as reuniões (e suas transcrições) da coleção `meetings`.
//
// Uso:  node reset-db.js       (ou:  npm run reset)
//
// ⚠️ DESTRUTIVO e irreversível. Feito para limpar testes entre uma
//    reunião e outra ("a cada teste, zera"). Não usar em produção real.
// ============================================================
require('dotenv').config();
const { MongoClient } = require('mongodb');

(async () => {
  const client = new MongoClient(process.env.MONGO_URI);
  await client.connect();
  const db = client.db(); // db do MONGO_URI (meetai)

  const antes = await db.collection('meetings').countDocuments();
  const r = await db.collection('meetings').deleteMany({});

  console.log(`🧹 Reuniões apagadas: ${r.deletedCount} (havia ${antes}).`);
  console.log('✅ Banco zerado — o painel vai mostrar 0 em tudo.');
  await client.close();
})().catch((e) => { console.error('❌ ERRO ao zerar:', e.message); process.exit(1); });
