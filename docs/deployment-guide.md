# Triển khai Cú trên PC tại nhà

Tài liệu vận hành cho chủ dự án (SPEC §14b, quy tắc cứng 11). Kiến trúc: một image `cu-app` chạy ba vai —
`app` (công khai qua Cloudflare Tunnel), `admin` (chỉ qua Tailscale), `worker` (job nền) — cùng
`postgres`, `redis`, `math-verifier`, `cloudflared`. File chính: `Dockerfile`, `docker-compose.yml`.

## 0. Điều kiện trước khi lưu dữ liệu thật của con

Không tạo hồ sơ thật cho con khi chưa tick đủ:

- [ ] Windows còn nhận bản vá bảo mật: Windows 11, hoặc Windows 10 đã đăng ký ESU và đang nhận bản vá.
- [ ] BitLocker bật (nếu Windows bản Pro).
- [ ] `%UserProfile%\.wslconfig` có `memory=24GB` và chừa `processors` cho Windows.
- [ ] Docker Desktop (WSL2) tự khởi động cùng Windows; tắt sleep trong khung giờ học; đặt Windows Update active hours.
- [ ] Phase 15 (`/learn`), 16 (`/parent`) đã merge và `pnpm eval:ci` đạt (nhãn `eval-passed`).
- [ ] Mục lục, skill, misconception, tình huống đời thật đã duyệt (xem mục 4).

## 1. Biến môi trường (`.env` trên PC, không bao giờ commit)

Sao chép `.env.example` thành `.env` rồi điền. Bắt buộc cho prod:

| Biến | Ghi chú |
| --- | --- |
| `POSTGRES_PASSWORD`, `CU_OWNER_PASSWORD`, `CU_APP_PASSWORD` | Mật khẩu ngẫu nhiên dài; role tạo lúc volume Postgres còn trống (`docker/postgres-init`) |
| `REDIS_PASSWORD` | |
| `SESSION_SECRET`, `ADMIN_SESSION_SECRET`, `TOTP_ENCRYPTION_KEY` | ≥ 32 ký tự ngẫu nhiên, ba giá trị khác nhau |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` | Từ Cloudflare › Turnstile (chế độ Managed). Site key vào image lúc build |
| `CLOUDFLARE_TUNNEL_TOKEN` | Token tunnel (mục 3) |
| `CLAUDE_API_KEY`, `CLAUDE_WORKSPACE_ID` | Key không gắn workspace thì bắt buộc có workspace id |
| `OPENROUTER_API_KEY` | Dự phòng khi Claude API hết credit / 5xx |
| `APP_BASE_URL` | `https://<subdomain>.<tên-miền>` (link trong email và trang) |
| `SMTP_URL`, `SMTP_FROM` | Tuỳ chọn: email báo phụ huynh khi khoá PIN / cờ an toàn. Bỏ trống thì không gửi email; cờ và trạng thái khoá vẫn hiện ở `/parent` |

## 2. Chạy lần đầu

```powershell
pnpm prod:up                       # = docker compose -f docker-compose.yml --profile prod up -d --build
docker compose -f docker-compose.yml --profile prod run --rm admin node_modules/.bin/tsx --conditions=react-server scripts/create-first-admin.ts
docker compose -f docker-compose.yml --profile prod run --rm admin node_modules/.bin/tsx --conditions=react-server prisma/seed.ts
```

- `prod:up` chỉ dùng `docker-compose.yml`, **không** gộp `docker-compose.override.yml` (file dev mở cổng
  localhost cho Postgres/Redis/math-verifier). Ở prod không service dữ liệu nào publish cổng.
- Thứ tự tự động: `postgres`/`redis` healthy → `migrate` (`prisma migrate deploy` bằng `cu_owner`) xong →
  `app`, `admin`, `worker` (kết nối bằng `cu_app`) → `cloudflared` khi `app` healthy.
- Kiểm `docker compose -f docker-compose.yml --profile prod ps`: `cloudflared` phải `running`. Thiếu `CLOUDFLARE_TUNNEL_TOKEN` thì nó báo lỗi và khởi động lại liên tục (compose không chặn lúc đọc file để dev chạy được mà không cần token).
- Sau seed, kiểm mỗi skill số thập phân có ≥ 1 misconception và ≥ 1 tình huống đã duyệt (trang `/parent` › Duyệt).

### Giọng nói (stt-local, GPU)

Cần Docker Desktop + WSL2 có GPU NVIDIA (`docker run --rm --gpus all nvidia/cuda:12.6.0-base-ubuntu24.04 nvidia-smi` chạy được).

