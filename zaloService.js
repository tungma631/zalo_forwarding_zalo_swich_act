const { Zalo, ThreadType } = require('zca-js');
const fs = require('fs');
const { imageSize } = require('image-size');
const EventEmitter = require('events');
const path = require('path');
const { sendPhotoWithExistingIds } = require('./forwarderUtils');
const { HttpsProxyAgent } = require('https-proxy-agent');
const fetch = require('node-fetch'); // Yêu cầu bản 2.x

class ZaloManager extends EventEmitter {
    constructor(userDataPath, proxyString, manager) {
        super();
        this.api = null;
        this.manager = manager;
        this.accountName = "Unknown";

        // Sử dụng đường dẫn từ AppData để có quyền ghi khi build .exe
        this.basePath = userDataPath;
        this.credentialsPath = path.join(this.basePath, 'credentials.json');
        this.cookiePath = path.join(this.basePath, 'cookies.json');
        this.qrPath = path.join(this.basePath, 'qr.png');
        this.groupsPath = path.join(this.basePath, 'groups.json');

        this.setProxy(proxyString);

        this.initZaloCore();

        this.masterQueue = {};
        this.groupNames = {};
        this.isRunning = false; // Đánh dấu tài khoản có quyền gửi/nhận hay không
        this.isStopping = false; // Graceful Shutdown Wait Flow
        this.globalQueue = [];
        this.isProcessingGlobalQueue = false;

        // Tải cấu hình (Được truyền từ AccountManager)
        this.config = { SOURCE_GROUP_NAMES: [], DESTINATION_GROUP_NAMES: [] };
    }

    setProxy(proxyString) {
        this.proxyString = proxyString;
        this.proxyAgent = undefined;
        if (this.proxyString) {
            try {
                let formattedProxy = this.proxyString.trim();
                // Tự động format nếu người dùng chỉ nhập kiểu ip:port:user:pass
                if (!/^https?:\/\//i.test(formattedProxy) && !/^socks\d?:\/\//i.test(formattedProxy)) {
                    const parts = formattedProxy.split(':');
                    if (parts.length === 4) {
                        // Chuẩn: ip:port:user:pass
                        formattedProxy = `http://${parts[2]}:${parts[3]}@${parts[0]}:${parts[1]}`;
                    } else if (parts.length === 2) {
                        // Chuẩn: ip:port
                        formattedProxy = `http://${parts[0]}:${parts[1]}`;
                    } else {
                        formattedProxy = `http://${formattedProxy}`;
                    }
                }
                this.proxyAgent = new HttpsProxyAgent(formattedProxy);
            } catch (error) {
                this.log(`=> ⚠️ Lỗi khởi tạo Proxy: Dữ liệu không hợp lệ. Vui lòng nhập đúng định dạng (VD: http://user:pass@ip:port)!`);
            }
        }
        if (this.zalo) {
            this.initZaloCore(); // Re-init on proxy change
        }
    }

    initZaloCore() {
        const options = {
            cookiePath: this.cookiePath,
            selfListen: true
        };
        // Hỗ trợ truyền agent cho phiên bản zca-js (nếu thư viện bên trong dùng fetch/got hỗ trợ options.agent)
        if (this.proxyAgent) {
            options.agent = this.proxyAgent; 
        }
        this.zalo = new Zalo(options);
    }


    updateConfig(newConfig) {
        this.clearAllQueues(); // Đổ sạch bộ đệm trước khi áp dụng Cấu hình mới
        this.config = Object.assign({ SOURCE_GROUP_NAMES: [], DESTINATION_GROUP_NAMES: [], PRICE_ADJUSTMENTS: {} }, newConfig);
    }

    markAsStopping() {
        this.isStopping = true;
        this.isRunning = false; // Ngừng tiếp nhận tin mới
        // Vẫn cho phép processGlobalQueue xử lý nốt
        if (!this.isProcessingGlobalQueue && this.globalQueue.length === 0) {
            this.clearAllQueues(); // Đã sạch sẽ
        }
    }

    log(message) {
        console.log(message);
        this.emit('log', message);
    }

