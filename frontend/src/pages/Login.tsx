// ============================================================
// Tela de Login (React) — mesmo design da versão anterior (styles/auth.css).
//
// Mudou o motor: o formulário de email/senha agora vive na tela hospedada do
// Auth0 (Universal Login), que também traz o "Entrar com Google", a
// verificação de email e o "esqueci a senha". Aqui ficam só os botões que
// levam pra lá — nada de coletar senha nesta página.
// ============================================================

import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import '../styles/auth.css';

export function Login() {
  const { entrar, entrarComGoogle } = useAuth();

  return (
    <div className="auth-split">
      <section className="auth-panel">
        <div className="auth-box">
          <h1 className="auth-title">Faça seu login <span className="dot" /></h1>

          <p className="auth-sub">
            Entre com seu email e senha ou com sua conta Google. A recuperação de
            senha e a confirmação de email acontecem com segurança pelo Auth0.
          </p>

          <button type="button" className="btn-grad" onClick={entrar}>
            Entrar com email
          </button>

          <button type="button" className="btn-google" onClick={entrarComGoogle}>
            <GoogleIcon /> Entrar com Google
          </button>

          <Link to="/cadastro" className="link-under">Ainda não tenho uma conta</Link>
        </div>
      </section>

      <aside className="auth-visual">
        <div className="visual-content">
          <div className="visual-logo">🎙️</div>
          <h2>Meet<span>AI</span></h2>
          <p>Transcrição automática das suas reuniões do Google Meet, em tempo real.</p>
        </div>
      </aside>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg viewBox="0 0 48 48" width="18" height="18">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.7-6.1 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.6 6.1 29.6 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.3-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 16 19 13 24 13c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.6 6.1 29.6 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.5 0 10.5-2.1 14.3-5.5l-6.6-5.6C29.7 34.6 27 35.6 24 35.6c-5.2 0-9.6-3.3-11.2-8l-6.6 5.1C9.6 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.3 4.2-4.2 5.5l6.6 5.6C41.9 36 44 30.5 44 24c0-1.3-.1-2.3-.4-3.5z" />
    </svg>
  );
}
