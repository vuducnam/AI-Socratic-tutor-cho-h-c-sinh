"""Phép toán an toàn trên `Rational` cho `app.safe_parse`: giới hạn kích thước, kiểu kết quả, lỗi và
bảng hàm được phép. Không parse chuỗi biểu thức ở đây (trừ một số literal); cú pháp xem `app.safe_parse`.
"""

from __future__ import annotations

import ast
import re
from dataclasses import dataclass
from decimal import Decimal
from typing import Callable

from sympy import Integer, Rational

MAX_EXPRESSION_LENGTH = 500
MAX_NUMBER_DIGITS = 30
MAX_DEPTH = 40
MAX_EXPONENT = 10
MAX_POW_BASE_BITS = 100  # ~30 chữ số thập phân
MAX_RESULT_BITS = 1400  # ~420 chữ số thập phân cho tử/mẫu của mọi kết quả trung gian
MAX_LIST_ITEMS = 50
MAX_ROUND_PLACES = 10

_NUMBER_LITERAL = re.compile(r"[0-9]+(?:\.[0-9]+)?")

Value = Rational | list[Rational]


class ExpressionRejected(ValueError):
    """Biểu thức không hợp lệ hoặc không an toàn; `code` ngắn gọn để máy đọc."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


@dataclass(frozen=True)
class Relation:
    """Kết quả của phép so sánh ở gốc biểu thức."""

    lhs: Rational
    op: str  # một trong "<", ">", "==", "<=", ">="
    rhs: Rational


@dataclass(frozen=True)
class Choice:
    """Kết quả của argmax/argmin: chỉ số 0-based trong danh sách đối số."""

    index: int


def parse_number_literal(text: str) -> Rational:
    """Chuyển chuỗi số không dấu (`0.45`, `12`) thành Rational chính xác, không qua float."""
    if not _NUMBER_LITERAL.fullmatch(text):
        raise ExpressionRejected("bad_number", f"số không hợp lệ: {text[:40]!r}")
    if sum(ch.isdigit() for ch in text) > MAX_NUMBER_DIGITS:
        raise ExpressionRejected("number_too_long", f"số quá {MAX_NUMBER_DIGITS} chữ số")
    numerator, denominator = Decimal(text).as_integer_ratio()
    return Rational(numerator, denominator)


def check_size(value: Rational) -> Rational:
    if int(value.p).bit_length() > MAX_RESULT_BITS or int(value.q).bit_length() > MAX_RESULT_BITS:
        raise ExpressionRejected("result_too_large", "kết quả trung gian quá lớn")
    return value


def _require_integer(value: Rational, what: str) -> int:
    if not value.is_integer:
        raise ExpressionRejected("not_integer", f"{what} phải là số nguyên")
    return int(value.p)


def round_half_up(value: Rational, places: int) -> Rational:
    """Làm tròn nửa lên (xa số 0 khi đúng nửa, như Decimal.ROUND_HALF_UP): 2.455 → 2.46."""
    scale = 10**places
    scaled = abs(value) * scale
    p, q = int(scaled.p), int(scaled.q)
    rounded = (2 * p + q) // (2 * q)
    sign = -1 if value < 0 else 1
    return Rational(sign * rounded, scale)


def _power(base: Rational, exponent: Rational) -> Rational:
    exp = _require_integer(exponent, "số mũ")
    if abs(exp) > MAX_EXPONENT:
        raise ExpressionRejected("exponent_too_large", f"số mũ vượt {MAX_EXPONENT}")
    if int(base.p).bit_length() > MAX_POW_BASE_BITS or int(base.q).bit_length() > MAX_POW_BASE_BITS:
        raise ExpressionRejected("base_too_large", "cơ số quá lớn")
    if base == 0 and exp < 0:
        raise ExpressionRejected("division_by_zero", "chia cho 0")
    return Rational(base) ** Integer(exp)


def _divide(lhs: Rational, rhs: Rational) -> Rational:
    if rhs == 0:
        raise ExpressionRejected("division_by_zero", "chia cho 0")
    return lhs / rhs


BIN_OPS: dict[type[ast.operator], Callable[[Rational, Rational], Rational]] = {
    ast.Add: lambda a, b: a + b,
    ast.Sub: lambda a, b: a - b,
    ast.Mult: lambda a, b: a * b,
    ast.Div: _divide,
    ast.Pow: _power,
}

COMPARE_OPS: dict[type[ast.cmpop], str] = {
    ast.Lt: "<",
    ast.Gt: ">",
    ast.Eq: "==",
    ast.LtE: "<=",
    ast.GtE: ">=",
}


def _fn_rational(args: list[Rational]) -> Rational:
    if len(args) != 2:
        raise ExpressionRejected("bad_arguments", "Rational cần đúng 2 đối số")
    numerator = _require_integer(args[0], "tử số")
    denominator = _require_integer(args[1], "mẫu số")
    if denominator == 0:
        raise ExpressionRejected("division_by_zero", "mẫu số bằng 0")
    return Rational(numerator, denominator)


def _fn_round_half_up(args: list[Rational]) -> Rational:
    if len(args) != 2:
        raise ExpressionRejected("bad_arguments", "round_half_up cần đúng 2 đối số (x, n)")
    places = _require_integer(args[1], "số chữ số làm tròn")
    if not 0 <= places <= MAX_ROUND_PLACES:
        raise ExpressionRejected("bad_arguments", f"số chữ số làm tròn phải từ 0 đến {MAX_ROUND_PLACES}")
    return round_half_up(args[0], places)


def _fn_abs(args: list[Rational]) -> Rational:
    if len(args) != 1:
        raise ExpressionRejected("bad_arguments", "abs cần đúng 1 đối số")
    return abs(args[0])


def _at_least_one(name: str, args: list[Rational]) -> list[Rational]:
    if not args:
        raise ExpressionRejected("bad_arguments", f"{name} cần ít nhất 1 đối số")
    return args


NUMBER_FUNCTIONS: dict[str, Callable[[list[Rational]], Rational]] = {
    "Rational": _fn_rational,
    "round_half_up": _fn_round_half_up,
    "abs": _fn_abs,
    "max": lambda args: max(_at_least_one("max", args)),
    "min": lambda args: min(_at_least_one("min", args)),
}

LIST_FUNCTIONS: dict[str, Callable[[list[Rational]], list[Rational]]] = {
    "sort_asc": lambda args: sorted(_at_least_one("sort_asc", args)),
    "sort_desc": lambda args: sorted(_at_least_one("sort_desc", args), reverse=True),
}

CHOICE_FUNCTIONS = ("argmax", "argmin")
