const ui = {
    mainView: document.getElementById('main-view'),
    
    // Account Manager
    accountList: document.getElementById('account-grid'),
    btnAddAccount: document.getElementById('btn-add-account'),

    // Modal QR
    qrModal: document.getElementById('qr-modal'),
    btnCloseModal: document.getElementById('btn-close-modal'),
    qrImg: document.getElementById('qr-img'),
    loginStatus: document.getElementById('login-status'),
    loginLoader: document.getElementById('login-loader'),
    btnGenerateQR: document.getElementById('btn-generate-qr'),
    
    // Top Bar
    btnToggleStatus: document.getElementById('btn-toggle-status'),
    topStatusIndicator: document.getElementById('top-status-indicator'),
    
    // Config Panel
    btnSave: document.getElementById('btn-save'),
    btnSyncGroups: document.getElementById('btn-sync-groups'),
    saveStatus: document.getElementById('save-status'),
    unsavedWarning: document.getElementById('unsaved-warning'),
    
    sourceList: document.getElementById('source-list'),
    destList: document.getElementById('dest-list'),
    sourceCount: document.getElementById('source-count'),
    destCount: document.getElementById('dest-count'),
    searchSource: document.getElementById('search-source'),
    searchDest: document.getElementById('search-dest'),

    btnSelectAllSource: document.getElementById('btn-select-all-source'),
    btnUnselectAllSource: document.getElementById('btn-unselect-all-source'),
    btnSelectAllDest: document.getElementById('btn-select-all-dest'),
    btnUnselectAllDest: document.getElementById('btn-unselect-all-dest'),
    
    logWindow: document.getElementById('log-window'),
    btnClearLog: document.getElementById('btn-clear-log'),
    
    // Tabs
    tabBtns: document.querySelectorAll('.tab-btn'),
    tabContents: document.querySelectorAll('.tab-content')
};

let allGroups = [];
let sourceSelection = new Set();
let destSelection = new Set();
let priceAdjustments = {};
let currentQRAccountId = null; // Account ID đang chờ QR

// --- TABS LOGIC ---
ui.tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        // Remove active class from all buttons and contents
        ui.tabBtns.forEach(b => b.classList.remove('active'));
        ui.tabContents.forEach(c => c.classList.remove('active'));
        
        // Add active class to clicked button and target content
        btn.classList.add('active');
        const targetId = btn.getAttribute('data-tab');
        document.getElementById(targetId).classList.add('active');
    });
});

