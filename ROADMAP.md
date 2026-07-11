# MeetAI — Proposta / Roadmap

Visão do produto e funcionalidades desejadas. Documento vivo — atualizar conforme evolui.

## Visão
Um transcritor de reuniões do Google Meet **potente e multiusuário**: cada pessoa tem seu
próprio painel com suas próprias reuniões, transcrição de alta qualidade que **separa quem
falou** (inclusive a própria pessoa), busca/filtros por data, e recursos de IA para resumir
e melhorar processos.

---

## Estado atual (o que já existe)
- **Autenticação**: login/cadastro por email (JWT+bcrypt) + API key p/ extensão. (Migrando para **Auth0**.)
- **Captura**: **EXTENSÃO-ONLY** (desde 2026-07-02) — a extensão lê as **legendas do Google Meet**
  na **própria aba do usuário** e salva no MongoDB. Speaker vem do **rótulo do Meet** (não é
  análise de áudio). *(O bot headless Playwright foi aposentado — código dormente no servidor.)*
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

> **Requisito confirmado pela usuária (2026-07-02, ditado na própria transcrição):**
> múltiplas pessoas falando **rápido e por cima uma da outra**, e a transcrição tem que
> **identificar cada uma sem embaralhar**. Isso o Caminho A (legendas do Meet) NÃO faz —
> só o **Caminho B (áudio + STT + diarização)** entrega. Além disso ela prefere **processar
> no background e mostrar a transcrição/resumo só quando a reunião ACABAR** (não focar no ao vivo).

### 3. Bug "não capturava nem a própria voz" 🐞 → endereçado pela migração EXTENSÃO-ONLY
Sintoma: transcrição não pegava a fala da usuária. **Causa raiz confirmada (2026-07-02):** o
bot headless não entrava na sala — conta-robô com sessão `bot-auth.json` expirada (~96 dias)
+ reuniões exigindo admissão do bot (prints `debug_bot_*.png`). **Correção:** migrado para
captura na própria aba do usuário (extensão), eliminando a conta-robô. **Falta validar em
reunião real** (recarregar a extensão e confirmar que pega a própria voz).

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
Identidade visual do painel: **"Violeta Sinal"** (dark, espectro de voz índigo→violeta→fúcsia;
menu lateral + carinha do usuário). Shell em `components/Layout.tsx` + `styles/painel.css`.
- [x] Login / Cadastro
- [x] Dashboard (identidade Violeta Sinal, dados reais + estados zerados, menu lateral)
- [ ] Reuniões (lista + data + filtros + busca)
- [~] Reuniões — CARDS por plataforma (Google Meet, Gravações enviadas; Discord etc. no futuro) +
  abrir/ler transcrição COM linha do tempo + LIXEIRA (soft-delete: "Mover pra lixeira"; exclusão
  permanente em Configurações → Lixeira; banco só limpa no permanente) FEITO. Falta (#4): filtros, busca, export.
- [x] Configurações — Lixeira (restaurar / deletar permanentemente) FEITO.
- **Etapa 5 — Gravação & player FEITO (código):** grava vídeo+áudio da aba (tabCapture), guarda no servidor
  (`backend/recordings/`), player sincronizado no modal (clicar fala → seek). Falta o teste real no Chrome.
- [~] Transcrição — "Subir gravação" FEITO (upload de áudio → AssemblyAI diariza → falas por
  Pessoa A/B/C, marca baixa confiança) + leitura da transcrição por reunião FEITO.
  Etapa 3 (captura ao vivo híbrida) = código feito, falta teste real da usuária. Falta: busca e export.
- [ ] Analytics detalhado
- [ ] Configurações
- [ ] (novo) Resumo/IA por reunião

---

## Ordem sugerida
1. **Validar a captura EXTENSÃO-ONLY** (bug #3, já migrado) — testar em reunião real: recarregar
   a extensão e confirmar que pega a própria voz. Sem transcrição, nada mais importa.
2. **Painel por usuário** (#1) — a extensão autentica pelo **login** do usuário (some a chave
   colada) e marca a reunião com o dono. Usuário final NUNCA cola chave. Alinhar com Auth0.
3. **Portar telas** (#4) — reuniões com data/filtros/busca.
4. **Decidir Caminho A vs B** da transcrição (#2) — se for B, é uma frente dedicada.
5. **IA** (#5) — resumo/ações/busca semântica.
