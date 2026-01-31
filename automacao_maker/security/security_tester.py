#!/usr/bin/env python3
"""
Módulo de Testes de Segurança
Realiza testes de vulnerabilidades web, autenticação, injeção e análise de rede
"""
import sys
import os
import re
import ssl
import socket
import requests
import urllib.parse
from typing import List, Dict, Any, Tuple
from dataclasses import dataclass, field
from datetime import datetime
import json
import hashlib

import urllib3
# Desabilita avisos de certificado SSL (necessário para testes de segurança)
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

# ============================================================================
# NOTA: Não redefinimos sys.stdout aqui porque o run_tests.py já cuida disso.
# Isso garante compatibilidade com o sistema de Log Blindado.
# ============================================================================

@dataclass
class SecurityIssue:
    """Representa uma vulnerabilidade ou problema de segurança encontrado"""
    severity: str  # critical, high, medium, low, info
    category: str
    title: str
    description: str
    url: str = None
    evidence: str = None
    recommendation: str = None
    cwe_id: str = None
    timestamp: datetime = field(default_factory=datetime.now)
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            'severity': self.severity,
            'category': self.category,
            'title': self.title,
            'description': self.description,
            'url': self.url,
            'evidence': self.evidence,
            'recommendation': self.recommendation,
            'cwe_id': self.cwe_id,
            'timestamp': self.timestamp.isoformat()
        }