```powershell
docker compose -f docker-compose.yml build stt-local
docker compose -f docker-compose.yml --profile setup run --rm stt-models-download   # tải model một lần vào volume stt-models (cần internet)
docker compose -f docker-compose.yml up -d stt-local
```

- `stt-local` nằm trong mạng internal `stt` (không ra internet, `HF_HUB_OFFLINE=1`, volume model mount chỉ đọc); chỉ `app` gọi được qua `http://stt-local:8000`. Dev: publish `127.0.0.1:8002`, đặt `STT_LOCAL_URL=http://localhost:8002` trong `.env`.
- Model theo ngôn ngữ trong `config/models.yaml` (`stt.local_models`); đổi model thắng sau khi chạy `eval/stt-bench` trên giọng thật.
- Dự phòng cloud (`openai/gpt-transcribe`) chỉ chạy khi phụ huynh bật ở `/parent/settings` và cần `OPENROUTER_API_KEY`. TTS cũng dùng `OPENROUTER_API_KEY`.

## 3. Cloudflare (gói Free, làm tay trên dashboard)

1. **Tunnel**: Zero Trust › Networks › Tunnels › Create (Cloudflared). Public hostname `cu.<tên-miền>` →
   service `http://app:3000`. Không bật Cloudflare Access. Router không mở cổng nào.
2. **Bot Fight Mode**: Security › Bots › bật.
3. **WAF custom rules** (Security › WAF):
   - Managed Challenge khi `http.user_agent eq ""`.
   - Block khi `starts_with(http.request.uri.path, "/admin")`.
4. **Rate limiting rule**: `http.request.method eq "POST" and starts_with(http.request.uri.path, "/api/auth/")`,
   5 request / 10 giây / IP → Block 10 giây.
5. **Turnstile**: thêm site cho `cu.<tên-miền>`, chế độ Managed; điền site key/secret vào `.env`, build lại image.
6. **SSL/TLS**: Always Use HTTPS, HSTS bật, Minimum TLS 1.2.

Trong app vẫn có rate limit theo IP (`CF-Connecting-IP`) và theo tài khoản, khoá PIN, `robots.txt`
`Disallow: /` và header `X-Robots-Tag: noindex, nofollow` cho mọi response.

## 4. Quản trị qua Tailscale

- Admin console Tailscale: bật MagicDNS + HTTPS Certificates; tắt key expiry cho PC.
- Trên PC: `tailscale serve --bg --https=443 http://localhost:3001`
- Mở `https://<tên-pc>.<tailnet>.ts.net/admin` từ thiết bị trong tailnet.
- **Không** dùng `tailscale funnel`, không port forwarding. Container `admin` chỉ publish `127.0.0.1:3001`.
- Admin cũng là phụ huynh: dùng một tài khoản role `parent` riêng cho `/parent` (cổng công khai từ chối role admin).

## 5. Nghiệm thu sau khi deploy (SPEC §15.16)

- [ ] Tablet dùng 4G mở `https://cu.<tên-miền>/learn`, đăng nhập bằng tên đăng nhập + PIN.
- [ ] `https://cu.<tên-miền>/admin` bị chặn ở biên (WAF) — app cũng trả 404.
- [ ] Turnstile hiện trên `/login`, đăng nhập thật thành công.
- [ ] Gửi > 5 request đăng nhập trong 10 giây bị Cloudflare chặn.
- [ ] `https://cu.<tên-miền>/robots.txt` trả `Disallow: /`.
- [ ] `/admin` mở được qua `https://<tên-pc>.<tailnet>.ts.net`; máy khác trong LAN không gọi được cổng 3001.
- [ ] Tắt container `app` → PWA trên tablet hiện "Cú đang nghỉ" (service worker), không thấy lỗi.
- [ ] Volume prod mới: `pnpm prod:up` → migrate chạy xong trước, worker log `[worker] sẵn sàng`.

Đã kiểm trên máy dev (2026-10-19, không có tunnel): migrate chạy trước và thoát 0; worker sẵn sàng; admin
chỉ ở `127.0.0.1:3001` và đăng nhập được với Turnstile test key; container app trả 404 cho `/admin`,
`/admin/login`; `robots.txt` 200; mọi response có `X-Robots-Tag`.

## 6. Vận hành

- Cập nhật: `git pull` → `pnpm prod:up` (build lại image, migrate tự chạy).
- Log: `docker compose -f docker-compose.yml --profile prod logs -f app worker`.
- Backup không thuộc phạm vi dự án: chủ dự án tự backup ở mức PC (volume `pgdata`, `storage`, thư mục `data/`).
- Dừng: `pnpm prod:down`.
