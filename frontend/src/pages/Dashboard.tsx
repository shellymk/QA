// ============================================================
// Dashboard — identidade "Violeta Sinal".
// TUDO com dados REAIS: /api/analytics (tiles + atividade) e
// /api/meetings (reuniões recentes). Sem números inventados —
// quando não há dados, mostra estados zerados/vazios corretos.
// ============================================================

import { useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../lib/api';
import type { Analytics, Meeting } from '../lib/types';
import { Modal } from '../components/Modal';
import { PainelTranscricao } from '../components/PainelTranscricao';

// ── helpers ────────────────────────────────────────────────
function saudacao(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Bom dia';
  if (h < 18) return 'Boa tarde';
  return 'Boa noite';
}

function dataHoje(): string {
  return new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
}

// Últimos 7 dias (mais antigo → hoje), com a chave no MESMO formato do byDay
// do servidor (toLocaleDateString('pt-BR') = "dd/mm/aaaa").
function ultimos7Dias(): { chave: string; label: string }[] {
  const out: { chave: string; label: string }[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const label = d.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '');
    out.push({ chave: d.toLocaleDateString('pt-BR'), label: label.charAt(0).toUpperCase() + label.slice(1) });
  }
  return out;
}

function tempoRelativo(iso: string): string {
  const d = new Date(iso);
  const diffMin = Math.round((Date.now() - d.getTime()) / 60000);
  if (diffMin < 1) return 'agora';
  if (diffMin < 60) return `há ${diffMin} min`;
  const diffH = Math.round(diffMin / 60);
  if (diffH < 24) return `há ${diffH} h`;
  const diffD = Math.round(diffH / 24);
  if (diffD === 1) return 'ontem';
  if (diffD < 7) return `há ${diffD} dias`;
  return d.toLocaleDateString('pt-BR');
}

