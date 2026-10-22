"""Kiểm hợp đồng verify theo 4 kiểu đáp án, làm tròn nửa lên và từ chối payload độc (gọi trực tiếp, không sandbox)."""

import pytest

from app.safe_parse import MAX_EXPRESSION_LENGTH
from app.verify import format_number, verify


def code_of(detail: str) -> str:
    return detail.split(":", 1)[0]


# ---- number ----


@pytest.mark.parametrize(
    ("expression", "expected", "computed"),
    [
        ("0.45+0.5", "0.95", "0.95"),
        ("3.45 + 2.7", "6.15", "6.15"),
        ("12.08 + 7.925", "20.005", "20.005"),
        ("0.1 + 0.2", "0.3", "0.3"),  # float sẽ ra 0.30000000000000004
        ("4.7 * 2", "9.40", "9.4"),  # bỏ số 0 thừa
        ("3 + 7/100", "3.07", "3.07"),
        ("1250 / 1000", "1.25", "1.25"),
        ("Rational(45, 100)", "0.45", "0.45"),
        ("1/3", "1/3", "1/3"),
        ("2 - 5", "-3", "-3"),
        ("-(1.5)", "-1.5", "-1.5"),
        ("max(2.85, 2.9, 2.805)", "2.9", "2.9"),
        ("min(2.85, 2.9, 2.805)", "2.805", "2.805"),
        ("abs(1 - 3.5)", "2.5", "2.5"),
        ("2 ** 10", "1024", "1024"),
        ("10 ** -2", "0.01", "0.01"),
    ],
)
def test_number_correct(expression: str, expected: str, computed: str) -> None:
    assert verify("number", expression, expected) == {"ok": True, "computed": computed, "detail": "match"}


def test_number_wrong_answer_reports_computed() -> None:
    result = verify("number", "0.45+0.5", "0.9")
    assert result["ok"] is False
    assert result["computed"] == "0.95"
    assert code_of(result["detail"]) == "mismatch"


def test_number_rejects_list_expression_and_bad_expected() -> None:
    assert code_of(verify("number", "[1, 2]", "1")["detail"]) == "type_mismatch"
    assert code_of(verify("number", "1", "0,5")["detail"]) == "bad_expected"
    assert code_of(verify("number", "1", "1+0")["detail"]) == "bad_expected"
    assert code_of(verify("number", "1", ["1"])["detail"]) == "bad_expected"


def test_comma_is_not_a_decimal_separator() -> None:
    # "0,45" là Tuple trong Python; bị từ chối thay vì hiểu thành [0, 45].
    result = verify("number", "0,45", "0.45")
    assert result["ok"] is False
    assert code_of(result["detail"]) == "unsafe_syntax"


def test_division_by_zero_rejected() -> None:
    assert code_of(verify("number", "1/0", "0")["detail"]) == "division_by_zero"
    assert code_of(verify("number", "Rational(1, 0)", "0")["detail"]) == "division_by_zero"
    assert code_of(verify("number", "0 ** -1", "0")["detail"]) == "division_by_zero"


# ---- làm tròn nửa lên ----


@pytest.mark.parametrize(
    ("expression", "expected"),
    [
        ("round_half_up(2.455, 2)", "2.46"),  # round() của Python cho 2.45 vì float + banker's rounding
        ("round_half_up(2.5, 0)", "3"),  # banker's rounding cho 2
        ("round_half_up(0.125, 2)", "0.13"),
        ("round_half_up(4.67, 0)", "5"),
        ("round_half_up(12.348, 1)", "12.3"),
        ("round_half_up(5 + 7/100, 1)", "5.1"),
        ("round_half_up(-2.455, 2)", "-2.46"),
        ("round_half_up(2.449, 2)", "2.45"),
    ],
)
def test_round_half_up(expression: str, expected: str) -> None:
    assert verify("number", expression, expected)["ok"] is True


