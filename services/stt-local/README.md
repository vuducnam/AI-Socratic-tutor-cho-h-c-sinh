# stt-local

Nhận dạng giọng nói ngay trên PC tại nhà (SPEC §10, quy tắc cứng 10): PhoWhisper-large cho tiếng Việt,
whisper-large-v3-turbo cho tiếng Anh, fp16 trên GPU (CPU nếu không có GPU). Giọng của con không rời PC.

## API

- `POST /transcribe` (multipart): `audio` (webm/ogg/wav/mp4/m4a, ≤ 10 MB, ≤ 60 giây), `language` (`vi`|`en`),
  `model` tuỳ chọn (phải có trong danh sách của ngôn ngữ đó) → `{text, model, language, latency_ms}`.
  Lỗi trả `{"detail": "<mã>"}`: 400 `invalid_language` / `model_not_allowed` / `missing_audio` /
  `empty_audio` / `undecodable_audio`; 413 `audio_too_large` / `audio_too_long`; 415
  `unsupported_audio_format`; 503 `model_unavailable`; 500 `transcription_failed`.
- `GET /health` → `{status, models_loaded, models}` (chỉ tên model).

Audio chỉ nằm trong file tạm trên tmpfs `/tmp` trong lúc ffmpeg giải mã, bị xoá ngay sau đó (kể cả khi
lỗi). Log chỉ có model, ngôn ngữ, dung lượng, số giây, độ trễ, mã kết quả; không log audio hay chữ.

## Cấu hình (biến môi trường)

Xem đầu `app/settings.py`: `STT_MODELS_VI`, `STT_MODELS_EN` (model đầu là mặc định), `STT_PRELOAD`,
`STT_DEVICE`, `STT_MAX_BYTES`, `STT_MAX_SECONDS`, `STT_TMP_DIR`. Mặc định khớp `config/models.yaml` → `stt`.

## Chạy bằng Docker

```bash
docker compose build stt-local
docker compose run --rm stt-models-download     # một lần (và mỗi khi đổi danh sách model): tải vào volume stt-models
docker compose up -d stt-local                  # dev: http://localhost:8002
```

`stt-local` chạy trên mạng internal `stt` (không ra internet) với `HF_HUB_OFFLINE=1`; việc tải model dùng
service `stt-models-download` riêng trên mạng `egress`, chỉ tải file model công khai từ Hugging Face.

## Test (không cần GPU hay model)

```bash
cd services/stt-local
python -m venv venv
venv/Scripts/python -m pip install -e ".[test]"      # Linux/macOS: venv/bin/python
venv/Scripts/python -m pytest
```

Test giải mã thật cần `ffmpeg` trong PATH (tự bỏ qua nếu không có).
