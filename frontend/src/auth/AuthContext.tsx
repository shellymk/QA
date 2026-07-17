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

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useAuth0 } from '@auth0/auth0-react';
import { setToken, clearToken, setEmail, clearEmail } from '../lib/api';

interface AuthContextValue {
  autenticado: boolean;
  carregando: boolean;                 // Auth0 processando (ex.: voltando do redirect)
  sessaoPronta: boolean;               // token já gravado no localStorage?
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

  // sessaoPronta: o token JÁ está gravado no localStorage. É diferente de
  // "autenticado" — o Auth0 sabe QUEM você é (isAuthenticated) um instante ANTES
  // de o access token estar em mãos (getAccessTokenSilently é assíncrono). Quem
  // depende do token (api.ts, e a extensão via session-bridge) precisa esperar
  // ESTE sinal, não o isAuthenticated. Ver ProtectedRoute.
  const [sessaoPronta, setSessaoPronta] = useState(false);

  // Ponte Auth0 -> localStorage. Quando o usuário está logado, pega um access
  // token fresco e grava (junto do email) pra api.ts e a extensão reaproveitarem.
  //
  // CUIDADO AO MEXER AQUI (bug de 2026-07-17: reuniões perdidas em silêncio).
  // Este efeito NÃO pode limpar o token enquanto o Auth0 está carregando: o SDK
  // começa com isAuthenticated=false e só depois resolve a sessão. O código
  // antigo tinha um `else { clearToken() }` sem checar isLoading, então TODO boot
  // do painel apagava o token — e a extensão, que copia essa mesma chave pelo
  // session-bridge, herdava vazio e perdia a gravação inteira com 401.
  // Só limpamos quando o Auth0 CONFIRMA que não há sessão (isLoading === false).
  useEffect(() => {
    let cancelado = false;
    async function sincronizar() {
      if (isLoading) return;              // ainda resolvendo — não toca no token

      if (isAuthenticated) {
        try {
          const t = await getAccessTokenSilently();
          if (cancelado) return;
          setToken(t);
          if (user?.email) setEmail(user.email);
          setSessaoPronta(true);
        } catch {
          // Não conseguiu token (refresh expirado, audience errada). Aí sim a
          // sessão não serve: limpa e libera a UI pra reagir (401 → login).
          if (cancelado) return;
          clearToken();
          clearEmail();
          setSessaoPronta(true);
        }
      } else {
        clearToken();
        clearEmail();
        setSessaoPronta(true);           // confirmado: sem sessão. Pode seguir.
      }
    }
    sincronizar();
    return () => { cancelado = true; };
  }, [isLoading, isAuthenticated, user, getAccessTokenSilently]);

  function logout() {
    clearToken();
    clearEmail();
    auth0Logout({ logoutParams: { returnTo: window.location.origin } });
  }

  const value: AuthContextValue = {
    autenticado: isAuthenticated,
    carregando: isLoading,
    sessaoPronta,
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
