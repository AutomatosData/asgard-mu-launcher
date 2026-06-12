const fs = require('fs-extra');
const path = require('path');

class AutoLoginManager {
    constructor() {
        this.xAccountsPath = null;
        this.accountsData = {
            onSystem: 0,
            amount: 3,
            accounts: []
        };
        
        this.init();
    }

    async init() {
        // Definir caminho do arquivo xAccounts.ini
        this.xAccountsPath = path.join(process.cwd(), 'xAccounts.ini');
        
        // Carregar dados iniciais
        await this.loadXAccountsData();
        
        // Configurar event listeners
        this.setupEventListeners();
    }

    setupEventListeners() {
        // Botão para abrir modal
        document.getElementById('autoLoginBtn').addEventListener('click', () => {
            this.openModal();
        });

        // Botões do modal
        document.getElementById('closeAutoLogin').addEventListener('click', () => {
            this.closeModal();
        });

        document.getElementById('cancelAutoLogin').addEventListener('click', () => {
            this.closeModal();
        });

        document.getElementById('saveAutoLogin').addEventListener('click', () => {
            this.saveSettings();
        });

        // Event listener para mudança no número de contas
        document.getElementById('accountAmount').addEventListener('change', (e) => {
            this.updateAccountAmount(parseInt(e.target.value));
        });

        // Event listener para checkbox OnSystem
        document.getElementById('onSystemEnabled').addEventListener('change', (e) => {
            this.accountsData.onSystem = e.target.checked ? 1 : 0;
        });
    }

    async loadXAccountsData() {
        try {
            if (await fs.pathExists(this.xAccountsPath)) {
                const content = await fs.readFile(this.xAccountsPath, 'utf8');
                this.parseXAccountsContent(content);
            } else {
                // Criar arquivo padrão se não existir
                await this.createDefaultXAccounts();
            }
        } catch (error) {
            console.error('Erro ao carregar xAccounts.ini:', error);
            await this.createDefaultXAccounts();
        }
    }

