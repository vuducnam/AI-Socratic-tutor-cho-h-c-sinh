# stt-bench

Đo WER (tỉ lệ lỗi theo từ) của `stt-local` trên giọng thật của các con, để chủ dự án chọn model trong
`config/models.yaml` → `stt.local_models` (SPEC §10). Script không tự chọn model thắng.

## Quyền riêng tư (quy tắc cứng 10)

- Ghi âm và câu tham chiếu để trong `storage/stt-bench/` (đã gitignore), không đưa vào repo.
- Script chỉ gọi `stt-local` trên chính máy này (`localhost`, `127.0.0.1`, `::1`, `stt-local`); URL khác
  bị từ chối. Không gọi model cloud, không tải audio đi nơi khác.
- Kết quả chỉ in ra màn hình. `--details` in thêm chữ nhận được từng file, cũng chỉ ra màn hình.

## Chuẩn bị dữ liệu

```
storage/stt-bench/
  vi/
    phan-so-01.wav      # hoặc .webm .ogg .mp4 .m4a
    phan-so-01.txt      # câu con nói, UTF-8, viết đúng như mong model ghi ra
  en/
    colors-01.m4a
    colors-01.txt
```

So sánh bỏ qua hoa/thường và dấu câu; số thập phân giữ nguyên một từ (`4,5`). Nếu con nói
"bốn phẩy năm" thì câu tham chiếu nên ghi đúng cách model sẽ ghi ra, nếu không WER sẽ tính lỗi oan.
Mỗi file tối đa 60 giây và 10 MB (giới hạn của `stt-local`).

## Chạy

Cần `stt-local` đang chạy và model đã tải (xem `services/stt-local/README.md`).

```bash
python eval/stt-bench/stt_bench.py                     # mọi model stt-local đã cấu hình, cả vi và en
python eval/stt-bench/stt_bench.py --languages vi --details
python eval/stt-bench/stt_bench.py --models vi=vinai/PhoWhisper-large,openai/whisper-large-v3-turbo
```

- `--url`: mặc định `STT_LOCAL_URL` hoặc `http://localhost:8002` (cổng dev trong `docker-compose.override.yml`).
- `--models`: chỉ nhận model có trong `STT_MODELS_VI` / `STT_MODELS_EN` của `stt-local`; muốn A/B thêm model
  thì thêm vào biến đó, tải model (`docker compose run --rm stt-models-download`) rồi khởi động lại `stt-local`.
- Mã thoát khác 0 khi có request lỗi hoặc không có mẫu nào.

Chỉ dùng thư viện chuẩn của Python. Test: `services/stt-local/venv/Scripts/python -m pytest eval/stt-bench`
(Windows) hoặc `services/stt-local/venv/bin/python -m pytest eval/stt-bench`.
