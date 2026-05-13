const fs = require('fs');
const path = require('path');
const ZaloManager = require('./zaloService');
const { HttpsProxyAgent } = require('https-proxy-agent');
const EventEmitter = require('events');

class AccountManager extends EventEmitter {
    constructor(userDataPath) {
        super();
        this.userDataPath = userDataPath;
        this.accountsPath = path.join(this.userDataPath, 'accounts');
        this.globalConfigPath = path.join(this.userDataPath, 'global_config.json');

        if (!fs.existsSync(this.accountsPath)) {
            fs.mkdirSync(this.accountsPath, { recursive: true });
        }

        // Tải Global Config
        this.globalConfig = { SOURCE_GROUP_NAMES: [], DESTINATION_GROUP_NAMES: [], PRICE_ADJUSTMENTS: {} };
        if (fs.existsSync(this.globalConfigPath)) {
            try {
                this.globalConfig = JSON.parse(fs.readFileSync(this.globalConfigPath, 'utf8'));
                if (!this.globalConfig.PRICE_ADJUSTMENTS) {
                    this.globalConfig.PRICE_ADJUSTMENTS = {};
                }
                // Migrate config nếu đang dùng chuẩn cũ
                if (this.globalConfig.SOURCE_GROUP_IDS) {
                    this.globalConfig.SOURCE_GROUP_NAMES = this.globalConfig.SOURCE_GROUP_IDS;
                    delete this.globalConfig.SOURCE_GROUP_IDS;
                }
                if (this.globalConfig.DESTINATION_GROUP_IDS) {
                    this.globalConfig.DESTINATION_GROUP_NAMES = this.globalConfig.DESTINATION_GROUP_IDS;
                    delete this.globalConfig.DESTINATION_GROUP_IDS;
                }
            } catch (e) {}
        }

        this.accounts = {}; // id -> { zaloManager, status, proxy }
        this.activeAccountId = null;
        this.rotationTimer = null;
        this.prewarmTimer = null;

        // Cơ chế timer
        this.CYCLE_DURATION = 3 * 60 * 60 * 1000; // 3 tiếng
        this.PREWARM_DURATION = 5 * 60 * 1000;    // 5 phút
        this.isRunningSystem = false;

        this.loadAccounts();
    }

    loadAccounts() {
        const dirs = fs.readdirSync(this.accountsPath);
        for (const dir of dirs) {
            const accDir = path.join(this.accountsPath, dir);
            if (fs.statSync(accDir).isDirectory()) {
                this.addAccountInstance(dir);
            }
        }
    }

    addAccountInstance(accountId) {
        if (this.accounts[accountId]) return;
        const accDir = path.join(this.accountsPath, accountId);
        if (!fs.existsSync(accDir)) fs.mkdirSync(accDir, { recursive: true });

        // Đọc proxy nếu có
        const proxyPath = path.join(accDir, 'proxy.json');
        let proxy = null;
        if (fs.existsSync(proxyPath)) {
            try {
                proxy = JSON.parse(fs.readFileSync(proxyPath, 'utf8')).proxyString;
            } catch (e) {}
        }

        const zm = new ZaloManager(accDir, proxy, this);
        const hasCredentials = fs.existsSync(path.join(accDir, 'credentials.json'));
        
        this.accounts[accountId] = { 
            id: accountId, 
            name: accountId,
            zaloManager: zm, 
            status: 'idle', // idle, active, prewarming, stopping
            proxy: proxy,
            hasCredentials: hasCredentials
        };

        // Forward events
        zm.on('log', (msg) => this.emit('log', `[${accountId}] ${msg}`));
        zm.on('qr_ready', (qr) => this.emit('qr_ready', { accountId, qr }));
        zm.on('login_success', (accountName) => {
            this.accounts[accountId].hasCredentials = true;
            if (accountName && accountName !== "Unknown") {
                this.accounts[accountId].name = accountName;
            }
            this.emit('login_success', accountId);
            this.broadcastUpdate();
        });
        zm.on('logged_out', () => {
            this.accounts[accountId].hasCredentials = false;
            this.emit('logged_out', accountId);
            this.broadcastUpdate();
        });
        zm.on('qr_expired', () => this.emit('qr_expired', accountId));

        return accountId;
    }

    broadcastUpdate() {
        this.emit('update_accounts', this.getAccountList());
    }

    getAccountList() {
        return Object.values(this.accounts).map(acc => ({
            id: acc.id,
            name: acc.name,
            status: acc.status,
            hasCredentials: acc.hasCredentials,
            proxy: acc.proxy
        }));
    }

