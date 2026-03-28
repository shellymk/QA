// server.js — MEETAI (CORRIGIDO)
// CORREÇÃO #5: painel web para de mostrar "ao vivo" quando reunião é encerrada
// — broadcastSSE disparado em TODOS os caminhos de fim de reunião
// — endpoint /api/meetings retorna campo `status` calculado corretamente
// — reuniões sem finishedAt que estão há mais de 8h são auto-finalizadas

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { MongoClient, ObjectId } = require('mongodb');

const app = express();

app.use(cors());
app.use(express.json());

app.use(express.static(path.join(__dirname, '../web')));

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

/*
========================================
CONFIGURAÇÃO
========================================
*/
const MONGO_URI = process.env.MONGO_URI;
const PORT = process.env.PORT || 3000;

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
CRIAR NOVA REUNIÃO
POST /api/start-meeting
Body: { title, meetingCode }
========================================
*/
app.post('/api/start-meeting', async (req, res) => {
  try {
    const database = await connectDatabase();

    const meetingCode = req.body.meetingCode || null;
    const title       = req.body.title || 'Reunião Meet';

    // FIX DUPLICATA: findOneAndUpdate atomico — independente de quantas chamadas
    // chegarem ao mesmo tempo (bot + extensao), so UMA reuniao e criada
    if (meetingCode) {
      // Usa updateOne+upsert separado para evitar inconsistencia de versao do driver
      const filter = {
        meetingCode,
        finishedAt: null,
        createdAt: { $gte: new Date(Date.now() - 4 * 3600 * 1000) }
      };
      await database.collection('meetings').updateOne(
        filter,
        {
          $setOnInsert: {
            title,
            meetingCode,
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

    if (!meetingId || !text) {
      return res.status(400).json({ error: 'meetingId e text são obrigatórios' });
    }

    await database.collection('meetings').updateOne(
      { _id: new ObjectId(meetingId) },
      {
        $push: {
          transcripts: {
            user: user || 'Participante',
            text,
            timestamp: timestamp ? new Date(timestamp) : new Date()
          }
        }
      }
    );

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

    if (!meetingId || !Array.isArray(transcripts) || transcripts.length === 0) {
      return res.status(400).json({ error: 'meetingId e transcripts[] são obrigatórios' });
    }

    const items = transcripts.map(t => ({
      user: t.user || 'Participante',
      text: t.text || '',
      timestamp: t.timestamp ? new Date(t.timestamp) : new Date()
    })).filter(t => t.text.length > 0);

    if (items.length === 0) return res.json({ success: true, saved: 0 });

    await database.collection('meetings').updateOne(
      { _id: new ObjectId(meetingId) },
      { $push: { transcripts: { $each: items } } }
    );

    // Notifica SSE para atualização em tempo real
    broadcastSSE('newTranscripts', { meetingId, count: items.length });

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

    if (!meetingId) {
      return res.status(400).json({ error: 'meetingId é obrigatório' });
    }

    await database.collection('meetings').updateOne(
      { _id: new ObjectId(meetingId) },
      { $set: { participants: participants || [] } }
    );

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

    if (!meetingId) {
      return res.status(400).json({ error: 'meetingId é obrigatório' });
    }

    const meeting = await database.collection('meetings').findOne({
      _id: new ObjectId(meetingId)
    });

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
      });
      return res.json({ success: true, duration: meeting.duration, alreadyFinished: true });
    }

    const finishedAt = new Date();
    const duration = (finishedAt - new Date(meeting.createdAt)) / 1000 / 60;

    await database.collection('meetings').updateOne(
      { _id: new ObjectId(meetingId) },
      { $set: { finishedAt, duration } }
    );

    // CORREÇÃO #5: broadcast SSE imediato — painel para de mostrar "ao vivo"
    broadcastSSE('meetingEnded', {
      meetingId,
      duration,
      finishedAt,
      status: 'finished'
    });

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

    const [meetings, total] = await Promise.all([
      database.collection('meetings')
        .find({}, { projection: { transcripts: 0 } })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .toArray(),
      database.collection('meetings').countDocuments()
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

    const meeting = await database.collection('meetings').findOne({
      _id: new ObjectId(req.params.id)
    });

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

    const meetings = await database.collection('meetings').find().toArray();

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
DELETAR REUNIÃO
DELETE /api/meeting/:id
========================================
*/
app.delete('/api/meeting/:id', async (req, res) => {
  try {
    const database = await connectDatabase();

    await database.collection('meetings').deleteOne({
      _id: new ObjectId(req.params.id)
    });

    res.json({ success: true });

  } catch (error) {
    console.error('Erro ao deletar reunião:', error);
    res.status(500).json({ error: 'Erro ao deletar reunião' });
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

    const stuck = await database.collection('meetings').find({
      finishedAt: null,
      createdAt: { $lt: eightHoursAgo }
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
      });
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
      method: 'POST', headers: { 'Content-Type': 'application/json' },
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
        headers: { 'Content-Type': 'application/json' },
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
        headers: { 'Content-Type': 'application/json' },
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

    // Polling a cada 500ms — captura fala rapida
    setInterval(() => {
      document.querySelectorAll(CAPTION_SELECTORS).forEach(processCaption);
    }, 500);

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
  // localStorage é mais confiavel que clicar em botões
  // Injeta PT-BR direto nas chaves que o Meet usa
  try {
    await page.evaluate(() => {
      try {
        localStorage.setItem('yt-player-captionstrackSettings',
          JSON.stringify({ translationLanguage: null, trackKind: 'asr', displayedLanguage: 'pt-BR' }));
        localStorage.setItem('subtitles-preferred-languages', 'pt-BR');
        localStorage.setItem('CAPTION_LANGUAGE', 'pt-BR');
      } catch(_) {}
    });
    console.log('PT-BR bot: idioma definido via localStorage');

    // Tenta também via clique (funciona quando o botão aparece)
    const langSels = [
      '[jsname="V68bde"]',
      '[aria-label*="Idioma das legendas"]',
      '[aria-label*="Caption language"]',
    ];
    for (const sel of langSels) {
      try {
        const loc = page.locator(sel).first();
        if (await loc.isVisible({ timeout: 1000 })) {
          await loc.click();
          await page.waitForTimeout(600);
          for (const opt of ['li:has-text("Português")', '[role="option"]:has-text("Português")']) {
            try {
              const el = page.locator(opt).first();
              if (await el.isVisible({ timeout: 800 })) {
                await el.click();
                console.log('PT-BR bot: ativado via clique!');
                return;
              }
            } catch(_) {}
          }
          await page.keyboard.press('Escape').catch(() => {});
          break;
        }
      } catch(_) {}
    }
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
      headers: { 'Content-Type': 'application/json' },
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
const sseClients = new Set();

app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.flushHeaders();

  // Heartbeat a cada 15s (era 25s)
  const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 15000);
  sseClients.add(res);

  // Envia estado atual ao conectar — painel atualiza imediatamente
  res.write(`event: connected\ndata: ${JSON.stringify({ ts: new Date() })}\n\n`);

  req.on('close', () => {
    clearInterval(heartbeat);
    sseClients.delete(res);
  });
});

function broadcastSSE(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    try { client.write(payload); } catch (_) { sseClients.delete(client); }
  }
}

// Endpoint extra chamado pelo background.js ao finalizar reunião
app.post('/api/end-meeting-notify', async (req, res) => {
  const { meetingId } = req.body;
  // Notifica via SSE
  broadcastSSE('meetingEnded', { meetingId, ts: new Date(), status: 'finished' });
  // Marca como finalizada no banco se ainda não foi
  if (meetingId) {
    try {
      const database = await connectDatabase();
      await database.collection('meetings').updateOne(
        { _id: new ObjectId(meetingId), finishedAt: null },
        { $set: { finishedAt: new Date() } }
      );
    } catch(_) {}
  }
  res.json({ ok: true });
});

/*
========================================
START SERVER
========================================
*/
app.listen(PORT, async () => {
  await connectDatabase();
  console.log(`🚀 Server rodando em http://localhost:${PORT}`);

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