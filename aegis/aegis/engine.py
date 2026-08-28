"""AI 전투 판정 엔진.

Anthropic API 로 라운드를 굴리고, 응답 끝의 STATE 블록을 파싱해 전황을 추적한다.
API 키가 없거나 AEGIS_MOCK=1 이면 오프라인 목(mock) 백엔드로 동작한다 (동작 확인용).
"""
from __future__ import annotations

import json
import os
import random
import re
import time
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, Iterator, List, Optional

from . import config, prompts
from .models import Battle

Printer = Callable[[str], None]


# ---------------------------------------------------------------- 스트림 분리


def split_stream_iter(chunks: Iterator[str]) -> Iterator[tuple]:
    """STATE 블록을 걸러내며 ("text", 조각) 을 흘려보내고,
    마지막에 ("full", 전체텍스트) 를 한 번 낸다."""
    marker = prompts.STATE_OPEN
    buf = ""
    printed = 0
    hit = False
    for chunk in chunks:
        buf += chunk
        if hit:
            continue
        idx = buf.find(marker)
        if idx != -1:
            if idx > printed:
                yield ("text", buf[printed:idx])
            printed = idx
            hit = True
        else:
            # 마커가 청크 경계에 걸릴 수 있으니 끝부분은 보류
            safe = len(buf) - len(marker)
            if safe > printed:
                yield ("text", buf[printed:safe])
                printed = safe
    if not hit and printed < len(buf):
        yield ("text", buf[printed:])
    yield ("full", buf)


def split_stream(chunks: Iterator[str], printer: Printer) -> str:
    """스트림을 흘려보내며 STATE 블록 직전까지만 출력하고, 전체 텍스트를 반환."""
    full = ""
    for kind, payload in split_stream_iter(chunks):
        if kind == "text":
            printer(payload)
        else:
            full = payload
    return full


STATE_RE = re.compile(
    re.escape(prompts.STATE_OPEN) + r"\s*(\{.*?\})\s*" + re.escape(prompts.STATE_CLOSE),
    re.S,
)


def parse_state(text: str) -> Optional[Dict[str, Any]]:
    m = STATE_RE.search(text)
    raw = None
    if m:
        raw = m.group(1)
    else:
        # 닫는 태그가 빠진 경우 대비: 여는 태그 뒤 첫 JSON 객체를 긁는다
        i = text.find(prompts.STATE_OPEN)
        if i != -1:
            tail = text[i + len(prompts.STATE_OPEN):]
            depth, start = 0, None
            for j, ch in enumerate(tail):
                if ch == "{":
                    if depth == 0:
                        start = j
                    depth += 1
                elif ch == "}":
                    depth -= 1
                    if depth == 0 and start is not None:
                        raw = tail[start:j + 1]
                        break
    if not raw:
        return None
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return None


def strip_state(text: str) -> str:
    i = text.find(prompts.STATE_OPEN)
    return (text[:i] if i != -1 else text).rstrip()


# ---------------------------------------------------------------- 백엔드


class Backend:
    def stream(self, system: str, messages: List[Dict[str, str]]) -> Iterator[str]:
        raise NotImplementedError

    def complete(self, system: str, messages: List[Dict[str, str]]) -> str:
        return "".join(self.stream(system, messages))


class AnthropicBackend(Backend):
    def __init__(self, model: str = None, max_tokens: int = None, temperature: float = None):
        try:
            import anthropic
        except ImportError as e:  # pragma: no cover
            raise SystemExit(
                "anthropic 패키지가 필요합니다.  pip install -r requirements.txt"
            ) from e
        if not config.API_KEY:
            raise SystemExit(
                "ANTHROPIC_API_KEY 가 설정되지 않았습니다.\n"
                ".env 파일에 넣거나 환경변수로 지정하세요. "
                "(키 없이 흐름만 보려면 AEGIS_MOCK=1)"
            )
        self.client = anthropic.Anthropic(api_key=config.API_KEY)
        self.model = model or config.MODEL
        self.max_tokens = max_tokens or config.MAX_TOKENS
        self.temperature = config.TEMPERATURE if temperature is None else temperature

    def stream(self, system: str, messages: List[Dict[str, str]]) -> Iterator[str]:
        with self.client.messages.stream(
            model=self.model,
            max_tokens=self.max_tokens,
            temperature=self.temperature,
            system=system,
            messages=messages,
        ) as s:
            for text in s.text_stream:
                yield text


