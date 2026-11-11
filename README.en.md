# AsgardMU - Advanced Launcher

## Build Prerequisites (Windows)

To compile this project on Windows, you'll need to install the following software:

### 1. Node.js (version 16 or higher)
- Download at: https://nodejs.org/
- Recommended: LTS (Long Term Support) version
- During installation, check "Add to PATH"

### 2. Python (version 3.x)
- Download at: https://www.python.org/downloads/
- **IMPORTANT**: During installation, check "Add Python to PATH"
- **When needed?** Only if future dependencies require compiling native modules
- **Can skip for now** - Current project doesn't use native modules requiring compilation

### 3. Visual Studio Build Tools
- Download at: https://visualstudio.microsoft.com/downloads/
- Look for "Build Tools for Visual Studio"
- During installation, select:
  -  "Desktop development with C++"
  -  "Windows 10 SDK" (or higher)
- **When needed?** Only if future dependencies require compiling native modules
- **Can skip for now** - Current project doesn't use native modules requiring compilation

---

##  Build Instructions

### Step 1: Download the Project
```powershell
# Download the project ZIP file
# Extract to a folder of your choice
# Navigate to the extracted folder
cd "path\to\launcher"
```

### Step 2: Install Dependencies
Open PowerShell in the project folder and run:

npm install



This command will:
- Install all dependencies listed in `package.json`
- Set up the Electron environment

**Note**: Installation may take a few minutes the first time.

** Tip**: If you already have the `node_modules` folder (from another developer or backup), you can copy it directly.

---

## Test the Launcher (Without Building)

If you just want to **test or use the launcher** without building:


### Step 3: Run the Launcher
```powershell
npm start
```

The launcher will open in development mode. You can use it normally without building!

**Debug Mode** (for developers):
```powershell
npm run dev
```

This mode displays the development console for debugging.

---

## Build the Project (Generate Executable)

**Note**: Only build if you want to generate a standalone `.exe` executable.

#### Option A: Clean and Optimized Build (Recommended)
```powershell
.\build.ps1
```

This script will:
- Stop existing launcher processes
- Clean previous builds
- Copy only essential files
- Build the project with ASAR (obfuscated code)
- Remove unnecessary files (~150 MB final)
- Optimize locales (keep only en-US)

**Final executable**: `dist-limpo\AsgardMU-win32-x64\AsgardMU.exe`

#### Option B: Default Build with Electron Builder
```powershell
npm run build:win
```

**Final executable**: `dist\win-unpacked\AsgardMU.exe`

#### Option C: Build with Electron Packager
```powershell
npm run pack-win
```

**Final executable**: `dist\AsgardMU-win32-x64\AsgardMU.exe`

---

## Output Structure

After building with `.\build.ps1`, you'll have:

```
dist-limpo/
└── AsgardMU-win32-x64/
    ├── AsgardMU.exe           # Main executable
    ├── resources/
    │   └── app.asar           # Application code (obfuscated)
    ├── locales/
    │   └── en-US.pak          # English only (optimized)
    ├── chrome_100_percent.pak
    ├── chrome_200_percent.pak
    ├── resources.pak
    └── ... (other essential files)
```

---

## Launcher Configuration

### Change Server and Download URLs

Edit the file **`src/shared/url-config.js`** to configure:

```javascript
const URL_CONFIG = {
  // Website shown in the start screen webview (hosted on Vercel)
  BASE_URL: 'https://asgardmu.com.br/',
  LAUNCHER: {
    MAIN: 'new'                     // Start screen page → https://asgardmu.com.br/new
  },

  // Everything the launcher downloads: GitHub Releases of this public repository
  GITHUB: {
    OWNER: 'AutomatosData',
    REPO: 'asgard-mu-client',
    CURRENT_TAG: 'current'          // release that holds update.json
  },

  GAME_EXECUTABLE: 'main.exe',
  GAME_LOADER: 'glu32.dll',
};
```

**Where each URL points:**

| What | URL | Hosted on |
|---|---|---|
| Start screen (webview) | `https://asgardmu.com.br/new` | Vercel (website) |
| Manifest (client, launcher, patches) | `https://github.com/AutomatosData/asgard-mu-client/releases/download/current/update.json` | GitHub Releases |
| Client parts, patch files, launcher setup | URLs inside `update.json`, relative to it | GitHub Releases |

