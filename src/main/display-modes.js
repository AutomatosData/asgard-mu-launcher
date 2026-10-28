// Lista de resoluções igual à do jogo (main.exe S21).
//
// O jogo não tem tabela fixa: o DevModeIndex do LauncherOption.if é a posição na lista de
// modos do monitor principal (EnumDisplaySettings, na ordem do Windows), sem repetir
// tamanhos e só com largura >= 800 e proporção exata 4:3, 16:9 ou 16:10. Índice fora da
// lista abre em 800x600. Medido em 2026-10-17 (FpsPatch/resolution_sweep.py).
const { execFile } = require('child_process');

const SCRIPT = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class DisplayModes {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct DEVMODE {
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string dmDeviceName;
    public short dmSpecVersion, dmDriverVersion, dmSize, dmDriverExtra;
    public int dmFields, dmPositionX, dmPositionY, dmDisplayOrientation, dmDisplayFixedOutput;
    public short dmColor, dmDuplex, dmYResolution, dmTTOption, dmCollate;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string dmFormName;
    public short dmLogPixels;
    public int dmBitsPerPel, dmPelsWidth, dmPelsHeight, dmDisplayFlags, dmDisplayFrequency;
    public int dmICMMethod, dmICMIntent, dmMediaType, dmDitherType, dmReserved1, dmReserved2, dmPanningWidth, dmPanningHeight;
  }
  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  public static extern bool EnumDisplaySettings(string device, int mode, ref DEVMODE dm);
  public static string List() {
    var dm = new DEVMODE(); dm.dmSize = (short)Marshal.SizeOf(typeof(DEVMODE));
    var sb = new System.Text.StringBuilder();
    for (int i = 0; EnumDisplaySettings(null, i, ref dm); i++)
      sb.Append(dm.dmPelsWidth).Append('x').Append(dm.dmPelsHeight).Append(' ');
    return sb.ToString();
  }
}
"@
[DisplayModes]::List()
`;

function gameRatio(w, h) {
  if (w * 3 === h * 4) return '4:3';
  if (w * 9 === h * 16) return '16:9';
  if (w * 10 === h * 16) return '16:10';
  return null;
}

// [{ index, width, height, ratio }] na ordem do jogo
function filterModes(sizes) {
  const seen = new Set();
  const modes = [];
  for (const size of sizes) {
    if (seen.has(size)) continue;
    seen.add(size);
    const [w, h] = size.split('x').map(Number);
    const ratio = gameRatio(w, h);
    if (w >= 800 && ratio) modes.push({ index: modes.length, width: w, height: h, ratio });
  }
  return modes;
}

let cache = null;

function getDisplayModes() {
  if (cache) return Promise.resolve(cache);
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', SCRIPT],
      { windowsHide: true, timeout: 20000 }, (error, stdout) => {
        const sizes = (stdout || '').trim().split(/\s+/).filter(s => /^\d+x\d+$/.test(s));
        if (error || sizes.length === 0) {
          console.error('[DisplayModes] Failed to read display modes:', error && error.message);
          resolve([]);
          return;
        }
        cache = filterModes(sizes);
        resolve(cache);
      });
  });
}

module.exports = { getDisplayModes, filterModes };