    async getGroups(forceRefresh = false) {
        if (forceRefresh) {
            if (fs.existsSync(this.groupsPath)) fs.unlinkSync(this.groupsPath);
            this.groupNames = {};
        }

        if (!forceRefresh && fs.existsSync(this.groupsPath)) {
            try {
                const cachedGroups = JSON.parse(fs.readFileSync(this.groupsPath, 'utf8'));
                if (cachedGroups.length > 0) {
                    cachedGroups.forEach(g => this.groupNames[g.id] = g.name);
                    return cachedGroups;
                }
            } catch (e) {
                this.log("=> Lỗi đọc cache nhóm, tiến hành tải mới...");
            }
        }

        if (!this.api) return [];

        try {
            const groupsResp = await this.api.getAllGroups();
            const result = [];
            if (groupsResp && groupsResp.gridVerMap) {
                const groupIds = Object.keys(groupsResp.gridVerMap);
                this.log(`=> Đang đồng bộ thông tin chi tiết ${groupIds.length} nhóm. Vui lòng đợi...`);
                for (let i = 0; i < groupIds.length; i += 50) {
                    const chunk = groupIds.slice(i, i + 50);
                    const infoResp = await this.api.getGroupInfo(chunk);
                    if (infoResp && infoResp.gridInfoMap) {
                        for (const [id, info] of Object.entries(infoResp.gridInfoMap)) {
                            const name = info.name || 'Không rõ';
                            this.groupNames[id] = name;
                            result.push({ id, name });
                        }
                    }
                    
                    if (i + 50 < groupIds.length) {
                        await new Promise(r => setTimeout(r, 1000));
                    }
                }
            }
            fs.writeFileSync(this.groupsPath, JSON.stringify(result, null, 2));
            this.log("=> Đồng bộ Nhóm thành công!");
            return result;
        } catch (err) {
            this.log(`=> Lỗi lấy danh sách nhóm: ${err.message}`);
            return [];
        }
    }

    async logout() {
        this.clearAllQueues();
        if (fs.existsSync(this.credentialsPath)) fs.unlinkSync(this.credentialsPath);
        if (fs.existsSync(this.cookiePath)) fs.unlinkSync(this.cookiePath);

        // Nuke on Logout: Mọi config local của acc đã bị nuke bởi folder ngoài
        if (fs.existsSync(this.groupsPath)) fs.unlinkSync(this.groupsPath);
        this.config = { SOURCE_GROUP_NAMES: [], DESTINATION_GROUP_NAMES: [] };
        this.groupNames = {};

        if (this.api && this.api.listener) {
            try { this.api.listener.stop(); } catch(e) {}
        }
        this.isListening = false;
        
        this.api = null;
        this.log("=> Đã đăng xuất và xóa phiên làm việc.");
        this.emit('logged_out');
    }

    async login(silent = false) {
        // 1. Thử đăng nhập bằng phiên cũ
        if (fs.existsSync(this.credentialsPath)) {
            try {
                if (!silent) this.log("Đang kiểm tra phiên đăng nhập cũ...");
                const creds = JSON.parse(fs.readFileSync(this.credentialsPath, 'utf8'));
                if (this.proxyAgent) creds.agent = this.proxyAgent; // Inject proxy vào luồng kết nối Zalo
                this.api = await this.zalo.login(creds);
                
                try {
                    const info = await this.api.fetchAccountInfo();
                    if (info && info.profile) {
                        this.accountName = info.profile.displayName || info.profile.zaloName;
                    }
                } catch(e) {}

                if (!silent) this.log(`=> Đăng nhập thành công! [${this.accountName}]`);
                this.emit('login_success', this.accountName);
                this.startListener();
                return true;
            } catch (error) {
                this.log("Phiên đăng nhập hết hạn. Đang chuẩn bị tạo mã QR mới...");
            }
        }

        // 2. Nếu không có phiên hoặc hết hạn -> Thông báo cho App.js hiện nút Tạo QR
        if (!silent) this.emit('qr_expired');
        return false;
    }