- To show another page on the start screen, change only `LAUNCHER.MAIN`.
- The manifest is always requested with a `?t=<timestamp>` query, so it is never served stale.
- If the manifest can't be downloaded, the launcher skips the update and lets the player start the game (the error goes to `Data/Launcher/Logs/update.log`).
- `ASGARD_MANIFEST_URL` (environment variable) replaces the manifest URL, for local tests.

---

## Distributing the Game

Step by step (Portuguese): **[PUBLICAR.md](PUBLICAR.md)**. Cost: zero.

- **Installer** (`npm run dist` -> `dist/AsgardMU-Setup-<version>.exe`, ~5 MB, Rust + Tauri): NSIS, per user, no UAC, default folder `C:\AsgardMU`. Players download it from the fixed GitHub link `releases/download/current/AsgardMU-Setup.exe` (downloads page of the site).
- **Full client**: on the first start the launcher downloads the `.zip` parts listed in `update.json` -> `client.parts` and extracts them next to `AsgardMU.exe` (`src/main/data-manager.js`; resumes broken downloads, checks size and MD5).
- **Patches**: on every start the launcher checks the files in `update.json` -> `files` (size + MD5, with a hash cache in `Data/Launcher/hash-cache.json`) and downloads only what changed (`src/main/updater.js`).
- **Launcher updates**: if `update.json` -> `launcher.version` is higher than the installed one, the launcher downloads the new setup, runs it silently in the same folder and quits; the setup starts the new launcher (`src/main/launcher-update.js`). `build/installer.nsh` keeps the game files during the update; uninstalling from Windows removes the whole folder.

Publishing (`tools/release.js`, uses the GitHub CLI):

```powershell
npm run release:status     # what is published and what changed in the client folder
npm run release:client     # full client (first install)
npm run release:patch      # changed client files
npm run release:launcher   # dist/AsgardMU-Setup-<version>.exe
```

Add `-- --dry-run` to see what would be sent, or `-- --local` to publish to `.release-local/` and test with `npm run release:serve`.

---

## Available Scripts

| Command | Description |
|---------|-------------|
| `npm start` | Run the launcher in normal mode |
| `npm run dev` | Run in development mode (with debug) |
| `npm run build` | Default build with Electron Builder |
| `npm run build:win` | Build for Windows (without publishing) |
| `npm run pack-win` | Quick packaging for Windows |
| `.\build.ps1` | Clean and optimized build (recommended) |
| `npm run dist` | Build the installer (`dist/AsgardMU-Setup-<version>.exe`) |
| `npm run release:*` | Publish client, patches and launcher (see [PUBLICAR.md](PUBLICAR.md)) |

---

## Troubleshooting

### Error: "node-gyp not found"
```powershell
npm install -g node-gyp
npm install -g windows-build-tools
```

### Error: "Python not found"
- Reinstall Python and check "Add to PATH"
- Or configure manually:
```powershell
npm config set python "C:\Python3x\python.exe"
```

### Error: "MSBuild not found"
- Install Visual Studio Build Tools as described above
- Or configure manually:
```powershell
npm config set msbuild_path "C:\Program Files (x86)\Microsoft Visual Studio\2019\BuildTools\MSBuild\Current\Bin\MSBuild.exe"
```

### Permission denied when running build.ps1
```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

**Then run correctly:**
```powershell
.\build.ps1
```

**Note**: PowerShell requires `./` or `.\` before the script name to execute local files.

---

## Important Notes

1. **First build**: May take 5 to 15 minutes
2. **Disk space**: Reserve at least 2 GB of free space
3. **Antivirus**: May need to add exception for the project folder
4. **Privileges**: The launcher runs as a normal user (no UAC). It starts `main.exe` with `__COMPAT_LAYER=RunAsInvoker`, so the game does not ask for administrator rights either
5. **node_modules**: Don't commit this folder to Git (already in .gitignore)

---

## Support

For issues or questions:
- Check the Troubleshooting section above
- Check the logs in `Data/Launcher/logs/`
- Contact the development team

---

## License

MIT License - See LICENSE file for details.

**Contact**
Glariston
Whatsapp: +5547996896841
