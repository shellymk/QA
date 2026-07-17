// ============================================================
// Camada de acesso à API do MeetAI.
// Guarda o token JWT no localStorage e injeta no header das chamadas.
// ============================================================

// Em produção (Vercel) definimos VITE_API_URL apontando pro backend na Render.
// Em desenvolvimento, sem a variável, cai no localhost:3000 (backend local).
export const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

const TOKEN_KEY = 'meetai_token';
const EMAIL_KEY = 'meetai_email';

export const getToken = (): string | null => localStorage.getItem(TOKEN_KEY);
export const setToken = (t: string): void => localStorage.setItem(TOKEN_KEY, t);
export const clearToken = (): void => localStorage.removeItem(TOKEN_KEY);

// Email do usuário logado — guardado junto do token para a UI (a "carinha").
export const getEmail = (): string | null => localStorage.getItem(EMAIL_KEY);
export const setEmail = (e: string): void => localStorage.setItem(EMAIL_KEY, e);
export const clearEmail = (): void => localStorage.removeItem(EMAIL_KEY);

// fetch com o header Authorization. Em 401 (token expirado/ausente), limpa o
// token e sinaliza — quem chamar redireciona pro login.
// Erro de rede/servidor (fetch nem completou, ou 5xx). Separado do erro de
// AUTENTICAÇÃO de propósito: tratar os dois igual foi o que fez um 401 aparecer
// como "Servidor indisponível" e mandar a usuária caçar um problema na Render que
// não existia (bug de 2026-07-17).
export class ErroDeRede extends Error {}

export async function apiFetch(path: string, opts: RequestInit = {}): Promise<Response> {
  const token = getToken();
  const headers: Record<string, string> = { ...(opts.headers as Record<string, string>) };
  if (token) headers['Authorization'] = 'Bearer ' + token;

  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, { ...opts, headers });
  } catch {
    // fetch só lança em falha de REDE (offline, CORS, servidor fora, Render
    // acordando). Aqui "indisponível" é verdade — nos outros casos, não era.
    throw new ErroDeRede('Não foi possível falar com o servidor. Ele pode estar iniciando — tente de novo em alguns segundos.');
  }
  // 401 = problema de SESSÃO, sempre. A ressalva antiga ("só trata como expirada
  // se HAVIA token") existia para o /api/login, onde um 401 significava
  // "credenciais inválidas" — mas a migração pro Auth0 removeu /api/login e
  // /api/register (o login virou tela hospedada do Auth0). Sem essa rota, um 401
  // sem token não é mais "senha errada": é requisição sem credencial. Deixar
  // passar fazia a tela chamar isso de "Servidor indisponível" e esconder a
  // causa real (bug de 2026-07-17).
  if (res.status === 401) {
    clearToken();
    clearEmail();
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

// Upload de arquivo (áudio) — manda o corpo bruto com o Content-Type do arquivo.
// O Authorization é injetado pelo apiFetch. Usado no "Subir gravação".
export async function apiUpload<T = unknown>(path: string, file: File): Promise<T> {
  const res = await apiFetch(path, {
    method: 'POST',
    headers: { 'Content-Type': file.type || 'application/octet-stream' },
    body: file,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (data as { error?: string }).error;
    // Inclui o status HTTP quando o servidor não mandou uma mensagem clara
    // (ex.: 404 = rota nova sem reiniciar o servidor; 413 = arquivo grande demais).
    throw new Error(msg || `Falha ao enviar o áudio (HTTP ${res.status})`);
  }
  return data as T;
}

// URL do stream SSE com o token na querystring (EventSource não manda header).
export const eventsUrl = (): string =>
  `${API_URL}/api/events?token=${encodeURIComponent(getToken() || '')}`;
