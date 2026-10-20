# CLAUDE.md — Cú: AI Socratic Tutor (dự án cá nhân)

Gia sư AI theo phương pháp Socratic cho con trong gia đình, bắt đầu từ lớp 5 (sách **Kết nối tri thức với cuộc sống**) và dùng lâu dài lên THCS, THPT. Giao diện là **một luồng chat**, nhập bằng **giọng nói hoặc text**, kèm chụp ảnh đề.

Tên hiển thị của bạn học với con là **Mít** (linh vật vẫn là cú mèo); "Cú" là tên dự án trong tài liệu và code. Mít tự xưng "Mít", gọi con là "bạn" hoặc tên (không gọi "con", "em").

Đặc tả đầy đủ: `docs/SPEC.md`. Đọc SPEC trước khi làm bất kỳ module nào. Khi CLAUDE.md và SPEC mâu thuẫn, **quy tắc cứng bên dưới thắng**, sau đó đến SPEC.

---

## Quy tắc cứng (không được vi phạm, không có ngoại lệ)

1. **Không bao giờ lộ đáp án bài gốc.** Tutor không nói đáp án cuối hay làm hộ một bước con chưa tự làm. Mọi tin nhắn gửi con phải qua Guard. Leak rate trên eval phải = 0% thì mới được merge.
2. **Minh bạch 100% cho phụ huynh.** Không tồn tại dữ liệu nào về học sinh mà phụ huynh không xem được, không có kết luận nào không truy được về bằng chứng gốc. Mọi bảng mới phải được đăng ký trong `TransparencyRegistry` (parent view + export). CI fail nếu thiếu.
3. **Log bất biến.** `turns`, `llm_calls`, `guard_verdicts`, `mastery_events`, `label_corrections`, `access_log` là append-only (trigger Postgres chặn UPDATE/DELETE). Chỉ thủ tục `purge_student(student_id)` do phụ huynh kích hoạt mới được xoá.
4. **Số liệu do code tính, không do LLM.** Mọi con số trong báo cáo tính từ DB. LLM chỉ viết diễn giải; mỗi nhận định phải kèm `evidence_session_ids` / `evidence_turn_ids` hợp lệ, nhận định không có bằng chứng thì bị loại trước khi hiển thị.
5. **Báo cáo hai chiều.** Báo cáo tuần bắt buộc có mục "Điều chưa tốt". Nếu rỗng phải ghi rõ đã kiểm tra những gì.
6. **Chỉ nguồn SGK chính thống.** Nguồn duy nhất: SGK Kết nối tri thức với cuộc sống, bản đọc tại `taphuan.nxbgd.vn` (NXB Giáo dục Việt Nam). Mỗi `skill` bắt buộc có `source` (bộ sách, tập, bài, trang, official_url, imported_at). Không nạp nguyên văn sách vào hệ thống, không dùng PDF từ trang bên thứ ba.
7. **State machine do code quyết định.** LLM chỉ đề xuất `student_state_guess`; chuyển trạng thái là rule trong code, có unit test.
8. **Minh bạch với con.** UI chat luôn hiển thị "Bố mẹ xem được cuộc trò chuyện này". Cú không bao giờ hứa giữ bí mật với bố mẹ.
9. **Không suy diễn từ giới tính.** Giới tính chỉ dùng cho xưng hô, ngữ pháp, nhân vật trong đề, nội dung dậy thì (Khoa học 5). Không dùng để đoán sở thích, năng lực, độ khó.
10. **Tối thiểu dữ liệu gửi ra ngoài.** Prompt chỉ chứa tên gọi, lớp, sở thích đã khai, learner summary rút gọn. Audio giọng nói không rời PC tại nhà (STT local) và bị xoá ngay sau STT; chỉ gửi audio ra OpenRouter khi STT local lỗi và phụ huynh đã bật dự phòng. Không gửi tên trường, địa chỉ, ảnh mặt.
11. **Không đăng ký công khai; giới hạn truy cập duy nhất là `/admin` qua Tailscale.**
    - Không có trang hay API đăng ký, không có link mời hay bước kích hoạt. **Chỉ admin** tạo tài khoản phụ huynh (email + mật khẩu ban đầu), hồ sơ học sinh (tên đăng nhập + PIN) và liên kết phụ huynh–học sinh; tạo xong là dùng được.
    - App (`/learn`, `/parent`, `/login`, API) mở trên internet qua Cloudflare Tunnel, không có allowlist hay lớp chặn nào khác; bảo vệ bằng đăng nhập của app. Router không mở cổng (tunnel kết nối từ trong ra).
    - **`/admin` chỉ chạy ở container `admin` riêng** (cùng image với `app`, biến môi trường `ADMIN_ENABLED=true`), publish duy nhất `127.0.0.1:3001` và chỉ được Tailscale Serve trỏ tới. Container `app` công khai có `ADMIN_ENABLED=false` nên middleware trả 404 cho mọi đường dẫn `/admin`. Không dùng `tailscale funnel`, không port forwarding.
    - Mọi route trên cổng công khai đều yêu cầu session, trừ `/api/health` (không trả dữ liệu) và `/login`.
    - **Chống bot trên domain công khai là bắt buộc**: Cloudflare Bot Fight Mode bật; **Cloudflare Turnstile** trên mọi form đăng nhập (phụ huynh và học sinh), server xác minh token qua `siteverify` **trước** khi kiểm tra mật khẩu/PIN, token không hợp lệ → từ chối, không tính vào số lần sai; rate limiting rule ở biên cho các route đăng nhập; site không được index (`robots.txt` chặn tất cả + header `X-Robots-Tag: noindex`).
