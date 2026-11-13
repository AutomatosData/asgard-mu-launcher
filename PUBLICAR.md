# Publicar o AsgardMU (instalador, cliente e patches)

Custo: zero. Tudo que o launcher baixa fica nos **GitHub Releases** do repositório público
[AutomatosData/asgard-mu-client](https://github.com/AutomatosData/asgard-mu-client/releases).
O instalador também fica lá, com link fixo para a página de downloads do site.

## Como funciona

1. O jogador baixa `AsgardMU-Setup.exe` pelo link do site (GitHub) e instala.
   - Não pede administrador. Pasta padrão: `C:\AsgardMU`. O jogador pode escolher outra pasta.
   - Cria atalho na área de trabalho e no menu Iniciar.
   - O launcher (Rust + Tauri) é o `AsgardMU.exe` da pasta do jogo. Ele usa o WebView2 do Windows; se faltar, o instalador instala. O launcher oculta as DLLs do jogo, `Data` e `ErrorLog` (`src-tauri/src/dirs.rs`). O jogador vê só `AsgardMU.exe` e os `.ini`.
   - Por cima de uma instalação do launcher antigo (Electron), o instalador apaga a pasta `Launcher\` e mantém o jogo (`src-tauri/installer-hooks.nsh`).
2. Na primeira abertura, o launcher baixa o cliente completo (partes `.zip`) e extrai na mesma pasta.
   - Se a internet cair, o download continua de onde parou.
   - O launcher confere o tamanho e o MD5 de cada parte.
3. Em toda abertura, o launcher lê o `update.json` e baixa só os arquivos alterados (patches).
4. Se existir launcher novo, o launcher baixa o instalador novo, instala em silêncio na mesma pasta e abre de novo. O jogo não é apagado.

O link fixo do manifesto está em `ui/shared/url-config.js` e `src-tauri/src/config.rs`:
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
3. `npm run release:launcher` (instalador e link fixo do site).

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

Para corrigir isso depois do `--reset`, publique a diferença em patch a partir de uma instalação antiga:
`npm run release:patch -- --from "C:\AsgardMU"`. O script compara o cliente com essa pasta, não com o manifesto.

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
- Nunca entram no patch: logs, `*.bak*`, `LauncherOption.if`, `Data/Launcher`, `ErrorLog`, `ScreenShots`, `inbox`, `JewelBank/_tmp` e os arquivos do launcher. Pastas que ficam sem arquivos vão vazias no cliente completo.
- Preferências do jogador (`configs.ini`, `option.ini`, `*.pos`): uma alteração não substitui a cópia do jogador. Um arquivo novo desse tipo só é baixado por quem não o tem.
- As regras ficam no início de `tools/release.js` (`LAUNCHER_FILES`, `IGNORE`, `SEED`).

### Arquivos compartilhados (`Data/AssetLinks.txt`)

Muitas texturas e modelos são iguais em mais de uma pasta (ex.: o mesmo tile em 48 pastas `World`). Desde 2026-11-13 o cliente tem só uma cópia de cada um. O mapa `Data/AssetLinks.txt` lista `cópia<TAB>original`. Quando o jogo abre uma cópia que não existe, o `glu32.dll` (`MainLoader/` no repositório do servidor) abre o original.

- O `release:client` refaz o mapa. O mapa leva as cópias que já estão nele e as cópias novas iguais a um arquivo da pasta. O zip não leva as cópias.
- As cópias não ficam na pasta do cliente. As 5 501 cópias de 2026-11-13 estão em `_backup/client_2026-11-13_shared_files/`.
- Um arquivo real no caminho de uma cópia sempre vence. Para dar a uma pasta uma textura própria, ponha o arquivo novo nesse caminho e rode `release:patch`.
- Altere o original para alterar todas as cópias. O patch manda o original e também as cópias, para quem tem o cliente antigo com as cópias reais.
- Ferramentas que leem arquivos direto do disco (scripts Python do ModelTool) não passam pelo `glu32.dll`. Para elas, leia o caminho do original no mapa.

### Itens ou personagens novos: atualize a lista de leitura

A `AsgardCustom.dll` carrega os modelos e texturas de `Data/Item` e `Data/Player` no select server. Para isso ela lê os arquivos na ordem do disco, com base numa lista. Sem a lista certa, a primeira abertura num PC frio (recém-ligado) leva até 50 s para chegar ao select de personagem. Com a lista, leva cerca de 10 s.

- A DLL usa `ErrorLog/DeferFiles.txt`. Ela grava esse arquivo a cada abertura com os arquivos que abriu.
- Se esse arquivo não existe (instalação nova, `ErrorLog` apagado), a DLL usa `Data/Custom/DeferFiles.txt`, que vai com o cliente.

Um arquivo novo que falta na lista não quebra nada. A DLL lê esse arquivo do disco do jeito antigo, só ele fica mais lento. Na abertura seguinte, a lista do jogador em `ErrorLog` já o inclui. Um arquivo removido que está na lista é ignorado.

Atualize `Data/Custom/DeferFiles.txt` quando o patch adicionar, trocar ou remover muitos arquivos em `Data/Item` ou `Data/Player` (por exemplo, um conjunto de itens novos):

1. Copie os arquivos novos para a pasta do cliente.
2. Abra o jogo pela pasta do cliente e espere o select server por cerca de 15 s (o carregamento termina e a DLL grava a lista).
3. Feche o jogo.
4. Copie `ErrorLog/DeferFiles.txt` para `Data/Custom/DeferFiles.txt`.
5. Confira que o arquivo tem mais de 5 000 linhas.
6. Publique o patch. `Data/Custom/DeferFiles.txt` aparece em "Alterados".

O `AsgardCustom.log` mostra a lista em uso: `deferread: ... files ... read in ... ms`. A linha `deferread: no ErrorLog\DeferFiles.txt, list from Data\Custom\DeferFiles.txt` indica que a cópia do cliente foi usada.

## Publicar um launcher novo

1. Aumente `"version"` no `package.json` (ex.: `1.0.0` -> `1.0.1`).
2. Rode `npm run dist` (precisa do Rust: `rustup`). O instalador fica em `dist\AsgardMU-Setup-<versão>.exe`.
3. Rode `npm run release:launcher`. Responda `s` para enviar. O link fixo do site passa a entregar o instalador novo.

O `npm run dist` verifica o instalador com o Windows Defender. Se houver detecção, ele apaga o instalador e mostra um erro: rode `npm run dist` de novo. O launcher 2.0.0 foi publicado com um falso positivo (`Trojan:Win32/Bearfoos.A!ml`) e o manifesto voltou para o 1.0.7 no mesmo dia.

O launcher só se atualiza para uma versão maior. O script recusa a mesma versão com outro conteúdo.

## Link do site

A página de downloads do site (Asgard-Mu-Website, `src/app/downloads/page.tsx`) aponta só para este link, sempre da última versão:
`https://github.com/AutomatosData/asgard-mu-client/releases/download/current/AsgardMU-Setup.exe`

O `npm run release:launcher` atualiza o arquivo desse link. O Google Drive não é mais usado (removido em 2026-11-09).

## Aviso do Windows (SmartScreen)

O instalador não tem assinatura digital. Na primeira vez, o Windows mostra "O Windows protegeu o computador".
O jogador clica em "Mais informações" -> "Executar assim mesmo". O aviso some com o tempo, quando o arquivo fica conhecido.
Um certificado de assinatura de código remove o aviso, mas é pago.

## Testar sem publicar

1. `node tools/release.js client --local --yes --client <pasta de teste>`. Os arquivos vão para `.release-local/`.
2. `npm run release:serve` (servidor local na porta 18787). Para ver as barras andando, limite a velocidade: `node tools/serve-local.js 18787 1024` (1024 KB/s).
3. Copie `src-tauri\target\release\AsgardMU.exe` para uma pasta vazia.
4. Abra o `AsgardMU.exe` dessa pasta com a variável `ASGARD_MANIFEST_URL=http://127.0.0.1:18787/current/update.json`.
5. Para testar um patch: altere um arquivo da pasta de teste e rode `node tools/release.js patch --local --yes --client <pasta de teste>`.

O launcher de teste grava `gamePath` em `%APPDATA%\AsgardMU\config.json`. Faça uma cópia antes e restaure depois.

## Limites

- GitHub: 2 GB por arquivo e até 1000 arquivos por release (o script divide em mais releases). O repositório tem que ser público.
- O primeiro MD5 de todo o cliente leva alguns minutos. O cache fica em `.release-cache/` e as próximas vezes são rápidas.
