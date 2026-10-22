"""API /transcribe và /health với loader + decoder giả: kiểm validate, giới hạn, và audio không còn trên đĩa."""

import logging
from collections.abc import Callable
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.audio_decode import AudioDecodeError, AudioTooLongError
from app.main import MULTIPART_OVERHEAD_BYTES, create_app
from app.settings import Settings
from app.speech_engine import ModelUnavailableError
from conftest import FAKE_TRANSCRIPT, FakeDecoder, FakeLoader, leftover_files

SettingsFactory = Callable[..., Settings]
AUDIO = ("mic.webm", b"\x1a\x45\xdf\xa3" + b"\x00" * 2048, "audio/webm;codecs=opus")


def _client(settings: Settings, loader: FakeLoader, decoder: FakeDecoder) -> TestClient:
    return TestClient(create_app(settings=settings, loader=loader, decoder=decoder))


def _post(client: TestClient, data: dict[str, str], audio: tuple[str, bytes, str] | None = AUDIO):  # type: ignore[no-untyped-def]
    files = {"audio": audio} if audio is not None else None
    return client.post("/transcribe", data=data, files=files)


def test_health_lists_preloaded_models(make_settings: SettingsFactory) -> None:
    loader = FakeLoader()
    with _client(make_settings(), loader, FakeDecoder()) as client:
        body = client.get("/health").json()
    assert body == {
        "status": "ok",
        "models_loaded": ["vinai/PhoWhisper-large"],
        "models": {
            "vi": ["vinai/PhoWhisper-large", "openai/whisper-large-v3-turbo"],
            "en": ["openai/whisper-large-v3-turbo"],
        },
    }
    assert loader.loads == ["vinai/PhoWhisper-large"]


def test_preload_failure_stops_startup(make_settings: SettingsFactory) -> None:
    loader = FakeLoader(fail_load={"vinai/PhoWhisper-large"})
    with pytest.raises(ModelUnavailableError), _client(make_settings(), loader, FakeDecoder()):
        pass


def test_transcribe_vi_uses_default_model_and_removes_temp_file(
    make_settings: SettingsFactory, work_dir: Path
) -> None:
    loader, decoder = FakeLoader(), FakeDecoder(seconds=3)
    with _client(make_settings(), loader, decoder) as client:
        response = _post(client, {"language": "vi"})
    assert response.status_code == 200
    body = response.json()
    assert body["text"] == FAKE_TRANSCRIPT
    assert body["model"] == "vinai/PhoWhisper-large"
    assert body["language"] == "vi"
    assert isinstance(body["latency_ms"], int) and body["latency_ms"] >= 0
    assert set(body) == {"text", "model", "language", "latency_ms"}
    # File tạm có tồn tại lúc giải mã, đúng đuôi, và đã bị xoá sau request.
    path, existed, audio_format = decoder.seen[0]
    assert existed and path.endswith(".webm") and audio_format.demuxer == "matroska"
    assert loader.calls == [("vinai/PhoWhisper-large", "vi", 3 * 16_000)]
    assert leftover_files(work_dir) == []


def test_transcribe_en_lazy_loads_non_preloaded_model(make_settings: SettingsFactory, work_dir: Path) -> None:
    loader = FakeLoader()
    with _client(make_settings(), loader, FakeDecoder()) as client:
        first = _post(client, {"language": "en"})
        second = _post(client, {"language": "en"})
    assert first.status_code == second.status_code == 200
    assert first.json()["model"] == "openai/whisper-large-v3-turbo"
    # Nạp một lần rồi giữ trong bộ nhớ.
    assert loader.loads == ["vinai/PhoWhisper-large", "openai/whisper-large-v3-turbo"]
    assert leftover_files(work_dir) == []


def test_model_override_within_language_list(make_settings: SettingsFactory) -> None:
    loader = FakeLoader()
    with _client(make_settings(), loader, FakeDecoder()) as client:
        response = _post(client, {"language": "vi", "model": "openai/whisper-large-v3-turbo"})
    assert response.status_code == 200
    assert response.json()["model"] == "openai/whisper-large-v3-turbo"
    assert loader.calls[0][:2] == ("openai/whisper-large-v3-turbo", "vi")


@pytest.mark.parametrize(
    "model",
    ["vinai/PhoWhisper-large-evil", "../../etc/passwd", "openai/whisper-tiny"],
)
def test_model_override_outside_list_rejected(make_settings: SettingsFactory, work_dir: Path, model: str) -> None:
    loader, decoder = FakeLoader(), FakeDecoder()
    with _client(make_settings(), loader, decoder) as client:
        response = _post(client, {"language": "vi", "model": model})
    assert response.status_code == 400
    assert response.json() == {"detail": "model_not_allowed"}
    assert decoder.seen == [] and loader.calls == []
    assert leftover_files(work_dir) == []