12. **Mọi truy cập DB đi qua `src/server/dal`.** Không import Prisma client ở bất kỳ đâu khác — kể cả Server Components, Server Actions, route handlers, worker. DAL là nơi duy nhất ghi `access_log` và áp `TransparencyRegistry`. ESLint chặn vi phạm.
13. **Học từ đời sống — nguyên tắc sản phẩm quan trọng nhất.** Mọi phiên mở bằng một câu tình huống đời thật và khép bằng câu hỏi chuyển giao ("con sẽ gặp lại điều này ở đâu?"). Mọi bài do Cú tạo (bài luyện, bài ôn, bài tương tự bậc 4) phải là tình huống thật, lấy từ thư viện `life_contexts` đã được phụ huynh duyệt — không bao giờ là bài tập trơn kiểu sách bài tập. **Bài về nhà giữ nguyên đề và số liệu**, chỉ thêm câu mở/khép. Nhiệm vụ đời thật không bao giờ yêu cầu con ra đường một mình, dùng bếp, dao, điện hay việc nguy hiểm; không dùng tên nhãn hàng thật.
14. **Phân quyền và cô lập dữ liệu.** Ba vai trò: `admin`, `parent`, `student`. Phụ huynh chỉ thấy học sinh được liên kết với mình (thấy 100%, theo quy tắc 2); học sinh chỉ thấy dữ liệu của chính mình. Admin xem dữ liệu của một học sinh không liên kết với mình thì phải ghi `access_log` kèm lý do, và phụ huynh của học sinh đó thấy được dòng log này. Mọi thao tác quản trị (tạo, khoá, liên kết, reset PIN) ghi `access_log`. Có test phân quyền: phụ huynh A không đọc được học sinh của phụ huynh B ở bất kỳ route, Server Action hay export nào.
15. **Không vượt phạm vi con đã học trên lớp.** Phạm vi do code tính (`computeScope`) từ mục lục SGK chính thống (`data/curriculum`) và tiến độ trên lớp do phụ huynh đặt; LLM không tự đoán con đã học tới đâu. Pre-solver chỉ được dùng skill và cách giải trong phạm vi; tin nhắn của Cú không chứa thuật ngữ, ký hiệu hay cách giải chưa học (code chặn theo danh sách, Guard rule SCOPE). Chưa đặt tiến độ cho môn thì không mở phiên môn đó. Lớp học theo đúng thứ tự SGK, nên tiến độ là một con trỏ "đã học đến bài X" cho mỗi môn. Chỉ phụ huynh mới đổi tiến độ (dời con trỏ hoặc cho học trước một bài). Bài về nhà vượt tiến độ nhưng cùng lớp được dạy với phạm vi mở thêm cho riêng bài đó và tạo gợi ý cập nhật cho phụ huynh, không tự cập nhật tiến độ; bài thuộc lớp trên thì không dạy. Con hỏi điều chưa học thì Cú không giảng, chỉ ghi cờ cho phụ huynh.

## Stack

