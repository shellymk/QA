// ============================================================
// Página placeholder para as abas ainda não construídas.
// Mantém o menu funcionando (sem 404) e sinaliza honestamente
// que a tela está em construção. Reutilizada por várias rotas.
// ============================================================

export function EmConstrucao({ titulo, descricao, emoji }: { titulo: string; descricao: string; emoji: string }) {
  return (
    <div className="construcao">
      <div className="box">
        <div className="mark-lg">{emoji}</div>
        <h1>{titulo}</h1>
        <p>{descricao}</p>
      </div>
    </div>
  );
}
