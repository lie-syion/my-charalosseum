/* 브라우저에서 도는 전투 엔진.
   Anthropic API 를 직접 호출한다 (CORS 허용 헤더 사용). 키는 이 브라우저 밖으로 나가지 않는다. */
(function () {
"use strict";

  const PR = window.AEGIS_PROMPTS;
  const API_URL = "https://api.anthropic.com/v1/messages";
  const DEFAULT_MODEL = "claude-sonnet-4-5";

  /* ── STATE 블록 분리 ─────────────────────────────────────────────────── */

  /** 조각 스트림에서 STATE 블록 앞부분만 흘려보낸다. */
  async function* splitStream(chunks) {
    const marker = PR.STATE_OPEN;
    let buf = "", printed = 0, hit = false;
    for await (const chunk of chunks) {
      buf += chunk;
      if (hit) continue;
      const idx = buf.indexOf(marker);
      if (idx !== -1) {
        if (idx > printed) yield { type: "text", t: buf.slice(printed, idx) };
        printed = idx; hit = true;
      } else {
        const safe = buf.length - marker.length;
        if (safe > printed) { yield { type: "text", t: buf.slice(printed, safe) }; printed = safe; }
      }
    }
    if (!hit && printed < buf.length) yield { type: "text", t: buf.slice(printed) };
    yield { type: "full", t: buf };
  }

  function parseState(text) {
    const i = text.indexOf(PR.STATE_OPEN);
    if (i === -1) return null;
    const tail = text.slice(i + PR.STATE_OPEN.length);
    let depth = 0, start = -1, raw = null;
    for (let j = 0; j < tail.length; j++) {
      const ch = tail[j];
      if (ch === "{") { if (depth === 0) start = j; depth++; }
      else if (ch === "}") { depth--; if (depth === 0 && start !== -1) { raw = tail.slice(start, j + 1); break; } }
    }
    if (!raw) return null;
    try { return JSON.parse(raw); } catch (e) { return null; }
  }

  function stripState(text) {
    const i = text.indexOf(PR.STATE_OPEN);
    return (i === -1 ? text : text.slice(0, i)).trimEnd();
  }

  /* ── 백엔드 ──────────────────────────────────────────────────────────── */

  class ApiError extends Error {
    constructor(message, code) { super(message); this.code = code; }
  }

  /** Anthropic API 를 브라우저에서 직접 호출하는 백엔드. */
  class AnthropicBackend {
    constructor({ apiKey, model, maxTokens, temperature }) {
      this.apiKey = apiKey;
      this.model = model || DEFAULT_MODEL;
      this.maxTokens = maxTokens || 4000;
      this.temperature = temperature ?? 1.0;
    }

    async *stream(system, messages, signal) {
      let res;
      try {
        res = await fetch(API_URL, {
          method: "POST",
          signal,
          headers: {
            "content-type": "application/json",
            "x-api-key": this.apiKey,
            "anthropic-version": "2023-06-01",
            "anthropic-dangerous-direct-browser-access": "true",
          },
          body: JSON.stringify({
            model: this.model, max_tokens: this.maxTokens,
            temperature: this.temperature, system, messages, stream: true,
          }),
        });
      } catch (e) {
        throw new ApiError(
          "API 서버에 닿지 못했습니다. 네트워크나 확장 프로그램(광고 차단 등)을 확인해 주세요.",
          "network");
      }

      if (!res.ok) {
        let detail = "";
        try { detail = (await res.json())?.error?.message || ""; } catch (e) {}
        const map = {
          401: "API 키가 올바르지 않습니다. 설정에서 다시 확인해 주세요.",
          403: "이 키로는 요청이 허용되지 않습니다.",
          429: "요청이 너무 많습니다(rate limit). 잠시 뒤 다시 시도해 주세요.",
          400: "요청이 거부되었습니다" + (detail ? ` — ${detail}` : ""),
          529: "API가 과부하 상태입니다. 잠시 뒤 다시 시도해 주세요.",
        };
        throw new ApiError(map[res.status] || `API 오류 ${res.status}${detail ? " — " + detail : ""}`,
          String(res.status));
      }

      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop();
        for (const line of lines) {
          if (!line.startsWith("data:")) continue;
          const payload = line.slice(5).trim();
          if (!payload || payload === "[DONE]") continue;
          let ev;
          try { ev = JSON.parse(payload); } catch (e) { continue; }
          if (ev.type === "content_block_delta" && ev.delta?.type === "text_delta") {
            yield ev.delta.text;
          } else if (ev.type === "error") {
            throw new ApiError(ev.error?.message || "스트림 오류", "stream");
          }
        }
      }
    }

    async complete(system, messages) {
      let out = "";
      for await (const t of this.stream(system, messages)) out += t;
      return out;
    }
  }

  /** 키 없이 UI/흐름을 확인하기 위한 가짜 백엔드. */
  class MockBackend {
    constructor(keys, maxRounds) {
      this.keys = keys?.length ? keys : ["A", "B"];
      this.integrity = {}; this.keys.forEach(k => (this.integrity[k] = 100));
      this.round = -1;
      this.maxRounds = maxRounds || 8;
    }

    async *stream(system, messages) {
      const sleep = ms => new Promise(r => setTimeout(r, ms));
      const last = messages[messages.length - 1]?.content || "";

      if (last.includes("전후 정리")) {
        const text =
          "### 전후 정리\n\n" +
          "**결착** — (체험 모드) 마지막 일격의 여운이 전장에 남는다.\n\n" +
          "**승패 요약** — 자리표시자입니다. API 키를 넣으면 심판이 설정에 근거해 " +
          "승패를 분석합니다.\n\n" +
          "**심판 총평** — 어떤 설정과 조건이 승부를 갈랐는지가 여기에 들어갑니다.\n\n" +
          "**주요 순간 3선**\n\n1. 첫 번째 장면\n2. 두 번째 장면\n3. 세 번째 장면\n";
        for (let i = 0; i < text.length; i += 5) { await sleep(14); yield text.slice(i, i + 5); }
        return;
      }

      this.round += 1;
      const head = this.round === 0 ? "### 개전" : `### 라운드 ${this.round} — 자리표시자`;
      const body =
        `${head}\n\n` +
        "**체험 모드**입니다. 실제 서술 대신 자리표시자를 흘려보냅니다. " +
        "오른쪽 위 **설정**에서 API 키를 넣으면 이 자리에 AI 심판이 쓴 전투 장면이 " +
        "한 글자씩 스트리밍됩니다.\n\n" +
        "전장의 공기가 무겁게 가라앉는다. 양측은 서로의 간격을 재고 있고, " +
        "적용된 환경과 디버프가 각자의 호흡을 조금씩 갉아먹는다. " +
        "누구도 먼저 움직이지 않는다 — 아직은.\n\n" +
        "> 이 문단은 UI 확인용 더미 텍스트이며, 전황 수치는 무작위로 굴러갑니다.\n\n";
      for (let i = 0; i < body.length; i += 5) { await sleep(14); yield body.slice(i, i + 5); }

      if (this.round > 0) {
        this.keys.forEach(k => {
          this.integrity[k] = Math.max(0, this.integrity[k] - (8 + Math.floor(Math.random() * 19)));
        });
      }
      const alive = this.keys.filter(k => this.integrity[k] > 15);
      const over = this.round >= this.maxRounds || alive.length <= 1;
      const winner = over
        ? this.keys.reduce((a, b) => (this.integrity[a] >= this.integrity[b] ? a : b))
        : null;

      const state = {
        round: this.round,
        sides: this.keys.map(k => ({
          key: k, integrity: this.integrity[k],
          morale: Math.max(0, this.integrity[k] - 5),
          status: this.integrity[k] > 70 ? [] : ["부상 누적"],
          resources: "체험 모드",
        })),
        momentum: winner || this.keys[this.round % this.keys.length],
        turning_point: "(체험) 결정적 순간",
        judge_note: "(체험) 판정 근거",
        battle_over: over, winner,
        victory_reason: over ? "(체험) 잔존 전투력 우세" : "",
      };
      yield PR.STATE_OPEN + "\n" + JSON.stringify(state, null, 2) + "\n" + PR.STATE_CLOSE;
    }

    async complete() { return "{}"; }
  }

  /* ── 전투 진행 ───────────────────────────────────────────────────────── */

  class BattleRunner {
    constructor(battle, backend) {
      this.battle = battle;
      this.backend = backend;
      this.system = PR.buildSystemPrompt(battle);
      this.messages = [];
      this.history = [];
      this.finished = false;
      this.winner = null;
      this.victoryReason = "";
    }

    async *_turn(userMsg, roundNo, isEpilogue) {
      this.messages.push({ role: "user", content: userMsg });
      let full = "";
      for await (const ev of splitStream(this.backend.stream(this.system, this.messages))) {
        if (ev.type === "text") yield { type: "text", t: ev.t };
        else full = ev.t;
      }
      this.messages.push({ role: "assistant", content: full });

      const state = isEpilogue ? null : parseState(full);
      this.history.push({ round: roundNo, narration: stripState(full), state });
      if (state?.battle_over) {
        this.finished = true;
        this.winner = state.winner;
        this.victoryReason = state.victory_reason || "";
      }
      yield { type: "state", state };
    }

    opening() { return this._turn(PR.buildOpeningMessage(), 0, false); }
    round(n, injection) {
      return this._turn(PR.buildRoundMessage(n, this.battle.config.max_rounds, injection), n, false);
    }
    epilogue() { return this._turn(PR.buildEpilogueMessage(), -1, true); }

    transcript() {
      const out = ["# 전투 기록", "", "## 전장 설정", "```",
        PR.configBlock(this.battle.config), "```", "", "## 참전 진영"];
      this.battle.forces.forEach(f => { out.push("```", PR.forceBlock(f), "```"); });
      out.push("", "## 전투");
      this.history.forEach(r => {
        out.push(r.narration);
        if (r.state) {
          const bits = (r.state.sides || []).map(
            s => `${s.key} 전투력 ${s.integrity} / 사기 ${s.morale}`).join(" | ");
          const note = r.state.judge_note ? `  —  심판 노트: ${r.state.judge_note}` : "";
          out.push("", "> " + bits + note);
        }
        out.push("");
      });
      return out.join("\n");
    }
  }

  /* ── AI 캐릭터 생성 ──────────────────────────────────────────────────── */

  async function generateCharacter(backend, concept, extra) {
    let msg = `컨셉: ${concept}`;
    if (extra) msg += `\n추가 요구사항: ${extra}`;
    const raw = await backend.complete(window.AEGIS_DATA.character_gen_system,
      [{ role: "user", content: msg }]);
    const s = raw.indexOf("{"), e = raw.lastIndexOf("}");
    if (s === -1 || e === -1) throw new Error("생성 결과를 해석하지 못했습니다.");
    return JSON.parse(raw.slice(s, e + 1));
  }

  window.AEGIS_ENGINE = {
    AnthropicBackend, MockBackend, BattleRunner, ApiError,
    parseState, stripState, generateCharacter, DEFAULT_MODEL,
  };

})();