| Vai trò | Lựa chọn |
| --- | --- |
| App full-stack (học sinh + phụ huynh + API) | **Next.js** (App Router, TypeScript strict), PWA, ưu tiên tablet; tự host bằng `next start` (`output: 'standalone'`) |
| DB | **PostgreSQL 16 + Prisma** (migration có SQL thuần cho trigger append-only và `purge_student()`) |
| Job nền | BullMQ + Redis, chạy trong **process `worker` riêng** cùng codebase (không chạy job trong route handler) |
| Math verifier | Python FastAPI sidecar + sympy (`services/math-verifier`) |
| STT | **Local**: PhoWhisper-large trên GPU (`services/stt-local`) — giọng con không rời PC. Dự phòng/A-B: OpenRouter `/audio/transcriptions` |
| LLM chính | Claude API trực tiếp (`@anthropic-ai/sdk`) — dùng credit Max 20x |
| LLM dự phòng | Claude qua OpenRouter khi Claude API trả lỗi hết credit / 5xx |
| TTS, sinh ảnh | OpenRouter (`/audio/speech`, `/images`) — đầu vào là lời của Cú, không phải dữ liệu của con |
| Hạ tầng | PC tại nhà: Windows + Docker Desktop (WSL2) + NVIDIA GPU |
| Truy cập | App công khai qua Cloudflare Tunnel (`cloudflared` container, HTTPS, không mở cổng router). `/admin` chỉ qua Tailscale Serve → cổng admin `3001` trên localhost |
| Chống bot | Cloudflare Bot Fight Mode + Turnstile trên `/login` + WAF custom rules + rate limiting rule (gói Free) |
| Xác thực trong app | Không có đăng ký, không kích hoạt; admin tạo tài khoản dùng được ngay; email + mật khẩu (argon2id) cho admin/phụ huynh, TOTP tuỳ chọn (khuyến nghị bật); tên đăng nhập + PIN 6 số cho học sinh |

### Model theo vai trò (cấu hình trong `config/models.yaml`, không hard-code)

| Vai trò | Model |
| --- | --- |
| Tutor | `claude-sonnet-5-5` |
| Guard, learner summary | `claude-haiku-5-5` |
| Pre-solver | `claude-opus-5-5` + sympy verify |
| Đọc ảnh đề (vision) | `claude-sonnet-5-5` |
| Việc offline không tương tác (nháp misconception, báo cáo tuần) | Message Batches API |
| Eval hội thoại nhiều lượt | API đồng bộ, API key và trần chi phí riêng, không fallback OpenRouter |
| STT | Chính: `vinai/PhoWhisper-large` local (GPU). A/B và dự phòng: OpenRouter `openai/gpt-4o-transcribe` (hoặc GPT Transcribe), `mistralai/voxtral-mini-transcribe` — **kiểm lại slug trên OpenRouter trước khi dùng**. Model thắng do WER đo trên giọng thật của các con |
| TTS | `google/gemini-3.8-flash-tts` qua OpenRouter, `response_format: mp3` |
| Sinh ảnh | `openai/gpt-image-2` qua OpenRouter — chỉ cho avatar và minh hoạ ngữ cảnh. **Hình toán học vẽ bằng SVG từ code**, không dùng image gen |

## Cấu trúc repo

```
src/
  app/
    (learn)/learn/          # học sinh: luồng chat
    (parent)/parent/        # phụ huynh: báo cáo, transcript gốc, raw LLM calls, export, xoá
    (admin)/admin/          # admin: tạo/khoá phụ huynh, học sinh, liên kết, reset mật khẩu/PIN — chỉ chạy khi ADMIN_ENABLED=true
    login/                  # đăng nhập phụ huynh/admin (không có trang đăng ký)
    api/                    # route handlers mỏng: chat (SSE), stt, upload ảnh, export, health
  server/                   # server-only (import 'server-only' ở mọi file)
    dal/                    # NƠI DUY NHẤT dùng Prisma; ghi access_log; áp TransparencyRegistry
    domain/                 # logic thuần, test không cần Next.js: state-machine, guard-pipeline,
                            # presolve, curriculum-scope, metrics, report-builder, scaffold, signals
    llm/                    # LlmGateway (Claude API → fallback OpenRouter), ghi llm_calls
    voice/                  # client stt-local, TTS + cache
    transparency/           # registry, export zip, purge
    jobs/                   # định nghĩa queue + enqueue (không xử lý job ở đây)
    auth/                   # session phụ huynh / học sinh (PIN)
  lib/                      # dùng cả client & server: types, zod schemas, vi-math-normalizer
  components/
    chat/
    math-visuals/           # SVG có tham số: sơ đồ đoạn thẳng, hình chia phần, trục số
worker/
  index.ts                  # process BullMQ: learner updater, báo cáo, sinh ảnh
prisma/
  schema.prisma
  migrations/               # gồm SQL trigger append-only + purge_student()
prompts/                    # template có version + few-shot golden set
eval/                       # simulated students, LLM-judge, stt-bench, golden
services/
  math-verifier/            # FastAPI + sympy
  stt-local/                # FastAPI + PhoWhisper-large, GPU
config/
  models.yaml
  presets/                  # grade5.yaml, grade6-7.yaml, grade8-9.yaml, grade10-12.yaml
data/
  skills/                   # skill graph YAML theo môn/lớp (có source bắt buộc)
  life-contexts/            # thư viện tình huống đời thật theo skill (seed, chờ phụ huynh duyệt)
  curriculum/               # mục lục SGK theo đúng thứ tự (bài → skill, thuật ngữ, cách giải) + danh sách thuật ngữ lớp trên
docs/
  SPEC.md
  CURRICULUM.md             # hướng dẫn nhập mục lục, thuật ngữ, cách giải và cập nhật tiến độ
docker-compose.yml          # app, admin (127.0.0.1:3001), worker, postgres, redis, math-verifier, stt-local, cloudflared
```

