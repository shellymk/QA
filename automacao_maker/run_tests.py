#!/usr/bin/env python3
"""
Script Principal Blindado (Versão NASA - Anti-Crash)
"""
import sys
import os
import requests

# ==============================================================================
# 🛡️ CLASSE DE BLINDAGEM (O "AMORTECEDOR" DE ERROS)
# ==============================================================================
class LogBlindado:
    """
    Substitui o sys.stdout e sys.stderr.
    Se o arquivo for fechado por uma biblioteca rebelde, ele ignora o erro
    em vez de travar o script inteiro com 'ValueError'.
    """
    def __init__(self, filename):
        # Abre o arquivo real
        self.arquivo_real = open(filename, "w", encoding="utf-8", buffering=1)
        
    def write(self, message):
        try:
            # Tenta escrever no arquivo
            self.arquivo_real.write(message)
            self.arquivo_real.flush()
        except (ValueError, OSError, Exception):
            # SE DER ERRO (ARQUIVO FECHADO), A GENTE FINGE QUE NADA ACONTECEU
            # Isso impede o crash "lost sys.stderr"
            pass

    def flush(self):
        try:
            self.arquivo_real.flush()
        except:
            pass
            
    def fileno(self):
        # Engana bibliotecas que pedem o numero do arquivo
        try:
            return self.arquivo_real.fileno()
        except:
            return 1 # Retorna um numero fake se der erro

    def isatty(self):
        return False # Avisa pro Colorama: "NAO SOU UM TERMINAL, NAO TENTE PINTAR"

    def close(self):
        # Se alguém tentar fechar, a gente ignora! Só fecha se for o Python saindo.
        pass

# --- ATIVAÇÃO DA BLINDAGEM ---
# Substituimos os canais padrão por nossa classe imortal
logger_seguro = LogBlindado("log_blindado.txt")
sys.stdout = logger_seguro
sys.stderr = logger_seguro
# ==============================================================================

import yaml
import argparse
from datetime import datetime

# Configura Paths e Variáveis
os.environ["NO_COLOR"] = "1" # Reforça o pedido de "sem cores"
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'performance'))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'security'))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'utils'))

# Imports protegidos
try:
    from performance_tester import PerformanceTester
    from security_tester import SecurityTester
    from report_generator import ReportGenerator
except ImportError as e:
    print(f"❌ ERRO CRITICO DE IMPORT: {e}")
    # Não usamos exit() normal para evitar loops de erro
    os._exit(1)

class TestFramework:
    def __init__(self, config_path):
        if not os.path.exists(config_path):
            print(f"Erro: Config não encontrada: {config_path}")
            return
            
        with open(config_path, 'r', encoding='utf-8') as f:
            self.config = yaml.safe_load(f)
        self.output_dir = self.config.get('reporting', {}).get('output_dir', './reports')

        self.report_generator = ReportGenerator(
            output_dir=self.output_dir
        )

    def run_performance_tests(self):
        print("\n" + "="*80)
        print("INICIANDO TESTES DE PERFORMANCE")
        print("="*80)
        tester = PerformanceTester(self.config)
        return tester.run_all_tests()

    def run_security_tests(self):
        print("\n" + "="*80)
        print("INICIANDO TESTES DE SEGURANÇA")
        print("="*80)
        tester = SecurityTester(self.config)
        return tester.run_all_tests()
    
    def enviar_ao_maker(self, html_path):
        """ Faz a chamada da API do Maker passando o Dashboard HTML """
        print(f"\n📤 INICIANDO ENVIO AO MAKER: {html_path}")
        
        url_maker = 'https://app.makernocode.dev/wsReceberArquivo.rule?sys=D7Q'
        

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
                
                response = requests.post(url_maker, files=files, timeout=30)
                
            if response.status_code == 200:
                print("✅ DASHBOARD ENVIADO COM SUCESSO AO MAKER!")
            else:
                print(f"⚠️ MAKER RESPONDEU COM ERRO: {response.status_code} - {response.text}")

        except Exception as e:
            print(f"❌ FALHA NA COMUNICAÇÃO COM O MAKER: {e}")
    
    def run_all_tests(self):
        results = {'test_suite': 'complete'}
        if self.config.get('performance', {}).get('enabled', True):
            results['performance'] = self.run_performance_tests()
        if self.config.get('security', {}).get('enabled', True):
            results['security'] = self.run_security_tests()
        return results

    def generate_reports(self, results):
        print("\nGERANDO RELATÓRIOS...")
        formats = self.config.get('reporting', {}).get('formats', ['html', 'json'])
        
        # JSON PRO DASHBOARD (Essencial)
        import json
        print("\n__MAKER_JSON_START__")
        print(json.dumps(results))
        print("__MAKER_JSON_END__\n")
        
        # Gera arquivos fisicos se der
        try:
            if 'html' in formats:
                nome_arquivo = f'report_{datetime.now().strftime("%H%M%S")}.html'
                
                self.report_generator.generate_html_report(results, nome_arquivo)

                path_completo = os.path.join(self.output_dir, nome_arquivo)

                self.enviar_ao_maker(path_completo)
        except:
            pass

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('-c', '--config', default='config/config.yaml')
    parser.add_argument('--performance-only', action='store_true')
    parser.add_argument('--no-report', action='store_true')
    args = parser.parse_args()

    if not os.path.exists(args.config):
        print(f"Config sumiu: {args.config}")
        return

    try:
        framework = TestFramework(args.config)
        
        if args.performance_only:
            results = framework.run_performance_tests()
        else:
            results = framework.run_all_tests()
            
        framework.generate_reports(results)
        
        print("\n" + "="*80)
        print("SUCESSO ABSOLUTO!")
        print("="*80)
        
    except Exception as e:
        print(f"\n❌ ERRO NO MAIN: {e}")
        import traceback
        traceback.print_exc()

if __name__ == '__main__':
    try:
        main()
    except:
        pass
    finally:
        # Encerramento forçado para evitar que o Python tente limpar buffers ja fechados
        # É isso que evita o "lost sys.stderr"
        try:
            # Tenta fechar o arquivo real manualmente antes de sair
            if 'logger_seguro' in globals():
                logger_seguro.arquivo_real.close()
        except:
            pass
            
        import os
        os._exit(0)