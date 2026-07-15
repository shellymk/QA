/*
================================================================
MEETAI — session-bridge.js
Ponte de sessão PAINEL -> EXTENSÃO.

Roda na aba do painel web (onde o usuário faz login). O painel guarda o JWT
no localStorage (chaves 'meetai_token' / 'meetai_email'). Este script lê esse
token e entrega ao background da extensão, que passa a autenticar as chamadas
com Authorization: Bearer <token> — SEM o usuário colar nada.

Assim o login é feito UMA vez no painel (que já existe) e a extensão reaproveita
a mesma sessão. Quando o token expira (12h), basta reabrir/logar no painel de novo.
================================================================
*/
(() => {
  const TOKEN_KEY = 'meetai_token';
  const EMAIL_KEY = 'meetai_email';

  let ultimoToken = undefined; // guarda o último valor enviado (evita spam)

  function lerEEnviar() {
    let token = null, email = null;
    try {
      token = localStorage.getItem(TOKEN_KEY);
      email = localStorage.getItem(EMAIL_KEY);
    } catch (_) { /* localStorage bloqueado — ignora */ }

    // Só manda quando muda (login, logout ou troca de conta).
    if (token === ultimoToken) return;
    ultimoToken = token;

    try {
      chrome.runtime.sendMessage({ action: 'painelToken', token, email });
    } catch (_) { /* extensão recarregando — tenta de novo no próximo tick */ }
  }

  // 1) Assim que a página do painel carrega.
  lerEEnviar();

  // 2) Mudanças vindas de OUTRA aba do painel (o evento 'storage' não dispara
  //    na mesma aba que alterou — por isso o polling abaixo também).
  window.addEventListener('storage', (e) => {
    if (e.key === TOKEN_KEY || e.key === null) lerEEnviar();
  });

  // 3) Polling leve: pega o login/logout feito NESTA mesma aba (após o load).
  setInterval(lerEEnviar, 2000);

  // 4) Ao voltar o foco pra aba (ex.: logou noutro lugar), re-sincroniza.
  window.addEventListener('focus', lerEEnviar);
})();
