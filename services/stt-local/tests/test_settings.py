"""Đọc cấu hình từ môi trường; giá trị mặc định phải khớp `config/models.yaml` → `stt`."""

import re
from pathlib import Path

import pytest

from app.settings import DEFAULT_MAX_BYTES, DEFAULT_MAX_SECONDS, DEFAULT_MODELS, SettingsError, load_settings

MODELS_YAML = Path(__file__).resolve().parents[3] / "config" / "models.yaml"


def test_defaults() -> None:
    settings = load_settings({})
    assert settings.models_by_language == {
        "vi": ("vinai/PhoWhisper-large",),
        "en": ("openai/whisper-large-v3-turbo",),
    }
    assert settings.preload == ("vinai/PhoWhisper-large", "openai/whisper-large-v3-turbo")
    assert settings.device == "auto"
    assert (settings.max_bytes, settings.max_seconds) == (10 * 1024 * 1024, 60)
    assert settings.tmp_dir is None


@pytest.mark.skipif(not MODELS_YAML.exists(), reason="chỉ chạy trong repo (không có trong image)")
def test_defaults_match_models_yaml() -> None:
    text = MODELS_YAML.read_text(encoding="utf-8")
    stt_block = text.split("\nstt:", 1)[1].split("\ntts:", 1)[0]
    for language, model in DEFAULT_MODELS.items():
        assert re.search(rf"^\s+{language}:\s+{re.escape(model)}\s", stt_block, re.MULTILINE)
    assert re.search(rf"max_seconds:\s+{DEFAULT_MAX_SECONDS}\b", stt_block)
    assert re.search(rf"max_bytes:\s+{DEFAULT_MAX_BYTES}\b", stt_block)


def test_model_lists_and_preload_modes() -> None:
    env = {
        "STT_MODELS_VI": " vinai/PhoWhisper-large , openai/whisper-large-v3-turbo,vinai/PhoWhisper-large ",
        "STT_MODELS_EN": "openai/whisper-large-v3-turbo",
    }
    settings = load_settings(env)
    assert settings.models_by_language["vi"] == ("vinai/PhoWhisper-large", "openai/whisper-large-v3-turbo")
    assert settings.default_model("vi") == "vinai/PhoWhisper-large"
    assert settings.all_models() == ("vinai/PhoWhisper-large", "openai/whisper-large-v3-turbo")
    assert load_settings({**env, "STT_PRELOAD": "defaults"}).preload == (
        "vinai/PhoWhisper-large",
        "openai/whisper-large-v3-turbo",
    )
    assert load_settings({**env, "STT_PRELOAD": "none"}).preload == ()
    assert load_settings({**env, "STT_PRELOAD": "openai/whisper-large-v3-turbo"}).preload == (
        "openai/whisper-large-v3-turbo",
    )


@pytest.mark.parametrize(
    "env",
    [
        {"STT_PRELOAD": "openai/whisper-tiny"},
        {"STT_DEVICE": "tpu"},
        {"STT_MAX_BYTES": "-5"},
        {"STT_MAX_SECONDS": "abc"},
        {"STT_MAX_SECONDS": "0"},
    ],
)
def test_invalid_env_fails_fast(env: dict[str, str]) -> None:
    with pytest.raises(SettingsError):
        load_settings(env)


def test_limits_and_tmp_dir_from_env() -> None:
    settings = load_settings({"STT_MAX_BYTES": "2048", "STT_MAX_SECONDS": "30", "STT_TMP_DIR": "/tmp/stt", "STT_DEVICE": "cpu"})
    assert (settings.max_bytes, settings.max_seconds, settings.tmp_dir, settings.device) == (2048, 30, "/tmp/stt", "cpu")
