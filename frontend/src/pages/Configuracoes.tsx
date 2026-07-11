// ============================================================
// Configurações — por enquanto guarda a LIXEIRA (Etapa 4).
// Reuniões movidas pra lixeira continuam no banco; só somem de vez
// quando "Excluir permanentemente" aqui. Também dá pra "Restaurar".
//
// UX (seleção em lote, não botão por reunião):
//   1. Dois botões no topo: "Restaurar" e "Excluir permanentemente".
//   2. Ao clicar em um deles, entra em modo de SELEÇÃO: aparecem os
//      checkboxes nas reuniões (clicar na linha marca/desmarca).
//   3. A pessoa marca as que quer e confirma a ação.
//   4. No modo Excluir, a confirmação final é um MODAL estilizado
//      (ação sem volta). Restaurar não é destrutivo → executa direto.
// ============================================================

import { useEffect, useState } from 'react';
import type { Meeting } from '../lib/types';
import { apiFetch } from '../lib/api';

type Modo = 'restaurar' | 'excluir' | null;

function quando(iso?: string | null): string {
  return iso ? new Date(iso).toLocaleString('pt-BR') : '';
}

export function Configuracoes() {
  const [lixo, setLixo] = useState<Meeting[] | null>(null);
  const [erro, setErro] = useState('');
  const [modo, setModo] = useState<Modo>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [modalExcluir, setModalExcluir] = useState(false);
  const [processando, setProcessando] = useState(false);

  function carregar() {
    apiFetch('/api/lixeira')
      .then((r) => { if (!r.ok) throw new Error('Servidor indisponível'); return r.json(); })
      .then((d: { meetings: Meeting[] }) => setLixo(d.meetings || []))
      .catch((e: Error) => setErro(e.message));
  }
  useEffect(carregar, []);

  const itens = lixo || [];
  const vazia = itens.length === 0;

  function entrarModo(m: Exclude<Modo, null>) {
    setModo(m);
    setSel(new Set());
  }

  function cancelar() {
    setModo(null);
    setSel(new Set());
    setModalExcluir(false);
  }

  function toggle(id: string) {
    setSel((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  }

  const todasMarcadas = !vazia && sel.size === itens.length;
  function marcarTodas() {
    setSel(todasMarcadas ? new Set() : new Set(itens.map((m) => m._id)));
  }

  // Chamado pelo botão "Confirmar" da barra de seleção.
  function confirmarAcao() {
    if (sel.size === 0) return;
    if (modo === 'restaurar') executarRestaurar();
    else setModalExcluir(true); // abre o modal de confirmação final
  }

  async function executarRestaurar() {
    const ids = [...sel];
    setProcessando(true);
    try {
      await Promise.all(ids.map((id) => apiFetch(`/api/meeting/${id}/restore`, { method: 'POST' })));
      setLixo((l) => (l || []).filter((m) => !ids.includes(m._id)));
      cancelar();
    } catch (e) { setErro((e as Error).message); }
    finally { setProcessando(false); }
  }

  async function executarExcluir() {
    const ids = [...sel];
    setProcessando(true);
    try {
      await Promise.all(ids.map((id) => apiFetch(`/api/meeting/${id}`, { method: 'DELETE' })));
      setLixo((l) => (l || []).filter((m) => !ids.includes(m._id)));
      cancelar();
    } catch (e) { setErro((e as Error).message); }
    finally { setProcessando(false); }
  }

  return (
    <>
      <div className="topbar">
        <div className="h">
          <h1>Configurações</h1>
          <div className="sub">Preferências da conta e do painel.</div>
        </div>
      </div>

      <div className="card">
        <div className="hd">
          <h2>🗑️ Lixeira</h2>
          <span className="more">{itens.length} na lixeira</span>
        </div>
        <p className="dica">Reuniões movidas pra lixeira <b>continuam no banco</b> até você excluir permanentemente aqui. É a última parada antes de sumir de vez.</p>

        {erro && <div className="banner-erro">⚠️ {erro}</div>}
        {!lixo && !erro && <div className="skeleton">Carregando…</div>}
        {lixo && vazia && <div className="empty"><p>A lixeira está vazia.</p></div>}

        {/* Barra de ações — muda conforme o modo */}
        {!vazia && modo === null && (
          <div className="lixo-acoes">
            <button className="btn-sec" onClick={() => entrarModo('restaurar')}>♻️ Restaurar</button>
            <button className="btn-perigo" onClick={() => entrarModo('excluir')}>🔥 Excluir permanentemente</button>
          </div>
        )}

        {!vazia && modo !== null && (
          <div className={`lixo-bar ${modo}`}>
            <button
              className={modo === 'excluir' ? 'btn-perigo' : 'btn'}
              disabled={sel.size === 0 || processando}
              onClick={confirmarAcao}
            >
              {modo === 'restaurar'
                ? `♻️ Restaurar selecionadas (${sel.size})`
                : `🔥 Excluir selecionadas (${sel.size})`}
            </button>
            <button className="btn-sec" onClick={cancelar} disabled={processando}>Cancelar</button>
            <label className="marcar-todas">
              <input type="checkbox" checked={todasMarcadas} onChange={marcarTodas} />
              marcar todas
            </label>
          </div>
        )}

        {/* Lista da lixeira */}
        {itens.map((m) => {
          const marcada = sel.has(m._id);
          const selecionavel = modo !== null;
          return (
            <div
              className={`meet ${selecionavel ? 'selecionavel' : ''} ${marcada ? 'sel' : ''}`}
              key={m._id}
              onClick={selecionavel ? () => toggle(m._id) : undefined}
            >
              {selecionavel && (
                <input type="checkbox" className="chk" checked={marcada} readOnly />
              )}
              <div className="ic">🗑️</div>
              <div className="info">
                <b>{m.title || 'Reunião'}</b>
                <small>na lixeira desde {quando(m.deletedAt)}</small>
              </div>
            </div>
          );
        })}
      </div>

      {/* Modal estilizado de confirmação — só na exclusão permanente */}
      {modalExcluir && (
        <div className="modal-overlay" onClick={() => !processando && setModalExcluir(false)}>
          <div className="modal sm" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Confirmar exclusão permanente">
            <div className="modal-head"><b>🔥 Excluir permanentemente</b></div>
            <div className="modal-body">
              <p>Você vai apagar <b>{sel.size}</b> {sel.size === 1 ? 'reunião' : 'reuniões'} <b>de vez</b> do banco de dados.</p>
              <p className="aviso-perigo">⚠️ Essa ação <b>não tem volta</b>.</p>
              <div className="modal-foot">
                <button className="btn-sec" onClick={() => setModalExcluir(false)} disabled={processando}>Cancelar</button>
                <button className="btn-perigo" onClick={executarExcluir} disabled={processando}>
                  {processando ? 'Excluindo…' : 'Deletar permanentemente'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
