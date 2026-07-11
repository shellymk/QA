## ⚠️ REGRA DE FLUXO (obrigatória)
**Não implementar / editar código sem aval explícito do usuário.** Primeiro investigar,
explicar e propor o plano; só alterar arquivos depois de uma confirmação clara do tipo
**"pode seguir"** (ou equivalente: "pode implementar", "vai", "manda ver"). Investigar,
ler e planejar é sempre permitido — mexer em código, não, até o "pode seguir".

**Sempre explicar a causa dos bugs.** Ao relatar ou corrigir qualquer bug, explicar:
sintoma → **causa raiz** → **como foi causado** (qual trecho/decisão introduziu o
problema, com arquivo/linha) → correção. Não entregar só o conserto.

---

# MeetAI — Transcritor automático do Google Meet

Sistema que entra em reuniões do Google Meet, captura as legendas (captions) em tempo
real e salva a transcrição em um banco MongoDB, exibindo tudo num painel web.

Todo o código e comentários estão em **português**. Mantenha esse padrão.

## Arquitetura (3 componentes)

Layout flat na raiz do repositório:

```
QA-transcription/
├── backend/      Node/Express + bot Playwright + MongoDB
├── frontend/     Painel web (HTML/CSS/JS puro, sem framework)
└── extension/    Extensão Chrome (MV3) — roda no navegador REAL do usuário
```

### 1. Extensão Chrome (`extension/`)
Roda dentro da aba do Meet do **usuário real**.
- `manifest.json` — MV3, content script em `https://meet.google.com/*`, service worker.
- `content.js` — **coração da captura**. Detecta a reunião, ativa legendas, força PT-BR,
  observa o DOM das legendas, extrai `{speaker, text}` e **agrupa em FRASES COERENTES**
  (não palavra por palavra) antes de enviar ao `background.js`. É o arquivo mais complexo
  e mais frágil (ver Problemas Conhecidos). **Ao vivo é SÓ legenda — sem áudio.**
- `background.js` — service worker. Recebe mensagens do content, cria/finaliza a reunião
  no servidor (`/api/start-meeting`, `/api/end-meeting`) e faz batch das transcrições
  (`/api/add-transcripts-batch`). **Não dispara mais o bot** (migração EXTENSÃO-ONLY);
  o disparo `/api/bot/join` foi removido daqui — o endpoint segue no servidor, dormente.
  **Não grava áudio no ao vivo** (decisão da usuária) — o áudio/diarização é só no upload.
- `popup.js` / `popup.html` — UI de Iniciar/Parar. Estado vem de `chrome.storage.local`.

### 2. Servidor + Bot (`backend/`)
- `server.js` — Express. Endpoints REST (`/api/*`), SSE em `/api/events` para o painel,
  serve a pasta `frontend/` estática, e contém o **bot Playwright** (`botJoin`,
  `escutarESalvar`, `ativarLegendas`, `forcarPTBRBot`, `botLeave`).
  O bot é um **segundo capturador**: um Chromium headless com conta dedicada que entra
  na mesma reunião e captura as legendas por conta própria (código injetado via
  `page.evaluate`, lógica espelhada da do `content.js`).
- `login-bot.js` — login manual único do bot; gera `bot-auth.json` (sessão salva).
  O `server.js` também tem `autoLoginBot()` que faz relogin via `BOT_EMAIL`/`BOT_PASSWORD`.
- Config via `.env` (ver `env.example`): `PORT`, `MONGO_URI`, `BOT_EMAIL`, `BOT_PASSWORD`.

### 3. Painel Web (`frontend/`)
HTML/CSS/JS puro (ES modules, sem build). `frontend/js/config.js` define `API_URL`.
Consome `/api/meetings`, `/api/meeting/:id`, `/api/analytics` e escuta SSE `/api/events`.

## Fluxo de dados

```
Usuário entra no Meet
  → content.js detecta (onStart) → avisa background (meetingStarted)
  → usuário clica Iniciar (popup) → content.startRecording()
      → ativa legendas + força PT-BR (localStorage) + inicia MutationObserver
      → background: cria reunião no servidor
  → APENAS a extensão captura legendas na PRÓPRIA aba do usuário (decisão EXTENSÃO-ONLY):
      content.js (startObserver → captureCaptions → sendTranscript → agruparFala)
        → agrupa a legenda em FRASES COERENTES (emite numa pausa ~1,2s, na troca de
          falante, ou a cada 6s numa fala contínua) → background.js (batch)
        → /api/add-transcripts-batch
      (SEM áudio no ao vivo; o bot headless NÃO é mais disparado — ver Histórico de bugs)
  → servidor salva no MongoDB (coleção `meetings`, array `transcripts`)
  → broadcast SSE → painel web atualiza em tempo real
Reunião termina → end-meeting (esvazia a fila ANTES de zerar o meetingId) → status 'finished'

--- MODO ALTERNATIVO: "Subir gravação" (upload de áudio, separado do ao vivo) ---
Painel → PainelUpload → POST /api/transcrever-upload (corpo bruto do arquivo)
  → AssemblyAI (STT + diarização speaker_labels) → falas "Pessoa A/B/C" com pontuação
  → salva como reunião finalizada (origem: 'upload'). É AQUI que mora o áudio/diarização.
```