## Lệnh

```bash
pnpm install
docker compose up -d postgres redis math-verifier stt-local   # stt-local cần GPU
pnpm db:migrate          # prisma migrate deploy (kèm SQL triggers)
pnpm db:seed             # skill graph + mục lục lớp 5 từ data/skills, data/curriculum
pnpm dev                 # next dev
pnpm worker:dev          # BullMQ worker (tsx watch worker/index.ts)
pnpm test                # vitest: domain, DAL, transparency registry, append-only
pnpm lint                # gồm rule cấm import Prisma ngoài src/server/dal
pnpm eval                # simulated students, in leak rate + metrics
pnpm eval:ci             # fail nếu leak > 0 hoặc metric dưới ngưỡng
pnpm eval:smoke          # 5 đề × 8 persona, ~3 USD; lọc: --personas=a,b --problems=DEC5-01
pnpm eval:replay         # gửi lại yêu cầu tutor đã ghi với prompt mới, ~0,3 USD (--from=tutor/vN --limit=30)
pnpm prod:up             # chạy thật trên PC (chỉ docker-compose.yml, không gộp override dev) — xem docs/deployment-guide.md
```

## Quy ước Next.js

- `src/server/**` có `import 'server-only'`. Client Component không bao giờ import từ `src/server`.
- ESLint `no-restricted-imports`: `@prisma/client` và `@/server/dal/client` chỉ được import trong `src/server/dal/**`.
- Server Components và Server Actions được dùng cho `/parent`, nhưng **chỉ gọi hàm DAL**, không truy vấn trực tiếp.
- Route chat: `export const runtime = 'nodejs'`, `export const dynamic = 'force-dynamic'`; stream SSE bằng `ReadableStream`. Không dùng Edge runtime ở bất kỳ đâu.
- Route handler chỉ: xác thực → validate input (zod) → gọi `src/server/domain` → trả kết quả. Không đặt logic nghiệp vụ trong route handler.
- Không dùng cache mặc định của Next cho dữ liệu học sinh: các trang `/parent` và API dữ liệu đặt `dynamic = 'force-dynamic'` / `cache: 'no-store'`.
- Middleware: `/admin/**` trả 404 nếu `ADMIN_ENABLED !== 'true'`, và yêu cầu session admin; `/parent/**` yêu cầu session phụ huynh (hoặc admin); `/learn/**` yêu cầu session học sinh; học sinh không vào được `/parent` hay `/admin`.
- Không tồn tại route `/register`, `/signup` hay API tạo tài khoản ngoài `/admin`. Có test khẳng định điều này.
- Mọi hàm DAL nhận `actor` và kiểm tra quyền theo liên kết phụ huynh–học sinh trước khi đọc/ghi.

## Quy ước code chung

