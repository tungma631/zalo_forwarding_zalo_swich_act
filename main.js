const { app, BrowserWindow, ipcMain, Menu, dialog } = require('electron');
const path = require('path');
const AccountManager = require('./accountManager');

let mainWindow;
let accountManager;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        title: "Zalo Forwarding Tool Pro",
        icon: path.join(__dirname, 'assets', 'icon.ico'), // Nếu bạn có icon
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true
        }
    });

    mainWindow.loadFile(path.join(__dirname, 'frontend', 'index.html'));

    // Mở DevTools nếu cần debug khi build (tùy chọn)
    // mainWindow.webContents.openDevTools();
}

app.whenReady().then(() => {
    // 1. Lấy đường dẫn thư mục lưu trữ dữ liệu người dùng (Sửa lỗi treo khi build .exe)
    const userDataPath = app.getPath('userData'); 
    
    // 2. Khởi tạo AccountManager với đường dẫn mới
    accountManager = new AccountManager(userDataPath);

    // Custom Menu
    const template = [
        {
            label: 'Hệ thống',
            submenu: [
                { role: 'reload', label: 'Tải lại giao diện' },
                { type: 'separator' },
                { role: 'quit', label: 'Thoát ứng dụng' }
            ]
        },
        {
            label: 'Trợ giúp',
            click: () => {
                dialog.showMessageBox(mainWindow, {
                    title: 'Thông tin hỗ trợ',
                    type: 'info',
                    message: 'Zalo: 0928822756 (Tùng)\nPhiên bản: 1.0.0 Pro'
                });
            }
        }
    ];
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));

    createWindow();

    // --- Lắng nghe các sự kiện từ System ---

    accountManager.on('log', (message) => {
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('zalo-log', message);
    });

    accountManager.on('qr_ready', (data) => {
        // data: { accountId, qr }
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('zalo-qr', data);
    });

    accountManager.on('login_success', (accountId) => {
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('zalo-login-success', accountId);
    });

    accountManager.on('logged_out', (accountId) => {
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('zalo-logged-out', accountId);
    });

    accountManager.on('qr_expired', (accountId) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('zalo-log', `⚠️ [${accountId}] Mã QR đã hết hạn. Vui lòng bấm Lấy mã mới.`);
            mainWindow.webContents.send('zalo-qr-failed', accountId);
        }
    });

    accountManager.on('update_accounts', (accountList) => {
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('zalo-update-accounts', accountList);
    });

    // --- Handle IPC calls từ Frontend ---

    ipcMain.handle('zalo-get-accounts', () => {
        return accountManager.getAccountList();
    });

    ipcMain.handle('zalo-create-account', async () => {
        return await accountManager.createAccount();
    });

    ipcMain.handle('zalo-delete-account', async (event, accountId) => {
        await accountManager.deleteAccount(accountId);
        return true;
    });

    ipcMain.handle('zalo-save-proxy', (event, accountId, proxyString) => {
        accountManager.saveProxy(accountId, proxyString);
        return true;
    });

    ipcMain.handle('zalo-login', async (event, accountId) => {
        try {
            return await accountManager.loginAccount(accountId);
        } catch (error) {
            console.error("Lỗi Login IPC:", error);
            return false;
        }
    });

    ipcMain.handle('zalo-logout', async (event, accountId) => {
        await accountManager.logoutAccount(accountId);
        return true;
    });

    ipcMain.handle('zalo-generate-qr', async (event, accountId) => {
        return await accountManager.generateQR(accountId);
    });

    // Các hàm Global
    ipcMain.handle('zalo-get-config', () => {
        return accountManager.globalConfig;
    });

    ipcMain.handle('zalo-save-config', async (event, sourceIds, destIds) => {
        await accountManager.saveGlobalConfig(sourceIds, destIds);
    });

    ipcMain.handle('zalo-toggle-status', (event, isEnabled) => {
        return accountManager.toggleSystemStatus(isEnabled);
    });

    ipcMain.handle('zalo-get-groups', async (event, force) => {
        return await accountManager.getIntersectedGroups(force);
    });

    app.on('before-quit', () => {
        if (accountManager) {
            for (const key in accountManager.accounts) {
                accountManager.accounts[key].zaloManager.clearAllQueues();
            }
            console.log("Đã dọn dẹp RAM trước khi thoát ứng dụng.");
        }
    });

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});