"""So khớp đáp án kỳ vọng của Pre-solver với kết quả tính được (SPEC §15.7, §8.3 `sympy_check`).

Hợp đồng theo `kind` (biểu thức theo cú pháp ở `app.safe_parse`; số dùng dấu CHẤM thập phân):

| kind          | expression                         | expected                          | computed            |
|---------------|------------------------------------|-----------------------------------|---------------------|
| `number`      | biểu thức ra một số: `0.45+0.5`    | chuỗi số: `"0.95"`, `"-2"`, `"1/3"` | `"0.95"`            |
| `number_list` | `[a, b]` hoặc `sort_asc(...)`      | danh sách chuỗi số, đúng thứ tự   | `["0.3", "0.4"]`    |
| `relation`    | một phép so sánh: `0.45 < 0.5`     | dấu `"<"`, `">"`, `"="` (`"=="`)  | dấu thật giữa hai vế |
|               |                                    | hoặc `"true"` / `"false"`         |                     |
| `choice`      | `argmax(a, b, ...)` / `argmin(...)` | chỉ số 0-based dạng chuỗi: `"1"`  | `"1"`               |

- So sánh số chính xác bằng `Rational`: `"9.40"` khớp `9.4`. `computed` là số thập phân chuẩn hoá (bỏ
  số 0 thừa); phân số không viết được thành số thập phân hữu hạn thì ghi `"p/q"`.
- `relation` với expected là dấu: ok khi phép so sánh trong expression ĐÚNG và dấu thật trùng expected
  (Pre-solver tự nêu nhận định, verifier kiểm cả nhận định lẫn đáp án). Với `"true"`/`"false"`: ok khi giá
  trị của phép so sánh bằng expected.
- `choice`: đáp án là một lựa chọn trong đề (ví dụ bạn nhảy xa nhất). Pre-solver liệt kê dữ liệu theo thứ
  tự các lựa chọn và nêu chỉ số; hoà (nhiều phần tử bằng nhau) → `ok=false`, `ambiguous_choice`.
- Không bao giờ ném lỗi: mọi từ chối trả `{"ok": False, "computed": None, "detail": "<code>: <lý do>"}`.
"""

from __future__ import annotations

import re
from typing import Literal, TypedDict

from sympy import Rational

from app.safe_parse import (
    MAX_LIST_ITEMS,
    Choice,
    ExpressionRejected,
    Relation,
    evaluate,
    parse_number_literal,
)

Kind = Literal["number", "number_list", "relation", "choice"]
KINDS: tuple[Kind, ...] = ("number", "number_list", "relation", "choice")

MAX_EXPECTED_LENGTH = 64
_EXPECTED_FRACTION = re.compile(r"(-?)([0-9]+)/([0-9]+)")
_EXPECTED_INDEX = re.compile(r"[0-9]{1,3}")
_SIGN_ALIASES = {"<": "<", ">": ">", "=": "=", "==": "="}
_RELATION_HOLDS = {
    "<": lambda a, b: a < b,
    ">": lambda a, b: a > b,
    "==": lambda a, b: a == b,
    "<=": lambda a, b: a <= b,
    ">=": lambda a, b: a >= b,
}


class VerifyResult(TypedDict):
    ok: bool
    computed: str | list[str] | None
    detail: str


def _result(ok: bool, computed: str | list[str] | None, detail: str) -> VerifyResult:
    return {"ok": ok, "computed": computed, "detail": detail}


def _reject(code: str, message: str) -> VerifyResult:
    return _result(False, None, f"{code}: {message}")