function showErrorToast(msg) {
    const toast = document.createElement('div');
    toast.style.position = 'fixed';
    toast.style.top = '30px';
    toast.style.left = '50%';
    toast.style.transform = 'translate(-50%, 0)';
    toast.style.background = 'var(--danger)';
    toast.style.color = 'white';
    toast.style.padding = '12px 24px';
    toast.style.borderRadius = '8px';
    toast.style.zIndex = '99999';
    toast.style.boxShadow = '0 8px 24px rgba(239, 68, 68, 0.4)';
    toast.style.fontWeight = 'bold';
    toast.style.transition = '0.3s';
    toast.innerText = msg;

    document.body.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translate(-50%, -20px)';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// --- LOGGING ---
function appendLog(data) {
    const div = document.createElement('div');
    const time = new Date().toLocaleTimeString('vi-VN');
    div.innerHTML = `<span class="time">[${time}]</span> ${data}`;
    ui.logWindow.appendChild(div);
    
    // Max 300 logs items
    while (ui.logWindow.children.length > 300) {
        ui.logWindow.removeChild(ui.logWindow.firstChild);
    }
    
    ui.logWindow.scrollTop = ui.logWindow.scrollHeight;
}

ui.btnClearLog.addEventListener('click', () => {
    ui.logWindow.innerHTML = '';
});

window.zaloAPI.onLog((msg) => {
    appendLog(msg);
});

// --- ACCOUNT MANAGER ---
function renderAccounts(accounts) {
    ui.accountList.innerHTML = '';
    
    if (accounts.length === 0) {
        ui.accountList.innerHTML = '<div style="padding: 15px; text-align:center; color: #6b7280; font-size: 13px;">Chưa có tài khoản nào. Bấm [+] để thêm.</div>';
        return;
    }

    accounts.forEach(acc => {
        const item = document.createElement('div');
        item.className = 'account-card';

        // Trạng thái icon
        let statusText = "Mất phiên / Offline";
        let statusColorClass = "";
        if (acc.hasCredentials) {
            statusText = "IDLE";
            if (acc.status === 'active') { statusText = "ACTIVE"; statusColorClass = "active"; }
            else if (acc.status === 'prewarming') { statusText = "PRE-WARM"; statusColorClass = "prewarming"; }
            else if (acc.status === 'stopping') { statusText = "STOPPING"; statusColorClass = "stopping"; }
        }

        // Action Buttons
        let mainActionHtml = '';
        if (acc.hasCredentials) {
            mainActionHtml = `<button class="btn outline btn-logout-acc" data-id="${acc.id}" style="color:var(--danger); border-color:var(--danger)">🚪 Đăng xuất</button>`;
        } else {
            mainActionHtml = `<button class="btn success btn-login-acc" data-id="${acc.id}">📍 Quét QR Đăng nhập</button>`;
        }

        const displayName = acc.name.startsWith('acc_') ? "Slot: " + acc.id.split('_')[1] : acc.name;
        const initial = displayName.charAt(0).toUpperCase();

        item.innerHTML = `
            <div class="acc-header">
                <div class="acc-info">
                    <div class="acc-avatar">${initial}</div>
                    <div>
                        <div class="acc-name">${displayName}</div>
                        <div class="acc-slot">${acc.id}</div>
                    </div>
                </div>
                <div class="acc-status-badge ${statusColorClass}">
                    <div class="status-dot"></div>
                    ${statusText}
                </div>
            </div>
            
            <div style="font-size: 13px; color: var(--text-secondary); margin-top: 5px;">Proxy:</div>
            <div class="proxy-box">
                <input type="text" placeholder="HTTP/SOCKS (VD: http://ip:port)" value="${acc.proxy || ''}" class="proxy-input inp-proxy" data-id="${acc.id}">
                <button class="btn primary btn-save-proxy" data-id="${acc.id}">Lưu</button>
            </div>
            
            <div class="acc-actions">
                ${mainActionHtml}
                <button class="btn danger btn-delete-acc" data-id="${acc.id}" title="Xoá Account">🗑️ Xoá Khe</button>
            </div>
        `;

        ui.accountList.appendChild(item);
    });

    // Bắt sự kiện
    document.querySelectorAll('.btn-delete-acc').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const id = e.target.getAttribute('data-id');
            if(confirm("Xoá sạch dữ liệu tài khoản này?")) {
                await window.zaloAPI.deleteAccount(id);
            }
        });
    });

    document.querySelectorAll('.btn-logout-acc').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const id = e.target.getAttribute('data-id');
            if(confirm("Đăng xuất và xoá dữ liệu cookies tài khoản này?")) {
                await window.zaloAPI.logout(id);
            }
        });
    });

    document.querySelectorAll('.btn-save-proxy').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const id = e.target.getAttribute('data-id');
            const inp = document.querySelector(`.inp-proxy[data-id="${id}"]`);
            await window.zaloAPI.saveProxy(id, inp.value.trim());
            alert("Đã lưu Proxy!");
        });
    });

    document.querySelectorAll('.btn-login-acc').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const id = e.target.getAttribute('data-id');
            openQRModal(id);
        });
    });
}

window.zaloAPI.onUpdateAccounts(accounts => renderAccounts(accounts));

ui.btnAddAccount.addEventListener('click', async () => {
    const newId = await window.zaloAPI.createAccount();
    appendLog(`Đã khởi tạo slot tài khoản mới: ${newId}`);
    // Tự động mở QR luôn?
    // Mặc định thì createAccount sẽ gen ra slot, user cần tự bấm QUÉT QR
});