    // Tìm hàm generateNewQR trong zaloService.js và thay thế bằng đoạn này:
    async generateNewQR() {
        try {
            // Xóa file QR cũ nếu có
            if (fs.existsSync(this.qrPath)) fs.unlinkSync(this.qrPath);
            // Trong môi trường dev, zca-js có thể tạo file ở thư mục gốc, ta xóa luôn cho chắc
            const devQR = path.join(process.cwd(), 'qr.png');
            if (fs.existsSync(devQR)) fs.unlinkSync(devQR);

            let qrFound = false;
            let timeoutId;
            const qrCheckInterval = setInterval(() => {
                // Kiểm tra cả 2 nơi: AppData và thư mục gốc project (cho bản Dev)
                const targetPath = fs.existsSync(this.qrPath) ? this.qrPath : (fs.existsSync(devQR) ? devQR : null);

                if (targetPath && !qrFound) {
                    qrFound = true;
                    try {
                        // Đọc file và chuyển sang Base64
                        const imageBuffer = fs.readFileSync(targetPath);
                        const base64Image = `data:image/png;base64,${imageBuffer.toString('base64')}`;

                        this.emit('qr_ready', base64Image); // Gửi chuỗi Base64 thay vì path
                        this.log("=> Đã tìm thấy mã QR. Vui lòng quét!");
                        clearInterval(qrCheckInterval);
                        if (timeoutId) clearTimeout(timeoutId);
                    } catch (e) {
                        this.log("Lỗi xử lý ảnh QR: " + e.message);
                    }
                }
            }, 500);

            // Timeout an toàn: Nếu 2 phút chưa sinh được QR, giải phóng bộ nhớ.
            timeoutId = setTimeout(() => {
                clearInterval(qrCheckInterval);
            }, 120000);

            this.log("=> Đang yêu cầu mã QR từ Zalo...");
            const loginOptions = {};
            if (this.proxyAgent) loginOptions.agent = this.proxyAgent;
            this.api = await this.zalo.loginQR(loginOptions);

            clearInterval(qrCheckInterval);

            const ctx = this.api.getContext();
            const credentialsToSave = {
                imei: ctx.imei,
                cookie: ctx.cookie.toJSON ? ctx.cookie.toJSON().cookies : ctx.cookie,
                userAgent: ctx.userAgent,
                language: ctx.language
            };
            fs.writeFileSync(this.credentialsPath, JSON.stringify(credentialsToSave, null, 2));

            try {
                const info = await this.api.fetchAccountInfo();
                if (info && info.profile) {
                    this.accountName = info.profile.displayName || info.profile.zaloName;
                }
            } catch(e) {}

            this.emit('login_success', this.accountName);
            this.startListener();
            return true;

        } catch (err) {
            this.log("=> Mã QR đã hết hạn hoặc có lỗi. Vui lòng bấm tạo mã mới!");
            return false;
        }
    }

