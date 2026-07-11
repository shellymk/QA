// ============================================================
// Layout do painel (área logada): menu lateral fino + carinha do
// usuário embaixo. As páginas entram no <Outlet/> (react-router).
// Identidade "Violeta Sinal" — estilos em styles/painel.css.
// ============================================================

import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import '../styles/painel.css';

// classe 'active' quando a rota bate (NavLink cuida disso)
const cls = ({ isActive }: { isActive: boolean }) => (isActive ? 'active' : undefined);

export function Layout() {
  const { email, logout } = useAuth();
  const nome = (email || '').split('@')[0] || 'Usuário';
  const iniciais = (nome.slice(0, 2) || 'U').toUpperCase();

  return (
    <div className="painel-root">
      <div className="shell">
        <aside className="side">
          <div className="brand">
            <div className="mark"><span><i /><i /><i /><i /></span></div>
            <div className="name">Meet<b>AI</b></div>
          </div>

          <div className="nav-label">Painel</div>
          <nav className="nav">
            <NavLink to="/" end className={cls}><IcoDash /> Dashboard</NavLink>
            <NavLink to="/reunioes" className={cls}><IcoReunioes /> Reuniões</NavLink>
            <NavLink to="/analytics" className={cls}><IcoBarras /> Analytics</NavLink>
            <NavLink to="/resumo-ia" className={cls}><IcoIA /> Resumo IA <span className="tag">novo</span></NavLink>
          </nav>

          <div className="nav-label">Conta</div>
          <nav className="nav">
            <NavLink to="/configuracoes" className={cls}><IcoConfig /> Configurações</NavLink>
          </nav>

          <div className="spacer" />

          <div className="user">
            <div className="avatar">{iniciais}</div>
            <div className="who">
              <b>{nome}</b>
              <small>{email || 'não identificado'}</small>
            </div>
            <button className="exit" onClick={logout} title="Sair" aria-label="Sair da conta">
              <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 12H4M11 8l-4 4 4 4M15 4h4v16h-4" /></svg>
            </button>
          </div>
        </aside>

        <main className="main"><Outlet /></main>
      </div>
    </div>
  );
}

// ── ícones (inline, sem dependência externa) ──────────────
const IcoDash = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="9" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" /><rect x="14" y="12" width="7" height="9" rx="1.5" /><rect x="3" y="16" width="7" height="5" rx="1.5" /></svg>
);
const IcoReunioes = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="14" rx="2" /><path d="M8 21h8M12 18v3" /></svg>
);
const IcoBarras = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></svg>
);
const IcoIA = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 3v3M12 18v3M5 12H2M22 12h-3M6 6l2 2M16 16l2 2M18 6l-2 2M8 16l-2 2" /><circle cx="12" cy="12" r="3.4" /></svg>
);
const IcoConfig = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3" /><path d="M19 12a7 7 0 0 0-.1-1l2-1.5-2-3.4-2.3 1a7 7 0 0 0-1.7-1l-.3-2.5H9.4L9 5.6a7 7 0 0 0-1.7 1l-2.3-1-2 3.4 2 1.5a7 7 0 0 0 0 2l-2 1.5 2 3.4 2.3-1a7 7 0 0 0 1.7 1l.3 2.5h4.9l.3-2.5a7 7 0 0 0 1.7-1l2.3 1 2-3.4-2-1.5c.1-.3.1-.7.1-1Z" /></svg>
);
