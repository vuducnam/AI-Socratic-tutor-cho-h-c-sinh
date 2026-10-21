"""WER theo từ cho stt-bench: chuẩn hoá chữ tiếng Việt/Anh rồi tính khoảng cách Levenshtein."""

import re
import unicodedata

_TOKEN = re.compile(r"\d+(?:[.,]\d+)*|[^\W\d_]+")


def normalize_words(text: str) -> list[str]:
    """NFC + chữ thường; bỏ dấu câu, giữ số thập phân (`4,5`) thành một từ."""
    return _TOKEN.findall(unicodedata.normalize("NFC", text).lower())


def word_errors(reference: list[str], hypothesis: list[str]) -> int:
    """Khoảng cách Levenshtein theo từ (thay + xoá + chèn)."""
    previous = list(range(len(hypothesis) + 1))
    for row, ref_word in enumerate(reference, start=1):
        current = [row]
        for column, hyp_word in enumerate(hypothesis, start=1):
            current.append(
                min(
                    previous[column] + 1,
                    current[column - 1] + 1,
                    previous[column - 1] + (ref_word != hyp_word),
                )
            )
        previous = current
    return previous[-1]


def wer(reference: str, hypothesis: str) -> float:
    ref_words = normalize_words(reference)
    if not ref_words:
        raise ValueError("câu tham chiếu rỗng")
    return word_errors(ref_words, normalize_words(hypothesis)) / len(ref_words)
