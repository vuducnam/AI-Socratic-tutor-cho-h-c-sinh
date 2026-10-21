"""Quản lý model nhận dạng giọng nói: nạp một lần, giữ trong bộ nhớ, chạy suy luận tuần tự.

`Transcriber` là hàm `(samples_16k_float32, language) -> text`. Bản thật dựng từ transformers ở
`app.hf_pipeline`; test truyền loader giả nên không cần GPU hay tải model.
"""

import threading
from collections.abc import Callable, Iterable

import numpy as np

Transcriber = Callable[[np.ndarray, str], str]
TranscriberLoader = Callable[[str], Transcriber]


class ModelUnavailableError(Exception):
    """Model không nạp được (chưa tải về cache, hết VRAM, ...)."""


class SpeechEngine:
    def __init__(self, loader: TranscriberLoader) -> None:
        self._loader = loader
        self._transcribers: dict[str, Transcriber] = {}
        self._load_lock = threading.Lock()
        # Một GPU, một con dùng: chạy từng request một để tránh tranh VRAM giữa các model.
        self._inference_lock = threading.Lock()

    def preload(self, model_names: Iterable[str]) -> None:
        """Nạp sẵn khi khởi động; lỗi thì ném ra để container dừng thay vì chạy thiếu model."""
        for name in model_names:
            self._get(name)

    def loaded_models(self) -> list[str]:
        return sorted(self._transcribers)

    def transcribe(self, model_name: str, samples: np.ndarray, language: str) -> str:
        transcriber = self._get(model_name)
        with self._inference_lock:
            return transcriber(samples, language).strip()

    def _get(self, model_name: str) -> Transcriber:
        cached = self._transcribers.get(model_name)
        if cached is not None:
            return cached
        with self._load_lock:
            cached = self._transcribers.get(model_name)
            if cached is not None:
                return cached
            try:
                transcriber = self._loader(model_name)
            except Exception as error:  # noqa: BLE001 — mọi lỗi nạp model đều quy về "không dùng được"
                raise ModelUnavailableError(model_name) from error
            self._transcribers[model_name] = transcriber
            return transcriber