    startListener() {
        if (!this.api || !this.api.listener) return;
        
        // KHÓA VAN: Tránh Zalo Server kích "Another connection" khi bấm Start nhiều lần
        if (this.isListening) return;
        this.isListening = true;

        this.api.listener.on("message", (message) => {
            if (!this.isRunning) return; // Máy dừng thì tai điếc

            const threadId = message.threadId;

            const groupName = this.groupNames[threadId] || threadId;
            // DỰA VÀO NAME ĐỂ NHẬN DIỆN SOURCE, không dùng threadId ảo hoá
            if (this.config.SOURCE_GROUP_NAMES && this.config.SOURCE_GROUP_NAMES.includes(groupName)) {
                this.log(`\n>>> [Nhận tin] Nhóm nguồn: ${groupName} (Gửi bởi: ${message?.data?.dName || 'Ẩn danh'}) - Nhận tại tài khoản: [${this.accountName}]`);

                const content = message.data && message.data.content;
                const msgType = message.data && message.data.msgType;
                const timestamp = message.timestamp || (message.data && message.data.ts) || Date.now();

                if (!this.masterQueue[threadId]) {
                    this.masterQueue[threadId] = { timer: null, items: [], sessionStartTime: null };
                }

                let inserted = false;

                if (typeof content === "string") {
                    let adjustedContent = content;
                    const offset = this.config.PRICE_ADJUSTMENTS && this.config.PRICE_ADJUSTMENTS[groupName];
                    if (offset) {
                        adjustedContent = this.smartPriceAdjuster(content, offset);
                    }
                    this.masterQueue[threadId].items.push({ type: 'text', data: adjustedContent, timestamp });
                    inserted = true;
                }
                else if (msgType === "chat.photo") {
                    let imgUrl = content.href;
                    let photoId = null;
                    let hdSize = 0;
                    if (content.params) {
                        try {
                            const paramsObj = (typeof content.params === 'string') ? JSON.parse(content.params) : content.params;
                            if (paramsObj.hd) imgUrl = paramsObj.hd;
                            if (paramsObj.photoId) photoId = paramsObj.photoId;
                            if (paramsObj.hdSize) hdSize = paramsObj.hdSize;
                        } catch (e) { }
                    }
                    if (imgUrl && imgUrl.startsWith("http")) {
                        const fetchOptions = {};
                        if (this.proxyAgent) fetchOptions.agent = this.proxyAgent; // Kéo ảnh ẩn danh qua proxy

                        const promise = fetch(imgUrl, fetchOptions)
                            .then(async res => {
                                if (!res.ok) throw new Error(res.status);
                                const arrayBuffer = await res.arrayBuffer();
                                return Buffer.from(arrayBuffer);
                            })
                            .catch(err => {
                                this.log("=> Lỗi tải ảnh Nguồn: " + err.message);
                                return null;
                            });

                        this.masterQueue[threadId].items.push({
                            type: 'photo',
                            promise,
                            timestamp,
                            photoId: photoId,
                            normalUrl: content.href,
                            hdUrl: imgUrl,
                            thumbUrl: content.thumb || content.href,
                            hdSize: hdSize
                        });
                        inserted = true;
                    }
                }

                if (inserted) {
                    this.log(`=> Đã tiếp nhận tin nhắn. Chờ 240 giây tĩnh lặng...`);

                    // Nếu đây là tin nhắn bắt đầu một chuỗi mới
                    if (this.masterQueue[threadId].items.length === 1) {
                        this.masterQueue[threadId].sessionStartTime = Date.now();
                    }

                    if (this.masterQueue[threadId].timer) clearTimeout(this.masterQueue[threadId].timer);

                    const triggerFlush = () => {
                        const itemsToProcess = [...this.masterQueue[threadId].items];
                        this.masterQueue[threadId].items = [];
                        this.masterQueue[threadId].timer = null;
                        this.masterQueue[threadId].sessionStartTime = null;

                        if (itemsToProcess.length > 0) {
                            this.globalQueue.push({ sourceThreadId: threadId, items: itemsToProcess });
                            this.processGlobalQueue();
                        }
                    };

                    const isTextMsg = typeof content === "string";

                    // Tính thời lượng từ lúc tin đầu tiên của cụm đổ vào
                    const sessionStart = this.masterQueue[threadId].sessionStartTime || Date.now();
                    const elapsed = Date.now() - sessionStart;

                    // Nếu chuỗi gửi rải rác đã kéo dài trên 10 phút (600_000ms), TÌM ĐIỂM CẮT LÀ TIN VĂN BẢN ĐỂ ÉP XẢ HÀNG
                    if (elapsed >= 600000 && isTextMsg) {
                        this.log(`=> [Bảo vệ] Nhóm nguồn đã gửi rải rác quá 10 phút. Bắt buộc cắt đứt chốt Cụm tại tin nhắn Văn Bản này!`);
                        triggerFlush();
                    } else {
                        // Trạng thái bình thường: Chờ 4 phút yên tĩnh mới chốt
                        this.masterQueue[threadId].timer = setTimeout(() => {
                            triggerFlush();
                        }, 240000);
                    }
                }
            }
        });

        this.api.listener.on("connected", () => this.log("=> Hệ thống đã kết nối."));
        this.api.listener.on("error", (e) => this.log("=> Lỗi kết nối: " + e.message));
        this.api.listener.start({ retryOnClose: true });
    }

