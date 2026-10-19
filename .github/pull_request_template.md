## Thay đổi

<!-- Tóm tắt thay đổi và phase liên quan trong SPEC §15. -->

## Quy tắc cứng

- [ ] Không lộ đáp án; mọi tin nhắn gửi con đi qua Guard
- [ ] Bảng/cột mới có dữ liệu học sinh: đã cập nhật TransparencyRegistry, export và purge
- [ ] Mọi truy cập DB qua `src/server/dal`
- [ ] Không có secret, không có dữ liệu thật của con (fixture chỉ từ hồ sơ giả)

## Eval

Bắt buộc khi PR chạm `prompts/`, `src/lib/`, `src/server/domain/`, `src/server/llm/`, `config/`, `data/`, `eval/`:
chạy `pnpm eval:ci` trên PC, dán tóm tắt bên dưới rồi gắn nhãn `eval-passed`.

```
(dán tóm tắt eval:ci)
```
