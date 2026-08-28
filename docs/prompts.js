/* 심판 프롬프트 조립 — aegis/prompts.py 의 JS 판.
   규칙 본문(JUDGE_RULES)은 data.js 에 담겨 오고, 여기서는 조립만 한다. */
(function () {
"use strict";

  const D = window.AEGIS_DATA;
  const STATE_OPEN = D.state_open;
  const STATE_CLOSE = D.state_close;

  /* ── 시트 → 프롬프트 텍스트 ──────────────────────────────────────────── */

  function abilityLine(a) {
    let s = a.desc ? `${a.name} — ${a.desc}` : a.name;
    if (a.cost) s += ` (대가/제약: ${a.cost})`;
    return s;
  }

  function characterBlock(c) {
    const L = [`■ ${c.name}` + (c.title ? ` 《${c.title}》` : "")];
    if (c.concept) L.push(`  컨셉: ${c.concept}`);
    if (c.power_tier) L.push(`  전력 등급: ${c.power_tier}`);
    if (c.appearance) L.push(`  외형: ${c.appearance}`);
    if (c.personality) L.push(`  성격: ${c.personality}`);
    if (c.combat_style) L.push(`  전투 스타일: ${c.combat_style}`);
    if (c.abilities?.length) {
      L.push("  능력:");
      c.abilities.forEach(a => L.push(`    - ${abilityLine(a)}`));
    }
    if (c.equipment?.length) L.push("  장비: " + c.equipment.join(", "));
    if (c.strengths?.length) L.push("  강점: " + c.strengths.join(", "));
    if (c.weaknesses?.length) L.push("  약점: " + c.weaknesses.join(", "));
    if (c.notes) L.push(`  비고: ${c.notes}`);
    return L.join("\n");
  }

  function troopsBlock(t) {
    const L = [`  병력 규모: ${t.size}`];
    if (t.composition) L.push(`  편성: ${t.composition}`);
    L.push(`  숙련도: ${t.quality} / 사기: ${t.morale} / 보급: ${t.supply}`);
    if (t.formation) L.push(`  전술 방침: ${t.formation}`);
    return L.join("\n");
  }

  function forceName(f) {
    return f.banner || (f.characters?.[0]?.name) || `진영 ${f.key}`;
  }

  function forceBlock(f) {
    let head = `[진영 ${f.key}] ${forceName(f)}`;
    if (f.role) head += ` (${f.role})`;
    const L = [head];
    if (f.objective) L.push(`  승리 목표: ${f.objective}`);
    if (f.troops) L.push(troopsBlock(f.troops));
    (f.characters || []).forEach(c => {
      L.push(characterBlock(c).split("\n").map(x => "  " + x).join("\n"));
    });
    return L.join("\n");
  }

  function configBlock(cfg) {
    const L = [
      `전투 형식: ${cfg.scale}`,
      `전장: ${cfg.environment_name} — ${cfg.environment_desc}`,
    ];
    if (cfg.modifiers?.length) {
      L.push("전장 변수/디버프:");
      cfg.modifiers.forEach(m => L.push(`  - ${m.name}: ${m.desc}`));
    } else L.push("전장 변수/디버프: 없음");
    L.push(`서술 톤: ${cfg.tone} — ${cfg.tone_desc}`);
    L.push(`묘사 수위: ${cfg.intensity}`);
    L.push(`라운드당 분량: ${cfg.detail}`);
    L.push(`승리 조건: ${cfg.victory_condition}`);
    L.push(`최대 라운드: ${cfg.max_rounds}`);
    if (cfg.extra_rules) L.push(`추가 규칙(사용자 지정): ${cfg.extra_rules}`);
    return L.join("\n");
  }

  /* ── 시스템 프롬프트 ─────────────────────────────────────────────────── */

  function buildSystemPrompt(battle) {
    const scale = D.scales.find(s => s.key === battle.config.scale) || D.scales[0];
    const parts = [D.judge_rules, "", "## 이번 전투의 형식",
      `${scale.name} — ${scale.desc}`, scale.prompt, "", "## 전장 조건",
      configBlock(battle.config), "", "## 참전 진영"];
    battle.forces.forEach(f => { parts.push(forceBlock(f)); parts.push(""); });
    parts.push("## 서술 지침");
    parts.push(
      `- 톤: ${battle.config.tone}. ${battle.config.tone_desc}\n` +
      `- 분량: ${battle.config.detail}\n` +
      `- 수위: ${battle.config.intensity}\n` +
      "- 한국어로 서술한다.\n" +
      "- 대사는 각 캐릭터의 성격에 맞게 쓴다. 성격 설정이 없으면 최소한으로만 넣는다.\n" +
      "- 매 라운드는 '### 라운드 N — <소제목>' 으로 시작한다.\n" +
      "- 마지막에는 반드시 STATE 블록을 붙인다."
    );
    return parts.join("\n");
  }

  function buildOpeningMessage() {
    return (
      "전투를 개시한다.\n\n" +
      "먼저 **개전 장면**을 써라. 전장의 모습, 양측이 마주 서는 순간, " +
      "적용된 환경과 디버프가 어떤 압박으로 다가오는지를 보여줘라. " +
      "이 단계에서는 아직 결정적 교전이 벌어지지 않는다 — 첫 합까지만.\n\n" +
      "제목은 '### 개전' 으로 시작하고, 마지막에 STATE 블록(round: 0)을 붙여라."
    );
  }

  function buildRoundMessage(n, maxRounds, injection) {
    const msg = [
      `라운드 ${n}을(를) 진행하라. (최대 ${maxRounds} 라운드)`,
      "직전 STATE의 부상·소모·사기를 그대로 이어받아 전개하고, " +
      "전장 조건을 최소 하나는 실제로 개입시켜라.",
    ];
    if (n >= maxRounds) {
      msg.push(
        "**이번이 마지막 라운드다.** 이 라운드 안에서 반드시 결착을 내고 " +
        "battle_over 를 true 로, winner 를 확정하라. " +
        '승리 조건상 무승부가 성립하는 경우에만 winner 를 "draw" 로 둘 수 있다.'
      );
    }
    if (injection) {
      msg.push(
        "\n[관전자 개입 — 이번 라운드에 반영할 것]\n" + injection +
        "\n이 개입을 전개에 자연스럽게 녹이되, 판정의 공정성은 유지하라."
      );
    }
    return msg.join("\n");
  }

  function buildEpilogueMessage() {
    return (
      "전투가 끝났다. 이제 **전후 정리**를 써라. STATE 블록은 붙이지 마라.\n\n" +
      "1. **결착** — 마지막 장면의 여운을 짧게.\n" +
      "2. **승패 요약** — 누가 왜 이겼는지 3~5줄.\n" +
      "3. **심판 총평** — 심판의 시선에서, 어떤 설정과 조건이 승부를 갈랐는지 분석하라. " +
      "패배 측이 무엇을 다르게 했다면 결과가 뒤집혔을지도 한 줄 덧붙여라.\n" +
      "4. **주요 순간 3선** — 전투 전체에서 결정적이었던 장면 세 개를 한 줄씩."
    );
  }

  window.AEGIS_PROMPTS = {
    STATE_OPEN, STATE_CLOSE, forceName, forceBlock, configBlock, characterBlock,
    buildSystemPrompt, buildOpeningMessage, buildRoundMessage, buildEpilogueMessage,
  };

})();
