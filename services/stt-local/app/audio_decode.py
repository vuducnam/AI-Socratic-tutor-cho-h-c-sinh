"""Nhận diện định dạng và giải mã audio bằng ffmpeg thành PCM mono 16 kHz (float32).

ffmpeg được gọi với demuxer chỉ định sẵn (`-f`) và `-protocol_whitelist file`: file tải lên không thể
kéo ffmpeg sang playlist/concat/URL khác. Không ghi stderr của ffmpeg ra log.
"""

import subprocess
from dataclasses import dataclass

import numpy as np

SAMPLE_RATE = 16_000
DECODE_TIMEOUT_SECONDS = 60
# Dung sai cho phần đuôi ghi âm: trình duyệt tự dừng sát giới hạn, container (webm/ogg) có thể dài hơn
# vài trăm ms so với đồng hồ của client. Nhận tới `max_seconds + 1` giây, dài hơn mới từ chối.
DURATION_TOLERANCE_SECONDS = 1

# MIME (đã bỏ tham số `;codecs=...`) → (đuôi file tạm, demuxer ffmpeg).
_FORMATS_BY_MIME: dict[str, tuple[str, str]] = {
    "audio/webm": (".webm", "matroska"),
    "video/webm": (".webm", "matroska"),
    "audio/ogg": (".ogg", "ogg"),
    "application/ogg": (".ogg", "ogg"),
    "audio/wav": (".wav", "wav"),
    "audio/wave": (".wav", "wav"),
    "audio/x-wav": (".wav", "wav"),
    "audio/vnd.wave": (".wav", "wav"),
    "audio/mp4": (".mp4", "mov"),
    "video/mp4": (".mp4", "mov"),
    "audio/m4a": (".m4a", "mov"),
    "audio/x-m4a": (".m4a", "mov"),
}
_FORMATS_BY_EXTENSION: dict[str, tuple[str, str]] = {
    ".webm": (".webm", "matroska"),
    ".ogg": (".ogg", "ogg"),
    ".oga": (".ogg", "ogg"),
    ".opus": (".ogg", "ogg"),
    ".wav": (".wav", "wav"),
    ".mp4": (".mp4", "mov"),
    ".m4a": (".m4a", "mov"),
}


@dataclass(frozen=True)
class AudioFormat:
    suffix: str
    demuxer: str


class AudioDecodeError(Exception):
    """ffmpeg không đọc được file (hỏng, sai định dạng, rỗng)."""


class AudioTooLongError(Exception):
    """Audio dài hơn giới hạn giây cho phép."""


def detect_format(content_type: str | None, filename: str | None) -> AudioFormat | None:
    """Ưu tiên MIME của phần multipart; MIME chung chung thì dựa vào đuôi tên file."""
    mime = (content_type or "").split(";", 1)[0].strip().lower()
    found = _FORMATS_BY_MIME.get(mime)
    if found is None and filename and "." in filename:
        found = _FORMATS_BY_EXTENSION.get("." + filename.rsplit(".", 1)[1].lower())
    return AudioFormat(*found) if found else None


def decode_with_ffmpeg(path: str, audio_format: AudioFormat, max_seconds: int) -> np.ndarray:
    """Giải mã tối đa `max_seconds + 2` giây; dài hơn `max_seconds + 1` (dung sai) → AudioTooLongError."""
    accepted_seconds = max_seconds + DURATION_TOLERANCE_SECONDS
    command = [
        "ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error",
        "-protocol_whitelist", "file",
        "-f", audio_format.demuxer, "-i", path,
        # Đọc dư 1 giây so với mức nhận để phân biệt "vừa đúng giới hạn" với "dài quá".
        "-t", str(accepted_seconds + 1),
        "-vn", "-ac", "1", "-ar", str(SAMPLE_RATE),
        "-f", "s16le", "-acodec", "pcm_s16le", "pipe:1",
    ]
    try:
        completed = subprocess.run(command, capture_output=True, timeout=DECODE_TIMEOUT_SECONDS, check=False)
    except subprocess.TimeoutExpired as error:
        raise AudioDecodeError("ffmpeg_timeout") from error
    if completed.returncode != 0:
        raise AudioDecodeError(f"ffmpeg_exit_{completed.returncode}")

    pcm = np.frombuffer(completed.stdout, dtype="<i2")
    if pcm.size == 0:
        raise AudioDecodeError("empty_audio")
    if pcm.size > accepted_seconds * SAMPLE_RATE:
        raise AudioTooLongError()
    return pcm.astype(np.float32) / 32768.0
