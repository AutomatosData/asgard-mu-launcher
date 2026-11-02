# Publicar o AsgardMU (instalador, cliente e patches)

Custo: zero. Tudo que o launcher baixa fica nos **GitHub Releases** do repositório público
[AutomatosData/asgard-mu-client](https://github.com/AutomatosData/asgard-mu-client/releases).
O **Google Drive** guarda só o instalador, para o jogador baixar pelo navegador.

## Como funciona

1. O jogador baixa `AsgardMU-Setup.exe` (Google Drive ou link do GitHub) e instala.
   - Não pede administrador. Pasta padrão: `%LOCALAPPDATA%\Programs\AsgardMU`. O jogador pode escolher outra pasta.
   - Cria atalho na área de trabalho e no menu Iniciar.
   - O launcher (Electron) fica na pasta oculta `Launcher\`. Na pasta do jogo fica um `AsgardMU.exe` pequeno que o abre (`build/stub`, compilar com `build/stub/build.bat` se mudar). O launcher oculta as DLLs do jogo, `Data` e `ErrorLog` (`src/main/install-dirs.js`). O jogador vê só `AsgardMU.exe` e os `.ini`.
2. Na primeira abertura, o launcher baixa o cliente completo (partes `.zip`) e extrai na mesma pasta.
   - Se a internet cair, o download continua de onde parou.
   - O launcher confere o tamanho e o MD5 de cada parte.
3. Em toda abertura, o launcher lê o `update.json` e baixa só os arquivos alterados (patches).
4. Se existir launcher novo, o launcher baixa o instalador novo, instala em silêncio na mesma pasta e abre de novo. O jogo não é apagado.

O link fixo do manifesto está em `src/shared/url-config.js`:
`https://github.com/AutomatosData/asgard-mu-client/releases/download/current/update.json`

| Release no GitHub    | Conteúdo                                                        |
|----------------------|-----------------------------------------------------------------|
| `current`            | `update.json` (manifesto) e `AsgardMU-Setup.exe` (link fixo)     |
| `client-<versão>`    | cliente completo em partes `.zip` + `client-files.json`         |
| `patch-<versão>`     | um arquivo por alteração (`<md5>-<nome>`)                       |
| `launcher-v<versão>` | `AsgardMU-Setup-<versão>.exe`                                   |

Não apague nenhum release. Jogadores antigos ainda usam arquivos de releases antigos.

## Preparação (uma vez por computador)

1. Instale o Node.js e rode `npm install` na pasta do launcher.
2. Instale o GitHub CLI: `winget install GitHub.cli`.
3. Faça login com uma conta que pode escrever no repositório: `gh auth login`.
4. Confira: `npm run release:status`.

## Ordem da primeira publicação

1. `npm run dist` (gera o instalador).
2. `npm run release:client` (cliente completo).
3. `npm run release:launcher` (instalador).
4. Envie o instalador para o Google Drive (seção abaixo).

## Publicar o cliente completo

Use na primeira vez. Depois, use só quando muitos arquivos mudarem (ex.: troca de season).

1. Confira `configs.ini` e `option.ini` na pasta do cliente. Eles viram o padrão dos jogadores novos.
2. Rode `npm run release:client -- --dry-run` e confira a lista.
3. Rode `npm run release:client`. Responda `s` para enviar.

O script:
- lê `..\Asgard-Mu-ClientS21` (outra pasta: `-- --client "D:\Cliente"`);
- divide o cliente em partes de até 1,8 GB (o GitHub aceita até 2 GB por arquivo);
- compacta com o `tar.exe` do Windows e envia;
- envia o `update.json` por último.

Se houver alteração que ainda não saiu em patch, o script para. Publique o patch antes. Assim, quem já tem o jogo também recebe a alteração.

### Recomeçar do zero

`npm run release:client -- --reset` publica o cliente atual como nova base:
- o `update.json` fica sem patches;
- depois do `update.json`, o script apaga os releases `client-*` antigos e todos os `patch-*`.

Quem já tem o jogo não recebe as alterações pendentes. Use antes da abertura, ou peça para os jogadores reinstalarem.

### Runtime do Visual C++

O `Main.dll` precisa do runtime Visual C++ 2015-2022 de 32 bits (`msvcp140.dll` e `vcruntime140.dll`).
As duas DLLs ficam na pasta do cliente e vão junto. Sem elas, um PC sem esse runtime abre o jogo sem o `Main.dll`, e o jogo não conecta.
Origem: `Visual Studio\18\BuildTools\VC\Redist\MSVC\<versão>\x86\Microsoft.VC145.CRT`. A Microsoft permite distribuir esses arquivos.

## Publicar um patch

1. Copie os arquivos novos para a pasta do cliente (`Asgard-Mu-ClientS21`).
2. Teste o jogo nessa pasta.
3. Rode `npm run release:status` e confira a lista "Alterados" e "Novos".
4. Rode `npm run release:patch`. Responda `s` para enviar.

O launcher dos jogadores baixa o patch na próxima abertura.

Regras:
- O patch não apaga arquivos no jogador. Para tirar um arquivo, troque o conteúdo dele.
- Nunca entram no patch: logs, `*.bak*`, `LauncherOption.if`, `Data/Launcher`, `ErrorLog`, `ScreenShots`, `inbox`, `JewelBank/_tmp` e os arquivos do Electron. Pastas que ficam sem arquivos vão vazias no cliente completo.
- Preferências do jogador (`configs.ini`, `option.ini`, `*.pos`): uma alteração não substitui a cópia do jogador. Um arquivo novo desse tipo só é baixado por quem não o tem.
- As regras ficam no início de `tools/release.js` (`LAUNCHER_FILES`, `IGNORE`, `SEED`).

## Publicar um launcher novo

1. Aumente `"version"` no `package.json` (ex.: `1.0.0` -> `1.0.1`).
2. Rode `npm run dist`. O instalador fica em `dist\AsgardMU-Setup-<versão>.exe`.
3. Rode `npm run release:launcher`. Responda `s` para enviar.
4. Envie o instalador novo para o Google Drive.

O launcher só se atualiza para uma versão maior. O script recusa a mesma versão com outro conteúdo.

## Google Drive

1. Na primeira vez, envie `dist\AsgardMU-Setup-<versão>.exe` e renomeie para `AsgardMU-Setup.exe`.
2. Compartilhe: "Qualquer pessoa com o link" -> "Leitor".
3. Nas próximas versões, clique com o botão direito no arquivo -> "Gerenciar versões" -> "Enviar nova versão". O link continua o mesmo.

O instalador tem menos de 100 MB. Assim o Drive não mostra o aviso "não é possível verificar vírus".
Não coloque o cliente completo no Drive. O Drive bloqueia arquivos muito baixados ("cota excedida").

Link alternativo, sempre da última versão:
`https://github.com/AutomatosData/asgard-mu-client/releases/download/current/AsgardMU-Setup.exe`

## Aviso do Windows (SmartScreen)

O instalador não tem assinatura digital. Na primeira vez, o Windows mostra "O Windows protegeu o computador".
O jogador clica em "Mais informações" -> "Executar assim mesmo". O aviso some com o tempo, quando o arquivo fica conhecido.
Um certificado de assinatura de código remove o aviso, mas é pago.

## Testar sem publicar

1. `node tools/release.js client --local --yes --client <pasta de teste>`. Os arquivos vão para `.release-local/`.
2. `npm run release:serve` (servidor local na porta 18787). Para ver as barras andando, limite a velocidade: `node tools/serve-local.js 18787 1024` (1024 KB/s).
3. Copie `dist\win-unpacked` para uma pasta vazia.
4. Abra o `AsgardMU.exe` dessa pasta com a variável `ASGARD_MANIFEST_URL=http://127.0.0.1:18787/current/update.json`.
   - Num terminal do VS Code, apague antes a variável `ELECTRON_RUN_AS_NODE`. Com ela, o Electron roda como Node e a janela não abre.
5. Para testar um patch: altere um arquivo da pasta de teste e rode `node tools/release.js patch --local --yes --client <pasta de teste>`.

O launcher de teste grava `gamePath` em `%APPDATA%\AsgardMU\config.json`. Faça uma cópia antes e restaure depois.

## Limites

- GitHub: 2 GB por arquivo e até 1000 arquivos por release (o script divide em mais releases). O repositório tem que ser público.
- O primeiro MD5 de todo o cliente leva alguns minutos. O cache fica em `.release-cache/` e as próximas vezes são rápidas.
