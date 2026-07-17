// server.js — MEETAI (CORRIGIDO)
// CORREÇÃO #5: painel web para de mostrar "ao vivo" quando reunião é encerrada
// — broadcastSSE disparado em TODOS os caminhos de fim de reunião
// — endpoint /api/meetings retorna campo `status` calculado corretamente
// — reuniões sem finishedAt que estão há mais de 8h são auto-finalizadas

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { MongoClient, ObjectId } = require('mongodb');
const { transcreverAudio } = require('./transcribe-assemblyai');
const { juntarFalasComNomes } = require('./merge-diarizacao');
const fs = require('fs');

// Etapa 5 — gravações (vídeo/áudio) guardadas em arquivo (fora do banco, que é pesado).
const RECORDINGS_DIR = path.join(__dirname, 'recordings');
function salvarMidia(id, buffer) {
  fs.mkdirSync(RECORDINGS_DIR, { recursive: true });
  fs.writeFileSync(path.join(RECORDINGS_DIR, id), buffer);
}

const app = express();

// ── Config básica no topo (middlewares abaixo dependem de PORT) ──────────────
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '127.0.0.1'; // AUDITORIA #1: não expor na rede
const MONGO_URI = process.env.MONGO_URI;

// AUTENTICAÇÃO — o login/cadastro/Google/reset ficam por conta do Auth0. O
// backend só VALIDA o token que o Auth0 emite (assinatura RS256 via JWKS), com
// base no DOMAIN + AUDIENCE. Não há mais senha nem JWT próprio aqui.
// A EXTENSION_API_KEY segue para a extensão/bot (rota de máquina, sem login).
// Fail-safe: sem essas variáveis o servidor NÃO sobe, para nunca rodar aberto.
const AUTH0_DOMAIN = process.env.AUTH0_DOMAIN;      // ex.: dev-xxxx.uk.auth0.com
const AUTH0_AUDIENCE = process.env.AUTH0_AUDIENCE;  // ex.: https://api.meetai
const EXTENSION_API_KEY = process.env.EXTENSION_API_KEY;
if (!AUTH0_DOMAIN || !AUTH0_AUDIENCE || !EXTENSION_API_KEY) {
  console.error('❌ AUTH0_DOMAIN, AUTH0_AUDIENCE e EXTENSION_API_KEY são obrigatórios no .env.');
  console.error('   DOMAIN e AUDIENCE vêm do painel do Auth0 (Application e API).');
  console.error('   Gere a EXTENSION_API_KEY com: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
  process.exit(1);
}

// Cliente JWKS: busca (e cacheia) as chaves públicas do Auth0 para conferir a
// assinatura dos tokens. issuer/jwksUri derivam do DOMAIN.
const AUTH0_ISSUER = `https://${AUTH0_DOMAIN}/`;
const jwksClient = require('jwks-rsa')({
  jwksUri: `${AUTH0_ISSUER}.well-known/jwks.json`,
  cache: true,
  rateLimit: true,
});
function getSigningKey(header, callback) {
  jwksClient.getSigningKey(header.kid, (err, key) => {
    if (err) return callback(err);
    callback(null, key.getPublicKey());
  });
}
// Valida o access token do Auth0 (RS256, audience e issuer corretos).
function verificarTokenAuth0(token) {
  return new Promise((resolve, reject) => {
    jwt.verify(token, getSigningKey, {
      audience: AUTH0_AUDIENCE,
      issuer: AUTH0_ISSUER,
      algorithms: ['RS256'],
    }, (err, decoded) => (err ? reject(err) : resolve(decoded)));
  });
}

// AUDITORIA #2 (CORS): allowlist de origens. O cors() default respondia
// Access-Control-Allow-Origin: * e, como NÃO há autenticação, qualquer site
// aberto no navegador do usuário podia disparar o bot ou apagar reuniões.
// A extensão NÃO é afetada (usa host_permissions e ignora CORS); o painel é
// servido pelo próprio servidor (mesma origem). Em produção, defina
// ALLOWED_ORIGINS no .env (lista separada por vírgula).
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ||
  // localhost:PORT = painel servido pelo próprio backend (produção)
  // localhost:5173 = servidor de dev do Vite (painel React em desenvolvimento)
  `http://localhost:${PORT},http://127.0.0.1:${PORT},http://localhost:5173,http://127.0.0.1:5173`)
  .split(',').map(s => s.trim()).filter(Boolean);

app.use(cors({
  origin(origin, cb) {
    // Sem header Origin (extensão, curl, chamadas internas do bot, mesma origem)
    // é permitido; origens web fora da allowlist não recebem cabeçalhos CORS.
    if (!origin || ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    return cb(null, false);
  }
}));

// Helmet: security headers (HSTS, X-Content-Type-Options, X-Frame-Options...).
// CSP fica desativada: o painel usa <script>/<style> inline e uma CSP estrita
// quebraria as páginas — os demais headers continuam valendo.
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '1mb' })); // AUDITORIA: limita o corpo da requisição

// Em produção o backend serve o painel React já buildado (frontend/dist).
// Em desenvolvimento você usa o Vite (npm run dev, porta 5173) e nem precisa disto.
app.use(express.static(path.join(__dirname, '../frontend/dist')));

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

/*
========================================
AUTENTICAÇÃO (Auth0 access token + API key)
A rota pública /api/health (acima) fica ANTES do middleware authRequired de
propósito. Tudo registrado depois exige auth (token do Auth0 ou X-API-Key).
========================================
*/

