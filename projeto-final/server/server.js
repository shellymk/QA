// server.js

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { MongoClient, ObjectId } = require('mongodb');

const app = express();

app.use(cors());
app.use(express.json());

// Servir os arquivos do painel web
app.use(express.static(path.join(__dirname, '../web')));

/*
========================================
CONFIGURAÇÃO
========================================
*/

// URI vem de variável de ambiente (.env) — nunca hardcode no código
const MONGO_URI = process.env.MONGO_URI ||
  'mongodb+srv://sheilamacedob_db_user:MeetAI123.@cluster0.l8i6rck.mongodb.net/meetai';

const PORT = process.env.PORT || 3000;

/*
========================================
CONEXÃO COM MONGODB
========================================
*/

const client = new MongoClient(MONGO_URI);
let db;

async function connectDatabase() {
  if (!db) {
    await client.connect();
    db = client.db('meetai');
    console.log('✅ MongoDB conectado');
  }
  return db;
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

    const meeting = {
      title: req.body.title || 'Reunião Meet',
      meetingCode: req.body.meetingCode || null,
      createdAt: new Date(),
      finishedAt: null,
      duration: null,
      participants: [],
      transcripts: []
    };

    const result = await database.collection('meetings').insertOne(meeting);

    res.json({
      success: true,
      meetingId: result.insertedId
    });

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

    const finishedAt = new Date();
    const duration = (finishedAt - new Date(meeting.createdAt)) / 1000 / 60; // minutos

    await database.collection('meetings').updateOne(
      { _id: new ObjectId(meetingId) },
      { $set: { finishedAt, duration } }
    );

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
        .find({}, { projection: { transcripts: 0 } }) // Não retorna transcripts na listagem (performance)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .toArray(),
      database.collection('meetings').countDocuments()
    ]);

    res.json({
      meetings,
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

    res.json(meeting);

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

    // Reuniões por dia (últimos 7 dias)
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
      hours: Math.round(totalMinutes / 60 * 10) / 10, // 1 casa decimal
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
BOT — GERENCIADOR DE SESSÕES
Suporta múltiplos bots simultâneos
========================================
*/
const activeBots = new Map(); // meetingId -> { page, context, meetingId }

// Status de todos os bots ativos
app.get('/api/bot/status', (req, res) => {
  const bots = [];
  for (const [id, bot] of activeBots.entries()) {
    bots.push({ meetingId: id, url: bot.url, startedAt: bot.startedAt });
  }
  res.json({ active: bots.length, bots });
});

// Iniciar bot em uma reunião
app.post('/api/bot/join', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'URL do Meet é obrigatória' });

  res.json({ status: 'Bot iniciando...', url });

  botJoin(url).catch(err => console.error('❌ Erro no bot:', err.message));
});

