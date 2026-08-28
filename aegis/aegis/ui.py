"""터미널 UI 헬퍼. rich 가 있으면 예쁘게, 없으면 평범하게 동작한다."""
from __future__ import annotations

import sys
from typing import Any, Dict, List, Optional, Sequence

try:
    from rich.console import Console
    from rich.panel import Panel
    from rich.table import Table
    from rich.rule import Rule
    _console = Console()
    RICH = True
except Exception:  # pragma: no cover
    _console = None
    RICH = False


# ---------------------------------------------------------------- 출력


_MARKUP = __import__("re").compile(r"\[/?[a-z0-9 _#]+\]")


def out(text: str = "", style: str = "") -> None:
    if RICH:
        _console.print(text, style=style or None, highlight=False)
    else:
        print(_MARKUP.sub("", text))


def stream_out(text: str) -> None:
    """스트리밍 조각 출력 (개행 없이)."""
    sys.stdout.write(text)
    sys.stdout.flush()


def rule(title: str = "") -> None:
    if RICH:
        _console.print(Rule(title, style="grey50"))
    else:
        print("\n" + "-" * 60 + (f" {title} " if title else ""))


def banner(title: str, subtitle: str = "") -> None:
    if RICH:
        body = f"[bold]{title}[/bold]"
        if subtitle:
            body += f"\n[grey62]{subtitle}[/grey62]"
        _console.print(Panel(body, border_style="cyan", expand=False))
    else:
        print(f"\n=== {title} ===")
        if subtitle:
            print(subtitle)


def panel(text: str, title: str = "", style: str = "grey50") -> None:
    if RICH:
        _console.print(Panel(text, title=title or None, border_style=style, expand=False))
    else:
        if title:
            print(f"\n[{title}]")
        print(text)


def status_table(state: Dict[str, Any], names: Dict[str, str]) -> None:
    """라운드 종료 후 전황 요약."""
    sides = state.get("sides", [])
    if not sides:
        return
    if RICH:
        t = Table(show_header=True, header_style="bold", box=None, padding=(0, 2))
        t.add_column("진영")
        t.add_column("전투력", justify="right")
        t.add_column("사기", justify="right")
        t.add_column("상태")
        for s in sides:
            key = str(s.get("key", "?"))
            integ = int(s.get("integrity", 0) or 0)
            color = "green" if integ > 60 else ("yellow" if integ > 30 else "red")
            bar = "█" * max(0, round(integ / 10)) + "░" * (10 - max(0, round(integ / 10)))
            t.add_row(
                names.get(key, key),
                f"[{color}]{bar} {integ:>3}[/{color}]",
                str(s.get("morale", "-")),
                ", ".join(s.get("status") or []) or "-",
            )
        _console.print(t)
    else:
        for s in sides:
            key = str(s.get("key", "?"))
            print(
                f"  {names.get(key, key)}: 전투력 {s.get('integrity')} / "
                f"사기 {s.get('morale')} / {', '.join(s.get('status') or []) or '-'}"
            )
    note = state.get("judge_note")
    if note:
        out(f"  [심판 노트] {note}", style="grey62")
    tp = state.get("turning_point")
    if tp:
        out(f"  [분기점] {tp}", style="grey62")


# ---------------------------------------------------------------- 입력


def ask(prompt: str, default: str = "") -> str:
    suffix = f" [{default}]" if default else ""
    try:
        val = input(f"{prompt}{suffix}: ").strip()
    except EOFError:
        return default
    return val or default


def ask_int(prompt: str, default: int, lo: int = 1, hi: int = 99) -> int:
    while True:
        raw = ask(prompt, str(default))
        try:
            n = int(raw)
        except ValueError:
            out("숫자를 입력하세요.", style="red")
            continue
        if lo <= n <= hi:
            return n
        out(f"{lo}~{hi} 사이로 입력하세요.", style="red")


def confirm(prompt: str, default: bool = True) -> bool:
    d = "Y/n" if default else "y/N"
    raw = ask(f"{prompt} ({d})").lower()
    if not raw:
        return default
    return raw.startswith("y")


def choose(
    title: str,
    items: Sequence[Any],
    labeler=lambda x: str(x),
    describer=None,
    allow_custom: bool = False,
    default_index: int = 0,
) -> Any:
    """단일 선택. allow_custom 이면 '직접 입력' 옵션이 붙는다."""
    out()
    out(f"[bold]{title}[/bold]" if RICH else title)
    for i, it in enumerate(items, 1):
        label = labeler(it)
        if describer:
            desc = describer(it)
            if RICH:
                _console.print(f"  [cyan]{i:>2}[/cyan]. {label}  [grey58]— {desc}[/grey58]", highlight=False)
            else:
                print(f"  {i:>2}. {label} — {desc}")
        else:
            out(f"  {i:>2}. {label}")
    extra = len(items)
    if allow_custom:
        extra += 1
        out(f"  {extra:>2}. 직접 입력")
    while True:
        raw = ask("번호", str(default_index + 1))
        try:
            n = int(raw)
        except ValueError:
            out("번호를 입력하세요.", style="red")
            continue
        if 1 <= n <= len(items):
            return items[n - 1]
        if allow_custom and n == extra:
            return None
        out("범위를 벗어났습니다.", style="red")


def choose_many(
    title: str,
    items: Sequence[Any],
    labeler=lambda x: str(x),
    describer=None,
    allow_custom: bool = False,
) -> List[Any]:
    """복수 선택. '1,3,5' 형식. 빈 입력이면 선택 없음."""
    out()
    out(f"[bold]{title}[/bold]" if RICH else title)
    out("  (쉼표로 여러 개 선택, 그냥 엔터 = 선택 안 함)", style="grey58")
    for i, it in enumerate(items, 1):
        label = labeler(it)
        if describer:
            desc = describer(it)
            if RICH:
                _console.print(f"  [cyan]{i:>2}[/cyan]. {label}  [grey58]— {desc}[/grey58]", highlight=False)
            else:
                print(f"  {i:>2}. {label} — {desc}")
        else:
            out(f"  {i:>2}. {label}")
    raw = ask("번호들", "")
    picked = []
    for tok in raw.replace(" ", "").split(","):
        if not tok:
            continue
        try:
            n = int(tok)
        except ValueError:
            continue
        if 1 <= n <= len(items):
            picked.append(items[n - 1])
    return picked


def ask_list(prompt: str) -> List[str]:
    """쉼표 구분 목록 입력."""
    raw = ask(prompt, "")
    return [x.strip() for x in raw.split(",") if x.strip()]
