# -*- coding: utf-8 -*-
from flask import Flask, jsonify
from flask_cors import CORS
import subprocess
import json
import time
import os

app = Flask(__name__)
CORS(app)

# --- CONFIGURAÇÕES ---
PASTA_PROJETO = r'D:\Automacoes Maker\automacao_maker'
ARQUIVO_BAT = os.path.join(PASTA_PROJETO, 'executar_teste.bat')
# O servidor agora lê o log que o Launcher criou
ARQUIVO_LOG = os.path.join(PASTA_PROJETO, 'log_blindado.txt')

# --- ESTILO VISUAL COMPLETO (VOLTOU A SER GRANDE E BONITO) ---
CSS_REPORT = """
<style>
    body { font-family: 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f4f6f9; margin: 0; padding: 0; }
    .dashboard { max-width: 900px; margin: 0 auto; background: white; padding: 25px; border-radius: 10px; box-shadow: 0 4px 15px rgba(0,0,0,0.05); }
    
    /* Grid para os cards ficarem lado a lado */
    .summary-grid { display: flex; gap: 20px; margin-bottom: 25px; flex-wrap: wrap; }
    
    .kpi-card { 
        flex: 1; 
        min-width: 200px;
        padding: 25px; 
        border-radius: 12px; 
        color: white; 
        text-align: center; 
        box-shadow: 0 4px 6px rgba(0,0,0,0.1); 
        transition: transform 0.2s;
    }
    .kpi-card:hover { transform: translateY(-3px); }
    
    /* Cores Gradientes */
    .bg-blue { background: linear-gradient(135deg, #007bff, #0056b3); }
    .bg-green { background: linear-gradient(135deg, #28a745, #218838); }
    .bg-red { background: linear-gradient(135deg, #dc3545, #c82333); }
    
    .kpi-number { font-size: 3em; font-weight: 700; line-height: 1.2; margin-bottom: 5px; }
    .kpi-label { font-size: 0.9em; text-transform: uppercase; letter-spacing: 1px; opacity: 0.9; }
    
    /* Caixa de Status Detalhado */
    .status-box { padding: 20px; background: #f8f9fa; border-left: 6px solid #333; margin-top: 25px; border-radius: 6px; }
    .pass { border-left-color: #28a745; background-color: #e8f5e9; }
    .fail { border-left-color: #dc3545; background-color: #fce8e6; }
    
    h3 { color: #444; border-bottom: 2px solid #eee; padding-bottom: 10px; margin-top: 30px; }
    pre { background: #1e1e1e; color: #d4d4d4; padding: 15px; border-radius: 6px; overflow-x: auto; font-size: 0.85em; border: 1px solid #333; }
</style>
"""

@app.route('/executar-teste', methods=['POST', 'GET'])
def trigger_testes():
    print(f"\n🚀 [SERVER] Iniciando execução via BAT...")
    inicio = time.time()
    
    # 1. Executa o BAT (que chama o Launcher)
    try:
        # shell=True é necessário para rodar .bat
        subprocess.run([ARQUIVO_BAT], shell=True, cwd=PASTA_PROJETO, timeout=600)
    except Exception as e:
        print(f"❌ Erro ao chamar BAT: {e}")

    duracao = f"{int(time.time() - inicio)}s"
    
    # 2. Lê o arquivo de log gerado pelo Launcher
    output = ""
    dados = {}
    
    if os.path.exists(ARQUIVO_LOG):
        try:
            with open(ARQUIVO_LOG, 'r', encoding='utf-8') as f:
                output = f.read()
                
            # Procura o JSON Mágico no meio do texto
            if "__MAKER_JSON_START__" in output:
                try:
                    json_texto = output.split("__MAKER_JSON_START__")[1].split("__MAKER_JSON_END__")[0].strip()
                    dados = json.loads(json_texto)
                except:
                    dados = {"status": "Erro Parse", "log": "Falha ao ler JSON extraído."}
            else:
                # Se não achar o JSON, tenta inferir erro pelo texto
                status_temp = "Falha" if "Traceback" in output or "Error" in output else "Desconhecido"
                dados = {"status": status_temp, "log": "JSON não encontrado no log."}
                
        except Exception as e:
            dados = {"status": "Erro Leitura", "log": str(e)}
    else:
        output = "Arquivo de log não encontrado. O Launcher falhou?"
        dados = {"status": "Erro", "log": "Log não criado."}

    # 3. Monta o HTML Bonitão
    status_geral = dados.get("status", "Desconhecido")
    
    # Define as cores
    cor_status = "bg-green" if status_geral == "Sucesso" else "bg-red"
    classe_borda = "pass" if status_geral == "Sucesso" else "fail"
    
    # Define as métricas
    val1 = dados.get("total_requisicoes", 0) if "total_requisicoes" in dados else dados.get("criticas", 0)
    lbl1 = "Requisições" if "total_requisicoes" in dados else "Falhas Críticas"
    
    val2 = dados.get("taxa_erro", "0%") if "taxa_erro" in dados else dados.get("score", "0")
    lbl2 = "Taxa de Erro" if "taxa_erro" in dados else "Score"

    html = f"""
    <div class="dashboard">
        {CSS_REPORT}
        
        <div class="summary-grid">
            <div class="kpi-card {cor_status}">
                <div class="kpi-number">{status_geral}</div>
                <div class="kpi-label">Status Geral</div>
            </div>
            <div class="kpi-card bg-blue">
                <div class="kpi-number">{val1}</div>
                <div class="kpi-label">{lbl1}</div>
            </div>
            <div class="kpi-card bg-blue">
                <div class="kpi-number">{val2}</div>
                <div class="kpi-label">{lbl2}</div>
            </div>
        </div>

        <div class="status-box {classe_borda}">
            <h3>Resumo da Execução</h3>
            <p><strong>Duração:</strong> {duracao}</p>
            <p><strong>Mensagem do Sistema:</strong> {dados.get('log', 'Sem detalhes adicionais')}</p>
        </div>
        
        <h3>Log Técnico (Launcher)</h3>
        <pre>{output[:2500]}</pre>
    </div>
    """
    
    print(f"✅ HTML gerado. Status: {status_geral}")
    
    return jsonify({
        "status": "sucesso", 
        "html_report": html, 
        "dados_brutos": dados
    })

if __name__ == '__main__':
    # use_reloader=False evita loops chatos no Windows
    app.run(host='0.0.0.0', port=5000, debug=True, use_reloader=False)