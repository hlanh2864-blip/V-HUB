# V-HUB Social

V-HUB Social là một mạng xã hội mini giao diện Dark Mode, viết bằng Node.js thuần (HTTP server tích hợp), SQLite và HTML/CSS/JavaScript thuần. Dự án phù hợp để học cách một website full-stack hoạt động: trình duyệt gọi API, máy chủ kiểm tra dữ liệu và SQLite lưu trữ nội dung.

## 1. Chức năng

- Đăng ký, đăng nhập, đăng xuất.
- Mật khẩu được băm bằng `scrypt` của Node.js trước khi lưu.
- Xem bảng tin chung hoặc bài viết từ những tài khoản đang theo dõi.
- Đăng bài văn bản và đính kèm ảnh bằng đường dẫn HTTP/HTTPS.
- Thích/bỏ thích bài viết.
- Bình luận và xóa bình luận của chính mình.
- Tìm kiếm tài khoản theo username hoặc tên hiển thị.
- Theo dõi/bỏ theo dõi người dùng.
- Hồ sơ cá nhân: tên hiển thị, tiểu sử, ảnh đại diện bằng URL.
- Thông báo khi có người thích, bình luận hoặc theo dõi bạn.
- Giao diện tương thích màn hình máy tính và điện thoại.

## 2. Yêu cầu

- Windows 10/11, macOS hoặc Linux.
- Node.js **22.13 trở lên** (khuyên dùng bản LTS mới nhất).
- Không cần kết nối Internet để cài thư viện; dự án sử dụng các module tích hợp sẵn của Node.js.

Kiểm tra cài đặt bằng Terminal/CMD:

```bash
node -v
npm -v
```

Tải Node.js tại: https://nodejs.org/en/download/

## 3. Cài đặt trên Windows

1. Giải nén thư mục `V-HUB-Social`.
2. Mở thư mục đó.
3. Nhấn đúp `install.bat` để cài thư viện.
4. `install.bat` chỉ kiểm tra Node.js; V-HUB không cần tải thư viện npm.
5. Nhấn đúp `start.bat`.
6. Mở trình duyệt và truy cập **http://localhost:3000**.

Cách chạy bằng CMD/Terminal:

```bash
cd V-HUB-Social
npm start
```

Trong lúc máy chủ đang chạy, giữ cửa sổ Terminal mở. Để dừng máy chủ, nhấn `Ctrl + C`.

## 4. Tài khoản trải nghiệm

Có sẵn ba tài khoản mẫu để thử giao diện:

| Username | Mật khẩu |
|---|---|
| `demo` | `Demo1234!` |
| `minhkhoi` | `Demo1234!` |
| `linhchi` | `Demo1234!` |

Bạn cũng có thể tự đăng ký tài khoản mới. Các tài khoản mẫu chỉ nhằm mục đích thử nghiệm.

## 5. Cấu trúc thư mục

```text
V-HUB-Social/
├── data/
│   └── vhub.sqlite       # SQLite tự tạo khi chạy lần đầu
├── public/
│   ├── index.html        # Khung giao diện
│   ├── styles.css        # Giao diện Dark Mode + responsive
│   └── app.js            # Logic giao diện và gọi API
├── .gitignore
├── install.bat           # Kiểm tra Node.js trên Windows
├── start.bat             # Khởi động trên Windows
├── package.json          # Thông tin và thư viện dự án
├── README.md             # Hướng dẫn
└── server.js             # API, xác thực và truy cập SQLite
```

## 6. Dữ liệu được lưu ở đâu?

Sau lần chạy đầu tiên, máy chủ tự tạo `data/vhub.sqlite`. Tài khoản, bài viết, lượt thích, bình luận, lượt theo dõi, thông báo và phiên đăng nhập được lưu trong cơ sở dữ liệu này. Đóng trình duyệt hoặc tắt máy chủ không xóa bài viết.

Để sao lưu, hãy dừng máy chủ rồi sao chép file `data/vhub.sqlite` sang nơi an toàn. Không xóa file này nếu bạn muốn giữ dữ liệu. Để tạo một cơ sở dữ liệu mới, hãy dừng máy chủ và xóa file đó; các tài khoản mẫu sẽ được tạo lại khi khởi động.

## 7. Tuỳ chỉnh giao diện

- Màu sắc, khoảng cách, bố cục: `public/styles.css`.
- Nội dung giao diện: `public/index.html`.
- Sự kiện nút bấm và cập nhật trang: `public/app.js`.
- API, quy tắc dữ liệu và đăng nhập: `server.js`.

## 8. Lưu ý trước khi đưa lên Internet

Đây là bản học tập/chạy thử trên máy cá nhân, chưa phải nền tảng mạng xã hội production. Máy chủ dùng Node.js thuần nên không cần chạy `npm install`. Trước khi công khai cho nhiều người dùng, cần bổ sung ít nhất: HTTPS bắt buộc, cấu hình cookie Secure và proxy đúng cách, giới hạn tốc độ cho toàn bộ API, xác minh email, quy trình quên/đổi mật khẩu, kiểm duyệt nội dung và báo cáo người dùng, giới hạn/kiểm tra ảnh tải lên, sao lưu định kỳ, giám sát lỗi và chính sách quyền riêng tư. Không dùng mật khẩu thật đang dùng ở dịch vụ khác cho tài khoản demo.

**Lưu ý ảnh:** bản này dùng URL ảnh thay vì tải file trực tiếp lên máy chủ. Chỉ thêm ảnh mà bạn có quyền sử dụng; một URL ảnh bên ngoài có thể ngừng hoạt động hoặc tiết lộ yêu cầu tải ảnh cho bên lưu trữ ảnh.

## 9. Công nghệ

- Node.js `node:http`: máy chủ HTTP và API, không cần Express.
- SQLite (`node:sqlite`): cơ sở dữ liệu, không cần cài máy chủ database riêng.
- `node:crypto` (`scrypt`): băm mật khẩu và tạo mã phiên.
- HTTP security headers được thiết lập trực tiếp trong máy chủ.
- HTML/CSS/JavaScript: giao diện phía trình duyệt.

Dự án yêu cầu Node.js 22.13+ vì sử dụng module SQLite tích hợp `node:sqlite`.
