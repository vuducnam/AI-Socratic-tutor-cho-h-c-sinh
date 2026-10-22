"""Lưới chặn cuối cho câu Whisper hay bịa khi gặp im lặng hay tiếng ồn (sau cổng `app.speech_activity`).

Đây là các câu kiểu phụ đề video có sẵn trong dữ liệu huấn luyện, không phải lời một học sinh lớp 5 nói khi học
Toán hay Lịch sử và Địa lí. Kết quả khớp một mẫu thì coi như con chưa nói (chữ rỗng → app nhắc con nói lại).
So trên chữ thường, bỏ dấu câu; chỉ thêm mẫu đã thấy thật (ghi ngày thấy), không đoán.
"""

import re
import unicodedata

HALLUCINATION_PATTERNS: tuple[re.Pattern[str], ...] = tuple(
    re.compile(p)
    for p in (
        r"đoạn trích truyện ngắn",  # thấy 2026-10-22: "chúng tôi rất vui khi được tiếp xúc với nhau trong một đoạn trích truyện ngắn"
        r"đăng ký kênh",
        r"đăng kí kênh",
        r"cảm ơn các bạn đã (theo dõi|xem|lắng nghe)",
        r"hẹn gặp lại các bạn (trong|ở) (những|các) video",
        r"\bsubscribe\b",
        r"\bvietsub\b",
        r"phụ đề (bởi|được)",
        r"thanks for watching",
    )
)


def _normalize(text: str) -> str:
    text = unicodedata.normalize("NFC", text).lower()
    return re.sub(r"[^\w\s]", " ", text).strip()


def is_hallucination(text: str) -> bool:
    normalized = _normalize(text)
    return any(pattern.search(normalized) for pattern in HALLUCINATION_PATTERNS)
