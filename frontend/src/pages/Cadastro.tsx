// ============================================================
// Tela de Cadastro (React). Cria a conta e já entra logado.
// Valida no cliente: senha >= 8 e confirmação igual.
// ============================================================

import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import '../styles/auth.css';

export function Cadastro() {
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [senha2, setSenha2] = useState('');
  const [erro, setErro] = useState('');
  const [carregando, setCarregando] = useState(false);
  const { cadastrar } = useAuth();
  const navigate = useNavigate();

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setErro('');
    if (senha.length < 8) { setErro('❌ A senha precisa ter ao menos 8 caracteres.'); return; }
    if (senha !== senha2) { setErro('❌ As senhas não conferem.'); return; }
    setCarregando(true);
    try {
      await cadastrar(email, senha);
      navigate('/');
    } catch (err) {
      setErro('❌ ' + (err as Error).message);
    } finally {
      setCarregando(false);
    }
  }

  return (
    <div className="auth-split">
      <section className="auth-panel">
        <div className="auth-box">
          <h1 className="auth-title">Crie sua conta <span className="dot" /></h1>

          <form onSubmit={onSubmit}>
            <label className="campo">
              <span>Email</span>
              <input type="email" autoComplete="username" placeholder="Insira seu email"
                value={email} onChange={(e) => setEmail(e.target.value)} required />
            </label>

            <label className="campo">
              <span>Senha</span>
              <input type="password" autoComplete="new-password" placeholder="Ao menos 8 caracteres"
                value={senha} onChange={(e) => setSenha(e.target.value)} required />
            </label>

            <label className="campo">
              <span>Confirmar senha</span>
              <input type="password" autoComplete="new-password" placeholder="Repita a senha"
                value={senha2} onChange={(e) => setSenha2(e.target.value)} required />
            </label>

            <button type="submit" className="btn-grad" disabled={carregando}>
              {carregando ? 'Criando...' : 'Cadastrar'}
            </button>

            <div className="erro">{erro}</div>
          </form>

          <Link to="/login" className="link-under">Já tenho uma conta</Link>
        </div>
      </section>

      <aside className="auth-visual">
        <div className="visual-content">
          <div className="visual-logo">🎙️</div>
          <h2>Meet<span>AI</span></h2>
          <p>Crie sua conta e comece a transcrever suas reuniões automaticamente.</p>
        </div>
      </aside>
    </div>
  );
}