def test_vi_only_model_not_allowed_for_en(make_settings: SettingsFactory) -> None:
    with _client(make_settings(), FakeLoader(), FakeDecoder()) as client:
        response = _post(client, {"language": "en", "model": "vinai/PhoWhisper-large"})
    assert response.status_code == 400
    assert response.json() == {"detail": "model_not_allowed"}


@pytest.mark.parametrize("data", [{}, {"language": ""}, {"language": "fr"}, {"language": "VI"}])
def test_invalid_language_rejected(make_settings: SettingsFactory, work_dir: Path, data: dict[str, str]) -> None:
    decoder = FakeDecoder()
    with _client(make_settings(), FakeLoader(), decoder) as client:
        response = _post(client, data)
    assert response.status_code == 400
    assert response.json() == {"detail": "invalid_language"}
    assert decoder.seen == []
    assert leftover_files(work_dir) == []


def test_missing_audio_rejected(make_settings: SettingsFactory) -> None:
    with _client(make_settings(), FakeLoader(), FakeDecoder()) as client:
        response = _post(client, {"language": "vi"}, audio=None)
    assert response.status_code == 400
    assert response.json() == {"detail": "missing_audio"}


def test_empty_audio_rejected(make_settings: SettingsFactory, work_dir: Path) -> None:
    with _client(make_settings(), FakeLoader(), FakeDecoder()) as client:
        response = _post(client, {"language": "vi"}, audio=("mic.webm", b"", "audio/webm"))
    assert response.status_code == 400
    assert response.json() == {"detail": "empty_audio"}
    assert leftover_files(work_dir) == []


@pytest.mark.parametrize(
    ("filename", "content_type"),
    [("note.txt", "text/plain"), ("clip.flac", "audio/flac"), ("x", "application/octet-stream")],
)
def test_unsupported_format_rejected(make_settings: SettingsFactory, filename: str, content_type: str) -> None:
    decoder = FakeDecoder()
    with _client(make_settings(), FakeLoader(), decoder) as client:
        response = _post(client, {"language": "vi"}, audio=(filename, b"data", content_type))
    assert response.status_code == 415
    assert response.json() == {"detail": "unsupported_audio_format"}
    assert decoder.seen == []


def test_generic_mime_falls_back_to_extension(make_settings: SettingsFactory) -> None:
    decoder = FakeDecoder()
    with _client(make_settings(), FakeLoader(), decoder) as client:
        response = _post(client, {"language": "vi"}, audio=("rec.m4a", b"\x00" * 64, "application/octet-stream"))
    assert response.status_code == 200
    assert decoder.seen[0][2].demuxer == "mov"


def test_audio_over_byte_limit_rejected_while_copying(make_settings: SettingsFactory, work_dir: Path) -> None:
    # Vượt max_bytes nhưng chưa vượt ngưỡng Content-Length của middleware → chặn khi chép sang file tạm.
    decoder = FakeDecoder()
    with _client(make_settings(max_bytes=1000), FakeLoader(), decoder) as client:
        response = _post(client, {"language": "vi"}, audio=("mic.webm", b"\x00" * 5000, "audio/webm"))
    assert response.status_code == 413
    assert response.json() == {"detail": "audio_too_large"}
    assert decoder.seen == []
    assert leftover_files(work_dir) == []


def test_body_over_content_length_limit_rejected_early(make_settings: SettingsFactory, work_dir: Path) -> None:
    decoder = FakeDecoder()
    payload = b"\x00" * (MULTIPART_OVERHEAD_BYTES + 2000)
    with _client(make_settings(max_bytes=1000), FakeLoader(), decoder) as client:
        response = _post(client, {"language": "vi"}, audio=("mic.webm", payload, "audio/webm"))
    assert response.status_code == 413
    assert response.json() == {"detail": "audio_too_large"}
    assert decoder.seen == []
    assert leftover_files(work_dir) == []


def _chunked_multipart(audio: bytes, chunk: int = 8192):  # type: ignore[no-untyped-def]
    """Multipart gửi dạng chunked (không có Content-Length), như một client không khai độ dài."""
    boundary = "cu-test-boundary"
    head = (
        f"--{boundary}\r\nContent-Disposition: form-data; name=\"language\"\r\n\r\nvi\r\n"
        f"--{boundary}\r\nContent-Disposition: form-data; name=\"audio\"; filename=\"mic.webm\"\r\n"
        "Content-Type: audio/webm\r\n\r\n"
    ).encode()
    body = head + audio + f"\r\n--{boundary}--\r\n".encode()

    def stream():  # type: ignore[no-untyped-def]
        for start in range(0, len(body), chunk):
            yield body[start : start + chunk]

    return stream(), {"content-type": f"multipart/form-data; boundary={boundary}"}


