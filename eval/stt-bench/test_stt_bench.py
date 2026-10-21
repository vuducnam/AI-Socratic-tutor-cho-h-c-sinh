"""Kiểm WER, chuẩn hoá chữ, tìm mẫu và chặn URL không phải máy này cho stt-bench.

Chạy: services/stt-local/venv/Scripts/python -m pytest eval/stt-bench
"""

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))

from stt_bench import (  # noqa: E402
    ModelResult,
    encode_multipart,
    ensure_local_url,
    find_samples,
    format_table,
    parse_models_option,
)
from wer_metrics import normalize_words, wer, word_errors  # noqa: E402


def test_normalize_keeps_vietnamese_and_decimal_comma() -> None:
    decomposed = "Mi\u0301t ơi, 4,5 + 0,45 = ?"  # "Mít" ở dạng tổ hợp dấu (NFD)
    assert normalize_words(decomposed) == ["mít", "ơi", "4,5", "0,45"]


def test_word_errors_counts_substitution_deletion_insertion() -> None:
    assert word_errors(["a", "b", "c"], ["a", "b", "c"]) == 0
    assert word_errors(["a", "b", "c"], ["a", "x", "c"]) == 1
    assert word_errors(["a", "b", "c"], ["a", "c"]) == 1
    assert word_errors(["a", "b"], ["a", "b", "c", "d"]) == 2
    assert word_errors(["a", "b"], []) == 2


def test_wer_ignores_case_and_punctuation() -> None:
    assert wer("Bạn ơi, ba phần tư!", "bạn ơi ba phần tư") == 0
    assert wer("một hai ba bốn", "một hai bốn") == pytest.approx(0.25)
    with pytest.raises(ValueError):
        wer("...", "gì đó")


def test_find_samples_pairs_audio_with_reference(tmp_path: Path) -> None:
    folder = tmp_path / "vi"
    folder.mkdir()
    (folder / "a.wav").write_bytes(b"RIFF")
    (folder / "a.txt").write_text("không phẩy năm", encoding="utf-8")
    (folder / "b.webm").write_bytes(b"\x1a")
    (folder / "c.m4a").write_bytes(b"\x00")
    (folder / "c.txt").write_text("  ", encoding="utf-8")
    (folder / "notes.md").write_text("bỏ qua", encoding="utf-8")
    samples, skipped = find_samples(tmp_path, "vi")
    assert [sample.audio.name for sample in samples] == ["a.wav"]
    assert samples[0].reference == "không phẩy năm"
    assert skipped == ["b.webm", "c.m4a"]
    assert find_samples(tmp_path, "en") == ([], [])


@pytest.mark.parametrize("url", ["http://localhost:8002", "http://127.0.0.1:8002/", "http://stt-local:8000"])
def test_local_urls_allowed(url: str) -> None:
    assert ensure_local_url(url) == url.rstrip("/")


@pytest.mark.parametrize("url", ["https://openrouter.ai/api/v1", "http://192.168.1.5:8002", "file:///etc/passwd"])
def test_remote_urls_refused(url: str) -> None:
    with pytest.raises(SystemExit):
        ensure_local_url(url)


def test_parse_models_option() -> None:
    assert parse_models_option(["vi=a/b, c/d", "en=e/f"]) == {"vi": ["a/b", "c/d"], "en": ["e/f"]}
    with pytest.raises(SystemExit):
        parse_models_option(["fr=x"])


def test_encode_multipart_contains_fields_and_audio(tmp_path: Path) -> None:
    audio = tmp_path / "rec.WEBM"
    audio.write_bytes(b"\x1a\x45\xdf\xa3")
    body, content_type = encode_multipart({"language": "vi", "model": "vinai/PhoWhisper-large"}, audio)
    boundary = content_type.split("boundary=", 1)[1]
    assert body.startswith(f"--{boundary}\r\n".encode()) and body.endswith(f"--{boundary}--\r\n".encode())
    assert b'name="language"\r\n\r\nvi\r\n' in body
    assert b'filename="sample.webm"\r\nContent-Type: audio/webm\r\n\r\n\x1a\x45\xdf\xa3\r\n' in body
    # Tên file thật của bản ghi không gửi đi.
    assert b"rec" not in body


def test_format_table_uses_vietnamese_decimal_comma() -> None:
    result = ModelResult(language="vi", model="vinai/PhoWhisper-large", files=2, reference_words=40, errors=5)
    result.latencies_ms.extend([800, 1200])
    table = format_table([result])
    assert "12,5%" in table and "1000" in table