// --- AUTHENTICATION (Modal) ---
function openQRModal(accountId) {
    currentQRAccountId = accountId;
    ui.qrModal.style.display = 'flex';
    ui.qrImg.style.display = 'none';
    ui.loginLoader.style.display = 'none';
    ui.btnGenerateQR.style.display = 'block';
    ui.loginStatus.innerText = "Nhấn Lấy Mã QR để bắt đầu lấy mã từ máy chủ Zalo.";
}

ui.btnCloseModal.addEventListener('click', () => {
    ui.qrModal.style.display = 'none';
    currentQRAccountId = null;
});

ui.btnGenerateQR.addEventListener('click', async () => {
    if (!currentQRAccountId) return;
    ui.btnGenerateQR.style.display = 'none';
    ui.loginLoader.style.display = 'block';
    ui.loginStatus.innerText = "Đang yêu cầu mã QR từ Zalo. Vui lòng đợi trong giây lát...";
    await window.zaloAPI.generateQR(currentQRAccountId);
});

window.zaloAPI.onQR((data) => {
    if (data.accountId !== currentQRAccountId) return; // Ignore if it's for another account
    ui.loginLoader.style.display = 'none';
    ui.qrImg.style.display = 'block';
    ui.qrImg.src = data.qr; 
    ui.loginStatus.innerText = "Vui lòng quét mã QR để bắt đầu!";
});

window.zaloAPI.onQRFailed((accountId) => {
    if (accountId !== currentQRAccountId) return;
    ui.loginLoader.style.display = 'none';
    ui.qrImg.style.display = 'none';
    ui.btnGenerateQR.style.display = 'block';
    ui.loginStatus.innerText = "Mã QR gặp lỗi hoặc hết hạn. Vui lòng bấm Lấy lại mã.";
});

window.zaloAPI.onLoginSuccess((accountId) => {
    if (accountId === currentQRAccountId) {
        ui.qrModal.style.display = 'none';
        currentQRAccountId = null;
        showErrorToast(`Đăng nhập thành công!`);
    }
});

window.zaloAPI.onLoggedOut((accountId) => {
    showErrorToast(`Account [${accountId}] đã đăng xuất.`);
});


// --- INIT SYSTEM ---
async function loadGroups(force = false) {
    if (force) {
        sourceSelection.clear();
        destSelection.clear();
        ui.sourceList.innerHTML = '<div style="padding:15px; color:#6b7280; font-size:13px; text-align:center;">Đang lấy dữ liệu...</div>';
        ui.destList.innerHTML = '<div style="padding:15px; color:#6b7280; font-size:13px; text-align:center;">Đang lấy dữ liệu...</div>';
    }

    const config = await window.zaloAPI.getConfig();
    if (config.SOURCE_GROUP_NAMES) config.SOURCE_GROUP_NAMES.forEach(name => sourceSelection.add(name));
    if (config.DESTINATION_GROUP_NAMES) config.DESTINATION_GROUP_NAMES.forEach(name => destSelection.add(name));
    if (config.PRICE_ADJUSTMENTS) priceAdjustments = config.PRICE_ADJUSTMENTS;
    
    // Yêu cầu getGroups kèm cờ force (để trả về list name)
    allGroups = await window.zaloAPI.getGroups(force);
    
    renderList(allGroups, sourceSelection, ui.sourceList, ui.sourceCount, 'source');
    renderList(allGroups, destSelection, ui.destList, ui.destCount, 'dest');
}

async function bootSystem() {
    const accounts = await window.zaloAPI.getAccounts();
    renderAccounts(accounts);
    
    // Thử fetch initial account to init group list
    // Không force fetch để lấy cache
    await loadGroups(false);

    let isRunning = false;
    
    ui.btnToggleStatus.addEventListener('click', async () => {
        isRunning = !isRunning;
        await window.zaloAPI.toggleStatus(isRunning);
        updateStatusBtn(isRunning);
    });
}