// Encerrar bot de uma reunião
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
Usa Chrome real fora da tela (Windows)
Não usa headless — evita detecção do Google
========================================
*/
async function botJoin(meetUrl) {
  const { chromium } = require('playwright');
  const fs = require('fs');
  const path = require('path');

  console.log(`🤖 Bot iniciando para: ${meetUrl}`);

  // Caminho onde salvamos o estado de autenticação do bot
  // Após o primeiro login manual, o bot reutiliza os cookies sem precisar logar de novo
  const storageStatePath = process.env.BOT_STORAGE_STATE ||
    path.join(__dirname, 'bot-auth.json');

  const storageExists = fs.existsSync(storageStatePath);

  // Lança o Chromium do Playwright (não usa perfil do sistema — sem conflitos)
  const browser = await chromium.launch({
    headless: false,
    args: [
      '--window-position=0,0',          // visível — Meet bloqueia janelas offscreen
      '--window-size=1280,720',
      '--disable-blink-features=AutomationControlled',
      '--use-fake-ui-for-media-stream',  // câmera/mic fake — sem pedir permissão
      '--use-fake-device-for-media-stream',
      '--disable-infobars',
      '--no-first-run',
      '--no-default-browser-check',
      '--mute-audio',
      '--no-sandbox',
      '--disable-features=TranslateUI',
      '--lang=pt-BR',                   // idioma do browser em PT-BR
    ],
    ignoreDefaultArgs: ['--enable-automation'],
  });

  // Cria contexto com estado de autenticação salvo (se existir)
  const context = await browser.newContext({
    storageState: storageExists ? storageStatePath : undefined,
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    permissions: ['camera', 'microphone'],
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  });

  // Remove navigator.webdriver que denuncia Playwright
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3] });
    Object.defineProperty(navigator, 'languages', { get: () => ['pt-BR', 'pt', 'en'] });
    window.chrome = { runtime: {} };
  });

  const page = await context.newPage();

  // Se não tem auth salvo, precisa fazer login primeiro
  if (!storageExists) {
    console.log('🔑 Sem autenticação salva — fazendo login...');
    await page.goto('https://accounts.google.com');
    console.log('⚠️ AÇÃO NECESSÁRIA: Faça login com a conta bot no Chrome que abriu.');
    console.log('   Após o login, acesse meet.google.com e pressione ENTER aqui.');
    await new Promise(resolve => process.stdin.once('data', resolve));
    await context.storageState({ path: storageStatePath });
    console.log('✅ Autenticação salva em', storageStatePath);
  }

  // User-agent humano
  await page.setExtraHTTPHeaders({
    'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8'
  });

  try {
    await page.goto(meetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    console.log('🌐 Página carregada, aguardando UI do Meet...');

    // Aguarda a tela de entrada carregar (câmera/mic preview)
    await page.waitForSelector(
      'button:has-text("Participar agora"), button:has-text("Join now"), button:has-text("Pedir para participar"), button:has-text("Ask to join")',
      { timeout: 20000 }
    ).catch(() => null);

    // Desliga câmera e microfone antes de entrar (bot silencioso)
    await page.evaluate(() => {
      const micBtn = document.querySelector('[aria-label*="Desativar microfone"], [aria-label*="Turn off microphone"], [jsname="psRWwb"]');
      const camBtn = document.querySelector('[aria-label*="Desativar câmera"], [aria-label*="Turn off camera"], [jsname="BOHaEe"]');
      if (micBtn && micBtn.getAttribute('aria-pressed') !== 'false') micBtn.click();
      if (camBtn && camBtn.getAttribute('aria-pressed') !== 'false') camBtn.click();
    }).catch(() => null);

    await page.waitForTimeout(1000);

    // Clica em "Participar" / "Join now"
    const joinSelectors = [
      'button:has-text("Participar agora")',
      'button:has-text("Join now")',
      'button:has-text("Pedir para participar")',
      'button:has-text("Ask to join")',
      '[jsname="Q67bS"]',
      '[jsname="Qx7uuf"]',
    ];

    let joined = false;
    for (const sel of joinSelectors) {
      try {
        const btn = page.locator(sel).first();
        if (await btn.isVisible({ timeout: 3000 })) {
          await btn.click();
          joined = true;
          console.log(`✅ Bot entrou via: ${sel}`);
          break;
        }
      } catch (_) { continue; }
    }

    if (!joined) {
      await page.screenshot({ path: 'debug_bot_entrada.png' });
      console.warn('⚠️ Botão de entrada não encontrado. Screenshot salvo.');
      await context.close();
      return;
    }

    // Aguarda estar dentro da sala — detecta qualquer elemento da sala ativa
    await page.waitForFunction(() => {
      return !!(
        document.querySelector('[data-participant-id]') ||
        document.querySelector('[jsname="psRWwb"]') ||
        document.querySelector('[jsname="BOHaEe"]') ||
        document.querySelector('[aria-label*="microfone"]') ||
        document.querySelector('[aria-label*="microphone"]') ||
        document.querySelector('.NzPR9b') // barra inferior do Meet
      );
    }, { timeout: 45000 });
    console.log('🟢 Bot dentro da reunião!');

    // Cria a reunião no banco
    const meetingResp = await fetch(`http://localhost:${PORT}/api/start-meeting`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: `Bot — ${new Date().toLocaleString('pt-BR')}`,
        meetingCode: meetUrl.match(/meet\.google\.com\/([a-z0-9\-]+)/)?.[1] || null
      })
    });
    const meetingData = await meetingResp.json();
    const meetingId = meetingData.meetingId;

    // Salva estado de autenticação atualizado (cookies renovados)
    const storageStatePath2 = process.env.BOT_STORAGE_STATE ||
      require('path').join(__dirname, 'bot-auth.json');
    await context.storageState({ path: storageStatePath2 }).catch(() => {});

    // Registra bot ativo
    activeBots.set(meetingId, { page, context: { close: () => browser.close() }, url: meetUrl, startedAt: new Date() });

    // Ativa legendas com retry
    await ativarLegendas(page);

    // Inicia captura de transcrição
    await escutarESalvar(page, meetingId);

    // Detecta fim da reunião (URL muda ou aparece tela de "Saiu da reunião")
    page.on('framenavigated', async (frame) => {
      if (frame === page.mainFrame()) {
        const url = frame.url();
        if (!url.includes('meet.google.com/') || url.includes('meetingended')) {
          console.log('🔴 Bot detectou fim da reunião');
          await botLeave(meetingId);
        }
      }
    });

  } catch (err) {
    console.error('❌ Erro no bot:', err.message);
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

  // Aguarda a UI da reunião carregar completamente
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
        // Botão CC que aparece no menu "Mais opções"
        '[data-tooltip*="captions"]',
        '[data-tooltip*="legenda"]',
      ];

      for (const sel of sels) {
        const btns = document.querySelectorAll(sel);
        for (const btn of btns) {
          if (!btn) continue;
          // Já está ativa
          if (btn.getAttribute('aria-pressed') === 'true') return 'already';
          // Clica para ativar
          btn.click();
          return 'clicked:' + sel;
        }
      }

      // Fallback: tenta achar pelo texto do botão
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

      // Verifica se o container de legendas apareceu no DOM
      await page.waitForTimeout(1500);
      const captionsActive = await page.evaluate(() =>
        !!(document.querySelector('.iOzk7') || document.querySelector('[jsname="dsyhDe"]'))
      );

      if (captionsActive || ativou === 'already') {
        console.log('✅ Legendas confirmadas ativas no DOM');

        // Força PT-BR via Playwright (com retry — botão pode demorar a aparecer)
        forcarPTBRBot(page).catch(() => {});

        return;
      }
    }

    console.log(`⏳ Tentativa ${i + 1}/8 — aguardando botão CC...`);
    await page.waitForTimeout(3000);
  }

  // Último recurso: tenta via menu "Mais opções"
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
BOT — CAPTURAR E SALVAR TRANSCRIÇÕES (v2)
Melhorias:
  • Múltiplos seletores de container e speaker
  • Extração robusta do nome do speaker
  • Algoritmo delta Word-level (evita repetições cumulativas)
  • PT-BR garantido
