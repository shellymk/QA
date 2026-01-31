<<<<<<< HEAD
# Framework de Testes Automatizados de Performance e Segurança

Um framework completo e modular para realizar testes automatizados de performance e segurança em qualquer sistema web, API ou aplicação.

## 📋 Índice

- [Características](#características)
- [Arquitetura](#arquitetura)
- [Instalação](#instalação)
- [Configuração](#configuração)
- [Uso](#uso)
- [Tipos de Testes](#tipos-de-testes)
- [Relatórios](#relatórios)
- [Exemplos](#exemplos)
- [Personalização](#personalização)
- [Boas Práticas](#boas-práticas)

## ✨ Características

### Testes de Performance

- **Teste de Carga (Load Test)**: Simula um número constante de usuários por período determinado
- **Teste de Stress**: Aumenta gradualmente a carga até encontrar o ponto de quebra
- **Teste de Spike**: Simula picos súbitos de tráfego
- **Métricas Detalhadas**: Response time (avg, min, max, P50, P95, P99), throughput, taxa de erro

### Testes de Segurança

- **Vulnerabilidades Web**: SQL Injection, XSS, CSRF
- **Configuração de Segurança**: Headers HTTP, SSL/TLS, CORS
- **Autenticação**: Senhas fracas, rate limiting, gestão de sessões
- **Testes de Injeção**: Command injection, LDAP, XML, NoSQL
- **Análise de Rede**: Scan de portas, serviços expostos
- **Score de Segurança**: Avaliação quantitativa da postura de segurança

### Relatórios

- **Múltiplos Formatos**: HTML (interativo), JSON (programático), TXT (simples)
- **Visualizações**: Gráficos, tabelas, métricas agregadas
- **Detalhamento**: Evidências, recomendações, referências CWE
- **Exportação**: Fácil compartilhamento e integração CI/CD

## 🏗️ Arquitetura

```
automated-testing-framework/
├── config/
│   └── config.yaml              # Configuração principal
├── performance/
│   └── performance_tester.py    # Módulo de testes de performance
├── security/
│   └── security_tester.py       # Módulo de testes de segurança
├── utils/
│   └── report_generator.py      # Gerador de relatórios
├── examples/
│   ├── sample_app.py            # Aplicação de exemplo
│   └── example_config.yaml      # Configuração de exemplo
├── reports/                     # Relatórios gerados (criado automaticamente)
├── run_tests.py                 # Script principal
└── README.md                    # Esta documentação
```

## 📦 Instalação

### Pré-requisitos

- Python 3.7 ou superior
- pip (gerenciador de pacotes Python)

### Dependências

Instale as dependências necessárias:

```bash
pip install pyyaml requests flask
```

### Instalação Rápida

```bash
# Clone ou baixe o framework
cd automated-testing-framework

# Instale as dependências
pip install -r requirements.txt

# Pronto para usar!
python run_tests.py --help
```

## ⚙️ Configuração

O framework é configurado através do arquivo `config/config.yaml`. Este arquivo permite personalizar todos os aspectos dos testes.

### Estrutura da Configuração

#### 1. Sistema Alvo

```yaml
target:
  name: "Meu Sistema"
  base_url: "https://meusite.com"
  api_endpoints:
    - "/api/users"
    - "/api/products"
  web_endpoints:
    - "/"
    - "/login"
```

#### 2. Testes de Performance

```yaml
performance:
  enabled: true
  
  load_test:
    enabled: true
    users: 100           # Número de usuários simultâneos
    duration: 60         # Duração em segundos
    ramp_up: 10          # Tempo de ramp-up em segundos
  
  stress_test:
    enabled: true
    start_users: 10      # Usuários iniciais
    max_users: 500       # Usuários máximos
    step_users: 50       # Incremento por step
    step_duration: 30    # Duração de cada step
  
  spike_test:
    enabled: true
    normal_users: 10     # Carga normal
    spike_users: 500     # Carga no spike
    spike_duration: 10   # Duração do spike
```

#### 3. Testes de Segurança

```yaml
security:
  enabled: true
  
  web_vulnerabilities:
    enabled: true
    tests:
      - sql_injection
      - xss
      - csrf
      - security_headers
      - ssl_tls
      - cors
  
  auth_tests:
    enabled: true
    tests:
      - weak_passwords
      - session_management
      - rate_limiting
  
  network_scan:
    enabled: true
    ports: [80, 443, 8080]
  
  injection_tests:
    enabled: true
    types:
      - command_injection
      - nosql_injection
```

#### 4. Relatórios

```yaml
reporting:
  output_dir: "./reports"
  formats:
    - html
    - json
    - text
  include_metrics: true
```

## 🚀 Uso

### Uso Básico

```bash
# Executar todos os testes
python run_tests.py -c config/config.yaml

# Executar apenas testes de performance
python run_tests.py -c config/config.yaml --performance-only

# Executar apenas testes de segurança
python run_tests.py -c config/config.yaml --security-only

# Executar sem gerar relatórios
python run_tests.py -c config/config.yaml --no-report
```

### Exemplo Completo

```bash
# 1. Inicie a aplicação de exemplo (em um terminal)
python examples/sample_app.py

# 2. Execute os testes (em outro terminal)
python run_tests.py -c examples/example_config.yaml

# 3. Visualize os relatórios
open reports/report_*.html
```

### Integração CI/CD

```bash
# Exemplo de integração em pipeline
python run_tests.py -c config/config.yaml --security-only
if [ $? -ne 0 ]; then
    echo "Testes de segurança falharam!"
    exit 1
fi
```

## 🧪 Tipos de Testes

### Testes de Performance

#### Teste de Carga (Load Test)

Simula um número constante de usuários acessando o sistema simultaneamente por um período determinado. Útil para:

- Validar se o sistema suporta a carga esperada
- Identificar gargalos de performance
- Medir tempos de resposta sob carga normal

**Métricas Coletadas:**
- Total de requisições
- Taxa de sucesso/erro
- Tempo médio de resposta
- Percentis (P50, P95, P99)
- Requisições por segundo (RPS)

#### Teste de Stress

Aumenta gradualmente o número de usuários até encontrar o ponto de quebra do sistema. Útil para:

- Determinar capacidade máxima
- Identificar quando o sistema começa a degradar
- Planejar escalabilidade

**Como Funciona:**
1. Inicia com poucos usuários
2. Aumenta gradualmente em steps
3. Monitora degradação de performance
4. Para quando detecta falhas significativas

#### Teste de Spike

Simula um aumento súbito de tráfego. Útil para:

- Validar comportamento em picos de acesso
- Testar auto-scaling
- Verificar recuperação após pico

**Fases:**
1. **Baseline**: Carga normal para estabelecer baseline
2. **Spike**: Aumento súbito de usuários
3. **Recuperação**: Retorno à carga normal

### Testes de Segurança

#### SQL Injection

Testa se o sistema é vulnerável a injeção de código SQL através de:

- Payloads comuns de SQL injection
- Análise de mensagens de erro do banco
- Detecção de comportamento anômalo

**Severidade**: Crítica (CWE-89)

#### Cross-Site Scripting (XSS)

Verifica se o sistema reflete entrada do usuário sem sanitização:

- XSS refletido
- XSS armazenado
- XSS baseado em DOM

**Severidade**: Alta (CWE-79)

#### Headers de Segurança

Verifica presença e configuração de headers HTTP importantes:

- `X-Frame-Options` (proteção contra clickjacking)
- `X-Content-Type-Options` (previne MIME sniffing)
- `Strict-Transport-Security` (força HTTPS)
- `Content-Security-Policy` (previne XSS e injeção)
- `X-XSS-Protection` (proteção XSS do navegador)

**Severidade**: Média a Alta

#### SSL/TLS

Analisa configuração de criptografia:

- Versões de protocolo (TLS 1.2+)
- Cifras utilizadas
- Validade de certificados

**Severidade**: Alta (CWE-326, CWE-327)

#### CORS

Verifica configuração de Cross-Origin Resource Sharing:

- Wildcard (`*`) em Access-Control-Allow-Origin
- Reflexão de origens não confiáveis
- Credenciais em requisições cross-origin

**Severidade**: Média (CWE-942)

#### Autenticação

Testa robustez do sistema de autenticação:

- Senhas fracas ou padrão
- Política de senhas
- Rate limiting em login
- Gestão de sessões

**Severidade**: Crítica (CWE-521)

#### Command Injection

Verifica se o sistema executa comandos do sistema com entrada do usuário:

- Payloads de command injection
- Detecção de saída de comandos
- Análise de comportamento

**Severidade**: Crítica (CWE-78)

#### Scan de Portas

Identifica portas e serviços expostos:

- Portas abertas
- Serviços potencialmente inseguros
- Exposição desnecessária

**Severidade**: Alta (CWE-16)

## 📊 Relatórios

### Formato HTML

Relatório interativo e visual com:

- Dashboard com métricas principais
- Gráficos e visualizações
- Detalhamento de vulnerabilidades
- Recomendações de correção
- Score de segurança

**Ideal para**: Apresentações, compartilhamento com equipe, análise visual

### Formato JSON

Relatório estruturado em JSON com:

- Dados completos dos testes
- Métricas em formato programático
- Fácil integração com outras ferramentas

**Ideal para**: Integração CI/CD, processamento automatizado, APIs

### Formato Texto

Relatório simples em texto plano com:

- Resumo dos testes
- Principais métricas
- Lista de vulnerabilidades

**Ideal para**: Logs, emails, sistemas legados

### Estrutura dos Relatórios

```
reports/
├── report_20240613_143022.html
├── report_20240613_143022.json
└── report_20240613_143022.txt
```

## 💡 Exemplos

### Exemplo 1: Testar API REST

```yaml
target:
  name: "Minha API"
  base_url: "https://api.exemplo.com"
  api_endpoints:
    - "/v1/users"
    - "/v1/products"
    - "/v1/orders"

performance:
  enabled: true
  load_test:
    users: 200
    duration: 120

security:
  enabled: true
  web_vulnerabilities:
    enabled: true
```

### Exemplo 2: Testar Aplicação Web

```yaml
target:
  name: "Portal Web"
  base_url: "https://www.exemplo.com"
  web_endpoints:
    - "/"
    - "/login"
    - "/dashboard"
    - "/profile"

security:
  enabled: true
  web_vulnerabilities:
    tests:
      - xss
      - security_headers
      - ssl_tls
      - cors
```

### Exemplo 3: Teste Rápido de Segurança

```yaml
target:
  name: "Teste Rápido"
  base_url: "http://localhost:3000"
  api_endpoints:
    - "/api/health"

performance:
  enabled: false

security:
  enabled: true
  web_vulnerabilities:
    enabled: true
  auth_tests:
    enabled: true
  network_scan:
    enabled: true
```

## 🎨 Personalização

### Adicionar Novos Testes de Performance

Edite `performance/performance_tester.py` e adicione novos métodos:

```python
def endurance_test(self) -> Dict[str, Any]:
    """Teste de Endurance: execução prolongada"""
    # Sua implementação aqui
    pass
```

### Adicionar Novos Testes de Segurança

Edite `security/security_tester.py` e adicione novos métodos:

```python
def test_xxe(self) -> List[SecurityIssue]:
    """Testa XML External Entity (XXE)"""
    # Sua implementação aqui
    pass
```

### Customizar Payloads

Modifique os payloads de teste em `security_tester.py`:

```python
self.sql_payloads = [
    "' OR '1'='1",
    "seu_payload_customizado",
    # ...
]
```

### Adicionar Novos Formatos de Relatório

Edite `utils/report_generator.py` e adicione novos métodos:

```python
def generate_pdf_report(self, results: Dict[str, Any]) -> str:
    """Gera relatório em PDF"""
    # Sua implementação aqui
    pass
```

## 📚 Boas Práticas

### Performance

1. **Comece Pequeno**: Inicie com poucos usuários e aumente gradualmente
2. **Ambiente Isolado**: Execute testes em ambiente de staging, não produção
3. **Monitore Recursos**: Observe CPU, memória e rede durante os testes
4. **Defina Baselines**: Estabeleça métricas de referência para comparação
5. **Teste Regularmente**: Integre testes de performance no CI/CD

### Segurança

1. **Autorização**: Obtenha permissão antes de testar sistemas de terceiros
2. **Ambiente Controlado**: Prefira ambientes de teste
3. **Rate Limiting**: Configure timeouts adequados para não sobrecarregar
4. **Falsos Positivos**: Valide manualmente vulnerabilidades críticas
5. **Correção**: Priorize correção de vulnerabilidades críticas e altas

### Configuração

1. **Versionamento**: Mantenha configurações no controle de versão
2. **Documentação**: Documente configurações específicas do projeto
3. **Sensibilidade**: Não commite credenciais ou dados sensíveis
4. **Modularidade**: Use múltiplos arquivos de configuração para diferentes ambientes
5. **Validação**: Valide configurações antes de executar testes

### Relatórios

1. **Armazenamento**: Mantenha histórico de relatórios para análise temporal
2. **Compartilhamento**: Defina processo para compartilhar resultados
3. **Ação**: Estabeleça SLAs para correção de vulnerabilidades
4. **Métricas**: Acompanhe evolução de métricas ao longo do tempo
5. **Automação**: Integre geração de relatórios em pipelines

## 🔧 Solução de Problemas

### Erro de Conexão

```
ConnectionError: Failed to establish connection
```

**Solução**: Verifique se o sistema alvo está acessível e a URL está correta.

### Timeout

```
TimeoutError: Request timed out
```

**Solução**: Aumente o valor de `timeout` em `config.yaml`:

```yaml
general:
  timeout: 60  # Aumentar para 60 segundos
```

### Muitos Erros em Testes de Performance

**Solução**: Reduza o número de usuários ou aumente recursos do sistema alvo.

### Falsos Positivos em Segurança

**Solução**: Valide manualmente e ajuste payloads ou desabilite testes específicos.

## 📄 Licença

Este framework é fornecido "como está", sem garantias. Use por sua conta e risco.

## 🤝 Contribuições

Contribuições são bem-vindas! Sinta-se livre para:

- Reportar bugs
- Sugerir novos recursos
- Melhorar documentação
- Adicionar novos testes

## 📞 Suporte

Para dúvidas ou problemas:

1. Consulte esta documentação
2. Verifique os exemplos em `examples/`
3. Analise os logs de execução
4. Revise o código-fonte (bem documentado)

## 🎯 Roadmap

Funcionalidades planejadas:

- [ ] Testes de endurance
- [ ] Integração com Prometheus/Grafana
- [ ] Suporte a WebSockets
- [ ] Testes de API GraphQL
- [ ] Dashboard web interativo
- [ ] Notificações (email, Slack, Teams)
- [ ] Exportação para PDF
- [ ] Testes de acessibilidade
- [ ] Análise de dependências vulneráveis
- [ ] Integração com OWASP ZAP

---

**Desenvolvido com ❤️ para ajudar a construir sistemas mais seguros e performáticos**
=======
# automated_testing_framework
Framework de testes de performance e segurança
>>>>>>> b09215b4073266a811a7ae29ebc574221b3326a6