    parseXAccountsContent(content) {
        const lines = content.split('\n');
        
        for (const line of lines) {
            const trimmedLine = line.trim();
            
            if (trimmedLine.startsWith('OnSystem')) {
                const match = trimmedLine.match(/OnSystem\s*=\s*(\d+)/);
                if (match) {
                    this.accountsData.onSystem = parseInt(match[1]);
                }
            } else if (trimmedLine.startsWith('Amount')) {
                const match = trimmedLine.match(/Amount\s*=\s*(\d+)/);
                if (match) {
                    this.accountsData.amount = parseInt(match[1]);
                }
            } else if (trimmedLine.startsWith('User')) {
                const match = trimmedLine.match(/User(\d+)\s*=\s*"([^"]*)"/);
                if (match) {
                    const accountIndex = parseInt(match[1]) - 1;
                    const username = match[2];
                    
                    if (!this.accountsData.accounts[accountIndex]) {
                        this.accountsData.accounts[accountIndex] = {};
                    }
                    this.accountsData.accounts[accountIndex].username = username;
                }
            } else if (trimmedLine.startsWith('Password')) {
                const match = trimmedLine.match(/Password(\d+)\s*=\s*"([^"]*)"/);
                if (match) {
                    const accountIndex = parseInt(match[1]) - 1;
                    const password = match[2];
                    
                    if (!this.accountsData.accounts[accountIndex]) {
                        this.accountsData.accounts[accountIndex] = {};
                    }
                    this.accountsData.accounts[accountIndex].password = password;
                }
            }
        }
    }

    async createDefaultXAccounts() {
        this.accountsData = {
            onSystem: 0,
            amount: 3,
            accounts: [
                { username: '', password: '' },
                { username: '', password: '' },
                { username: '', password: '' }
            ]
        };
        
        // Salvar o arquivo padrão com a seção [AutoLogin]
        try {
            const content = this.generateXAccountsContent();
            await fs.writeFile(this.xAccountsPath, content, 'utf8');
            console.log('xAccounts.ini padrão criado com sucesso');
        } catch (error) {
            console.error('Erro ao criar xAccounts.ini padrão:', error);
        }
    }

    openModal() {
        const modal = document.getElementById('autoLoginModal');
        modal.classList.add('show');
        this.updateUI();
    }

    closeModal() {
        const modal = document.getElementById('autoLoginModal');
        modal.classList.remove('show');
    }

    updateAccountAmount(amount) {
        this.accountsData.amount = amount;
        
        // Ajustar array de contas
        while (this.accountsData.accounts.length < amount) {
            this.accountsData.accounts.push({ username: '', password: '' });
        }
        
        // Remover contas extras se necessário
        this.accountsData.accounts = this.accountsData.accounts.slice(0, amount);
        
        this.updateAccountGrid();
    }

    updateUI() {
        // Atualizar checkbox OnSystem
        document.getElementById('onSystemEnabled').checked = this.accountsData.onSystem === 1;
        
        // Atualizar select de quantidade
        document.getElementById('accountAmount').value = this.accountsData.amount;
        
        // Atualizar grid de contas
        this.updateAccountGrid();
    }

    updateAccountGrid() {
        const container = document.getElementById('accountsGrid');
        container.innerHTML = '';
        
        for (let i = 0; i < this.accountsData.amount; i++) {
            const account = this.accountsData.accounts[i] || { username: '', password: '' };
            const accountNumber = i + 1;
            
            const accountCard = document.createElement('div');
            accountCard.className = 'account-card';
            accountCard.setAttribute('data-account', accountNumber);
            
            accountCard.innerHTML = `
                <h4>Account ${accountNumber}</h4>
                <div class="input-field">
                    <input type="text" id="user${accountNumber}" placeholder="Username" value="${account.username || ''}">
                </div>
                <div class="input-field">
                    <input type="password" id="password${accountNumber}" placeholder="Password" value="${account.password || ''}">
                </div>
            `;
            
            container.appendChild(accountCard);
        }
    }

    collectFormData() {
        const formData = {
            onSystem: document.getElementById('onSystemEnabled').checked ? 1 : 0,
            amount: parseInt(document.getElementById('accountAmount').value),
            accounts: []
        };
        
        for (let i = 1; i <= formData.amount; i++) {
            const username = document.getElementById(`user${i}`).value;
            const password = document.getElementById(`password${i}`).value;
            
            formData.accounts.push({
                username: username,
                password: password
            });
        }
        
        return formData;
    }

    async saveXAccountsData() {
        try {
            const formData = this.collectFormData();
            
            // Atualizar dados internos
            this.accountsData = formData;
            
            // Gerar conteúdo do arquivo
            const content = this.generateXAccountsContent();
            
            // Salvar arquivo
            await fs.writeFile(this.xAccountsPath, content, 'utf8');
            
            console.log('xAccounts.ini salvo com sucesso');
            return { success: true };
            
        } catch (error) {
            console.error('Erro ao salvar xAccounts.ini:', error);
            return { success: false, error: error.message };
        }
    }

    generateXAccountsContent() {
        let content = '';
        
        // Adicionar seção [MultiLogin] no início
        content += `[MultiLogin]\n`;
        
        // Adicionar configurações principais
        content += `OnSystem = ${this.accountsData.onSystem}\n`;
        content += `Amount = ${this.accountsData.amount}\n\n`;
        
        // Adicionar dados das contas
        for (let i = 0; i < this.accountsData.accounts.length; i++) {
            const account = this.accountsData.accounts[i];
            const accountNumber = i + 1;
            
            content += `User${accountNumber} = "${account.username || ''}"\n`;
            content += `Password${accountNumber} = "${account.password || ''}"\n`;
            
            if (i < this.accountsData.accounts.length - 1) {
                content += '\n';
            }
        }
        
        return content;
    }

    async saveSettings() {
        const result = await this.saveXAccountsData();
        
        if (result.success) {
            this.showNotification('Auto Login configuration saved successfully', 'success');
            this.closeModal();
        } else {
            this.showNotification(`Failed to save Auto Login configuration: ${result.error}`, 'error');
        }
    }

    showNotification(message, type = 'info') {
        // Usar o sistema de notificação do launcher principal se disponível
        if (window.muDMG && window.muDMG.showNotification) {
            window.muDMG.showNotification(message, type);
        } else {
            // Fallback para notificação simples
            console.log(`${type.toUpperCase()}: ${message}`);
        }
    }
}

// Inicializar quando o DOM estiver pronto
document.addEventListener('DOMContentLoaded', () => {
    window.autoLoginManager = new AutoLoginManager();
});
