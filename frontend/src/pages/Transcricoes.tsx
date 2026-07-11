// ============================================================
// Transcrições — "Subir gravação".
// Envia um áudio pro servidor, que transcreve com DIARIZAÇÃO
// (AssemblyAI) e devolve as falas separadas por pessoa.
// Caso de uso: analista com gravação de reunião no celular.
// ============================================================

import { useMemo, useState, type ChangeEvent } from 'react';
import { apiUpload } from '../lib/api';
import type { Fala, RespostaUpload } from '../lib/types';

const CORES = ['#8B5CF6', '#D946EF', '#6366F1', '#F59E0B', '#DB2777', '#10B981'];

function mmss(ms: number): string {
  const s = Math.round(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

export function Transcricoes() {
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [processando, setProcessando] = useState(false);
  const [erro, setErro] = useState('');
  const [resultado, setResultado] = useState<RespostaUpload['transcricao'] | null>(null);

  // cor fixa por pessoa (A, B, C…), remontada a cada novo resultado
  const corDe = useMemo(() => {
    const mapa = new Map<string, string>();
    (resultado?.falas || []).forEach((f) => {
      if (!mapa.has(f.speaker)) mapa.set(f.speaker, CORES[mapa.size % CORES.length]);
    });
    return (speaker: string) => mapa.get(speaker) || CORES[0];
  }, [resultado]);

  function escolher(e: ChangeEvent<HTMLInputElement>) {
    setErro('');
    setResultado(null);
    setArquivo(e.target.files?.[0] || null);
  }

  async function enviar() {
    if (!arquivo) return;
    setErro('');
    setResultado(null);
    setProcessando(true);
    try {
      const r = await apiUpload<RespostaUpload>(
        `/api/transcrever-upload?title=${encodeURIComponent(arquivo.name)}`,
        arquivo,
      );
      setResultado(r.transcricao);
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setProcessando(false);
    }
  }

  return (
    <>
      <div className="topbar">
        <div className="h">
          <h1>Transcrições</h1>
          <div className="sub">Suba uma gravação (reunião, call, áudio do celular) e receba a transcrição com quem falou separado.</div>
        </div>
      </div>

      {/* card de upload */}
      <div className="card upload">
        <div className="drop">
          <div className="drop-ic">🎧</div>
          <label className="btn-file">
            {arquivo ? 'Trocar arquivo' : 'Escolher gravação'}
            <input type="file" accept="audio/*,video/*" onChange={escolher} hidden />
          </label>
          <div className="drop-hint">
            {arquivo ? <b>{arquivo.name}</b> : 'MP3, M4A, WAV, OGG… com uma ou mais pessoas falando'}
          </div>
        </div>

        <button className="btn" onClick={enviar} disabled={!arquivo || processando}>
          {processando ? 'Transcrevendo…' : 'Transcrever'}
        </button>
      </div>

      {processando && (
        <div className="skeleton">⏳ Enviando e separando as vozes com IA — pode levar cerca de 1 minuto para áudios curtos. Não feche a página.</div>
      )}
      {erro && <div className="banner-erro">⚠️ {erro}</div>}

      {/* resultado */}
      {resultado && (
        <div className="card">
          <div className="hd">
            <h2>Transcrição</h2>
            <span className="more">
              {resultado.pessoas} pessoa{resultado.pessoas > 1 ? 's' : ''}
              {resultado.duracaoSeg ? ` · ${mmss(resultado.duracaoSeg * 1000)}` : ''}
            </span>
          </div>

          {resultado.falas.length === 0 && (
            <div className="empty"><b>Sem fala detectada</b><p>O áudio não tinha voz reconhecível, ou está em outro idioma.</p></div>
          )}

          <div className="falas">
            {resultado.falas.map((f: Fala, i) => {
              const cor = corDe(f.speaker);
              const incerto = f.confianca != null && f.confianca < 0.5;
              return (
                <div className="fala" key={i}>
                  <div className="fala-meta">
                    <span className="chip" style={{ background: cor }}>{f.speaker}</span>
                    <span className="ts">{mmss(f.start)}</span>
                  </div>
                  <div className="fala-txt">
                    {f.text}
                    {incerto && <span className="incerto" title="Identificação incerta (vozes sobrepostas / fala rápida)"> ⚠️</span>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}
