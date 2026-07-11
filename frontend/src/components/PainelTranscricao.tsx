// ============================================================
// Modal "Transcrição / Vídeo" (Etapa 5): player da gravação
// (vídeo/áudio) SINCRONIZADO com a transcrição — clicar numa fala
// busca aquele ponto; a fala atual fica destacada enquanto toca.
// ============================================================

import { useEffect, useMemo, useRef, useState } from 'react';
import { apiFetch, API_URL, getToken } from '../lib/api';
import type { Meeting } from '../lib/types';

const CORES = ['#8B5CF6', '#D946EF', '#6366F1', '#F59E0B', '#DB2777', '#10B981'];
function mmss(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

export function PainelTranscricao({ id }: { id: string }) {
  const [reuniao, setReuniao] = useState<Meeting | null>(null);
  const [erro, setErro] = useState('');
  const [posMs, setPosMs] = useState(0);
  const mediaRef = useRef<HTMLMediaElement | null>(null);

  useEffect(() => {
    setReuniao(null); setErro(''); setPosMs(0);
    apiFetch(`/api/meeting/${id}`)
      .then((r) => { if (!r.ok) throw new Error('Reunião não encontrada'); return r.json(); })
      .then((m: Meeting) => setReuniao(m))
      .catch((e: Error) => setErro(e.message));
  }, [id]);

  const corDe = useMemo(() => {
    const map = new Map<string, string>();
    (reuniao?.transcripts || []).forEach((t) => { if (!map.has(t.user)) map.set(t.user, CORES[map.size % CORES.length]); });
    return (u: string) => map.get(u) || CORES[0];
  }, [reuniao]);

  const falas = reuniao?.transcripts || [];
  const base = reuniao ? new Date(reuniao.createdAt).getTime() : 0;
  const tempos = useMemo(() => falas.map((t) => new Date(t.timestamp).getTime() - base), [reuniao]); // eslint-disable-line react-hooks/exhaustive-deps

  // fala atual = última cujo tempo já passou no player
  const atual = useMemo(() => {
    let idx = -1;
    for (let i = 0; i < tempos.length; i++) if (tempos[i] <= posMs) idx = i;
    return idx;
  }, [tempos, posMs]);

  const temMidia = !!reuniao?.temMidia;
  const ehVideo = (reuniao?.mediaTipo || 'video').startsWith('video');
  const src = `${API_URL}/api/reuniao/${id}/media?token=${encodeURIComponent(getToken() || '')}`;

  function seek(ms: number) {
    const m = mediaRef.current;
    if (m) { m.currentTime = ms / 1000; m.play().catch(() => {}); }
  }

  return (
    <div>
      {/* player OU placeholder */}
      {temMidia ? (
        ehVideo ? (
          <video ref={(el) => { mediaRef.current = el; }} className="player-media" src={src} controls
            onTimeUpdate={(e) => setPosMs(e.currentTarget.currentTime * 1000)} />
        ) : (
          <audio ref={(el) => { mediaRef.current = el; }} className="player-audio" src={src} controls
            onTimeUpdate={(e) => setPosMs(e.currentTarget.currentTime * 1000)} />
        )
      ) : (
        <div className="video-ph">
          <div className="video-ic">🎬</div>
          <div><b>Sem gravação</b><p>Esta reunião não tem vídeo/áudio guardado (capturas antigas ou só-legenda).</p></div>
        </div>
      )}

      {erro && <div className="banner-erro">⚠️ {erro}</div>}
      {!reuniao && !erro && <div className="skeleton">Carregando…</div>}
      {reuniao && falas.length === 0 && (
        <div className="empty"><b>Sem transcrição ainda</b><p>Se a reunião acabou de encerrar, pode estar processando (áudio → IA).</p></div>
      )}

      {falas.length > 0 && (
        <div className="thead">
          <h3>Transcrição</h3>
          {temMidia && <span className="hint">clique numa fala pra pular o vídeo até ali ↧</span>}
        </div>
      )}

      <div className="falas">
        {falas.map((t, i) => {
          const incerto = t.confianca != null && t.confianca < 0.5;
          return (
            <div className={`fala ${temMidia ? 'clicavel' : ''} ${i === atual ? 'atual' : ''}`} key={i}
              onClick={temMidia ? () => seek(tempos[i]) : undefined}>
              <div className="fala-meta">
                <span className="chip" style={{ background: corDe(t.user) }}>{t.user}</span>
                <span className="ts">{mmss(tempos[i])}</span>
              </div>
              <div className="fala-txt">
                {t.text}
                {incerto && <span className="incerto" title="Identificação incerta (vozes sobrepostas)"> ⚠️</span>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
