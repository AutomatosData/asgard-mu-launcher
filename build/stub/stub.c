// AsgardMU.exe da pasta do jogo. O launcher (Electron) fica em "Launcher\" para a pasta
// do jogo ter só o necessário. Este programa abre Launcher\AsgardMU.exe com os mesmos
// argumentos e fecha. O instalador (build/installer.nsh) põe este arquivo na pasta do jogo.
//
// Compilar: build.bat (MSVC x64). Saída: AsgardMU.exe nesta pasta (vai no instalador).

#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <wchar.h>

#define LAUNCHER_EXE L"Launcher\\AsgardMU.exe"

// Argumentos depois do nome do programa na linha de comando
static const wchar_t *skip_program(const wchar_t *line)
{
    if (*line == L'"') {
        line++;
        while (*line && *line != L'"')
            line++;
        if (*line)
            line++;
    } else {
        while (*line && *line != L' ' && *line != L'\t')
            line++;
    }
    while (*line == L' ' || *line == L'\t')
        line++;
    return line;
}

int WINAPI wWinMain(HINSTANCE instance, HINSTANCE prev, PWSTR args, int show)
{
    wchar_t dir[MAX_PATH], exe[MAX_PATH], line[32768];
    STARTUPINFOW si = { sizeof(si) };
    PROCESS_INFORMATION pi;
    wchar_t *slash;
    DWORD size;

    (void)instance; (void)prev; (void)args; (void)show;
    size = GetModuleFileNameW(NULL, dir, MAX_PATH);
    if (!size || size >= MAX_PATH)
        return 1;
    slash = wcsrchr(dir, L'\\');
    if (!slash)
        return 1;
    slash[1] = L'\0';
    swprintf(exe, MAX_PATH, L"%s%s", dir, LAUNCHER_EXE);
    swprintf(line, 32768, L"\"%s\" %s", exe, skip_program(GetCommandLineW()));
    // Pasta de trabalho: a do launcher
    wcscat_s(dir, MAX_PATH, L"Launcher");
    if (!CreateProcessW(exe, line, NULL, NULL, FALSE, 0, NULL, dir, &si, &pi)) {
        MessageBoxW(NULL, L"Launcher\\AsgardMU.exe não foi encontrado. Reinstale o AsgardMU.",
                    L"AsgardMU", MB_OK | MB_ICONERROR);
        return 1;
    }
    // O launcher abre a janela na frente
    AllowSetForegroundWindow(pi.dwProcessId);
    CloseHandle(pi.hThread);
    CloseHandle(pi.hProcess);
    return 0;
}
