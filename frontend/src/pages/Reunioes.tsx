// ============================================================
// Reuniões — CARDS de plataforma → clica → CARDS de reunião.
// Seleção por CHECKBOX + "Mover pra lixeira" em LOTE (soft-delete).
// Clicar num card de reunião abre o MODAL "Transcrição / Vídeo"
// (minimizável). "Enviar gravação" também abre um modal.
// ============================================================

import { useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../lib/api';
import type { Meeting } from '../lib/types';
import { Modal } from '../components/Modal';
import { PainelTranscricao } from '../components/PainelTranscricao';
import { PainelUpload } from '../components/PainelUpload';

function plataforma(m: Meeting): { nome: string; icone: string } {
  if (m.origem === 'upload') return { nome: 'Gravações enviadas', icone: '🎧' };
  return { nome: 'Google Meet', icone: '🟣' };
}
function hora(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}
function fmtDur(min: number | null): string {
  if (!min || min < 1) return '';
  const m = Math.round(min);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}`;
}

export function Reunioes() {
  const [meetings, setMeetings] = useState<Meeting[] | null>(null);
  const [erro, setErro] = useState('');
  const [plataformaAberta, setPlataformaAberta] = useState<string | null>(null);
  const [selecionadas, setSelecionadas] = useState<Set<string>>(new Set());
  const [modalId, setModalId] = useState<string | null>(null);
  const [modalMin, setModalMin] = useState(false);
  const [uploadAberto, setUploadAberto] = useState(false);
  const [uploadMin, setUploadMin] = useState(false);

  function recarregar() {
    apiFetch('/api/meetings?limit=100')
      .then((r) => { if (!r.ok) throw new Error(`Erro ao carregar as reuniões (HTTP ${r.status})`); return r.json(); })
      .then((d: { meetings: Meeting[] }) => setMeetings(d.meetings || []))
      .catch((e: Error) => setErro(e.message));
  }
  useEffect(recarregar, []);

  const cards = useMemo(() => {
    const map = new Map<string, { icone: string; lista: Meeting[] }>();
    for (const m of meetings || []) {
      const p = plataforma(m);
      if (!map.has(p.nome)) map.set(p.nome, { icone: p.icone, lista: [] });
      map.get(p.nome)!.lista.push(m);
    }
    return [...map.entries()];
  }, [meetings]);

  const abertos = cards.find(([nome]) => nome === plataformaAberta);

  function toggleSel(id: string) {
    setSelecionadas((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }
  async function moverSelecionadas() {
    const ids = [...selecionadas];
    if (ids.length === 0) return;
    await Promise.all(ids.map((id) => apiFetch(`/api/meeting/${id}/trash`, { method: 'POST' }).catch(() => {})));
    setMeetings((ms) => (ms || []).filter((m) => !selecionadas.has(m._id)));
    setSelecionadas(new Set());
  }

  return (
    <>
      <div className="topbar">
        <div className="h">
          <h1>Reuniões</h1>
          <div className="sub">Clique num card para abrir a transcrição. Marque para <b>mover pra lixeira</b> (excluir de vez é em Configurações).</div>
        </div>
        <button className="btn" onClick={() => { setUploadAberto(true); setUploadMin(false); }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M12 5v14M5 12h14" /></svg>
          Enviar gravação
        </button>
      </div>

      {erro && <div className="banner-erro">⚠️ {erro}</div>}
      {!meetings && !erro && <div className="skeleton">Carregando…</div>}

      {/* barra de seleção */}
      {selecionadas.size > 0 && (
        <div className="sel-bar">
          <b>{selecionadas.size}</b> selecionada{selecionadas.size > 1 ? 's' : ''}
          <div className="sel-actions">
            <button className="btn-sec" onClick={() => setSelecionadas(new Set())}>Limpar</button>
            <button className="btn-perigo" onClick={moverSelecionadas}>🗑️ Mover pra lixeira</button>
          </div>
        </div>
      )}

      {meetings && meetings.length === 0 && (
        <div className="card">
          <div className="empty">
            <div className="big">🎙️</div>
            <b>Nenhuma reunião ainda</b>
            <p>Clique em <b>Enviar gravação</b> ou inicie a captura numa reunião do Google Meet.</p>
          </div>
        </div>
      )}

      {/* cards de PLATAFORMA */}
      {cards.length > 0 && (
        <div className="plat-grid">
          {cards.map(([nome, { icone, lista }]) => (
            <button key={nome} className={`plat-card ${plataformaAberta === nome ? 'aberto' : ''}`}
              onClick={() => setPlataformaAberta((p) => (p === nome ? null : nome))}>
              <div className="plat-card-ic">{icone}</div>
              <div className="plat-card-txt">
                <b>{nome}</b>
                <small>{lista.length} reunião{lista.length > 1 ? 'ões' : ''}</small>
              </div>
              <span className="plat-card-arrow">{plataformaAberta === nome ? '▲' : '▼'}</span>
            </button>
          ))}
        </div>
      )}

      {/* cards de REUNIÃO da plataforma aberta */}
      {abertos && (
        <div className="mcard-grid">
          {abertos[1].lista.map((m) => (
            <div className={`mcard ${selecionadas.has(m._id) ? 'sel' : ''}`} key={m._id}
              onClick={() => { setModalId(m._id); setModalMin(false); }}>
              <input type="checkbox" className="mcard-check" checked={selecionadas.has(m._id)}
                onClick={(e) => e.stopPropagation()} onChange={() => toggleSel(m._id)}
                aria-label={`Selecionar ${m.title || 'reunião'}`} />
              <div className="mcard-ic">{m.status === 'live' ? '🟣' : '🗂️'}</div>
              <div className="mcard-body">
                <b>{m.title || 'Reunião sem título'}</b>
                <small>
                  {hora(m.createdAt)}
                  {fmtDur(m.duration) ? ` · ${fmtDur(m.duration)}` : ''}
                  {m.participants?.length ? ` · ${m.participants.length} pessoa(s)` : ''}
                </small>
              </div>
              <span className={`pill ${m.status === 'live' ? 'live' : 'done'}`}>
                {m.status === 'live' ? 'Ao vivo' : 'Finalizada'}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* MODAIS */}
      {modalId && (
        <Modal titulo="Transcrição / Vídeo" minimizado={modalMin} lado="right"
          onToggleMin={() => setModalMin((v) => !v)} onFechar={() => setModalId(null)}>
          <PainelTranscricao id={modalId} />
        </Modal>
      )}
      {uploadAberto && (
        <Modal titulo="Enviar gravação" minimizado={uploadMin} lado="left"
          onToggleMin={() => setUploadMin((v) => !v)} onFechar={() => setUploadAberto(false)}>
          <PainelUpload onPronto={recarregar} />
        </Modal>
      )}
    </>
  );
}
