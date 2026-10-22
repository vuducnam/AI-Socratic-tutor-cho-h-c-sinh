"""Bộ nghiệm thu 30 đề số thập phân lớp 5: mỗi `answer.machine` phải parse và verify được.

File đề bị git-ignore có chủ đích (không commit nội dung đề); thiếu file thì skip.
Đề so sánh lấy hai số từ đề (dấu phẩy → dấu chấm) để verify dấu đáp án; đề sắp xếp verify bằng
`sort_asc` trên các số đảo thứ tự.
"""

import re
from pathlib import Path
from typing import Any

import pytest

from app.verify import verify

PROBLEMS_FILE = Path(__file__).resolve().parent.parent.parent.parent / "eval/problems/decimal/grade5-decimal-acceptance-problems.yaml"
_DECIMAL_IN_TEXT = re.compile(r"[0-9]+(?:,[0-9]+)?")


def _load_problems() -> list[dict[str, Any]]:
    if not PROBLEMS_FILE.is_file():
        return []
    yaml = pytest.importorskip("yaml")
    data = yaml.safe_load(PROBLEMS_FILE.read_text(encoding="utf-8"))
    return list(data.get("problems", []))


PROBLEMS = _load_problems()


def _request_for(problem: dict[str, Any]) -> tuple[str, str, str | list[str]]:
    machine: list[str] = problem["answer"]["machine"]
    if problem["kind"] == "compare":
        operands = [m.replace(",", ".") for m in _DECIMAL_IN_TEXT.findall(problem["text"].split(":", 1)[-1])]
        assert len(operands) == 2, f"{problem['id']}: cần đúng 2 số để so sánh"
        sign = machine[0]
        return "relation", f"{operands[0]} {'==' if sign == '=' else sign} {operands[1]}", sign
    if problem["kind"] == "order":
        return "number_list", f"sort_asc({', '.join(reversed(machine))})", machine
    if len(machine) > 1:
        return "number_list", f"[{', '.join(machine)}]", machine
    return "number", machine[0], machine[0]


@pytest.mark.skipif(not PROBLEMS, reason="thiếu file đề nghiệm thu (git-ignore)")
def test_acceptance_file_has_30_problems() -> None:
    assert len(PROBLEMS) == 30


@pytest.mark.skipif(not PROBLEMS, reason="thiếu file đề nghiệm thu (git-ignore)")
@pytest.mark.parametrize("problem", PROBLEMS, ids=[p.get("id", "?") for p in PROBLEMS])
def test_machine_answer_verifies(problem: dict[str, Any]) -> None:
    kind, expression, expected = _request_for(problem)
    result = verify(kind, expression, expected)
    assert result["ok"] is True, result
