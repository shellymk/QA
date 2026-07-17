// ============================================================
// Rota protegida: se não estiver logado, redireciona pro /login.
// Envolve as páginas que exigem autenticação.
//
// Com o Auth0 há um estado intermediário (carregando): logo após voltar do
// redirect de login, o SDK ainda está trocando o "code" por um token. Nesse
// instante NÃO podemos mandar pro /login (senão pisca e desloga). Esperamos.
//
// E esperamos TAMBÉM o `sessaoPronta` (bug de 2026-07-17): o `carregando` do
// Auth0 acaba quando ele sabe QUEM é o usuário, mas o access token chega depois
// (é assíncrono). Nessa fresta a tela montava e já disparava as chamadas de API
// sem token → 401 → o painel exibia "Servidor indisponível" (mentira: o servidor
// estava de pé, faltava o token). Segurar aqui fecha a corrida na origem.
// ============================================================

import { Navigate } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useAuth } from '../auth/AuthContext';
import '../styles/auth.css';

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { autenticado, carregando, sessaoPronta } = useAuth();
  if (carregando || !sessaoPronta) return <div className="carregando-auth">Carregando…</div>;
  if (!autenticado) return <Navigate to="/login" replace />;
  return <>{children}</>;
}
