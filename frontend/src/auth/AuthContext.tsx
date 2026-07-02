// ============================================================
// Contexto de autenticação.
// Guarda o token e expõe login/cadastro/logout para toda a árvore de
// componentes via o hook useAuth().
//
// Conceitos de React aqui:
// - createContext: cria um "canal" de dados global.
// - useState: estado reativo (quando muda, a tela re-renderiza).
// - useContext (dentro do hook useAuth): lê esse canal em qualquer componente.
// ============================================================

import { createContext, useContext, useState, type ReactNode } from 'react';
import { apiPost, getToken, setToken, clearToken } from '../lib/api';

interface AuthResposta {
  token: string;
  email: string;
}

interface AuthContextValue {
  token: string | null;
  autenticado: boolean;
  login: (email: string, senha: string) => Promise<void>;
  cadastrar: (email: string, senha: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setTokenState] = useState<string | null>(getToken());

  async function login(email: string, senha: string) {
    const data = await apiPost<AuthResposta>('/api/login', { email, password: senha });
    setToken(data.token);
    setTokenState(data.token);
  }

  async function cadastrar(email: string, senha: string) {
    const data = await apiPost<AuthResposta>('/api/register', { email, password: senha });
    setToken(data.token);
    setTokenState(data.token);
  }

  function logout() {
    clearToken();
    setTokenState(null);
  }

  return (
    <AuthContext.Provider value={{ token, autenticado: !!token, login, cadastrar, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

// Hook para consumir o contexto. Dá erro claro se usado fora do provider.
// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth precisa estar dentro de <AuthProvider>');
  return ctx;
}
