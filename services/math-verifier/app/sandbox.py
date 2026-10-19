"""Chạy phép tính trong tiến trình con có giới hạn tài nguyên và timeout thật (giết tiến trình).

- Linux (container): context `forkserver` nạp sẵn `app.verify` (fork nhanh, không fork từ tiến trình
  uvicorn đa luồng). Tiến trình con tự đặt `RLIMIT_CPU` (vượt → SIGXCPU/SIGKILL) và `RLIMIT_AS` (vượt →
  MemoryError) trước khi tính.
- Windows (dev): không có module `resource` nên bỏ qua setrlimit; timeout theo đồng hồ vẫn giết tiến
  trình con, nên pytest chạy được cả trên Windows.
- Timeout tính bằng đồng hồ thật ở tiến trình cha (`poll`), hết giờ → `kill()`; không phụ thuộc timeout
  của request. Số tiến trình con đồng thời bị chặn bởi semaphore để request dồn dập không làm cạn máy.
"""

from __future__ import annotations

import multiprocessing as mp
import sys
import threading
from multiprocessing.connection import Connection
from typing import Any, Callable

CPU_SECONDS = 2
ADDRESS_SPACE_BYTES = 1024 * 1024 * 1024
WALL_TIMEOUT_SECONDS = 5.0
MAX_CONCURRENT_CHILDREN = 4


class SandboxFailure(Exception):
    """Tiến trình con không trả kết quả: `timeout`, `killed` (vượt giới hạn), `memory_limit`, `busy`..."""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


def _make_context() -> Any:
    if sys.platform.startswith("linux"):
        ctx = mp.get_context("forkserver")
        ctx.set_forkserver_preload(["app.verify"])
        return ctx
    return mp.get_context("spawn")


_CONTEXT = _make_context()
_SLOTS = threading.BoundedSemaphore(MAX_CONCURRENT_CHILDREN)


def _apply_limits() -> None:
    try:
        import resource
    except ImportError:  # Windows: không có setrlimit, chỉ còn timeout giết tiến trình.
        return
    resource.setrlimit(resource.RLIMIT_CPU, (CPU_SECONDS, CPU_SECONDS + 1))
    resource.setrlimit(resource.RLIMIT_AS, (ADDRESS_SPACE_BYTES, ADDRESS_SPACE_BYTES))
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))


def _child_main(conn: Connection, target: Callable[..., Any], args: tuple[Any, ...]) -> None:
    try:
        _apply_limits()
        message: tuple[str, Any] = ("ok", target(*args))
    except MemoryError:
        message = ("memory_limit", None)
    except BaseException as exc:  # noqa: BLE001 — mọi lỗi của tiến trình con đều thành mã lỗi cho cha.
        message = ("child_error", type(exc).__name__)
    try:
        conn.send(message)
    finally:
        conn.close()


def run_isolated(
    target: Callable[..., Any],
    args: tuple[Any, ...],
    timeout_seconds: float = WALL_TIMEOUT_SECONDS,
) -> Any:
    """Gọi `target(*args)` trong tiến trình con; trả kết quả hoặc ném SandboxFailure."""
    if not _SLOTS.acquire(timeout=timeout_seconds):
        raise SandboxFailure("busy")
    try:
        receiver, sender = _CONTEXT.Pipe(duplex=False)
        process = _CONTEXT.Process(target=_child_main, args=(sender, target, args), daemon=True)
        try:
            process.start()
            sender.close()
            if not receiver.poll(timeout_seconds):
                raise SandboxFailure("timeout")
            try:
                status, payload = receiver.recv()
            except (EOFError, OSError):
                # Tiến trình con chết trước khi gửi (SIGXCPU, SIGKILL, hết bộ nhớ khi khởi động).
                raise SandboxFailure("killed") from None
        finally:
            sender.close()
            receiver.close()
            if process.is_alive():
                process.kill()
            process.join(timeout=2)
    finally:
        _SLOTS.release()
    if status == "ok":
        return payload
    raise SandboxFailure(status if status == "memory_limit" else f"child_error_{payload}")