// Comparação em tempo constante (evita timing attack na API key).
function timingSafeEqualStr(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

// Headers das chamadas internas do servidor -> própria API (usadas pelo bot).
function internalHeaders() {
  return { 'Content-Type': 'application/json', 'X-API-Key': EXTENSION_API_KEY };
}

// Converte para ObjectId válido ou null — barra NoSQL injection via objeto
// ({"$gt":""}) e evita 500 quando o id é inválido.
function toObjectId(id) {
  return (typeof id === 'string' && ObjectId.isValid(id)) ? new ObjectId(id) : null;
}

// NÃO HÁ MAIS /api/login nem /api/register: quem cuida de login, cadastro,
// Google, confirmação de email e reset de senha é o Auth0 (tela hospedada).
// O painel obtém o token direto com o Auth0 e o backend apenas o valida abaixo.

// O email do usuário vem num claim com namespace, injetado por uma Action do
// Auth0 (o access token padrão NÃO traz email). Fallback pro claim 'email'
// caso a Action já rode com escopo que o inclua.
const CLAIM_EMAIL = 'https://meetai/email';

// MIDDLEWARE — exige um access token do Auth0 (humano) OU X-API-Key
// (extensão/bot). Aceita também ?token= / ?key= na querystring, porque o
// EventSource (SSE do painel) não permite enviar cabeçalhos customizados.
async function authRequired(req, res, next) {
  const apiKey = req.get('X-API-Key') || req.query.key;
  if (apiKey && timingSafeEqualStr(apiKey, EXTENSION_API_KEY)) {
    req.auth = { type: 'apikey' };
    return next();
  }
  const authHeader = req.get('Authorization') || '';
  const token = authHeader.startsWith('Bearer ')
    ? authHeader.slice(7)
    : req.query.token;
  if (token) {
    try {
      const decoded = await verificarTokenAuth0(token);
      // ownerEmail (isolamento multiusuário) sai daqui — normaliza pra minúsculas.
      const email = (decoded[CLAIM_EMAIL] || decoded.email || '').toLowerCase() || null;
      req.auth = { type: 'jwt', user: { ...decoded, email } };
      return next();
    } catch (_) { /* token inválido/expirado/assinatura → 401 abaixo */ }
  }
  return res.status(401).json({ error: 'Não autenticado' });
}

// Protege TODAS as rotas /api registradas abaixo desta linha.
app.use('/api', authRequired);

/*
========================================
CONFIGURAÇÃO
========================================
*/
// PORT, HOST e MONGO_URI agora são definidos no topo do arquivo,
// antes dos middlewares (cors/static) que dependem deles.

/*
========================================
CONEXÃO COM MONGODB
========================================
*/
const client = new MongoClient(MONGO_URI);
let db;

/*
========================================
CORRECAO #2: ERROS GLOBAIS — processo nunca cai sozinho
========================================
*/
process.on('uncaughtException', (err) => {
  console.error('[FATAL] uncaughtException — servidor mantido vivo:', err.message, err.stack);
});
process.on('unhandledRejection', (reason) => {
  console.error('[FATAL] unhandledRejection:', reason);
});

/*
========================================
CORRECAO #4: RECONEXAO AUTOMATICA + INDICES (CORRECAO BAIXO 1)
========================================
*/
async function connectDatabase() {
  if (db) return db;
  let tentativas = 0;
  while (true) {
    try {
      if (!client.topology || !client.topology.isConnected()) {
        await client.connect();
      }
      db = client.db('meetai');
      // Indices para evitar full collection scan em producao
      await db.collection('meetings').createIndex({ createdAt: -1 }).catch(() => {});
      await db.collection('meetings').createIndex({ finishedAt: 1 }).catch(() => {});
      await db.collection('meetings').createIndex({ meetingCode: 1 }).catch(() => {});
      // Isolamento multiusuário: TODA listagem filtra por ownerEmail (+ deletedAt) e
      // ordena por createdAt. Índice composto cobre filtro + ordenação numa tacada só
      // (sem ele, /api/meetings, /analytics e /lixeira faziam COLLSCAN).
      await db.collection('meetings').createIndex({ ownerEmail: 1, deletedAt: 1, createdAt: -1 }).catch(() => {});
      // (A coleção 'users' saiu: os usuários agora vivem no Auth0, não no Mongo.)
      console.log('✅ MongoDB conectado');
      return db;
    } catch (e) {
      db = null;
      tentativas++;
      const delay = Math.min(1000 * tentativas, 10000);
      console.error(`❌ MongoDB falhou (tentativa ${tentativas}), retry em ${delay}ms:`, e.message);
      await new Promise(r => setTimeout(r, delay));
    }
  }
}

/*
========================================
HELPER: calcula status da reunião
CORREÇÃO #5: status calculado no servidor
— nunca depende só do campo finishedAt
========================================
*/
function calcStatus(meeting) {
  if (meeting.finishedAt) return 'finished';
  // Se foi criada há mais de 8h sem finalizar, considera encerrada (travou)
  const ageHours = (Date.now() - new Date(meeting.createdAt).getTime()) / 3600000;
  if (ageHours > 8) return 'finished';
  return 'live';
}

/*
========================================
MULTIUSUÁRIO (isolamento por dono) — SEGURANÇA
Toda reunião pertence a um usuário (ownerEmail = email do JWT). As leituras,
mutações e o SSE são SEMPRE filtrados por este email, senão um usuário logado
veria/alteraria/apagaria as reuniões dos outros (falha de controle de acesso).
Chamadas internas por API key (bot dormente) não têm dono → null (ficam fora
do escopo de qualquer usuário; não vazam).
========================================
*/
function donoDoReq(req) {
  return req.auth?.type === 'jwt' ? (req.auth.user?.email || null) : null;
}

/*
========================================
CRIAR NOVA REUNIÃO
POST /api/start-meeting
Body: { title, meetingCode }
========================================
*/
app.post('/api/start-meeting', async (req, res) => {
  try {
    const database = await connectDatabase();

    // VALIDAÇÃO / NoSQL injection: meetingCode e title precisam ser strings.
    // Sem isso, um objeto ({"$gt":""}) entraria direto no filtro do Mongo.
    if (req.body.meetingCode != null && typeof req.body.meetingCode !== 'string') {
      return res.status(400).json({ error: 'meetingCode inválido' });
    }
    if (req.body.title != null && typeof req.body.title !== 'string') {
      return res.status(400).json({ error: 'title inválido' });
    }
    const meetingCode = req.body.meetingCode ? req.body.meetingCode.slice(0, 200) : null;
    const title       = (req.body.title || 'Reunião Meet').slice(0, 300);
    const owner       = donoDoReq(req); // dono da reunião (isolamento multiusuário)

    // FIX DUPLICATA: findOneAndUpdate atomico — independente de quantas chamadas
    // chegarem ao mesmo tempo (bot + extensao), so UMA reuniao e criada.
    // ownerEmail entra no filtro: cada usuário tem a SUA reunião por meetingCode
    // (dois usuários na mesma sala não compartilham o mesmo documento).
    if (meetingCode) {
      // Usa updateOne+upsert separado para evitar inconsistencia de versao do driver
      const filter = {
        meetingCode,
        ownerEmail: owner,
        finishedAt: null,
        createdAt: { $gte: new Date(Date.now() - 4 * 3600 * 1000) }
      };
      await database.collection('meetings').updateOne(
        filter,
        {
          $setOnInsert: {
            title,
            meetingCode,
            ownerEmail: owner,
            createdAt: new Date(),
            finishedAt: null,
            duration: null,
            participants: [],
            transcripts: []
          }
        },
        { upsert: true }
      );
      // Busca o documento (existente ou recém-criado)
      const doc = await database.collection('meetings').findOne(filter);
      if (!doc) throw new Error('Reuniao nao encontrada apos upsert');
      return res.json({ success: true, meetingId: doc._id });
    }

    // Sem meetingCode: cria normalmente (fallback)
    const result = await database.collection('meetings').insertOne({
      title,
      meetingCode: null,
      ownerEmail: owner,
      createdAt: new Date(),
      finishedAt: null,
      duration: null,
      participants: [],
      transcripts: []
    });
    res.json({ success: true, meetingId: result.insertedId });

  } catch (error) {
    console.error('Erro ao iniciar reunião:', error);
    res.status(500).json({ error: 'Erro ao iniciar reunião' });
  }
});

/*
========================================
ADICIONAR TRANSCRIÇÃO
POST /api/add-transcript
Body: { meetingId, user, text, timestamp }
========================================
*/
app.post('/api/add-transcript', async (req, res) => {
  try {
    const database = await connectDatabase();
    const { meetingId, user, text, timestamp } = req.body;

    const _id = toObjectId(meetingId);
    if (!_id || typeof text !== 'string' || !text) {
      return res.status(400).json({ error: 'meetingId (válido) e text são obrigatórios' });
    }

    // Só grava se a reunião for do próprio usuário (ownerEmail no filtro).
    const r = await database.collection('meetings').updateOne(
      { _id, ownerEmail: donoDoReq(req) },
      {
        $push: {
          transcripts: {
            user: String(user || 'Participante').slice(0, 200),
            text: text.slice(0, 5000),
            timestamp: timestamp ? new Date(timestamp) : new Date()
          }
        }
      }
    );
    if (!r.matchedCount) return res.status(404).json({ error: 'Reunião não encontrada' });

    res.json({ success: true });

  } catch (error) {
    console.error('Erro ao salvar transcrição:', error);
    res.status(500).json({ error: 'Erro ao salvar transcrição' });
  }
});

/*
========================================
ADICIONAR TRANSCRIÇÕES EM LOTE — NOVO
POST /api/add-transcripts-batch
Body: { meetingId, transcripts: [{ user, text, timestamp }] }
CORREÇÃO PERF: uma única operação $push/$each no MongoDB
em vez de N operações individuais
========================================
*/
app.post('/api/add-transcripts-batch', async (req, res) => {
  try {
    const database = await connectDatabase();
    const { meetingId, transcripts } = req.body;

    const _id = toObjectId(meetingId);
    if (!_id || !Array.isArray(transcripts) || transcripts.length === 0) {
      return res.status(400).json({ error: 'meetingId (válido) e transcripts[] são obrigatórios' });
    }

    // Coage tudo para string (evita objeto/operador vindo no array) e limita tamanho.
    const items = transcripts.slice(0, 1000).map(t => ({
      user: String(t?.user || 'Participante').slice(0, 200),
      text: String(t?.text || '').slice(0, 5000),
      timestamp: t?.timestamp ? new Date(t.timestamp) : new Date()
    })).filter(t => t.text.length > 0);

    if (items.length === 0) return res.json({ success: true, saved: 0 });

    const owner = donoDoReq(req);
    const r = await database.collection('meetings').updateOne(
      { _id, ownerEmail: owner },
      { $push: { transcripts: { $each: items } } }
    );
    if (!r.matchedCount) return res.status(404).json({ error: 'Reunião não encontrada' });

    // Notifica SSE para atualização em tempo real — só pro dono da reunião.
    broadcastSSE('newTranscripts', { meetingId, count: items.length }, owner);

    res.json({ success: true, saved: items.length });

  } catch (error) {
    console.error('Erro ao salvar transcrições em lote:', error);
    res.status(500).json({ error: 'Erro ao salvar transcrições' });
  }
});

/*
========================================
ATUALIZAR PARTICIPANTES
POST /api/update-participants
Body: { meetingId, participants: [] }
========================================
*/
app.post('/api/update-participants', async (req, res) => {
  try {
    const database = await connectDatabase();
    const { meetingId, participants } = req.body;

    const _id = toObjectId(meetingId);
    if (!_id) {
      return res.status(400).json({ error: 'meetingId inválido' });
    }

    // Sanitiza: só strings, no máximo 200 nomes de até 200 caracteres.
    const clean = Array.isArray(participants)
      ? participants.filter(p => typeof p === 'string').slice(0, 200).map(p => p.slice(0, 200))
      : [];

    const r = await database.collection('meetings').updateOne(
      { _id, ownerEmail: donoDoReq(req) },
      { $set: { participants: clean } }
    );
    if (!r.matchedCount) return res.status(404).json({ error: 'Reunião não encontrada' });

    res.json({ success: true });

  } catch (error) {
    console.error('Erro ao atualizar participantes:', error);
    res.status(500).json({ error: 'Erro ao atualizar participantes' });
  }
});

/*
========================================
FINALIZAR REUNIÃO
POST /api/end-meeting
Body: { meetingId }
CORREÇÃO #5: broadcast SSE garantido aqui
========================================
*/
app.post('/api/end-meeting', async (req, res) => {
  try {
    const database = await connectDatabase();
    const { meetingId } = req.body;

    const _id = toObjectId(meetingId);
    if (!_id) {
      return res.status(400).json({ error: 'meetingId inválido' });
    }

    const owner = donoDoReq(req);
    const meeting = await database.collection('meetings').findOne({ _id, ownerEmail: owner });

    if (!meeting) {
      return res.status(404).json({ error: 'Reunião não encontrada' });
    }

    // Idempotente: se já foi encerrada, só retorna o broadcast
    if (meeting.finishedAt) {
      broadcastSSE('meetingEnded', {
        meetingId,
        duration: meeting.duration,
        finishedAt: meeting.finishedAt,
        status: 'finished'
      }, owner);
      return res.json({ success: true, duration: meeting.duration, alreadyFinished: true });
    }

    const finishedAt = new Date();
    const duration = (finishedAt - new Date(meeting.createdAt)) / 1000 / 60;

    await database.collection('meetings').updateOne(
      { _id, ownerEmail: owner },
      { $set: { finishedAt, duration } }
    );

    // CORREÇÃO #5: broadcast SSE imediato — painel para de mostrar "ao vivo"
    broadcastSSE('meetingEnded', {
      meetingId,
      duration,
      finishedAt,
      status: 'finished'
    }, owner);

    res.json({ success: true, duration });

  } catch (error) {
    console.error('Erro ao finalizar reunião:', error);
    res.status(500).json({ error: 'Erro ao finalizar reunião' });
  }
});

/*
========================================
LISTAR REUNIÕES
GET /api/meetings?page=1&limit=20
CORREÇÃO #5: campo `status` incluído em cada reunião
========================================
*/
app.get('/api/meetings', async (req, res) => {
  try {
    const database = await connectDatabase();

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    const owner = donoDoReq(req);
    const filtro = { deletedAt: null, ownerEmail: owner };
    const [meetings, total] = await Promise.all([
      database.collection('meetings')
        .find(filtro, { projection: { transcripts: 0 } })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .toArray(),
      database.collection('meetings').countDocuments(filtro)
    ]);

    // CORREÇÃO #5: adiciona campo status calculado para cada reunião
    const meetingsWithStatus = meetings.map(m => ({
      ...m,
      status: calcStatus(m)
    }));

    res.json({
      meetings: meetingsWithStatus,
      total,
      page,
      totalPages: Math.ceil(total / limit)
    });

  } catch (error) {
    console.error('Erro ao buscar reuniões:', error);
    res.status(500).json({ error: 'Erro ao buscar reuniões' });
  }
});

/*
========================================
BUSCAR REUNIÃO COM TRANSCRIÇÕES
GET /api/meeting/:id
CORREÇÃO #5: campo `status` incluído
========================================
*/
app.get('/api/meeting/:id', async (req, res) => {
  try {
    const database = await connectDatabase();

    const _id = toObjectId(req.params.id);
    if (!_id) return res.status(400).json({ error: 'id inválido' });

    // ownerEmail no filtro: barra ler a reunião de outro usuário pelo id (IDOR).
    const meeting = await database.collection('meetings').findOne({ _id, ownerEmail: donoDoReq(req) });

    if (!meeting) {
      return res.status(404).json({ error: 'Reunião não encontrada' });
    }

    res.json({ ...meeting, status: calcStatus(meeting) });

  } catch (error) {
    console.error('Erro ao buscar reunião:', error);
    res.status(500).json({ error: 'Erro ao buscar reunião' });
  }
});

/*
========================================
ANALYTICS
GET /api/analytics
========================================
*/
app.get('/api/analytics', async (req, res) => {
  try {
    const database = await connectDatabase();

    const meetings = await database.collection('meetings').find({ deletedAt: null, ownerEmail: donoDoReq(req) }).toArray();

    let totalMinutes = 0;
    let totalTranscripts = 0;
    const users = new Set();

    meetings.forEach(m => {
      if (m.duration) totalMinutes += m.duration;

      if (m.participants) {
        m.participants.forEach(p => users.add(p));
      }

      if (m.transcripts) {
        totalTranscripts += m.transcripts.length;
        m.transcripts.forEach(t => {
          if (t.user && t.user !== 'Participante') users.add(t.user);
        });
      }
    });

    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const recentMeetings = meetings.filter(m =>
      new Date(m.createdAt) >= sevenDaysAgo
    );

    const byDay = {};
    recentMeetings.forEach(m => {
      const day = new Date(m.createdAt).toLocaleDateString('pt-BR');
      byDay[day] = (byDay[day] || 0) + 1;
    });

    res.json({
      meetings: meetings.length,
      hours: Math.round(totalMinutes / 60 * 10) / 10,
      minutes: Math.round(totalMinutes),
      users: users.size,
      transcripts: totalTranscripts,
      byDay
    });

  } catch (error) {
    console.error('Erro ao gerar analytics:', error);
    res.status(500).json({ error: 'Erro ao gerar analytics' });
  }
});

/*
========================================
TRANSCREVER UPLOAD (Caminho B — AssemblyAI)
POST /api/transcrever-upload?title=...
Recebe um arquivo de áudio (corpo bruto), transcreve COM diarização
(speaker_labels) e salva como uma reunião já finalizada. Modo batch:
processa e só então responde (combina com "mostrar quando acaba").
========================================
*/
app.post('/api/transcrever-upload',
  express.raw({ type: () => true, limit: '200mb' }),
  async (req, res) => {
    try {
      if (!process.env.ASSEMBLYAI_API_KEY) {
        return res.status(503).json({ error: 'ASSEMBLYAI_API_KEY não configurada no servidor.' });
      }
      const audio = req.body;
      if (!audio || !audio.length) {
        return res.status(400).json({ error: 'Nenhum áudio recebido.' });
      }

      const titulo = (req.query.title || 'Gravação enviada').toString().slice(0, 120);
      const ownerEmail = req.auth?.type === 'jwt' ? (req.auth.user?.email || null) : null;

      // Chama o AssemblyAI (upload + diarização + polling).
      const { texto, falas, duracaoSeg } = await transcreverAudio(audio, { language: 'pt' });

      const database = await connectDatabase();
      const criadaEm = new Date();
      const transcripts = falas.map((f) => ({
        user: f.speaker,
        text: f.text,
        timestamp: new Date(criadaEm.getTime() + (f.start || 0)).toISOString(),
        confianca: f.confianca,
      }));
      const participantes = [...new Set(falas.map((f) => f.speaker))];

      const doc = {
        title: titulo,
        meetingCode: null,
        origem: 'upload',
        ownerEmail, // prepara multiusuário (#1); ainda não filtra por dono
        createdAt: criadaEm,
        finishedAt: new Date(),
        duration: duracaoSeg ? Math.round((duracaoSeg / 60) * 10) / 10 : null,
        participants: participantes,
        transcripts,
      };
      const result = await database.collection('meetings').insertOne(doc);

      // Etapa 5: guarda o arquivo enviado como mídia (dá player pra gravação enviada também).
      const ct = req.get('content-type') || 'application/octet-stream';
      try {
        salvarMidia(result.insertedId.toString(), audio);
        await database.collection('meetings').updateOne({ _id: result.insertedId }, { $set: { temMidia: true, mediaTipo: ct } });
      } catch (e) { console.warn('Falha ao guardar mídia do upload:', e.message); }

      res.json({
        success: true,
        meetingId: result.insertedId,
        transcricao: { texto, falas, duracaoSeg, pessoas: participantes.length },
      });
    } catch (e) {
      console.error('Erro ao transcrever upload:', e);
      res.status(500).json({ error: e.message || 'Erro ao transcrever o áudio' });
    }
  });

/*
========================================
REUNIÃO AO VIVO (Etapa 3 — HÍBRIDO)
POST /api/reuniao/:id/timeline  — salva a linha do tempo de nomes (quem falou quando, por conta)
POST /api/reuniao/:id/audio     — recebe o áudio da reunião, transcreve (AssemblyAI) e
                                  junta com os nomes (núcleo merge-diarizacao) → transcrição final
========================================
*/
app.post('/api/reuniao/:id/timeline', async (req, res) => {
  try {
    const _id = toObjectId(req.params.id);
    if (!_id) return res.status(400).json({ error: 'id inválido' });
    const timeline = Array.isArray(req.body?.timeline) ? req.body.timeline : [];
    const database = await connectDatabase();
    const r = await database.collection('meetings').updateOne({ _id, ownerEmail: donoDoReq(req) }, { $set: { speakerTimeline: timeline } });
    if (!r.matchedCount) return res.status(404).json({ error: 'Reunião não encontrada' });
    res.json({ success: true, eventos: timeline.length });
  } catch (e) {
    console.error('Erro ao salvar timeline:', e);
    res.status(500).json({ error: 'Erro ao salvar a linha do tempo' });
  }
});

app.post('/api/reuniao/:id/media',
  express.raw({ type: () => true, limit: '200mb' }),
  async (req, res) => {
    try {
      if (!process.env.ASSEMBLYAI_API_KEY) {
        return res.status(503).json({ error: 'ASSEMBLYAI_API_KEY não configurada no servidor.' });
      }
      const _id = toObjectId(req.params.id);
      if (!_id) return res.status(400).json({ error: 'id inválido' });
      const audio = req.body;
      if (!audio || !audio.length) return res.status(400).json({ error: 'Nenhum áudio recebido.' });

      const database = await connectDatabase();
      const meeting = await database.collection('meetings').findOne({ _id, ownerEmail: donoDoReq(req) });
      if (!meeting) return res.status(404).json({ error: 'Reunião não encontrada' });

      // Etapa 5: guarda a gravação (vídeo+áudio) ANTES de transcrever — mesmo que o
      // AssemblyAI falhe, o vídeo fica salvo pro player.
      try { salvarMidia(req.params.id, audio); } catch (e) { console.warn('Falha ao guardar gravação:', e.message); }

      // 1) áudio → texto + falas anônimas (AssemblyAI)
      const { falas, duracaoSeg } = await transcreverAudio(audio, { language: 'pt' });
      // 2) junta com a linha do tempo de nomes (núcleo universal — Etapa 3a)
      const { falas: comNomes } = juntarFalasComNomes(falas, meeting.speakerTimeline || []);

      const base = new Date(meeting.createdAt || Date.now());
      const transcripts = comNomes.map((f) => ({
        user: f.user,
        text: f.text,
        timestamp: new Date(base.getTime() + (f.start || 0)).toISOString(),
        confianca: f.confianca,
      }));
      const participantes = [...new Set(comNomes.map((f) => f.user))];

      // REDE DE SEGURANÇA: só sobrescreve a transcrição se o áudio REALMENTE rendeu
      // falas. Se o AssemblyAI voltar vazio (áudio mudo/curto/ruído), mantemos o que
      // a legenda do Meet já salvou — antes isto zerava a reunião por cima.
      const set = {
        duration: duracaoSeg ? Math.round((duracaoSeg / 60) * 10) / 10 : meeting.duration,
        transcricaoPronta: true,
        temMidia: true,
        mediaTipo: req.get('content-type') || 'video/webm',
      };
      if (transcripts.length > 0) {
        set.transcripts = transcripts;
        set.participants = participantes;
      }
      await database.collection('meetings').updateOne({ _id }, { $set: set });

      res.json({ success: true, falas: comNomes.length, pessoas: participantes.length, manteveLegenda: transcripts.length === 0 });
    } catch (e) {
      console.error('Erro ao processar áudio da reunião:', e);
      res.status(500).json({ error: e.message || 'Erro ao processar o áudio' });
    }
  });

/*
========================================
SERVIR A GRAVAÇÃO (Etapa 5)
GET /api/reuniao/:id/media  — devolve o arquivo (aceita ?token= p/ a tag <video>)
Suporta Range (seek do vídeo) via res.sendFile.
========================================
*/
app.get('/api/reuniao/:id/media', async (req, res) => {
  try {
    const _id = toObjectId(req.params.id);
    if (!_id) return res.status(400).json({ error: 'id inválido' });
    const database = await connectDatabase();
    // ownerEmail no filtro ANTES de servir o arquivo: barra baixar a gravação
    // (áudio/vídeo) de outro usuário pelo id (IDOR de arquivo).
    const m = await database.collection('meetings').findOne({ _id, ownerEmail: donoDoReq(req) }, { projection: { mediaTipo: 1 } });
    if (!m) return res.status(404).json({ error: 'Sem gravação' });
    const file = path.join(RECORDINGS_DIR, req.params.id);
    if (!fs.existsSync(file)) return res.status(404).json({ error: 'Sem gravação' });
    res.setHeader('Content-Type', m.mediaTipo || 'video/webm');
    res.sendFile(file);
  } catch (e) {
    console.error('Erro ao servir gravação:', e);
    res.status(500).json({ error: 'Erro ao servir a gravação' });
  }
});

/*
========================================
DELETAR REUNIÃO
DELETE /api/meeting/:id
========================================
*/
app.delete('/api/meeting/:id', async (req, res) => {
  try {
    const database = await connectDatabase();

    const _id = toObjectId(req.params.id);
    if (!_id) return res.status(400).json({ error: 'id inválido' });

    const r = await database.collection('meetings').deleteOne({ _id, ownerEmail: donoDoReq(req) });
    if (!r.deletedCount) return res.status(404).json({ error: 'Reunião não encontrada' });

    res.json({ success: true });

  } catch (error) {
    console.error('Erro ao deletar reunião:', error);
    res.status(500).json({ error: 'Erro ao deletar reunião' });
  }
});

/*
========================================
LIXEIRA (soft-delete) — Etapa 4
POST /api/meeting/:id/trash    — MOVE pra lixeira (NÃO apaga do banco)
POST /api/meeting/:id/restore  — restaura da lixeira
GET  /api/lixeira              — lista o que está na lixeira
(o DELETE acima é a exclusão PERMANENTE, feita só a partir da lixeira)
========================================
*/
app.post('/api/meeting/:id/trash', async (req, res) => {
  try {
    const _id = toObjectId(req.params.id);
    if (!_id) return res.status(400).json({ error: 'id inválido' });
    const database = await connectDatabase();
    const r = await database.collection('meetings').updateOne({ _id, ownerEmail: donoDoReq(req) }, { $set: { deletedAt: new Date() } });
    if (!r.matchedCount) return res.status(404).json({ error: 'Reunião não encontrada' });
    res.json({ success: true });
  } catch (e) {
    console.error('Erro ao mover pra lixeira:', e);
    res.status(500).json({ error: 'Erro ao mover pra lixeira' });
  }
});

app.post('/api/meeting/:id/restore', async (req, res) => {
  try {
    const _id = toObjectId(req.params.id);
    if (!_id) return res.status(400).json({ error: 'id inválido' });
    const database = await connectDatabase();
    const r = await database.collection('meetings').updateOne({ _id, ownerEmail: donoDoReq(req) }, { $unset: { deletedAt: '' } });
    if (!r.matchedCount) return res.status(404).json({ error: 'Reunião não encontrada' });
    res.json({ success: true });
  } catch (e) {
    console.error('Erro ao restaurar:', e);
    res.status(500).json({ error: 'Erro ao restaurar' });
  }
});

app.get('/api/lixeira', async (req, res) => {
  try {
    const database = await connectDatabase();
    const meetings = await database.collection('meetings')
      .find({ deletedAt: { $ne: null }, ownerEmail: donoDoReq(req) }, { projection: { transcripts: 0, speakerTimeline: 0 } })
      .sort({ deletedAt: -1 })
      .toArray();
    res.json({ meetings: meetings.map((m) => ({ ...m, status: calcStatus(m) })) });
  } catch (e) {
    console.error('Erro ao listar lixeira:', e);
    res.status(500).json({ error: 'Erro ao listar a lixeira' });
  }
});

/*
========================================
CORREÇÃO #5: FORÇAR FIM DE REUNIÕES TRAVADAS
POST /api/fix-stuck-meetings
Finaliza reuniões sem finishedAt há mais de 8h
Útil ao reiniciar o servidor
========================================
*/
app.post('/api/fix-stuck-meetings', async (req, res) => {
  try {
    const database = await connectDatabase();
    const eightHoursAgo = new Date(Date.now() - 8 * 3600 * 1000);
    const owner = donoDoReq(req);

    // Só finaliza as reuniões travadas DO PRÓPRIO usuário (não as de todos).
    const stuck = await database.collection('meetings').find({
      finishedAt: null,
      createdAt: { $lt: eightHoursAgo },
      ownerEmail: owner
    }).toArray();

    for (const m of stuck) {
      const finishedAt = new Date();
      const duration = (finishedAt - new Date(m.createdAt)) / 1000 / 60;
      await database.collection('meetings').updateOne(
        { _id: m._id },
        { $set: { finishedAt, duration } }
      );
      broadcastSSE('meetingEnded', {
        meetingId: m._id.toString(),
        duration,
        finishedAt,
        status: 'finished'
      }, owner);
    }

    res.json({ fixed: stuck.length });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/*
========================================
BOT — GERENCIADOR DE SESSÕES
Suporta múltiplos bots simultâneos
========================================
*/
const activeBots = new Map();

app.get('/api/bot/status', (req, res) => {
  const bots = [];
  for (const [id, bot] of activeBots.entries()) {
    bots.push({ meetingId: id, url: bot.url, startedAt: bot.startedAt });
  }
  res.json({ active: bots.length, bots });
});

app.post('/api/bot/join', async (req, res) => {
  const { url, meetingId } = req.body;
  if (!url) return res.status(400).json({ error: 'URL do Meet é obrigatória' });

  // Previne bot duplicado por URL (normaliza removendo trailing slash)
  const normalizedUrl = url.replace(/\/+$/, '');
  for (const [, bot] of activeBots.entries()) {
    if (bot.url.replace(/\/+$/, '') === normalizedUrl) {
      console.log('Bot ja esta nessa reuniao, ignorando:', url);
      return res.json({ status: 'Bot já está nessa reunião', url });
    }
  }

  // Lock por meetingCode para evitar race condition
  const code = url.match(/meet\.google\.com\/([a-z0-9\-]+)/)?.[1];
  if (code && activeBots.has('pending:' + code)) {
    return res.json({ status: 'Bot já está entrando nessa reunião', url });
  }
  if (code) activeBots.set('pending:' + code, true);

  res.json({ status: 'Bot iniciando...', url });
  botJoin(url).then(() => {
    if (code) activeBots.delete('pending:' + code);
  }).catch(err => {
    if (code) activeBots.delete('pending:' + code);
    console.error('Erro ao iniciar bot:', err);
  });
});

app.post('/api/bot/leave', async (req, res) => {
  const { meetingId } = req.body;
  if (!meetingId) return res.status(400).json({ error: 'meetingId obrigatório' });

  const bot = activeBots.get(meetingId);
  if (!bot) return res.status(404).json({ error: 'Bot não encontrado' });

  await botLeave(meetingId);
  res.json({ success: true });
});

/*
========================================
BOT — ENTRAR NA REUNIÃO
========================================
*/
async function autoLoginBot(storageStatePath) {
  const email = process.env.BOT_EMAIL;
  const senha = process.env.BOT_PASSWORD;

  if (!email || !senha) {
    console.error('Bot: BOT_EMAIL e BOT_PASSWORD nao configurados no .env');
    return false;
  }

  console.log('Bot: fazendo login automatico com', email);
  const { chromium } = require('playwright');
  const b = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--lang=pt-BR', '--disable-blink-features=AutomationControlled'],
  }).catch(e => { console.error('Bot: erro ao abrir Chromium para login:', e.message); return null; });
  if (!b) return false;

  const ctx = await b.newContext({ locale: 'pt-BR' });
  const page = await ctx.newPage();

  try {
    // Passo 1: abre login Google
    await page.goto('https://accounts.google.com/signin/v2/identifier', {
      waitUntil: 'domcontentloaded', timeout: 20000
    });
    await page.waitForTimeout(1500);

    // Passo 2: preenche email
    await page.fill('input[type="email"]', email);
    await page.click('#identifierNext, [jsname="LgbsSe"]');
    await page.waitForTimeout(2000);

    // Passo 3: preenche senha
    await page.fill('input[type="password"], input[name="password"], input[name="Passwd"]', senha);
    await page.click('#passwordNext, [jsname="LgbsSe"]');
    await page.waitForTimeout(4000);

    // Verifica se logou
    const logado = page.url().includes('myaccount.google.com') ||
                   page.url().includes('google.com') && !page.url().includes('accounts.google.com/signin');

    if (!logado) {
      // Tenta acessar o Meet para confirmar
      await page.goto('https://meet.google.com', { waitUntil: 'domcontentloaded', timeout: 15000 });
      await page.waitForTimeout(2000);
    }

    const confirmado = page.url().includes('meet.google.com') ||
      await page.evaluate(() => {
        const t = document.body?.innerText || '';
        return !t.includes('Fazer login') && !t.includes('Sign in');
      }).catch(() => false);

    if (!confirmado) {
      console.error('Bot: login automatico falhou. Verifique BOT_EMAIL e BOT_PASSWORD no .env');
      await b.close();
      return false;
    }

    // Salva sessão
    await ctx.storageState({ path: storageStatePath });
    console.log('Bot: login automatico OK — sessao salva em', storageStatePath);
    await b.close();
    return true;

  } catch(e) {
    console.error('Bot: erro durante login automatico:', e.message);
    await b.close().catch(() => {});
    return false;
  }
}


async function botJoin(meetUrl) {
  const { chromium } = require('playwright');
  const os   = require('os');
  const path = require('path');
  const fs   = require('fs');

  console.log('Bot iniciando para:', meetUrl);

  // ─── Localiza o Chrome instalado no computador ───────────────────────────
  // ─── Usa sempre bot-auth.json (conta dedicada do bot) ─────────────────────
  // O bot precisa de conta separada — não pode usar a conta do usuário
  const storageStatePath = path.join(__dirname, 'bot-auth.json');
  const fs_check = require('fs');

  if (!fs_check.existsSync(storageStatePath)) {
    console.log('Bot: bot-auth.json nao encontrado — tentando login automatico...');
    const loginOk = await autoLoginBot(storageStatePath);
    if (!loginOk) {
      console.error('Bot: nao foi possivel fazer login automatico.');
      console.error('Configure BOT_EMAIL e BOT_PASSWORD no .env ou rode: node login-bot.js');
      return;
    }
  }

  let context = null;
  let browser = null;

  try {
    console.log('Bot: usando bot-auth.json (conta dedicada)');
    const b = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--mute-audio',
        '--lang=pt-BR',
        '--use-fake-ui-for-media-stream',
        '--use-fake-device-for-media-stream',
        '--disable-blink-features=AutomationControlled',
        '--disable-features=TranslateUI',
      ],
    });
    context = await b.newContext({
      storageState: storageStatePath,
      locale: 'pt-BR',
      timezoneId: 'America/Sao_Paulo',
      permissions: ['camera', 'microphone'],
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    });
    browser = b;
  } catch (e) {
    console.error('Bot: erro ao iniciar Chromium:', e.message);
    return;
  }

  // cleanup ao fechar (sem tmpDir — bot usa Chromium headless direto)

  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    Object.defineProperty(navigator, 'languages', { get: () => ['pt-BR','pt','en'] });
    window.chrome = { runtime: {} };
    try {
      localStorage.setItem('yt-player-captionstrackSettings', JSON.stringify({ translationLanguage: null, trackKind: 'asr', displayedLanguage: 'pt-BR' }));
      localStorage.setItem('subtitles-preferred-languages', 'pt-BR');
    } catch(_){}
  });
  await context.grantPermissions(['camera','microphone'], { origin: 'https://meet.google.com' }).catch(() => {});

  const page = await context.newPage();
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8' });

  try {
    const meetUrlPTBR = meetUrl.includes('?') ? meetUrl + '&hl=pt-BR' : meetUrl + '?hl=pt-BR';
    await page.goto(meetUrlPTBR, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);
    console.log('Bot: URL —', page.url());

    // Sessão expirada?
    const semLogin = !page.url().includes('meet.google.com') ||
      await page.evaluate(() => {
        const t = document.body?.innerText || '';
        return t.includes('Fazer login') || t.includes('Sign in') || t.includes('recursos premium');
      }).catch(() => false);
    if (semLogin) {
      console.log('Bot: sessao expirada — tentando relogin automatico...');
      await context.close().catch(() => {});
      const loginOk = await autoLoginBot(storageStatePath);
      if (!loginOk) {
        console.error('Bot: relogin falhou. Verifique BOT_EMAIL e BOT_PASSWORD no .env');
        return;
      }
      // Tenta entrar novamente com a nova sessão
      console.log('Bot: relogin OK — tentando entrar na reuniao novamente...');
      botJoin(meetUrl).catch(e => console.error('Bot: falha ao reentrar:', e.message));
      return;
    }

    // Reunião bloqueada?
    const bloqueado = await page.evaluate(() => {
      const t = (document.body?.innerText || '').toLowerCase();
      return t.includes('possível participar') || t.includes('cannot join') || t.includes('não é possível');
    }).catch(() => false);
    if (bloqueado) {
      // Nao fecha — fica aguardando ser admitido ou acesso ser liberado
      console.log('Bot: reuniao restrita — aguardando acesso ser liberado ou admissao manual...');
      // Tenta clicar "Pedir para participar"
      const askSelectors = [
        'button:has-text("Pedir para participar")',
        'button:has-text("Ask to join")',
        'button:has-text("Solicitar participação")',
        '[jsname="Qx7uuf"]',
      ];
      let pediu = false;
      for (const sel of askSelectors) {
        try {
          const btn = page.locator(sel).first();
          if (await btn.isVisible({ timeout: 2000 })) {
            await btn.click();
            pediu = true;
            console.log('Bot: pediu para participar — aguardando admissao...');
            break;
          }
        } catch(_) {}
      }
      if (!pediu) {
        // Recarrega a pagina e tenta novamente em 10s (acesso pode ter sido liberado)
        await page.waitForTimeout(10000);
        await page.reload({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
        await page.waitForTimeout(3000);
        const aindaBloqueado = await page.evaluate(() => {
          const t = (document.body?.innerText||'').toLowerCase();
          return t.includes('possível participar') || t.includes('cannot join');
        }).catch(() => true);
        if (aindaBloqueado) {
          console.error('Bot: ainda bloqueado apos recarregar. Verifique as configuracoes da reuniao.');
          await context.close().catch(() => {}); return;
        }
        // Acesso foi liberado — continua o fluxo normalmente
      }
    }

    // Desativa mic/cam
    await page.evaluate(() => {
      for (const sel of ['[aria-label*="Desativar microfone"]','[aria-label*="Turn off microphone"]','[jsname="psRWwb"]']) {
        const el = document.querySelector(sel); if (el && el.getAttribute('aria-pressed') !== 'false') el.click();
      }
      for (const sel of ['[aria-label*="Desativar câmera"]','[aria-label*="Turn off camera"]','[jsname="BOHaEe"]']) {
        const el = document.querySelector(sel); if (el && el.getAttribute('aria-pressed') !== 'false') el.click();
      }
    }).catch(() => null);
    await page.waitForTimeout(1000);

    // Entra na reunião
    const joinSelectors = [
      'button:has-text("Participar agora")', 'button:has-text("Join now")',
      'button:has-text("Pedir para participar")', 'button:has-text("Ask to join")',
      'button:has-text("Entrar")', '[jsname="Q67bS"]', '[jsname="Qx7uuf"]', '[jsname="rymPhb"]',
    ];
    let joined = false;
    for (let attempt = 0; attempt < 4 && !joined; attempt++) {
      for (const sel of joinSelectors) {
        try {
          const btn = page.locator(sel).first();
          if (await btn.isVisible({ timeout: 2000 })) { await btn.click(); joined = true; console.log('Bot entrou via:', sel); break; }
        } catch(_) {}
      }
      if (!joined) {
        const txt = await page.evaluate(() => {
          for (const btn of document.querySelectorAll('button')) {
            const t = (btn.innerText||'').toLowerCase().trim();
            if (['participar agora','join now','pedir para participar','ask to join','entrar','enter','join'].includes(t)) { btn.click(); return t; }
          }
          return null;
        }).catch(() => null);
        if (txt) { joined = true; console.log('Bot entrou via evaluate:', txt); }
        else if (attempt < 3) { console.log('Tentativa '+(attempt+1)+'/4 aguardando...'); await page.waitForTimeout(3000); }
      }
    }

    if (!joined) {
      await page.screenshot({ path: 'debug_bot_entrada.png' });
      console.error('Bot nao achou botao de entrada. Screenshot: debug_bot_entrada.png');
      await context.close().catch(() => {}); return;
    }

    // Aguarda entrar
    await page.waitForFunction(() =>
      !!(document.querySelector('[data-participant-id]') || document.querySelector('[jsname="psRWwb"]') || document.querySelector('.NzPR9b')),
      { timeout: 120000 }
    ).catch(async () => {
      console.error('Bot: timeout entrando na sala.'); await context.close().catch(() => {});
      throw new Error('Bot nao entrou na sala');
    });
    console.log('Bot dentro da reuniao!');

    const meetingResp = await fetch(`http://localhost:${PORT}/api/start-meeting`, {
      method: 'POST', headers: internalHeaders(),
      body: JSON.stringify({ title: `Bot — ${new Date().toLocaleString('pt-BR')}`, meetingCode: meetUrl.match(/meet\.google\.com\/([a-z0-9\-]+)/)?.[1] || null })
    });
    const meetingData = await meetingResp.json();
    const meetingId = meetingData.meetingId;

    activeBots.set(meetingId, { page, context, browser, url: meetUrl, startedAt: new Date() });

    await ativarLegendas(page);

    await page.addStyleTag({
      content: `
        .iOzk7, [jsname="dsyhDe"], .vNKgIf, .CNusmb,
        .a4cQT, .Mz6pEf, .TBMuR, .pV6u9e {
          clip-path: inset(0 0 100% 0) !important;
          pointer-events: none !important;
        }
      `
    });

    await escutarESalvar(page, meetingId);

    let botLeaving = false;
    let navDebounce = null;
    page.on('framenavigated', async (frame) => {
      if (botLeaving || frame !== page.mainFrame()) return;
      const url = frame.url();
      if (url.includes('meet.google.com/') && !url.includes('meetingended')) return;
      clearTimeout(navDebounce);
      navDebounce = setTimeout(async () => {
        if (botLeaving) return;
        const cur = page.url();
        if (cur.includes('meet.google.com/') && !cur.includes('meetingended')) return;
        botLeaving = true;
        await botLeave(meetingId);
      }, 3000);
    });

  } catch (err) {
    console.error('Erro no bot:', err.message);
    await page.screenshot({ path: 'debug_bot_erro.png' }).catch(() => {});
    await context.close().catch(() => {});
  }
}



/*
========================================
BOT — ATIVAR LEGENDAS
========================================
*/
async function ativarLegendas(page) {
  console.log('📺 Tentando ativar legendas...');
  await page.waitForTimeout(4000);

  for (let i = 0; i < 8; i++) {
    const ativou = await page.evaluate(() => {
      const sels = [
        '[aria-label*="Turn on captions"]',
        '[aria-label*="Ativar legendas"]',
        '[aria-label*="Ativar legenda"]',
        '[aria-label*="Ativar transcrição"]',
        '[aria-label*="captions"]',
        '[jsname="r8qRAd"]',
        '[data-tooltip*="captions"]',
        '[data-tooltip*="legenda"]',
      ];

      for (const sel of sels) {
        const btns = document.querySelectorAll(sel);
        for (const btn of btns) {
          if (!btn) continue;
          if (btn.getAttribute('aria-pressed') === 'true') return 'already';
          btn.click();
          return 'clicked:' + sel;
        }
      }

      const allBtns = document.querySelectorAll('button');
      for (const btn of allBtns) {
        const label = (btn.getAttribute('aria-label') || btn.innerText || '').toLowerCase();
        if (label.includes('legenda') || label.includes('caption')) {
          if (btn.getAttribute('aria-pressed') !== 'true') {
            btn.click();
            return 'clicked-fallback';
          }
          return 'already';
        }
      }
      return false;
    });

    if (ativou) {
      console.log(`📺 Legendas: ${ativou}`);
      await page.waitForTimeout(1500);
      const captionsActive = await page.evaluate(() =>
        !!(document.querySelector('.iOzk7') || document.querySelector('[jsname="dsyhDe"]'))
      );

      if (captionsActive || ativou === 'already') {
        console.log('✅ Legendas confirmadas ativas no DOM');
        // Força PT-BR no localStorage imediatamente após ativar
        await page.evaluate(() => {
          try {
            localStorage.setItem('yt-player-captionstrackSettings',
              JSON.stringify({ translationLanguage: null, trackKind: 'asr', displayedLanguage: 'pt-BR' }));
            localStorage.setItem('subtitles-preferred-languages', 'pt-BR');
          } catch(_) {}
        }).catch(() => {});
        forcarPTBRBot(page).catch(() => {});
        return;
      }
    }

    console.log(`⏳ Tentativa ${i + 1}/8 — aguardando botão CC...`);
    await page.waitForTimeout(3000);
  }

  console.log('🔍 Tentando via menu Mais opções...');
  try {
    const moreBtn = page.locator('[aria-label*="Mais opções"], [aria-label*="More options"]').first();
    if (await moreBtn.isVisible({ timeout: 3000 })) {
      await moreBtn.click();
      await page.waitForTimeout(1000);
      const ccOption = page.locator('li:has-text("legenda"), li:has-text("caption"), [role="menuitem"]:has-text("legenda")').first();
      if (await ccOption.isVisible({ timeout: 2000 })) {
        await ccOption.click();
        console.log('✅ Legendas ativadas via menu Mais opções');
        return;
      }
    }
  } catch (_) {}

  console.warn('⚠️ Legendas não ativadas — o bot continuará monitorando o DOM mesmo assim');
}

/*
========================================
BOT — CAPTURAR E SALVAR TRANSCRIÇÕES
========================================
*/
async function escutarESalvar(page, meetingId) {
  console.log(`📡 Monitorando transcrições — meetingId: ${meetingId}`);

  // CORRECAO MEDIO 1: bot usa batch igual ao background.js
  const botQueue = [];
  let botFlushTimer = null;
  async function botFlush() {
    botFlushTimer = null;
    if (!meetingId || botQueue.length === 0) return;
    const batch = botQueue.splice(0, botQueue.length);
    try {
      await fetch(`http://localhost:${PORT}/api/add-transcripts-batch`, {
        method: 'POST',
        headers: internalHeaders(),
        body: JSON.stringify({ meetingId, transcripts: batch })
      });
    } catch (e) { console.error('Erro ao salvar batch do bot:', e.message); }
  }

  await page.exposeFunction('__meetaiSave', async (speaker, text) => {
    console.log(`[Bot] ${speaker}: ${text}`);
    botQueue.push({ user: speaker, text, timestamp: new Date().toISOString() });
    if (!botFlushTimer) botFlushTimer = setTimeout(botFlush, 2000);
  });

  await page.exposeFunction('__meetaiParticipants', async (list) => {
    try {
      await fetch(`http://localhost:${PORT}/api/update-participants`, {
        method: 'POST',
        headers: internalHeaders(),
        body: JSON.stringify({ meetingId, participants: list })
      });
    } catch (_) {}
  });

  await page.evaluate(() => {
    const speakerMemory = new Map();
    const pendingTimers = new Map();

    // Nomes de icones do Material Icons que aparecem no DOM do Meet
    const ICON_NAMES = new Set([
      'mic','microfone','camera','câmera','videocam','videocam_off','chat','call_end',
      'participantes','ativar','desativar','legenda','caption','transcript','gravar',
      'gravação','settings','configurações','padrão','fonte','tamanho','circle',
      'format_size','beta','language','português','keyboard_arrow_up','keyboard_arrow_down',
      'more_vert','more_horiz','close','info','lock_person','apps','computer',
      'mood','back_hand','screen_share','stop_screen_share','closed_caption','open_caption',
      'present_to_all','comment','people','group','person','star','thumb_up',
      'emoji_emotions','sentiment_satisfied','wave','waving_hand',
      // Idiomas e configurações de legenda
      'inglês','english','português (brasil)','spanish','french','german',
      'italiano','japanese','korean','chinese','arabic','russian','hindi',
    ]);

    const UI_PREFIXES = [
      'configurações de', 'settings for', 'ativar câmera', 'desativar câmera',
      'ativar microfone', 'desativar microfone', 'compartilhar tela', 'sair da chamada',
      'levantar a mão', 'enviar uma reação', 'mais opções', 'detalhes da reunião',
      'chat com', 'ferramentas da reunião', 'controles do', 'press ctrl',
      // Painel de configurações de legenda
      'tamanho da fonte', 'cor da fonte', 'abrir configurações de legenda',
      'open caption settings', 'cor do plano', 'font size', 'font color',
      // Notificações de participantes
      'alguém quer participar', 'someone wants to join',
      'está participando', 'is joining', 'entrou na chamada', 'joined the call',
      'saiu da chamada', 'left the call', 'use o botão', 'use the button',
      'o painel', 'the panel',
    ];

    function isUI(text) {
      if (!text || text.length < 3) return true;
      const t = text.toLowerCase().trim();
      // Nome de ícone exato
      if (ICON_NAMES.has(t)) return true;
      // Prefixos de UI conhecidos
      if (UI_PREFIXES.some(p => t.startsWith(p))) return true;
      // Entre parênteses = atalho de teclado
      if (/^\([a-z0-9\u00C0-\u00FF\s+]+\)$/i.test(t)) return true;
      // Underscore sem espaço = ícone Material
      if (/_/.test(t) && !t.includes(' ')) return true;
      // URL do Meet ou e-mail
      if (t.includes('meet.google.com/') || t.includes('content_copy')) return true;
      if (/@[a-z0-9.-]+\.[a-z]{2,}/i.test(t)) return true;
      // Bloco multilinha do painel de configurações de legenda
      // ex: "language\nInglês\nformat_size\nTamanho da fonte..."
      if (t.includes('\n') || t.includes('format_size') || t.includes('tamanho da fonte')) return true;
      if (t.includes('abrir configurações de legenda') || t.includes('open caption settings')) return true;
      if (t.includes('cor da fonte') || t.includes('font color')) return true;
      // Notificações de participante
      if (/\bestá participando\b|\bis (now )?participating\b/.test(t)) return true;
      if (t.startsWith('meetai')) return true;
      // Muito curto ou só números
      if (!t.includes(' ') && t.length < 6) return true;
      if (t.replace(/[^a-zA-ZÀ-ÿ]/g, '').length < 3) return true;
      return false;
    }

    function getSpeakerAndText(container) {
      const speakerSelectors = ['.zs7s8d', '.NWpY1d', '[jsname="bVMoob"]', '.nMcdL > span:first-child'];
      const textSelectors    = ['.ygicle', '.VbkSUe', '.DtJ7e', '.nMcdL span:last-child', '.nMcdL'];

      let speaker = null;
      let text    = null;

      for (const sel of speakerSelectors) {
        const el = container.querySelector(sel);
        if (el) {
          const t = el.innerText?.trim();
          if (t && t.length > 0 && t.length < 60 && !isUI(t)) { speaker = t; break; }
        }
      }

      for (const sel of textSelectors) {
        const el = container.querySelector(sel);
        if (el) {
          const t = el.innerText?.trim();
          if (t && t.length > 3) { text = t; break; }
        }
      }

      if (!speaker || !text) {
        const block = container.querySelector('.nMcdL');
        if (block) {
          for (const node of block.childNodes) {
            const nodeText = (node.nodeType === Node.TEXT_NODE
              ? node.textContent
              : node.innerText
            )?.trim();
            if (nodeText && nodeText.length > 0 && nodeText.length < 60 && !isUI(nodeText)) {
              if (!speaker) { speaker = nodeText; continue; }
            }
          }
          if (!text) {
            const allText = block.innerText?.trim();
            if (speaker && allText?.startsWith(speaker)) {
              text = allText.slice(speaker.length).replace(/^\s*[:\-]\s*/, '').trim();
            } else {
              text = allText;
            }
          }
        }
      }

      if (!text || text.length < 3) {
        const full = container.innerText?.trim();
        if (full && full.length > 3) {
          const lines = full.split('\n').map(l => l.trim()).filter(l => l.length > 0);
          if (lines.length >= 2 && lines[0].length < 60 && !isUI(lines[0])) {
            speaker = speaker || lines[0];
            text    = lines.slice(1).join(' ').trim();
          } else {
            text = full;
          }
        }
      }

      if (!text || text.length < 3) return null;
      if (!speaker) speaker = 'Participante';

      if (speaker !== 'Participante') {
        const esc = speaker.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
        text = text.replace(new RegExp(`^${esc}\\s*[:\\-\\s]*`, 'gi'), '').trim();
      }

      return { speaker, text };
    }

    function processCaption(container) {
      // Descarta nós dentro de menus/painéis de configuração. Sem isso, o texto
      // do painel de legenda ("Inglês", "Tamanho da fonte", format_size...) entra
      // como se fosse fala. Guarda estrutural (por role), mais robusto que filtrar
      // texto na unha em isUI().
      if (container.closest && container.closest(
        '[role="menu"],[role="listbox"],[role="dialog"],[role="menuitem"],[role="option"],' +
        '[aria-label*="configurações de legenda"],[aria-label*="caption settings"]'
      )) return;
      const result = getSpeakerAndText(container);
      if (!result) return;
      const { speaker, text } = result;

      if (pendingTimers.has(speaker)) clearTimeout(pendingTimers.get(speaker));

      const timer = setTimeout(() => {
        pendingTimers.delete(speaker);
        if (!text || text.length < 3) return;

        const prev = speakerMemory.get(speaker) || '';

        // Atualiza memória com texto completo
        speakerMemory.set(speaker, text);
        clearTimeout(speakerMemory._t?.[speaker]);
        if (!speakerMemory._t) speakerMemory._t = {};
        speakerMemory._t[speaker] = setTimeout(() => speakerMemory.delete(speaker), 20000);

        if (!prev) {
          window.__meetaiSave(speaker, text);
          return;
        }

        const norm  = t => t.toLowerCase().replace(/[^\wÀ-ÿ\s]/gi, ' ').replace(/\s+/g, ' ').trim();
        const prevN = norm(prev);
        const curN  = norm(text);

        if (curN === prevN) return;

        const pW = prevN.split(' ');
        const cW = curN.split(' ');
        let match = 0;
        for (let i = 0; i < Math.min(pW.length, cW.length); i++) {
          if (pW[i] === cW[i]) match++;
          else break;
        }

        let out;
        if (match > 0 && match >= Math.ceil(pW.length * 0.6)) {
          out = cW.slice(match).join(' ').trim();
        } else {
          out = text;
        }

        if (out && out.length > 2) window.__meetaiSave(speaker, out);
      }, 600);

      pendingTimers.set(speaker, timer);
    }

    const CAPTION_SELECTORS = '.iOzk7,[jsname="dsyhDe"],.vNKgIf,.CNusmb,.Mz6pEf,.a4cQT';

    const captionObserver = new MutationObserver(() => {
      document.querySelectorAll(CAPTION_SELECTORS).forEach(processCaption);
    });
    captionObserver.observe(document.body, { childList: true, subtree: true, characterData: true });

    // Sem polling paralelo: o MutationObserver acima já dispara a cada mudança de
    // characterData da legenda. Rodar também um setInterval(500ms) sobre os mesmos
    // nós só aumentava a chance de re-emissão. O debounce por speaker (600ms) cuida
    // das rajadas de mutação.

    setInterval(() => {
      const seen = new Set();
      document.querySelectorAll('[data-participant-id]').forEach(el => {
        const name = el.innerText?.split('\n')[0].trim();
        if (name && name.length > 1 && name.length < 60) seen.add(name);
      });
      if (seen.size > 0) window.__meetaiParticipants([...seen]);
    }, 10000);

    console.log('[MeetAI Bot] 👀 Observer v2 de transcrição ativo');
  });
}

/*
========================================
BOT — FORÇAR IDIOMA PT-BR NAS LEGENDAS
========================================
*/
async function forcarPTBRBot(page) {
  // Força PT-BR SOMENTE via localStorage — NÃO abre o menu de idioma.
  //
  // POR QUÊ (bug do "retorno de configurações"): a versão antiga também clicava
  // no botão de idioma das legendas. Esse clique ABRE o painel de configurações
  // de legenda ("Inglês", "Português", "Tamanho da fonte", format_size...), e o
  // observer de captura (escutarESalvar) lia esse painel como se fosse fala.
  // Como forcarPTBRBot é chamada sem await por ativarLegendas, o menu abria em
  // paralelo com o observer. localStorage resolve o idioma sem tocar no DOM.
  try {
    await page.evaluate(() => {
      try {
        localStorage.setItem('yt-player-captionstrackSettings',
          JSON.stringify({ translationLanguage: null, trackKind: 'asr', displayedLanguage: 'pt-BR' }));
        localStorage.setItem('subtitles-preferred-languages', 'pt-BR');
        localStorage.setItem('CAPTION_LANGUAGE', 'pt-BR');
      } catch(_) {}
    });
    console.log('PT-BR bot: idioma definido via localStorage (sem abrir menu)');
  } catch(e) {
    console.warn('PT-BR bot erro:', e.message);
  }
}

/*
========================================
BOT — SAIR DA REUNIÃO
CORREÇÃO #5: broadcast SSE garantido aqui também
========================================
*/
async function botLeave(meetingId) {
  const bot = activeBots.get(meetingId);
  if (!bot) return;

  try {
    await fetch(`http://localhost:${PORT}/api/end-meeting`, {
      method: 'POST',
      headers: internalHeaders(),
      body: JSON.stringify({ meetingId })
    });

    try {
      if (bot.context && typeof bot.context.close === 'function') {
        await bot.context.close().catch(() => {});
      } else if (bot.browser && typeof bot.browser.close === 'function') {
        await bot.browser.close().catch(() => {});
      }
    } catch(_) {}
    activeBots.delete(meetingId);
    console.log(`🔴 Bot encerrado — meetingId: ${meetingId}`);
  } catch (e) {
    console.error('Erro ao encerrar bot:', e.message);
    activeBots.delete(meetingId);
  }
}

/*
========================================
SSE — NOTIFICAÇÕES EM TEMPO REAL
CORREÇÃO #5: heartbeat reduzido para 15s
(era 25s — conexões morriam antes do ping)
========================================
*/
// Cada cliente guarda { res, email } — o email (do JWT) amarra a conexão ao dono,
// pra o broadcast NÃO entregar evento de reunião pra quem não é dono (vazamento
// em tempo real). Sem isso, uma transcrição ao vivo pingava em TODOS os painéis.
const sseClients = new Set();

app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  // AUDITORIA #2: cabeçalho CORS agora é tratado pelo middleware cors() com
  // allowlist — não forçar '*' aqui (deixava o stream legível por qualquer site).
  res.flushHeaders();

  const client = { res, email: donoDoReq(req) };

  // Heartbeat a cada 15s (era 25s)
  const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 15000);
  sseClients.add(client);

  // Envia estado atual ao conectar — painel atualiza imediatamente
  res.write(`event: connected\ndata: ${JSON.stringify({ ts: new Date() })}\n\n`);

  req.on('close', () => {
    clearInterval(heartbeat);
    sseClients.delete(client);
  });
});

