# Guia Rápido de Início

Este guia ajudará você a começar a usar o Framework de Testes Automatizados em menos de 5 minutos.

## 🚀 Início Rápido (5 minutos)

### Passo 1: Instalar Dependências

```bash
pip install pyyaml requests flask
```

### Passo 2: Testar com Aplicação de Exemplo

**Terminal 1 - Iniciar aplicação de exemplo:**

```bash
cd automated-testing-framework
python examples/sample_app.py
```

Você verá:
```
============================================================
APLICAÇÃO DE EXEMPLO PARA TESTES
============================================================

Esta aplicação contém vulnerabilidades INTENCIONAIS para demonstração
do framework de testes. NÃO USE EM PRODUÇÃO!

Iniciando servidor em http://localhost:8000
============================================================
```

**Terminal 2 - Executar testes:**

```bash
cd automated-testing-framework
python run_tests.py -c examples/example_config.yaml
```

### Passo 3: Visualizar Relatórios

Os relatórios serão gerados em `reports/`. Abra o arquivo HTML no navegador:

```bash
# Linux/Mac
open reports/report_*.html

# Windows
start reports/report_*.html
```

## 📝 Testar Seu Próprio Sistema

### 1. Criar Arquivo de Configuração

Copie o arquivo de exemplo:

```bash
cp config/config.yaml config/meu_sistema.yaml
```

### 2. Editar Configuração

Abra `config/meu_sistema.yaml` e ajuste:

```yaml
target:
  name: "Meu Sistema"
  base_url: "https://meusite.com"  # ← Altere aqui
  api_endpoints:
    - "/api/users"                  # ← Seus endpoints
    - "/api/products"
  web_endpoints:
    - "/"
    - "/login"
```

### 3. Executar Testes

```bash
python run_tests.py -c config/meu_sistema.yaml
```

## 🎯 Casos de Uso Comuns

### Apenas Testes de Segurança

```bash
python run_tests.py -c config/meu_sistema.yaml --security-only
```

### Apenas Testes de Performance

```bash
python run_tests.py -c config/meu_sistema.yaml --performance-only
```

### Teste Rápido (Configuração Mínima)

Crie `quick-test.yaml`:

```yaml
target:
  name: "Teste Rápido"
  base_url: "http://localhost:3000"
  api_endpoints:
    - "/api/health"

performance:
  enabled: true
  load_test:
    enabled: true
    users: 10
    duration: 10

security:
  enabled: true
  web_vulnerabilities:
    enabled: true
```

Execute:

```bash
python run_tests.py -c quick-test.yaml
```

## 🔍 Interpretar Resultados

### Relatório de Performance

**Métricas Importantes:**

- **Taxa de Sucesso**: Deve ser > 99%
- **P95 Response Time**: Tempo que 95% das requisições ficam abaixo
- **P99 Response Time**: Tempo que 99% das requisições ficam abaixo
- **RPS**: Requisições por segundo (throughput)

**Exemplo de Resultado Bom:**
```
Taxa de Sucesso: 99.8%
Tempo Médio: 45ms
P95: 120ms
P99: 250ms
RPS: 150
```

### Relatório de Segurança

**Score de Segurança:**
- **90-100**: Excelente
- **70-89**: Bom
- **50-69**: Regular (requer atenção)
- **< 50**: Crítico (ação imediata)

**Severidades:**
- 🔴 **Crítica**: Corrija IMEDIATAMENTE
- 🟠 **Alta**: Corrija em 1 semana
- 🟡 **Média**: Corrija em 1 mês
- 🔵 **Baixa**: Corrija quando possível
- ℹ️ **Info**: Informativo

## 💡 Dicas Importantes

### ✅ Faça

- ✅ Teste em ambiente de staging/desenvolvimento
- ✅ Obtenha autorização antes de testar
- ✅ Comece com carga baixa e aumente gradualmente
- ✅ Mantenha histórico de relatórios
- ✅ Corrija vulnerabilidades críticas primeiro

### ❌ Não Faça

- ❌ Testar sistemas de produção sem autorização
- ❌ Usar carga muito alta no primeiro teste
- ❌ Ignorar vulnerabilidades críticas
- ❌ Testar sistemas de terceiros sem permissão
- ❌ Commitar credenciais no controle de versão

## 🆘 Problemas Comuns

### "Connection refused"

**Problema**: Sistema alvo não está acessível

**Solução**: Verifique se o sistema está rodando e a URL está correta

### "Too many requests"

**Problema**: Sistema tem rate limiting

**Solução**: Reduza número de usuários ou aumente intervalos

### Testes muito lentos

**Problema**: Timeout muito alto ou sistema lento

**Solução**: Ajuste `timeout` em `config.yaml`:

```yaml
general:
  timeout: 10  # Reduzir para 10 segundos
```

### Muitos falsos positivos

**Problema**: Payloads genéricos não se aplicam ao seu sistema

**Solução**: Desabilite testes específicos ou customize payloads

## 📚 Próximos Passos

1. **Leia a documentação completa**: `README.md`
2. **Explore os exemplos**: Veja `examples/`
3. **Customize configurações**: Ajuste para suas necessidades
4. **Integre no CI/CD**: Automatize os testes
5. **Monitore regularmente**: Execute testes periodicamente

## 🎓 Recursos Adicionais

- **Documentação Completa**: `README.md`
- **Exemplos**: `examples/`
- **Configuração**: `config/config.yaml`
- **Código-fonte**: Todos os módulos estão bem documentados

## 🤝 Precisa de Ajuda?

1. Consulte `README.md` para documentação detalhada
2. Veja os exemplos em `examples/`
3. Analise os logs de execução
4. Revise o código-fonte (comentado)

---

**Pronto para começar! 🚀**

Execute agora:

```bash
python examples/sample_app.py  # Terminal 1
python run_tests.py -c examples/example_config.yaml  # Terminal 2
```
