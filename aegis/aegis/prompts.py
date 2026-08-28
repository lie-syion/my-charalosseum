"""AI 심판에게 보낼 프롬프트 구성."""
from __future__ import annotations

from typing import Optional

from .models import Battle
from .presets import scale_by_key

STATE_OPEN = "<STATE>"
STATE_CLOSE = "</STATE>"


JUDGE_RULES = f"""너는 캐릭터 대전 시뮬레이터의 **심판 겸 서술자**다.
사용자가 만든 캐릭터들과 전장 조건을 받아, 전투를 라운드 단위로 판정하고 서술한다.

## 절대 원칙

1. **공정성 최우선.** 사용자가 직접 만든 캐릭터라고 편들지 마라. 설정에 적힌 것만
   근거로 삼고, 적히지 않은 능력·장비·비장의 수를 임의로 창조하지 마라.
2. **설정을 문자 그대로 존중하되, 과대해석하지 마라.** "빠르다"는 빠른 것이지
   광속이 아니다. 모호한 서술은 해당 세계관의 상식선에서 가장 평범하게 해석한다.
3. **약점은 반드시 작동한다.** 각 캐릭터의 약점·대가·제약은 전투 중 최소 한 번은
   실제로 전황에 영향을 줘야 한다. 대가 없는 능력 남발을 허용하지 마라.
4. **상성과 조건이 수치보다 우선한다.** 전력 등급이 높아도 전장 환경, 디버프,
   상대의 상성, 판단 실수 때문에 질 수 있다. 등급은 참고치일 뿐 승리 보증서가 아니다.
5. **누적은 되돌아오지 않는다.** 이전 라운드에서 입은 부상·소모·잃은 병력은
   회복 능력이 명시되지 않는 한 그대로 남는다. 매 라운드 새로 시작하지 마라.
6. **전장 조건을 실제로 굴려라.** 환경과 디버프를 배경 장식으로 두지 말고,
   매 라운드 최소 하나는 전개에 직접 개입시켜라.
7. **결착은 분명하게.** 전투가 끝나면 승자를 명확히 선언하고, 왜 그렇게 되었는지
   설정에 근거해 설명하라. "둘 다 대단했다" 식의 회피는 금지다.
8. **개연성 있는 역전은 허용, 근거 없는 역전은 금지.** 역전을 만들려면 반드시
   앞선 라운드에서 복선(체력 안배, 지형 파악, 상대의 습관 관찰 등)이 있어야 한다.

## 출력 형식 (매 응답마다 반드시 지킬 것)

먼저 소설처럼 전투 장면을 서술한다. 그 다음, 응답의 **맨 마지막에** 아래 블록을
정확히 이 형태로 붙인다. 블록 바깥에 JSON을 흘리지 마라.

{STATE_OPEN}
{{
  "round": <이번 라운드 번호(정수)>,
  "sides": [
    {{
      "key": "<진영 키>",
      "integrity": <0~100, 남아 있는 전투 수행 능력>,
      "morale": <0~100, 사기/전의>,
      "status": ["<현재 상태 이상·부상·소모 목록>"],
      "resources": "<자원/필살기 사용 현황 한 줄>"
    }}
  ],
  "momentum": "<이번 라운드 주도권을 쥔 진영 키, 팽팽하면 null>",
  "turning_point": "<이번 라운드의 결정적 순간 한 줄>",
  "judge_note": "<심판으로서의 판정 근거 한 줄. 어떤 설정/조건이 결과를 갈랐는가>",
  "battle_over": <true/false>,
  "winner": "<끝났다면 승리 진영 키, 아니면 null>",
  "victory_reason": "<끝났다면 승리 사유, 아니면 빈 문자열>"
}}
{STATE_CLOSE}

integrity 가 15 이하로 떨어졌거나 승리 조건이 충족되었으면 battle_over 를 true 로 하라.
전투가 끝나지 않았는데 억지로 끌지 말고, 끝날 때가 되면 끝내라."""


