# Instruções de Build - MU Online Launcher

## 📦 Como Fazer o Build

Execute o script de build:
```powershell
.\build.ps1
```

## 📁 Como Instalar o Launcher

**IMPORTANTE**: O launcher **NÃO copia** os arquivos do jogo. Você deve colocar o `MUOnline.exe` na **mesma pasta** onde está o jogo instalado.

### Estrutura Final (após instalação):
```
C:\MU Online\                  ← Pasta do jogo
├── MUOnline.exe              ← Launcher (copiar de dist-limpo\MUOnline-win32-x64\)
├── main.exe                  ← Executável do jogo (já existente)
├── *.dll                     ← DLLs do jogo (já existentes)
├── Data\                     ← Dados do jogo (já existente)
├── resources\                ← Recursos do Electron (copiar junto com MUOnline.exe)
└── ... (outros arquivos)
```

## 🚀 Passo a Passo de Instalação

1. **Faça o build**:
   ```powershell
   .\build.ps1
   ```

2. **Copie TODO o conteúdo** de `dist-limpo\MUOnline-win32-x64\` para a pasta onde o jogo está instalado (onde está o `main.exe`)

3. **Execute** `MUOnline.exe` na pasta do jogo

## 🎯 Como Funciona

O launcher usa `path.dirname(process.execPath)` para detectar sua própria localização e procura o `main.exe` **na mesma pasta**.

### Exemplo de detecção:
```javascript
// Se MUOnline.exe está em: C:\MU Online\MUOnline.exe
// Então ele procura por:    C:\MU Online\main.exe
```

## 📝 Logs

Os logs são salvos em:
```
<pasta-do-jogo>\Data\Launcher\Logs\app.log
```

## ⚠️ Problemas Comuns

### main.exe não encontrado
**Causa**: O `MUOnline.exe` não está na mesma pasta que o `main.exe`  
**Solução**: Copie TODO o conteúdo de `dist-limpo\MUOnline-win32-x64\` para a pasta do jogo

### Erro de permissão ao executar
**Solução**: O launcher já solicita privilégios de administrador via UAC automaticamente

### Jogo não inicia
**Solução**: Verifique os logs em `Data\Launcher\Logs\app.log`

## 📦 Distribuição

Para distribuir o launcher:
1. Compacte TODO o conteúdo de `dist-limpo\MUOnline-win32-x64\`
2. Instrua os usuários a extrair na pasta do jogo
3. O launcher detectará automaticamente o `main.exe` na mesma pasta
