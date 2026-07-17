// ============================================================
// Contexto de autenticação — agora com Auth0 por baixo.
//
// Antes o login/cadastro batia direto no backend (/api/login, /api/register)
// com email+senha e o servidor assinava um JWT próprio. Migramos para o Auth0:
// o login/cadastro/Google/reset acontecem na tela hospedada do Auth0, e o
// backend só VALIDA o token que o Auth0 emite.
//
// Mantemos a MESMA interface useAuth() que o resto do painel já consome
// (Layout, ProtectedRoute, Login, Cadastro) — só o motor mudou.
//
// Ponte com o resto do sistema: o SincronizadorSessao grava o access token do
// Auth0 no localStorage (chaves meetai_token/meetai_email). Assim:
//   - api.ts continua lendo o token do localStorage (nada muda lá);
//   - a extensão (session-bridge.js) continua herdando o login pela mesma chave.
// ============================================================

import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { useAuth0 } from '@auth0/auth0-react';
import { setToken, clearToken, setEmail, clearEmail } from '../lib/api';

interface AuthContextValue {
  autenticado: boolean;
  carregando: boolean;                 // Auth0 processando (ex.: voltando do redirect)
  email: string | null;
  entrar: () => void;                  // login universal (email/senha + Google)
  entrarComGoogle: () => void;         // vai direto pra conexão Google
  cadastrar: () => void;               // login universal já na aba de cadastro
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const {
    isAuthenticated,
    isLoading,
    user,
    loginWithRedirect,
    logout: auth0Logout,
    getAccessTokenSilently,
  } = useAuth0();

  // Ponte Auth0 -> localStorage. Quando o usuário está logado, pega um access
  // token fresco e grava (junto do email) pra api.ts e a extensão reaproveitarem.
  // Ao deslogar, limpa. Roda sempre que o estado de login muda.
  useEffect(() => {
    let cancelado = false;
    async function sincronizar() {
      if (isAuthenticated) {
        try {
          const t = await getAccessTokenSilently();
          if (cancelado) return;
          setToken(t);
          if (user?.email) setEmail(user.email);
        } catch { /* falha ao renovar token — o 401 no api.ts trata */ }
      } else {
        clearToken();
        clearEmail();
      }
    }
    sincronizar();
    return () => { cancelado = true; };
  }, [isAuthenticated, user, getAccessTokenSilently]);

  function logout() {
    clearToken();
    clearEmail();
    auth0Logout({ logoutParams: { returnTo: window.location.origin } });
  }

  const value: AuthContextValue = {
    autenticado: isAuthenticated,
    carregando: isLoading,
    email: user?.email ?? null,
    entrar: () => loginWithRedirect(),
    entrarComGoogle: () => loginWithRedirect({ authorizationParams: { connection: 'google-oauth2' } }),
    cadastrar: () => loginWithRedirect({ authorizationParams: { screen_hint: 'signup' } }),
    logout,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// Hook para consumir o contexto. Dá erro claro se usado fora do provider.
// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth precisa estar dentro de <AuthProvider>');
  return ctx;
}
