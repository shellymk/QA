#!/usr/bin/env python3
"""
Aplicação de Exemplo para Demonstração do Framework
Uma API REST simples com algumas vulnerabilidades intencionais para teste
"""

from flask import Flask, request, jsonify, make_response
import time
import random

app = Flask(__name__)

# Simulação de banco de dados
users_db = {
    'admin': {'password': 'admin123', 'role': 'admin'},
    'user': {'password': 'password', 'role': 'user'}
}

products_db = [
    {'id': 1, 'name': 'Produto A', 'price': 100.0},
    {'id': 2, 'name': 'Produto B', 'price': 200.0},
    {'id': 3, 'name': 'Produto C', 'price': 300.0}
]


@app.route('/')
def index():
    """Página inicial"""
    return jsonify({
        'message': 'API de Exemplo para Testes',
        'version': '1.0.0',
        'endpoints': [
            '/api/health',
            '/api/users',
            '/api/products',
            '/api/search',
            '/login'
        ]
    })


@app.route('/api/health')
def health():
    """Endpoint de health check"""
    # Simula latência variável
    time.sleep(random.uniform(0.01, 0.1))
    
    return jsonify({
        'status': 'healthy',
        'timestamp': time.time()
    })


@app.route('/api/users')
def get_users():
    """Lista usuários (vulnerável a SQL injection simulado)"""
    user_id = request.args.get('id', '')
    
    # Simula latência
    time.sleep(random.uniform(0.05, 0.2))
    
    # Vulnerabilidade intencional: SQL Injection simulado
    if "'" in user_id or '--' in user_id:
        return jsonify({
            'error': 'SQL syntax error near \'' + user_id + '\''
        }), 500
    
    return jsonify({
        'users': list(users_db.keys())
    })


@app.route('/api/products')
def get_products():
    """Lista produtos"""
    # Simula latência variável
    time.sleep(random.uniform(0.05, 0.15))
    
    # Simula erro ocasional (5% de chance)
    if random.random() < 0.05:
        return jsonify({'error': 'Database connection error'}), 500
    
    return jsonify({
        'products': products_db
    })


@app.route('/api/search')
def search():
    """Busca (vulnerável a XSS)"""
    query = request.args.get('q', '')
    
    # Simula latência
    time.sleep(random.uniform(0.1, 0.3))
    
    # Vulnerabilidade intencional: XSS - reflete entrada sem sanitização
    return f"""
    <html>
        <body>
            <h1>Resultados da busca</h1>
            <p>Você buscou por: {query}</p>
        </body>
    </html>
    """


@app.route('/login', methods=['GET', 'POST'])
def login():
    """Endpoint de login (vulnerável a credenciais fracas)"""
    if request.method == 'GET':
        return jsonify({'message': 'Use POST para fazer login'})
    
    data = request.get_json() or {}
    username = data.get('username', '')
    password = data.get('password', '')
    
    # Simula latência de autenticação
    time.sleep(random.uniform(0.2, 0.5))
    
    # Vulnerabilidade intencional: aceita credenciais fracas
    if username in users_db and users_db[username]['password'] == password:
        return jsonify({
            'success': True,
            'message': 'Login successful',
            'user': username,
            'role': users_db[username]['role']
        })
    
    return jsonify({
        'success': False,
        'message': 'Invalid credentials'
    }), 401


@app.route('/dashboard')
def dashboard():
    """Dashboard (sem proteção CSRF)"""
    # Vulnerabilidade intencional: sem proteção CSRF
    return jsonify({
        'message': 'Dashboard data',
        'data': 'Sensitive information'
    })


@app.after_request
def after_request(response):
    """Adiciona headers (alguns faltando intencionalmente)"""
    # Vulnerabilidade intencional: headers de segurança faltando
    response.headers['Server'] = 'Flask/2.0.1 Python/3.9'  # Expõe versão
    # Faltam: X-Frame-Options, X-Content-Type-Options, CSP, etc.
    return response


if __name__ == '__main__':
    print("="*60)
    print("APLICAÇÃO DE EXEMPLO PARA TESTES")
    print("="*60)
    print("\nEsta aplicação contém vulnerabilidades INTENCIONAIS para demonstração")
    print("do framework de testes. NÃO USE EM PRODUÇÃO!\n")
    print("Endpoints disponíveis:")
    print("  - GET  /")
    print("  - GET  /api/health")
    print("  - GET  /api/users")
    print("  - GET  /api/products")
    print("  - GET  /api/search")
    print("  - POST /login")
    print("  - GET  /dashboard")
    print("\nIniciando servidor em http://localhost:8000")
    print("="*60 + "\n")
    
    app.run(host='0.0.0.0', port=8000, debug=False)
