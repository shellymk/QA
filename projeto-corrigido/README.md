# MeetAI Transcriber

Extensão Chrome para transcrição automática de reuniões do Google Meet, com painel web para visualizar as transcrições e analytics.

---

## 📁 Estrutura do Projeto

```
Projeto-Transcricao/
├── extensao/          ← Extensão Chrome
│   ├── manifest.json
│   ├── background.js
│   ├── content.js
│   ├── popup.html
│   ├── popup.js
│   └── style.css
│
├── server/            ← Servidor Node.js + MongoDB
│   ├── server.js
│   ├── .env.example
│   └── package.json
│
└── web/               ← Painel web
    ├── index.html
    ├── css/style.css
    ├── js/config.js   ← URL da API fica aqui
    ├── components/
    └── pages/
```

---

## 🚀 Como configurar

### 1. Servidor

```bash
cd server
npm install
cp .env.example .env
# Edite o .env com sua URI do MongoDB Atlas
npm start
```

O servidor roda em `http://localhost:3000`

### 2. Extensão Chrome

1. Abra o Chrome e acesse `chrome://extensions`
2. Ative o **Modo do desenvolvedor** (canto superior direito)
3. Clique em **Carregar sem compactação**
4. Selecione a pasta `extensao/`
5. A extensão aparecerá na barra do Chrome

### 3. Painel Web

Abra o arquivo `web/index.html` em um servidor local (ex: Live Server no VS Code) ou hospede em qualquer serviço estático.

> **Importante:** se o servidor não estiver em `localhost:3000`, edite `web/js/config.js`:
> ```js
> export const API_URL = 'https://sua-api.com';
> ```

---

## ⚙️ Como funciona

1. Você entra em uma reunião no Google Meet
2. O `content.js` detecta que a reunião começou e captura as **legendas automáticas** do Meet
3. As legendas são enviadas ao `background.js` que as salva no servidor via API
4. O servidor salva tudo no MongoDB Atlas
5. O painel web exibe as reuniões, transcrições e analytics

> **Dica:** Ative as legendas automáticas no Google Meet (`CC` no rodapé) para melhor resultado.

---

## 📌 Endpoints da API

| Método | Rota | Descrição |
|--------|------|-----------|
| POST | `/api/start-meeting` | Inicia uma nova reunião |
| POST | `/api/add-transcript` | Adiciona uma fala |
| POST | `/api/update-participants` | Atualiza participantes |
| POST | `/api/end-meeting` | Finaliza a reunião |
| GET | `/api/meetings` | Lista reuniões (paginado) |
| GET | `/api/meeting/:id` | Busca reunião com transcrições |
| GET | `/api/analytics` | Dados de analytics |
| DELETE | `/api/meeting/:id` | Remove uma reunião |
| GET | `/api/health` | Health check |

---

## ⚠️ Observações importantes

- As legendas do Google Meet precisam estar **ativadas** para a captura funcionar (clique em `CC` na barra inferior do Meet)
- O servidor precisa estar **rodando** antes de iniciar uma reunião
- As credenciais do MongoDB devem ficar sempre no arquivo `.env`, nunca no código
