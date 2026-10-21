"""Nhận diện định dạng và giải mã bằng ffmpeg thật (bỏ qua nếu máy không có ffmpeg)."""

import math
import shutil
import struct
import subprocess
import wave
from collections.abc import Callable
from pathlib import Path

import numpy as np
import pytest
from fastapi.testclient import TestClient

from app.audio_decode import (
    SAMPLE_RATE,
    AudioDecodeError,
    AudioFormat,
    AudioTooLongError,
    decode_with_ffmpeg,
    detect_format,
)
from app.main import create_app
from app.settings import Settings
from conftest import FakeLoader, leftover_files

needs_ffmpeg = pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="cần ffmpeg trong PATH")


def _write_sine_wav(path: Path, seconds: float, rate: int = 44_100) -> None:
    frames = b"".join(
        struct.pack("<h", int(8000 * math.sin(2 * math.pi * 440 * index / rate))) for index in range(int(seconds * rate))
    )
    with wave.open(str(path), "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(rate)
        handle.writeframes(frames)


@pytest.mark.parametrize(
    ("content_type", "filename", "expected"),
    [
        ("audio/webm;codecs=opus", "blob", AudioFormat(".webm", "matroska")),
        ("audio/ogg; codecs=opus", None, AudioFormat(".ogg", "ogg")),
        ("audio/x-wav", "a.bin", AudioFormat(".wav", "wav")),
        ("audio/mp4", None, AudioFormat(".mp4", "mov")),
        ("application/octet-stream", "Rec.M4A", AudioFormat(".m4a", "mov")),
        ("", "clip.wav", AudioFormat(".wav", "wav")),
        ("audio/flac", "clip.flac", None),
        ("video/x-matroska", "clip.mkv", None),
        (None, None, None),
    ],
)
def test_detect_format(content_type: str | None, filename: str | None, expected: AudioFormat | None) -> None:
    assert detect_format(content_type, filename) == expected


@needs_ffmpeg
def test_decode_wav_resamples_to_16k_mono(tmp_path: Path) -> None:
    source = tmp_path / "tone.wav"
    _write_sine_wav(source, seconds=1.5)
    samples = decode_with_ffmpeg(str(source), AudioFormat(".wav", "wav"), max_seconds=60)
    assert samples.dtype == np.float32
    assert abs(samples.size - int(1.5 * SAMPLE_RATE)) < SAMPLE_RATE // 50
    assert 0.1 < float(np.abs(samples).max()) <= 1.0


@needs_ffmpeg
def test_decode_webm_opus(tmp_path: Path) -> None:
    source = tmp_path / "tone.webm"
    subprocess.run(
        ["ffmpeg", "-nostdin", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=1",
         "-c:a", "libopus", str(source)],
        check=True,
    )
    samples = decode_with_ffmpeg(str(source), AudioFormat(".webm", "matroska"), max_seconds=60)
    assert abs(samples.size - SAMPLE_RATE) < SAMPLE_RATE // 10


@needs_ffmpeg
def test_decode_rejects_audio_longer_than_limit_plus_tolerance(tmp_path: Path) -> None:
    source = tmp_path / "long.wav"
    _write_sine_wav(source, seconds=3.3)
    with pytest.raises(AudioTooLongError):
        decode_with_ffmpeg(str(source), AudioFormat(".wav", "wav"), max_seconds=2)


@needs_ffmpeg
@pytest.mark.parametrize("seconds", [2.0, 2.4, 2.95])
def test_decode_accepts_audio_within_one_second_tolerance(tmp_path: Path, seconds: float) -> None:
    # Ghi âm tự dừng đúng giới hạn (hoặc container dài hơn vài trăm ms) vẫn được nhận.
    source = tmp_path / "edge.wav"
    _write_sine_wav(source, seconds=seconds)
    samples = decode_with_ffmpeg(str(source), AudioFormat(".wav", "wav"), max_seconds=2)
    assert abs(samples.size - int(seconds * SAMPLE_RATE)) < SAMPLE_RATE // 50


@needs_ffmpeg
def test_decode_rejects_garbage(tmp_path: Path) -> None:
    source = tmp_path / "junk.webm"
    source.write_bytes(b"not really audio" * 64)
    with pytest.raises(AudioDecodeError):
        decode_with_ffmpeg(str(source), AudioFormat(".webm", "matroska"), max_seconds=60)


@needs_ffmpeg
def test_api_with_real_ffmpeg_limits_duration_and_cleans_up(
    tmp_path: Path, make_settings: Callable[..., Settings], work_dir: Path
) -> None:
    short_wav, edge_wav, long_wav = tmp_path / "short.wav", tmp_path / "edge.wav", tmp_path / "long.wav"
    _write_sine_wav(short_wav, seconds=1.0)
    # Vừa chạm giới hạn + phần đuôi (trong 1 giây dung sai) vẫn được nhận.
    _write_sine_wav(edge_wav, seconds=2.9)
    _write_sine_wav(long_wav, seconds=3.5)
    loader = FakeLoader()
    with TestClient(create_app(settings=make_settings(max_seconds=2), loader=loader)) as client:
        ok = client.post("/transcribe", data={"language": "vi"}, files={"audio": ("a.wav", short_wav.read_bytes(), "audio/wav")})
        edge = client.post("/transcribe", data={"language": "vi"}, files={"audio": ("e.wav", edge_wav.read_bytes(), "audio/wav")})
        too_long = client.post(
            "/transcribe", data={"language": "vi"}, files={"audio": ("b.wav", long_wav.read_bytes(), "audio/wav")}
        )
        garbage = client.post(
            "/transcribe", data={"language": "vi"}, files={"audio": ("c.webm", b"\x00junk" * 100, "audio/webm")}
        )
    assert ok.status_code == 200
    assert edge.status_code == 200
    assert too_long.status_code == 413 and too_long.json() == {"detail": "audio_too_long"}
    assert garbage.status_code == 400 and garbage.json() == {"detail": "undecodable_audio"}
    assert len(loader.calls) == 2
    assert leftover_files(work_dir) == []