function updateStatusBtn(isRunning) {
    if (isRunning) {
        ui.btnToggleStatus.className = 'btn danger giant-btn';
        ui.btnToggleStatus.innerText = '⏸ DỪNG HỆ THỐNG GỬI TIN BÁN TỰ ĐỘNG';
        ui.topStatusIndicator.className = 'status-indicator online';
    } else {
        ui.btnToggleStatus.className = 'btn success giant-btn';
        ui.btnToggleStatus.innerText = '▶ KHỞI ĐỘNG HỆ THỐNG GỬI TIN BÁN TỰ ĐỘNG';
        ui.topStatusIndicator.className = 'status-indicator offline';
    }
}

ui.btnSyncGroups.addEventListener('click', async () => {
    ui.btnSyncGroups.disabled = true;
    ui.btnSyncGroups.innerText = "Đang đồng bộ...";
    await loadGroups(true);
    ui.btnSyncGroups.innerText = "⬇️ Lọc Đồng Bộ Nhóm Chung";
    ui.btnSyncGroups.disabled = false;
});

// --- HELPERS ---
function sortListDom(container, selectionSet) {
    const items = Array.from(container.children);
    items.sort((a, b) => {
        const idA = a.querySelector('input').value;
        const idB = b.querySelector('input').value;
        const aSelected = selectionSet.has(idA);
        const bSelected = selectionSet.has(idB);
        
        if (aSelected && !bSelected) return -1;
        if (!aSelected && bSelected) return 1;
        
        const textA = a.querySelector('span').innerText;
        const textB = b.querySelector('span').innerText;
        return textA.localeCompare(textB, 'vi');
    });
    
    items.forEach(item => container.appendChild(item));
}

function renderList(groups, selectionSet, container, countDisplay, type) {
    container.innerHTML = '';
    
    if (!groups || groups.length === 0) {
        selectionSet.clear(); 
        countDisplay.innerText = "0";
        return;
    }

    // Bộ lọc: Nếu config cũ có Group Name mà giờ không giao nhau nữa, ta xoá nó
    const validNames = new Set(groups.map(g => g.name));
    for (const selectedName of selectionSet) {
        if (!validNames.has(selectedName)) {
            selectionSet.delete(selectedName);
        }
    }

    const sortedGroups = [...groups].sort((a, b) => {
        const aSelected = selectionSet.has(a.name);
        const bSelected = selectionSet.has(b.name);
        if (aSelected && !bSelected) return -1;
        if (!aSelected && bSelected) return 1;
        return a.name.localeCompare(b.name, 'vi');
    });

    sortedGroups.forEach(group => {
        const div = document.createElement('label');
        div.className = 'group-item';
        
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.value = group.name; // Use name as value
        checkbox.checked = selectionSet.has(group.name);
        
        checkbox.addEventListener('change', (e) => {
            if (e.target.checked) {
                if (type === 'source' && destSelection.has(group.name)) {
                    showErrorToast("Nhóm này đã được chọn ở cột Đích. Không thể chọn trùng!");
                    e.target.checked = false;
                    return;
                }
                if (type === 'dest' && sourceSelection.has(group.name)) {
                    showErrorToast("Nhóm này đã được chọn ở cột Nguồn. Không thể chọn trùng!");
                    e.target.checked = false;
                    return;
                }
                selectionSet.add(group.name);
            } else {
                selectionSet.delete(group.name);
            }
            
            countDisplay.innerText = selectionSet.size;
            ui.unsavedWarning.style.display = 'inline-block';
            
            sortListDom(container, selectionSet);
        });

        const span = document.createElement('span');
        span.innerText = group.name;
        span.title = group.name;

        div.appendChild(checkbox);
        div.appendChild(span);
        
        if (type === 'source') {
            const input = document.createElement('input');
            input.type = 'number';
            input.className = 'price-offset-input';
            input.placeholder = '+/- K';
            input.title = 'Tăng/giảm giá (K) cho nhóm này';
            input.value = priceAdjustments[group.name] || '';
            input.style.display = checkbox.checked ? 'block' : 'none';
            
            checkbox.addEventListener('change', (e) => {
                input.style.display = e.target.checked ? 'block' : 'none';
                if (!e.target.checked) {
                    delete priceAdjustments[group.name];
                    input.value = '';
                }
            });
            
            input.addEventListener('input', (e) => {
                const val = parseInt(e.target.value);
                if (!isNaN(val)) priceAdjustments[group.name] = val;
                else delete priceAdjustments[group.name];
                ui.unsavedWarning.style.display = 'inline-block';
            });
            
            div.appendChild(input);
        }

        container.appendChild(div);
    });
    
    countDisplay.innerText = selectionSet.size;
}

