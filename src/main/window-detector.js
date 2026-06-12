const { exec } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const path = require('path');
const os = require('os');

const execAsync = promisify(exec);

class WindowDetector {
  constructor() {
    this.detectedCharacters = [];
    this.lastScanTime = 0;
    this.scanInterval = null;
    this.isScanning = false;
  }
  async detectMUWindows() {
    try {
      if (process.platform !== 'win32') {
        return [];
      }

      const tempDir = os.tmpdir();
      const tempFile = path.join(tempDir, 'mu-detection.ps1');
      
      const psScript = `
Get-Process -Name main -ErrorAction SilentlyContinue | 
Where-Object {$_.MainWindowTitle -ne $null -and $_.MainWindowTitle -ne ""} | 
Select-Object Id, MainWindowTitle | 
ConvertTo-Json
      `.trim();
      
      fs.writeFileSync(tempFile, psScript, 'utf8');
      
      const { stdout, stderr } = await execAsync(`powershell -ExecutionPolicy Bypass -File "${tempFile}"`);
      
      try {
        fs.unlinkSync(tempFile);
      } catch (cleanupError) {
      }
      
      if (stderr) {
        console.error('[WindowDetector] PowerShell error:', stderr);
      }
      
      let characters = [];
      
      if (stdout && stdout.trim() !== '') {
        characters = this.parseWindowTitles(stdout);
      }
      
      // Sempre atualizar a lista de personagens detectados, mesmo se vazia
      this.detectedCharacters = characters;
      this.lastScanTime = Date.now();
      
      return characters;
      
    } catch (error) {
      console.error('[WindowDetector] Detection failed:', error.message);
      // Em caso de erro, limpar a lista de personagens detectados
      this.detectedCharacters = [];
      this.lastScanTime = Date.now();
      return [];
    }
  }

  parseWindowTitles(jsonOutput) {
    try {
      const parsed = JSON.parse(jsonOutput);
      
      // Converter para array se for um objeto único
      const processes = Array.isArray(parsed) ? parsed : [parsed];
      
      const characters = [];
      
      for (const process of processes) {
        if (process.MainWindowTitle) {
          const title = process.MainWindowTitle.trim();
          
          // Extrair nome do personagem do título
          const characterName = this.extractCharacterName(title);
          
          if (characterName && this.isValidCharacterName(characterName)) {
            characters.push({
              name: characterName,
              processId: process.Id,
              lastSeen: Date.now()
            });
          }
        }
      }
      
      return characters;
      
    } catch (error) {
      console.error('[WindowDetector] Error parsing window titles:', error.message);
      return [];
    }
  }

  extractCharacterName(title) {
    // Procurar por padrão "Name: NomeDoPersonagem"
    const nameMatch = title.match(/Name:\s*([a-zA-Z0-9_-]+)/i);
    if (nameMatch && nameMatch[1]) {
      return nameMatch[1].trim();
    }
    
    // Se não encontrar o padrão, retornar o título completo
    return title;
  }

  isValidCharacterName(title) {
    if (title.length < 3 || title.length > 20) {
      return false;
    }
    
    const validPattern = /^[a-zA-Z0-9_-]+$/;
    if (!validPattern.test(title)) {
      return false;
    }
    
    const genericTitles = ['main', 'mu', 'game', 'client', 'launcher'];
    if (genericTitles.includes(title.toLowerCase())) {
      return false;
    }
    
    return true;
  }

  startMonitoring(intervalMs = 5000) {
    if (this.scanInterval) {
      clearInterval(this.scanInterval);
    }
    
    this.isScanning = true;
    this.scanInterval = setInterval(async () => {
      try {
        await this.detectMUWindows();
      } catch (error) {
        console.error('[WindowDetector] Error during monitoring:', error.message);
      }
    }, intervalMs);
  }

  stopMonitoring() {
    if (this.scanInterval) {
      clearInterval(this.scanInterval);
      this.scanInterval = null;
    }
    this.isScanning = false;
  }

  getDetectedCharacters() {
    return [...this.detectedCharacters];
  }

  isActive() {
    return this.isScanning;
  }

  getLastScanTime() {
    return this.lastScanTime;
  }
}

module.exports = WindowDetector;