def test_round_half_up_rejects_bad_places() -> None:
    assert code_of(verify("number", "round_half_up(1.5, 11)", "2")["detail"]) == "bad_arguments"
    assert code_of(verify("number", "round_half_up(1.5, 0.5)", "2")["detail"]) == "not_integer"
    assert code_of(verify("number", "round_half_up(1.5)", "2")["detail"]) == "bad_arguments"


# ---- number_list ----


def test_number_list_order_matters() -> None:
    expected = ["0.3", "0.325", "0.38", "0.4"]
    assert verify("number_list", "sort_asc(0.38, 0.4, 0.325, 0.3)", expected)["ok"] is True
    assert verify("number_list", "[0.3, 0.325, 0.38, 0.40]", expected) == {
        "ok": True,
        "computed": ["0.3", "0.325", "0.38", "0.4"],
        "detail": "match",
    }
    wrong = verify("number_list", "sort_desc(0.38, 0.4, 0.325, 0.3)", expected)
    assert wrong["ok"] is False and code_of(wrong["detail"]) == "mismatch"
    assert wrong["computed"] == ["0.4", "0.38", "0.325", "0.3"]


def test_number_list_length_and_type_mismatch() -> None:
    assert verify("number_list", "[0.7, 0.45]", ["0.7"])["ok"] is False
    assert code_of(verify("number_list", "0.7", ["0.7"])["detail"]) == "type_mismatch"
    assert code_of(verify("number_list", "[0.7]", "0.7")["detail"]) == "bad_expected"
    assert code_of(verify("number_list", "[[1], 2]", ["1", "2"])["detail"]) == "type_mismatch"


# ---- relation ----


@pytest.mark.parametrize(
    ("expression", "expected"),
    [
        ("0.45 < 0.5", "<"),
        ("7.3 == 7.30", "="),
        ("7.3 == 7.30", "=="),
        ("2.9 > 2.85", ">"),
        ("0.45 <= 0.5", "<"),
        ("0.45 < 0.5", "true"),
        ("0.45 > 0.5", "false"),
    ],
)
def test_relation_correct(expression: str, expected: str) -> None:
    assert verify("relation", expression, expected)["ok"] is True


def test_relation_wrong() -> None:
    claim_false = verify("relation", "0.45 > 0.5", ">")
    assert claim_false == {"ok": False, "computed": "<", "detail": claim_false["detail"]}
    assert code_of(claim_false["detail"]) == "claim_false"
    assert code_of(verify("relation", "0.45 <= 0.5", "=")["detail"]) == "mismatch"
    assert verify("relation", "0.45 < 0.5", "false")["ok"] is False
    assert code_of(verify("relation", "0.45 < 0.5", "lt")["detail"]) == "bad_expected"
    assert code_of(verify("relation", "0.45", "<")["detail"]) == "type_mismatch"
    assert code_of(verify("relation", "1 < 2 < 3", "<")["detail"]) == "unsafe_syntax"
    assert code_of(verify("relation", "1 != 2", "<")["detail"]) == "bad_character"


# ---- choice ----


def test_choice_index() -> None:
    assert verify("choice", "argmax(2.85, 2.9, 2.805)", "1") == {"ok": True, "computed": "1", "detail": "match"}
    assert verify("choice", "argmin(2.85, 2.9, 2.805)", "2")["ok"] is True
    wrong = verify("choice", "argmax(2.85, 2.9, 2.805)", "0")
    assert wrong["ok"] is False and wrong["computed"] == "1"


def test_choice_rejections() -> None:
    assert code_of(verify("choice", "argmax(2.9, 2.90, 1)", "0")["detail"]) == "ambiguous_choice"
    assert code_of(verify("choice", "argmax(2.9)", "0")["detail"]) == "bad_arguments"
    assert code_of(verify("choice", "max(1, 2)", "1")["detail"]) == "type_mismatch"
    assert code_of(verify("choice", "argmax(1, 2)", "first")["detail"]) == "bad_expected"
    assert code_of(verify("number", "1 + argmax(1, 2)", "2")["detail"]) == "unsafe_syntax"