// targetEmail = dono da reunião do evento. Só entrega às conexões daquele dono.
// Segurança: se targetEmail vier vazio, NÃO entrega a ninguém (evita vazar por engano).
function broadcastSSE(event, data, targetEmail) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    if (!targetEmail || client.email !== targetEmail) continue;
    try { client.res.write(payload); } catch (_) { sseClients.delete(client); }
  }
}

// Endpoint extra chamado pelo background.js ao finalizar reunião
app.post('/api/end-meeting-notify', async (req, res) => {
  const { meetingId } = req.body;
  const _id = toObjectId(meetingId);
  const owner = donoDoReq(req);
  // Marca como finalizada no banco (só se for do dono) e notifica via SSE o dono.
  if (_id) {
    try {
      const database = await connectDatabase();
      const r = await database.collection('meetings').updateOne(
        { _id, ownerEmail: owner, finishedAt: null },
        { $set: { finishedAt: new Date() } }
      );
      // Só notifica se a reunião é mesmo do usuário (matched ou já existente dele).
      const existe = r.matchedCount || await database.collection('meetings')
        .countDocuments({ _id, ownerEmail: owner });
      if (existe) broadcastSSE('meetingEnded', { meetingId, ts: new Date(), status: 'finished' }, owner);
    } catch(_) {}
  }
  res.json({ ok: true });
});

