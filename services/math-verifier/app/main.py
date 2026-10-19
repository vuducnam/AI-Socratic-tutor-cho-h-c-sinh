"""math-verifier: kiểm đáp án của Pre-solver bằng sympy (SPEC §15.7)."""

from fastapi import FastAPI

app = FastAPI(title="math-verifier", docs_url=None, redoc_url=None, openapi_url=None)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