========================================
*/
async function escutarESalvar(page, meetingId) {
  console.log(`📡 Monitorando transcrições — meetingId: ${meetingId}`);

  await page.exposeFunction('__meetaiSave', async (speaker, text) => {
    try {
      await fetch(`http://localhost:${PORT}/api/add-transcript`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ meetingId, user: speaker, text, timestamp: new Date() })
      });
      console.log(`📝 [Bot] ${speaker}: ${text}`);
    } catch (e) {
      console.error('❌ Erro ao salvar transcrição:', e.message);
    }
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

    // Palavras de UI para filtrar falsos positivos
    const UI_WORDS = new Set([
      'mic','microfone','camera','câmera','chat','participantes','ativar','desativar',
      'legenda','caption','transcript','gravar','gravação','settings','configurações',
      'padrão','fonte','tamanho','circle','format_size','beta','language','português'
    ]);

    function isUI(text) {
      if (!text || text.length < 3) return true;
      const t = text.toLowerCase().trim();
      if (UI_WORDS.has(t)) return true;
      if (/^\([a-z\u00C0-\u00FF\s]+\)$/i.test(t)) return true;
      return false;
    }

    // Extrai speaker e texto do bloco de legenda
    // Tenta múltiplos seletores em ordem de especificidade
    function getSpeakerAndText(container) {
      // Estratégia 1: seletores específicos do Meet (nome do speaker como elemento separado)
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

      // Estratégia 2: bloco .nMcdL com estrutura texto-nó / elemento
      if (!speaker || !text) {
        const block = container.querySelector('.nMcdL');
        if (block) {
          // Percorre nós filhos para achar o nome (primeiro nó com texto curto)
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

      // Estratégia 3: texto completo do container dividido por nova linha
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

      // Remove o nome do speaker do início do texto (caso tenha escapado)
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
        const prev = speakerMemory.get(speaker) || '';
        let toSend = text;

        // Delta word-level (mesmo algoritmo do content.js)
        if (prev) {
          const norm = s => s.toLowerCase().replace(/[^\w\sÀ-ÿ]/gi, '').trim();
          const oW = prev.split(/\s+/), nW = text.split(/\s+/);
          let m = 0;
          for (let i = 0; i < Math.min(oW.length, nW.length); i++) {
            if (norm(oW[i]) === norm(nW[i])) m++;
            else if (i === oW.length - 1 && nW[i].toLowerCase().startsWith(norm(oW[i]))) m++;
            else break;
          }
          if (m > 0 && m >= Math.floor(oW.length * 0.5)) toSend = nW.slice(m).join(' ').trim();
          else if (norm(text) === norm(prev)) toSend = '';
        }

        toSend = toSend.replace(/^[^\w\sÀ-ÿ]+/g, '').trim();

        if (toSend.length > 2) {
          speakerMemory.set(speaker, text);
          setTimeout(() => speakerMemory.delete(speaker), 15000);
          window.__meetaiSave(speaker, toSend);
        }

        pendingTimers.delete(speaker);
      }, 1000);

      pendingTimers.set(speaker, timer);
    }

    // Observa todos os containers de legenda possíveis
    const CAPTION_SELECTORS = '.iOzk7,[jsname="dsyhDe"],.vNKgIf,.CNusmb,.Mz6pEf,.a4cQT';

    const captionObserver = new MutationObserver(() => {
      document.querySelectorAll(CAPTION_SELECTORS).forEach(processCaption);
    });
    captionObserver.observe(document.body, { childList: true, subtree: true, characterData: true });

    // Também faz polling a cada 1s como backup
    setInterval(() => {
      document.querySelectorAll(CAPTION_SELECTORS).forEach(processCaption);
    }, 1000);

    // Participantes a cada 10s
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
Usa Playwright diretamente (mais confiável que evaluate)
========================================
*/
async function forcarPTBRBot(page, tentativa = 0) {
  if (tentativa > 5) { console.warn('⚠️ PT-BR: máximo de tentativas atingido'); return; }

  await page.waitForTimeout(2000);

  // Procura o botão de idioma
  const langSels = [
    '[jsname="V68bde"]',
    '[aria-label*="Idioma das legendas"]',
    '[aria-label*="Caption language"]',
    '[aria-label*="caption language"]',
  ];

  let langBtn = null;
  for (const sel of langSels) {
    try {
      const loc = page.locator(sel).first();
      if (await loc.isVisible({ timeout: 2000 })) { langBtn = loc; break; }
    } catch (_) {}
  }

  if (!langBtn) {
    console.log(`⏳ PT-BR: botão de idioma não encontrado, tentativa ${tentativa + 1}/5...`);
    await page.waitForTimeout(4000);
    return forcarPTBRBot(page, tentativa + 1);
  }

  try {
    await langBtn.click();
    await page.waitForTimeout(1000);

    // Procura opção Português na lista
    const optSels = [
      'li:has-text("Português (Brasil)")',
      'li:has-text("Português")',
      '[role="option"]:has-text("Português")',
      '[role="menuitem"]:has-text("Português")',
    ];

    let selecionou = false;
    for (const sel of optSels) {
      try {
        const opt = page.locator(sel).first();
        if (await opt.isVisible({ timeout: 1500 })) {
          await opt.click();
          selecionou = true;
          console.log('✅ [Bot] PT-BR ativado nas legendas');
          break;
        }
      } catch (_) {}
    }

    if (!selecionou) {
      await page.keyboard.press('Escape').catch(() => {});
      await page.waitForTimeout(3000);
      return forcarPTBRBot(page, tentativa + 1);
    }
  } catch (e) {
    console.warn('⚠️ PT-BR erro:', e.message);
    await page.waitForTimeout(3000);
    return forcarPTBRBot(page, tentativa + 1);
  }
}