## Modelo de dados (MongoDB, coleção `meetings`)
```js
{
  _id, title, meetingCode, createdAt, finishedAt, duration,
  participants: [String],
  transcripts: [{ user, text, timestamp }]
}
```
`status` ('live'/'finished') é **calculado** (`calcStatus`), não fica salvo:
`finished` se tem `finishedAt` OU se foi criada há mais de 8h sem finalizar.

## Como rodar

```bash
cd backend
cp env.example .env          # preencher MONGO_URI, BOT_EMAIL, BOT_PASSWORD
npm install
node login-bot.js            # 1ª vez: gera bot-auth.json
npm start                    # sobe servidor em http://localhost:3000
```
Extensão: `chrome://extensions` → Modo desenvolvedor → Carregar sem compactação →
selecionar a pasta `extension/`.

## Endpoints principais (`server.js`)
- `POST /api/start-meeting` — cria reunião (upsert atômico por `meetingCode`, anti-duplicata)
- `POST /api/add-transcript` / `POST /api/add-transcripts-batch` — salva transcrição(ões)
- `POST /api/end-meeting` (idempotente) / `POST /api/end-meeting-notify`
- `GET  /api/meetings` (paginado) / `GET /api/meeting/:id` / `DELETE /api/meeting/:id`
- `GET  /api/analytics`
- `POST /api/bot/join` / `POST /api/bot/leave` / `GET /api/bot/status`
- `GET  /api/events` — SSE
- `POST /api/fix-stuck-meetings` — finaliza reuniões travadas

## Onde está a captura de legendas (EXTENSÃO-ONLY)
Fonte **única**: a extensão, capturando na **própria aba do usuário** (`extension/content.js`).
Modelo "extensão na própria aba" (estilo tl;dv): o usuário já está logado e dentro da
reunião com a conta dele, então lê-se a legenda direto do DOM da aba. A extração de
`{speaker, text}` depende de **seletores CSS internos do Google Meet** (`.nMcdL`, `.zs7s8d`,
`.ygicle`, `.iOzk7`, `[jsname="dsyhDe"]`, etc.), que o Google **muda sem aviso**.
- `content.js` → `startRecording()` → `enableCaptions()` (liga legendas) + `startObserver()`
  (MutationObserver) → `captureCaptions()` → `extractBlock()` (extração; descarta nós
  dentro de menu/config, espelhando o antigo `processCaption` do bot) → `sendTranscript()`
  → `agruparFala()` (junta a fala e só emite numa PAUSA ~1,2s, na troca de falante, ou a
  cada 6s se a fala for contínua) → `_fecharFala()` → `_enviarDelta()` (dedup/delta) →
  `background.js` (batch). **A legenda do Meet já vem pontuada — por isso agrupamos em
  frases inteiras em vez de mandar palavra por palavra.**
- `forcarPTBR()` força PT-BR **só via localStorage** (não abre menu — ver histórico de bugs).
- `isUIText()` + `UI_WORDS` / `UI_PREFIXES` filtram UI.
- **Limite conhecido:** só captura enquanto a aba do Meet está aberta (é o esperado neste modelo).
- **Bot headless (`server.js`):** todo o código (`botJoin`, `escutarESalvar`, `getSpeakerAndText`…)
  **continua no arquivo, porém dormente** — não é mais disparado. Mantido como referência
  (e possível opção futura de "gravar sem estar presente").

## Histórico de bugs (causa raiz → como foi causado → correção)
- **Retornava nomes de configuração como se fosse fala.**
  *Causa raiz:* o observer de captura lia o painel de configurações de legenda.
  *Como foi causado:* `forcarPTBR()` (content) e `forcarPTBRBot()` (bot) clicavam no
  botão de idioma pra forçar PT-BR, o que **abre o menu de config**; no bot,
  `forcarPTBRBot` era chamada sem `await` por `ativarLegendas`, rodando em paralelo com
  o observer. *Correção:* forçar PT-BR só via `localStorage`; e `processCaption` agora
  descarta nós dentro de `[role="menu"/"listbox"/"dialog"...]`.
