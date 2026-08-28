"""AEGIS — AI 캐릭터 대전 시뮬레이터 CLI."""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from typing import List, Optional

from . import config, engine, presets, storage, ui
from .models import Ability, Battle, BattleConfig, Character, Force, Troops
from .prompts import CHARACTER_GEN_SYSTEM

KEYS = "ABCDEF"


# ================================================================ 캐릭터


def _print_character(ch: Character) -> None:
    ui.panel(ch.to_prompt_block(), title=ch.label(), style="cyan")


def create_character_manual() -> Optional[Character]:
    ui.rule("새 캐릭터")
    name = ui.ask("이름")
    if not name:
        ui.out("취소했습니다.", style="yellow")
        return None
    ch = Character(name=name)
    ch.title = ui.ask("이명/칭호 (선택)")
    ch.concept = ui.ask("한 줄 컨셉")
    ch.appearance = ui.ask("외형 (선택)")
    ch.personality = ui.ask("성격 (선택)")
    ch.combat_style = ui.ask("전투 스타일")
    ch.power_tier = ui.ask("전력 등급 (E~SS 또는 자유 기술)", "B")

    ui.out("\n능력을 입력하세요. 이름을 비우면 종료합니다.", style="grey62")
    ui.out("※ 각 능력에 '대가/제약'을 적어야 심판이 공정하게 굴립니다.", style="grey62")
    while len(ch.abilities) < 8:
        aname = ui.ask(f"  능력 {len(ch.abilities)+1} 이름")
        if not aname:
            break
        desc = ui.ask("    설명")
        cost = ui.ask("    대가/제약")
        ch.abilities.append(Ability(aname, desc, cost))

    ch.equipment = ui.ask_list("장비 (쉼표 구분)")
    ch.strengths = ui.ask_list("강점 (쉼표 구분)")
    ch.weaknesses = ui.ask_list("약점 (쉼표 구분, 최소 1개 권장)")
    ch.notes = ui.ask("기타 설정 (선택)")

    _print_character(ch)
    if ui.confirm("저장할까요?"):
        p = storage.save_character(ch)
        ui.out(f"저장됨: {p.name}", style="green")
    return ch


def create_character_ai() -> Optional[Character]:
    ui.rule("AI로 캐릭터 시트 생성")
    concept = ui.ask("컨셉을 자유롭게 써주세요 (예: '복수를 위해 자기 그림자를 판 전직 성기사')")
    if not concept:
        return None
    extra = ui.ask("추가 요구사항 (선택)")

    if os.environ.get("AEGIS_MOCK") == "1" or not config.API_KEY:
        ui.out("API 키가 없어 AI 생성은 사용할 수 없습니다. (직접 입력을 이용하세요)", style="yellow")
        return None

    backend = engine.AnthropicBackend()
    msg = f"컨셉: {concept}"
    if extra:
        msg += f"\n추가 요구사항: {extra}"
    ui.out("\n생성 중...", style="grey62")
    raw = backend.complete(CHARACTER_GEN_SYSTEM, [{"role": "user", "content": msg}])
    start, end = raw.find("{"), raw.rfind("}")
    if start == -1 or end == -1:
        ui.out("생성 결과를 해석하지 못했습니다.", style="red")
        return None
    try:
        data = json.loads(raw[start:end + 1])
    except json.JSONDecodeError:
        ui.out("생성 결과 JSON 파싱 실패.", style="red")
        return None

    ch = Character.from_dict(data)
    _print_character(ch)
    if ui.confirm("이대로 저장할까요?"):
        p = storage.save_character(ch)
        ui.out(f"저장됨: {p.name}", style="green")
    return ch


def manage_characters() -> None:
    while True:
        chars = storage.list_characters()
        ui.rule("캐릭터 관리")
        if chars:
            for i, (p, c) in enumerate(chars, 1):
                ui.out(f"  {i:>2}. {c.label()}  [{c.power_tier}]  {c.concept}")
        else:
            ui.out("  저장된 캐릭터가 없습니다.", style="grey62")
        ui.out("\n  n) 직접 만들기   a) AI로 만들기   v) 상세 보기   d) 삭제   b) 뒤로")
        cmd = ui.ask("명령", "b").lower()
        if cmd == "n":
            create_character_manual()
        elif cmd == "a":
            create_character_ai()
        elif cmd == "v" and chars:
            i = ui.ask_int("번호", 1, 1, len(chars))
            _print_character(chars[i - 1][1])
        elif cmd == "d" and chars:
            i = ui.ask_int("번호", 1, 1, len(chars))
            if ui.confirm(f"'{chars[i-1][1].name}' 삭제할까요?", False):
                storage.delete_character(chars[i - 1][0])
                ui.out("삭제했습니다.", style="yellow")
        elif cmd == "b":
            return


