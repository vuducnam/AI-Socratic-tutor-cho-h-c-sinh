"""Parse và tính biểu thức toán do Pre-solver sinh, KHÔNG dùng eval/exec/sympify/parse_expr.

Chuỗi đầu vào do LLM sinh nên coi là không tin cậy (có thể bị ảnh hưởng bởi ảnh đề hoặc lời của con).
`sympify`/`parse_expr` đều gọi `eval()`, whitelist tên hàm không phải sandbox, nên ở đây:

1. Kiểm độ dài (≤ MAX_EXPRESSION_LENGTH) và bảng ký tự cho phép (không có dấu nháy, `@`, `!`...).
2. `ast.parse(mode="eval")` rồi tự duyệt cây; chỉ chấp nhận các nút liệt kê dưới đây, mọi nút khác
   (Name đứng riêng, Attribute, Subscript, Lambda, comprehension, keyword, Starred, Tuple...) bị từ chối.
3. Tự dựng đối tượng sympy (`Rational`) từ chuỗi gốc của từng số qua `Decimal` — không bao giờ qua float.

Cú pháp được phép:
- Số: chữ số `0-9` với tối đa một dấu chấm thập phân (`0.45`, `12`), ≤ MAX_NUMBER_DIGITS chữ số.
  Không nhận `1e5`, `0x1F`, `1_000`, `1j`, `True`. Dấu phẩy KHÔNG phải dấu thập phân (Tuple bị cấm).
- Toán tử: `+ - * /`, `**` với số mũ nguyên |mũ| ≤ MAX_EXPONENT và cơ số ≤ MAX_POW_BASE_BITS bit;
  dấu `+x`, `-x`; danh sách số `[a, b, ...]` (≤ MAX_LIST_ITEMS phần tử, không lồng nhau).
- Hàm (chỉ đối số vị trí): `Rational(a, b)` (a, b nguyên, b ≠ 0), `round_half_up(x, n)` (làm tròn nửa
  lên, 0 ≤ n ≤ MAX_ROUND_PLACES), `max(...)`, `min(...)`, `abs(x)`, `sort_asc(...)`, `sort_desc(...)`.
- Chỉ ở gốc biểu thức: một phép so sánh `A < B`, `A > B`, `A == B`, `A <= B`, `A >= B` (trả `Relation`),
  hoặc `argmax(...)` / `argmin(...)` (trả `Choice` — chỉ số 0-based của phần tử lớn/nhỏ nhất; hoà → lỗi).

Mọi kết quả trung gian bị chặn kích thước (MAX_RESULT_BITS); độ sâu cây ≤ MAX_DEPTH. Lỗi luôn là
`ExpressionRejected(code, message)` để verify trả `ok=false` kèm lý do.
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

_ALLOWED_CHARS = re.compile(r"[0-9A-Za-z_.,+\-*/()\[\]<>= ]*")
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


def _check_size(value: Rational) -> Rational:
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


_BIN_OPS: dict[type[ast.operator], Callable[[Rational, Rational], Rational]] = {
    ast.Add: lambda a, b: a + b,
    ast.Sub: lambda a, b: a - b,
    ast.Mult: lambda a, b: a * b,
    ast.Div: _divide,
    ast.Pow: _power,
}

_COMPARE_OPS: dict[type[ast.cmpop], str] = {
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


_NUMBER_FUNCTIONS: dict[str, Callable[[list[Rational]], Rational]] = {
    "Rational": _fn_rational,
    "round_half_up": _fn_round_half_up,
    "abs": _fn_abs,
    "max": lambda args: max(_at_least_one("max", args)),
    "min": lambda args: min(_at_least_one("min", args)),
}

_LIST_FUNCTIONS: dict[str, Callable[[list[Rational]], list[Rational]]] = {
    "sort_asc": lambda args: sorted(_at_least_one("sort_asc", args)),
    "sort_desc": lambda args: sorted(_at_least_one("sort_desc", args), reverse=True),
}

_CHOICE_FUNCTIONS = ("argmax", "argmin")


class _Evaluator:
    def __init__(self, source: str) -> None:
        self._source = source

    def number(self, node: ast.expr, depth: int) -> Rational:
        value = self.value(node, depth)
        if isinstance(value, list):
            raise ExpressionRejected("type_mismatch", "cần một số, nhận danh sách")
        return value

    def value(self, node: ast.expr, depth: int) -> Value:
        if depth > MAX_DEPTH:
            raise ExpressionRejected("too_deep", f"biểu thức lồng quá {MAX_DEPTH} tầng")
        if isinstance(node, ast.Constant):
            if type(node.value) not in (int, float):
                raise ExpressionRejected("unsafe_syntax", "chỉ cho phép hằng số là số")
            segment = ast.get_source_segment(self._source, node)
            if segment is None:
                raise ExpressionRejected("bad_number", "không đọc được số")
            return parse_number_literal(segment)
        if isinstance(node, ast.UnaryOp) and isinstance(node.op, (ast.UAdd, ast.USub)):
            operand = self.number(node.operand, depth + 1)
            return operand if isinstance(node.op, ast.UAdd) else -operand
        if isinstance(node, ast.BinOp) and type(node.op) in _BIN_OPS:
            lhs = self.number(node.left, depth + 1)
            rhs = self.number(node.right, depth + 1)
            return _check_size(_BIN_OPS[type(node.op)](lhs, rhs))
        if isinstance(node, ast.List):
            if len(node.elts) > MAX_LIST_ITEMS:
                raise ExpressionRejected("list_too_long", f"danh sách quá {MAX_LIST_ITEMS} phần tử")
            return [self.number(item, depth + 1) for item in node.elts]
        if isinstance(node, ast.Call):
            name = self.call_name(node)
            args = self.call_args(node, depth)
            if name in _NUMBER_FUNCTIONS:
                return _check_size(_NUMBER_FUNCTIONS[name](args))
            if name in _LIST_FUNCTIONS:
                return _LIST_FUNCTIONS[name](args)
            if name in _CHOICE_FUNCTIONS:
                raise ExpressionRejected("unsafe_syntax", f"{name} chỉ được đứng ở gốc biểu thức")
            raise ExpressionRejected("unknown_function", f"hàm không được phép: {name[:40]}")
        raise ExpressionRejected("unsafe_syntax", f"cú pháp không được phép: {type(node).__name__}")

    def call_name(self, node: ast.Call) -> str:
        if not isinstance(node.func, ast.Name):
            raise ExpressionRejected("unsafe_syntax", f"lời gọi không được phép: {type(node.func).__name__}")
        if node.keywords:
            raise ExpressionRejected("unsafe_syntax", "không cho phép đối số từ khoá")
        return node.func.id

    def call_args(self, node: ast.Call, depth: int) -> list[Rational]:
        if len(node.args) > MAX_LIST_ITEMS:
            raise ExpressionRejected("list_too_long", f"quá {MAX_LIST_ITEMS} đối số")
        # Starred (`*x`) không phải số nên self.number từ chối.
        return [self.number(arg, depth + 1) for arg in node.args]

    def top(self, node: ast.expr) -> Value | Relation | Choice:
        if isinstance(node, ast.Compare):
            if len(node.ops) != 1 or type(node.ops[0]) not in _COMPARE_OPS:
                raise ExpressionRejected("unsafe_syntax", "chỉ cho phép đúng một phép so sánh < > == <= >=")
            return Relation(
                lhs=self.number(node.left, 1),
                op=_COMPARE_OPS[type(node.ops[0])],
                rhs=self.number(node.comparators[0], 1),
            )
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id in _CHOICE_FUNCTIONS:
            name = self.call_name(node)
            args = self.call_args(node, 0)
            if len(args) < 2:
                raise ExpressionRejected("bad_arguments", f"{name} cần ít nhất 2 lựa chọn")
            best = max(args) if name == "argmax" else min(args)
            indexes = [i for i, item in enumerate(args) if item == best]
            if len(indexes) != 1:
                raise ExpressionRejected("ambiguous_choice", "có nhiều lựa chọn bằng nhau")
            return Choice(index=indexes[0])
        return self.value(node, 0)


def _check_bracket_depth(expression: str) -> None:
    """Chặn ngoặc lồng quá sâu trước khi parse (ngoặc tròn thừa không tạo nút AST nên cần kiểm riêng)."""
    depth = 0
    for ch in expression:
        if ch in "([":
            depth += 1
            if depth > MAX_DEPTH:
                raise ExpressionRejected("too_deep", f"ngoặc lồng quá {MAX_DEPTH} tầng")
        elif ch in ")]":
            depth -= 1


def evaluate(expression: str) -> Value | Relation | Choice:
    """Tính biểu thức theo cú pháp hạn chế ở docstring của module."""
    if len(expression) > MAX_EXPRESSION_LENGTH:
        raise ExpressionRejected("too_long", f"biểu thức quá {MAX_EXPRESSION_LENGTH} ký tự")
    if not expression.strip():
        raise ExpressionRejected("empty", "biểu thức rỗng")
    if not _ALLOWED_CHARS.fullmatch(expression):
        raise ExpressionRejected("bad_character", "biểu thức chứa ký tự không được phép")
    _check_bracket_depth(expression)
    try:
        tree = ast.parse(expression.strip(), mode="eval")
    except (SyntaxError, ValueError, RecursionError, MemoryError) as exc:
        raise ExpressionRejected("syntax_error", f"không parse được: {type(exc).__name__}") from None
    return _Evaluator(expression.strip()).top(tree.body)