// --- SEARCH FUNCTIONALITY ---
function filterList(query, container) {
    const q = query.toLowerCase();
    const items = container.querySelectorAll('.group-item');
    items.forEach(item => {
        const text = item.querySelector('span').innerText.toLowerCase();
        item.style.display = text.includes(q) ? 'flex' : 'none';
    });
}

ui.searchSource.addEventListener('input', (e) => filterList(e.target.value, ui.sourceList));
ui.searchDest.addEventListener('input', (e) => filterList(e.target.value, ui.destList));

// --- SAVE CONFIG ---
ui.btnSave.addEventListener('click', async () => {
    const srcArray = Array.from(sourceSelection);
    const destArray = Array.from(destSelection);
    
    if (srcArray.length === 0 || destArray.length === 0) {
        showErrorToast("LƯU Ý: Vui lòng chọn ít nhất 1 nhóm nguồn và 1 nhóm đích.");
        return;
    }
    
    // Clean up empty price adjustments
    for (const key in priceAdjustments) {
        if (!sourceSelection.has(key)) {
            delete priceAdjustments[key];
        }
    }
    
    await window.zaloAPI.saveConfig(srcArray, destArray, priceAdjustments);
    
    ui.unsavedWarning.style.display = 'none';
    ui.saveStatus.innerText = "Cấu hình Toàn Cầu đã được lưu!";
    ui.saveStatus.style.opacity = 1;
    setTimeout(() => { ui.saveStatus.style.opacity = 0; }, 3000);
});

// --- BULK SELECTION ACTIONS ---
function handleSelectAll(containerId, selectionSet, oppositeSet, type) {
    const container = document.getElementById(containerId);
    const items = container.querySelectorAll('.group-item');
    let addedCount = 0;
    
    items.forEach(item => {
        if (item.style.display !== 'none') {
            const checkbox = item.querySelector('input[type="checkbox"]');
            const groupId = checkbox.value;
            
            if (!checkbox.checked && !oppositeSet.has(groupId)) {
                checkbox.checked = true;
                selectionSet.add(groupId);
                addedCount++;
            }
        }
    });

    if (addedCount > 0) {
        ui.unsavedWarning.style.display = 'inline-block';
        if (type === 'source') ui.sourceCount.innerText = selectionSet.size;
        else ui.destCount.innerText = selectionSet.size;
        
        sortListDom(container, selectionSet);
    }
}

function handleUnselectAll(containerId, selectionSet, type) {
    const container = document.getElementById(containerId);
    const items = container.querySelectorAll('.group-item');
    let removedCount = 0;
    
    items.forEach(item => {
        if (item.style.display !== 'none') {
            const checkbox = item.querySelector('input[type="checkbox"]');
            const groupId = checkbox.value;
            
            if (checkbox.checked) {
                checkbox.checked = false;
                selectionSet.delete(groupId);
                removedCount++;
            }
        }
    });

    if (removedCount > 0) {
        ui.unsavedWarning.style.display = 'inline-block';
        if (type === 'source') ui.sourceCount.innerText = selectionSet.size;
        else ui.destCount.innerText = selectionSet.size;
        
        sortListDom(container, selectionSet);
    }
}

ui.btnSelectAllSource.addEventListener('click', () => handleSelectAll('source-list', sourceSelection, destSelection, 'source'));
ui.btnUnselectAllSource.addEventListener('click', () => handleUnselectAll('source-list', sourceSelection, 'source'));

ui.btnSelectAllDest.addEventListener('click', () => handleSelectAll('dest-list', destSelection, sourceSelection, 'dest'));
ui.btnUnselectAllDest.addEventListener('click', () => handleUnselectAll('dest-list', destSelection, 'dest'));

// START
bootSystem();
