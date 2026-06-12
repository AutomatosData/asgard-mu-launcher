const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs-extra');
const crypto = require('crypto');

let mainWindow;
let selectedItems = []; // Array para múltiplas seleções

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1050,  // +15% de 900 = 1035, arredondado para 1050
    height: 950,  // Aumentado bastante para não cortar botões
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    },
    resizable: true,  // Permitir redimensionar caso necessário
    titleBarStyle: 'default',
    show: false
  });

  mainWindow.loadFile('index.html');
  
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Abrir DevTools em desenvolvimento
  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools();
  }
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Calcular hash MD5 de um arquivo
async function calculateFileHash(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('md5');
    const stream = fs.createReadStream(filePath);
    
    stream.on('data', (data) => {
      hash.update(data);
    });
    
    stream.on('end', () => {
      resolve(hash.digest('hex'));
    });
    
    stream.on('error', (error) => {
      reject(error);
    });
  });
}

// Escanear pasta recursivamente
async function scanDirectory(dirPath, basePath, progressCallback) {
  const files = [];
  
  async function scanRecursive(currentPath) {
    const items = await fs.readdir(currentPath);
    
    for (const item of items) {
      const fullPath = path.join(currentPath, item);
      const stat = await fs.stat(fullPath);
      
      if (stat.isDirectory()) {
        await scanRecursive(fullPath);
      } else if (stat.isFile()) {
        try {
          // Calcular caminho relativo ao diretório base
          const relativePath = path.relative(basePath, fullPath).replace(/\\/g, '/');
          
          // Calcular hash MD5
          const hash = await calculateFileHash(fullPath);
          
          // Informações do arquivo
          const fileInfo = {
            path: relativePath,
            size: stat.size,
            hash: hash,
            modified: stat.mtime.toISOString()
          };
          
          files.push(fileInfo);
          
          // Callback de progresso
          if (progressCallback) {
            progressCallback({
              file: relativePath,
              processed: files.length
            });
          }
          
        } catch (error) {
          console.error(`Erro ao processar arquivo ${fullPath}:`, error);
        }
      }
    }
  }
  
  await scanRecursive(dirPath);
  return files;
}

// Variável global para armazenar a pasta selecionada
let selectedGameFolder = null;

// Selecionar pasta do jogo
ipcMain.handle('select-game-folder', async () => {
  try {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
      title: 'Selecione a pasta raiz do Update',
      buttonLabel: 'Selecionar Pasta'
    });

    if (!result.canceled && result.filePaths.length > 0) {
      selectedGameFolder = result.filePaths[0];
      const folderName = path.basename(selectedGameFolder);
      
      return { 
        success: true, 
        folderPath: selectedGameFolder,
        folderName: folderName
      };
    }

    return { success: false, error: 'Seleção cancelada' };
  } catch (error) {
    console.error('Erro ao selecionar pasta do update:', error);
    return { success: false, error: error.message };
  }
});

// Obter pasta selecionada
ipcMain.handle('get-selected-folder', async () => {
  if (selectedGameFolder) {
    const folderName = path.basename(selectedGameFolder);
    return { 
      success: true, 
      folderPath: selectedGameFolder,
      folderName: folderName
    };
  }
  return { success: false };
});

// Limpar seleção
ipcMain.handle('clear-selection', async () => {
  selectedGameFolder = null;
  return { success: true };
});

// Remover funções antigas que não são mais necessárias
// (selectedItems, scanDirectory, etc.)

