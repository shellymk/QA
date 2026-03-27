# MeetAI — Correções Aplicadas

## O que foi corrigido

### ✅ Bug 1 — Bot não entrava automaticamente
**Causa:** O bot era chamado em dois lugares ao mesmo tempo (`content.js` e `background.js`), causando requisições duplicadas e conflito. Em alguns casos o servidor recebia o segundo pedido antes do primeiro terminar e ignorava o segundo (proteção anti-duplicata por URL, que foi adicionada no `server.js`).

**Correção:**
- A chamada ao bot foi **removida do `content.js`**.
- Agora existe **um único ponto de disparo**: o `background.js`, ao receber o evento `meetingStarted`.
- O `server.js` também ganhou proteção extra: verifica se já existe um bot ativo para aquela URL antes de criar um novo.

---

### ✅ Bug 2 — Bot sumia sozinho
**Causa:** A URL enviada ao bot continha `?hl=en`, o que forçava o Google Meet a abrir em inglês. Isso confundia os seletores do Playwright que esperavam textos em português (ex: `"Participar agora"` vs `"Join now"`), fazendo o bot falhar silenciosamente e se desconectar.

**Correção:**
- URL enviada ao bot agora é limpa: `https://meet.google.com/CÓDIGO` — sem parâmetros extras.
- O `botJoin` no `server.js` já suportava inglês nos seletores, mas o `?hl=en` causava comportamentos imprevisíveis no carregamento da página.

---

### ✅ Bug 3 — Checkbox "Ativar automaticamente" não funcionava
**Causa:** O `autoStart` era lido do `chrome.storage` dentro da função `onStart()` usando um callback assíncrono. Quando a reunião era detectada, o `onStart` era chamado antes do callback terminar de ler o valor, então o bot nunca era disparado.

**Correção:**
- O `autoStart` agora é lido **uma única vez ao carregar o script** (`content.js` inicializa `autoStartEnabled` na raiz).
- Um listener em `chrome.storage.onChanged` mantém o valor atualizado em tempo real.
- Quando `onStart()` é chamado, o valor já está disponível imediatamente — sem race condition.

---

### ✅ Bug 4 — Legendas em inglês
**Causa 1:** A URL com `?hl=en` (corrigida no Bug 2) forçava inglês na interface do Meet do bot.

**Causa 2:** A função `forcarPTBR()` no `content.js` tentava clicar no botão de idioma com um timeout fixo de 2s, que frequentemente não era suficiente. Se o botão não aparecesse, a função simplesmente desistia sem tentar de novo.

**Correção:**
- Criada a função `tentarForcarPTBR(tentativa)` com **retry automático** (até 8 tentativas, com backoff exponencial).
- Ao pressionar Escape sem encontrar a opção PT-BR, a função reagenda uma nova tentativa.
- O `content.js` usa essa nova função e o `server.js` (bot) já tinha retry implementado corretamente.

---

### ✅ Bug 5 — Painel web mostrava reunião como "ao vivo" mesmo após encerramento
**Causa:** O painel web verificava se a reunião estava ao vivo apenas checando se `finishedAt === null`. Se o servidor fosse reiniciado no meio de uma reunião, ou se a extensão parasse sem chamar `end-meeting`, a reunião ficaria eternamente como "ao vivo" no banco de dados.

**Correções:**
1. **`calcStatus(meeting)`** — nova função no servidor que determina o status corretamente: se `finishedAt` existe, é `'finished'`; se foi criada há mais de 8h sem ser finalizada, também é `'finished'`.
2. **Campo `status` retornado pela API** — `/api/meetings` e `/api/meeting/:id` agora incluem o campo `status` calculado. O painel deve usar esse campo ao invés de checar `finishedAt` diretamente.
3. **Auto-correção ao iniciar o servidor** — ao subir o `server.js`, ele automaticamente finaliza no banco todas as reuniões travadas (sem `finishedAt` e com mais de 8h).
4. **`/api/end-meeting` idempotente** — se chamado duas vezes, não duplica a duração; apenas reenvia o broadcast SSE.
5. **Heartbeat SSE reduzido de 25s para 15s** — conexões SSE morriam em alguns proxies/firewalls antes do próximo ping, fazendo o painel perder os eventos de fim de reunião.

---

## Como usar

### Primeira vez (login do bot)
```bash
cd server
node login-bot.js
```
Siga as instruções no terminal. Após o login, o arquivo `bot-auth.json` é gerado e o bot entra nas reuniões automaticamente nas próximas vezes.

### Iniciar o servidor
```bash
cd server
npm start
```

### Instalar a extensão
1. Abra `chrome://extensions`
2. Ative o **Modo desenvolvedor**
3. Clique em **Carregar sem compactação**
4. Selecione a pasta `extensao/`

### Usar
1. Entre em qualquer reunião do Google Meet
2. Se o checkbox **"Ativar automaticamente"** estiver marcado no popup, o bot entra e a gravação começa sozinhos — sem precisar abrir o popup nem clicar em nada.
3. As transcrições aparecem no popup e no painel web em `http://localhost:3000`.
