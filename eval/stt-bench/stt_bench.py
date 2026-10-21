"""stt-bench: đo WER của stt-local trên bộ ghi âm thật của các con (SPEC §10).

Dữ liệu: `storage/stt-bench/<lang>/<tên>.<wav|webm|ogg|mp4|m4a>` + `<tên>.txt` (câu tham chiếu UTF-8).
`storage/` đã gitignore: ghi âm không vào repo. Script chỉ gọi stt-local trên máy này (localhost hoặc
`stt-local` trong mạng Docker), không gọi model cloud, không tải audio đi đâu khác.

    python eval/stt-bench/stt_bench.py                       # mọi model stt-local đã cấu hình, cả vi và en
    python eval/stt-bench/stt_bench.py --languages vi --models vi=vinai/PhoWhisper-large --details

Chỉ dùng thư viện chuẩn của Python.
"""

import argparse
import json
import os
import statistics
import sys
import urllib.error
import urllib.request
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import urlparse

from wer_metrics import normalize_words, word_errors

REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_DATA_DIR = REPO_ROOT / "storage" / "stt-bench"
DEFAULT_URL = "http://localhost:8002"
LANGUAGES = ("vi", "en")
# Chỉ gọi dịch vụ trên chính máy này: giọng của con không rời PC (quy tắc cứng 10).
LOCAL_HOSTS = {"localhost", "127.0.0.1", "::1", "stt-local"}
CONTENT_TYPES = {
    ".wav": "audio/wav",
    ".webm": "audio/webm",
    ".ogg": "audio/ogg",
    ".mp4": "audio/mp4",
    ".m4a": "audio/mp4",
}
@dataclass(frozen=True)
class Sample:
    audio: Path
    reference: str


@dataclass
class ModelResult:
    language: str
    model: str
    files: int = 0
    reference_words: int = 0
    errors: int = 0
    failures: int = 0
    latencies_ms: list[int] = field(default_factory=list)

    @property
    def wer(self) -> float | None:
        return self.errors / self.reference_words if self.reference_words else None


def find_samples(data_dir: Path, language: str) -> tuple[list[Sample], list[str]]:
    """Trả (mẫu hợp lệ, tên file audio thiếu/rỗng câu tham chiếu)."""
    folder = data_dir / language
    if not folder.is_dir():
        return [], []
    samples: list[Sample] = []
    skipped: list[str] = []
    for audio in sorted(folder.iterdir()):
        if audio.suffix.lower() not in CONTENT_TYPES:
            continue
        reference_file = audio.with_suffix(".txt")
        reference = reference_file.read_text(encoding="utf-8").strip() if reference_file.is_file() else ""
        if normalize_words(reference):
            samples.append(Sample(audio=audio, reference=reference))
        else:
            skipped.append(audio.name)
    return samples, skipped


def ensure_local_url(url: str) -> str:
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"} or parsed.hostname not in LOCAL_HOSTS:
        raise SystemExit(f"Chỉ được gọi stt-local trên máy này ({', '.join(sorted(LOCAL_HOSTS))}), không phải {url}")
    return url.rstrip("/")


def fetch_configured_models(base_url: str, timeout: float) -> dict[str, list[str]]:
    with urllib.request.urlopen(f"{base_url}/health", timeout=timeout) as response:
        body = json.load(response)
    models = body.get("models")
    if not isinstance(models, dict):
        raise SystemExit("stt-local /health không trả danh sách model; dùng --models để chỉ định")
    return {language: [str(name) for name in models.get(language, [])] for language in LANGUAGES}


def encode_multipart(fields: dict[str, str], audio: Path) -> tuple[bytes, str]:
    boundary = uuid.uuid4().hex
    parts: list[bytes] = []
    for name, value in fields.items():
        parts.append(
            f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"\r\n\r\n{value}\r\n'.encode()
        )
    parts.append(
        (
            f'--{boundary}\r\nContent-Disposition: form-data; name="audio"; filename="sample{audio.suffix.lower()}"\r\n'
            f"Content-Type: {CONTENT_TYPES[audio.suffix.lower()]}\r\n\r\n"
        ).encode()
        + audio.read_bytes()
        + b"\r\n"
    )
    parts.append(f"--{boundary}--\r\n".encode())
    return b"".join(parts), f"multipart/form-data; boundary={boundary}"


