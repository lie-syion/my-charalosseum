"""데이터 모델: 캐릭터, 진영, 전투 설정."""
from __future__ import annotations

from dataclasses import dataclass, field, asdict
from typing import Any, Dict, List, Optional


# ---------------------------------------------------------------- 캐릭터


@dataclass
class Ability:
    name: str
    desc: str = ""
    cost: str = ""          # 대가 / 제약 / 쿨타임 — AI가 남용을 막는 데 씀

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: Dict[str, Any]) -> "Ability":
        return cls(
            name=d.get("name", ""),
            desc=d.get("desc", ""),
            cost=d.get("cost", ""),
        )

    def brief(self) -> str:
        s = f"{self.name} — {self.desc}" if self.desc else self.name
        if self.cost:
            s += f" (대가/제약: {self.cost})"
        return s


@dataclass
class Character:
    name: str
    title: str = ""                       # 이명 / 칭호
    concept: str = ""                     # 한 줄 컨셉
    appearance: str = ""
    personality: str = ""
    combat_style: str = ""                # 어떻게 싸우는가
    power_tier: str = "B"                 # 자유 기술 (E~SSS, 또는 "인간 최강급" 등)
    abilities: List[Ability] = field(default_factory=list)
    equipment: List[str] = field(default_factory=list)
    strengths: List[str] = field(default_factory=list)
    weaknesses: List[str] = field(default_factory=list)
    notes: str = ""                       # 기타 설정 / 금기 / 뒷사정

    # ---- 직렬화
    def to_dict(self) -> Dict[str, Any]:
        d = asdict(self)
        d["abilities"] = [a.to_dict() for a in self.abilities]
        return d

    @classmethod
    def from_dict(cls, d: Dict[str, Any]) -> "Character":
        return cls(
            name=d.get("name", "이름 없음"),
            title=d.get("title", ""),
            concept=d.get("concept", ""),
            appearance=d.get("appearance", ""),
            personality=d.get("personality", ""),
            combat_style=d.get("combat_style", ""),
            power_tier=d.get("power_tier", "B"),
            abilities=[Ability.from_dict(a) for a in d.get("abilities", [])],
            equipment=list(d.get("equipment", [])),
            strengths=list(d.get("strengths", [])),
            weaknesses=list(d.get("weaknesses", [])),
            notes=d.get("notes", ""),
        )

    # ---- 프롬프트용 텍스트
    def to_prompt_block(self) -> str:
        lines = [f"■ {self.name}" + (f" 《{self.title}》" if self.title else "")]
        if self.concept:
            lines.append(f"  컨셉: {self.concept}")
        if self.power_tier:
            lines.append(f"  전력 등급: {self.power_tier}")
        if self.appearance:
            lines.append(f"  외형: {self.appearance}")
        if self.personality:
            lines.append(f"  성격: {self.personality}")
        if self.combat_style:
            lines.append(f"  전투 스타일: {self.combat_style}")
        if self.abilities:
            lines.append("  능력:")
            lines += [f"    - {a.brief()}" for a in self.abilities]
        if self.equipment:
            lines.append("  장비: " + ", ".join(self.equipment))
        if self.strengths:
            lines.append("  강점: " + ", ".join(self.strengths))
        if self.weaknesses:
            lines.append("  약점: " + ", ".join(self.weaknesses))
        if self.notes:
            lines.append(f"  비고: {self.notes}")
        return "\n".join(lines)

    def label(self) -> str:
        return f"{self.name}" + (f"({self.title})" if self.title else "")


# ---------------------------------------------------------------- 부대 / 진영


@dataclass
class Troops:
    """군대 전쟁·공성전에서 쓰는 병력 정보."""
    size: str = "1000"
    composition: str = ""       # "중장보병 600, 궁병 300, 기병 100"
    quality: str = "숙련병"      # 징집병 / 숙련병 / 정예 / 전설
    morale: str = "보통"
    supply: str = "충분"
    formation: str = ""         # 진형·전술 방침

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: Dict[str, Any]) -> "Troops":
        return cls(**{k: d.get(k, v) for k, v in asdict(cls()).items()})

    def to_prompt_block(self) -> str:
        lines = [f"  병력 규모: {self.size}"]
        if self.composition:
            lines.append(f"  편성: {self.composition}")
        lines.append(f"  숙련도: {self.quality} / 사기: {self.morale} / 보급: {self.supply}")
        if self.formation:
            lines.append(f"  전술 방침: {self.formation}")
        return "\n".join(lines)