class MockBackend(Backend):
    """API 없이 전체 흐름을 시험하기 위한 가짜 백엔드."""

    def __init__(self, keys: List[str], max_rounds: int = 8):
        self.keys = keys or ["A", "B"]
        self.integrity = {k: 100 for k in self.keys}
        self.round = -1
        self.max_rounds = max_rounds
        self.rng = random.Random(20260828)

    def stream(self, system: str, messages: List[Dict[str, str]]) -> Iterator[str]:
        last = messages[-1]["content"] if messages else ""
        if "전후 정리" in last:
            text = (
                "### 전후 정리\n\n"
                "**결착** — (mock) 마지막 일격의 여운이 전장에 남는다.\n\n"
                "**승패 요약** — 자리표시자입니다. 실제 실행에서는 심판이 "
                "설정에 근거해 승패를 분석합니다.\n\n"
                "**심판 총평** — 어떤 설정과 조건이 승부를 갈랐는지가 여기에 들어갑니다.\n\n"
                "**주요 순간 3선**\n\n1. 첫 번째 장면\n2. 두 번째 장면\n3. 세 번째 장면\n"
            )
            for i in range(0, len(text), 6):
                time.sleep(0.012)
                yield text[i:i + 6]
            return

        self.round += 1
        head = "### 개전" if self.round == 0 else f"### 라운드 {self.round} — 자리표시자"
        body = (
            f"{head}\n\n"
            "**mock 모드**입니다. 실제 서술 대신 자리표시자를 흘려보냅니다. "
            "`.env` 에 `ANTHROPIC_API_KEY` 를 넣으면 이 자리에 AI 심판이 쓴 "
            "전투 장면이 한 글자씩 스트리밍됩니다.\n\n"
            "전장의 공기가 무겁게 가라앉는다. 양측은 서로의 간격을 재고 있고, "
            "적용된 환경과 디버프가 각자의 호흡을 조금씩 갉아먹는다. "
            "누구도 먼저 움직이지 않는다 — 아직은.\n\n"
            "> 이 문단들은 UI 확인용 더미 텍스트이며, 전황 수치는 무작위로 굴러갑니다.\n\n"
        )
        for i in range(0, len(body), 6):
            time.sleep(0.012)
            yield body[i:i + 6]

        if self.round > 0:
            for k in self.keys:
                self.integrity[k] = max(0, self.integrity[k] - self.rng.randint(8, 26))
        alive = [k for k in self.keys if self.integrity[k] > 15]
        over = self.round >= self.max_rounds or len(alive) <= 1
        winner = None
        if over:
            winner = max(self.keys, key=lambda k: self.integrity[k])

        state = {
            "round": self.round,
            "sides": [
                {
                    "key": k,
                    "integrity": self.integrity[k],
                    "morale": max(0, self.integrity[k] - 5),
                    "status": [] if self.integrity[k] > 70 else ["부상 누적"],
                    "resources": "mock",
                }
                for k in self.keys
            ],
            "momentum": winner or self.keys[self.round % len(self.keys)],
            "turning_point": "(mock) 결정적 순간",
            "judge_note": "(mock) 판정 근거",
            "battle_over": over,
            "winner": winner,
            "victory_reason": "(mock) 잔존 전투력 우세" if over else "",
        }
        yield prompts.STATE_OPEN + "\n" + json.dumps(state, ensure_ascii=False, indent=2) + "\n" + prompts.STATE_CLOSE


def make_backend(battle: Battle) -> Backend:
    if os.environ.get("AEGIS_MOCK") == "1" or not config.API_KEY:
        return MockBackend([f.key for f in battle.forces], battle.config.max_rounds)
    return AnthropicBackend()


# ---------------------------------------------------------------- 전투 진행


@dataclass
class RoundResult:
    round_no: int
    narration: str
    state: Optional[Dict[str, Any]]


