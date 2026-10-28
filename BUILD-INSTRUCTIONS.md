# Instruções de Build - MU Online Launcher

## 🎮 Instalador para os jogadores

```powershell
npm run dist
```

Gera `dist\AsgardMU-Setup-<versão>.exe`. Para publicar o instalador, o cliente e os patches, siga o [PUBLICAR.md](PUBLICAR.md).
O `build.ps1` abaixo gera só a pasta do launcher, para copiar na pasta do jogo durante o desenvolvimento.

## 📦 Como Fazer o Build

Execute o script de build:
```powershell
.\build.ps1
```

## 📁 Como Instalar o Launcher

**IMPORTANTE**: O launcher **NÃO copia** os arquivos do jogo. Você deve colocar o `AsgardMU.exe` na **mesma pasta** onde está o jogo instalado.

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

### O jogo abre, mas não conecta
**Causa**: Falta o `glu32.dll` na pasta do jogo. Essa DLL carrega o `Main.dll` no `main.exe` (substitui o antigo `game.exe`)
**Solução**: Copie `glu32.dll` (build de `Asgard-Mu-ServerS21\MainLoader`) para a pasta do jogo

### O jogo abre, mas sem FPS alto, sem o card do Discord do AsgardMU
**Causa**: Falta o `AsgardCustom.dll` na pasta do jogo. O `glu32.dll` carrega essa DLL antes do `Main.dll`; ela tem todas as melhorias do cliente
**Solução**: Copie `AsgardCustom.dll` (build de `Asgard-Mu-ServerS21\AsgardCustom`) para a pasta do jogo. A `discord_game_sdk.dll` deve ser a original do Discord

### Privilégios
O launcher e o jogo rodam sem administrador (sem UAC). O launcher abre o `main.exe` com `__COMPAT_LAYER=RunAsInvoker`

### Jogo não inicia
**Solução**: Verifique os logs em `Data\Launcher\Logs\app.log`

## 📦 Distribuição

Para distribuir o launcher:
1. Compacte TODO o conteúdo de `dist-limpo\MUOnline-win32-x64\`
2. Instrua os usuários a extrair na pasta do jogo
3. O launcher detectará automaticamente o `main.exe` na mesma pasta
