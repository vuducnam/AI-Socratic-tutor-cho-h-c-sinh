"""Loader thật: pipeline ASR của Hugging Face transformers (Whisper / PhoWhisper).

Chọn transformers thay vì faster-whisper vì PhoWhisper chỉ phát hành checkpoint transformers; convert
sang CTranslate2 để sau nếu đo thấy chậm (SPEC §10). Import torch/transformers trễ để test và
`app.download` không phải nạp chúng.
"""

from typing import Any

import numpy as np

from app.audio_decode import SAMPLE_RATE
from app.speech_engine import Transcriber, TranscriberLoader

# Audio dài hơn 30 giây (cửa sổ của Whisper) được cắt khúc có chồng lấn.
CHUNK_LENGTH_SECONDS = 30


def resolve_device(requested: str) -> str:
    import torch

    if requested == "cpu":
        return "cpu"
    if requested == "cuda" and not torch.cuda.is_available():
        raise RuntimeError("STT_DEVICE=cuda nhưng không thấy GPU")
    return "cuda:0" if torch.cuda.is_available() else "cpu"


def make_hf_loader(requested_device: str) -> TranscriberLoader:
    def load(model_name: str) -> Transcriber:
        import torch
        from transformers import pipeline

        device = resolve_device(requested_device)
        # fp16 trên GPU, fp32 khi chạy CPU (dự phòng/debug).
        asr: Any = pipeline(
            "automatic-speech-recognition",
            model=model_name,
            device=device,
            dtype=torch.float16 if device.startswith("cuda") else torch.float32,
        )
        # PhoWhisper có thể thiếu bảng mã ngôn ngữ; chỉ ép `language` khi model hỗ trợ.
        supports_language = bool(getattr(asr.model.generation_config, "lang_to_id", None))

        def transcribe(samples: np.ndarray, language: str) -> str:
            generate_kwargs: dict[str, str] = {"task": "transcribe"}
            if supports_language:
                generate_kwargs["language"] = language
            output = asr(
                {"raw": samples, "sampling_rate": SAMPLE_RATE},
                chunk_length_s=CHUNK_LENGTH_SECONDS,
                generate_kwargs=generate_kwargs,
            )
            return str(output["text"])

        return transcribe

    return load