@dataclass
class BattleRunner:
    battle: Battle
    backend: Backend
    printer: Printer
    messages: List[Dict[str, str]] = field(default_factory=list)
    history: List[RoundResult] = field(default_factory=list)
    finished: bool = False
    winner: Optional[str] = None
    victory_reason: str = ""

    def __post_init__(self):
        self.system = prompts.build_system_prompt(self.battle)

    # -- 내부: 한 턴 실행
    def _turn(self, user_msg: str, round_no: int) -> RoundResult:
        self.messages.append({"role": "user", "content": user_msg})
        full = split_stream(self.backend.stream(self.system, self.messages), self.printer)
        self.messages.append({"role": "assistant", "content": full})

        state = parse_state(full)
        result = RoundResult(round_no, strip_state(full), state)
        self.history.append(result)

        if state and state.get("battle_over"):
            self.finished = True
            self.winner = state.get("winner")
            self.victory_reason = state.get("victory_reason", "")
        return result

    # -- 제너레이터 버전 (웹 SSE용): ("text", 조각) … 그리고 ("state", dict|None)
    def _stream_turn(self, user_msg: str, round_no: int) -> Iterator[tuple]:
        self.messages.append({"role": "user", "content": user_msg})
        full = ""
        for kind, payload in split_stream_iter(self.backend.stream(self.system, self.messages)):
            if kind == "text":
                yield ("text", payload)
            else:
                full = payload
        self.messages.append({"role": "assistant", "content": full})

        state = parse_state(full)
        self.history.append(RoundResult(round_no, strip_state(full), state))
        if state and state.get("battle_over"):
            self.finished = True
            self.winner = state.get("winner")
            self.victory_reason = state.get("victory_reason", "")
        yield ("state", state)

    def stream_opening(self) -> Iterator[tuple]:
        return self._stream_turn(prompts.build_opening_message(self.battle), 0)

    def stream_round(self, n: int, injection: Optional[str] = None) -> Iterator[tuple]:
        return self._stream_turn(
            prompts.build_round_message(n, self.battle.config.max_rounds, injection), n
        )

    def stream_epilogue(self) -> Iterator[tuple]:
        self.messages.append({"role": "user", "content": prompts.build_epilogue_message()})
        full = ""
        for kind, payload in split_stream_iter(self.backend.stream(self.system, self.messages)):
            if kind == "text":
                yield ("text", payload)
            else:
                full = payload
        self.messages.append({"role": "assistant", "content": full})
        self.history.append(RoundResult(-1, strip_state(full), None))
        yield ("state", None)

    def opening(self) -> RoundResult:
        return self._turn(prompts.build_opening_message(self.battle), 0)

    def round(self, n: int, injection: Optional[str] = None) -> RoundResult:
        return self._turn(
            prompts.build_round_message(n, self.battle.config.max_rounds, injection), n
        )

    def epilogue(self) -> str:
        self.messages.append({"role": "user", "content": prompts.build_epilogue_message()})
        full = split_stream(self.backend.stream(self.system, self.messages), self.printer)
        self.messages.append({"role": "assistant", "content": full})
        return strip_state(full)

    # -- 로그
    def transcript(self) -> str:
        cfg = self.battle.config
        out = ["# 전투 기록", ""]
        out.append("## 전장 설정")
        out.append("```")
        out.append(cfg.to_prompt_block())
        out.append("```")
        out.append("")
        out.append("## 참전 진영")
        for f in self.battle.forces:
            out.append("```")
            out.append(f.to_prompt_block())
            out.append("```")
        out.append("")
        out.append("## 전투")
        for r in self.history:
            out.append(r.narration)
            if r.state:
                out.append("")
                out.append("> " + _state_line(r.state))
            out.append("")
        return "\n".join(out)


def _state_line(state: Dict[str, Any]) -> str:
    bits = []
    for s in state.get("sides", []):
        bits.append(f"{s.get('key')} 전투력 {s.get('integrity')} / 사기 {s.get('morale')}")
    note = state.get("judge_note") or ""
    line = " | ".join(bits)
    if note:
        line += f"  —  심판 노트: {note}"
    return line
