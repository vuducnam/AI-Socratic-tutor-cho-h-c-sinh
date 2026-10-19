# Hướng dẫn nhập dữ liệu chương trình lớp 5

Tài liệu này dành cho chủ dự án (người nhập dữ liệu) và cho Claude Code khi hỗ trợ nhập. Nó nói rõ phải điền gì, lấy ở đâu, điền thế nào và kiểm tra ra sao để Cú biết con đang học tới đâu trong sách và không vượt quá kiến thức trên lớp.

Liên quan: quy tắc cứng 6 và 15 trong `CLAUDE.md`; mục 5, 5c trong `docs/SPEC.md`.

---

## 1. Cần làm gì, theo thứ tự ưu tiên

| # | Việc | File | Bắt buộc ở giai đoạn 0? | Ai làm |
| --- | --- | --- | --- | --- |
| 1 | Lấy link bản đọc chính thống của Toán 5 Tập 1 và Tập 2 | `data/curriculum/math/grade5.yaml` → `books[].official_url` | Có | Chủ dự án |
| 2 | Nhập **toàn bộ mục lục** hai tập: chủ đề, số bài, tên bài, trang, thứ tự | `grade5.yaml` → `lessons[]` | Có | Chủ dự án (Claude chép từ ảnh, chủ dự án duyệt) |
| 3 | Viết skill cho chủ đề số thập phân và gắn vào bài | `data/skills/math/grade5.yaml` + `lessons[].skill_ids` | Có, chỉ chủ đề số thập phân | Claude nháp, chủ dự án duyệt |
| 4 | Ghi thuật ngữ mới và cách giải của từng bài trong chủ đề số thập phân **và các bài đứng trước nó** | `lessons[].introduces_terms`, `lessons[].methods` | Có, chỉ các bài đó | Chủ dự án đọc sách rồi ghi |
| 5 | Danh sách thuật ngữ, cách giải của lớp trên mà Cú không được dùng | `data/curriculum/math/beyond-grade5.yaml` | Nên có, tối thiểu vài mục | Chủ dự án (cần SGK lớp 6+) |
| 6 | Đặt tiến độ của con: "đã học đến bài …" | Trong app: `/admin` khi tạo hồ sơ, sau đó `/parent` → Tiến độ trên lớp | Có, trước phiên đầu tiên | Phụ huynh |
| 7 | Các môn khác của lớp 5 (Tiếng Việt, Khoa học, …) | `data/curriculum/<môn>/grade5.yaml` | Không — từ giai đoạn 2 | Như trên |

Vì sao việc 2 phải làm trọn hai tập dù giai đoạn 0 chỉ dạy số thập phân: tiến độ là một con trỏ trên **toàn bộ** thứ tự bài trong năm. Thiếu bài thì `seq` đứt quãng và con trỏ sai.

Vì sao việc 4 chỉ cần cho các bài tới hết chủ đề số thập phân: thuật ngữ của bài **sau** con trỏ là thứ Cú bị cấm dùng. Ở giai đoạn 0 con chỉ học số thập phân nên chỉ cần biết chính xác những gì con đã gặp tới đó. Các bài sau để trống vẫn được, nhưng khi đó code không chặn được thuật ngữ của chúng mà chỉ còn Guard (LLM) chặn. Mục 7 nói rõ hệ quả.

---

## 2. Nguồn hợp lệ

**Được dùng**: bản đọc SGK **Kết nối tri thức với cuộc sống** trên `taphuan.nxbgd.vn` (NXB Giáo dục Việt Nam). Đây là nguồn duy nhất theo quy tắc cứng 6.

**Không được dùng**, kể cả để "đối chiếu nhanh": hoatieu.vn, loigiaihay.com, thuvienhoclieu.com, vietjack, file PDF hoặc PowerPoint trôi nổi, bản chép tay của người khác, trí nhớ của bất kỳ model AI nào (kể cả Claude).

Sách in của con không được ghi là nguồn trừ khi quy tắc cứng 6 được sửa để cho phép. Nếu chụp từ sách in để tiết kiệm thời gian thì vẫn phải mở bản đọc trên taphuan để lấy `official_url` và so lại từng dòng.

**Không chép nội dung bài**: chỉ ghi tên bài, số trang và các danh sách ngắn (thuật ngữ, cách giải). Không chép định nghĩa, ví dụ hay bài tập của sách vào repo.

---

## 3. Bước 1 — Lấy link sách

1. Đăng nhập `taphuan.nxbgd.vn` bằng tài khoản của anh.
2. Mở bản đọc **Toán 5, Tập 1** (bộ Kết nối tri thức với cuộc sống).
3. Copy URL trên thanh địa chỉ khi đang ở trang đầu cuốn sách. Dán vào `books[0].official_url`.
4. Làm tương tự cho **Tập 2** → `books[1].official_url`.
5. Nếu bản đọc có URL riêng cho từng trang, ghi lại dạng URL đó vào ghi chú cuối file: sau này có thể đặt `source.official_url` của từng bài trỏ thẳng tới trang. Nếu không có thì mọi bài dùng URL của cuốn.