    async saveGlobalConfig(sourceNames, destNames, priceAdjustments) {
        this.globalConfig.SOURCE_GROUP_NAMES = sourceNames || [];
        this.globalConfig.DESTINATION_GROUP_NAMES = destNames || [];
        this.globalConfig.PRICE_ADJUSTMENTS = priceAdjustments || {};
        fs.writeFileSync(this.globalConfigPath, JSON.stringify(this.globalConfig, null, 2));
        
        // Cập nhật config cho tất cả các instance đang chạy
        for (const id in this.accounts) {
             this.accounts[id].zaloManager.updateConfig(this.globalConfig);
        }
    }

    async createAccount() {
        // Gen unique ID
        const id = `acc_${Date.now()}`;
        this.addAccountInstance(id);
        this.broadcastUpdate();
        return id;
    }

    async deleteAccount(accountId) {
        if (!this.accounts[accountId]) return;
        
        const acc = this.accounts[accountId];
        if (acc.status === 'active' || acc.status === 'prewarming' || acc.status === 'stopping') {
            await acc.zaloManager.logout();
        }

        const accDir = path.join(this.accountsPath, accountId);
        if (fs.existsSync(accDir)) {
            fs.rmSync(accDir, { recursive: true, force: true });
        }

        delete this.accounts[accountId];
        if (this.activeAccountId === accountId) {
            this.activeAccountId = null;
            if (this.isRunningSystem) this.rotateNext();
        }

        this.broadcastUpdate();
    }

    async loginAccount(accountId) {
        if (!this.accounts[accountId]) return false;
        return await this.accounts[accountId].zaloManager.login();
    }

    async logoutAccount(accountId) {
        if (!this.accounts[accountId]) return;
        await this.accounts[accountId].zaloManager.logout();
        await this.deleteAccount(accountId);
    }

    async generateQR(accountId) {
        if (!this.accounts[accountId]) return false;
        return await this.accounts[accountId].zaloManager.generateNewQR();
    }

    saveProxy(accountId, proxyString) {
        if (!this.accounts[accountId]) return;
        const accDir = path.join(this.accountsPath, accountId);
        fs.writeFileSync(path.join(accDir, 'proxy.json'), JSON.stringify({ proxyString }));
        this.accounts[accountId].proxy = proxyString;
        this.accounts[accountId].zaloManager.setProxy(proxyString);
        this.broadcastUpdate();
    }

    // Cơ chế Xoay vòng
    toggleSystemStatus(isEnabled) {
        this.isRunningSystem = isEnabled;
        if (!isEnabled) {
            this.clearTimers();
            if (this.activeAccountId && this.accounts[this.activeAccountId]) {
                const acc = this.accounts[this.activeAccountId];
                acc.status = 'idle';
                acc.zaloManager.toggleStatus(false);
            }
            this.activeAccountId = null;
            this.emit('log', `[Hệ thống] 🛑 ĐÃ TẠM DỪNG TOÀN BỘ`);
            this.broadcastUpdate();
        } else {
            this.emit('log', `[Hệ thống] ▶️ KHỞI ĐỘNG CƠ CHẾ XOAY VÒNG`);
            this.rotateNext();
        }
        return this.isRunningSystem;
    }

    clearTimers() {
        if (this.rotationTimer) clearTimeout(this.rotationTimer);
        if (this.prewarmTimer) clearTimeout(this.prewarmTimer);
    }

    async rotateNext(targetAccountId = null) {
        this.clearTimers();
        if (!this.isRunningSystem) return;

        const availableAccounts = Object.keys(this.accounts).filter(id => fs.existsSync(path.join(this.accountsPath, id, 'credentials.json')));
        
        if (availableAccounts.length === 0) {
            this.emit('log', `[Hệ thống] ⚠️ Không có tài khoản nào được đăng nhập! Hãy đăng nhập trước khi bật.`);
            this.toggleSystemStatus(false);
            return;
        }

        // Xử lý rút khỏi ca cho account cũ (Wait Flow)
        if (this.activeAccountId && this.accounts[this.activeAccountId]) {
            const oldAcc = this.accounts[this.activeAccountId];
            oldAcc.status = 'stopping'; // Chờ xả cache
            this.emit('log', `[${oldAcc.id}] 🔄 Đang vào luồng chờ xả cache để kết thúc ca...`);
            oldAcc.zaloManager.markAsStopping(); // Ngừng lắng nghe tin mới, ráng gửi hết hàng đợi
        }

        // Chọn account tiếp theo
        let nextIndex = 0;
        if (this.activeAccountId) {
            const currentIndex = availableAccounts.indexOf(this.activeAccountId);
            nextIndex = (currentIndex + 1) % availableAccounts.length;
        }
        
        const nextId = targetAccountId || availableAccounts[nextIndex];
        this.activeAccountId = nextId;
        const newAcc = this.accounts[this.activeAccountId];
        
        this.emit('log', `[${newAcc.id}] ✨ ĐÃ TIẾP QUẢN CA LÀM VIỆC MỚI.`);
        newAcc.status = 'active';
        newAcc.zaloManager.updateConfig(this.globalConfig);
        await newAcc.zaloManager.login(); // Kích hoạt / kết nối
        newAcc.zaloManager.toggleStatus(true); // Bắt đầu lắng nghe và gửi

        this.emit('update_accounts', this.getAccountList());

        // Hẹn giờ Pre-warm
        this.prewarmTimer = setTimeout(() => {
            this.prewarmNextAccount();
        }, this.CYCLE_DURATION - this.PREWARM_DURATION);

        // Hẹn giờ xoay vòng ca
        this.rotationTimer = setTimeout(() => {
            this.rotateNext();
        }, this.CYCLE_DURATION);
    }

