/**
 * Hàm gửi tin nhắn ảnh dùng PhotoID có sẵn (Skip upload).
 * Dựa trên cấu trúc zca-js/dist/apis/sendMessage.js
 */
async function sendPhotoWithExistingIds(
    api,
    attachments,
    threadId,
    message = ""
) {
    // Truy cập trực tiếp vào utils ẩn của zca-js bằng node require
    const path = require('path');
    let utils;
    try {
        utils = require(path.join(process.cwd(), 'node_modules', 'zca-js', 'dist', 'utils.js'));
    } catch(e) {
        throw new Error("Không tìm thấy core zca-js utils: " + e.message);
    }
    const ctx = typeof api.getContext === 'function' ? api.getContext() : api.ctx;

    // zpwServiceMap.file[0] là host tải file, mặc định thay đổi linh hoạt, mượn cờ của zalo endpoint.
    const serviceMap = api.zpwServiceMap || { file: ["https://file.zalo.me"] };
    const serviceUrl = `${serviceMap.file[0]}/api/group/photo_original/send?`;
    
    const groupLayoutId = (Date.now() + Math.floor(Math.random() * 1000)).toString();
    const isMultiFile = attachments.length > 1;
    let clientId = Date.now() + Math.floor(Math.random() * 1000);
    
    const requests = [];

    for (let i = 0; i < attachments.length; i++) {
        const att = attachments[i];

        if (att.fileType !== 'image') continue;

        const params = {
            photoId: att.photoId,
            clientId: (clientId++).toString(),
            desc: i === 0 ? message : "",
            width: att.width,
            height: att.height,
            grid: threadId,
            rawUrl: att.normalUrl,
            hdUrl: att.hdUrl,
            thumbUrl: att.thumbUrl,
            oriUrl: att.normalUrl,
            hdSize: String(att.totalSize || att.hdSize || 0),
            zsource: -1,
            ttl: 0,
            jcp: '{"convertible":"jxl"}',
            groupLayoutId: isMultiFile ? groupLayoutId : undefined,
            isGroupLayout: isMultiFile ? 1 : undefined,
            idInGroup: isMultiFile ? i : undefined,
            totalItemInGroup: isMultiFile ? attachments.length : undefined,
            extMsgProp: isMultiFile ? `{"groupMediaMsg":{"groupLayoutId":"${groupLayoutId}"}}` : undefined,
        };

        Object.keys(params).forEach(key => params[key] === undefined && delete params[key]);

        const encryptedParams = utils.encodeAES(ctx.secretKey, JSON.stringify(params));
        if (!encryptedParams) continue;

        const url = utils.makeURL(ctx, serviceUrl, {
            nretry: "0"
        });

        const body = new URLSearchParams();
        body.append("params", encryptedParams);

        requests.push(utils.request(ctx, url, {
            method: "POST",
            body: body
        }).then((res) => utils.resolveResponse ? utils.resolveResponse(ctx, res) : res));
    }

    return Promise.all(requests);
}

module.exports = {
    sendPhotoWithExistingIds
};
