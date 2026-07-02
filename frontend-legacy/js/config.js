/*
========================================
CONFIGURAÇÃO CENTRAL DA WEB
========================================
Altere API_URL para a URL do seu servidor quando estiver em produção.
Exemplo: "https://api.seusite.com"
*/

export const API_URL = 'http://localhost:3000';

/*
========================================
AUTENTICAÇÃO (JWT) — helpers usados por todas as páginas
========================================
O token é guardado no localStorage após o login e enviado no header
Authorization de toda chamada à API. Se a API responder 401 (token expirado
ou ausente), o usuário é mandado de volta pro login.
*/
const TOKEN_KEY = 'meetai_token';

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function logout() {
  localStorage.removeItem(TOKEN_KEY);
  location.href = '/login.html';
}

// Redireciona pro login se não houver token. Chame no topo de cada página.
export function requireAuth() {
  if (!getToken()) { location.href = '/login.html'; return false; }
  return true;
}

// fetch com o header Authorization; em 401, desloga e redireciona.
export async function authFetch(url, opts = {}) {
  const token = getToken();
  const headers = { ...(opts.headers || {}) };
  if (token) headers['Authorization'] = 'Bearer ' + token;
  const res = await fetch(url, { ...opts, headers });
  if (res.status === 401) { logout(); throw new Error('Sessão expirada — faça login novamente'); }
  return res;
}

// URL do SSE com o token na querystring (EventSource não permite headers).
export function eventsUrl() {
  return `${API_URL}/api/events?token=${encodeURIComponent(getToken() || '')}`;
}
