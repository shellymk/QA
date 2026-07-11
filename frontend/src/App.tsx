// ============================================================
// App — rotas do painel.
// - /login e /cadastro: públicas (sem o Layout).
// - Demais rotas: protegidas e dentro do <Layout/> (menu lateral).
//   O Dashboard é a home; as outras abas ainda são placeholders.
// ============================================================

import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './auth/AuthContext';
import { ProtectedRoute } from './components/ProtectedRoute';
import { Layout } from './components/Layout';
import { Login } from './pages/Login';
import { Cadastro } from './pages/Cadastro';
import { Dashboard } from './pages/Dashboard';
import { Reunioes } from './pages/Reunioes';
import { ReuniaoDetalhe } from './pages/ReuniaoDetalhe';
import { Configuracoes } from './pages/Configuracoes';
import { EmConstrucao } from './pages/EmConstrucao';

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          {/* públicas */}
          <Route path="/login" element={<Login />} />
          <Route path="/cadastro" element={<Cadastro />} />

          {/* protegidas — dentro do Layout (menu lateral) */}
          <Route element={<ProtectedRoute><Layout /></ProtectedRoute>}>
            <Route path="/" element={<Dashboard />} />
            <Route path="/reuniao/:id" element={<ReuniaoDetalhe />} />
            <Route path="/reunioes" element={<Reunioes />} />
            <Route path="/analytics" element={<EmConstrucao emoji="📊" titulo="Analytics" descricao="Análises detalhadas por período e participante — em construção." />} />
            <Route path="/resumo-ia" element={<EmConstrucao emoji="✦" titulo="Resumo IA" descricao="Resumos automáticos, itens de ação e busca semântica com IA — em construção." />} />
            <Route path="/configuracoes" element={<Configuracoes />} />
          </Route>

          {/* rota desconhecida cai na home (que redireciona se não logado) */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