/*
========================================
START SERVER
========================================
*/
// SPA fallback: qualquer rota que NÃO seja /api e não seja um arquivo estático
// devolve o index.html do React (pro React Router cuidar da navegação).
// Se o dist ainda não foi buildado, cai no next() (404) sem quebrar.
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api')) return next();
  res.sendFile(path.join(__dirname, '../frontend/dist/index.html'), (err) => { if (err) next(); });
});

// AUDITORIA #1: bind em 127.0.0.1 por padrão — sem host, o Express escutava em
// 0.0.0.0 (todas as interfaces), expondo a API sem auth para toda a rede local.
// Para acesso externo intencional, defina HOST=0.0.0.0 no .env.
/*
========================================
DIAGNÓSTICO DA SESSÃO DO BOT (no startup)
========================================
Motivo (bug "não captura nem a própria voz"): quase sempre a captura vem vazia
porque o bot NÃO conseguiu ENTRAR na sala, e a causa nº1 é a sessão do bot
(bot-auth.json) EXPIRADA. Antes isso só aparecia no meio de uma reunião — o
relogin automático falha silenciosamente quando BOT_EMAIL/BOT_PASSWORD estão
vazios no .env. Aqui a gente avisa logo no start, com instrução clara.

Usa o MESMO caminho que botJoin (path.join(__dirname, 'bot-auth.json')) para
não reportar sobre um arquivo diferente do que o bot realmente lê.
*/
function diagnosticarSessaoBot() {
  const fs   = require('fs');
  const path = require('path');
  const storageStatePath = path.join(__dirname, 'bot-auth.json');
  const temCredenciais = !!(process.env.BOT_EMAIL && process.env.BOT_PASSWORD);

  if (!fs.existsSync(storageStatePath)) {
    console.warn('⚠️  Bot: sessão (bot-auth.json) NÃO encontrada.');
    if (temCredenciais) {
      console.warn('    → BOT_EMAIL/BOT_PASSWORD configurados: o relogin automático vai tentar gerar a sessão ao entrar.');
    } else {
      console.warn('    → Rode "node login-bot.js" (login manual) OU configure BOT_EMAIL/BOT_PASSWORD no .env.');
      console.warn('    → Sem sessão válida, o bot NÃO entra na reunião e a captura fica VAZIA.');
    }
    return;
  }

  const idadeDias = Math.floor((Date.now() - fs.statSync(storageStatePath).mtimeMs) / 86400000);
  const LIMITE_DIAS = 14; // sessão do Google costuma durar semanas; acima disso, suspeitar

  if (idadeDias >= LIMITE_DIAS) {
    console.warn(`⚠️  Bot: sessão (bot-auth.json) tem ${idadeDias} dias — pode ter EXPIRADO.`);
    console.warn('    → Se a captura vier vazia, renove com "node login-bot.js".');
    if (!temCredenciais) {
      console.warn('    → BOT_EMAIL/BOT_PASSWORD vazios no .env: o relogin automático NÃO vai funcionar.');
    }
  } else {
    console.log(`🤖 Bot: sessão (bot-auth.json) OK (${idadeDias} dia(s)).`);
  }

  if (!temCredenciais && idadeDias < LIMITE_DIAS) {
    console.warn('⚠️  Bot: BOT_EMAIL/BOT_PASSWORD não configurados — relogin automático desativado (só login manual).');
  }
}

