# BÍ TỊCH KIẾN TRÚC ZALO FORWARDING NATIVE CDN 
*(Tài liệu mật truyền phục vụ bảo trì khi Zalo thay đổi thuật toán)*

---

Được viết ra để hướng dẫn các lập trình viên tương lai tiếp quản, bảo trì và bẻ khóa các đổi mới từ phía Zalo. Mục tiêu cốt lõi của Tool này là **Lướt qua các bộ lọc Rate Limit của Zalo**, chuyển tiếp vô hạn Ảnh (Dạng Album Lưới 100% nguyên gốc) từ Nguồn ra Đa Đích, tốc độ Gigabit và tiêu tốn đúng `0 Bytes` Băng thông Upload cho từng nhóm Đích.

## 1. BẢN CHẤT CỦA NATIVE FORWARD (TẠI SAO ODER LẠI HOẠT ĐỘNG KỲ DIỆU TỚI VẬY?)

Cú pháp với Zalo khi bạn Forward theo cách Giao Diện là: *Zalo quét tin cũ -> Trích id -> Tạo lệnh gửi.*
Khi Zalo bóp quét tin cũ do hạn chế History API. Cách chúng ta Bypass là **Sử dụng Upload Ảnh Thẳng vào Máy Chủ CDN (Content Delivery Network)** để Zalo nôn ra `photoId`, sau đó cầm `Id` đó phân phát ảo tới các nhóm. Khi dùng ID Ảnh có sẵn từ CSDL của zalo, việc gửi ảnh trở thành dạng text nhẹ tựa lông hồng và chỉ mất **0.1s cho 50 bức ảnh**.

---

## 2. CHUỖI CÔNG NGHỆ VÀ THUẬT TOÁN CỐT LÕI

### 2.1. BỘ ĐÊM GOM ĐƠN (TIME_DEBOUNCE_ARRAY)
- **Vị trí code:** `Khoảng Dòng 190-264 trong zaloService.js`
- **Công nghệ:** SetTimeout & ClearTimeout kết hợp Mảng Động (Dynamic Array).
- **Cách hoạt động:**
  - Việc bóc tách các tin nhắn từ Zalo được lọc qua độ delay 60 Giây (`60.000 ms`). Điều này đảm bảo nếu Nguồn gửi các file rìa rạc, nó sẽ bị cuốn vào 1 cụm Album.
  - **Trường hợp đặc biệt (Cắt Đứt Đáy):** Để đề phòng tràn RAM do Sỉ xả lũ mãi không ngưng, ta có biến `sessionStartTime`. Nếu luồng gửi chênh lệch đạt **> 180 seconds** (3 phút) + và điểm kiểm tra hiện tại là TEXT -> Hệ thống sẽ ép xếp Cụm.
  - *Future Fixes:* Nếu có lỗi gom sai, chắc chắn rơi vào tham số thời gian delay ở hàm này.

### 2.2. KIẾN TRÚC MŨI KHOAN GLOBAL QUEUE (HÀNG ĐỢI TOÀN CẦU)
- **Vấn đề:** Nếu Nhiều nhóm Nguồn rớt hàng cùng 1 lúc, Promise All sẽ bung xung đẩy CPU lên 100% và gây bão TCP -> Ăn 429 Rate Limit Zalo!
- **Công nghệ:** `while (this.globalQueue.length > 0)`, Cơ chế Mutex Khóa tiến trình `isProcessingGlobalQueue`.
- **Cách hoạt động:** Nó làm từng nhóm nguồn một theo cơ chế FIFO (Vào trước Ra trước). Khóa toàn bộ I/O phía sau. Phân lớp cực kỳ ổn định giúp người sau dễ dàng debug Call Stack.

### 2.3. TẢI BUFFER TRỰC TIẾP RAM (DIRECT AXIOS BUFFERING)
- **Vấn đề:** Thay vì ghi vào ổ cứng `FileSystem` làm chai SSD và tốn I/O, ta sử dụng mảng cứng trên RAM.
- **Cách làm:** `Buffer.from(response.data)`. Mọi ảnh nhận qua `imgUrl` để được tải dưới dạng `arraybuffer`.
- *Future Fixes:* Nếu Zalo thay đổi Domain chứa ảnh khiến Fetch lỗi, hãy check lại object `content` để rót đúng URL có tiền tố `https://`.

