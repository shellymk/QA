/*
================================================
MEETAI — create-user.js
Cria (ou atualiza a senha de) um usuário do painel.
A senha é guardada como hash bcrypt — nunca em texto puro.

Como usar:
  node create-user.js
(pergunta usuário e senha no terminal)

Não há endpoint de cadastro aberto de propósito: usuários só nascem por aqui.
================================================
*/

require('dotenv').config();
const readline = require('readline');
const bcrypt = require('bcryptjs');
const { MongoClient } = require('mongodb');

const MONGO_URI = process.env.MONGO_URI;
if (!MONGO_URI) {
  console.error('❌ MONGO_URI não configurado no .env');
  process.exit(1);
}

// Pergunta no terminal. Para a senha, desliga o eco (não aparece na tela).
function pergunta(texto, { oculto = false } = {}) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    if (oculto) {
      // Intercepta a escrita para mascarar a senha digitada.
      const stdout = process.stdout;
      const escrever = stdout.write.bind(stdout);
      rl._writeToOutput = (str) => {
        if (str.includes(texto)) return escrever(str);
        escrever('*');
      };
    }
    rl.question(texto, (resp) => { rl.close(); if (oculto) process.stdout.write('\n'); resolve(resp); });
  });
}

(async () => {
  const client = new MongoClient(MONGO_URI);
  try {
    const email = (await pergunta('Email: ')).trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { console.error('❌ Email inválido.'); process.exit(1); }
    const senha = await pergunta('Senha: ', { oculto: true });
    if (!senha || senha.length < 8) {
      console.error('❌ Senha precisa ter pelo menos 8 caracteres.');
      process.exit(1);
    }

    await client.connect();
    const db = client.db('meetai');
    const passwordHash = await bcrypt.hash(senha, 12);

    await db.collection('users').updateOne(
      { email },
      { $set: { email, passwordHash }, $setOnInsert: { createdAt: new Date() } },
      { upsert: true }
    );

    console.log(`\n✅ Usuário "${email}" salvo (senha hasheada com bcrypt).`);
    console.log('🚀 Agora você já pode logar no painel.');
  } catch (e) {
    console.error('❌ Erro ao criar usuário:', e.message);
    process.exitCode = 1;
  } finally {
    await client.close().catch(() => {});
    process.exit(process.exitCode || 0);
  }
})();
