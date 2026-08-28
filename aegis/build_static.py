#!/usr/bin/env python3
"""파이썬 쪽 프리셋·심판 프롬프트·샘플 캐릭터를 docs/data.js 로 내보낸다.

정적 사이트(docs/)는 서버 없이 도는 대신 이 데이터를 파일로 들고 있어야 한다.
프리셋이나 JUDGE_RULES 를 고쳤으면 이걸 다시 돌려서 사이트에 반영하면 된다.

    python build_static.py
"""
import json
from pathlib import Path

from aegis import presets, prompts, storage

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "docs" / "data.js"


def main() -> None:
    data = {
        "scales": presets.SCALES,
        "environments": presets.ENVIRONMENTS,
        "modifiers": presets.MODIFIERS,
        "tones": presets.TONES,
        "intensities": presets.INTENSITIES,
        "details": presets.DETAIL_LEVELS,
        "victory_conditions": presets.VICTORY_CONDITIONS,
        "judge_rules": prompts.JUDGE_RULES,
        "character_gen_system": prompts.CHARACTER_GEN_SYSTEM,
        "state_open": prompts.STATE_OPEN,
        "state_close": prompts.STATE_CLOSE,
        "sample_characters": [c.to_dict() for _, c in storage.list_characters()],
    }
    body = json.dumps(data, ensure_ascii=False, indent=2)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(
        "/* build_static.py 가 생성한 파일 — 직접 고치지 마세요.\n"
        "   프리셋은 aegis/presets.py, 심판 규칙은 aegis/prompts.py 를 고친 뒤\n"
        "   `python build_static.py` 를 다시 돌리면 됩니다. */\n"
        "window.AEGIS_DATA = " + body + ";\n",
        encoding="utf-8",
    )
    print(f"wrote {OUT.relative_to(ROOT)}  ({len(body):,} bytes)")
    print(f"  전장 {len(data['environments'])} · 변수 {len(data['modifiers'])} · "
          f"톤 {len(data['tones'])} · 샘플 캐릭터 {len(data['sample_characters'])}")


if __name__ == "__main__":
    main()
