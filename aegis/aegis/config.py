"""설정 로딩 (.env / 환경변수)."""
from __future__ import annotations

import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CHAR_DIR = ROOT / "characters"
LOG_DIR = ROOT / "logs"
DATA_DIR = Path(__file__).resolve().parent / "data"


def _load_dotenv() -> None:
    """의존성 없이 .env 를 읽어 환경변수에 채운다."""
    env_path = ROOT / ".env"
    if not env_path.exists():
        return
    for line in env_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, val = line.partition("=")
        key, val = key.strip(), val.strip().strip("'\"")
        os.environ.setdefault(key, val)


_load_dotenv()

API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")
MODEL = os.environ.get("AEGIS_MODEL", "claude-sonnet-4-5")
MAX_TOKENS = int(os.environ.get("AEGIS_MAX_TOKENS", "4000"))
TEMPERATURE = float(os.environ.get("AEGIS_TEMPERATURE", "1.0"))

for _d in (CHAR_DIR, LOG_DIR, DATA_DIR):
    _d.mkdir(parents=True, exist_ok=True)