    async processGlobalQueue() {
        if (this.isProcessingGlobalQueue || this.globalQueue.length === 0) return;

        this.isProcessingGlobalQueue = true;

        while (this.globalQueue.length > 0) {
            const job = this.globalQueue.shift();
            const threadId = job.sourceThreadId;
            const itemsToProcess = job.items.sort((a, b) => a.timestamp - b.timestamp);

            let currentPhotos = [];
            let lastPhotoTimestamp = 0;

            const flushPhotos = async () => {
                if (currentPhotos.length === 0) return;

                this.log(`=> Đang xử lý ${currentPhotos.length} ảnh...`);

                const buffers = (await Promise.all(currentPhotos.map(p => p.promise))).filter(b => b !== null);
                if (buffers.length === 0) {
                    currentPhotos = [];
                    return;
                }

                const attachmentsArray = [];
                for (const buffer of buffers) {
                    try {
                        const dims = imageSize(buffer);
                        attachmentsArray.push({
                            data: buffer,
                            filename: `img_${Date.now()}_${Math.floor(Math.random() * 1000)}.jpg`,
                            metadata: { totalSize: buffer.length, width: dims.width || 1080, height: dims.height || 1080 }
                        });
                    } catch (e) { }
                }
                if (attachmentsArray.length === 0) {
                    currentPhotos = [];
                    return;
                }

                let reusedIds = [];
                try {
                    const firstDestId = Object.keys(this.groupNames).find(id => this.groupNames[id] === this.config.DESTINATION_GROUP_NAMES[0]) || Object.keys(this.groupNames).find(id => this.groupNames[id] === this.config.SOURCE_GROUP_NAMES[0]);
                    const CHUNK_SIZE = 4;
                    for (let c = 0; c < attachmentsArray.length; c += CHUNK_SIZE) {
                        const chunkArr = attachmentsArray.slice(c, c + CHUNK_SIZE);

                        const uploadResp = await this.api.uploadAttachment(chunkArr, firstDestId, ThreadType.Group);

                        if (uploadResp && uploadResp.length > 0) {
                            const ids = uploadResp.map(att => ({
                                fileType: 'image',
                                photoId: att.photoId || att.fileId,
                                normalUrl: att.normalUrl,
                                hdUrl: att.hdUrl || att.normalUrl,
                                thumbUrl: att.thumbUrl || att.normalUrl,
                                totalSize: att.totalSize || att.hdSize || 0,
                                width: att.width || 1080,
                                height: att.height || 1080
                            }));
                            reusedIds.push(...ids);
                        }

                        if (c + CHUNK_SIZE < attachmentsArray.length) {
                            await new Promise(r => setTimeout(r, 2000));
                        }
                    }
                    this.log(`=> Đã chuẩn bị xong ảnh.`);
                } catch (uploadErr) {
                    this.log(`=> Lỗi xử lý ảnh: ${uploadErr.message}`);
                }

                this.log(`=> Đang gửi ảnh tới các nhóm...`);
                for (const targetName of this.config.DESTINATION_GROUP_NAMES) {
                    const destId = Object.keys(this.groupNames).find(id => this.groupNames[id] === targetName);
                    if (!destId) continue;
                    try {
                        if (reusedIds.length > 0) {
                            await sendPhotoWithExistingIds(this.api, reusedIds, destId, "");
                            this.log(`=> Đã gửi ảnh tới nhóm [${targetName}]`);
                        } else {
                            await this.api.sendMessage({ msg: "", attachments: attachmentsArray }, destId, ThreadType.Group);
                            this.log(`=> Đã gửi ảnh tới nhóm [${targetName}]`);
                        }

                        await new Promise(r => setTimeout(r, 1500));
                    } catch (e) {
                        this.log(`=> Lỗi gửi ảnh tới nhóm [${targetName}]: ${e.message}`);
                    }
                }

                currentPhotos = [];
            };

            for (const item of itemsToProcess) {
                if (item.type === 'photo') {
                    if (currentPhotos.length > 0 && (item.timestamp - lastPhotoTimestamp > 5000)) {
                        await flushPhotos();
                    }
                    currentPhotos.push(item);
                    lastPhotoTimestamp = item.timestamp;
                } else if (item.type === 'text') {
                    await flushPhotos();
                    // Tùy chọn 2: Gửi lần lượt để an toàn
                    for (const targetName of this.config.DESTINATION_GROUP_NAMES) {
                        // Dò tìm Target ID thật sự dành riêng cho account này thông qua Name
                        const targetId = Object.keys(this.groupNames).find(id => this.groupNames[id] === targetName);
                        
                        if (!targetId) {
                            this.log(`=> ⚠️ Bỏ qua nhóm đích "${targetName}": Tài khoản [${this.accountName}] chưa tham gia nhóm này.`);
                            continue;
                        }

                        try {
                            await this.api.sendMessage(item.data, targetId, ThreadType.Group);
                            await new Promise(r => setTimeout(r, 1000));
                        } catch (ex) { this.log(`=> Lỗi gửi chữ nhóm [${targetName}]: ${ex.message}`) }
                    }
                    this.log(`=> Đã gửi văn bản thành công.`);
                }
            }
            await flushPhotos();
        }
        this.isProcessingGlobalQueue = false;
        
        // Nếu đang ở trạng thái Rút khỏi ca và đã xử lý xong hết hàng đợi -> Đóng hẳn
        if (this.isStopping && this.globalQueue.length === 0) {
            const hasPendingMaster = Object.values(this.masterQueue).some(mq => mq.items.length > 0);
            if (!hasPendingMaster) {
                this.log(`=> ✅ Luồng chờ đã xử lý dứt điểm. Dọn dẹp thành công để nhường lại ca.`);
                this.clearAllQueues();
            }
        }
    }

