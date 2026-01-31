"""
Módulo de Geração de Relatórios com Logo
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