Em (Claude) không vào được trang này, nên không biết giao diện cụ thể của nó. Các bước trên chỉ là mô tả chung.

---

## 4. Bước 2 — Nhập mục lục

### 4.1 Cách làm nhanh nhất

1. Chụp màn hình **mọi trang mục lục** của Tập 1, rồi Tập 2, từ bản đọc trên taphuan. Chụp đủ nét, không cắt mép.
2. Gửi ảnh cho Claude hoặc Claude Code kèm câu lệnh ở mục 9.1.
3. Claude chép thành `lessons[]`. **Anh so từng dòng với ảnh**: số bài, tên bài, chủ đề, trang. Lỗi hay gặp là đọc nhầm số trang, gộp hai bài, bỏ sót bài "Luyện tập chung" hoặc "Ôn tập".
4. Điền `source.imported_at` = ngày anh duyệt xong.

### 4.2 Ý nghĩa từng trường

```yaml
lessons:
  - lesson_id: MATH5.T1.B12     # MATH5 . <tập: T1|T2> . B<số bài>
    seq: 12                     # thứ tự trong cả năm, liên tục từ 1, không trùng
    book: T1                    # id trong books[]
    topic: "<tên chủ đề, chép đúng mục lục>"
    lesson_no: 12               # số bài in trong sách
    title: "<tên bài, chép đúng mục lục>"
    skill_ids: []               # bước 3
    introduces_terms: []        # bước 4
    methods: []                 # bước 4
    source:
      official_url: "https://taphuan.nxbgd.vn/..."   # link cuốn, hoặc link trang nếu có
      pages: "45-47"            # trang bắt đầu - trang kết thúc
      imported_at: 2026-10-20
```

| Trường | Quy tắc | Nếu chưa chắc |
| --- | --- | --- |
| `lesson_id` | Ghép từ tập và số bài. Không đổi sau khi đã seed, vì tiến độ của con trỏ tới id này | Không được để trống |
| `seq` | Đúng thứ tự xuất hiện trong sách, Tập 1 trước Tập 2. Bài 1 của Tập 2 có `seq` tiếp nối bài cuối Tập 1 | Không được để trống |
| `topic` | Chép nguyên văn tên chủ đề in trong mục lục | Để `null`, ghi chú lại |
| `lesson_no` | Số bài in trong sách. Nếu sách đánh số liên tục qua hai tập thì giữ nguyên số đó | Không được để trống |
| `title` | Chép nguyên văn, giữ dấu, không viết tắt | Không được để trống |
| `source.pages` | Dạng `"45-47"`; một trang thì `"45"` | Để `null` |
| `source.official_url` | Bắt buộc. Thiếu thì seed từ chối bài đó | Bài đó chưa seed được |

Bài "Ôn tập", "Luyện tập chung", "Em vui học toán" hay bài kiểm tra **vẫn nhập** như một bài bình thường nếu mục lục có ghi, vì chúng chiếm một vị trí trong thứ tự. Bài ôn tập thường không có `introduces_terms`.

---

## 5. Bước 3 — Gắn skill (chỉ chủ đề số thập phân ở giai đoạn 0)

Skill là đơn vị kiến thức nhỏ mà Cú dạy và đo mastery (SPEC mục 5). Một bài có thể có nhiều skill; một skill có thể xuất hiện ở bài học mới và ở các bài luyện tập sau.

1. Sau khi mục lục chủ đề số thập phân đã duyệt, nhờ Claude Code nháp `data/skills/math/grade5.yaml` cho các bài đó (câu lệnh ở mục 9.2).
2. Mỗi skill có `source.lesson` trỏ tới **bài đầu tiên** dạy nó.
3. `lessons[].skill_ids` của một bài gồm skill bài đó dạy mới và skill bài đó luyện lại.
4. Anh duyệt: tên skill có đúng nội dung bài không, có skill nào bị gộp quá to hay tách quá vụn không.

Kiểm tra tự động khi seed: mọi skill có `grade_introduced: 5` phải nằm trong `skill_ids` của ít nhất một bài, và mọi `skill_ids` phải trỏ tới skill có thật.

---

## 6. Bước 4 — Thuật ngữ và cách giải của từng bài

Hai trường này quyết định Cú được và không được nói gì. Chỉ điền sau khi **đọc bài trong bản đọc chính thống**.

### 6.1 `introduces_terms` — thuật ngữ xuất hiện lần đầu ở bài này