- TypeScript strict, không `any`. Zod validate mọi output JSON từ LLM; parse fail → retry 1 lần → fallback câu hỏi dự phòng từ solution plan.
- Mọi lượt gọi model đi qua `LlmGateway`: ghi `llm_calls` đầy đủ request/response, prompt_version, tokens, cost, latency **trước khi** trả kết quả.
- Prompt nằm trong `prompts/`, có version; không viết prompt inline.
- Tin nhắn của Cú tới con: tối đa 2 câu, 35 từ, đúng 1 câu hỏi (lớp 5). Guard kiểm, code cũng kiểm độ dài trước khi gọi Guard. Riêng đề bài tình huống do Cú tạo: tối đa 3 câu, kèm SVG khi giúp hình dung.
- Bài tình huống do Cú tạo đi qua đúng pipeline như mọi bài: Pre-solver + sympy verify, skill có `source` SGK, Guard. Ngữ cảnh đời thật không được mở rộng phạm vi kiến thức ra ngoài skill đang học.
- Phạm vi kiến thức (`sessions.scope_snapshot`) tính một lần khi mở phiên và cố định trong phiên; Pre-solver, Tutor, Guard, hook, contextualize và bộ chọn bài đều nhận cùng snapshot. Ngoại lệ duy nhất là phần mở thêm cho riêng một bài về nhà (`solution_plans.scope_extension`). Tiến độ phụ huynh đổi giữa chừng áp dụng từ phiên sau.
- Số trong text gửi TTS phải qua `vi-math-normalizer.toSpoken()` (0,45 → "không phẩy bốn mươi lăm").
- Dấu thập phân tiếng Việt là dấu phẩy. Không để `0.45` lọt ra UI học sinh.
- Tiếng Việt cho UI và nội dung; tên biến, hàm, bảng bằng tiếng Anh.
- Mỗi PR thêm bảng/trường dữ liệu về học sinh phải cập nhật `TransparencyRegistry` và export.

## Triển khai (PC tại nhà)

- Máy: Windows, RAM 64GB, SSD 1TB, RTX 4060 Ti 16GB VRAM. Docker Desktop trên WSL2, GPU cho container `stt-local`.
- `.wslconfig`: giới hạn WSL2 khoảng 24GB RAM.
- HTTPS bắt buộc (trình duyệt chỉ cho dùng micro trên HTTPS).
- **Công khai**: container `cloudflared` tạo Cloudflare Tunnel tới `http://app:3000` (mạng Docker nội bộ). Không Cloudflare Access, không allowlist. Router không mở cổng nào. Container `app` không publish cổng ra máy host ở môi trường prod.
- **Admin**: container `admin` (cùng image, `ADMIN_ENABLED=true`) publish `127.0.0.1:3001`; trên PC chạy `tailscale serve --bg --https=443 http://localhost:3001`. Admin mở `https://<tên-pc>.<tailnet>.ts.net/admin`.
- **Chống bot (Cloudflare, gói Free)**: bật Bot Fight Mode; WAF custom rule challenge request không có User-Agent và block `/admin*` ở biên (dự phòng cho 404 của app); rate limiting rule cho `POST /api/auth/*`; Turnstile ở chế độ Managed trên `/login` (secret trong `.env`, không commit).
- Vì app mở công khai, đăng nhập phải chống dò: rate limit theo IP và theo tài khoản, khoá học sinh sau 10 lần sai PIN liên tiếp cho tới khi phụ huynh mở khoá (báo phụ huynh ngay), tên đăng nhập học sinh do admin đặt và không trùng tên gọi.
- Cookie `Secure`, `HttpOnly`, `SameSite=Strict`. Rate limit đăng nhập và PIN.
- Backup không thuộc phạm vi dự án (chủ dự án tự làm ở mức PC); code không có job hay lệnh backup.
- PC tắt hoặc app không phản hồi → PWA hiện "Cú đang nghỉ", không hiện lỗi kỹ thuật.
- OS phải còn nhận bản vá bảo mật (Windows 11, hoặc Windows 10 đã đăng ký ESU) trước khi lưu dữ liệu thật của con.

## Khi không chắc

- Không bịa số bài, trang SGK. Thiếu `source` thì dừng và báo.
- Không tự điền `introduces_terms`, `methods` của bài học hay danh sách thuật ngữ lớp trên từ trí nhớ của model: chỉ ghi khi đã đối chiếu bản SGK chính thống; chưa đối chiếu thì để trống và báo. Quy trình nhập theo `docs/CURRICULUM.md`.
- Không tự chọn model STT "tốt nhất" — giữ A/B qua cấu hình, kết quả do benchmark trên giọng thật quyết định.
- Thay đổi chạm tới quy tắc cứng → dừng và hỏi.
