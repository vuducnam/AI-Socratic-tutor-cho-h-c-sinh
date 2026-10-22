"""Cổng im lặng: im lặng, tiếng ồn nhỏ, tiếng động quá ngắn → không có tiếng nói; giọng khẽ vẫn qua."""

import numpy as np

from app.audio_decode import SAMPLE_RATE
from app.speech_activity import has_speech


def _tone(seconds: float, amplitude: float) -> np.ndarray:
    t = np.arange(int(seconds * SAMPLE_RATE)) / SAMPLE_RATE
    return (amplitude * np.sin(2 * np.pi * 220 * t)).astype(np.float32)


def test_silence_has_no_speech() -> None:
    assert not has_speech(np.zeros(3 * SAMPLE_RATE, dtype=np.float32), SAMPLE_RATE)


def test_room_noise_below_threshold_has_no_speech() -> None:
    noise = np.random.default_rng(7).normal(0, 0.001, 3 * SAMPLE_RATE).astype(np.float32)  # khoảng -60 dBFS
    assert not has_speech(noise, SAMPLE_RATE)


def test_short_click_has_no_speech() -> None:
    samples = np.zeros(2 * SAMPLE_RATE, dtype=np.float32)
    samples[SAMPLE_RATE : SAMPLE_RATE + SAMPLE_RATE // 10] = _tone(0.1, 0.5)
    assert not has_speech(samples, SAMPLE_RATE)


def test_quiet_voice_counts_as_speech() -> None:
    samples = np.concatenate([np.zeros(SAMPLE_RATE, dtype=np.float32), _tone(0.5, 0.025)])  # khoảng -35 dBFS
    assert has_speech(samples, SAMPLE_RATE)


def test_empty_input_has_no_speech() -> None:
    assert not has_speech(np.zeros(0, dtype=np.float32), SAMPLE_RATE)


def test_gain_boosted_room_noise_has_no_speech() -> None:
    # Trình duyệt tự khuếch đại khi con im lặng: tiếng ồn đều khoảng -34 dBFS, to hơn ngưỡng tuyệt đối nhưng không nổi
    # lên trên nền ồn của chính nó.
    noise = np.random.default_rng(3).normal(0, 0.02, 3 * SAMPLE_RATE).astype(np.float32)
    assert not has_speech(noise, SAMPLE_RATE)


def test_voice_over_boosted_room_noise_counts_as_speech() -> None:
    rng = np.random.default_rng(5)
    noise = rng.normal(0, 0.02, 3 * SAMPLE_RATE).astype(np.float32)
    start = SAMPLE_RATE
    noise[start : start + SAMPLE_RATE // 2] += _tone(0.5, 0.2)  # khoảng -17 dBFS, nổi trên nền ~17 dB
    assert has_speech(noise, SAMPLE_RATE)