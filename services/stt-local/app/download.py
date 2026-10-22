"""Tải một lần mọi model đã cấu hình vào cache Hugging Face (volume `stt-models`).

Container `stt-local` chạy với HF_HUB_OFFLINE=1 trên mạng không ra internet, nên tải bằng service riêng
có mạng ra ngoài:

    docker compose run --rm stt-models-download

Chỉ tải file model công khai; không gửi audio hay dữ liệu nào của con.
"""

import os
import sys

from app.settings import load_settings

# Cấu hình/tokenizer + trọng số PyTorch. PhoWhisper chỉ phát hành `pytorch_model.bin` (nạp bằng
# torch.load weights_only), Whisper turbo dùng safetensors. Bỏ bản flax, tf, onnx nếu có.
ALLOW_PATTERNS = ["*.json", "*.txt", "*.safetensors", "pytorch_model*.bin"]


def main() -> int:
    if os.environ.get("HF_HUB_OFFLINE", "0") not in {"0", "", "false", "False"}:
        print("HF_HUB_OFFLINE đang bật: chạy lại với HF_HUB_OFFLINE=0 để tải model.", file=sys.stderr)
        return 2

    from huggingface_hub import snapshot_download

    settings = load_settings()
    for name in settings.all_models():
        print(f"Đang tải {name} ...", flush=True)
        path = snapshot_download(repo_id=name, allow_patterns=ALLOW_PATTERNS)
        print(f"  xong: {path}", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
