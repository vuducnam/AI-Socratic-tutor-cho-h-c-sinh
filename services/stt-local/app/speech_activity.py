"""Phát hiện bản ghi không có tiếng nói, để không đưa im lặng hay tiếng ồn nhỏ vào Whisper.

Whisper (cả PhoWhisper) gặp đoạn im lặng thường bịa ra một câu quen trong dữ liệu huấn luyện
(kiểu "Hãy đăng ký kênh..."), con sẽ thấy chữ lạ trong ô nhập. Cổng năng lượng đơn giản: chia audio
thành khung 30 ms, khung có RMS từ -45 dBFS trở lên tính là có tiếng; tổng thời lượng khung có tiếng
dưới 0,2 giây thì coi như con chưa nói. Ngưỡng thấp hơn giọng nói khẽ (khoảng -35 dBFS) để không
bỏ sót lời con, chỉ chặn im lặng thật và tiếng ồn phòng.
"""

import numpy as np

FRAME_SECONDS = 0.03
VOICED_RMS_THRESHOLD = 10 ** (-45 / 20)  # -45 dBFS với mẫu float trong [-1, 1]
MIN_VOICED_SECONDS = 0.2


def has_speech(samples: np.ndarray, sample_rate: int) -> bool:
    """True khi có ít nhất `MIN_VOICED_SECONDS` giây khung đủ to để là tiếng nói."""
    frame = max(1, int(sample_rate * FRAME_SECONDS))
    usable = samples.size - samples.size % frame
    if usable == 0:
        return False
    frames = samples[:usable].astype(np.float64).reshape(-1, frame)
    rms = np.sqrt(np.mean(frames * frames, axis=1))
    voiced_seconds = int(np.count_nonzero(rms >= VOICED_RMS_THRESHOLD)) * frame / sample_rate
    return voiced_seconds >= MIN_VOICED_SECONDS