@dataclass
class Force:
    """전투에 참가하는 진영 하나."""
    key: str                                  # "A", "B", "C" ...
    banner: str = ""                          # 진영 이름
    characters: List[Character] = field(default_factory=list)
    troops: Optional[Troops] = None
    role: str = ""                            # 공성전 등에서 "공격군" / "수비군"
    objective: str = ""                       # 이 진영의 승리 목표

    def to_dict(self) -> Dict[str, Any]:
        return {
            "key": self.key,
            "banner": self.banner,
            "characters": [c.to_dict() for c in self.characters],
            "troops": self.troops.to_dict() if self.troops else None,
            "role": self.role,
            "objective": self.objective,
        }

    @classmethod
    def from_dict(cls, d: Dict[str, Any]) -> "Force":
        return cls(
            key=d.get("key", "A"),
            banner=d.get("banner", ""),
            characters=[Character.from_dict(c) for c in d.get("characters", [])],
            troops=Troops.from_dict(d["troops"]) if d.get("troops") else None,
            role=d.get("role", ""),
            objective=d.get("objective", ""),
        )

    def display_name(self) -> str:
        if self.banner:
            return self.banner
        if self.characters:
            return self.characters[0].name
        return f"진영 {self.key}"

    def to_prompt_block(self) -> str:
        head = f"[진영 {self.key}] {self.display_name()}"
        if self.role:
            head += f" ({self.role})"
        lines = [head]
        if self.objective:
            lines.append(f"  승리 목표: {self.objective}")
        if self.troops:
            lines.append(self.troops.to_prompt_block())
        for c in self.characters:
            block = c.to_prompt_block()
            lines.append("\n".join("  " + ln for ln in block.split("\n")))
        return "\n".join(lines)


# ---------------------------------------------------------------- 전투 설정


@dataclass
class BattleConfig:
    scale: str = "duel"                     # presets.SCALES 의 키
    environment_name: str = ""
    environment_desc: str = ""
    modifiers: List[Dict[str, str]] = field(default_factory=list)   # {name, desc}
    tone: str = "정통 판타지"
    tone_desc: str = ""
    intensity: str = "보통"                  # 묘사 수위
    max_rounds: int = 8
    victory_condition: str = "전투 불능 또는 항복"
    detail: str = "보통"                     # 라운드당 서술 분량
    extra_rules: str = ""                    # 사용자가 직접 넣는 자유 조건
    interactive: bool = True                 # 라운드 사이 개입 허용

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: Dict[str, Any]) -> "BattleConfig":
        base = asdict(cls())
        return cls(**{k: d.get(k, v) for k, v in base.items()})

    def to_prompt_block(self) -> str:
        lines = [
            f"전투 형식: {self.scale}",
            f"전장: {self.environment_name} — {self.environment_desc}",
        ]
        if self.modifiers:
            lines.append("전장 변수/디버프:")
            for m in self.modifiers:
                lines.append(f"  - {m.get('name','')}: {m.get('desc','')}")
        else:
            lines.append("전장 변수/디버프: 없음")
        lines.append(f"서술 톤: {self.tone} — {self.tone_desc}")
        lines.append(f"묘사 수위: {self.intensity}")
        lines.append(f"라운드당 분량: {self.detail}")
        lines.append(f"승리 조건: {self.victory_condition}")
        lines.append(f"최대 라운드: {self.max_rounds}")
        if self.extra_rules:
            lines.append(f"추가 규칙(사용자 지정): {self.extra_rules}")
        return "\n".join(lines)


@dataclass
class Battle:
    """한 번의 전투 전체 (설정 + 진영)."""
    config: BattleConfig
    forces: List[Force]

    def to_dict(self) -> Dict[str, Any]:
        return {
            "config": self.config.to_dict(),
            "forces": [f.to_dict() for f in self.forces],
        }

    @classmethod
    def from_dict(cls, d: Dict[str, Any]) -> "Battle":
        return cls(
            config=BattleConfig.from_dict(d.get("config", {})),
            forces=[Force.from_dict(f) for f in d.get("forces", [])],
        )

    def force_by_key(self, key: str) -> Optional[Force]:
        for f in self.forces:
            if f.key == key:
                return f
        return None