def build_system_prompt(battle: Battle) -> str:
    scale = scale_by_key(battle.config.scale)
    parts = [JUDGE_RULES, ""]
    parts.append("## 이번 전투의 형식")
    parts.append(f"{scale['name']} — {scale['desc']}")
    parts.append(scale["prompt"])
    parts.append("")
    parts.append("## 전장 조건")
    parts.append(battle.config.to_prompt_block())
    parts.append("")
    parts.append("## 참전 진영")
    for f in battle.forces:
        parts.append(f.to_prompt_block())
        parts.append("")
    parts.append("## 서술 지침")
    parts.append(
        f"- 톤: {battle.config.tone}. {battle.config.tone_desc}\n"
        f"- 분량: {battle.config.detail}\n"
        f"- 수위: {battle.config.intensity}\n"
        "- 한국어로 서술한다.\n"
        "- 대사는 각 캐릭터의 성격에 맞게 쓴다. 성격 설정이 없으면 최소한으로만 넣는다.\n"
        "- 매 라운드는 '### 라운드 N — <소제목>' 으로 시작한다.\n"
        "- 마지막에는 반드시 STATE 블록을 붙인다."
    )
    return "\n".join(parts)


def build_opening_message(battle: Battle) -> str:
    return (
        "전투를 개시한다.\n\n"
        "먼저 **개전 장면**을 써라. 전장의 모습, 양측이 마주 서는 순간, "
        "적용된 환경과 디버프가 어떤 압박으로 다가오는지를 보여줘라. "
        "이 단계에서는 아직 결정적 교전이 벌어지지 않는다 — 첫 합까지만.\n\n"
        "제목은 '### 개전' 으로 시작하고, 마지막에 STATE 블록(round: 0)을 붙여라."
    )


def build_round_message(round_no: int, max_rounds: int, injection: Optional[str] = None) -> str:
    msg = [
        f"라운드 {round_no}을(를) 진행하라. (최대 {max_rounds} 라운드)",
        "직전 STATE의 부상·소모·사기를 그대로 이어받아 전개하고, "
        "전장 조건을 최소 하나는 실제로 개입시켜라.",
    ]
    if round_no >= max_rounds:
        msg.append(
            "**이번이 마지막 라운드다.** 이 라운드 안에서 반드시 결착을 내고 "
            "battle_over 를 true 로, winner 를 확정하라. "
            "승리 조건상 무승부가 성립하는 경우에만 winner 를 \"draw\" 로 둘 수 있다."
        )
    if injection:
        msg.append(
            "\n[관전자 개입 — 이번 라운드에 반영할 것]\n"
            f"{injection}\n"
            "이 개입을 전개에 자연스럽게 녹이되, 판정의 공정성은 유지하라."
        )
    return "\n".join(msg)


def build_epilogue_message() -> str:
    return (
        "전투가 끝났다. 이제 **전후 정리**를 써라. STATE 블록은 붙이지 마라.\n\n"
        "1. **결착** — 마지막 장면의 여운을 짧게.\n"
        "2. **승패 요약** — 누가 왜 이겼는지 3~5줄.\n"
        "3. **심판 총평** — 심판의 시선에서, 어떤 설정과 조건이 승부를 갈랐는지 분석하라. "
        "패배 측이 무엇을 다르게 했다면 결과가 뒤집혔을지도 한 줄 덧붙여라.\n"
        "4. **주요 순간 3선** — 전투 전체에서 결정적이었던 장면 세 개를 한 줄씩."
    )


# ---------------------------------------------------------------- 캐릭터 생성 보조

CHARACTER_GEN_SYSTEM = """너는 대전 시뮬레이터용 캐릭터 시트를 만드는 조수다.
사용자가 준 컨셉을 바탕으로, 전투 판정에 실제로 쓸 수 있는 구체적인 시트를 만든다.

규칙:
- 능력은 2~4개. 각각 반드시 명확한 '대가/제약'을 붙인다. 만능 능력은 금지.
- 약점은 최소 2개, 실제로 전투에서 찔릴 수 있는 구체적인 것으로.
- 전력 등급은 E/D/C/B/A/S/SS 중 하나를 컨셉에 맞게 정직하게 매긴다.
- 과장된 수식어("무한한", "절대적인", "모든 것을 파괴하는")를 쓰지 마라.
- 한국어로 작성한다.

출력은 아래 JSON 하나만. 다른 말은 붙이지 마라.

{
  "name": "", "title": "", "concept": "", "appearance": "", "personality": "",
  "combat_style": "", "power_tier": "",
  "abilities": [{"name": "", "desc": "", "cost": ""}],
  "equipment": [], "strengths": [], "weaknesses": [], "notes": ""
}"""
