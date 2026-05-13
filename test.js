const fs = require('fs');
const examples = [
\`𝖇𝖗𝖆𝖓𝖉 : siêu phẩm Louisvutton bản len dệt mịn cao cấp phối họa tiết nét căng sang xịn đẹp keng luôn mời ae chiến mạnh tay 
𝖕𝖗𝖎𝖈𝖊 𝖆𝖓𝖉 𝖖𝖚𝖆𝖙𝖎𝖑𝖞 : new 2026
 Zá : 155k
𝖘𝖎𝖟𝖊 : S / M / L / XL
 🔥🔥🔥 𝕱𝖔𝖒 : 𝕯𝖆́𝖓𝖌 𝖈𝖍𝖚𝖆̂̉𝖓 𝖘𝖕𝖋 
𝖉𝖊𝖙𝖆𝖎𝖑𝖘 : ảnh bên e tự chụp 100%
‼️ bên e nhận sản xuất theo yêu cầu theo mẫu từ 40 chiếc  a chị đặt inbox riêng e nhé!\`,

\`✅ Mix Set Lacoste Nét Căng !
S M L XL
Giá áo : 150k
Giá Quần : 145k\`,

\`Con hàng đi cùng năm tháng . Polo GC vân nổi cúc khắc thương hiệu. E sẵn 3 màu sll . 00306
Size  : S - M - L - XL
Buôn : 200k  💥💥💥 
E nhận gia công từ 40sp . Tuyển đại lý toàn quốc chiết khấu cao ❤️❤️❤️\`,

\`Hottt Sett Bộ ADD đội tuyển Đức  Newww SS26
 SIZE: S M L XL
Hàng vải ni chuẩn auth
Gia 325
E sẵn ạ\`,

\`Phong LV   2026 hàng về hàng về 
hàng may kĩ từng đường kim mũi chỉ 
 Tang mác cúc thương hiệu 
Mời cả nhà băm mã này ạ 😍😍
Hàng : 190/ ao🍀🍀 ‼️
𝖘𝖎𝖟𝖊 : 💔S / M / L / XL
Em sẵn ạ\`,

\`Sét bộ nike cập bến rồi😍😍😍
Sẵn ạ ae báo sớm
In sắc nét + dây khoá hãng 
300k- S M L XL 😍😍\`
];

function smartPriceAdjuster(text, offset) {
    if (!offset || isNaN(parseInt(offset))) return text;
    const adjustVal = parseInt(offset);

    // Bao gồm các từ khóa: giá, gia, zá, buôn, bán, sỉ, lẻ, chỉ, hàng
    // Hỗ trợ từ khóa cách số một khoảng (vd: Giá áo : 150k) -> [^\d\n]{0,10}
    return text.replace(/((?:giá|gia|zá|buôn|bán|sỉ|lẻ|chỉ|hàng)[^\d\n]{0,12})?([0-9]+(?:\.[0-9]{3})*(?:,[0-9]{3})?)(\s*(?:k|đ|vnd|vnđ|\/|-))?/gi, (match, prefix, numStr, suffix, offsetIdx, fullText) => {
        prefix = prefix || '';
        suffix = suffix || '';
        
        let isThousandFormat = numStr.includes('.') || numStr.includes(',');
        let rawNum = parseInt(numStr.replace(/[.,]/g, ''));
        
        // Bỏ qua các số có số 0 ở đầu (ví dụ: 00306, 098...)
        if (numStr.startsWith('0') && numStr !== '0') return match;

        let preContext = fullText.substring(Math.max(0, offsetIdx - 15), offsetIdx).toLowerCase();
        let postContext = fullText.substring(offsetIdx + match.length, Math.min(fullText.length, offsetIdx + match.length + 15)).toLowerCase();
        
        let isPrice = false;
        
        if (prefix.trim().length > 0 && /giá|gia|zá|buôn|bán|sỉ|lẻ/.test(prefix.toLowerCase())) isPrice = true;
        if (suffix.toLowerCase().includes('k') || suffix.toLowerCase().includes('đ') || suffix.toLowerCase().includes('vnd') || suffix.toLowerCase().includes('/')) isPrice = true;
        if (/giá|gia|zá|buôn|bán|sỉ|lẻ/.test(preContext)) isPrice = true;
        
        if (rawNum >= 50 && rawNum <= 9999) { 
            // Từ khóa loại trừ
            if (!/mã|size|kg|m|cm|sz|sp|chiếc/.test(preContext) && !/mã|size|kg|m|cm|sz|sp|chiếc/.test(postContext)) {
                isPrice = true; 
            }
        }
        if (rawNum >= 50000 && rawNum <= 99999999) {
            if (!/mã|size|sz/.test(preContext)) {
                isPrice = true;
            }
        }

        if (isPrice) {
            let newVal = rawNum;
            if (rawNum >= 50000) {
                newVal = rawNum + (adjustVal * 1000);
            } else {
                newVal = rawNum + adjustVal;
            }
            if (newVal < 0) newVal = 0;
            let newValStr = newVal.toString();
            if (isThousandFormat && newVal >= 1000) {
                newValStr = newVal.toLocaleString('vi-VN');
            }
            return prefix + newValStr + suffix;
        }
        return match;
    });
}

examples.forEach((ex, i) => {
    console.log('--- VD' + (i+1) + ' ---');
    console.log(smartPriceAdjuster(ex, -20));
});
