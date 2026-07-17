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

## Deploy em produção (2026-07-15)
Split: **painel na Vercel**, **backend na Render**, **banco no MongoDB Atlas**.
- **Painel (frontend):** Vercel → `https://qa-gray.vercel.app`. Root Directory `frontend`;
  env `VITE_API_URL=https://transcription-1pcy.onrender.com` (o `API_URL` em
  `frontend/src/lib/api.ts` lê essa var; sem ela cai em `localhost:3000` no dev).
  **`frontend/vercel.json` é obrigatório** (rewrite `/(.*)` → `/index.html`): sem ele,
  deep-links e F5 em `/login`, `/cadastro`, `/reuniao/:id` dão HTTP 404 (SPA BrowserRouter).
- **Backend (server.js):** Render (Web Service, Node, plano Free) → `https://transcription-1pcy.onrender.com`.
  Root Directory `backend`; Build `npm install`; Start `npm start`.
  Envs: `MONGO_URI`, `AUTH0_DOMAIN`, `AUTH0_AUDIENCE`, `EXTENSION_API_KEY`, `ASSEMBLYAI_API_KEY`,
  `HOST=0.0.0.0` (crítico — sem isso o health check falha), `NODE_ENV=production`,
  `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` (bot dormente; não baixa navegador),
  `ALLOWED_ORIGINS=https://qa-gray.vercel.app` (CORS do painel). **Não setar `PORT`**
  (a Render injeta). Free tier: **dorme após ~15min** (1º acesso ~30s) e `recordings/`
  é **efêmero** (some no redeploy — futuramente S3 se precisar persistir).
- **Atlas:** Network Access com `0.0.0.0/0` (a Render não tem IP fixo no free).
- **Extensão:** aponta pra produção (`SERVIDOR` no `background.js` = Render; `PAINEL_URL`
  no `popup.js` = Vercel). Roda da pasta local; recarregar em `chrome://extensions` após editar.

## Autenticação (Auth0) — migrado em 2026-07-17
Login/cadastro/Google/confirmação de email/reset de senha ficam **por conta do Auth0**
(Universal Login). O backend **não** guarda senha nem assina JWT próprio — só **valida** o
access token do Auth0 (RS256 via JWKS), conferindo `AUTH0_AUDIENCE` e `issuer` (`AUTH0_DOMAIN`).
- **Frontend:** `@auth0/auth0-react`. `Auth0Provider` em `main.tsx` (`cacheLocation:'localstorage'`
  + `useRefreshTokens` p/ sobreviver ao F5). `auth/AuthContext.tsx` mantém a **mesma interface
  `useAuth()`** de antes (Layout/ProtectedRoute/Login/Cadastro não precisaram de reescrita
  grande), mas por baixo chama `loginWithRedirect`/`logout`/`getAccessTokenSilently`.
  `Login.tsx`/`Cadastro.tsx` viraram "portas" com botões (o form de senha vive no Auth0).
- **Ponte com a extensão:** um `useEffect` no `AuthContext` grava o access token em
  `localStorage['meetai_token']` — então `api.ts` e `session-bridge.js` **continuam iguais**
  (a extensão herda o token do painel, como antes).
- **Email (`ownerEmail`):** o access token do Auth0 **não traz email por padrão**. Uma
  **Action** (Login flow) injeta o claim `https://meetai/email`; o `authRequired` lê
  `decoded['https://meetai/email'] || decoded.email` (minúsculas). **Sem essa Action o
  isolamento multiusuário quebra** (ownerEmail vira null).
- **Envio de email:** confirmação/reset saem pelo **Gmail do bot** via SMTP configurado
  **no painel do Auth0** (Branding → Email Provider) — App Password, nunca no `.env`/código.
- **Config no Auth0:** Application (SPA) com Allowed Callback/Logout/Web Origins =
  `http://localhost:5173` + `https://qa-gray.vercel.app`; API com Identifier = `AUTH0_AUDIENCE`;
  Password Policy (força + mínimo) substitui a antiga validação do bcrypt.
- **Google login (A6):** depende de um OAuth Client no **Google Cloud** colado na conexão
  Google do Auth0. Enquanto não fizer, o botão "Google" existe mas a conexão não resolve.

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
- **Extensão pedia EXTENSION_API_KEY colada (auth por chave compartilhada) (2026-07-15).**
  *Sintoma:* usuária não queria colar chave nem que isso fosse publicável (chave-mestra no
  código = qualquer um extrai). *Causa raiz:* extensão autenticava com `X-API-Key`
  (segredo único). *Correção:* **ponte de sessão** — novo `extension/session-bridge.js`
  (content script na aba do painel) lê o JWT do `localStorage` do painel e entrega ao
  `background.js`, que passa a mandar `Authorization: Bearer <jwt>`. Login é feito UMA vez
  no painel; a extensão herda. Sem chave, sem tela de login no popup. Backend já aceitava JWT.