# ================================================================ 전투 설정


def _pick_characters_for_force(force_name: str, lo: int, hi: int) -> List[Character]:
    picked: List[Character] = []
    while True:
        chars = storage.list_characters()
        ui.rule(f"{force_name} — 캐릭터 선택 ({lo}~{hi}명)")
        if picked:
            ui.out("현재 선택: " + ", ".join(c.name for c in picked), style="green")
        if chars:
            for i, (p, c) in enumerate(chars, 1):
                ui.out(f"  {i:>2}. {c.label()}  [{c.power_tier}]  {c.concept}")
        else:
            ui.out("  저장된 캐릭터가 없습니다.", style="grey62")
        ui.out("\n  숫자) 추가   n) 새로 만들어 추가   a) AI로 만들어 추가   ")
        ui.out("  x) 마지막 선택 취소   d) 선택 완료")
        cmd = ui.ask("명령", "d").lower()

        if cmd.isdigit() and chars:
            i = int(cmd)
            if 1 <= i <= len(chars):
                if len(picked) >= hi:
                    ui.out(f"최대 {hi}명까지입니다.", style="yellow")
                else:
                    picked.append(chars[i - 1][1])
        elif cmd == "n":
            ch = create_character_manual()
            if ch and len(picked) < hi:
                picked.append(ch)
        elif cmd == "a":
            ch = create_character_ai()
            if ch and len(picked) < hi:
                picked.append(ch)
        elif cmd == "x" and picked:
            picked.pop()
        elif cmd == "d":
            if len(picked) < lo:
                ui.out(f"최소 {lo}명이 필요합니다.", style="red")
                continue
            return picked


def _build_troops(force_name: str) -> Troops:
    ui.rule(f"{force_name} — 병력 편성")
    t = Troops()
    t.size = ui.ask("병력 규모", "3000")
    t.composition = ui.ask("편성 (예: 중장보병 1800, 궁병 900, 기병 300)")
    t.quality = ui.choose(
        "숙련도", ["징집병", "숙련병", "정예", "전설급"], default_index=1
    )
    t.morale = ui.choose("사기", ["붕괴 직전", "낮음", "보통", "높음", "광신적"], default_index=2)
    t.supply = ui.choose("보급", ["고갈", "부족", "충분", "풍족"], default_index=2)
    t.formation = ui.ask("전술 방침 (선택)")
    return t