Cách xác định: đọc phần bài học. Từ nào được sách **in đậm, đóng khung, giới thiệu "gọi là …"**, hoặc là ký hiệu mới, thì ghi vào. Chỉ ghi ở **bài đầu tiên** xuất hiện, không lặp ở bài sau.

```yaml
introduces_terms:
  - term: "<thuật ngữ đúng như sách in>"
    patterns: ["<cụm từ 1>", "<cách viết khác nếu có>"]
```

Quy tắc viết `patterns`:

- Mặc định ghi **cụm từ thường**, không cần biết regex. Code tự so khớp trên văn bản đã chuẩn hoá: Unicode NFC, chữ thường, gộp khoảng trắng, và chỉ khớp **nguyên từ** (không khớp "phân" bên trong "phân số" nếu pattern là "phân").
- Ghi thêm các cách viết khác của cùng thuật ngữ nếu sách hoặc trẻ hay dùng (viết tắt, có hoặc không có gạch nối).
- Chỉ khi thật cần mới dùng regex, viết với tiền tố `re:` (ví dụ `"re:hàng\\s+phần\\s+(mười|trăm|nghìn)"`).
- **Tránh từ quá chung**: một từ đơn hay dùng trong đời thường ("phần", "hàng", "dấu") sẽ chặn nhầm cả câu bình thường của Cú. Ghi cụm đủ dài để chỉ mang nghĩa toán học.
- Ký hiệu (ví dụ một dấu mới) ghi đúng ký tự Unicode trong `patterns`.

### 6.2 `methods` — cách giải sách dùng ở bài này

Ghi bằng lời ngắn, theo cách sách trình bày, mỗi cách một dòng. Mục đích: Pre-solver chỉ được giải theo các cách đã xuất hiện ở bài con đã học, để con không học một cách khác cô dạy.

```yaml
methods:
  - "<mô tả ngắn cách sách làm, ví dụ: so sánh phần nguyên trước, rồi lần lượt từng hàng ở phần thập phân>"
```

Ví dụ trong khối trên chỉ minh hoạ cách viết. Phải đối chiếu bài thật trước khi ghi.

### 6.3 Nếu không chắc

Để `[]` và ghi một dòng `# TODO: chưa đọc bài` phía trên. Không đoán. Không nhờ model tự điền từ trí nhớ.

---

## 7. Bước 5 — Danh sách thuật ngữ lớp trên (`beyond-grade5.yaml`)

Đây là những thứ con **chưa học ở bất kỳ bài nào của lớp 5** nhưng Cú (một model biết cả toán đại học) rất dễ buột miệng dùng.

```yaml
items:
  - term: "<thuật ngữ>"
    patterns: ["<cụm từ>"]
    introduced_grade: 6
    note: "<vì sao cấm; ở lớp 5 sách dùng cách nào thay thế>"
    source: { book: "Toán 6, Tập 1", lesson: "Bài …", official_url: "https://taphuan.nxbgd.vn/..." }
```

Hướng nên rà, **phải tìm đúng bài ở SGK lớp trên trước khi ghi**:

- Số âm, số nguyên âm.
- Lập phương trình, ẩn số, để giải bài toán có lời văn.
- Các ký hiệu, khái niệm khác mà anh thấy Cú dùng khi chạy thử (xem mục 8.3).

Nếu file này rỗng: code không chặn thuật ngữ lớp trên, chỉ Guard rule SCOPE chặn (một LLM, có thể sót). Eval vẫn đo bằng judge với ngưỡng ≥ 98%. Mỗi lần judge hoặc anh bắt được Cú dùng thuật ngữ lớp trên, thêm thuật ngữ đó vào file này. Danh sách sẽ lớn dần theo dữ liệu thật.

---

## 8. Bước 6 — Kiểm tra

### 8.1 Tự động (`pnpm db:seed`, `pnpm test`)

Seed **từ chối** và in lỗi rõ ràng khi:

- Bài thiếu `source.official_url`.
- `seq` trùng hoặc đứt quãng (ví dụ có 1, 2, 4).
- `lesson_id` trùng.
- `skill_ids` trỏ tới skill không tồn tại.
- `book` không có trong `books[]`.
- Một `patterns` regex (`re:`) không biên dịch được.

Test fail khi: skill lớp 5 không thuộc bài nào.

### 8.2 Bằng mắt (anh làm, khoảng 15 phút mỗi tập)

- [ ] Số bài trong file bằng số bài trong mục lục của từng tập.
- [ ] Bài cuối Tập 1 và bài đầu Tập 2 có `seq` liên tiếp.
- [ ] Tên bài, chủ đề khớp ảnh mục lục từng chữ.
- [ ] Mọi bài trong chủ đề số thập phân và trước nó: đã đọc bài, `introduces_terms` và `methods` đã điền hoặc có `# TODO` lý do.
- [ ] Không pattern nào là một từ đơn đời thường.
- [ ] `imported_at` là ngày duyệt.

