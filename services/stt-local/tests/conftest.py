"""Tiện ích test: loader và decoder giả để chạy không cần GPU, model hay ffmpeg."""

import os
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import pytest

from app.audio_decode import SAMPLE_RATE, AudioFormat
from app.settings import Settings
from app.speech_engine import Transcriber

FAKE_TRANSCRIPT = "mít ơi bốn phẩy năm cộng một"


@dataclass
class FakeLoader:
    """Ghi lại model được nạp và các lượt gọi; `fail_load`/`fail_infer` giả lập lỗi."""

    fail_load: set[str] = field(default_factory=set)
    fail_infer: bool = False
    loads: list[str] = field(default_factory=list)
    calls: list[tuple[str, str, int]] = field(default_factory=list)

    def __call__(self, model_name: str) -> Transcriber:
        if model_name in self.fail_load:
            raise OSError("model chưa có trong cache")
        self.loads.append(model_name)

        def transcribe(samples: np.ndarray, language: str) -> str:
            self.calls.append((model_name, language, samples.size))
            if self.fail_infer:
                raise RuntimeError("CUDA out of memory")
            return f"  {FAKE_TRANSCRIPT}  "

        return transcribe


@dataclass
class FakeDecoder:
    """Trả `seconds` giây im lặng; ghi lại file tạm có tồn tại lúc giải mã hay không."""

    seconds: float = 2.0
    error: Exception | None = None
    seen: list[tuple[str, bool, AudioFormat]] = field(default_factory=list)

    def __call__(self, path: str, audio_format: AudioFormat, max_seconds: int) -> np.ndarray:
        self.seen.append((path, os.path.exists(path), audio_format))
        if self.error is not None:
            raise self.error
        return np.zeros(int(self.seconds * SAMPLE_RATE), dtype=np.float32)


@pytest.fixture
def work_dir(tmp_path: Path) -> Path:
    directory = tmp_path / "stt-tmp"
    directory.mkdir()
    return directory


@pytest.fixture
def make_settings(work_dir: Path) -> Callable[..., Settings]:
    def build(**overrides: object) -> Settings:
        values: dict[str, object] = {
            "models_by_language": {
                "vi": ("vinai/PhoWhisper-large", "openai/whisper-large-v3-turbo"),
                "en": ("openai/whisper-large-v3-turbo",),
            },
            "preload": ("vinai/PhoWhisper-large",),
            "tmp_dir": str(work_dir),
        }
        values.update(overrides)
        return Settings(**values)  # type: ignore[arg-type]

    return build


def leftover_files(directory: Path) -> list[str]:
    return sorted(os.listdir(directory))
