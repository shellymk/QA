// ============================================================
// Camada de acesso à API do MeetAI.
// Guarda o token JWT no localStorage e injeta no header das chamadas.
// ============================================================

export const API_URL = 'http://localhost:3000';

const TOKEN_KEY = 'meetai_token';

export const getToken = (): string | null => localStorage.getItem(TOKEN_KEY);
export const setToken = (t: string): void => localStorage.setItem(TOKEN_KEY, t);
export const clearToken = (): void => localStorage.removeItem(TOKEN_KEY);

// fetch com o header Authorization. Em 401 (token expirado/ausente), limpa o
// token e sinaliza — quem chamar redireciona pro login.
export async function apiFetch(path: string, opts: RequestInit = {}): Promise<Response> {
  const token = getToken();
  const headers: Record<string, string> = { ...(opts.headers as Record<string, string>) };
  if (token) headers['Authorization'] = 'Bearer ' + token;

  const res = await fetch(`${API_URL}${path}`, { ...opts, headers });
  if (res.status === 401) {
    clearToken();
    throw new Error('Sessão expirada — faça login novamente');
  }
  return res;
}

// Helper específico para POST de JSON (usado em login/cadastro/etc.).
export async function apiPost<T = unknown>(path: string, body: unknown): Promise<T> {
  const res = await apiFetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error || 'Erro na requisição');
  return data as T;
}

// URL do stream SSE com o token na querystring (EventSource não manda header).
export const eventsUrl = (): string =>
  `${API_URL}/api/events?token=${encodeURIComponent(getToken() || '')}`;
