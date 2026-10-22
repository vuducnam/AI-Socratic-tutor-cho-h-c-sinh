"""Câu Whisper hay bịa khi gặp im lặng bị coi là chưa nói; lời học sinh thật thì giữ nguyên."""

from app.hallucination_filter import is_hallucination


def test_known_silence_hallucinations() -> None:
    assert is_hallucination("Chúng tôi rất vui khi được tiếp xúc với nhau trong một đoạn trích truyện ngắn.")
    assert is_hallucination("Hãy đăng ký kênh để ủng hộ nhé!")
    assert is_hallucination("Cảm ơn các bạn đã theo dõi")


def test_real_student_answers_are_kept() -> None:
    assert not is_hallucination("Mít ơi, bốn phẩy năm cộng một bằng năm phẩy năm")
    assert not is_hallucination("Ngô Quyền cho đóng cọc dưới sông")
    assert not is_hallucination("Cảm ơn Mít nha")