### 8.3 Chạy thử

1. Đặt tiến độ của một học sinh thử tới **bài ngay trước** chủ đề số thập phân. Mở phiên, hỏi Cú về số thập phân → Cú phải không giảng và tạo cờ `beyond_scope_curiosity`. Bộ chọn bài không được sinh bài số thập phân.
2. Đặt tiến độ tới **giữa** chủ đề số thập phân. Hỏi về bài kế tiếp → Cú không dùng thuật ngữ của bài đó.
3. Xem `/parent` → phiên vừa chạy → `scope_snapshot`: danh sách được dùng và bị chặn có đúng như anh nghĩ không.

---

## 9. Câu lệnh mẫu cho Claude / Claude Code

### 9.1 Chép mục lục từ ảnh

```text
Đây là ảnh chụp mục lục Toán 5 Tập <1|2>, bộ Kết nối tri thức với cuộc sống, từ bản đọc
taphuan.nxbgd.vn. Link cuốn: <URL>.
Chép thành lessons[] trong data/curriculum/math/grade5.yaml đúng theo docs/CURRICULUM.md mục 4.2.
- Chép nguyên văn chủ đề và tên bài, giữ dấu.
- seq tiếp nối bài cuối hiện có trong file.
- Để trống skill_ids, introduces_terms, methods.
- Chữ nào trong ảnh không đọc rõ: ghi [?] và liệt kê ở cuối câu trả lời, không đoán.
- Cuối cùng in bảng: số bài đã chép theo từng chủ đề, để tôi so với ảnh.
```

### 9.2 Nháp skill cho một chủ đề

```text
Đọc data/curriculum/math/grade5.yaml, các bài thuộc chủ đề "<tên chủ đề>".
Nháp skill cho data/skills/math/grade5.yaml theo SPEC mục 5: mỗi skill đủ nhỏ để dạy trong một phiên,
có prerequisites, source.lesson trỏ tới bài đầu tiên dạy nó.
Chỉ dựa trên tên bài trong mục lục; không bịa nội dung bài. Chưa có misconceptions.
Sau đó điền lessons[].skill_ids tương ứng và chạy pnpm db:seed để kiểm tra.
```

### 9.3 Sau khi anh đã đọc một bài và ghi chú thuật ngữ

```text
Bài <lesson_id>: tôi đã đọc bài trên taphuan. Thuật ngữ mới: <danh sách>. Cách giải sách dùng: <mô tả>.
Điền introduces_terms (kèm patterns theo docs/CURRICULUM.md mục 6.1) và methods cho bài này.
Báo lại pattern nào có nguy cơ khớp nhầm câu bình thường.
```

---

## 10. Sau khi đã có dữ liệu: cập nhật tiến độ của con

Tiến độ là một con trỏ "trên lớp con đã học đến bài X" cho mỗi môn. Lớp học đúng thứ tự sách nên mọi bài từ đầu sách tới X tính là đã học.

| Khi nào | Làm gì |
| --- | --- |
| Tạo hồ sơ con lần đầu | `/admin`: chọn bài đã học tới cho Toán. Chưa chọn thì con không mở được phiên Toán |
| Mỗi tuần, hoặc khi cô chuyển bài | `/parent` → Tiến độ trên lớp → dời con trỏ |
| App hiện gợi ý "Bài về nhà hôm nay thuộc Bài X — cập nhật?" | Bấm đồng ý nếu đúng là trên lớp đã học tới đó; bấm không nếu bài về nhà là bài cô giao học trước hoặc bài lấy từ sách khác |
| App nhắc "Tiến độ chưa cập nhật 14 ngày" | Kiểm tra vở của con và dời con trỏ. Nghỉ hè thì tắt nhắc trong cấu hình |
| Muốn cho con học trước một bài | `/parent` → cho học trước bài đó. Khi con trỏ vượt qua bài đó, nó tự bỏ khỏi danh sách học trước |
| Con lên lớp 6 | Mọi bài lớp 5 tự tính là đã học. Đặt lại con trỏ cho lớp 6 (cần dữ liệu `grade6.yaml` trước) |

Quên cập nhật thì Cú dạy hẹp hơn thực tế (an toàn), không bao giờ vượt quá bài đã học.

---

## 11. Các môn khác của lớp 5 (từ giai đoạn 2)

Cùng cấu trúc: `data/curriculum/<subject>/grade5.yaml` (ví dụ `vietnamese`, `science`). Với môn chế độ argue (Tiếng Việt đọc hiểu, Đạo đức), `methods` thường không cần; `introduces_terms` vẫn cần cho thuật ngữ ngữ pháp, khoa học. Mỗi môn có tiến độ riêng.
