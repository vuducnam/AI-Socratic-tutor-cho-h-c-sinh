# stt-local: PhoWhisper / Whisper trên GPU (SPEC §10). CUDA 12.6 chạy được với driver NVIDIA phổ biến
# trên Windows + WSL2; đổi tag bằng --build-arg nếu cần.
ARG BASE_IMAGE=pytorch/pytorch:2.14.1-cuda12.6-cudnn9-runtime
FROM ${BASE_IMAGE}

# Cache model nằm ở volume /models; HOME/XDG trỏ vào tmpfs vì filesystem gốc read-only.
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 \
    DEBIAN_FRONTEND=noninteractive \
    HF_HOME=/models HOME=/tmp XDG_CACHE_HOME=/tmp/.cache \
    HF_HUB_DISABLE_TELEMETRY=1 TRANSFORMERS_NO_ADVISORY_WARNINGS=1

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /srv
COPY pyproject.toml ./
# torch đã có trong base image (Python hệ thống 3.12); chỉ thêm phần còn lại (khớp pyproject.toml: dependencies + extra `ml`).
# Image dùng Python hệ thống có đánh dấu PEP 668; container chỉ chạy một service nên cài thẳng là an toàn.
RUN PIP_BREAK_SYSTEM_PACKAGES=1 pip install --no-cache-dir "fastapi>=0.115" "uvicorn>=0.32" "python-multipart>=0.0.18" "numpy>=2" \
    "transformers>=4.56,<6" "huggingface_hub>=0.34"
COPY app ./app

# Chạy non-root; thư mục /models tạo sẵn với chủ là user này để named volume kế thừa quyền ghi.
RUN useradd --system --uid 10001 --home-dir /tmp stt \
    && mkdir -p /models && chown stt /models
USER stt
EXPOSE 8000
# Nạp model lúc khởi động mất cỡ một phút: start-period dài để không bị đánh dấu unhealthy sớm.
HEALTHCHECK --interval=15s --timeout=3s --start-period=300s --retries=5 \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=2).status==200 else 1)"
CMD ["uvicorn", "--factory", "app.main:create_app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1", "--no-access-log"]
