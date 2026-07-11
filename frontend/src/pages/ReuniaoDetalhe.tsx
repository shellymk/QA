// ============================================================
// Página de detalhe da reunião (/reuniao/:id) — usada pelos links do
// Dashboard. Reaproveita o mesmo painel do modal (player + transcrição).
// ============================================================

import { useParams, Link } from 'react-router-dom';
import { PainelTranscricao } from '../components/PainelTranscricao';

export function ReuniaoDetalhe() {
  const { id } = useParams();
  return (
    <>
      <div className="topbar">
        <div className="h">
          <h1>Reunião</h1>
          <div className="sub"><Link to="/reunioes" className="more">← Voltar às reuniões</Link></div>
        </div>
      </div>
      <div className="card">
        {id && <PainelTranscricao id={id} />}
      </div>
    </>
  );
}
