// ============================================================
// Conteúdo do modal "Enviar gravação": escolhe um áudio/vídeo,
// transcreve (AssemblyAI diariza) e mostra as falas por pessoa.
// ============================================================

import { useMemo, useState, type ChangeEvent } from 'react';
import { apiUpload } from '../lib/api';
import type { Fala, RespostaUpload } from '../lib/types';

const CORES = ['#8B5CF6', '#D946EF', '#6366F1', '#F59E0B', '#DB2777', '#10B981'];
function mmss(ms: number): string {
  const s = Math.round(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

export function PainelUpload({ onPronto }: { onPronto?: () => void }) {
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [processando, setProcessando] = useState(false);
  const [erro, setErro] = useState('');
  const [resultado, setResultado] = useState<RespostaUpload['transcricao'] | null>(null);

  const corDe = useMemo(() => {
    const m = new Map<string, string>();
    (resultado?.falas || []).forEach((f) => { if (!m.has(f.speaker)) m.set(f.speaker, CORES[m.size % CORES.length]); });
    return (s: string) => m.get(s) || CORES[0];
  }, [resultado]);

  function escolher(e: ChangeEvent<HTMLInputElement>) {
    setErro(''); setResultado(null); setArquivo(e.target.files?.[0] || null);
  }

  async function enviar() {
    if (!arquivo) return;
    setErro(''); setResultado(null); setProcessando(true);
    try {
      const r = await apiUpload<RespostaUpload>(`/api/transcrever-upload?title=${encodeURIComponent(arquivo.name)}`, arquivo);
      setResultado(r.transcricao);
      onPronto?.();
    } catch (e) { setErro((e as Error).message); }
    finally { setProcessando(false); }
  }

  return (
    <div>
      <div className="upload">
        <div className="drop">
          <div className="drop-ic">🎧</div>
          <label className="btn-file">
            {arquivo ? 'Trocar arquivo' : 'Escolher gravação'}
            <input type="file" accept="audio/*,video/*" onChange={escolher} hidden />
          </label>
          <div className="drop-hint">
            {arquivo ? <b>{arquivo.name}</b> : 'MP3, M4A, WAV, OGG, MP4… com uma ou mais pessoas falando'}
          </div>
        </div>
        <button className="btn" onClick={enviar} disabled={!arquivo || processando}>
          {processando ? 'Transcrevendo…' : 'Transcrever'}
        </button>
      </div>

      {processando && <div className="skeleton">⏳ Enviando e separando as vozes com IA — pode levar ~1 min. Pode minimizar e fazer outras coisas.</div>}
      {erro && <div className="banner-erro">⚠️ {erro}</div>}

      {resultado && (
        <div style={{ marginTop: 16 }}>
          <div className="hd">
            <h2>Resultado</h2>
            <span className="more">{resultado.pessoas} pessoa{resultado.pessoas > 1 ? 's' : ''}{resultado.duracaoSeg ? ` · ${mmss(resultado.duracaoSeg * 1000)}` : ''}</span>
          </div>
          <div className="falas">
            {resultado.falas.map((f: Fala, i) => {
              const incerto = f.confianca != null && f.confianca < 0.5;
              return (
                <div className="fala" key={i}>
                  <div className="fala-meta">
                    <span className="chip" style={{ background: corDe(f.speaker) }}>{f.speaker}</span>
                    <span className="ts">{mmss(f.start)}</span>
                  </div>
                  <div className="fala-txt">{f.text}{incerto && <span className="incerto"> ⚠️</span>}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