    toggleStatus(isEnabled) {
        this.isRunning = isEnabled;
        this.isStopping = false;
        if (!isEnabled) {
            this.clearAllQueues();
            this.log(`=> 🛑 [${this.accountName}] ĐÃ TẠM DỪNG GỬI TIN`);
        } else {
            this.log(`=> ▶️ [${this.accountName}] ĐÃ SẴN SÀNG LẮNG NGHE & GỬI`);
        }
        return this.isRunning;
    }

    clearAllQueues() {
        for (const threadId in this.masterQueue) {
            if (this.masterQueue[threadId].timer) {
                clearTimeout(this.masterQueue[threadId].timer);
            }
        }
        this.masterQueue = {};
        this.globalQueue = [];
        this.isProcessingGlobalQueue = false;
        this.log("=> [Hệ thống] Bộ nhớ Cache đã được giải phóng hoàn toàn.");
    }

    smartPriceAdjuster(text, offset) {
        if (!offset || isNaN(parseInt(offset))) return text;
        const adjustVal = parseInt(offset);

        // Regex tìm vùng có khả năng là số (hỗ trợ phân cách ngàn bằng chấm hoặc phẩy)
        // Hỗ trợ từ khóa cách số một khoảng (vd: Giá áo : 150k, Zá : 155k)
        return text.replace(/((?:giá|gia|zá|buôn|buon|bán|ban|sỉ|si|lẻ|le|chỉ|chi|hàng|hang|ctv)[^\d\n]{0,12})?([0-9]+(?:\.[0-9]{3})*(?:,[0-9]{3})?)(\s*(?:k|đ|vnd|vnđ|\/|-))?/gi, (match, prefix, numStr, suffix, offsetIdx, fullText) => {
            prefix = prefix || "";
            suffix = suffix || "";
            
            let isThousandFormat = numStr.includes('.') || numStr.includes(',');
            let rawNum = parseInt(numStr.replace(/[.,]/g, ''));
            
            // Bỏ qua nếu là mã số bắt đầu bằng số 0 (ví dụ: 00306, 098...)
            if (numStr.startsWith('0') && numStr !== '0') return match;
            
            // Lấy ngữ cảnh trước và sau để tránh đổi Mã Hàng (ví dụ: Mã 275)
            let preContext = fullText.substring(Math.max(0, offsetIdx - 15), offsetIdx).toLowerCase();
            let postContext = fullText.substring(offsetIdx + match.length, Math.min(fullText.length, offsetIdx + match.length + 15)).toLowerCase();
            
            let isPrice = false;
            
            if (prefix.trim().length > 0 && /giá|gia|zá|buôn|buon|bán|ban|sỉ|si|lẻ|le|ctv/.test(prefix.toLowerCase())) isPrice = true;
            if (suffix.toLowerCase().includes('k') || suffix.toLowerCase().includes('đ') || suffix.toLowerCase().includes('vnd') || suffix.toLowerCase().includes('/')) isPrice = true;
            if (/giá|gia|zá|buôn|buon|bán|ban|sỉ|si|lẻ|le|ctv/.test(preContext)) isPrice = true;
            
            // Xử lý logic số trơ trọi (VD: "275" hoặc "100.000")
            if (rawNum >= 50 && rawNum <= 9999) { 
                if (!/mã|size|kg|m|cm|sz|sp|chiếc/.test(preContext) && !/mã|size|kg|m|cm|sz|sp|chiếc/.test(postContext)) {
                    isPrice = true; 
                }
            }
            if (rawNum >= 50000 && rawNum <= 99999999) {
                if (!/mã|size|sz|sp|chiếc/.test(preContext)) {
                    isPrice = true;
                }
            }

            if (isPrice) {
                let newVal = rawNum;
                // Nếu số > 50000 (VND), offset là +10k thì phải cộng 10000
                if (rawNum >= 50000) {
                    newVal = rawNum + (adjustVal * 1000);
                } else {
                    newVal = rawNum + adjustVal;
                }
                
                // Tránh giá bị âm (nếu trừ lố)
                if (newVal < 0) newVal = 0;
                
                let newValStr = newVal.toString();
                if (isThousandFormat && newVal >= 1000) {
                    newValStr = newVal.toLocaleString('vi-VN');
                }
                return `${prefix}${newValStr}${suffix}`;
            }
            
            return match;
        });
    }
}

module.exports = ZaloManager;