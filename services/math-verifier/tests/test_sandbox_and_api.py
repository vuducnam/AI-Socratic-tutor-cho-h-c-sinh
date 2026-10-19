"""Kiểm sandbox (giết tiến trình con khi quá giờ/quá bộ nhớ) và API /verify end-to-end."""

import sys
import time

import pytest
from fastapi.testclient import TestClient

from app.main import MAX_BODY_BYTES, app
from app.sandbox import SandboxFailure, run_isolated

client = TestClient(app)


def _spin_forever() -> None:
    while True:
        pass


def _allocate_huge() -> int:
    return len(bytearray(4 * 1024 * 1024 * 1024))


def _add(a: int, b: int) -> int:
    return a + b


def test_run_isolated_returns_result() -> None:
    assert run_isolated(_add, (2, 3)) == 5


def test_run_isolated_kills_runaway_child() -> None:
    started = time.monotonic()
    with pytest.raises(SandboxFailure) as failure:
        run_isolated(_spin_forever, (), timeout_seconds=3.0)
    # Linux: RLIMIT_CPU (2s) giết trước → "killed"; Windows: hết giờ đồng hồ → "timeout".
    assert failure.value.code in {"timeout", "killed"}
    assert time.monotonic() - started < 8


@pytest.mark.skipif(not sys.platform.startswith("linux"), reason="RLIMIT_AS chỉ có trên Linux")
def test_run_isolated_memory_limit() -> None:
    with pytest.raises(SandboxFailure) as failure:
        run_isolated(_allocate_huge, ())
    assert failure.value.code in {"memory_limit", "killed"}


def test_verify_endpoint_ok() -> None:
    response = client.post("/verify", json={"kind": "number", "expression": "0.45+0.5", "expected": "0.95"})
    assert response.status_code == 200
    assert response.json() == {"ok": True, "computed": "0.95", "detail": "match"}


def test_verify_endpoint_each_kind() -> None:
    cases = [
        ({"kind": "number_list", "expression": "sort_asc(0.4, 0.3)", "expected": ["0.3", "0.4"]}, ["0.3", "0.4"]),
        ({"kind": "relation", "expression": "0.45 < 0.5", "expected": "<"}, "<"),
        ({"kind": "choice", "expression": "argmax(2.85, 2.9, 2.805)", "expected": "1"}, "1"),
    ]
    for payload, computed in cases:
        body = client.post("/verify", json=payload).json()
        assert body == {"ok": True, "computed": computed, "detail": "match"}


@pytest.mark.parametrize(
    "expression",
    ["__import__('os')", "().__class__.__base__", "10**10**9", "9**9**9**9", "lambda: 1", "1" * 5000],
)
def test_verify_endpoint_malicious_is_200_not_ok(expression: str) -> None:
    response = client.post("/verify", json={"kind": "number", "expression": expression, "expected": "1"})
    assert response.status_code == 200
    body = response.json()
    assert body["ok"] is False and body["computed"] is None and body["detail"]


@pytest.mark.parametrize(
    "payload",
    [
        {"kind": "number", "expression": "1"},
        {"kind": "eval", "expression": "1", "expected": "1"},
        {"kind": "number", "expression": 1, "expected": "1"},
        {"kind": "number", "expression": "1", "expected": 1},
        {"kind": "number", "expression": "1", "expected": "1", "extra": True},
    ],
)
def test_verify_endpoint_schema_errors_are_422(payload: dict[str, object]) -> None:
    assert client.post("/verify", json=payload).status_code == 422


def test_verify_endpoint_rejects_large_body() -> None:
    payload = {"kind": "number", "expression": "1" * (MAX_BODY_BYTES + 1), "expected": "1"}
    assert client.post("/verify", json=payload).status_code == 413