- **Duplicava transcrições.**
  *Causa raiz:* duas fontes gravando no mesmo `meetingId`. *Como foi causado:* decisão
  antiga de rodar `content.js` **e** o bot capturando em paralelo. *Correção (histórica):*
  BOT-ONLY — captura do `content.js` desligada. **Superada pela migração EXTENSÃO-ONLY**
  (ver abaixo): agora há uma única fonte (a extensão), então não há mais duplicação.
- **Migração BOT-ONLY → EXTENSÃO-ONLY (2026-07-02).**
  *Sintoma:* transcrição vazia — não capturava nem a própria voz. *Causa raiz:* o bot
  headless não entrava na sala (conta-robô com sessão `bot-auth.json` expirada de ~96 dias
  + reuniões exigindo admissão do bot). *Como foi causado:* a decisão BOT-ONLY dependia de
  uma conta-robô dedicada que precisava logar e ser admitida em cada reunião — frágil.
  *Correção:* voltar a capturar na **própria aba do usuário** (religado `enableCaptions`
  + `startObserver` em `content.js`; disparo do bot removido de `background.js`), reaplicando
  as proteções do bug do "retorno de configurações" (PT-BR só via localStorage + `extractBlock`
  descartando nós de menu).
- **Re-emissão dentro do próprio bot.** *Causa raiz/como:* `escutarESalvar` rodava
  MutationObserver **e** `setInterval(500ms)` sobre os mesmos nós. *Correção:* mantido só
  o observer; o debounce por speaker (600ms) cuida das rajadas.
- **Transcrição ao vivo saía PICADA (palavra por palavra, sem pontuação) (2026-07-11).**
  *Sintoma:* cada palavra da legenda virava uma entrada ("inicia"/"iniciando"/"a gravação").
  *Causa raiz:* `sendTranscript` chamava `_enviarDelta` a **cada mutação do DOM**, emitindo
  1 palavra por vez. *Como foi causado:* a legenda do Meet cresce/refina palavra a palavra;
  emitir na hora fragmenta. *Correção:* `agruparFala()`/`_fecharFala()` — guarda a versão
  mais completa (que o Meet já pontua) e só emite numa PAUSA (~1,2s), na troca de falante,
  ou a cada 6s (fala contínua). Aí sai a frase inteira, coerente.
- **Reunião ao vivo vinha ZERADA no painel (2026-07-11).**
  *Causa raiz (dupla):* (1) com o agrupamento por pausa, se a fala não "assentava" o texto
  ficava preso no buffer e só sairia no fim; (2) no fim, `endMeeting` zerava o `meetingId`
  **antes** de a fila (`transcriptQueue`) ser gravada, e o popup mandava `recordingStopped`
  em paralelo, encerrando cedo. *Correção:* emitir a cada 6s mesmo sem pausa; `endMeeting`
  faz `flushTranscripts()` **antes** de zerar; cada fala carrega seu próprio `meetingId` na
  fila; só o `content.js` dispara `recordingStopped` (depois de esvaziar o buffer).
  *Diagnóstico:* um HUD temporário na tela do Meet mostrou que a captura lia a legenda e
  enviava — confirmado, HUD **removido** (usuária quer minimalista: só a bolinha vermelha).

## Ainda em aberto (investigar em reunião real)
1. **Atribuição de speaker.** Quando o seletor de nome falha, cai em `'Participante'`.
   Validar `extractBlock` / `SPEAKER_SELECTORS` (content.js) contra o DOM atual do Meet.
2. **Seletores desatualizados do Meet.** Se a captura zerar do nada, quase sempre o
   Google trocou as classes — inspecionar o DOM da legenda e atualizar em `content.js`
   (`CAPTION_SELECTORS` / `SPEAKER_SELECTORS` / `TEXT_SELECTORS`).
3. **Captura EXTENSÃO-ONLY em reunião real — VALIDADO (2026-07-11).** A usuária confirmou:
   ao vivo lê a legenda, reconhece o participante do Meet e sobe as frases coerentes pro
   painel. Ao vivo é **só legenda, sem áudio**; áudio/diarização fica no "Subir gravação".
4. **Autenticação da extensão via login (não chave colada).** Hoje o popup pede a
   `EXTENSION_API_KEY` (modo dev). No produto, a extensão deve autenticar pelo login
   do usuário (JWT) — parte do multiusuário (#1 do ROADMAP). Usuário final NUNCA cola chave.

## Convenções
- Português em código, comentários e logs.
- Não versionar: `.env`, `bot-auth.json`, `debug_bot_*.png`, `node_modules/` (já no `.gitignore`).
  `node_modules/` foi **destrackeado** na reestruturação (estava versionado por engano).
- Captura EXTENSÃO-ONLY: fonte única na aba do usuário (`content.js`); o bot headless
  segue no `server.js` porém dormente. URL do Meet **sem** `?hl=en`.
- CommonJS no servidor (`require`); ES modules no `frontend/`.
```
