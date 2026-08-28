"""캐릭터 · 전투 프리셋 · 전투 로그 저장/불러오기."""
from __future__ import annotations

import json
import re
from datetime import datetime
from pathlib import Path
from typing import List, Optional

from . import config
from .models import Battle, Character


def _slug(name: str) -> str:
    s = re.sub(r"[^\w가-힣ㄱ-ㅎㅏ-ㅣ-]+", "_", name).strip("_")
    return s or "character"


# ---------------------------------------------------------------- 캐릭터


def save_character(ch: Character, path: Optional[Path] = None) -> Path:
    path = path or config.CHAR_DIR / f"{_slug(ch.name)}.json"
    path.write_text(
        json.dumps(ch.to_dict(), ensure_ascii=False, indent=2), encoding="utf-8"
    )
    return path


def load_character(path: Path) -> Character:
    return Character.from_dict(json.loads(Path(path).read_text(encoding="utf-8")))


def list_characters() -> List[tuple[Path, Character]]:
    out = []
    for p in sorted(config.CHAR_DIR.glob("*.json")):
        try:
            out.append((p, load_character(p)))
        except Exception:
            continue
    return out


def delete_character(path: Path) -> None:
    Path(path).unlink(missing_ok=True)


# ---------------------------------------------------------------- 전투 설정


def save_battle(battle: Battle, name: str) -> Path:
    d = config.DATA_DIR / "battles"
    d.mkdir(parents=True, exist_ok=True)
    p = d / f"{_slug(name)}.json"
    p.write_text(json.dumps(battle.to_dict(), ensure_ascii=False, indent=2), encoding="utf-8")
    return p


def list_battles() -> List[tuple[Path, Battle]]:
    d = config.DATA_DIR / "battles"
    if not d.exists():
        return []
    out = []
    for p in sorted(d.glob("*.json")):
        try:
            out.append((p, Battle.from_dict(json.loads(p.read_text(encoding="utf-8")))))
        except Exception:
            continue
    return out


# ---------------------------------------------------------------- 로그


def save_log(text: str, title: str = "battle") -> Path:
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    p = config.LOG_DIR / f"{ts}_{_slug(title)}.md"
    p.write_text(text, encoding="utf-8")
    return p