def test_chunked_body_over_limit_rejected_while_receiving(make_settings: SettingsFactory, work_dir: Path) -> None:
    decoder = FakeDecoder()
    content, headers = _chunked_multipart(b"\x1a\x45\xdf\xa3" + b"\x00" * (MULTIPART_OVERHEAD_BYTES + 5000))
    with _client(make_settings(max_bytes=1000), FakeLoader(), decoder) as client:
        response = client.post("/transcribe", content=content, headers=headers)
    assert response.status_code == 413
    assert response.json() == {"detail": "audio_too_large"}
    assert decoder.seen == []
    assert leftover_files(work_dir) == []


def test_chunked_body_within_limit_is_transcribed(make_settings: SettingsFactory) -> None:
    content, headers = _chunked_multipart(b"\x1a\x45\xdf\xa3" + b"\x00" * 2048)
    with _client(make_settings(), FakeLoader(), FakeDecoder()) as client:
        response = client.post("/transcribe", content=content, headers=headers)
    assert response.status_code == 200
    assert response.json()["text"] == FAKE_TRANSCRIPT


def test_audio_over_duration_limit_rejected(make_settings: SettingsFactory, work_dir: Path) -> None:
    decoder = FakeDecoder(error=AudioTooLongError())
    loader = FakeLoader()
    with _client(make_settings(), loader, decoder) as client:
        response = _post(client, {"language": "vi"})
    assert response.status_code == 413
    assert response.json() == {"detail": "audio_too_long"}
    assert decoder.seen[0][1] is True
    assert loader.calls == []
    assert leftover_files(work_dir) == []


def test_undecodable_audio_rejected(make_settings: SettingsFactory, work_dir: Path) -> None:
    decoder = FakeDecoder(error=AudioDecodeError("ffmpeg_exit_1"))
    with _client(make_settings(), FakeLoader(), decoder) as client:
        response = _post(client, {"language": "vi"})
    assert response.status_code == 400
    assert response.json() == {"detail": "undecodable_audio"}
    assert leftover_files(work_dir) == []


def test_unexpected_decoder_crash_still_removes_temp_file(make_settings: SettingsFactory, work_dir: Path) -> None:
    decoder = FakeDecoder(error=FileNotFoundError("ffmpeg"))
    client = TestClient(
        create_app(settings=make_settings(), loader=FakeLoader(), decoder=decoder), raise_server_exceptions=False
    )
    with client:
        response = _post(client, {"language": "vi"})
    assert response.status_code == 500
    assert decoder.seen[0][1] is True
    assert leftover_files(work_dir) == []


def test_silent_recording_returns_empty_text_without_inference(make_settings: SettingsFactory, work_dir: Path) -> None:
    loader = FakeLoader()
    with _client(make_settings(), loader, FakeDecoder(silent=True)) as client:
        response = _post(client, {"language": "vi"})
    assert response.status_code == 200
    assert response.json()["text"] == ""
    assert loader.calls == []
    assert leftover_files(work_dir) == []


def test_inference_error_returns_500_and_removes_temp_file(make_settings: SettingsFactory, work_dir: Path) -> None:
    with _client(make_settings(), FakeLoader(fail_infer=True), FakeDecoder()) as client:
        response = _post(client, {"language": "vi"})
    assert response.status_code == 500
    assert response.json() == {"detail": "transcription_failed"}
    assert leftover_files(work_dir) == []


def test_model_load_failure_returns_503(make_settings: SettingsFactory, work_dir: Path) -> None:
    loader = FakeLoader(fail_load={"openai/whisper-large-v3-turbo"})
    with _client(make_settings(), loader, FakeDecoder()) as client:
        response = _post(client, {"language": "en"})
    assert response.status_code == 503
    assert response.json() == {"detail": "model_unavailable"}
    assert leftover_files(work_dir) == []


def test_logs_never_contain_transcript(
    make_settings: SettingsFactory, caplog: pytest.LogCaptureFixture
) -> None:
    caplog.set_level(logging.DEBUG)
    with _client(make_settings(), FakeLoader(), FakeDecoder()) as client:
        assert _post(client, {"language": "vi"}).status_code == 200
    assert any("outcome=ok" in record.getMessage() for record in caplog.records)
    assert all(FAKE_TRANSCRIPT not in record.getMessage() for record in caplog.records)