/*
========================================
BOT — SAIR DA REUNIÃO
========================================
*/
async function botLeave(meetingId) {
  const bot = activeBots.get(meetingId);
  if (!bot) return;

  try {
    // Finaliza reunião no banco
    await fetch(`http://localhost:${PORT}/api/end-meeting`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ meetingId })
    });

    await bot.context.close().catch(() => {});
    activeBots.delete(meetingId);
    console.log(`🔴 Bot encerrado — meetingId: ${meetingId}`);
  } catch (e) {
    console.error('Erro ao encerrar bot:', e.message);
    activeBots.delete(meetingId);
  }
}

/*
========================================
HEALTH CHECK
GET /api/health
========================================
*/

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date() });
});

/*
========================================
START SERVER
========================================
*/


app.listen(PORT, async () => {
  await connectDatabase();
  console.log(`🚀 Server rodando em http://localhost:${PORT}`);
});

/*
========================================
SSE — NOTIFICAÇÕES EM TEMPO REAL
Permite que a página web seja notificada
quando uma reunião termina e redireciona
automaticamente para reuniões gravadas.
GET /api/events
========================================
*/

const sseClients = new Set();

app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.flushHeaders();

  const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 25000);
  sseClients.add(res);

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

// Endpoint extra chamado pelo bot ao finalizar reunião
app.post('/api/end-meeting-notify', (req, res) => {
  const { meetingId } = req.body;
  broadcastSSE('meetingEnded', { meetingId, ts: new Date() });
  res.json({ ok: true });
});
