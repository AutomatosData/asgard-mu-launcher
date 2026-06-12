# MU Online - Advanced Launcher

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

### 4. Windows SDK (to apply admin manifest)
- Usually installed with Visual Studio Build Tools
- Default location: `C:\Program Files (x86)\Windows Kits\10\bin\`
- Required for the `mt.exe` command used in build

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

npm install && npm install --prefix update-creator



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
- Apply admin manifest via UAC
- Remove unnecessary files (~150 MB final)
- Optimize locales (keep only en-US)

**Final executable**: `dist-limpo\MUOnline-win32-x64\MUOnline.exe`

#### Option B: Default Build with Electron Builder
```powershell
npm run build:win
```

**Final executable**: `dist\win-unpacked\MUOnline.exe`

#### Option C: Build with Electron Packager
```powershell
npm run pack-win
```

**Final executable**: `dist\MUOnline-win32-x64\MUOnline.exe`

---

## Output Structure

After building with `.\build.ps1`, you'll have:

```
dist-limpo/
└── MUOnline-win32-x64/
    ├── MUOnline.exe           # Main executable
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
  // Your server/website URL (where CMS is hosted)
  BASE_URL: 'http://localhost/cms_new',
  
  // Full game client URL on GitHub (or other host)
  GITHUB_DOWNLOAD: 'https://github.com/user/project/releases/download/v1.0/Client.zip',
  
  // Launcher endpoints
  LAUNCHER: {
    MAIN: '/launcher',      // Main webview page
    UPDATE: '/update'       // Update API
  }

  // ===== GAME CONFIGURATION (developer only) =====
  /** Name of the game executable (e.g., main.exe). Change this here if the client uses another .exe */
  GAME_EXECUTABLE: 'main.exe',

};
```

** Important:**
- `BASE_URL`: Your website/server URL where CMS is hosted
- `GITHUB_DOWNLOAD`: Direct URL to full client ZIP file
- Launcher will load `${BASE_URL}/launcher` in webview
- Update system will check `${BASE_URL}/update`

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

### Error: "mt.exe not found" (build.ps1)
- Check if Windows SDK is installed
- Adjust the path in `build.ps1` file at the `mt.exe` line:
```powershell
# Locate your installed version at:
C:\Program Files (x86)\Windows Kits\10\bin\
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
4. **Privileges**: The launcher requests administrator permissions via UAC
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
