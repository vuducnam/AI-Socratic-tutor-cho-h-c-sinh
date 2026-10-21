"""stt-local: nhận dạng giọng nói ngay trên PC tại nhà (SPEC §10, quy tắc cứng 10).

API:
- `GET /health` → `{status, models_loaded, models}` (chỉ tên model, không có dữ liệu của con).
- `POST /transcribe` multipart: `audio` (webm/ogg/wav/mp4/m4a), `language` (vi|en), `model` tuỳ chọn
  (phải nằm trong danh sách đã cấu hình cho ngôn ngữ đó) → `{text, model, language, latency_ms}`.

Mã lỗi (`{"detail": "<code>"}`): 400 thiếu/sai trường hoặc audio không giải mã được; 413 quá dung lượng
hoặc quá số giây; 415 định dạng không hỗ trợ; 503 model không nạp được; 500 lỗi khi suy luận.

Quy tắc 10: audio chỉ nằm trong file tạm suốt thời gian giải mã và bị xoá trong `finally` (container
đặt /tmp là tmpfs nên không chạm đĩa). Không log audio hay transcript: log chỉ có model, ngôn ngữ,
dung lượng, số giây, độ trễ, mã kết quả.
"""

import contextlib
import logging
import os
import tempfile
import time
from collections.abc import AsyncIterator, Callable
from typing import Any

import numpy as np
from fastapi import FastAPI, File, Form, Request, UploadFile
from fastapi.responses import JSONResponse

from app.audio_decode import (
    SAMPLE_RATE,
    AudioDecodeError,
    AudioFormat,
    AudioTooLongError,
    decode_with_ffmpeg,
    detect_format,
)
from app.settings import LANGUAGES, Settings, load_settings
from app.speech_engine import ModelUnavailableError, SpeechEngine, TranscriberLoader

AudioDecoder = Callable[[str, AudioFormat, int], np.ndarray]

# Phần đầu/ranh giới multipart và các trường chữ nằm ngoài giới hạn dung lượng audio.
MULTIPART_OVERHEAD_BYTES = 64 * 1024
COPY_CHUNK_BYTES = 256 * 1024

logger = logging.getLogger("stt_local")


class RequestRejected(Exception):
    def __init__(self, status_code: int, code: str) -> None:
        super().__init__(code)
        self.status_code = status_code
        self.code = code


def _error(status_code: int, code: str) -> JSONResponse:
    return JSONResponse({"detail": code}, status_code=status_code)


def _copy_upload_to_temp(upload: UploadFile, audio_format: AudioFormat, settings: Settings) -> str:
    """Chép audio sang file tạm có đuôi đúng định dạng; quá `max_bytes` → 413 (file tạm bị xoá ngay)."""
    descriptor, path = tempfile.mkstemp(prefix="stt-", suffix=audio_format.suffix, dir=settings.tmp_dir)
    try:
        written = 0
        with os.fdopen(descriptor, "wb") as target:
            while chunk := upload.file.read(COPY_CHUNK_BYTES):
                written += len(chunk)
                if written > settings.max_bytes:
                    raise RequestRejected(413, "audio_too_large")
                target.write(chunk)
        if written == 0:
            raise RequestRejected(400, "empty_audio")
    except BaseException:
        _remove_quietly(path)
        raise
    return path


def _remove_quietly(path: str | None) -> None:
    if path is not None:
        with contextlib.suppress(FileNotFoundError):
            os.remove(path)


def create_app(
    settings: Settings | None = None,
    loader: TranscriberLoader | None = None,
    decoder: AudioDecoder = decode_with_ffmpeg,
) -> FastAPI:
    """Factory cho uvicorn (`--factory`). Test truyền `loader`/`decoder` giả, không cần GPU hay model."""
    config = settings if settings is not None else load_settings()
    if loader is None:
        from app.hf_pipeline import make_hf_loader

        loader = make_hf_loader(config.device)
    engine = SpeechEngine(loader)

    @contextlib.asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        engine.preload(config.preload)
        logger.info("stt-local sẵn sàng, model đã nạp: %s", ", ".join(engine.loaded_models()) or "(chưa có)")
        yield

    app = FastAPI(title="stt-local", docs_url=None, redoc_url=None, openapi_url=None, lifespan=lifespan)
    app.state.engine = engine

    @app.middleware("http")
    async def limit_body_size(request: Request, call_next):  # type: ignore[no-untyped-def]
        declared = request.headers.get("content-length")
        limit = config.max_bytes + MULTIPART_OVERHEAD_BYTES
        if declared is not None and (not declared.isdigit() or int(declared) > limit):
            return _error(413, "audio_too_large")
        return await call_next(request)

    @app.get("/health")
    def health() -> dict[str, Any]:
        return {
            "status": "ok",
            "models_loaded": engine.loaded_models(),
            "models": {language: list(config.models_by_language[language]) for language in LANGUAGES},
        }

    @app.post("/transcribe")
    def transcribe(
        audio: UploadFile | None = File(None),
        language: str | None = Form(None),
        model: str | None = Form(None),
    ) -> JSONResponse:
        # Hàm sync: FastAPI chạy trong threadpool, giải mã + suy luận không chặn event loop.
        started = time.perf_counter()
        temp_path: str | None = None
        model_name = "-"
        size_bytes = 0
        audio_seconds = 0.0
        outcome = "ok"
        try:
            if language not in LANGUAGES:
                raise RequestRejected(400, "invalid_language")
            allowed = config.models_by_language[language]
            model_name = model.strip() if model and model.strip() else allowed[0]
            if model_name not in allowed:
                model_name = "-"
                raise RequestRejected(400, "model_not_allowed")
            if audio is None:
                raise RequestRejected(400, "missing_audio")
            audio_format = detect_format(audio.content_type, audio.filename)
            if audio_format is None:
                raise RequestRejected(415, "unsupported_audio_format")

            temp_path = _copy_upload_to_temp(audio, audio_format, config)
            size_bytes = os.path.getsize(temp_path)
            try:
                samples = decoder(temp_path, audio_format, config.max_seconds)
            except AudioTooLongError as error:
                raise RequestRejected(413, "audio_too_long") from error
            except AudioDecodeError as error:
                raise RequestRejected(400, "undecodable_audio") from error
            finally:
                # Xoá ngay sau khi giải mã, không đợi suy luận xong.
                _remove_quietly(temp_path)
            audio_seconds = samples.size / SAMPLE_RATE

            try:
                text = engine.transcribe(model_name, samples, language)
            except ModelUnavailableError as error:
                raise RequestRejected(503, "model_unavailable") from error
            except Exception as error:  # noqa: BLE001 — không để lộ chi tiết suy luận ra ngoài
                logger.error("transcribe lỗi: %s", type(error).__name__)
                raise RequestRejected(500, "transcription_failed") from error

            latency_ms = round((time.perf_counter() - started) * 1000)
            return JSONResponse({"text": text, "model": model_name, "language": language, "latency_ms": latency_ms})
        except RequestRejected as rejection:
            outcome = rejection.code
            return _error(rejection.status_code, rejection.code)
        finally:
            _remove_quietly(temp_path)
            if audio is not None:
                audio.file.close()
            logger.info(
                "transcribe outcome=%s model=%s language=%s bytes=%d seconds=%.1f latency_ms=%d",
                outcome,
                model_name,
                language if language in LANGUAGES else "-",
                size_bytes,
                audio_seconds,
                round((time.perf_counter() - started) * 1000),
            )

    return app