def test_bad_kind() -> None:
    assert code_of(verify("eval", "1", "1")["detail"]) == "bad_kind"


# ---- payload độc ----


@pytest.mark.parametrize(
    ("expression", "code"),
    [
        ("__import__('os')", "bad_character"),
        ("__import__(1)", "unknown_function"),
        ("().__class__.__base__", "unsafe_syntax"),
        ("(1).__class__", "unsafe_syntax"),
        ("x", "unsafe_syntax"),
        ("abs.__call__(1)", "unsafe_syntax"),
        ("lambda: 1", "bad_character"),
        ("(lambda x: x)(1)", "bad_character"),
        ("[x for x in [1]]", "unsafe_syntax"),
        ("[1][0]", "unsafe_syntax"),
        ("max(*[1, 2])", "unsafe_syntax"),
        ("round_half_up(x=1, n=2)", "unsafe_syntax"),
        ("open(1)", "unknown_function"),
        ("eval(1)", "unknown_function"),
        ("True", "unsafe_syntax"),
        ("None", "unsafe_syntax"),
        ("1e400", "bad_number"),
        ("0x1F", "bad_number"),
        ("1_000", "bad_number"),
        ("1j", "unsafe_syntax"),
        ("7 // 2", "unsafe_syntax"),
        ("7 % 2", "bad_character"),
        ("1" * 31, "number_too_long"),
        ("10**10**9", "exponent_too_large"),
        ("9**9**9**9", "exponent_too_large"),
        ("2 ** 11", "exponent_too_large"),
        ("2 ** 0.5", "not_integer"),
        ("((10**10)**10)**10", "base_too_large"),
        ("", "empty"),
        ("1 +", "syntax_error"),
        ("1;2", "bad_character"),
        ("1\n+1", "bad_character"),
        ("１", "bad_character"),  # chữ số toàn khổ (fullwidth)
    ],
)
def test_malicious_or_invalid_rejected(expression: str, code: str) -> None:
    result = verify("number", expression, "1")
    assert result["ok"] is False
    assert result["computed"] is None
    assert code_of(result["detail"]) == code


def test_very_long_string_rejected() -> None:
    result = verify("number", "1+" * 300 + "1", "301")
    assert code_of(result["detail"]) == "too_long"
    assert len("1+" * 300 + "1") > MAX_EXPRESSION_LENGTH
    assert code_of(verify("number", "1" * 100_000, "1")["detail"]) == "too_long"


@pytest.mark.parametrize(
    "expression",
    [
        "(" * 200 + "1" + ")" * 200,
        "-" * 400 + "1",
        "[" * 100 + "1" + "]" * 100,
        "abs(" * 60 + "1" + ")" * 60,
    ],
)
def test_deeply_nested_rejected(expression: str) -> None:
    result = verify("number", expression, "1")
    assert result["ok"] is False
    assert code_of(result["detail"]) == "too_deep"


def test_moderate_nesting_still_allowed() -> None:
    assert verify("number", "(" * 30 + "1" + ")" * 30, "1")["ok"] is True


def test_huge_but_bounded_product_rejected() -> None:
    # Mỗi luỹ thừa ~ 300 chữ số; tích nhiều luỹ thừa vượt trần kích thước kết quả.
    expression = "*".join(["(999999999999999999999999999999**10)"] * 10)
    assert len(expression) <= MAX_EXPRESSION_LENGTH
    assert code_of(verify("number", expression, "1")["detail"]) == "result_too_large"


# ---- định dạng ----


@pytest.mark.parametrize(
    ("numerator", "denominator", "text"),
    [(47, 5, "9.4"), (0, 1, "0"), (-1, 8, "-0.125"), (1, 3, "1/3"), (3754, 10, "375.4"), (5, 100, "0.05")],
)
def test_format_number(numerator: int, denominator: int, text: str) -> None:
    from sympy import Rational

    assert format_number(Rational(numerator, denominator)) == text
