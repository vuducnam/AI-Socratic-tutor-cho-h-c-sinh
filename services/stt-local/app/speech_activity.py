"""Phát hiện bản ghi không có tiếng nói, để không đưa im lặng hay tiếng ồn vào Whisper.

Whisper (cả PhoWhisper) gặp đoạn im lặng thường bịa ra một câu quen trong dữ liệu huấn luyện
(kiểu "Hãy đăng ký kênh...", "...một đoạn trích truyện ngắn"), con sẽ thấy chữ lạ trong ô nhập.

Chia audio thành khung 30 ms, tính RMS từng khung. Một khung là "có tiếng" khi thoả cả hai:
- đủ to tuyệt đối: từ -45 dBFS trở lên (thấp hơn giọng nói khẽ khoảng -35 dBFS, để không bỏ sót lời con);
- nổi hẳn trên nền ồn của chính bản ghi: cao hơn mức ồn nền (khung yên nhất, phân vị 10%) ít nhất 12 dB.
  Trình duyệt bật tự động khuếch đại (autoGainControl) nên lúc con im lặng, tiếng ồn phòng bị đẩy lên cao hơn
  -45 dBFS; tiếng ồn ấy đều đều nên không khung nào nổi hẳn lên trên nền, còn lời nói thì to nhỏ theo từng tiếng.
Tổng thời lượng khung có tiếng dưới 0,2 giây thì coi như con chưa nói.

Bản ghi quá ngắn để ước được nền ồn (dưới 10 khung) chỉ dùng ngưỡng tuyệt đối.
"""

import numpy as np

FRAME_SECONDS = 0.03
VOICED_RMS_THRESHOLD = 10 ** (-45 / 20)  # -45 dBFS với mẫu float trong [-1, 1]
MIN_VOICED_SECONDS = 0.2
NOISE_FLOOR_PERCENTILE = 10
ABOVE_FLOOR_RATIO = 10 ** (12 / 20)  # 12 dB trên nền ồn
MIN_FRAMES_FOR_FLOOR = 10


def has_speech(samples: np.ndarray, sample_rate: int) -> bool:
    """True khi có ít nhất `MIN_VOICED_SECONDS` giây khung đủ to và nổi hẳn trên nền ồn."""
    frame = max(1, int(sample_rate * FRAME_SECONDS))
    usable = samples.size - samples.size % frame
    if usable == 0:
        return False
    frames = samples[:usable].astype(np.float64).reshape(-1, frame)
    rms = np.sqrt(np.mean(frames * frames, axis=1))
    threshold = VOICED_RMS_THRESHOLD
    if rms.size >= MIN_FRAMES_FOR_FLOOR:
        floor = float(np.percentile(rms, NOISE_FLOOR_PERCENTILE))
        threshold = max(threshold, floor * ABOVE_FLOOR_RATIO)
    voiced_seconds = int(np.count_nonzero(rms >= threshold)) * frame / sample_rate
    return voiced_seconds >= MIN_VOICED_SECONDS