class SecurityTester:
    """Classe principal para testes de segurança"""
    
    def __init__(self, config: Dict[str, Any]):
        self.config = config
        self.target = config.get('target', {})
        self.sec_config = config.get('security', {})
        self.timeout = config.get('general', {}).get('timeout', 30)
        self.session = requests.Session()
        # Define User-Agent de segurança para não ser bloqueado por WAFs simples
        self.session.headers.update({
            'User-Agent': 'Mozilla/5.0 (Security-Audit/1.0)'
        })
        self.issues: List[SecurityIssue] = []
        
        # Payloads para testes de injeção
        self.sql_payloads = [
            "' OR '1'='1",
            "' OR '1'='1' --",
            "' OR '1'='1' /*",
            "admin' --",
            "1' UNION SELECT NULL--",
            "' AND 1=0 UNION ALL SELECT 'admin', '81dc9bdb52d04dc20036dbd8313ed055'",
        ]
        
        self.xss_payloads = [
            "<script>alert('XSS')</script>",
            "<img src=x onerror=alert('XSS')>",
            "<svg/onload=alert('XSS')>",
            "javascript:alert('XSS')",
            "<iframe src='javascript:alert(\"XSS\")'></iframe>",
            "'\"><script>alert(String.fromCharCode(88,83,83))</script>",
        ]
        
        self.command_injection_payloads = [
            "; ls -la",
            "| whoami",
            "& dir",
            "`id`",
            "$(whoami)",
            "; cat /etc/passwd",
        ]
    
    def _add_issue(self, issue: SecurityIssue):
        """Adiciona uma vulnerabilidade à lista"""
        self.issues.append(issue)
        # Emojis são seguros aqui pois o LogBlindado usa UTF-8
        severity_emoji = {
            'critical': '🔴',
            'high': '🟠',
            'medium': '🟡',
            'low': '🔵',
            'info': 'ℹ️'
        }
        print(f"  {severity_emoji.get(issue.severity, '•')} [{issue.severity.upper()}] {issue.title}")
    
    def test_sql_injection(self) -> List[SecurityIssue]:
        """Testa vulnerabilidades de SQL Injection"""
        print("\n[SECURITY] Testando SQL Injection...")
        
        endpoints = self.target.get('api_endpoints', []) + self.target.get('web_endpoints', [])
        base_url = self.target['base_url']
        
        for endpoint in endpoints:
            url = f"{base_url}{endpoint}"
            
            # Testa em parâmetros GET
            for payload in self.sql_payloads:
                test_url = f"{url}?id={urllib.parse.quote(payload)}"
                
                try:
                    response = self.session.get(test_url, timeout=self.timeout)
                    
                    # Procura por indicadores de SQL injection
                    sql_errors = [
                        'sql syntax', 'mysql_fetch', 'postgresql', 'ora-',
                        'sqlite', 'syntax error', 'unclosed quotation',
                        'quoted string not properly terminated'
                    ]
                    
                    response_lower = response.text.lower()
                    for error in sql_errors:
                        if error in response_lower:
                            self._add_issue(SecurityIssue(
                                severity='critical',
                                category='injection',
                                title='Possível SQL Injection',
                                description=f'O endpoint pode ser vulnerável a SQL Injection. Erro detectado.',
                                url=test_url,
                                evidence=f'Payload: {payload}, Error pattern: {error}',
                                recommendation='Utilize prepared statements ou ORM.',
                                cwe_id='CWE-89'
                            ))
                            break
                
                except Exception:
                    pass 
        
        return self.issues
    
    def test_xss(self) -> List[SecurityIssue]:
        """Testa vulnerabilidades de Cross-Site Scripting (XSS)"""
        print("\n[SECURITY] Testando XSS (Cross-Site Scripting)...")
        
        endpoints = self.target.get('web_endpoints', [])
        base_url = self.target['base_url']
        
        for endpoint in endpoints:
            url = f"{base_url}{endpoint}"
            
            for payload in self.xss_payloads:
                test_url = f"{url}?q={urllib.parse.quote(payload)}"
                
                try:
                    response = self.session.get(test_url, timeout=self.timeout)
                    
                    if payload in response.text or payload.replace('"', '&quot;') in response.text:
                        self._add_issue(SecurityIssue(
                            severity='high',
                            category='injection',
                            title='Possível XSS Refletido',
                            description='O endpoint reflete entrada do usuário sem sanitização.',
                            url=test_url,
                            evidence=f'Payload refletido: {payload}',
                            recommendation='Encode todas as saídas HTML. Use CSP.',
                            cwe_id='CWE-79'
                        ))
                        break
                except Exception:
                    pass
        
        return self.issues
    
    def test_security_headers(self) -> List[SecurityIssue]:
        """Verifica presença de headers de segurança importantes"""
        print("\n[SECURITY] Verificando Headers de Segurança...")
        
        url = self.target['base_url']
        
        try:
            response = self.session.get(url, timeout=self.timeout)
            headers = response.headers
            
            security_headers = {
                'X-Frame-Options': {'severity': 'medium', 'desc': 'Protege contra clickjacking'},
                'X-Content-Type-Options': {'severity': 'low', 'desc': 'Previne MIME sniffing'},
                'Strict-Transport-Security': {'severity': 'high', 'desc': 'Força HTTPS'},
                'Content-Security-Policy': {'severity': 'medium', 'desc': 'Previne XSS'},
                'X-XSS-Protection': {'severity': 'low', 'desc': 'Filtro XSS do navegador'},
                'Referrer-Policy': {'severity': 'low', 'desc': 'Controla Referrer'},
                'Permissions-Policy': {'severity': 'low', 'desc': 'Controla recursos'}
            }
            
            for header, info in security_headers.items():
                if header not in headers:
                    self._add_issue(SecurityIssue(
                        severity=info['severity'],
                        category='configuration',
                        title=f'Header Ausente: {header}',
                        description=info['desc'],
                        url=url,
                        recommendation=f'Adicione o header {header}',
                        cwe_id='CWE-693'
                    ))
            
            sensitive_headers = ['Server', 'X-Powered-By', 'X-AspNet-Version']
            for header in sensitive_headers:
                if header in headers:
                    self._add_issue(SecurityIssue(
                        severity='info',
                        category='information_disclosure',
                        title=f'Header Expõe Info: {header}',
                        description=f'Header {header} revela tecnologia do servidor.',
                        url=url,
                        evidence=f'{header}: {headers[header]}',
                        recommendation=f'Remova o header {header}',
                        cwe_id='CWE-200'
                    ))
        
        except Exception as e:
            print(f"  Erro ao verificar headers: {e}")
        
        return self.issues
    
    def test_ssl_tls(self) -> List[SecurityIssue]:
        """Verifica configuração SSL/TLS"""
        print("\n[SECURITY] Verificando SSL/TLS...")
        
        url = self.target['base_url']
        
        if not url.startswith('https://'):
            self._add_issue(SecurityIssue(
                severity='high',
                category='transport_security',
                title='HTTPS Não Utilizado',
                description='O sistema não utiliza HTTPS.',
                url=url,
                recommendation='Force HTTPS.',
                cwe_id='CWE-319'
            ))
            return self.issues
        
        hostname = url.replace('https://', '').split('/')[0].split(':')[0]
        port = 443
        if ':' in url.replace('https://', '').split('/')[0]:
            try:
                port = int(url.replace('https://', '').split('/')[0].split(':')[1])
            except:
                pass
        
        try:
            context = ssl.create_default_context()
            with socket.create_connection((hostname, port), timeout=self.timeout) as sock:
                with context.wrap_socket(sock, server_hostname=hostname) as ssock:
                    cipher = ssock.cipher()
                    version = ssock.version()
                    
                    if version in ['SSLv2', 'SSLv3', 'TLSv1', 'TLSv1.1']:
                        self._add_issue(SecurityIssue(
                            severity='high',
                            category='transport_security',
                            title='Protocolo Inseguro',
                            description=f'Servidor suporta {version}',
                            url=url,
                            recommendation='Use apenas TLSv1.2+',
                            cwe_id='CWE-326'
                        ))
                    
                    weak_ciphers = ['DES', 'RC4', 'MD5', 'NULL', 'EXPORT']
                    cipher_name = cipher[0] if cipher else ''
                    for weak in weak_ciphers:
                        if weak in cipher_name.upper():
                            self._add_issue(SecurityIssue(
                                severity='high',
                                category='transport_security',
                                title='Cifra Fraca',
                                description=f'Cifra fraca detectada: {cipher_name}',
                                url=url,
                                recommendation='Configure cifras fortes.',
                                cwe_id='CWE-327'
                            ))
                            break
        except Exception as e:
            print(f"  Aviso: Não foi possível verificar SSL completamente: {e}")
        
        return self.issues
    
    def test_cors(self) -> List[SecurityIssue]:
        """Verifica configuração de CORS"""
        print("\n[SECURITY] Verificando CORS...")
        url = self.target['base_url']
        
        try:
            headers = {'Origin': 'https://evil.com'}
            response = self.session.get(url, headers=headers, timeout=self.timeout)
            
            if 'Access-Control-Allow-Origin' in response.headers:
                allowed = response.headers['Access-Control-Allow-Origin']
                if allowed == '*' or allowed == 'https://evil.com':
                    self._add_issue(SecurityIssue(
                        severity='medium',
                        category='configuration',
                        title='CORS Permissivo',
                        description=f'CORS permite origem insegura: {allowed}',
                        url=url,
                        recommendation='Restrinja origens CORS.',
                        cwe_id='CWE-942'
                    ))
        except Exception:
            pass
        return self.issues
    
    def test_command_injection(self) -> List[SecurityIssue]:
        """Testa Command Injection"""
        print("\n[SECURITY] Testando Command Injection...")
        endpoints = self.target.get('api_endpoints', [])
        base_url = self.target['base_url']
        
        for endpoint in endpoints:
            url = f"{base_url}{endpoint}"
            for payload in self.command_injection_payloads:
                test_url = f"{url}?cmd={urllib.parse.quote(payload)}"
                try:
                    response = self.session.get(test_url, timeout=self.timeout)
                    indicators = ['root:', 'bin/bash', 'uid=', 'volume serial number']
                    for indicator in indicators:
                        if indicator in response.text.lower():
                            self._add_issue(SecurityIssue(
                                severity='critical',
                                category='injection',
                                title='Possível Command Injection',
                                description='Execução de comando detectada.',
                                url=test_url,
                                evidence=f'Payload: {payload}',
                                recommendation='Evite chamadas de sistema.',
                                cwe_id='CWE-78'
                            ))
                            break
                except Exception:
                    pass
        return self.issues
    
    def test_authentication(self) -> List[SecurityIssue]:
        """Testa senhas fracas"""
        print("\n[SECURITY] Testando Autenticação...")
        base_url = self.target['base_url']
        weak_passwords = ['password', '123456', 'admin']
        common_users = ['admin', 'user']
        login_endpoints = ['/login', '/api/login', '/auth/login']
        
        for endpoint in login_endpoints:
            url = f"{base_url}{endpoint}"
            try:
                if self.session.get(url, timeout=self.timeout).status_code == 404:
                    continue
                
                for user in common_users:
                    for password in weak_passwords:
                        try:
                            res = self.session.post(url, json={'username': user, 'password': password}, timeout=self.timeout)
                            if res.status_code == 200:
                                self._add_issue(SecurityIssue(
                                    severity='critical',
                                    category='authentication',
                                    title='Credenciais Fracas',
                                    description=f'Login aceito: {user}/{password}',
                                    url=url,
                                    recommendation='Force senhas fortes.',
                                    cwe_id='CWE-521'
                                ))
                        except: pass
            except: pass
        return self.issues
    
    def test_rate_limiting(self) -> List[SecurityIssue]:
        """Testa Rate Limiting"""
        print("\n[SECURITY] Testando Rate Limiting...")
        url = self.target['base_url']
        try:
            responses = []
            for _ in range(30): # Reduzi para 30 para ser mais rapido
                responses.append(self.session.get(url, timeout=self.timeout).status_code)
            
            if 429 not in responses:
                self._add_issue(SecurityIssue(
                    severity='medium',
                    category='configuration',
                    title='Sem Rate Limiting',
                    description='Não houve bloqueio após múltiplas requisições.',
                    url=url,
                    recommendation='Implemente Rate Limiting.',
                    cwe_id='CWE-770'
                ))
        except: pass
        return self.issues
    
    def scan_ports(self) -> List[SecurityIssue]:
        """Scan básico de portas"""
        print("\n[SECURITY] Realizando Scan de Portas...")
        try:
            hostname = self.target['base_url'].replace('https://', '').replace('http://', '').split('/')[0].split(':')[0]
            ports = self.sec_config.get('network_scan', {}).get('ports', [80, 443, 8080])
            
            risky = {21: 'FTP', 23: 'Telnet', 3306: 'MySQL', 5432: 'Postgres', 6379: 'Redis'}
            
            for port in ports:
                try:
                    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
                    sock.settimeout(1)
                    if sock.connect_ex((hostname, port)) == 0:
                        print(f"  ✓ Porta {port} aberta")
                        if port in risky:
                            self._add_issue(SecurityIssue(
                                severity='high',
                                category='network',
                                title=f'Porta Insegura: {port}',
                                description=f'Porta {port} ({risky[port]}) exposta.',
                                recommendation='Feche a porta via firewall.',
                                cwe_id='CWE-16'
                            ))
                    sock.close()
                except: pass
        except: pass
        return self.issues
    
    def run_all_tests(self) -> Dict[str, Any]:
        """Executa todos os testes"""
        results = {
            'test_suite': 'security',
            'target': self.target,
            'start_time': datetime.now().isoformat(),
            'tests_executed': []
        }
        
        # Sequencia de execução
        self.test_sql_injection()
        self.test_xss()
        self.test_security_headers()
        self.test_ssl_tls()
        self.test_cors()
        self.test_command_injection()
        self.test_authentication()
        self.test_rate_limiting()
        self.scan_ports()
        
        # Organiza resultados
        issues_by_severity = {'critical': [], 'high': [], 'medium': [], 'low': [], 'info': []}
        for issue in self.issues:
            issues_by_severity[issue.severity].append(issue.to_dict())
        
        results['issues'] = issues_by_severity
        results['total_issues'] = len(self.issues)
        results['end_time'] = datetime.now().isoformat()
        
        # Score
        weights = {'critical': 10, 'high': 5, 'medium': 2, 'low': 1, 'info': 0}
        deduction = sum(weights[i.severity] for i in self.issues)
        results['security_score'] = max(0, 100 - deduction)
        
        return results

if __name__ == '__main__':
    # Para teste isolado
    print("Execute pelo run_tests.py para integração completa.")