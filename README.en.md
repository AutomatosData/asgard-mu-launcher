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
    MAIN: 'news'                     // Start screen page → https://asgardmu.com.br/news
  },

  // Game patches (Cloudflare R2 bucket on a custom domain)
  UPDATE: {
    BASE_URL: 'https://updates.asgardmu.com.br/', // must end with "/"
    MANIFEST: 'update.json'
  },

  // Full game client (GitHub Releases)
  GITHUB: {
    OWNER: 'AutomatosData',
    REPO: 'asgard-mu-client',
    CLIENT_ASSET: 'AsgardMU-Client.zip'
  },

  GAME_EXECUTABLE: 'main.exe',
};
```

**Where each URL points:**

| What | URL | Hosted on |
|---|---|---|
| Start screen (webview) | `https://asgardmu.com.br/news` | Vercel (website) |
| Patch manifest | `https://updates.asgardmu.com.br/update.json` | Cloudflare R2 |
| Patch files | `https://updates.asgardmu.com.br/<file path>?v=<md5>` | Cloudflare R2 |
| Full client (first install) | `https://github.com/AutomatosData/asgard-mu-client/releases/latest/download/AsgardMU-Client.zip` | GitHub Releases |

- To show another page on the start screen, change only `LAUNCHER.MAIN`.
- The manifest is always requested with a `?t=<timestamp>` query so the Cloudflare cache never serves an old one; files use `?v=<md5>` so a patch that overwrites a file is never served stale.
- If the manifest can't be downloaded, the launcher skips the update and lets the player start the game (the error goes to `Data/Launcher/Logs/update.log`).

---

## Distributing the Game

Game files are **not** hosted on Vercel (the free plan has limited bandwidth and no FTP). They are split in two:

### Full client → GitHub Releases

Used once, on first install (`src/main/data-manager.js` downloads and extracts the ZIP next to the launcher).

```powershell
.\create-github-release.ps1 -Version "v1.0.0" -GamePath "C:\path\to\game"
```

- Packs `Data`, `main.exe` and `Settings.ini` (edit `$itemsToInclude` in the script) into `AsgardMU-Client.zip` and publishes it as the latest release of `AutomatosData/asgard-mu-client`.
- The asset name must always be `AsgardMU-Client.zip` (same as `GITHUB.CLIENT_ASSET`), so the `/releases/latest/download/` link keeps working.
- Requires the GitHub CLI (`gh`) logged in with write access to the repository. Max 2 GB per file.

### Patches → Cloudflare R2

Used on every launcher start: the launcher compares local files with `update.json` (size + MD5) and downloads only what changed.

**One-time setup:**

1. Cloudflare dashboard → **R2** → create the bucket `asgard-mu-updates`.
2. Bucket → **Settings** → **Custom Domains** → add `updates.asgardmu.com.br` (the DNS is already on Cloudflare, so the record is created automatically).
3. R2 → **Manage API Tokens** → create a token with *Object Read & Write* for that bucket and note the *Access Key ID*, *Secret Access Key* and the account endpoint (`https://<account_id>.r2.cloudflarestorage.com`).
4. Install rclone and create the remote `r2`:
   ```powershell
   winget install Rclone.Rclone
   rclone config create r2 s3 provider=Cloudflare access_key_id=<KEY_ID> secret_access_key=<SECRET> endpoint=https://<account_id>.r2.cloudflarestorage.com acl=private
   ```

**Publishing a patch:**

1. Open the **update-creator** (`update-creator/`), select the game folder and click create. It writes the `update` folder (`update.json` + files, keeping the folder structure).
2. Upload it:
   ```powershell
   .\publish-update.ps1 -Source "C:\path\to\update"          # upload new/changed files
   .\publish-update.ps1 -Source "C:\path\to\update" -DryRun  # only show what would be sent
   .\publish-update.ps1 -Source "C:\path\to\update" -Prune   # also delete files removed from the patch
   ```
   The script validates the manifest, uploads the files first and `update.json` last, so players never get a manifest pointing to files that are not uploaded yet.

R2 free tier: 10 GB of storage and no egress (download) fees.

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
| `.\create-github-release.ps1` | Publish the full game client to GitHub Releases |
| `.\publish-update.ps1` | Publish a game patch to Cloudflare R2 |

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