### 2.4. THUẬT TOÁN CHIA LÔ UPLOAD (RATE LIMIT CHUNKING BYPASS)
- **Vị trí code:** Tìm `const CHUNK_SIZE = 4;`
- **Công nghệ:**  Upload qua cổng API native ZCA (`api.uploadAttachment`).
- **Khúc Mắc:** Nếu Upload 50 Ảnh cùng lúc lên CDN Zalo -> Zalo cho bay Màu (Lỗi fetch failed hoặc timeout) do tưởng DDos.
- **Giải thuật Bảo vệ:** 
  - Thái hình ảnh thành Lổ 4 Tấm (Chunk). 
  - Up 4 tấm -> Chờ `Promise(2000ms)` -> Up 4 tấm tiếp.
  - Tại bước này mục tiêu là *Rút ra các ID Ảnh (`photoId/fileId`)* từ server. 
  - *Future Fixes:* Zalo mà gắt gao hơn ở bước Upload? -> Tăng Delay lên 3000ms và Giam `CHUNK_SIZE` xuống bằng 2.

### 2.5. VŨ KHÍ TỐI THƯỢNG: TRỊNH TRÌNH TẠO HÌNH ALBUM ZALO THÔNG BÁO "NATIVE_GRID"
- **Vị trí code:** Hàm `sendPhotoWithExistingIds` (Nằm trong `forwarderUtils.js`)
- **Tầm quan trọng:** Đây chính là Phân Loại Bảo Mật cao cấp nhất của Cấu Trúc.
- Khi bạn chuyển tiếp thông thường, ảnh bị xuyến rạc từng cái ra. Cách để **Zalo đóng màng thành ALBUM 4 Ô VUÔNG** hay **6 CỘT DỌC** là phải cung cấp Toàn Bộ ID Ảnh trong CÙNG 1 REQUEST!
- Cấu trúc lôi kéo ZCA-JS để truyền mảng là:
  ```json
  [
    {
      "fileType": "image",
      "photoId": "PHOTO_ID_THẦN_THÁNH",
      "normalUrl": "...",
      "hdUrl": "...",
      "width": 1080,
      "height": 1080
    }
  ]
  ```
- *Truy cập Lơm Lở:* Cần cấu trúc API Object như trên, trực tiếp tuồn cho `ThreadType.Group` -> Bạn sẽ được 1 Album thẳng tắp!
- *Future Fixes:* Nếu ID không tạo được ảnh hoặc hiện "Lỗi tin nhắn", khả năng lớn Zalo đòi hỏi thêm biến chữ ký `checksum` hoặc `clientId`. Khi đó phân tích gói Headers gửi bằng Network ở Zalo Web và map các fields vào Object này.

### 2.6. KHÁC PHỤC CHÓNG XỤP ĐĂNG NHẬP / SPAM MÃ QR (Zalo Anti-bot)
- **Vấn đề Cũ:** Trước đây zca-js spam Long-Polling khi hết Session và làm chết ứng dụng.
- **Biện Pháp Đề Phòng:** Tại màn hình chính `app.js` và Event Handle `main.js`, đặt tình trạng nghe Listeners cho từ khóa `zalo-qr-failed`.
  - Không được tự ý lặp lại vòng Request để thử kiếm Session, vì Firewall Zalo sẽ khóa IP máy chủ VPS nếu thấy Request đánh định kỳ mỗi X giây mà không có User Confirm.  Mọi việc tạo ID mới được ném Quyên bấm qua cho Giao Diện Con Người.

---
## TỔNG KẾT CHU KỲ BẢO TRÌ NÀNG CODE
Nếu sau này có bất kì vấn đề "*Gửi được Text mà không Gửi được Ảnh*". Bạn hãy dòm thẳng vào:
1. `zaloService.js`: Hàm đoạn `this.api.uploadAttachment`, đổi Chunk Size và xem lỗi Upload có ra 429 rate limit không?
2. `forwarderUtils.js`: Xem lại Trường Biến JSON Object coi nó thiếu Tham số gì mà Zalo tạm từ chối. 

***Chúc kỹ sư đời sau thành công.***
*(Written by Antigravity System - Project Shared Message Zalo Pro)*
