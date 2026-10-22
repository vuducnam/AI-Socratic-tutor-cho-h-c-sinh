"""Cấu hình stt-local đọc từ biến môi trường (giá trị mặc định khớp `config/models.yaml` → `stt`).

- `STT_MODELS_VI`, `STT_MODELS_EN`: danh sách model cách nhau bởi dấu phẩy; model đầu tiên là mặc định
  của ngôn ngữ đó, các model sau chỉ dùng khi request gửi `model` (A/B, stt-bench).
- `STT_PRELOAD`: `all` (mặc định) | `defaults` | `none` | danh sách tên model. Model được preload nạp
  một lần khi khởi động; model còn lại nạp ở lần dùng đầu tiên rồi giữ trong bộ nhớ.
- `STT_DEVICE`: `auto` (mặc định: CUDA nếu có) | `cuda` | `cpu`.
- `STT_MAX_BYTES` (10 MB), `STT_MAX_SECONDS` (60 s, nhận thêm 1 giây dung sai cho phần đuôi ghi âm): vượt → 413.
- `STT_TMP_DIR`: thư mục file tạm khi giải mã (mặc định thư mục tạm hệ thống; container: tmpfs /tmp).
"""

import os
from collections.abc import Mapping
from dataclasses import dataclass

LANGUAGES: tuple[str, ...] = ("vi", "en")
DEFAULT_MODELS: dict[str, str] = {
    "vi": "vinai/PhoWhisper-large",
    "en": "openai/whisper-large-v3-turbo",
}
DEFAULT_MAX_BYTES = 10 * 1024 * 1024
DEFAULT_MAX_SECONDS = 60
DEVICES = ("auto", "cuda", "cpu")


class SettingsError(ValueError):
    """Cấu hình môi trường sai: dừng ngay khi khởi động thay vì chạy với giá trị đoán."""


@dataclass(frozen=True)
class Settings:
    models_by_language: dict[str, tuple[str, ...]]
    preload: tuple[str, ...]
    device: str = "auto"
    max_bytes: int = DEFAULT_MAX_BYTES
    max_seconds: int = DEFAULT_MAX_SECONDS
    tmp_dir: str | None = None

    def default_model(self, language: str) -> str:
        return self.models_by_language[language][0]

    def all_models(self) -> tuple[str, ...]:
        """Mọi model đã cấu hình, không trùng, giữ thứ tự xuất hiện."""
        seen: dict[str, None] = {}
        for language in LANGUAGES:
            for name in self.models_by_language[language]:
                seen.setdefault(name, None)
        return tuple(seen)


def _split_names(raw: str) -> tuple[str, ...]:
    return tuple(dict.fromkeys(part.strip() for part in raw.split(",") if part.strip()))


def _positive_int(env: Mapping[str, str], key: str, default: int) -> int:
    raw = env.get(key, "").strip()
    if not raw:
        return default
    if not raw.isdigit() or int(raw) <= 0:
        raise SettingsError(f"{key} phải là số nguyên dương")
    return int(raw)


def load_settings(env: Mapping[str, str] | None = None) -> Settings:
    source = os.environ if env is None else env

    models: dict[str, tuple[str, ...]] = {}
    for language in LANGUAGES:
        names = _split_names(source.get(f"STT_MODELS_{language.upper()}", ""))
        models[language] = names or (DEFAULT_MODELS[language],)

    settings_without_preload = Settings(models_by_language=models, preload=())
    every_model = settings_without_preload.all_models()

    preload_raw = source.get("STT_PRELOAD", "all").strip() or "all"
    if preload_raw == "all":
        preload = every_model
    elif preload_raw == "defaults":
        preload = tuple(dict.fromkeys(models[language][0] for language in LANGUAGES))
    elif preload_raw == "none":
        preload = ()
    else:
        preload = _split_names(preload_raw)
        unknown = [name for name in preload if name not in every_model]
        if unknown:
            raise SettingsError(f"STT_PRELOAD có model chưa cấu hình: {', '.join(unknown)}")

    device = source.get("STT_DEVICE", "auto").strip() or "auto"
    if device not in DEVICES:
        raise SettingsError(f"STT_DEVICE phải là một trong {', '.join(DEVICES)}")

    tmp_dir = source.get("STT_TMP_DIR", "").strip() or None

    return Settings(
        models_by_language=models,
        preload=preload,
        device=device,
        max_bytes=_positive_int(source, "STT_MAX_BYTES", DEFAULT_MAX_BYTES),
        max_seconds=_positive_int(source, "STT_MAX_SECONDS", DEFAULT_MAX_SECONDS),
        tmp_dir=tmp_dir,
    )
