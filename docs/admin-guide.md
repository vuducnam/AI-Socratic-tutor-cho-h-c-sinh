# Hướng dẫn quản trị và tài khoản

Tài liệu cho chủ dự án sau khi đã triển khai (xem `deployment-guide.md` cho phần cài đặt). Mọi tài khoản do admin
tạo; không có trang đăng ký (quy tắc cứng 11). Địa chỉ cụ thể, mật khẩu admin và checklist của nhà mình nằm ở
file riêng `plans/prod-accounts.md` (gitignore, không commit).

## 1. Ba vai trò, hai cổng

| Vai trò | Vào ở đâu | Đăng nhập bằng |
| --- | --- | --- |
| Học sinh | `https://<địa-chỉ-app>/login`, tab **Học sinh** | Tên đăng nhập + PIN 6 số |
| Phụ huynh | `https://<địa-chỉ-app>/login`, tab **Bố mẹ** | Email + mật khẩu (+ mã TOTP nếu đã bật) |
| Admin | Chỉ trên PC hoặc qua Tailscale (mục 2); cổng công khai chặn `/admin` | Email + mật khẩu (+ TOTP) |

- Admin và phụ huynh là hai tài khoản khác nhau, khác email. Cổng công khai từ chối tài khoản admin, nên bạn
  cần một tài khoản phụ huynh riêng để xem `/parent`.
- Mọi trang đăng nhập có Cloudflare Turnstile. Turnstile chỉ chạy trên tên miền đã khai báo trong widget
  (Cloudflare › Turnstile › widget › Hostname management): tên miền app, `localhost`, và tên Tailscale của PC.

## 2. Mở trang admin

**Cách A — ngồi trên PC:** mở `http://localhost:3001/admin`.

**Cách B — từ máy khác qua Tailscale** (máy đó phải đăng nhập cùng tailnet):

1. Trang quản trị Tailscale (login.tailscale.com › DNS): bật **MagicDNS** và **HTTPS Certificates**.
   Ở mục Machines, chọn PC › **Disable key expiry** để PC không tự rời tailnet.
2. Trên PC (PowerShell): `tailscale serve --bg --https=443 http://localhost:3001`
   Kiểm: `tailscale serve status` phải thấy `https://<tên-pc>.<tailnet>.ts.net` → `http://localhost:3001`.
3. Mở `https://<tên-pc>.<tailnet>.ts.net/admin` từ điện thoại hoặc laptop trong tailnet.
4. Tên `<tên-pc>.<tailnet>.ts.net` phải có trong danh sách hostname của widget Turnstile (mục 1).

Không dùng `tailscale funnel` (sẽ mở admin ra internet) và không mở cổng router.

## 3. Đăng nhập admin lần đầu

- Tài khoản admin đầu tiên tạo bằng lệnh (đã làm khi triển khai):
  `docker compose --env-file .env.prod -f docker-compose.yml --profile prod run --rm admin node_modules/.bin/tsx --conditions=react-server scripts/create-first-admin.ts`
  Lệnh hỏi tên, email, mật khẩu (≥ 10 ký tự).
- Email admin phải trùng email ghi trong `approved.by` của dữ liệu đã duyệt (`data/`), nếu không seed từ chối.
- Đổi mật khẩu admin: bảng **Tài khoản** › dòng của chính mình › nhập mật khẩu mới › **Đặt lại**.
- Trang admin chưa có mục bật TOTP cho admin (TOTP chỉ có ở `/parent` › Cấu hình). Lớp bảo vệ của admin là
  Tailscale/localhost cộng mật khẩu dài.

## 4. Tạo tài khoản cho gia đình

Làm theo thứ tự trên trang admin:

### 4.1 Tài khoản phụ huynh — mục "Tạo tài khoản phụ huynh"

- **Tên**, **Email** (dùng để đăng nhập, khác email admin), **Mật khẩu ban đầu** ≥ 10 ký tự.
- Tạo xong là dùng được ngay. Gửi mật khẩu cho bố/mẹ bằng kênh riêng; nhắc đổi mật khẩu ở **Cấu hình**.
- Mỗi người lớn một tài khoản (bố và mẹ tạo hai tài khoản, cùng liên kết với con ở bước 4.3).