- **VAZAMENTO ENTRE CONTAS — qualquer usuário via/alterava/apagava reuniões de todos (2026-07-15).**
  *Sintoma:* uma 2ª conta (`jessica.assis@…`) via as transcrições da dona. *Causa raiz:*
  **multiusuário nunca implementado** — as reuniões não tinham dono e **nenhum** endpoint
  filtrava por usuário (`GET /api/meetings`, `/meeting/:id`, `/analytics`, `/lixeira`,
  mutações, `DELETE`, `GET media` (IDOR de arquivo) e o SSE `broadcastSSE` — tudo aberto).
  *Como foi causado:* sistema era single-tenant; ao publicar e várias contas se cadastrarem
  (`/api/register` aberto), todas caíram no mesmo balde. *Correção:* toda reunião carrega
  `ownerEmail` (do JWT) via helper `donoDoReq(req)`, e **TODO** acesso filtra por ele;
  SSE amarra cada conexão ao email e `broadcastSSE(event, data, ownerEmail)` só entrega ao
  dono; índice `{ownerEmail:1, deletedAt:1, createdAt:-1}` (evita COLLSCAN). Migração:
  reuniões antigas atribuídas a `shellymk07@gmail.com`. Validado: 25/25 testes de isolamento
  em runtime. **Ao criar QUALQUER endpoint novo que toque `meetings`, filtrar por ownerEmail.**
- **Usabilidade (deploy) — 3 bugs achados dirigindo o painel (2026-07-15).** (1) SPA dava 404
  em deep-link/F5 → `frontend/vercel.json` (rewrite). (2) banner de erro do Dashboard apontava
  `localhost:3000` (errado em prod) → texto neutro. (3) senha errada mostrava "Sessão expirada"
  → `apiFetch` só trata 401 como expiração **quando havia token**; sem token, deixa passar a
  msg real do servidor ("Credenciais inválidas"). Validado: 10/10 dirigindo prod com Playwright.

## Ainda em aberto (investigar em reunião real)
1. **Atribuição de speaker.** Quando o seletor de nome falha, cai em `'Participante'`.
   Validar `extractBlock` / `SPEAKER_SELECTORS` (content.js) contra o DOM atual do Meet.
2. **Seletores desatualizados do Meet.** Se a captura zerar do nada, quase sempre o
   Google trocou as classes — inspecionar o DOM da legenda e atualizar em `content.js`
   (`CAPTION_SELECTORS` / `SPEAKER_SELECTORS` / `TEXT_SELECTORS`).
3. **Captura EXTENSÃO-ONLY em reunião real — VALIDADO (2026-07-11).** A usuária confirmou:
   ao vivo lê a legenda, reconhece o participante do Meet e sobe as frases coerentes pro
   painel. Ao vivo é **só legenda, sem áudio**; áudio/diarização fica no "Subir gravação".
4. **Autenticação da extensão via login — FEITO (2026-07-15).** Não pede mais chave:
   `session-bridge.js` herda o JWT do login do painel (ver Histórico de bugs).
5. **DOIS MICROFONES ABERTOS — a fala do 2º é atribuída ao 1º (EM ABERTO).** Bug de
   usabilidade/correção no `content.js`: quando os dois falantes colapsam no mesmo nome
   (seletor de nome falha), o `agruparFala` joga tudo no mesmo balde. **Precisa do
   `outerHTML` de uma legenda numa reunião real** pra acertar `SPEAKER_SELECTORS` — não dá
   pra corrigir às cegas. Pendente até capturar o DOM.
6. **Cadastro agora é do Auth0 (migrado 2026-07-17).** Não há mais `/api/register`/`/api/login`
   no backend — quem cria conta é o Auth0, com **confirmação de email obrigatória** antes de
   usar. Pendências: (a) criar a **Action** que injeta o claim `https://meetai/email` (senão
   ownerEmail quebra); (b) ligar o **Google Cloud** (A6) pro botão Google resolver; (c) decidir
   se fecha o cadastro (convite/aprovação) via regra no Auth0. A conta antiga da Jessica no
   Mongo é inofensiva (owner-scoping), mas os usuários locais viraram legado (login é só Auth0).

## Convenções
- Português em código, comentários e logs.
- Não versionar: `.env`, `bot-auth.json`, `debug_bot_*.png`, `node_modules/` (já no `.gitignore`).
  `node_modules/` foi **destrackeado** na reestruturação (estava versionado por engano).
- Captura EXTENSÃO-ONLY: fonte única na aba do usuário (`content.js`); o bot headless
  segue no `server.js` porém dormente. URL do Meet **sem** `?hl=en`.
- CommonJS no servidor (`require`); ES modules no `frontend/`.
```