app.listen(PORT, HOST, async () => {
  await connectDatabase();
  console.log(`🚀 Server rodando em http://${HOST}:${PORT}`);

  // Diagnóstico da sessão do bot logo no start (ver função acima).
  try { diagnosticarSessaoBot(); } catch (e) { console.warn('⚠️ Falha ao diagnosticar sessão do bot:', e.message); }

  // CORREÇÃO #5: ao iniciar, finaliza reuniões que ficaram travadas
  // (ex: servidor foi derrubado no meio de uma reunião)
  try {
    const database = await connectDatabase();
    const eightHoursAgo = new Date(Date.now() - 8 * 3600 * 1000);
    const stuck = await database.collection('meetings').find({
      finishedAt: null,
      createdAt: { $lt: eightHoursAgo }
    }).toArray();

    if (stuck.length > 0) {
      console.log(`🔧 Finalizando ${stuck.length} reunião(ões) travada(s)...`);
      for (const m of stuck) {
        const finishedAt = new Date();
        const duration = (finishedAt - new Date(m.createdAt)) / 1000 / 60;
        await database.collection('meetings').updateOne(
          { _id: m._id },
          { $set: { finishedAt, duration } }
        );
      }
      console.log('✅ Reuniões travadas corrigidas.');
    }
  } catch (e) {
    console.warn('⚠️ Não foi possível verificar reuniões travadas:', e.message);
  }
});