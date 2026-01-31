# Changelog - Adição da Logo

## Versão 1.1 - 15 de Dezembro de 2025

### ✨ Nova Funcionalidade: Logo da Empresa nos Relatórios

Adicionada a logo da **Sudoeste Informática e Consultoria** no cabeçalho dos relatórios HTML gerados pelo framework.

---

## 🎨 O Que Foi Modificado

### Arquivos Alterados

1. **`utils/report_generator.py`**
   - Adicionado import `base64`
   - Adicionado método `_load_logo()` para carregar logo em base64
   - Modificado CSS do header para layout flexbox
   - Adicionada classe CSS `.header-logo` para estilização da logo
   - Modificado HTML do header para incluir logo

2. **`assets/LogoSudoeste_OFICIAL.png`** (novo)
   - Logo da empresa em formato PNG
   - Tamanho: 71 KB
   - Dimensões recomendadas: 200px de largura máxima no relatório

---

## 🔧 Detalhes Técnicos

### Como Funciona

A logo é **embutida no HTML** usando **data URI com base64**, o que significa:

✅ **Não precisa de arquivos externos** - O relatório HTML é autocontido  
✅ **Funciona offline** - Pode ser enviado por email ou visualizado sem internet  
✅ **Não quebra links** - Não depende de caminhos de arquivo ou URLs  
✅ **Portável** - Funciona em qualquer sistema operacional

### Implementação

```python
# Carregamento automático da logo
def _load_logo(self) -> str:
    logo_path = os.path.join(os.path.dirname(__file__), '..', 'assets', 'LogoSudoeste_OFICIAL.png')
    try:
        with open(logo_path, 'rb') as f:
            logo_data = f.read()
            return base64.b64encode(logo_data).decode('utf-8')
    except:
        return ""  # Se logo não existir, relatório funciona normalmente
```

### Layout do Header

```
┌─────────────────────────────────────────────────────────┐
│                                                         │
│  Relatório de Testes Automatizados     [LOGO SUDOESTE] │
│  Tipo: Security                                         │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

---

## 📊 Estilização CSS

### Classe `.header`

```css
.header {
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
    padding: 30px;
    border-radius: 8px;
    margin-bottom: 30px;
    display: flex;                    /* ← Novo */
    align-items: center;              /* ← Novo */
    justify-content: space-between;   /* ← Novo */
}
```

### Classe `.header-logo` (nova)

```css
.header-logo {
    max-width: 200px;
    height: auto;
    background: white;
    padding: 10px;
    border-radius: 8px;
}
```

---

## ✅ Compatibilidade

### Testes Realizados

- ✅ Relatórios de Performance
- ✅ Relatórios de Segurança
- ✅ Relatórios com dados completos
- ✅ Relatórios com dados parciais
- ✅ Funcionamento sem logo (fallback)

### Navegadores Suportados

- ✅ Google Chrome / Chromium
- ✅ Mozilla Firefox
- ✅ Microsoft Edge
- ✅ Safari
- ✅ Opera

---

## 🚀 Como Usar

### Uso Normal

Não é necessário fazer nada diferente! A logo é adicionada automaticamente:

```bash
# Executar testes normalmente
python run_tests.py -c config/config.yaml

# A logo aparecerá automaticamente nos relatórios HTML
```

### Personalizar Logo

Para usar uma logo diferente:

1. Substitua o arquivo `assets/LogoSudoeste_OFICIAL.png`
2. Mantenha o mesmo nome do arquivo
3. Recomendado: PNG com fundo transparente
4. Tamanho recomendado: 400x200 pixels (proporção 2:1)

---

## 📝 Exemplo de Relatório

Um relatório de exemplo com logo foi gerado em:
```
reports/test_with_logo.html
```

Abra este arquivo no navegador para visualizar o resultado.

---

## 🔄 Retrocompatibilidade

**100% retrocompatível** ✅

- Se a logo não existir, o relatório funciona normalmente
- Relatórios antigos continuam funcionando
- Nenhuma configuração adicional necessária

---

## 📦 Tamanho do Arquivo

### Impacto no Tamanho dos Relatórios

- **Logo em base64**: ~97 KB
- **Relatório sem logo**: ~15 KB
- **Relatório com logo**: ~112 KB

**Aumento**: ~97 KB por relatório (aceitável para a funcionalidade)

---

## 🎓 Notas Técnicas

### Por Que Base64?

Alternativas consideradas:

1. **Link externo** (URL) ❌
   - Requer internet
   - Pode quebrar se URL mudar
   - Não funciona offline

2. **Arquivo separado** (caminho relativo) ❌
   - Requer enviar 2 arquivos
   - Pode quebrar se mover arquivo
   - Complicado para compartilhar

3. **Base64 embutido** ✅
   - Arquivo único autocontido
   - Funciona offline
   - Fácil de compartilhar
   - Portável

### Otimização

Se o tamanho do arquivo for uma preocupação:

1. **Comprimir logo**: Use ferramentas como TinyPNG
2. **Reduzir dimensões**: 400x200px é suficiente
3. **Usar SVG**: Considere converter para SVG (menor)

---

## 🐛 Troubleshooting

### Logo não aparece

**Problema**: Logo não está sendo exibida no relatório

**Soluções**:

1. Verifique se arquivo existe:
   ```bash
   ls -lh assets/LogoSudoeste_OFICIAL.png
   ```

2. Verifique permissões:
   ```bash
   chmod 644 assets/LogoSudoeste_OFICIAL.png
   ```

3. Teste carregamento:
   ```python
   from utils.report_generator import ReportGenerator
   gen = ReportGenerator()
   print(f"Logo carregada: {len(gen.logo_base64)} caracteres")
   ```

### Logo muito grande

**Problema**: Logo está ocupando muito espaço

**Solução**: Edite CSS em `report_generator.py`:

```css
.header-logo {
    max-width: 150px;  /* Reduza de 200px para 150px */
    height: auto;
    background: white;
    padding: 10px;
    border-radius: 8px;
}
```

### Logo com fundo

**Problema**: Logo tem fundo branco/colorido

**Solução**: Use ferramenta para remover fundo:
- https://remove.bg
- GIMP (software gratuito)
- Photoshop

---

## 📚 Referências

- [Data URI Scheme](https://en.wikipedia.org/wiki/Data_URI_scheme)
- [Base64 Encoding](https://developer.mozilla.org/en-US/docs/Glossary/Base64)
- [CSS Flexbox](https://css-tricks.com/snippets/css/a-guide-to-flexbox/)

---

## ✨ Créditos

**Logo**: Sudoeste Informática e Consultoria  
**Implementação**: Framework de Testes Automatizados v1.1  
**Data**: 15 de Dezembro de 2025

---

**Aproveite os relatórios com a identidade visual da sua empresa!** 🎉