def transcribe(base_url: str, audio: Path, language: str, model: str, timeout: float) -> dict[str, object]:
    body, content_type = encode_multipart({"language": language, "model": model}, audio)
    request = urllib.request.Request(
        f"{base_url}/transcribe", data=body, method="POST", headers={"Content-Type": content_type}
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return dict(json.load(response))


def parse_models_option(values: list[str]) -> dict[str, list[str]]:
    chosen: dict[str, list[str]] = {}
    for value in values:
        language, _, names = value.partition("=")
        if language not in LANGUAGES or not names.strip():
            raise SystemExit(f"--models phải có dạng vi=model1,model2 hoặc en=..., nhận: {value}")
        chosen[language] = [name.strip() for name in names.split(",") if name.strip()]
    return chosen


def format_table(results: list[ModelResult]) -> str:
    header = ("Ngôn ngữ", "Model", "File", "Từ tham chiếu", "Lỗi", "WER", "Trung vị ms", "Request lỗi")
    rows = [header]
    for result in results:
        rate = result.wer
        rows.append(
            (
                result.language,
                result.model,
                str(result.files),
                str(result.reference_words),
                str(result.errors),
                "-" if rate is None else f"{rate * 100:.1f}%".replace(".", ","),
                str(round(statistics.median(result.latencies_ms))) if result.latencies_ms else "-",
                str(result.failures),
            )
        )
    widths = [max(len(row[column]) for row in rows) for column in range(len(header))]
    lines = ["  ".join(cell.ljust(widths[index]) for index, cell in enumerate(row)) for row in rows]
    lines.insert(1, "  ".join("-" * width for width in widths))
    return "\n".join(lines)


def run(arguments: argparse.Namespace) -> int:
    base_url = ensure_local_url(arguments.url)
    languages = [language.strip() for language in arguments.languages.split(",") if language.strip()]
    if not languages or any(language not in LANGUAGES for language in languages):
        raise SystemExit("--languages chỉ nhận vi, en")
    models = parse_models_option(arguments.models) or fetch_configured_models(base_url, arguments.timeout)

    results: list[ModelResult] = []
    for language in languages:
        samples, skipped = find_samples(arguments.data_dir, language)
        if skipped:
            print(f"[{language}] bỏ qua {len(skipped)} file thiếu câu tham chiếu: {', '.join(skipped)}", file=sys.stderr)
        if not samples:
            print(f"[{language}] không có mẫu trong {arguments.data_dir / language}", file=sys.stderr)
            continue
        for model in models.get(language, []):
            result = ModelResult(language=language, model=model)
            for sample in samples:
                try:
                    output = transcribe(base_url, sample.audio, language, model, arguments.timeout)
                except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as error:
                    result.failures += 1
                    detail = error.read().decode("utf-8", "replace") if isinstance(error, urllib.error.HTTPError) else str(error)
                    print(f"[{language}] {model} {sample.audio.name}: lỗi {detail}", file=sys.stderr)
                    continue
                reference_words = normalize_words(sample.reference)
                hypothesis = str(output.get("text", ""))
                errors = word_errors(reference_words, normalize_words(hypothesis))
                result.files += 1
                result.reference_words += len(reference_words)
                result.errors += errors
                latency = output.get("latency_ms")
                if isinstance(latency, int):
                    result.latencies_ms.append(latency)
                if arguments.details:
                    file_wer = f"{errors / len(reference_words):.2f}".replace(".", ",")
                    print(f"[{language}] {model} {sample.audio.name}: WER {file_wer} | {hypothesis}")
            results.append(result)

    if not results:
        print("Không có kết quả nào: kiểm tra thư mục dữ liệu và danh sách model.", file=sys.stderr)
        return 1
    print(format_table(results))
    return 0 if all(result.failures == 0 for result in results) else 1


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Đo WER của stt-local trên ghi âm cục bộ.")
    parser.add_argument("--url", default=os.environ.get("STT_LOCAL_URL", DEFAULT_URL), help="địa chỉ stt-local")
    parser.add_argument("--data-dir", type=Path, default=DEFAULT_DATA_DIR, help="thư mục chứa vi/ và en/")
    parser.add_argument("--languages", default="vi,en", help="vi,en (mặc định cả hai)")
    parser.add_argument(
        "--models",
        action="append",
        default=[],
        help="vi=model1,model2 (lặp lại cho en); mặc định lấy danh sách stt-local đã cấu hình qua /health",
    )
    parser.add_argument("--timeout", type=float, default=180.0, help="giây chờ mỗi request")
    parser.add_argument("--details", action="store_true", help="in WER và chữ nhận được từng file (chỉ ra màn hình)")
    return parser


if __name__ == "__main__":
    # Console Windows mặc định không phải UTF-8: ép UTF-8 để in đúng tiếng Việt.
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8")
    sys.exit(run(build_parser().parse_args()))
