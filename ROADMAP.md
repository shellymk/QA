# MeetAI — Proposta / Roadmap

Visão do produto e funcionalidades desejadas. Documento vivo — atualizar conforme evolui.

## Visão
Um transcritor de reuniões do Google Meet **potente e multiusuário**: cada pessoa tem seu
próprio painel com suas próprias reuniões, transcrição de alta qualidade que **separa quem
falou** (inclusive a própria pessoa), busca/filtros por data, e recursos de IA para resumir
e melhorar processos.

---

## Estado atual (o que já existe)
- **Autenticação**: login/cadastro por email (JWT+bcrypt) + API key p/ extensão/bot. (Migrando para **Auth0**.)
- **Captura**: bot headless (Playwright) lê as **legendas do Google Meet** e salva no MongoDB. Speaker vem do **rótulo do Meet** (não é análise de áudio).
- **Painel**: em migração para **React + TypeScript**. Hoje só tem o **Dashboard** (cards de totais).
- **Reuniões NÃO são separadas por usuário** — a coleção `meetings` não tem "dono".

---

## Funcionalidades desejadas

### 1. Painel por usuário (multiusuário) 🔒
Cada usuário vê **só as reuniões dele**.
- Adicionar `ownerId` (ou `ownerEmail`) em cada reunião.
- Filtrar `/api/meetings`, `/api/meeting/:id`, `/api/analytics` pelo dono (do token).
- **Decisão em aberto**: o **bot** cria a reunião via API key (não sabe quem é o usuário).
  A extensão (que sabe quem está logado) precisa **passar o dono** ao disparar o bot.

### 2. Transcrição potente — reconhecer vozes sem embaralhar 🎙️
Objetivo: identificar **a sua fala** e a **dos outros**, sem misturar. Hoje o speaker vem do
rótulo do Meet e cai em "Participante" quando falha. Há dois caminhos (é uma decisão grande):

- **Caminho A — continuar lendo as legendas do Meet** (atual)
  - ✅ simples, sem custo, sem processar áudio.
  - ❌ atribuição de quem falou depende do que o Meet mostra; quebra fácil (seletores/CSS do Google).
- **Caminho B — capturar o ÁUDIO e usar STT + diarização** (transcrição de verdade)
  - Serviços: Deepgram, AssemblyAI, Whisper (+ pyannote), Google Speech-to-Text.
  - ✅ **separação real de quem falou** (diarização), qualidade muito maior, robusto.
  - ❌ mais esforço, tem **custo** (API), precisa capturar o áudio da reunião.
  - "Reconhecer especificamente a MINHA voz" = *speaker identification* (precisa de amostra/enrollment);
    diarização separa "voz 1/2/3", identificação dá nome a cada uma.

> **Recomendação**: para "reconhecer e não embaralhar" de verdade, o **Caminho B** é o correto.
> O A sempre vai ser limitado ao que o Google entrega.

### 3. Bug atual (prioridade): não está capturando nem a própria voz 🐞
Sintoma: transcrição não pega a fala da usuária. Causas prováveis (investigar em reunião real):
- Bot não entrou na sala (sessão `bot-auth.json` expirada — problema de relogin em aberto).
- Legendas não ativadas / seletores CSS do Meet mudaram (`server.js` → `getSpeakerAndText`).
- Precisa checar `debug_bot_*.png`.

### 4. Lista de reuniões com data, filtros e busca 📅
- Agrupar reuniões **por data**.
- Filtros: intervalo de datas, status (ao vivo/finalizada), participante.
- Busca por título/participante/conteúdo da transcrição.
- (A tela `frontend-legacy/pages/meetings.html` já tem parte disso — portar p/ React e melhorar.)

### 5. IA para melhorar processos 🤖
Usando um LLM (ex.: **API da Claude**):
- **Resumo** automático da reunião.
- **Itens de ação** / decisões extraídos.
- **Busca semântica** ("em qual reunião falamos sobre X?").
- Sugestões de melhoria de processo a partir do histórico.

---

## Telas do painel (React) a construir/portar
- [x] Login / Cadastro
- [x] Dashboard (cards)
- [ ] Reuniões (lista + data + filtros + busca)
- [ ] Transcrição (visualização + busca + export) — com bom destaque de speaker
- [ ] Analytics detalhado
- [ ] Configurações
- [ ] (novo) Resumo/IA por reunião

---

## Ordem sugerida
1. **Consertar a captura** (bug #3) — sem transcrição, nada mais importa. Precisa de reunião real.
2. **Painel por usuário** (#1) — decidir como a extensão passa o dono; alinhar com Auth0.
3. **Portar telas** (#4) — reuniões com data/filtros/busca.
4. **Decidir Caminho A vs B** da transcrição (#2) — se for B, é uma frente dedicada.
5. **IA** (#5) — resumo/ações/busca semântica.