ipcMain.handle('create-update', async () => {
  if (!selectedGameFolder) {
    return { success: false, error: 'Nenhuma pasta do jogo selecionada' };
  }

  try {
    // Verificar se a pasta existe
    if (!await fs.pathExists(selectedGameFolder)) {
      return { success: false, error: 'Pasta do jogo não encontrada' };
    }

    // Começar escaneamento
    mainWindow.webContents.send('update-progress', {
      stage: 'scanning',
      message: 'Escaneando pasta do jogo...'
    });

    // Obter todos os arquivos dentro da pasta do jogo (ignorando a pasta base)
    const allFiles = await getAllFilesFromFolder(selectedGameFolder);
    
    if (allFiles.length === 0) {
      return { success: false, error: 'Nenhum arquivo encontrado na pasta do jogo' };
    }

    // Criar manifesto
    const manifest = [];
    let totalSize = 0;

    // Processar cada arquivo
    for (let i = 0; i < allFiles.length; i++) {
      const filePath = allFiles[i];
      
      try {
        // Calcular caminho relativo (ignorando a pasta base)
        const relativePath = path.relative(selectedGameFolder, filePath);
        
        // Obter estatísticas do arquivo
        const stats = await fs.stat(filePath);
        
        // Calcular hash MD5
        const hash = await calculateFileHash(filePath);
        
        // Adicionar ao manifesto
        manifest.push({
          path: relativePath.replace(/\\/g, '/'), // Usar forward slashes
          size: stats.size,
          hash: hash,
          modified: stats.mtime.toISOString()
        });
        
        totalSize += stats.size;
        
        // Enviar progresso
        mainWindow.webContents.send('update-progress', {
          stage: 'processing',
          message: `Processando arquivo ${i + 1}/${allFiles.length}`,
          processed: i + 1,
          total: allFiles.length
        });
        
      } catch (error) {
        console.error(`Erro ao processar arquivo ${filePath}:`, error);
      }
    }

    // Criar pasta update se não existir (na raiz do executável)
    const updateFolder = path.join(__dirname, '../../update');
    await fs.ensureDir(updateFolder);

    // Salvar manifesto
    const manifestPath = path.join(updateFolder, 'update.json');
    await fs.writeJson(manifestPath, manifest, { spaces: 2 });

    // Copiar arquivos para a pasta update
    mainWindow.webContents.send('update-progress', {
      stage: 'copying',
      message: 'Copiando arquivos para pasta update...'
    });

    let copiedItems = 0;
    for (let i = 0; i < allFiles.length; i++) {
      const filePath = allFiles[i];
      const relativePath = path.relative(selectedGameFolder, filePath);
      const targetPath = path.join(updateFolder, relativePath);
      
      try {
        // Criar diretório de destino se necessário
        await fs.ensureDir(path.dirname(targetPath));
        
        // Copiar arquivo
        await fs.copy(filePath, targetPath);
        copiedItems++;
        
        // Enviar progresso de cópia
        mainWindow.webContents.send('update-progress', {
          stage: 'copying-progress',
          message: `Copiando arquivo ${i + 1}/${allFiles.length}`,
          processed: i + 1,
          total: allFiles.length
        });
        
      } catch (error) {
        console.error(`Erro ao copiar arquivo ${filePath}:`, error);
      }
    }

    // Finalizar
    mainWindow.webContents.send('update-progress', {
      stage: 'completed',
      message: 'Update criado com sucesso!',
      totalFiles: allFiles.length
    });

    return {
      success: true,
      totalFiles: allFiles.length,
      totalSize: totalSize,
      outputPath: manifestPath,
      updateFolder: updateFolder,
      totalItemsCopied: copiedItems
    };

  } catch (error) {
    console.error('Erro ao criar update:', error);
    mainWindow.webContents.send('update-progress', {
      stage: 'error',
      message: `Erro: ${error.message}`
    });
    return { success: false, error: error.message };
  }
});

// Função para obter todos os arquivos de uma pasta (recursivamente)
async function getAllFilesFromFolder(folderPath) {
  const files = [];
  
  try {
    const items = await fs.readdir(folderPath);
    
    for (const item of items) {
      const itemPath = path.join(folderPath, item);
      const stats = await fs.stat(itemPath);
      
      if (stats.isDirectory()) {
        // Recursivamente obter arquivos das subpastas
        const subFiles = await getAllFilesFromFolder(itemPath);
        files.push(...subFiles);
      } else {
        // Adicionar arquivo à lista
        files.push(itemPath);
      }
    }
  } catch (error) {
    console.error(`Erro ao ler pasta ${folderPath}:`, error);
  }
  
  return files;
}
