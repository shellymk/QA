#!/usr/bin/env bash
# ============================================================
# testar-producao.sh — check-up automático da produção do MeetAI.
#
# Roda uma "bateria" de testes (uma sequência de verificações) no backend
# (Render) e no painel (Vercel) e diz, pra cada um, se passou (✅) ou não (❌).
# Não precisa de login nem de senha — só confere que tudo está de pé e que a
# autenticação está barrando quem não tem token.
#
# Como rodar (no Git Bash):
#   bash testar-producao.sh
# ============================================================

# --- Endereços da sua produção (troque aqui se um dia mudar) ---
API="https://transcription-1pcy.onrender.com"   # backend (Render)
PANEL="https://qa-gray.vercel.app"              # painel (Vercel)

# Contadores de resultado.
PASSOU=0
FALHOU=0

# Helper: bate numa URL e compara o código HTTP com o esperado.
#   $1 = descrição   $2 = código esperado   $3 = URL   (demais = args extra do curl)
checar() {
  local desc="$1"; local esperado="$2"; local url="$3"; shift 3
  # -m 70: dá até 70s (a Render dorme e o 1º acesso do dia acorda devagar).
  local codigo
  codigo=$(curl -s -m 70 -o /dev/null -w "%{http_code}" "$@" "$url")
  if [ "$codigo" = "$esperado" ]; then
    echo "  ✅ $desc  (HTTP $codigo)"
    PASSOU=$((PASSOU + 1))
  else
    echo "  ❌ $desc  (esperava $esperado, veio $codigo)"
    FALHOU=$((FALHOU + 1))
  fi
}

echo "════════ BACKEND (Render) ════════"
echo "  (a 1ª verificação pode demorar ~30-50s se o servidor estava dormindo)"
checar "Servidor vivo (/api/health)"          200 "$API/api/health"
checar "Bloqueia sem login (/api/meetings)"   401 "$API/api/meetings"
checar "Rejeita token falso"                  401 "$API/api/meetings" -H "Authorization: Bearer aaa.bbb.ccc"

echo ""
echo "════════ FRONTEND (Vercel) ════════"
checar "Painel carrega (raiz)"                200 "$PANEL"
checar "Deep-link /login (SPA rewrite)"       200 "$PANEL/login"

echo ""
echo "════════ RESULTADO ════════"
echo "  Passou: $PASSOU   |   Falhou: $FALHOU"
if [ "$FALHOU" -eq 0 ]; then
  echo "  🎉 Tudo verde — produção saudável."
  exit 0
else
  echo "  ⚠️  Algo falhou — veja os ❌ acima."
  exit 1
fi
