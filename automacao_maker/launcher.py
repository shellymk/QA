import subprocess
import sys
import os

# --- CONFIGURAÇÃO ---
SCRIPT_ALVO = "run_tests.py"
ARQUIVO_LOG = "log_blindado.txt"

print(f"--- [LAUNCHER] Iniciando V5 (Técnica PIPE) ---")

# 1. Prepara o ambiente para "enganar" bibliotecas de cor
meu_ambiente = os.environ.copy()
meu_ambiente["PYTHONIOENCODING"] = "utf-8"
meu_ambiente["NO_COLOR"] = "1"     # Avisa para não usar cores
meu_ambiente["TERM"] = "dumb"      # Avisa que é um terminal burro (sem formatação)

try:
    # 2. Abre o arquivo de log onde vamos salvar tudo
    with open(ARQUIVO_LOG, "w", encoding="utf-8") as arquivo_final:
        
        arquivo_final.write("--- INICIO DO LOG (V5) ---\n")
        
        # 3. Cria o processo FILHO
        # stdout=subprocess.PIPE -> O filho escreve na memória, não no arquivo (evita o erro!)
        processo = subprocess.Popen(
            [sys.executable, SCRIPT_ALVO, "-c", "config/config.yaml", "--performance-only", "--no-report"],
            stdout=subprocess.PIPE,       # Captura saída padrão
            stderr=subprocess.STDOUT,     # Captura erros junto com a saída
            text=True,                    # Vem como texto, não bytes
            encoding='utf-8',             # Força UTF-8
            env=meu_ambiente              # Aplica as vacinas de ambiente
        )

        # 4. O Launcher lê a memória do filho linha por linha e escreve no arquivo
        # Isso atua como um "filtro" de segurança.
        for linha in processo.stdout:
            # Escreve no arquivo
            arquivo_final.write(linha)
            # Força salvar no disco agora (flush)
            arquivo_final.flush() 
            
            # Opcional: Mostra na tela preta do Server também para você ver rodando
            sys.stdout.write(linha) 

        # Espera terminar
        processo.wait()
        
        arquivo_final.write(f"\n--- FIM (Exit Code: {processo.returncode}) ---")

except Exception as e:
    print(f"ERRO CRÍTICO NO LAUNCHER: {e}")
    with open(ARQUIVO_LOG, "a") as f:
        f.write(f"\nERRO NO LAUNCHER: {e}")

print("\n--- [LAUNCHER] Processo finalizado ---")