### 4.2 Hồ sơ học sinh — mục "Tạo hồ sơ học sinh"

| Trường | Ghi chú |
| --- | --- |
| Tên gọi | Mít gọi con bằng tên này (tối đa 50 ký tự). Sau này **không đổi được**, nhập đúng ngay |
| Tên đăng nhập | 3–32 ký tự `A-Z a-z 0-9 . _ -`, **không trùng tên gọi** (khó đoán hơn). Không đổi được |
| PIN 6 số | Con dùng để đăng nhập; đổi được về sau (Đặt PIN) |
| Giới tính | Chỉ dùng cho xưng hô và ngữ pháp (quy tắc cứng 9). Không đổi được |
| Lớp | Lớp hiện tại. Không đổi được trên giao diện |
| Học sinh trong gia đình? | "Con trong gia đình" hoặc "Ngoài gia đình" — ngoài gia đình phải ghi nhận đồng ý (4.4) trước khi đăng nhập được |
| Sở thích | Cách nhau bằng dấu phẩy; Mít dùng để chọn ví dụ đời thường. Phụ huynh sửa được về sau |
| Tên bạn học | Để trống = "Mít" |
| Liên kết với phụ huynh | Chọn tài khoản vừa tạo ở 4.1 |

Bấm **Tạo hồ sơ** → trang chuyển sang **Tiến độ trên lớp**: mỗi môn (Toán, Lịch sử và Địa lí) một khối; chọn bài
con **đã học đến** trên lớp (theo SGK Kết nối tri thức) cho từng môn muốn con học với Mít. Môn chưa đặt tiến độ
thì con không mở được phiên môn đó và không thấy môn đó. Mít không dạy vượt bài đã đặt.

### 4.3 Liên kết phụ huynh — cột "Phụ huynh" trong bảng Học sinh

Trên hàng của học sinh, chọn phụ huynh ở ô **Chọn phụ huynh** (hoặc **Thêm phụ huynh**) → **Liên kết**. Dùng
cách này khi tạo học sinh trước rồi mới tạo phụ huynh, hoặc khi thêm người lớn thứ hai. Phụ huynh chỉ thấy học
sinh đã liên kết với mình. Bỏ liên kết bằng nút × cạnh tên phụ huynh ở cùng cột.

### 4.4 Học sinh ngoài gia đình — mục "Ghi nhận xác nhận đồng ý"

Chọn học sinh, phụ huynh của em, nhập phiên bản văn bản (ví dụ `v1`), dán nội dung văn bản đồng ý đã ký, ngày
ký, đánh dấu nếu em (từ 7 tuổi) đã được giải thích, đính kèm bản scan (PDF/JPEG/PNG) nếu có → **Ghi nhận**.

## 5. Việc thường gặp trên trang admin

| Việc | Ở đâu |
| --- | --- |
| Phụ huynh quên mật khẩu | Bảng Tài khoản › nhập mật khẩu mới › **Đặt lại** |
| Con quên PIN | Bảng Học sinh › nhập PIN mới › **Đặt PIN** (đăng xuất mọi thiết bị của con) |
| Con bị khoá PIN | Bảng Học sinh › **Mở khoá PIN** (phụ huynh cũng mở được ở Tổng quan) |
| Tạm ngưng / mở lại tài khoản | Nút đổi trạng thái ở bảng Tài khoản hoặc Học sinh |

Mọi thao tác admin được ghi vào nhật ký truy cập; phụ huynh xem được nhật ký liên quan tới con mình.

## 6. Phụ huynh dùng `/parent`

- **Tổng quan**: các con, phiên gần nhất, cờ chưa xem, cảnh báo hệ thống, trạng thái khoá PIN + nút
  **Mở khoá PIN**.
- **Phiên**: từng phiên học, báo cáo phiên (số liệu do code tính, nhận định kèm bằng chứng), transcript đầy đủ,
  chữ máy nghe được khi con nói (Raw STT), lời gọi model gốc.
- **Cờ**: việc cần bố mẹ xem (khoá PIN, an toàn…) › **Đánh dấu đã xem**.
- **Tiến độ trên lớp**: mỗi môn một khối — dời bài con đã học đến; **Cho học trước** một bài; **Tắt nhắc**.
  Thay đổi áp dụng từ phiên sau.
