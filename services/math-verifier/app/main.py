"""math-verifier: kiểm đáp án của Pre-solver bằng sympy (SPEC §15.7).

API:
- `GET /health` → `{"status": "ok"}`.
- `POST /verify` JSON `{kind, expression, expected}` → `{ok, computed, detail}` (hợp đồng theo kind ở
  `app.verify`, cú pháp biểu thức ở `app.safe_parse`).

Quy tắc mã trạng thái:
- 422: chỉ khi JSON sai CẤU TRÚC (thiếu trường, sai kiểu, `kind` ngoài 4 giá trị, có trường lạ).
- 413: thân request quá MAX_BODY_BYTES.
- 200 cho mọi thứ còn lại, kể cả biểu thức không hợp lệ/không an toàn, timeout hay tiến trình con bị
  giết: khi đó `ok=false`, `computed=null`, `detail="<code>: <lý do>"`.
"""

from typing import Literal

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, StrictStr

from app.sandbox import SandboxFailure, run_isolated
from app.verify import verify

MAX_BODY_BYTES = 16 * 1024

app = FastAPI(title="math-verifier", docs_url=None, redoc_url=None, openapi_url=None)


class VerifyRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: Literal["number", "number_list", "relation", "choice"]
    expression: StrictStr
    expected: StrictStr | list[StrictStr]


class VerifyResponse(BaseModel):
    ok: bool
    computed: str | list[str] | None
    detail: str


@app.middleware("http")
async def limit_body_size(request: Request, call_next):  # type: ignore[no-untyped-def]
    declared = request.headers.get("content-length")
    if declared is not None and (not declared.isdigit() or int(declared) > MAX_BODY_BYTES):
        return JSONResponse({"detail": "body_too_large"}, status_code=413)
    return await call_next(request)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/verify", response_model=VerifyResponse)
def verify_endpoint(body: VerifyRequest) -> VerifyResponse:
    # Hàm sync: FastAPI chạy trong threadpool, tiến trình con không chặn event loop.
    try:
        result = run_isolated(verify, (body.kind, body.expression, body.expected))
    except SandboxFailure as failure:
        return VerifyResponse(ok=False, computed=None, detail=f"{failure.code}: phép tính bị dừng trong sandbox")
    return VerifyResponse.model_validate(result)
