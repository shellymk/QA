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
import { apiPost, getToken, setToken, clearToken, getEmail, setEmail, clearEmail } from '../lib/api';

interface AuthResposta {
  token: string;
  email: string;
}

interface AuthContextValue {
  token: string | null;
  email: string | null;
  autenticado: boolean;
  login: (email: string, senha: string) => Promise<void>;
  cadastrar: (email: string, senha: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setTokenState] = useState<string | null>(getToken());
  const [email, setEmailState] = useState<string | null>(getEmail());

  async function login(mail: string, senha: string) {
    const data = await apiPost<AuthResposta>('/api/login', { email: mail, password: senha });
    setToken(data.token); setTokenState(data.token);
    setEmail(data.email); setEmailState(data.email);
  }

  async function cadastrar(mail: string, senha: string) {
    const data = await apiPost<AuthResposta>('/api/register', { email: mail, password: senha });
    setToken(data.token); setTokenState(data.token);
    setEmail(data.email); setEmailState(data.email);
  }

  function logout() {
    clearToken(); setTokenState(null);
    clearEmail(); setEmailState(null);
  }

  return (
    <AuthContext.Provider value={{ token, email, autenticado: !!token, login, cadastrar, logout }}>
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