def setup_battle() -> Optional[Battle]:
    ui.banner("전투 설정")

    scale = ui.choose(
        "전투 형식을 고르세요",
        presets.SCALES,
        labeler=lambda s: s["name"],
        describer=lambda s: s["desc"],
    )
    lo, hi = scale["chars_per_side"]
    n_sides = scale["sides"]
    if scale["key"] == "royale":
        n_sides = ui.ask_int("참전 진영 수", 3, 3, 6)

    forces: List[Force] = []
    for i in range(n_sides):
        key = KEYS[i]
        ui.rule(f"진영 {key}")
        banner = ui.ask(f"진영 {key} 이름", f"진영 {key}")
        f = Force(key=key, banner=banner)
        if scale.get("asymmetric"):
            f.role = "공격군" if i == 0 else "수비군"
            ui.out(f"  역할: {f.role}", style="grey62")
            f.objective = ui.ask(
                "승리 목표",
                "성문을 돌파하고 본성을 점령한다" if i == 0 else "원군이 올 때까지 성을 지킨다",
            )
        else:
            f.objective = ui.ask("승리 목표 (선택)")
        f.characters = _pick_characters_for_force(banner, lo, hi)
        if scale["troops"]:
            f.troops = _build_troops(banner)
        forces.append(f)

    cfg = BattleConfig(scale=scale["key"])

    env = ui.choose(
        "전장을 고르세요",
        presets.ENVIRONMENTS,
        labeler=lambda e: e["name"],
        describer=lambda e: e["desc"],
        allow_custom=True,
    )
    if env is None:
        cfg.environment_name = ui.ask("전장 이름")
        cfg.environment_desc = ui.ask("전장 설명")
    else:
        cfg.environment_name, cfg.environment_desc = env["name"], env["desc"]

    mods = ui.choose_many(
        "전장 변수 / 디버프를 고르세요",
        presets.MODIFIERS,
        labeler=lambda m: m["name"],
        describer=lambda m: m["desc"],
    )
    cfg.modifiers = [{"name": m["name"], "desc": m["desc"]} for m in mods]
    custom = ui.ask("직접 추가할 변수 (선택, '이름: 설명' 형식)")
    if custom:
        name, _, desc = custom.partition(":")
        cfg.modifiers.append({"name": name.strip(), "desc": desc.strip()})

    tone = ui.choose(
        "서술 톤",
        presets.TONES,
        labeler=lambda t: t["name"],
        describer=lambda t: t["desc"],
    )
    cfg.tone, cfg.tone_desc = tone["name"], tone["desc"]

    cfg.intensity = ui.choose(
        "묘사 수위",
        presets.INTENSITIES,
        labeler=lambda x: x["name"],
        describer=lambda x: x["desc"],
        default_index=1,
    )["name"]

    cfg.detail = ui.choose(
        "라운드당 분량",
        presets.DETAIL_LEVELS,
        labeler=lambda x: x["name"],
        describer=lambda x: x["desc"],
        default_index=1,
    )["name"]

    cfg.victory_condition = ui.choose(
        "승리 조건", presets.VICTORY_CONDITIONS, allow_custom=True
    ) or ui.ask("승리 조건을 직접 입력")

    cfg.max_rounds = ui.ask_int("최대 라운드", 8, 1, 30)
    cfg.extra_rules = ui.ask("추가 규칙 / 상황 설정 (자유 입력, 선택)")
    cfg.interactive = ui.confirm("라운드 사이에 개입(난입·조건 추가)할 수 있게 할까요?", True)

    battle = Battle(config=cfg, forces=forces)

    ui.rule("설정 확인")
    ui.panel(cfg.to_prompt_block(), title="전장", style="cyan")
    for f in forces:
        ui.panel(f.to_prompt_block(), title=f"진영 {f.key}", style="magenta")

    if not ui.confirm("이대로 시작할까요?"):
        ui.out("취소했습니다.", style="yellow")
        return None
    if ui.confirm("이 전투 설정을 저장할까요?", False):
        name = ui.ask("저장 이름", " vs ".join(f.display_name() for f in forces))
        p = storage.save_battle(battle, name)
        ui.out(f"저장됨: {p.name}", style="green")
    return battle


# ================================================================ 전투 실행


def run_battle(battle: Battle) -> None:
    names = {f.key: f.display_name() for f in battle.forces}
    backend = engine.make_backend(battle)
    if isinstance(backend, engine.MockBackend):
        ui.out(
            "\n[mock 모드] ANTHROPIC_API_KEY 가 없어 자리표시자로 진행합니다.",
            style="yellow",
        )

    runner = engine.BattleRunner(battle=battle, backend=backend, printer=ui.stream_out)

    title = " vs ".join(names.values())
    ui.banner(title, f"{presets.scale_by_key(battle.config.scale)['name']} · {battle.config.environment_name}")

    ui.rule("개전")
    r = runner.opening()
    print()
    if r.state:
        ui.status_table(r.state, names)

    auto = not battle.config.interactive
    n = 1
    while n <= battle.config.max_rounds and not runner.finished:
        injection = None
        if not auto:
            ui.out(
                "\n[엔터] 다음 라운드   [i] 개입하기   [a] 끝까지 자동 진행   [q] 중단",
                style="grey62",
            )
            cmd = ui.ask("명령", "").lower()
            if cmd == "q":
                ui.out("전투를 중단했습니다.", style="yellow")
                break
            if cmd == "a":
                auto = True
            elif cmd == "i":
                injection = ui.ask("어떤 일이 벌어집니까?")

        ui.rule(f"라운드 {n}")
        r = runner.round(n, injection)
        print()
        if r.state:
            ui.status_table(r.state, names)
        n += 1

    if runner.finished:
        ui.rule("전투 종료")
        w = runner.winner
        if w in (None, "", "draw"):
            ui.panel("무승부", title="결과", style="yellow")
        else:
            ui.panel(
                f"승자: {names.get(w, w)}\n사유: {runner.victory_reason}",
                title="결과",
                style="green",
            )
        if ui.confirm("전후 정리와 심판 총평을 볼까요?", True):
            ui.rule("전후 정리")
            runner.epilogue()
            print()

    if runner.history and ui.confirm("전투 기록을 파일로 저장할까요?", True):
        p = storage.save_log(runner.transcript(), title)
        ui.out(f"저장됨: {p}", style="green")


