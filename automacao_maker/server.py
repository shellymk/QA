# -*- coding: utf-8 -*-
from flask import Flask, jsonify, request, Response
from flask_cors import CORS
import subprocess
import json
import time
import os
import threading
import queue
import re

app = Flask(__name__)
CORS(app)

# --- CONFIGURAÇÕES ---
PASTA_PROJETO = r'E:/GitHub/QA/automacao_maker'
ARQUIVO_BAT = os.path.join(PASTA_PROJETO, 'executar_testes.bat')
ARQUIVO_LOG = os.path.join(PASTA_PROJETO, 'log_blindado.txt')

# --- O SEU CSS REPORT (MANTIDO!) ---
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

# --- GERENCIAMENTO DE LOGS ---
log_queue = queue.Queue()
processo_atual = None
monitor_thread = None

class LogMonitor:
    def __init__(self, file_path):
        self.file_path = file_path
        self.stop_event = threading.Event()

    def clean_ansi(self, text):
        ansi_escape = re.compile(r'\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])')
        return ansi_escape.sub('', text)

    def watch(self):
        if os.path.exists(self.file_path):
            os.remove(self.file_path)
        
        with open(self.file_path, "w") as f:
            f.write("")

        last_size = 0
        while not self.stop_event.is_set():
            if os.path.exists(self.file_path):
                current_size = os.path.getsize(self.file_path)
                if current_size > last_size:
                    with open(self.file_path, "r", encoding='cp1252', errors='ignore') as f:
                        f.seek(last_size)
                        new_data = f.read()
                        if new_data:
                            clean_data = self.clean_ansi(new_data)
                            log_queue.put(clean_data)
                        last_size = current_size
            time.sleep(0.5)

def run_bat():
    global processo_atual
    try:
        processo_atual = subprocess.Popen(
            ARQUIVO_BAT,
            shell=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding='cp1252'
        )
        processo_atual.wait()
    except Exception as e:
        log_queue.put(f"Erro ao executar BAT: {str(e)}")

@app.route('/executar-automacao', methods=['POST'])
def executar_automacao():
    
    global monitor_thread, processo_atual
    
    # Blindagem para o Maker: silent=True evita erro 400
    data = request.get_json(silent=True) or {}
    
    if processo_atual and processo_atual.poll() is None:
        return jsonify({"status": "erro", "mensagem": "Uma automação já está em curso."}), 400

    while not log_queue.empty():
        log_queue.get()

    monitor = LogMonitor(ARQUIVO_LOG)
    monitor_thread = threading.Thread(target=monitor.watch)
    monitor_thread.start()

    threading.Thread(target=run_bat).start()
    time.sleep(2)

    # Leitura blindada do log com tratamento de encoding
    conteudo_log = ""
    if os.path.exists(ARQUIVO_LOG):
        try:
            with open(ARQUIVO_LOG, 'r', encoding='utf-8') as f:
                conteudo_log = f.read()
        except UnicodeDecodeError:
            with open(ARQUIVO_LOG, 'r', encoding='cp1252') as f:
                conteudo_log = f.read()

    return jsonify({
        "status": "sucesso",
        "mensagem": "Automação iniciada",
        "css_report": CSS_REPORT,  # SEU CSS DE VOLTA AQUI!
        "log_inicial": monitor.clean_ansi(conteudo_log)
    }), 200

@app.route('/stream-logs')
def stream_logs():
    def generate():
        while True:
            try:
                data = log_queue.get(timeout=10)
                yield f"data: {json.dumps({'log': data})}\n\n"
            except queue.Empty:
                if processo_atual and processo_atual.poll() is not None:
                    yield f"data: {json.dumps({'log': '--- FIM DA EXECUÇÃO ---'})}\n\n"
                    break
                yield ": keep-alive\n\n"
    return Response(generate(), mimetype='text/event-stream')

@app.route('/parar-automacao', methods=['POST'])
def parar_automacao():
    global processo_atual
    if processo_atual and processo_atual.poll() is None:
        subprocess.run(['taskkill', '/F', '/T', '/PID', str(processo_atual.pid)], shell=True)
        return jsonify({"status": "sucesso", "mensagem": "Automação interrompida."}), 200
    return jsonify({"status": "erro", "mensagem": "Nenhuma automação em curso."}), 400

@app.route('/status', methods=['GET'])
def status():
    """Verifica se o servidor está online e se há automação rodando"""
    em_execucao = processo_atual and processo_atual.poll() is None
    return jsonify({
        "status": "online",
        "em_execucao": em_execucao,
        "projeto": PASTA_PROJETO
    }), 200

@app.route('/gerar-relatorio', methods=['POST'])
def gerar_relatorio():
    """Gera relatório HTML com seus CSS_REPORT"""
    try:
        # Pega os dados do request
        data = request.get_json(silent=True) or {}
        dados = data.get('dados', {})
        output = data.get('output', '')
        duracao = data.get('duracao', 'Desconhecido')
        
        # Monta o HTML Bonitão
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
        }), 200
    
    except Exception as e:
        return jsonify({
            "status": "erro",
            "mensagem": f"Erro ao gerar relatório: {str(e)}"
        }), 500

# --- Inicialização do Servidor ---
if __name__ == '__main__':
    print("=" * 50)
    print("🚀 Servidor Flask - Automação QA")
    print("=" * 50)
    print(f"📂 Pasta do Projeto: {PASTA_PROJETO}")
    print(f"📄 Arquivo BAT: {ARQUIVO_BAT}")
    print(f"📋 Arquivo LOG: {ARQUIVO_LOG}")
    print("=" * 50)
    
    if not os.path.exists(PASTA_PROJETO):
        print(f"⚠️  AVISO: A pasta {PASTA_PROJETO} não foi encontrada!")
    
    print("🌐 Servidor rodando em: http://0.0.0.0:5000")
    print("=" * 50)
    
    app.run(host='0.0.0.0', port=5000, debug=True)