function fmtDuracao(min: number | null): string {
  if (!min || min < 1) return '';
  const m = Math.round(min);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}`;
}

const CORES = ['#6366F1', '#D946EF', '#8B5CF6', '#DB2777', '#F59E0B'];

export function Dashboard() {
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [meetings, setMeetings] = useState<Meeting[] | null>(null);
  const [erro, setErro] = useState('');
  const [filtro, setFiltro] = useState('');
  const [modalId, setModalId] = useState<string | null>(null);
  const [modalMin, setModalMin] = useState(false);

  useEffect(() => {
    let vivo = true;
    Promise.all([
      apiFetch('/api/analytics').then((r) => { if (!r.ok) throw new Error('Servidor indisponível'); return r.json(); }),
      apiFetch('/api/meetings?limit=6').then((r) => { if (!r.ok) throw new Error('Servidor indisponível'); return r.json(); }),
    ])
      .then(([a, m]: [Analytics, { meetings: Meeting[] }]) => {
        if (!vivo) return;
        setAnalytics(a);
        setMeetings(m.meetings || []);
      })
      .catch((e: Error) => { if (vivo) setErro(e.message); });
    return () => { vivo = false; };
  }, []);

  const dias = useMemo(ultimos7Dias, []);
  const maxDia = useMemo(() => {
    if (!analytics) return 0;
    return Math.max(1, ...dias.map((d) => analytics.byDay[d.chave] || 0));
  }, [analytics, dias]);
  const totalSemana = useMemo(
    () => (analytics ? dias.reduce((s, d) => s + (analytics.byDay[d.chave] || 0), 0) : 0),
    [analytics, dias],
  );

  const aoVivo = meetings?.filter((m) => m.status === 'live').length || 0;

  const listaFiltrada = useMemo(() => {
    if (!meetings) return [];
    const f = filtro.trim().toLowerCase();
    if (!f) return meetings;
    return meetings.filter(
      (m) => (m.title || '').toLowerCase().includes(f) || (m.meetingCode || '').toLowerCase().includes(f),
    );
  }, [meetings, filtro]);

  const carregando = !analytics && !meetings && !erro;

  return (
    <>
      {/* topbar */}
      <div className="topbar">
        <div className="h">
          <h1>{saudacao()}, seja bem-vindo 👋</h1>
          <div className="sub">
            {dataHoje().charAt(0).toUpperCase() + dataHoje().slice(1)}
            {aoVivo > 0 ? ` · ${aoVivo} reunião${aoVivo > 1 ? 'ões' : ''} ao vivo agora` : ''}
          </div>
        </div>
        <label className="search">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4-4" /></svg>
          <input placeholder="Buscar reunião…" value={filtro} onChange={(e) => setFiltro(e.target.value)} />
        </label>
        <a className="btn" href="https://meet.google.com/new" target="_blank" rel="noopener noreferrer">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M12 5v14M5 12h14" /></svg>
          Nova reunião
        </a>
      </div>

      {erro && <div className="banner-erro">⚠️ {erro}. Confira se o servidor está rodando em <b>localhost:3000</b>.</div>}
      {carregando && <div className="skeleton">Carregando dados…</div>}

      {/* tiles — valores reais */}
      {analytics && (
        <div className="tiles">
          <Tile cap="Reuniões" icone={<IcoCam />} valor={analytics.meetings.toLocaleString('pt-BR')}
            foot={totalSemana > 0 ? `▲ ${totalSemana} nos últimos 7 dias` : 'nenhuma nos últimos 7 dias'} up={totalSemana > 0} />
          <Tile cap="Horas gravadas" icone={<IcoRelogio />} valor={<>{analytics.hours.toLocaleString('pt-BR')}<small>h</small></>}
            foot={`${analytics.minutes.toLocaleString('pt-BR')} min no total`} />
          <Tile cap="Participantes" icone={<IcoUsers />} valor={analytics.users.toLocaleString('pt-BR')} foot="pessoas distintas" />
          <Tile cap="Transcrições" icone={<IcoDoc />} valor={analytics.transcripts.toLocaleString('pt-BR')} foot="falas capturadas" />
        </div>
      )}

      {/* grid: reuniões recentes + atividade/IA */}
      {(analytics || meetings) && (
        <div className="grid">
          {/* reuniões recentes */}
          <div className="card">
            <div className="hd"><h2>Reuniões recentes</h2><span className="more">últimas {meetings?.length || 0}</span></div>

            {meetings && meetings.length === 0 && (
              <div className="empty">
                <div className="big">🎙️</div>
                <b>Nenhuma reunião ainda</b>
                <p>Entre em uma reunião do Google Meet e inicie a captura pela extensão MeetAI — ela vai aparecer aqui em tempo real.</p>
              </div>
            )}

            {meetings && meetings.length > 0 && listaFiltrada.length === 0 && (
              <div className="empty"><b>Nada encontrado</b><p>Nenhuma reunião bate com “{filtro}”.</p></div>
            )}

            {listaFiltrada.map((m) => (
              <div className="meet" style={{ cursor: 'pointer' }} key={m._id}
                onClick={() => { setModalId(m._id); setModalMin(false); }}>
                <div className="ic">{m.status === 'live' ? '🟣' : '🗂️'}</div>
                <div className="info">
                  <b>{m.title || 'Reunião sem título'}</b>
                  <small>
                    {m.meetingCode ? `meet.google.com/${m.meetingCode}` : 'sem código'}
                    {' · '}{tempoRelativo(m.createdAt)}
                    {fmtDuracao(m.duration) ? ` · ${fmtDuracao(m.duration)}` : ''}
                  </small>
                </div>
                <div className="parts">
                  {(m.participants || []).slice(0, 3).map((p, i) => (
                    <i key={i} style={{ background: CORES[i % CORES.length] }} title={p}>
                      {(p || '?').charAt(0).toUpperCase()}
                    </i>
                  ))}
                  {(m.participants?.length || 0) > 3 && (
                    <i style={{ background: '#3A3A55' }}>+{(m.participants!.length - 3)}</i>
                  )}
                </div>
                <span className={`pill ${m.status === 'live' ? 'live' : 'done'}`}>
                  {m.status === 'live' ? 'Ao vivo' : 'Finalizada'}
                </span>
              </div>
            ))}
          </div>

          {/* coluna direita */}
          <div>
            <div className="card">
              <div className="hd"><h2>Atividade</h2><span className="more">7 dias</span></div>
              {totalSemana > 0 ? (
                <>
                  <div className="bars">
                    {dias.map((d) => {
                      const v = analytics?.byDay[d.chave] || 0;
                      const alt = Math.round((v / maxDia) * 100);
                      const isMax = v > 0 && v === maxDia;
                      return <div key={d.chave} className={`b${isMax ? ' hi' : ''}`} style={{ height: `${v > 0 ? Math.max(alt, 8) : 0}%` }} title={`${d.chave}: ${v}`} />;
                    })}
                  </div>
                  <div className="days">{dias.map((d) => <span key={d.chave}>{d.label}</span>)}</div>
                </>
              ) : (
                <div className="empty"><p>Sem atividade nos últimos 7 dias.</p></div>
              )}
            </div>

            <div className="card ia">
              <div className="hd"><span className="badge">✦ Resumo IA</span></div>
              <p>Resumos automáticos, itens de ação e busca por IA chegam em breve — vão aparecer aqui por reunião.</p>
            </div>
          </div>
        </div>
      )}

      {modalId && (
        <Modal titulo="Transcrição / Vídeo" minimizado={modalMin} lado="right"
          onToggleMin={() => setModalMin((v) => !v)} onFechar={() => setModalId(null)}>
          <PainelTranscricao id={modalId} />
        </Modal>
      )}
    </>
  );
}

// ── subcomponentes ─────────────────────────────────────────
function Tile({ cap, icone, valor, foot, up }: { cap: string; icone: React.ReactNode; valor: React.ReactNode; foot: string; up?: boolean }) {
  return (
    <div className="tile">
      <div className="cap"><span className="ic">{icone}</span>{cap}</div>
      <div className="val">{valor}</div>
      <div className={`foot${up ? ' up' : ''}`}>{foot}</div>
    </div>
  );
}

const IcoCam = () => (<svg viewBox="0 0 24 24" fill="none" stroke="var(--b2)" strokeWidth="2"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M8 21h8" /></svg>);
const IcoRelogio = () => (<svg viewBox="0 0 24 24" fill="none" stroke="var(--b2)" strokeWidth="2"><circle cx="12" cy="12" r="8" /><path d="M12 8v4l3 2" /></svg>);
const IcoUsers = () => (<svg viewBox="0 0 24 24" fill="none" stroke="var(--b2)" strokeWidth="2"><circle cx="9" cy="8" r="3.2" /><path d="M3 20a6 6 0 0 1 12 0M16 6a3 3 0 0 1 0 6M21 20a6 6 0 0 0-4-5.6" /></svg>);
const IcoDoc = () => (<svg viewBox="0 0 24 24" fill="none" stroke="var(--b2)" strokeWidth="2"><path d="M5 4h14v16l-3-2-2 2-2-2-2 2-3-2zM8 9h8M8 13h5" /></svg>);