# ================================================================ 메인


def load_saved_battle() -> Optional[Battle]:
    items = storage.list_battles()
    if not items:
        ui.out("저장된 전투 설정이 없습니다.", style="yellow")
        return None
    ui.rule("저장된 전투 설정")
    for i, (p, b) in enumerate(items, 1):
        who = " vs ".join(f.display_name() for f in b.forces)
        ui.out(f"  {i:>2}. {who}  ({b.config.environment_name})")
    i = ui.ask_int("번호", 1, 1, len(items))
    return items[i - 1][1]


def show_presets() -> None:
    ui.rule("전투 형식")
    for s in presets.SCALES:
        ui.out(f"  · {s['name']} — {s['desc']}")
    ui.rule("전장")
    for e in presets.ENVIRONMENTS:
        ui.out(f"  · {e['name']} — {e['desc']}")
    ui.rule("변수 / 디버프")
    for m in presets.MODIFIERS:
        ui.out(f"  · {m['name']} — {m['desc']}")
    ui.rule("서술 톤")
    for t in presets.TONES:
        ui.out(f"  · {t['name']} — {t['desc']}")
    ui.out(
        "\n프리셋 추가: aegis/data/user_presets.json 에 "
        '{"environments":[{"name":"","desc":""}], "modifiers":[...], "tones":[...]} 형식으로 넣으세요.',
        style="grey62",
    )


def build_demo_battle() -> Battle:
    """샘플 캐릭터로 즉석 1:1 전투를 구성한다 (--demo)."""
    chars = [c for _, c in storage.list_characters()]
    if len(chars) < 2:
        raise SystemExit("샘플 캐릭터가 부족합니다. characters/ 폴더를 확인하세요.")
    env = presets.ENVIRONMENTS[0]
    tone = presets.TONES[0]
    cfg = BattleConfig(
        scale="duel",
        environment_name=env["name"],
        environment_desc=env["desc"],
        modifiers=[{"name": m["name"], "desc": m["desc"]} for m in presets.MODIFIERS[:2]],
        tone=tone["name"],
        tone_desc=tone["desc"],
        max_rounds=4,
        interactive=False,
    )
    return Battle(
        config=cfg,
        forces=[
            Force(key="A", banner=chars[0].name, characters=[chars[0]]),
            Force(key="B", banner=chars[1].name, characters=[chars[1]]),
        ],
    )


def main(argv: Optional[List[str]] = None) -> int:
    argv = argv if argv is not None else sys.argv[1:]
    if "--mock" in argv:
        os.environ["AEGIS_MOCK"] = "1"
    if "--demo" in argv:
        run_battle(build_demo_battle())
        return 0

    ui.banner(
        "AEGIS",
        "AI 심판이 굴리는 캐릭터 대전 · 전쟁 시뮬레이터",
    )
    if not config.API_KEY and os.environ.get("AEGIS_MOCK") != "1":
        ui.out(
            "ANTHROPIC_API_KEY 가 없습니다. .env 에 키를 넣으면 실제 AI 판정이 켜집니다.\n"
            "지금은 mock 모드로 흐름만 확인할 수 있습니다.",
            style="yellow",
        )

    while True:
        ui.out()
        ui.out("  1. 전투 시작")
        ui.out("  2. 캐릭터 관리")
        ui.out("  3. 저장된 전투 설정으로 시작")
        ui.out("  4. 프리셋 둘러보기")
        ui.out("  5. 종료")
        cmd = ui.ask("선택", "1")
        try:
            if cmd == "1":
                b = setup_battle()
                if b:
                    run_battle(b)
            elif cmd == "2":
                manage_characters()
            elif cmd == "3":
                b = load_saved_battle()
                if b:
                    run_battle(b)
            elif cmd == "4":
                show_presets()
            elif cmd in ("5", "q", "exit"):
                ui.out("안녕히.", style="grey62")
                return 0
        except KeyboardInterrupt:
            ui.out("\n중단했습니다.", style="yellow")
        except EOFError:
            return 0


if __name__ == "__main__":
    raise SystemExit(main())
