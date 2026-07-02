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
  observa o DOM das legendas, extrai `{speaker, text}`, deduplica e envia deltas ao
  `background.js`. É o arquivo mais complexo e mais frágil (ver Problemas Conhecidos).
- `background.js` — service worker. Recebe mensagens do content, cria/finaliza a reunião
  no servidor (`/api/start-meeting`, `/api/end-meeting`), faz batch das transcrições
  (`/api/add-transcripts-batch`) e dispara o **bot** (`/api/bot/join`). É o **único**
  ponto que dispara o bot (não duplicar isso no content.js).
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
      → ativa legendas + força PT-BR + inicia MutationObserver
      → background: cria reunião no servidor + dispara bot (/api/bot/join)
  → APENAS o bot headless captura legendas (decisão BOT-ONLY):
      bot headless (server.js → escutarESalvar) → /api/add-transcripts-batch
      (content.js NÃO captura mais — só detecta reunião, controla e dispara o bot)
  → servidor salva no MongoDB (coleção `meetings`, array `transcripts`)
  → broadcast SSE → painel web atualiza em tempo real
Reunião termina → end-meeting → status vira 'finished'
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

## Onde está a captura de legendas (BOT-ONLY)
Fonte **única**: o bot headless em `server.js`. A extração de `{speaker, text}` depende
de **seletores CSS internos do Google Meet** (`.nMcdL`, `.zs7s8d`, `.ygicle`, `.iOzk7`,
`[jsname="dsyhDe"]`, etc.), que o Google **muda sem aviso**.
- `server.js` → `escutarESalvar()` → `page.evaluate(...)` → `getSpeakerAndText()`
  (extração), `processCaption()` (dedup/delta + descarta nós dentro de menu/config),
  `isUI()` + `ICON_NAMES` / `UI_PREFIXES` (filtro de UI).
- `ativarLegendas()` liga as legendas; `forcarPTBRBot()` força PT-BR **só via
  localStorage** (não abre menu — ver histórico de bugs abaixo).
- `extension/content.js` **NÃO captura mais** (funções de captura seguem no arquivo,
  porém inativas — nunca são chamadas). Ele só detecta a reunião, controla
  iniciar/parar, libera acesso e dispara o bot.

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
  antiga de rodar `content.js` **e** o bot capturando em paralelo. *Correção:* BOT-ONLY —
  captura do `content.js` desligada.
- **Re-emissão dentro do próprio bot.** *Causa raiz/como:* `escutarESalvar` rodava
  MutationObserver **e** `setInterval(500ms)` sobre os mesmos nós. *Correção:* mantido só
  o observer; o debounce por speaker (600ms) cuida das rajadas.

## Ainda em aberto (investigar em reunião real)
1. **Atribuição de speaker.** Quando o seletor de nome falha, cai em `'Participante'`.
   Validar `getSpeakerAndText` (bot) contra o DOM atual do Meet.
2. **Seletores desatualizados do Meet.** Se a captura zerar do nada, quase sempre o
   Google trocou as classes — inspecionar o DOM da legenda e atualizar em `server.js`.
3. **"Quebrando" / desconexão do bot.** Checar `debug_bot_entrada.png` /
   `debug_bot_erro.png` e a sessão expirada do bot (relogin em `botJoin`).

## Convenções
- Português em código, comentários e logs.
- Não versionar: `.env`, `bot-auth.json`, `debug_bot_*.png`, `node_modules/` (já no `.gitignore`).
  `node_modules/` foi **destrackeado** na reestruturação (estava versionado por engano).
- Anti-duplicata do bot: um único disparo em `background.js`; URL do Meet **sem** `?hl=en`.
- CommonJS no servidor (`require`); ES modules no `frontend/`.
```
