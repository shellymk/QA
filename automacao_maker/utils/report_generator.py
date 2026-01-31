#!/usr/bin/env python3
"""
Módulo de Geração de Relatórios
Gera relatórios em HTML, JSON e texto dos testes executados
"""

import json
from datetime import datetime
from typing import Dict, Any
import os
import base64


class ReportGenerator:
    """Classe para geração de relatórios de testes"""
    
    def __init__(self, output_dir: str = './reports'):
        self.output_dir = output_dir
        os.makedirs(output_dir, exist_ok=True)
        self.logo_base64 = self._load_logo()
    
    def _load_logo(self) -> str:
        """Carrega a logo em base64"""
        logo_path = os.path.join(os.path.dirname(__file__), '..', 'assets', 'LogoSudoeste_OFICIAL.png')
        try:
            with open(logo_path, 'rb') as f:
                logo_data = f.read()
                return base64.b64encode(logo_data).decode('utf-8')
        except:
            return ""
    
    def generate_json_report(self, results: Dict[str, Any], filename: str = None) -> str:
        """Gera relatório em formato JSON"""
        if not filename:
            timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
            filename = f"report_{timestamp}.json"
        
        filepath = os.path.join(self.output_dir, filename)
        
        with open(filepath, 'w', encoding='utf-8') as f:
            json.dump(results, f, indent=2, ensure_ascii=False)
        
        return filepath
    
    def generate_html_report(self, results: Dict[str, Any], filename: str = None) -> str:
        """Gera relatório em formato HTML"""
        if not filename:
            timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
            filename = f"report_{timestamp}.html"
        
        filepath = os.path.join(self.output_dir, filename)
        
        html_content = self._build_html_report(results)
        
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(html_content)
        
        return filepath
    
    def _build_html_report(self, results: Dict[str, Any]) -> str:
        """Constrói o conteúdo HTML do relatório"""
        
        # Determina o tipo de teste
        test_suite = results.get('test_suite', 'unknown')
        
        html = f"""<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Relatório de Testes - {test_suite.title()}</title>
    <style>
        * {{
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }}
        
        body {{
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
            line-height: 1.6;
            color: #333;
            background: #f5f5f5;
            padding: 20px;
        }}
        
        .container {{
            max-width: 1200px;
            margin: 0 auto;
            background: white;
            padding: 40px;
            border-radius: 8px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }}
        
        h1 {{
            color: #2c3e50;
            margin-bottom: 10px;
            font-size: 2.5em;
        }}
        
        h2 {{
            color: #34495e;
            margin-top: 30px;
            margin-bottom: 15px;
            padding-bottom: 10px;
            border-bottom: 2px solid #3498db;
        }}
        
        h3 {{
            color: #555;
            margin-top: 20px;
            margin-bottom: 10px;
        }}
        
        .header {{
            padding: 30px;
            margin-bottom: 30px;
            display: flex;
            align-items: center;
            justify-content: space-between;
            border-bottom: 2px solid #e0e0e0;
        }}
        
        .header-content {{
            flex: 1;
        }}
        
        .header h1 {{
            color: #2c3e50;
            margin: 0;
        }}
        
        .header p {{
            color: #2c3e50;
            margin: 5px 0 0 0;
        }}
        
        .header-logo {{
            max-width: 200px;
            height: auto;
            padding: 10px;
        }}
        
        .metadata {{
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 15px;
            margin-bottom: 30px;
        }}
        
        .metadata-item {{
            background: #f8f9fa;
            padding: 15px;
            border-radius: 5px;
            border-left: 4px solid #3498db;
        }}
        
        .metadata-item strong {{
            display: block;
            color: #666;
            font-size: 0.85em;
            margin-bottom: 5px;
        }}
        
        .metadata-item span {{
            font-size: 1.1em;
            color: #2c3e50;
        }}
        
        .metric-card {{
            background: #f8f9fa;
            padding: 20px;
            border-radius: 8px;
            margin-bottom: 15px;
            border-left: 4px solid #3498db;
        }}
        
        .metric-grid {{
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
            gap: 15px;
            margin-top: 15px;
        }}
        
        .metric-item {{
            text-align: center;
            padding: 15px;
            background: white;
            border-radius: 5px;
        }}
        
        .metric-value {{
            font-size: 2em;
            font-weight: bold;
            color: #3498db;
            display: block;
        }}
        
        .metric-label {{
            font-size: 0.85em;
            color: #666;
            margin-top: 5px;
        }}
        
        .issue {{
            background: white;
            padding: 20px;
            margin-bottom: 15px;
            border-radius: 5px;
            border-left: 4px solid #ccc;
        }}
        
        .issue.critical {{
            border-left-color: #e74c3c;
            background: #fef5f5;
        }}
        
        .issue.high {{
            border-left-color: #e67e22;
            background: #fef9f5;
        }}
        
        .issue.medium {{
            border-left-color: #f39c12;
            background: #fffbf5;
        }}
        
        .issue.low {{
            border-left-color: #3498db;
            background: #f5f9fe;
        }}
        
        .issue.info {{
            border-left-color: #95a5a6;
            background: #f8f9fa;
        }}
        
        .severity-badge {{
            display: inline-block;
            padding: 5px 15px;
            border-radius: 20px;
            font-size: 0.85em;
            font-weight: bold;
            text-transform: uppercase;
        }}
        
        .severity-badge.critical {{
            background: #e74c3c;
            color: white;
        }}
        
        .severity-badge.high {{
            background: #e67e22;
            color: white;
        }}
        
        .severity-badge.medium {{
            background: #f39c12;
            color: white;
        }}
        
        .severity-badge.low {{
            background: #3498db;
            color: white;
        }}
        
        .severity-badge.info {{
            background: #95a5a6;
            color: white;
        }}
        
        .issue-title {{
            font-size: 1.2em;
            font-weight: bold;
            margin-bottom: 10px;
            color: #2c3e50;
        }}
        
        .issue-description {{
            margin-bottom: 10px;
            color: #555;
        }}
        
        .issue-detail {{
            margin-top: 10px;
            padding: 10px;
            background: rgba(0,0,0,0.03);
            border-radius: 3px;
            font-size: 0.9em;
        }}
        
        .issue-detail strong {{
            color: #666;
        }}
        
        .score-container {{
            text-align: center;
            padding: 30px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            border-radius: 8px;
            margin-bottom: 30px;
        }}
        
        .score-value {{
            font-size: 4em;
            font-weight: bold;
            margin: 10px 0;
        }}
        
        .score-label {{
            font-size: 1.2em;
            opacity: 0.9;
        }}
        
        table {{
            width: 100%;
            border-collapse: collapse;
            margin: 20px 0;
        }}
        
        th, td {{
            padding: 12px;
            text-align: left;
            border-bottom: 1px solid #ddd;
        }}
        
        th {{
            background: #f8f9fa;
            font-weight: bold;
            color: #555;
        }}
        
        tr:hover {{
            background: #f8f9fa;
        }}
        
        .footer {{
            margin-top: 40px;
            padding-top: 20px;
            border-top: 1px solid #ddd;
            text-align: center;
            color: #666;
            font-size: 0.9em;
        }}
        
        code {{
            background: #f4f4f4;
            padding: 2px 6px;
            border-radius: 3px;
            font-family: 'Courier New', monospace;
            font-size: 0.9em;
        }}
        
        .success {{
            color: #27ae60;
        }}
        
        .warning {{
            color: #f39c12;
        }}
        
        .error {{
            color: #e74c3c;
        }}
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <div class="header-content">
                <h1>Relatório de Testes Automatizados</h1>
                <p>Tipo: {test_suite.title()}</p>
            </div>"""
        
        # Adiciona logo se disponível
        if self.logo_base64:
            html += f"""
            <img src="data:image/png;base64,{self.logo_base64}" alt="Logo Sudoeste" class="header-logo">
"""
        
        html += """
        </div>
"""
        
        # Adiciona informações do alvo
        if 'target' in results:
            target = results['target']
            html += f"""
        <h2>Informações do Sistema Testado</h2>
        <div class="metadata">
            <div class="metadata-item">
                <strong>Nome</strong>
                <span>{target.get('name', 'N/A')}</span>
            </div>
            <div class="metadata-item">
                <strong>URL Base</strong>
                <span>{target.get('base_url', 'N/A')}</span>
            </div>
            <div class="metadata-item">
                <strong>Data do Teste</strong>
                <span>{results.get('start_time', 'N/A')}</span>
            </div>
        </div>
"""
        
        # Relatório de Performance
        if test_suite == 'performance':
            html += self._build_performance_section(results)
        
        # Relatório de Segurança
        elif test_suite == 'security':
            html += self._build_security_section(results)
        
        # Relatório Completo
        elif test_suite == 'complete':
            if 'performance' in results:
                html += self._build_performance_section(results['performance'])
            if 'security' in results:
                html += self._build_security_section(results['security'])
        
        html += """
        <div class="footer">
            <p>Relatório gerado automaticamente pelo Framework de Testes Automatizados</p>
            <p>© 2025 - Departamento de Qualidade Fabrica de Software</p>
        </div>
    </div>
</body>
</html>
"""
        
        return html
    
    def _build_performance_section(self, results: Dict[str, Any]) -> str:
        """Constrói seção de performance do relatório HTML"""
        html = "<h2>Resultados dos Testes de Performance</h2>"
        
        tests = results.get('tests', {})
        
        # Load Test
        if 'load_test' in tests and not tests['load_test'].get('skipped'):
            load_test = tests['load_test']
            metrics = load_test.get('metrics', {})
            
            html += """
        <div class="metric-card">
            <h3>Teste de Carga</h3>
            <div class="metric-grid">
"""
            
            html += f"""
                <div class="metric-item">
                    <span class="metric-value">{metrics.get('total_requests', 0)}</span>
                    <span class="metric-label">Total de Requisições</span>
                </div>
                <div class="metric-item">
                    <span class="metric-value success">{metrics.get('success_rate', 0)}%</span>
                    <span class="metric-label">Taxa de Sucesso</span>
                </div>
                <div class="metric-item">
                    <span class="metric-value">{metrics.get('requests_per_second', 0)}</span>
                    <span class="metric-label">Requisições/seg</span>
                </div>
                <div class="metric-item">
                    <span class="metric-value">{metrics.get('response_times', {}).get('avg', 0)}ms</span>
                    <span class="metric-label">Tempo Médio</span>
                </div>
                <div class="metric-item">
                    <span class="metric-value">{metrics.get('response_times', {}).get('p95', 0)}ms</span>
                    <span class="metric-label">P95</span>
                </div>
                <div class="metric-item">
                    <span class="metric-value">{metrics.get('response_times', {}).get('p99', 0)}ms</span>
                    <span class="metric-label">P99</span>
                </div>
"""
            
            html += """
            </div>
        </div>
"""
        
        # Stress Test
        if 'stress_test' in tests and not tests['stress_test'].get('skipped'):
            stress_test = tests['stress_test']
            results_by_step = stress_test.get('results_by_step', [])
            
            html += """
        <div class="metric-card">
            <h3>Teste de Stress</h3>
            <table>
                <thead>
                    <tr>
                        <th>Usuários</th>
                        <th>Requisições</th>
                        <th>Taxa de Sucesso</th>
                        <th>Tempo Médio (ms)</th>
                        <th>P95 (ms)</th>
                        <th>RPS</th>
                    </tr>
                </thead>
                <tbody>
"""
            
            for step in results_by_step:
                metrics = step.get('metrics', {})
                html += f"""
                    <tr>
                        <td>{step.get('users', 0)}</td>
                        <td>{metrics.get('total_requests', 0)}</td>
                        <td>{metrics.get('success_rate', 0)}%</td>
                        <td>{metrics.get('response_times', {}).get('avg', 0)}</td>
                        <td>{metrics.get('response_times', {}).get('p95', 0)}</td>
                        <td>{metrics.get('requests_per_second', 0)}</td>
                    </tr>
"""
            
            html += """
                </tbody>
            </table>
        </div>
"""
        
        # Spike Test
        if 'spike_test' in tests and not tests['spike_test'].get('skipped'):
            spike_test = tests['spike_test']
            
            html += """
        <div class="metric-card">
            <h3>Teste de Spike</h3>
            <table>
                <thead>
                    <tr>
                        <th>Fase</th>
                        <th>Requisições</th>
                        <th>Taxa de Sucesso</th>
                        <th>Tempo Médio (ms)</th>
                        <th>P95 (ms)</th>
                    </tr>
                </thead>
                <tbody>
"""
            
            for phase_name, phase_key in [('Baseline', 'baseline'), ('Spike', 'spike'), ('Recuperação', 'recovery')]:
                if phase_key in spike_test:
                    metrics = spike_test[phase_key]
                    html += f"""
                    <tr>
                        <td><strong>{phase_name}</strong></td>
                        <td>{metrics.get('total_requests', 0)}</td>
                        <td>{metrics.get('success_rate', 0)}%</td>
                        <td>{metrics.get('response_times', {}).get('avg', 0)}</td>
                        <td>{metrics.get('response_times', {}).get('p95', 0)}</td>
                    </tr>
"""
            
            html += """
                </tbody>
            </table>
        </div>
"""
        
        return html
    
    def _build_security_section(self, results: Dict[str, Any]) -> str:
        """Constrói seção de segurança do relatório HTML"""
        html = ""
        
        # Score de Segurança
        if 'security_score' in results:
            score = results['security_score']
            html += f"""
        <div class="score-container">
            <div class="score-label">Score de Segurança</div>
            <div class="score-value">{score}/100</div>
        </div>
"""
        
        # Resumo de Issues
        issues = results.get('issues', {})
        total_issues = results.get('total_issues', 0)
        
        html += f"""
        <h2>Resumo de Vulnerabilidades</h2>
        <div class="metric-grid">
            <div class="metric-item">
                <span class="metric-value error">{len(issues.get('critical', []))}</span>
                <span class="metric-label">Críticas</span>
            </div>
            <div class="metric-item">
                <span class="metric-value warning">{len(issues.get('high', []))}</span>
                <span class="metric-label">Altas</span>
            </div>
            <div class="metric-item">
                <span class="metric-value">{len(issues.get('medium', []))}</span>
                <span class="metric-label">Médias</span>
            </div>
            <div class="metric-item">
                <span class="metric-value">{len(issues.get('low', []))}</span>
                <span class="metric-label">Baixas</span>
            </div>
            <div class="metric-item">
                <span class="metric-value">{len(issues.get('info', []))}</span>
                <span class="metric-label">Informativas</span>
            </div>
        </div>
"""
        
        # Detalhes das Issues
        if total_issues > 0:
            html += "<h2>Detalhes das Vulnerabilidades</h2>"
            
            for severity in ['critical', 'high', 'medium', 'low', 'info']:
                severity_issues = issues.get(severity, [])
                
                if severity_issues:
                    html += f"<h3>{severity.title()} ({len(severity_issues)})</h3>"
                    
                    for issue in severity_issues:
                        html += f"""
        <div class="issue {severity}">
            <div>
                <span class="severity-badge {severity}">{severity}</span>
            </div>
            <div class="issue-title">{issue.get('title', 'N/A')}</div>
            <div class="issue-description">{issue.get('description', 'N/A')}</div>
"""
                        
                        if issue.get('url'):
                            html += f"""
            <div class="issue-detail">
                <strong>URL:</strong> <code>{issue['url']}</code>
            </div>
"""
                        
                        if issue.get('evidence'):
                            html += f"""
            <div class="issue-detail">
                <strong>Evidência:</strong> {issue['evidence']}
            </div>
"""
                        
                        if issue.get('recommendation'):
                            html += f"""
            <div class="issue-detail">
                <strong>Recomendação:</strong> {issue['recommendation']}
            </div>
"""
                        
                        if issue.get('cwe_id'):
                            html += f"""
            <div class="issue-detail">
                <strong>CWE:</strong> <code>{issue['cwe_id']}</code>
            </div>
"""
                        
                        html += """
        </div>
"""
        else:
            html += """
        <div class="metric-card">
            <p class="success" style="text-align: center; font-size: 1.2em;">
                ✓ Nenhuma vulnerabilidade encontrada nos testes executados!
            </p>
        </div>
"""
        
        return html
    
    def generate_text_report(self, results: Dict[str, Any], filename: str = None) -> str:
        """Gera relatório em formato texto simples"""
        if not filename:
            timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
            filename = f"report_{timestamp}.txt"
        
        filepath = os.path.join(self.output_dir, filename)
        
        text_content = self._build_text_report(results)
        
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(text_content)
        
        return filepath
    
    def _build_text_report(self, results: Dict[str, Any]) -> str:
        """Constrói o conteúdo texto do relatório"""
        lines = []
        lines.append("=" * 80)
        lines.append("RELATÓRIO DE TESTES AUTOMATIZADOS")
        lines.append("=" * 80)
        lines.append("")
        
        test_suite = results.get('test_suite', 'unknown')
        lines.append(f"Tipo de Teste: {test_suite.title()}")
        lines.append(f"Data: {results.get('start_time', 'N/A')}")
        lines.append("")
        
        if 'target' in results:
            target = results['target']
            lines.append("SISTEMA TESTADO")
            lines.append("-" * 80)
            lines.append(f"Nome: {target.get('name', 'N/A')}")
            lines.append(f"URL: {target.get('base_url', 'N/A')}")
            lines.append("")
        
        if test_suite == 'security':
            lines.append("SCORE DE SEGURANÇA")
            lines.append("-" * 80)
            lines.append(f"Score: {results.get('security_score', 'N/A')}/100")
            lines.append("")
            
            lines.append("RESUMO DE VULNERABILIDADES")
            lines.append("-" * 80)
            issues = results.get('issues', {})
            lines.append(f"Críticas: {len(issues.get('critical', []))}")
            lines.append(f"Altas: {len(issues.get('high', []))}")
            lines.append(f"Médias: {len(issues.get('medium', []))}")
            lines.append(f"Baixas: {len(issues.get('low', []))}")
            lines.append(f"Informativas: {len(issues.get('info', []))}")
            lines.append("")
        
        lines.append("=" * 80)
        
        return "\n".join(lines)


if __name__ == '__main__':
    # Exemplo de uso
    generator = ReportGenerator()
    
    # Exemplo de resultado
    sample_results = {
        'test_suite': 'security',
        'target': {
            'name': 'Sistema Exemplo',
            'base_url': 'https://exemplo.com'
        },
        'start_time': datetime.now().isoformat(),
        'security_score': 75,
        'total_issues': 3,
        'issues': {
            'critical': [],
            'high': [
                {
                    'title': 'Exemplo de Vulnerabilidade',
                    'description': 'Descrição da vulnerabilidade',
                    'url': 'https://exemplo.com/api',
                    'recommendation': 'Corrija isso'
                }
            ],
            'medium': [],
            'low': [],
            'info': []
        }
    }
    
    html_path = generator.generate_html_report(sample_results)
    print(f"Relatório HTML gerado: {html_path}")
