const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('zaloAPI', {
    // Accounts & Proxy
    getAccounts: () => ipcRenderer.invoke('zalo-get-accounts'),
    createAccount: () => ipcRenderer.invoke('zalo-create-account'),
    deleteAccount: (accountId) => ipcRenderer.invoke('zalo-delete-account', accountId),
    saveProxy: (accountId, proxyString) => ipcRenderer.invoke('zalo-save-proxy', accountId, proxyString),

    // Actions
    login: (accountId) => ipcRenderer.invoke('zalo-login', accountId),
    logout: (accountId) => ipcRenderer.invoke('zalo-logout', accountId),
    getGroups: (force) => ipcRenderer.invoke('zalo-get-groups', force),
    generateQR: (accountId) => ipcRenderer.invoke('zalo-generate-qr', accountId),
    getConfig: () => ipcRenderer.invoke('zalo-get-config'),
    saveConfig: (sourceIds, destIds, priceAdjustments) => ipcRenderer.invoke('zalo-save-config', sourceIds, destIds, priceAdjustments),
    toggleStatus: (isEnabled) => ipcRenderer.invoke('zalo-toggle-status', isEnabled),

    // Listeners
    onLog: (callback) => ipcRenderer.on('zalo-log', (event, msg) => callback(msg)),
    onQR: (callback) => ipcRenderer.on('zalo-qr', (event, data) => callback(data)),
    onQRFailed: (callback) => ipcRenderer.on('zalo-qr-failed', (event, accountId) => callback(accountId)),
    onLoginSuccess: (callback) => ipcRenderer.on('zalo-login-success', (event, accountId) => callback(accountId)),
    onLoggedOut: (callback) => ipcRenderer.on('zalo-logged-out', (event, accountId) => callback(accountId)),
    onUpdateAccounts: (callback) => ipcRenderer.on('zalo-update-accounts', (event, accounts) => callback(accounts))
});