def format_number(value: Rational) -> str:
    """Rational → chuỗi thập phân dấu chấm, bỏ số 0 thừa; mẫu có ước nguyên tố khác 2, 5 → `p/q`."""
    p, q = int(value.p), int(value.q)
    rest, twos, fives = q, 0, 0
    while rest % 2 == 0:
        rest //= 2
        twos += 1
    while rest % 5 == 0:
        rest //= 5
        fives += 1
    if rest != 1:
        return f"{p}/{q}"
    places = max(twos, fives)
    digits = str(abs(p) * 10**places // q).rjust(places + 1, "0")
    sign = "-" if p < 0 else ""
    if places == 0:
        return f"{sign}{digits}"
    integer_part, fraction_part = digits[:-places], digits[-places:].rstrip("0")
    return f"{sign}{integer_part}.{fraction_part}" if fraction_part else f"{sign}{integer_part}"


def parse_expected_number(text: object) -> Rational:
    """Đáp án kỳ vọng dạng số: `0.95`, `-2`, `1/3` (không nhận biểu thức)."""
    if not isinstance(text, str) or not text or len(text) > MAX_EXPECTED_LENGTH:
        raise ExpressionRejected("bad_expected", "expected phải là chuỗi số ngắn")
    try:
        return _parse_expected_text(text)
    except ExpressionRejected as exc:
        raise ExpressionRejected("bad_expected", f"expected không hợp lệ ({exc})") from None


def _parse_expected_text(text: str) -> Rational:
    fraction = _EXPECTED_FRACTION.fullmatch(text)
    if fraction:
        sign, numerator, denominator = fraction.groups()
        num = parse_number_literal(numerator)
        den = parse_number_literal(denominator)
        if den == 0:
            raise ExpressionRejected("bad_expected", "mẫu số bằng 0")
        return -num / den if sign else num / den
    if text.startswith("-"):
        return -parse_number_literal(text[1:])
    return parse_number_literal(text)


def _verify_number(value: object, expected: object) -> VerifyResult:
    if not isinstance(value, Rational):
        return _reject("type_mismatch", "kind number cần biểu thức ra một số")
    target = parse_expected_number(expected)
    computed = format_number(value)
    if value == target:
        return _result(True, computed, "match")
    return _result(False, computed, f"mismatch: tính được {computed}, kỳ vọng {format_number(target)}")


def _verify_number_list(value: object, expected: object) -> VerifyResult:
    if not isinstance(value, list):
        return _reject("type_mismatch", "kind number_list cần biểu thức ra danh sách số")
    if not isinstance(expected, list) or len(expected) > MAX_LIST_ITEMS:
        return _reject("bad_expected", f"expected phải là danh sách tối đa {MAX_LIST_ITEMS} chuỗi số")
    targets = [parse_expected_number(item) for item in expected]
    computed = [format_number(item) for item in value]
    if len(targets) != len(value):
        return _result(False, computed, f"mismatch: tính được {len(value)} số, kỳ vọng {len(targets)} số")
    for index, (got, want) in enumerate(zip(value, targets)):
        if got != want:
            return _result(False, computed, f"mismatch: vị trí {index} tính được {computed[index]}, kỳ vọng {format_number(want)}")
    return _result(True, computed, "match")


def _verify_relation(value: object, expected: object) -> VerifyResult:
    if not isinstance(value, Relation):
        return _reject("type_mismatch", "kind relation cần đúng một phép so sánh")
    actual_sign = "<" if value.lhs < value.rhs else ">" if value.lhs > value.rhs else "="
    claim_holds = bool(_RELATION_HOLDS[value.op](value.lhs, value.rhs))
    if expected in ("true", "false"):
        ok = claim_holds == (expected == "true")
        return _result(ok, actual_sign, "match" if ok else f"mismatch: phép so sánh có giá trị {str(claim_holds).lower()}")
    if not isinstance(expected, str) or expected not in _SIGN_ALIASES:
        return _reject("bad_expected", 'expected của relation là "<", ">", "=", "true" hoặc "false"')
    if not claim_holds:
        return _result(False, actual_sign, f"claim_false: phép so sánh trong expression sai, dấu đúng là {actual_sign}")
    if _SIGN_ALIASES[expected] != actual_sign:
        return _result(False, actual_sign, f"mismatch: dấu đúng là {actual_sign}, kỳ vọng {expected}")
    return _result(True, actual_sign, "match")


def _verify_choice(value: object, expected: object) -> VerifyResult:
    if not isinstance(value, Choice):
        return _reject("type_mismatch", "kind choice cần biểu thức argmax(...) hoặc argmin(...)")
    if not isinstance(expected, str) or not _EXPECTED_INDEX.fullmatch(expected):
        return _reject("bad_expected", "expected của choice là chỉ số 0-based dạng chuỗi")
    computed = str(value.index)
    if value.index == int(expected):
        return _result(True, computed, "match")
    return _result(False, computed, f"mismatch: lựa chọn đúng là {computed}, kỳ vọng {expected}")


_HANDLERS = {
    "number": _verify_number,
    "number_list": _verify_number_list,
    "relation": _verify_relation,
    "choice": _verify_choice,
}


def verify(kind: str, expression: str, expected: str | list[str]) -> VerifyResult:
    """Hàm thuần, chạy trong tiến trình con của sandbox. Không bao giờ ném ExpressionRejected."""
    handler = _HANDLERS.get(kind)
    if handler is None:
        return _reject("bad_kind", f"kind phải là một trong {', '.join(KINDS)}")
    if not isinstance(expression, str):
        return _reject("bad_expression", "expression phải là chuỗi")
    try:
        return handler(evaluate(expression), expected)
    except ExpressionRejected as exc:
        return _reject(exc.code, str(exc))
