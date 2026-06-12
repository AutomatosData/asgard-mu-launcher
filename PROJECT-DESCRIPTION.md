**MU Online Launcher** is a free, open-source advanced game launcher built with Electron for MU Online private servers. This modern launcher provides a complete solution for server administrators who want to offer their players a professional, feature-rich gaming experience.

The launcher combines a sleek, customizable interface with powerful features like auto-login, game file updates, in-game settings management, and real-time server information display through an integrated webview.

## Key Features

### **Auto-Update System**
- Automatically checks for game file updates from your server
- Downloads and validates files with MD5 hash verification
- Smart file comparison to only update modified files
- Progress tracking with visual feedback
- Configurable update server URL

### **Multi-Account Auto-Login**
- Manage up to 3 game accounts with automatic login
- Secure credential storage in `xAccounts.ini` file
- One-click launch with pre-configured accounts
- Support for automatic login on game start
- Account monitoring to track connected characters

### **Settings Manager**
- Direct Windows Registry manipulation for game settings
- Configure resolution, graphics quality, and display options
- Music and sound volume controls
- Camera settings adjustment
- Import/export settings functionality
- Apply settings without manual registry editing

### **Integrated Web Content Display**
- Embedded webview for displaying server website content

### **Game Process Management**
- Automatic game executable detection and launch
- Multiple game instance support
- Window detection and character monitoring
- System tray integration for background operation
- Minimize to tray functionality

### **User-Friendly Interface**
- Modern, responsive design with smooth animations
- Control buttons (minimize, maximize, close)
- Settings modal for launcher configuration
- Visual update progress indicators
- Notification system for important events
- System tray menu for quick access

### **Smart File Management**
- Automatic game path detection
- Data folder organization
- Log file generation for troubleshooting
- File integrity validation
- Backup and restore capabilities

## Technical Specifications

### **Platform Support**
- Windows (primary target)
- Cross-platform capable (Windows, macOS, Linux)

### **Built With**
- **Electron 39.0.0** - Desktop application framework
- **Node.js 16+** - JavaScript runtime
- **Axios** - HTTP client for updates
- **electron-store** - Persistent configuration storage
- **fs-extra** - Enhanced file system operations

## Configuration

The launcher is highly customizable through the `src/shared/url-config.js` file:

    BASE_URL: 'https://yourserver.com',
    GITHUB_DOWNLOAD: 'https://github.com/yourrepo/download',
    UPDATE_URL: 'https://yourserver.com/updates'

### Configuration Options:
- **BASE_URL**: Server website URL displayed in the webview
- **GITHUB_DOWNLOAD**: Download link for the launcher
- **UPDATE_URL**: Server endpoint for game file updates

## Usage

### **For Server Administrators:**
1. Configure `url-config.js` with your server URLs
2. Set up your update server with `update.json` manifest
3. Compile the launcher using the provided build script
4. Distribute the executable to your players

## Build Instructions

### **Quick Start (No Compilation)**
```powershell
npm install
npm start
```

### **Production Build**
```powershell
npm install
.\build.ps1
```

The compiled launcher will be available in `dist-limpo\MUOnline-win32-x64\`

## Features for Server Owners

- **Easy Customization**: Simple configuration file for branding
- **Update Control**: Manage game file updates from your server
- **Web Integration**: Display your website content directly in the launcher
- **Free & Open Source**: No licensing fees, full source code access
- **Community Support**: Built for the MU Online private server community
