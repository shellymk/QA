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