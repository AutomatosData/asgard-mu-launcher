# AsgardMU Launcher: compilar

O launcher é feito em Rust + Tauri 2. A interface é HTML, CSS e JavaScript sem etapa de build.

## Requisitos

- Windows 10 ou 11 (x64).
- Rust (`rustup`, toolchain `stable-x86_64-pc-windows-msvc`) e as Build Tools do Visual Studio (C++).
- Node.js 18 ou mais novo (CLI do Tauri e `tools/`).
- `npm install` na pasta do projeto.

## Comandos

| Comando | Resultado |
|---|---|
| `npm start` | Abre o launcher em modo de desenvolvimento. |
| `npm run build` | Compila `src-tauri\target\release\AsgardMU.exe`, sem instalador. |
| `npm run dist` | Compila e gera `dist\AsgardMU-Setup-<versão>.exe` (NSIS). |
| `cargo test` (em `src-tauri`) | Testes do token do jogo, das versões e dos caminhos do manifesto. |

A versão vem do `package.json`. O `tauri.conf.json` lê esse valor.

## Pastas

| Pasta | Conteúdo |
|---|---|
| `ui/` | Interface: `index.html`, `crash-report.html`, `toast.html`, `scripts/`, `styles/`, `shared/`. |
| `src-tauri/src/` | Launcher em Rust. Um arquivo por função (tabela abaixo). |
| `src-tauri/installer-hooks.nsh` | Regras do instalador: pasta padrão, migração do launcher Electron, desinstalação. |
| `tools/` | Publicação (`release.js`), instalador (`dist.js`), servidor de teste (`serve-local.js`). |

| Arquivo Rust | Função |
|---|---|
| `main.rs` | Janela, webview do site, avisos, bandeja, ping e os comandos da interface. |
| `updater.rs` | Patches pelo `update.json` (MD5 com cache). |
| `data.rs` | Primeira instalação: partes `.zip` com retomada e extração. |
| `self_update.rs` | Atualização do próprio launcher. |
| `game.rs` | Abre o `main.exe` com o token (`-k`, `-a`) e fecha o jogo. |
| `anticheat.rs` | Varredura de processos e janelas; registro no site. |
| `crash.rs` | Relatório de crash (envio automático; janela se o envio falhar). |
| `help.rs` | F1 no jogo abre o whitepaper. |
| `options.rs` | `LauncherOption.if` e registro `HKCU\Software\Webzen\Mu\Config`. |
| `dirs.rs` | Pasta do jogo e arquivos ocultos. |
| `sys.rs` | Chamadas ao Windows (processos, janelas, monitor, ID da máquina). |
| `config.rs`, `store.rs`, `i18n.rs`, `logger.rs`, `language_pack.rs` | Endereços, `config.json`, textos da bandeja, logs, limpeza de traduções antigas. |

## Interface e Rust

`ui/scripts/bridge.js` liga os canais da interface aos comandos Rust. O canal `get-config` chama o comando `get_config`. O argumento do canal chega como `payload`.

O site (`asgardmu.com.br/new`) abre em um webview filho, por cima da área de conteúdo. Um webview filho cobre o HTML da interface. Por isso:

- O launcher esconde o site quando a janela de configurações abre.
- Os avisos aparecem em uma janela transparente (`ui/toast.html`).
- A janela principal tem dois webviews. Use `get_window("main")` e `get_webview("main")`. Não use `get_webview_window("main")`.

## Testar sem mouse (só em compilação de depuração)

- `%TEMP%\asgard-eval-main.js`: o launcher roda este JavaScript na interface e apaga o arquivo.
- `%TEMP%\asgard-debug.txt` com `help`, `crash`, `tray` ou `show`: abre a janela do F1, a janela de crash, manda para a bandeja ou mostra a janela.

Em desenvolvimento, a pasta do jogo é o `gamePath` de `%APPDATA%\AsgardMU\config.json`. O launcher de teste atualiza e abre esse cliente.

## Publicar

Veja `PUBLICAR.md`.