- **Duyệt**:
  - **Ý chính** (Lịch sử và Địa lí): mở SGK trên taphuan.nxbgd.vn đúng trang ghi ở từng ý, đối chiếu nội dung,
    trang, chỗ trong sách và cụm từ chấp nhận rồi **Duyệt bài này**. Bài chưa duyệt thì Mít không dạy bài đó.
  - **Tình huống đời thật** (cả hai môn): Mít chỉ dùng tình huống đã duyệt.
  - Duyệt qua cổng admin (`http://localhost:3001/parent/review` trên PC) để trạng thái duyệt được ghi cả vào file
    trong `data/`, không mất khi seed lại DB.
- **Dữ liệu độc lập**: nhập điểm bài kiểm tra trên giấy để so với lúc học cùng Mít.
- **Cấu hình**:
  - Hồ sơ: sở thích, số phút mỗi phiên (mặc định 15), số phút mỗi ngày (mặc định 30) › **Lưu hồ sơ**.
  - Giọng nói: Mít tự đọc câu trả lời; ngôn ngữ nói mặc định (Tiếng Việt / English); dự phòng nhận giọng qua
    cloud khi máy nhà lỗi (mặc định tắt — bật thì giọng con có thể gửi lên OpenRouter) › **Lưu cài đặt giọng nói**.
  - **Đổi mật khẩu**, **Xác thực hai lớp (TOTP)** (khuyên bật).
- **Dữ liệu**: **Tải toàn bộ dữ liệu** (file zip), nhật ký truy cập, **Xoá toàn bộ dữ liệu** của một con (hai
  bước, phải gõ đúng tên gọi của con; không hoàn tác).

## 7. Con học trên tablet

1. Mở `https://<địa-chỉ-app>` bằng Safari/Chrome › tab **Học sinh** › tên đăng nhập + PIN.
2. Thêm vào màn hình chính (Safari: Chia sẻ › Thêm vào MH chính; Chrome: ⋮ › Thêm vào màn hình chính).
3. Lần đầu bấm micro, trình duyệt hỏi quyền micro → **Cho phép**.
4. Con có từ hai môn đã đặt tiến độ thì chọn môn ở đầu buổi; nút **Đổi môn** ở đầu khung chat khi chưa làm bài.
5. Mỗi phiên: gửi đề (nói, gõ hoặc chụp ảnh và khoanh vùng đề) hoặc bấm **Mít ra đề cho bạn**, trả lời Mít, bấm
   **Gợi ý** khi bí; xong bài chấm vui/bình thường/chán rồi **Làm bài khác** hoặc **Xong hôm nay** (báo cáo phiên
   tới bố mẹ ngay). Với Lịch sử và Địa lí, con nên có SGK bên cạnh: khi con bí, Mít chỉ trang sách để con tự đọc.
6. Phiên đăng nhập của con hết lúc nửa đêm. Hết số phút trong ngày thì Mít chào và hẹn hôm sau.

Khoá PIN (tính cho cả tài khoản, mọi thiết bị): sai 5 lần → khoá 15 phút; sai 10 lần liên tiếp → khoá tới khi
bố mẹ hoặc admin mở.

## 8. Sự cố thường gặp

| Hiện tượng | Kiểm |
| --- | --- |
| Con thấy "Mít đang nghỉ" | PC tắt / ngủ, Docker chưa chạy, hoặc container lỗi: `docker compose --env-file .env.prod -f docker-compose.yml --profile prod ps` |
| Không bấm được "Vào" (Turnstile không hiện dấu tích) | Tên miền đang mở có trong hostname của widget Turnstile chưa (mục 1) |
| Không vào được admin qua Tailscale | `tailscale serve status`; máy đang mở đã vào tailnet chưa; HTTPS Certificates đã bật chưa |
| Quên mật khẩu admin | Trên PC chạy lại lệnh ở mục 3 với email khác để tạo admin mới, rồi dùng admin mới đặt lại mật khẩu cho admin cũ |
| Không có email báo | Prod không cấu hình SMTP (chủ dự án chọn): xem cờ và trạng thái khoá ở `/parent` |
