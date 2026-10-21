"""Giới hạn dung lượng body theo số byte thật nhận được, kể cả khi không có Content-Length (chunked).

Starlette đọc cả multipart vào file tạm trước khi tới handler, nên giới hạn trong handler đến quá muộn.
Middleware ASGI này đếm byte ở `receive`: Content-Length khai vượt trần → 413 ngay; byte thực nhận vượt
trần → dừng đọc và trả 413 (thay cho phản hồi lỗi mà FastAPI sinh ra khi body bị cắt ngang).
"""

import json
from collections.abc import Awaitable, Callable, MutableMapping
from typing import Any

Scope = MutableMapping[str, Any]
Message = MutableMapping[str, Any]
Receive = Callable[[], Awaitable[Message]]
Send = Callable[[Message], Awaitable[None]]
AsgiApp = Callable[[Scope, Receive, Send], Awaitable[None]]


class _BodyTooLarge(Exception):
    pass


async def _send_413(send: Send) -> None:
    body = json.dumps({"detail": "audio_too_large"}).encode()
    await send({
        "type": "http.response.start",
        "status": 413,
        "headers": [(b"content-type", b"application/json"), (b"content-length", str(len(body)).encode())],
    })
    await send({"type": "http.response.body", "body": body})


class BodyLimitMiddleware:
    def __init__(self, app: AsgiApp, max_body_bytes: int) -> None:
        self.app = app
        self.max_body_bytes = max_body_bytes

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        declared = dict(scope.get("headers") or []).get(b"content-length")
        if declared is not None and (not declared.isdigit() or int(declared) > self.max_body_bytes):
            await _send_413(send)
            return

        received = 0
        exceeded = False
        response_started = False

        async def limited_receive() -> Message:
            nonlocal received, exceeded
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > self.max_body_bytes:
                    exceeded = True
                    raise _BodyTooLarge()
            return message

        async def guarded_send(message: Message) -> None:
            nonlocal response_started
            if exceeded:
                # Handler đã biến body bị cắt thành lỗi khác (400/500): thay bằng 413, bỏ phần còn lại.
                if message["type"] == "http.response.start" and not response_started:
                    response_started = True
                    await _send_413(send)
                return
            response_started = response_started or message["type"] == "http.response.start"
            await send(message)

        try:
            await self.app(scope, limited_receive, guarded_send)
        except _BodyTooLarge:
            if not response_started:
                await _send_413(send)
