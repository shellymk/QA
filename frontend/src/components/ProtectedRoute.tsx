// ============================================================
// Rota protegida: se não estiver logado, redireciona pro /login.
// Envolve as páginas que exigem autenticação.
//
// Com o Auth0 há um estado intermediário (carregando): logo após voltar do
// redirect de login, o SDK ainda está trocando o "code" por um token. Nesse
// instante NÃO podemos mandar pro /login (senão pisca e desloga). Esperamos.
// ============================================================

import { Navigate } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useAuth } from '../auth/AuthContext';
import '../styles/auth.css';

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { autenticado, carregando } = useAuth();
  if (carregando) return <div className="carregando-auth">Carregando…</div>;
  if (!autenticado) return <Navigate to="/login" replace />;
  return <>{children}</>;
}
