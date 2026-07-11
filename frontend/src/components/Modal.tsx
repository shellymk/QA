// ============================================================
// Modal com MINIMIZAR / EXPANDIR / FECHAR.
// Quando minimizado vira uma barrinha no canto e a tela de trás
// fica totalmente utilizável (sem overlay bloqueando).
// ============================================================

import type { ReactNode } from 'react';

export function Modal({ titulo, minimizado, onToggleMin, onFechar, children, lado = 'right' }: {
  titulo: string;
  minimizado: boolean;
  onToggleMin: () => void;
  onFechar: () => void;
  children: ReactNode;
  lado?: 'left' | 'right';
}) {
  if (minimizado) {
    return (
      <div className={`modal-min ${lado}`} role="dialog" aria-label={titulo}>
        <span className="modal-min-dot" />
        <span className="modal-min-txt">{titulo}</span>
        <button onClick={onToggleMin} title="Expandir" aria-label="Expandir">▲</button>
        <button onClick={onFechar} title="Fechar" aria-label="Fechar">✕</button>
      </div>
    );
  }
  return (
    <div className="modal-overlay" onClick={onFechar}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={titulo}>
        <div className="modal-head">
          <b>{titulo}</b>
          <div className="modal-actions">
            <button onClick={onToggleMin} title="Minimizar" aria-label="Minimizar">—</button>
            <button onClick={onFechar} title="Fechar" aria-label="Fechar">✕</button>
          </div>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}