    async prewarmNextAccount() {
        if (!this.isRunningSystem) return;
        const availableAccounts = Object.keys(this.accounts).filter(id => fs.existsSync(path.join(this.accountsPath, id, 'credentials.json')));
        if (availableAccounts.length <= 1) return; // Không cần prewarm nếu chỉ có 1 acc

        const currentIndex = availableAccounts.indexOf(this.activeAccountId);
        const nextIndex = (currentIndex + 1) % availableAccounts.length;
        const nextId = availableAccounts[nextIndex];
        
        const nextAcc = this.accounts[nextId];
        nextAcc.status = 'prewarming';
        this.emit('log', `[Hệ thống] 🔥 Đang sưởi ấm (Pre-warm) account [${nextId}] chuẩn bị cho ca tiếp theo...`);
        this.emit('update_accounts', this.getAccountList());

        // Thử kết nối ngầm để kiểm tra proxy / cookie
        try {
            await nextAcc.zaloManager.login(true); // true = silent login / prewarm
            this.emit('log', `[${nextId}] ✅ Pre-warm thành công, tài khoản đã sẵn sàng.`);
        } catch (e) {
            this.emit('log', `[${nextId}] ❌ Luồng Pre-warm thất bại: ${e.message}`);
        }
    }

    async getIntersectedGroups(forceRefresh = false) {
        let validAccounts = Object.values(this.accounts).filter(a => a.hasCredentials);
        if (validAccounts.length === 0) return [];

        // Đảm bảo là tất cả các account (có credentials) đã thực sự chọc API để load danh sách
        for (const acc of validAccounts) {
            if (forceRefresh && !acc.zaloManager.api) {
                this.emit('log', `[Hệ thống] Đang truy cập ngầm [${acc.name}] để đồng bộ dữ liệu nhóm...`);
                try {
                    await acc.zaloManager.login(true);
                } catch(e) {}
            }
        }

        let commonGroups = null;
        for (const acc of validAccounts) {
            const groups = await acc.zaloManager.getGroups(forceRefresh);
            
            this.emit('log', `[Hệ thống] Tài khoản [${acc.name}] vừa tải xong ${groups ? groups.length : 0} Nhóm.`);
            
            // Bỏ qua lọc nếu list rỗng để tránh 1 acc làm rỗng nguyên grid. Ở bản thực tế, nên cảnh báo.
            if (!groups || groups.length === 0) {
                this.emit('log', `[Hệ thống] Cảnh báo: Tài khoản [${acc.name}] trả về 0 Nhóm. Bỏ qua trong vòng lặp lọc giao thoa.`);
                continue;
            }

            if (commonGroups === null) {
                const uniqueNames = new Map();
                groups.forEach(g => uniqueNames.set(g.name, { id: g.name, name: g.name }));
                commonGroups = Array.from(uniqueNames.values());
                this.emit('log', `[Hệ thống] Khởi tạo giao thoa với ${commonGroups.length} Nhóm từ tài khoản gốc.`);
            } else {
                const groupNames = new Set(groups.map(g => g.name));
                commonGroups = commonGroups.filter(g => groupNames.has(g.name));
                this.emit('log', `[Hệ thống] Xén phần chênh lệch bằng tài khoản [${acc.name}]. Kết quả Giao thoa hiện tại: ${commonGroups.length} Nhóm.`);
            }
        }
        
        const finalGroups = commonGroups || [];
        this.emit('log', `[Hệ thống] QUYẾT TOÁN: Bắn ra Giao diện Lọc Đồng Bộ gồm ${finalGroups.length} Nhóm trùng khớp hoàn toàn.`);
        return finalGroups;
    }
}

module.exports = AccountManager;
