#!/usr/bin/env python3
"""
Script Principal Blindado (Versão NASA - Com Envio Automático ao Maker)
"""
import sys
import os
import requests  # Certifique-se de que o requests está instalado no ambiente
import json
import yaml
import argparse
from datetime import datetime

# ==============================================================================
# 🛡️ CLASSE DE BLINDAGEM (MANTIDA)
# ==============================================================================
class LogBlindado:
    def __init__(self, filename):
        self.arquivo_real = open(filename, "w", encoding="utf-8", buffering=1)
        
    def write(self, message):
        try:
            self.arquivo_real.write(message)
            self.arquivo_real.flush()
        except:
            pass

    def flush(self):
        try: self.arquivo_real.flush()
        except: pass
            
    def fileno(self):
        try: return self.arquivo_real.fileno()
        except: return 1

    def isatty(self): return False
    def close(self): pass

# ATIVAÇÃO DA BLINDAGEM
logger_seguro = LogBlindado("log_blindado.txt")
sys.stdout = logger_seguro
sys.stderr = logger_seguro

# ==============================================================================
# 🚀 FRAMEWORK DE TESTES COM INTEGRAÇÃO MAKER
# ==============================================================================

# Imports protegidos
try:
    from performance_tester import PerformanceTester
    from security_tester import SecurityTester
    from report_generator import ReportGenerator
except ImportError as e:
    print(f"❌ ERRO CRITICO DE IMPORT: {e}")
    os._exit(1)

class TestFramework:
    def __init__(self, config_path):
        if not os.path.exists(config_path):
            print(f"Erro: Config não encontrada: {config_path}")
            return
            
        with open(config_path, 'r', encoding='utf-8') as f:
            self.config = yaml.safe_load(f)
        
        self.output_dir = self.config.get('reporting', {}).get('output_dir', './reports')
        self.report_generator = ReportGenerator(output_dir=self.output_dir)

    def enviar_ao_maker(self, html_path):
        """ Faz a chamada da API do Maker passando o Dashboard HTML """
        print(f"\n📤 INICIANDO ENVIO AO MAKER: {html_path}")
        
        url_maker = 'https://app.makernocode.dev/wsReceberArquivo.rule?sys=D7Q'
        headers = {
            'hash-integracao': '9379163a7cef17594e91a31605116feb',
            'hash-chat': '9379163a7cef17594e91a31605116feb'
        }

        try:
            if not os.path.exists(html_path):
                print(f"❌ Erro: Arquivo {html_path} não encontrado para envio.")
                return

            with open(html_path, 'rb') as f:
                files = {
                    'arquivo': (os.path.basename(html_path), f, 'text/html'),
                    'nomeArquivo': (None, 'Dashboard_QA_Automacao'),
                    'extensao': (None, 'html'),
                    'sys': (None, 'D7Q')
                }
                
                response = requests.post(url_maker, headers=headers, files=files, timeout=30)
                
            if response.status_code == 200:
                print("✅ DASHBOARD ENVIADO COM SUCESSO AO MAKER!")
            else:
                print(f"⚠️ MAKER RESPONDEU COM ERRO: {response.status_code} - {response.text}")

        except Exception as e:
            print(f"❌ FALHA NA COMUNICAÇÃO COM O MAKER: {e}")

    def run_all_tests(self):
        results = {'test_suite': 'complete'}
        if self.config.get('performance', {}).get('enabled', True):
            print("\n" + "="*80 + "\nINICIANDO PERFORMANCE\n" + "="*80)
            tester = PerformanceTester(self.config)
            results['performance'] = tester.run_all_tests()
            
        if self.config.get('security', {}).get('enabled', True):
            print("\n" + "="*80 + "\nINICIANDO SEGURANÇA\n" + "="*80)
            tester = SecurityTester(self.config)
            results['security'] = tester.run_all_tests()
        return results

    def generate_reports(self, results):
        print("\nGERANDO RELATÓRIOS...")
        formats = self.config.get('reporting', {}).get('formats', ['html', 'json'])
        
        # Log JSON no Console (Seu padrão)
        print("\n__MAKER_JSON_START__")
        print(json.dumps(results))
        print("__MAKER_JSON_END__\n")
        
        # Geração do Arquivo Físico e Envio
        try:
            if 'html' in formats:
                nome_arquivo = f'report_{datetime.now().strftime("%H%M%S")}.html'
                # O ReportGenerator deve retornar o path completo ou usamos a config
                self.report_generator.generate_html_report(results, nome_arquivo)
                
                path_completo = os.path.join(self.output_dir, nome_arquivo)
                
                # CHAMADA DA API DO MAKER AQUI
                self.enviar_ao_maker(path_completo)
        except Exception as e:
            print(f"Erro na geração/envio do relatório: {e}")

# ==============================================================================
# 🏁 EXECUÇÃO PRINCIPAL
# ==============================================================================

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('-c', '--config', default='config/config.yaml')
    args = parser.parse_args()

    try:
        framework = TestFramework(args.config)
        results = framework.run_all_tests()
        framework.generate_reports(results)
        
        print("\n" + "="*80)
        print("🚀 PROCESSO FINALIZADO COM SUCESSO!")
        print("="*80)
        
    except Exception as e:
        print(f"\n❌ ERRO NO MAIN: {e}")

if __name__ == '__main__':
    try:
        main()
    except:
        pass
    finally:
        try:
            if 'logger_seguro' in globals():
                logger_seguro.arquivo_real.close()
        except: pass
        os._exit(0)

       #outros testes:  
       # 





       
      ## def enviar_arquivo_ao_maker():
    """Faz a requisição POST para o Maker com o arquivo gerado"""
    try:
        # Pequena pausa para garantir que o arquivo não esteja travado pelo SO
        time.sleep(2)
        
        if not os.path.exists(ARQUIVO_PARA_ENVIO):
            msg = f"⚠️ Erro: Arquivo {ARQUIVO_PARA_ENVIO} não encontrado para upload."
            print(msg)
            log_queue.put(msg)
            return

        print(f"📤 Enviando arquivo para o Maker: {ARQUIVO_PARA_ENVIO}")
        
      

        with open(ARQUIVO_PARA_ENVIO, 'rb') as f:
            files = {
                'arquivo': (os.path.basename(ARQUIVO_PARA_ENVIO), f, 'text/plain'),
                'nomeArquivo': (None, 'log_blindado'),
                'extensao': (None, 'txt'),
                'sys': (None, 'D7Q')
            }
            
            response = requests.post(URL_MAKER_UPLOAD,  files=files)
            
        if response.status_code == 200:
            print("✅ Sucesso: Arquivo enviado e processado pelo Maker.")
            log_queue.put("--- ARQUIVO ENVIADO AO MAKER COM SUCESSO ---")
        else:
            print(f"❌ Erro no Maker: {response.status_code} - {response.text}")
            log_queue.put(f"--- ERRO AO ENVIAR ARQUIVO: {response.status_code} ---")

    except Exception as e:
        print(f"❌ Erro crítico no upload: {str(e)}")
        log_queue.put(f"Erro no upload: {str(e)}") ###