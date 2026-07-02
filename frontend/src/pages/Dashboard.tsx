// ============================================================
// Dashboard — busca /api/analytics e mostra os cards.
//
// Conceitos de React:
// - useEffect: roda um efeito colateral (buscar dados) quando a tela monta.
// - useState com 3 estados: carregando / erro / dados (padrão comum).
// ============================================================

import { useEffect, useState } from 'react';
import { apiFetch } from '../lib/api';
import type { Analytics } from '../lib/types';
import { useAuth } from '../auth/AuthContext';

export function Dashboard() {
  const [dados, setDados] = useState<Analytics | null>(null);
  const [erro, setErro] = useState('');
  const { logout } = useAuth();

  useEffect(() => {
    apiFetch('/api/analytics')
      .then((res) => {
        if (!res.ok) throw new Error('Servidor indisponível');
        return res.json();
      })
      .then((d: Analytics) => setDados(d))
      .catch((e: Error) => setErro(e.message));
  }, []); // [] = roda uma vez, quando a tela aparece

  return (
    <div style={estilos.pagina}>
      <header style={estilos.topo}>
        <h1 style={estilos.titulo}>Meet<span style={{ color: '#8B5CF6' }}>AI</span> — Dashboard</h1>
        <button style={estilos.sair} onClick={logout}>Sair</button>
      </header>

      {erro && <div style={estilos.erro}>❌ {erro}</div>}

      {!dados && !erro && <p style={{ color: '#9CA3AF' }}>Carregando…</p>}

      {dados && (
        <div style={estilos.cards}>
          <Card titulo="Reuniões"      valor={dados.meetings}     icone="📹" />
          <Card titulo="Horas gravadas" valor={`${dados.hours}h`}  icone="⏱" />
          <Card titulo="Participantes"  valor={dados.users}        icone="👥" />
          <Card titulo="Transcrições"   valor={dados.transcripts}  icone="📝" />
        </div>
      )}
    </div>
  );
}

function Card({ titulo, valor, icone }: { titulo: string; valor: number | string; icone: string }) {
  return (
    <div style={estilos.card}>
      <div style={{ fontSize: 28 }}>{icone}</div>
      <div style={estilos.cardValor}>{valor}</div>
      <div style={estilos.cardTitulo}>{titulo}</div>
    </div>
  );
}

// Estilos inline simples (depois portamos o css/style.css completo).
const estilos: Record<string, React.CSSProperties> = {
  pagina: { minHeight: '100vh', background: '#0B0B12', color: '#E5E7EB', padding: '32px 40px', fontFamily: 'system-ui, "Segoe UI", sans-serif' },
  topo: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 32 },
  titulo: { fontSize: 24, fontWeight: 700, margin: 0 },
  sair: { background: '#1E1E2E', color: '#E5E7EB', border: '1px solid #24243A', borderRadius: 10, padding: '8px 16px', cursor: 'pointer' },
  erro: { color: '#FCA5A5', background: '#2a0a0a', padding: 12, borderRadius: 10 },
  cards: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 },
  card: { background: '#12121C', border: '1px solid #24243A', borderRadius: 16, padding: 24, textAlign: 'center' },
  cardValor: { fontSize: 34, fontWeight: 800, margin: '10px 0 4px' },
  cardTitulo: { color: '#8B90A0', fontSize: 14 },
};
