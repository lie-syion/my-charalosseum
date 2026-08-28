/* ═══════════════════════════ AEGIS — front-end ═══════════════════════════
   서버 없이 브라우저에서 전부 돈다.
   - 싱글: 내 API 키로 직접 판정
   - 멀티: PeerJS 로 방을 만들고, '심판' 한 명의 키로 판정해 모두에게 중계
*/
const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => (
  { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

const D   = window.AEGIS_DATA;
const PR  = window.AEGIS_PROMPTS;
const E   = window.AEGIS_ENGINE;
const S   = window.AEGIS_STORE;
const Net = window.AEGIS_NET;

const SIDE_COLORS = ["#6ba4ff", "#ff7a6b", "#6bd39a", "#c48bff", "#ffd76b", "#5fd7d7"];
const KEYS = "ABCDEF";

let roster = [];
let editing = null;      // 편집 중인 캐릭터 id
let pickTarget = null;   // 캐릭터 선택 모달의 대상 (진영 index 또는 "guest")

/* ── 위저드 ─────────────────────────────────────────────────────────── */
const W = {
  step: 0, scale: null, nSides: 2, forces: [],
  env: null, mods: [], tone: null,
  intensity: "보통", detail: "보통",
  victory: "전투 불능 또는 항복", maxRounds: 8, extra: "", interactive: true,
  multi: false,
};

/* ── 전투 ───────────────────────────────────────────────────────────── */
const B = {
  runner: null, battle: null, forces: [], config: null,
  round: 0, busy: false, auto: false, finished: false,
  raw: "", node: null, prevIntegrity: {},
  resultShown: false, epilogueDone: false,
  abort: null,
};

/* ── 멀티 ───────────────────────────────────────────────────────────── */
const M = {
  active: false, isHost: false, nick: "",
  party: [],            // [{id, nick, chars, offersKey}]
  judgeId: "host",
  slotCount: 1,
  scaleName: "",
  myChars: [],
  pendingInject: null,
};

const amJudge = () => !M.active || M.judgeId === (M.isHost ? "host" : Net.myId);
const amController = () => !M.active || M.isHost;

/* ══════════════════════════════ 유틸 ══════════════════════════════ */

function toast(msg, isErr) {
  const t = document.createElement("div");
  t.className = "toast" + (isErr ? " err" : "");
  t.textContent = msg;
  $("#toast-wrap").appendChild(t);
  setTimeout(() => { t.style.opacity = "0"; t.style.transition = "opacity .3s"; }, 3000);
  setTimeout(() => t.remove(), 3400);
}

function show(name) {
  $$(".screen").forEach(s => s.classList.remove("active"));
  $("#screen-" + name).classList.add("active");
}

let openModals = [];
function modal(id, on) {
  $("#" + id).classList.toggle("on", on);
  openModals = openModals.filter(x => x !== id);
  if (on) openModals.push(id);
  $("#overlay").classList.toggle("on", openModals.length > 0);
}
function closeTop() { if (openModals.length) modal(openModals[openModals.length - 1], false); }

$("#overlay").addEventListener("click", closeTop);
document.addEventListener("click", e => {
  if (e.target.matches("[data-close]")) closeTop();
  const go = e.target.closest("[data-go]");
  if (go) route(go.dataset.go);
});

function route(name) {
  if (name === "roster") { loadRoster(); renderRoster(); show("roster"); }
  else if (name === "saved") { renderSaved(); show("saved"); }
  else if (name === "setup") { M.active = false; startWizard(false); show("setup"); }
  else if (name === "lobby") { openLobby(); show("lobby"); }
  else show(name);
}

/* ── 마크다운 ───────────────────────────────────────────────────────── */
function md(src) {
  let out = "", list = null;
  const inline = s => esc(s)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");
  const closeList = () => { if (list) { out += `</${list}>`; list = null; } };

  for (const raw of String(src).split("\n")) {
    const line = raw.trimEnd();
    if (!line.trim()) { closeList(); continue; }
    let m;
    if ((m = line.match(/^#{1,4}\s+(.*)$/))) { closeList(); out += `<h3>${inline(m[1])}</h3>`; }
    else if ((m = line.match(/^>\s?(.*)$/))) { closeList(); out += `<blockquote>${inline(m[1])}</blockquote>`; }
    else if ((m = line.match(/^\s*\d+\.\s+(.*)$/))) {
      if (list !== "ol") { closeList(); out += "<ol>"; list = "ol"; }
      out += `<li>${inline(m[1])}</li>`;
    } else if ((m = line.match(/^\s*[-*]\s+(.*)$/))) {
      if (list !== "ul") { closeList(); out += "<ul>"; list = "ul"; }
      out += `<li>${inline(m[1])}</li>`;
    } else { closeList(); out += `<p>${inline(line)}</p>`; }
  }
  closeList();
  return out;
}

function withCaret(html) {
  const CARET = '<span class="caret"></span>';
  const k = Math.max(html.lastIndexOf("</p>"), html.lastIndexOf("</li>"));
  return k === -1 ? html + `<p>${CARET}</p>` : html.slice(0, k) + CARET + html.slice(k);
}

/* ══════════════════════════════ 설정 ══════════════════════════════ */

function makeBackend(forceKeys, maxRounds) {
  const st = S.getSettings();
  if (!st.apiKey.trim()) return new E.MockBackend(forceKeys, maxRounds);
  return new E.AnthropicBackend({
    apiKey: st.apiKey.trim(), model: st.model, maxTokens: Number(st.maxTokens) || 4000,
  });
}

function refreshModeBadge() {
  const st = S.getSettings();
  const badge = $("#mode-badge");
  if (st.apiKey.trim()) {
    badge.textContent = st.model || E.DEFAULT_MODEL;
    badge.className = "badge live";
    $("#mode-note").textContent = "라운드마다 AI 심판이 판정합니다";
  } else {
    badge.textContent = "체험 모드";
    badge.className = "badge mock";
    $("#mode-note").textContent = "설정에서 API 키를 넣으면 실제 AI 판정이 켜집니다";
  }
}

function openSettings() {
  const st = S.getSettings();
  $("#s-key").value = st.apiKey;
  $("#s-key").type = "password";
  $("#btn-key-toggle").textContent = "보기";
  $("#s-model").value = st.model;
  $("#s-tokens").value = st.maxTokens;
  $("#s-nick").value = st.nickname;
  modal("modal-settings", true);
}
$("#btn-settings").onclick = openSettings;
$("#btn-key-toggle").onclick = () => {
  const i = $("#s-key");
  i.type = i.type === "password" ? "text" : "password";
  $("#btn-key-toggle").textContent = i.type === "password" ? "보기" : "가리기";
};
$("#btn-key-clear").onclick = () => { $("#s-key").value = ""; };
$("#btn-settings-save").onclick = () => {
  const key = $("#s-key").value.trim();
  if (key && !/^sk-ant-/.test(key)) {
    if (!confirm("키가 'sk-ant-' 로 시작하지 않습니다. 그래도 저장할까요?")) return;
  }
  const ok = S.saveSettings({
    apiKey: key,
    model: $("#s-model").value.trim() || E.DEFAULT_MODEL,
    maxTokens: Number($("#s-tokens").value) || 4000,
    nickname: $("#s-nick").value.trim(),
  });
  modal("modal-settings", false);
  refreshModeBadge();
  toast(ok ? "저장했습니다" : "저장했습니다 (이 브라우저에만)");
};

/* ══════════════════════════════ 로스터 ══════════════════════════════ */

function loadRoster() { roster = S.listCharacters(); }

function renderRoster() {
  const g = $("#roster-grid");
  g.innerHTML = "";
  $("#roster-empty").classList.toggle("hidden", roster.length > 0);
  roster.forEach(c => {
    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `
      <h4>${esc(c.name)}${c.title ? `<span class="sub">《${esc(c.title)}》</span>` : ""}
          <span class="tier">${esc(c.power_tier || "-")}</span></h4>
      <p>${esc(c.concept || c.combat_style || "")}</p>
      <div class="tags">
        ${(c.abilities || []).slice(0, 3).map(a => `<span class="tag">${esc(a.name)}</span>`).join("")}
        ${(c.weaknesses || []).slice(0, 2).map(w =>
          `<span class="tag weak">${esc(w.length > 18 ? w.slice(0, 18) + "…" : w)}</span>`).join("")}
      </div>
      <div class="card-actions">
        <button class="btn subtle sm" data-edit="${esc(c.id)}">편집</button>
        <button class="btn subtle sm" data-dup="${esc(c.id)}">복제</button>
        <button class="btn subtle sm" data-del="${esc(c.id)}">삭제</button>
      </div>`;
    g.appendChild(card);
  });

  g.onclick = e => {
    const b = e.target.closest("button"); if (!b) return;
    const id = b.dataset.edit || b.dataset.del || b.dataset.dup;
    const c = roster.find(x => x.id === id);
    if (b.dataset.edit) openCharEditor(c);
    else if (b.dataset.dup) { const d = { ...c, name: c.name + " (복제)" }; delete d.id; openCharEditor(d, true); }
    else if (b.dataset.del) {
      if (!confirm(`'${c.name}' 을(를) 삭제할까요?`)) return;
      S.deleteCharacter(id); loadRoster(); renderRoster(); toast("삭제했습니다");
    }
  };
}

/* ── 캐릭터 편집기 ─────────────────────────────────────────────────── */

function abilityRow(a = { name: "", desc: "", cost: "" }) {
  const d = document.createElement("div");
  d.className = "ability-row";
  d.innerHTML = `
    <input placeholder="능력 이름" value="${esc(a.name)}">
    <input placeholder="설명" value="${esc(a.desc)}">
    <input placeholder="대가 · 제약" value="${esc(a.cost)}">
    <button class="x" title="삭제">✕</button>`;
  d.querySelector(".x").onclick = () => d.remove();
  return d;
}

function openCharEditor(c, asNew) {
  editing = asNew ? null : (c ? c.id : null);
  $("#char-modal-title").textContent = c ? (asNew ? "캐릭터 복제" : "캐릭터 편집") : "새 캐릭터";
  const g = (id, v) => { $(id).value = v ?? ""; };
  g("#c-name", c?.name); g("#c-title", c?.title); g("#c-concept", c?.concept);
  g("#c-appearance", c?.appearance); g("#c-personality", c?.personality);
  g("#c-style", c?.combat_style); g("#c-tier", c?.power_tier || "B");
  g("#c-equipment", (c?.equipment || []).join(", "));
  g("#c-strengths", (c?.strengths || []).join(", "));
  g("#c-weaknesses", (c?.weaknesses || []).join(", "));
  g("#c-notes", c?.notes);
  const list = $("#ability-list"); list.innerHTML = "";
  (c?.abilities?.length ? c.abilities : [{}, {}]).forEach(a => list.appendChild(abilityRow(
    a.name ? a : { name: "", desc: "", cost: "" })));
  modal("modal-char", true);
  setTimeout(() => $("#c-name").focus(), 120);
}

function readCharEditor() {
  const split = id => $(id).value.split(",").map(s => s.trim()).filter(Boolean);
  const abilities = $$("#ability-list .ability-row").map(r => {
    const [n, d, c] = $$("input", r).map(i => i.value.trim());
    return n ? { name: n, desc: d, cost: c } : null;
  }).filter(Boolean);
  return {
    name: $("#c-name").value.trim(), title: $("#c-title").value.trim(),
    concept: $("#c-concept").value.trim(), appearance: $("#c-appearance").value.trim(),
    personality: $("#c-personality").value.trim(), combat_style: $("#c-style").value.trim(),
    power_tier: $("#c-tier").value.trim() || "B", abilities,
    equipment: split("#c-equipment"), strengths: split("#c-strengths"),
    weaknesses: split("#c-weaknesses"), notes: $("#c-notes").value.trim(),
  };
}

$("#btn-new-char").onclick = () => openCharEditor(null);
$("#btn-add-ability").onclick = () => $("#ability-list").appendChild(abilityRow());
$("#btn-save-char").onclick = () => {
  const data = readCharEditor();
  if (!data.name) { toast("이름을 입력해 주세요", true); return; }
  S.saveCharacter(data, editing);
  modal("modal-char", false);
  loadRoster(); renderRoster();
  toast("저장했습니다");
};
$("#btn-export-char").onclick = () => {
  const data = readCharEditor();
  if (!data.name) { toast("이름을 입력해 주세요", true); return; }
  S.downloadText(`${data.name}.json`, JSON.stringify(data, null, 2));
};
$("#btn-import-char").onclick = () => $("#file-import").click();
$("#file-import").onchange = async e => {
  const f = e.target.files?.[0]; if (!f) return;
  try {
    const parsed = JSON.parse(await f.text());
    (Array.isArray(parsed) ? parsed : [parsed]).forEach(c => S.saveCharacter(c));
    loadRoster(); renderRoster();
    toast("불러왔습니다");
  } catch (err) { toast("JSON 파일을 읽지 못했습니다", true); }
  e.target.value = "";
};

/* ── AI 생성 ───────────────────────────────────────────────────────── */
$("#btn-ai-char").onclick = () => {
  if (!S.hasKey()) { toast("설정에서 API 키를 먼저 넣어 주세요", true); return; }
  modal("modal-ai", true);
};
$("#btn-ai-go").onclick = async () => {
  const concept = $("#ai-concept").value.trim();
  if (!concept) { toast("컨셉을 적어 주세요", true); return; }
  const btn = $("#btn-ai-go"); btn.disabled = true; btn.textContent = "생성 중…";
  try {
    const data = await E.generateCharacter(makeBackend(), concept, $("#ai-extra").value.trim());
    modal("modal-ai", false);
    openCharEditor(data, true);
  } catch (e) { toast(e.message, true); }
  finally { btn.disabled = false; btn.textContent = "생성"; }
};

/* ══════════════════════════ 저장된 전투 설정 ══════════════════════════ */

function renderSaved() {
  const items = S.listBattles();
  const list = $("#saved-list"); list.innerHTML = "";
  $("#saved-empty").classList.toggle("hidden", items.length > 0);
  items.forEach(it => {
    const b = it.data;
    const scale = (D.scales.find(s => s.key === b.config.scale) || {}).name || b.config.scale;
    const row = document.createElement("div");
    row.className = "row";
    row.innerHTML = `
      <div class="grow"><b>${esc(it.name)}</b>
        <div class="sub">${esc(scale)} · ${esc(b.config.environment_name)}</div></div>
      <button class="btn sm" data-start>시작</button>
      <button class="btn subtle sm" data-rm>삭제</button>`;
    row.querySelector("[data-start]").onclick = () => { M.active = false; beginBattle(b); };
    row.querySelector("[data-rm]").onclick = () => { S.deleteBattle(it.id); renderSaved(); };
    list.appendChild(row);
  });
}

/* ══════════════════════════════ 멀티 로비 ══════════════════════════════ */

function openLobby() {
  loadRoster();
  const st = S.getSettings();
  $("#host-nick").value = st.nickname || "";
  $("#join-nick").value = st.nickname || "";
  if (!Net.connected) {
    $("#lobby-entry").classList.remove("hidden");
    $("#lobby-room").classList.add("hidden");
  }
}

function lobbyStatus(text, kind) {
  const el = $("#lobby-status");
  el.textContent = text;
  el.className = "badge " + (kind === "ok" ? "live" : kind === "err" ? "mock" : "");
}

$("#btn-create-room").onclick = async () => {
  const nick = $("#host-nick").value.trim() || "방장";
  S.saveSettings({ nickname: nick });
  const btn = $("#btn-create-room"); btn.disabled = true; btn.textContent = "여는 중…";
  try {
    const code = await Net.host({ nick, onEvent: onNetEvent, onStatus: lobbyStatus });
    M.active = true; M.isHost = true; M.nick = nick; M.judgeId = "host";
    M.party = [{ id: "host", nick, chars: [], offersKey: S.hasKey() }];
    $("#room-code").textContent = code;
    $("#lobby-entry").classList.add("hidden");
    $("#lobby-room").classList.remove("hidden");
    $("#host-panel").classList.remove("hidden");
    $("#guest-panel").classList.add("hidden");
    $("#guest-wait").classList.add("hidden");
    renderParty();
    if (!S.hasKey()) toast("키가 없어 체험 모드로 진행됩니다. 참가자에게 심판을 넘길 수도 있어요.");
  } catch (e) { toast(e.message, true); lobbyStatus("연결 실패", "err"); }
  finally { btn.disabled = false; btn.textContent = "방 만들기"; }
};

$("#btn-join-room").onclick = async () => {
  const nick = $("#join-nick").value.trim() || "참가자";
  const code = $("#join-code").value.trim().toUpperCase();
  S.saveSettings({ nickname: nick });
  const btn = $("#btn-join-room"); btn.disabled = true; btn.textContent = "연결 중…";
  try {
    await Net.join(code, { nick, onEvent: onNetEvent, onStatus: lobbyStatus });
    M.active = true; M.isHost = false; M.nick = nick; M.myChars = [];
    $("#room-code").textContent = code;
    $("#lobby-entry").classList.add("hidden");
    $("#lobby-room").classList.remove("hidden");
    $("#host-panel").classList.add("hidden");
    $("#guest-panel").classList.remove("hidden");
    $("#guest-offer-key").checked = S.hasKey();
    if (S.hasKey()) Net.send("offer_key", { offers: true });
    renderGuestSlots();
  } catch (e) { toast(e.message, true); lobbyStatus("연결 실패", "err"); }
  finally { btn.disabled = false; btn.textContent = "참가"; }
};

$("#btn-copy-code").onclick = async () => {
  const code = $("#room-code").textContent.trim();
  const link = `${location.origin}${location.pathname}?room=${code}`;
  try { await navigator.clipboard.writeText(link); toast("초대 링크를 복사했습니다"); }
  catch (e) { toast(`복사가 막혀 있습니다. 코드를 직접 알려 주세요 — ${code}`, true); }
};

$("#btn-leave-room").onclick = () => {
  Net.reset(); M.active = false; M.party = [];
  $("#lobby-entry").classList.remove("hidden");
  $("#lobby-room").classList.add("hidden");
  lobbyStatus("연결 안 됨");
};

$("#guest-offer-key").onchange = e => Net.send("offer_key", { offers: e.target.checked && S.hasKey() });

function renderParty() {
  const list = $("#party-list"); list.innerHTML = "";
  M.party.forEach(p => {
    const row = document.createElement("div");
    row.className = "party-row";
    const ready = p.id === "host" ? true : p.chars?.length > 0;
    row.innerHTML = `
      <span class="dot ${ready ? "" : "wait"}"></span>
      <div class="grow">
        <div class="who">${esc(p.nick)}${p.id === "host" ? ` <span class="tag">방장</span>` : ""}</div>
        <div class="meta">${p.chars?.length
          ? p.chars.map(c => esc(c.name)).join(", ")
          : (p.id === "host" ? "전투 설정에서 배치합니다" : "캐릭터 제출 대기 중")}</div>
      </div>
      ${M.judgeId === p.id ? `<span class="badge live">심판</span>`
        : p.offersKey ? `<span class="badge">키 있음</span>` : ""}`;
    list.appendChild(row);
  });
  if (M.isHost) renderJudgeSelect();
}

function renderJudgeSelect() {
  const sel = $("#judge-select");
  const cands = M.party.filter(p => p.id === "host" || p.offersKey);
  sel.innerHTML = cands.map(p =>
    `<option value="${esc(p.id)}"${M.judgeId === p.id ? " selected" : ""}>${esc(p.nick)}${p.id === "host" ? " — 나 (방장)" : " — 참가자 키"}</option>`
  ).join("");
  sel.onchange = () => {
    M.judgeId = sel.value;
    Net.send("room", roomSnapshot());
    renderParty();
  };
}

function roomSnapshot() {
  return {
    party: M.party.map(p => ({ id: p.id, nick: p.nick, chars: p.chars, offersKey: p.offersKey })),
    judgeId: M.judgeId, slotCount: M.slotCount, scaleName: M.scaleName,
  };
}

function renderGuestSlots() {
  const box = $("#guest-slots");
  box.innerHTML = "";
  $("#guest-slot-hint").textContent = M.scaleName
    ? `${M.scaleName} — 최대 ${M.slotCount}명까지 낼 수 있습니다.`
    : "방장이 전투 형식을 정하면 몇 명을 낼 수 있는지 표시됩니다.";
  if (!M.myChars.length) {
    box.innerHTML = `<div class="slot empty-slot">비어 있음</div>`;
    return;
  }
  M.myChars.forEach((c, i) => {
    const s = document.createElement("div");
    s.className = "slot";
    s.innerHTML = `<span class="grow">${esc(c.name)}${c.title ? ` <span class="dim">《${esc(c.title)}》</span>` : ""}</span>
                   <span class="tier">${esc(c.power_tier || "-")}</span><button class="x">✕</button>`;
    s.querySelector(".x").onclick = () => { M.myChars.splice(i, 1); renderGuestSlots(); };
    box.appendChild(s);
  });
}

$("#btn-host-setup").onclick = () => {
  if (!M.isHost) return;
  startWizard(true);
  show("setup");
};

$("#btn-guest-pick").onclick = () => openPicker("guest");
$("#btn-guest-submit").onclick = () => {
  if (!M.myChars.length) { toast("캐릭터를 먼저 고르세요", true); return; }
  Net.send("chars", { chars: M.myChars });
  toast("제출했습니다");
};

/* ── 네트워크 이벤트 ───────────────────────────────────────────────── */

function onNetEvent(type, payload, fromId) {
  switch (type) {
    case "peer_joined": {
      if (!M.isHost) return;
      M.party.push({ id: fromId, nick: payload.nick || "참가자", chars: [], offersKey: false });
      renderParty();
      Net.send("room", roomSnapshot());
      toast(`${payload.nick || "참가자"} 님이 들어왔습니다`);
      break;
    }
    case "peer_left": {
      if (M.isHost) {
        M.party = M.party.filter(p => p.id !== payload.id);
        if (M.judgeId === payload.id) M.judgeId = "host";
        renderParty(); Net.send("room", roomSnapshot());
        toast("참가자가 나갔습니다");
      } else {
        toast("방장과의 연결이 끊겼습니다", true);
        M.active = false;
      }
      break;
    }
    case "join": {
      if (!M.isHost) return;
      const p = M.party.find(x => x.id === fromId);
      if (p) p.nick = payload.nick || p.nick;
      renderParty(); Net.send("room", roomSnapshot());
      break;
    }
    case "offer_key": {
      if (!M.isHost) return;
      const p = M.party.find(x => x.id === fromId);
      if (p) p.offersKey = !!payload.offers;
      renderParty(); Net.send("room", roomSnapshot());
      break;
    }
    case "chars": {
      if (!M.isHost) return;
      const p = M.party.find(x => x.id === fromId);
      if (p) p.chars = (payload.chars || []).slice(0, M.slotCount);
      renderParty(); Net.send("room", roomSnapshot());
      if (W.multi && $("#screen-setup").classList.contains("active")) buildForceCards();
      break;
    }
    case "room": {
      if (M.isHost) return;
      M.party = payload.party || [];
      M.judgeId = payload.judgeId;
      M.slotCount = payload.slotCount || 1;
      M.scaleName = payload.scaleName || "";
      renderParty(); renderGuestSlots();
      break;
    }
    case "battle_start": {
      M.judgeId = payload.judgeId;
      beginBattle(payload.battle, true);
      break;
    }
    case "cmd": {          // 방장 → 심판: 라운드 진행 지시
      if (!amJudge()) return;
      if (payload.action === "opening") runTurn("opening", 0);
      else if (payload.action === "epilogue") { B.epilogueDone = true; runTurn("epilogue", B.round); }
      else runTurn("round", payload.n, payload.injection);
      break;
    }
    case "turn_begin": {
      if (amJudge()) return;
      startRemoteTurn(payload.action, payload.round);
      break;
    }
    case "chunk": {
      if (amJudge()) return;
      appendRemoteText(payload.t);
      break;
    }
    case "turn_end": {
      if (amJudge()) return;
      endRemoteTurn(payload);
      break;
    }
    case "inject": {       // 누구나 → 방장
      if (!M.isHost) return;
      M.pendingInject = payload.text;
      toast(`개입 제안: ${payload.text.slice(0, 30)}…`);
      break;
    }
    case "quit": {
      if (!M.isHost) toast("방장이 전투를 종료했습니다");
      break;
    }
  }
}

/* ══════════════════════════════ 위저드 ══════════════════════════════ */

const STEP_NAMES = ["형식", "진영", "전장", "변수", "연출"];

function buildStaticPickers() {
  $("#scale-grid").innerHTML = D.scales.map((s, i) => `
    <div class="card pick" data-i="${i}"><h4>${esc(s.name)}</h4><p>${esc(s.desc)}</p></div>`).join("");
  $("#scale-grid").onclick = e => {
    const c = e.target.closest(".pick"); if (!c) return;
    $$("#scale-grid .pick").forEach(x => x.classList.remove("on"));
    c.classList.add("on");
    W.scale = D.scales[+c.dataset.i];
    W.nSides = W.scale.sides;
    $("#royale-count-field").classList.toggle("hidden", W.scale.key !== "royale");
    if (W.multi) {
      M.slotCount = W.scale.chars_per_side[1];
      M.scaleName = W.scale.name;
      Net.send("room", roomSnapshot());
    }
    syncSummary();
  };

  $("#env-grid").innerHTML = D.environments.map((e, i) => `
    <div class="card pick" data-i="${i}"><h4>${esc(e.name)}</h4><p>${esc(e.desc)}</p></div>`).join("");
  $("#env-grid").onclick = e => {
    const c = e.target.closest(".pick"); if (!c) return;
    $$("#env-grid .pick").forEach(x => x.classList.remove("on"));
    c.classList.add("on");
    W.env = D.environments[+c.dataset.i];
    $("#env-custom-name").value = ""; $("#env-custom-desc").value = "";
    syncSummary();
  };
  $("#env-custom-name").oninput = () => {
    const n = $("#env-custom-name").value.trim();
    if (n) {
      $$("#env-grid .pick").forEach(x => x.classList.remove("on"));
      W.env = { name: n, desc: $("#env-custom-desc").value.trim() };
    } else W.env = null;
    syncSummary();
  };
  $("#env-custom-desc").oninput = () => {
    if (W.env && $("#env-custom-name").value.trim()) W.env.desc = $("#env-custom-desc").value.trim();
  };

  renderMods();
  $("#mod-add").onclick = () => {
    const n = $("#mod-custom-name").value.trim();
    if (!n) return;
    const m = { name: n, desc: $("#mod-custom-desc").value.trim() };
    D.modifiers.push(m); W.mods.push(m);
    $("#mod-custom-name").value = ""; $("#mod-custom-desc").value = "";
    renderMods(); syncSummary();
  };

  $("#tone-grid").innerHTML = D.tones.map((t, i) => `
    <div class="card pick" data-i="${i}"><h4>${esc(t.name)}</h4><p>${esc(t.desc)}</p></div>`).join("");
  $("#tone-grid").onclick = e => {
    const c = e.target.closest(".pick"); if (!c) return;
    $$("#tone-grid .pick").forEach(x => x.classList.remove("on"));
    c.classList.add("on");
    W.tone = D.tones[+c.dataset.i]; syncSummary();
  };

  const seg = (el, items, key) => {
    el.innerHTML = items.map(x => `<button data-v="${esc(x.name)}" title="${esc(x.desc)}">${esc(x.name)}</button>`).join("");
    el.onclick = e => {
      const b = e.target.closest("button"); if (!b) return;
      $$("button", el).forEach(x => x.classList.remove("on"));
      b.classList.add("on"); W[key] = b.dataset.v; syncSummary();
    };
    $$("button", el)[items.findIndex(x => x.name === W[key])]?.classList.add("on");
  };
  seg($("#intensity-seg"), D.intensities, "intensity");
  seg($("#detail-seg"), D.details, "detail");

  $("#victory-select").innerHTML = D.victory_conditions.map(v => `<option>${esc(v)}</option>`).join("");
  $("#victory-select").onchange = e => { W.victory = e.target.value; syncSummary(); };
  $("#max-rounds").oninput = e => {
    W.maxRounds = +e.target.value; $("#rounds-out").textContent = e.target.value; syncSummary();
  };
  $("#extra-rules").oninput = e => { W.extra = e.target.value; };
  $("#interactive").onchange = e => { W.interactive = e.target.checked; };
  $("#royale-count").oninput = e => {
    W.nSides = Math.max(3, Math.min(6, +e.target.value || 3));
  };

  $("#step-rail").innerHTML = STEP_NAMES
    .map((n, i) => `<div class="step-tab" data-s="${i}">${i + 1}. ${n}</div>`).join("");
}

function renderMods() {
  $("#mod-grid").innerHTML = D.modifiers.map((m, i) => `
    <div class="card pick ${W.mods.some(x => x.name === m.name) ? "on" : ""}" data-i="${i}">
      <h4>${esc(m.name)}</h4><p>${esc(m.desc)}</p></div>`).join("");
  $("#mod-grid").onclick = e => {
    const c = e.target.closest(".pick"); if (!c) return;
    const m = D.modifiers[+c.dataset.i];
    const at = W.mods.findIndex(x => x.name === m.name);
    if (at >= 0) { W.mods.splice(at, 1); c.classList.remove("on"); }
    else { W.mods.push({ name: m.name, desc: m.desc }); c.classList.add("on"); }
    syncSummary();
  };
}

function startWizard(multi) {
  loadRoster();
  W.multi = !!multi;
  W.step = 0; W.forces = [];
  gotoStep(0);
}

function gotoStep(n) {
  if (n === 1) buildForceCards();
  W.step = n;
  $$(".step-page").forEach(p => p.classList.toggle("on", +p.dataset.step === n));
  $$("#step-rail .step-tab").forEach((t, i) => {
    t.classList.toggle("on", i === n);
    t.classList.toggle("done", i < n);
  });
  $("#step-count").textContent = `${n + 1} / ${STEP_NAMES.length}`;
  $("#step-prev").disabled = n === 0;
  $("#step-next").textContent = n === STEP_NAMES.length - 1 ? "전투 개시" : "다음";
  $(".scroll", $("#screen-setup")).scrollTop = 0;
  syncSummary();
}

function syncSummary() {
  const bits = [];
  if (W.scale) bits.push(W.scale.name);
  const filled = W.forces.filter(f => f.chars.length).length;
  if (filled) bits.push(`진영 ${filled}`);
  if (W.env) bits.push(W.env.name);
  if (W.mods.length) bits.push(`변수 ${W.mods.length}`);
  if (W.tone) bits.push(W.tone.name);
  bits.push(`${W.maxRounds}R`);
  $("#setup-summary").textContent = bits.join("  ·  ");
}

/* ── 진영 편성 ─────────────────────────────────────────────────────── */

function guestForIndex(i) {
  // 멀티: 진영 A = 방장, B 부터는 참가한 순서대로
  if (!W.multi || i === 0) return null;
  const guests = M.party.filter(p => p.id !== "host");
  return guests[i - 1] || null;
}

function buildForceCards() {
  const sc = W.scale;
  const [lo, hi] = sc.chars_per_side;
  $("#force-hint").textContent = `진영당 ${lo === hi ? lo : `${lo}~${hi}`}명`
    + (W.multi ? " · 참가자 진영은 각자 제출한 캐릭터가 들어옵니다" : "");

  while (W.forces.length < W.nSides) W.forces.push({ banner: "", role: "", objective: "", chars: [], troops: null });
  W.forces.length = W.nSides;

  const wrap = $("#forces-setup"); wrap.innerHTML = "";
  W.forces.forEach((f, i) => {
    if (sc.asymmetric) f.role = i === 0 ? "공격군" : "수비군";
    if (sc.troops && !f.troops)
      f.troops = { size: "3000", composition: "", quality: "숙련병", morale: "보통", supply: "충분", formation: "" };
    if (!sc.troops) f.troops = null;

    const guest = guestForIndex(i);
    if (guest) {
      f.chars = (guest.chars || []).slice(0, hi);
      if (!f.banner) f.banner = guest.nick;
    }

    const card = document.createElement("div");
    card.className = "force-card side";
    card.style.setProperty("--sidecolor", SIDE_COLORS[i]);
    card.innerHTML = `
      <div class="force-head">
        <span class="force-key">${KEYS[i]}</span>
        <input placeholder="진영 이름" value="${esc(f.banner)}" data-banner>
        ${f.role ? `<span class="tag">${esc(f.role)}</span>` : ""}
        ${guest ? `<span class="badge">${esc(guest.nick)}</span>` : ""}
      </div>
      <div class="f"><label>승리 목표 <span class="hint">선택</span></label>
        <input placeholder="${i === 0 && sc.asymmetric ? "성문을 돌파하고 본성을 점령한다"
                            : sc.asymmetric ? "원군이 올 때까지 버틴다" : "상대를 전투 불능으로 만든다"}"
               value="${esc(f.objective)}" data-obj></div>
      <div class="slot-list" data-slots></div>
      ${guest ? `<p class="dim sm">${f.chars.length ? "제출 완료" : "제출을 기다리는 중…"}</p>`
              : `<button class="btn subtle sm" data-pick>＋ 캐릭터 배치 (${f.chars.length}/${hi})</button>`}
      ${sc.troops ? `
      <div class="troops-box">
        <div class="f2">
          <div class="f"><label>병력 규모</label><input value="${esc(f.troops.size)}" data-t="size"></div>
          <div class="f"><label>숙련도</label><input value="${esc(f.troops.quality)}" data-t="quality"></div>
        </div>
        <div class="f"><label>편성</label>
          <input placeholder="중장보병 1800, 궁병 900, 기병 300" value="${esc(f.troops.composition)}" data-t="composition"></div>
        <div class="f2">
          <div class="f"><label>사기</label><input value="${esc(f.troops.morale)}" data-t="morale"></div>
          <div class="f"><label>보급</label><input value="${esc(f.troops.supply)}" data-t="supply"></div>
        </div>
        <div class="f"><label>전술 방침</label>
          <input placeholder="좌익에 기병을 몰아 측면을 친다" value="${esc(f.troops.formation)}" data-t="formation"></div>
      </div>` : ""}`;

    card.querySelector("[data-banner]").oninput = e => { f.banner = e.target.value; syncSummary(); };
    card.querySelector("[data-obj]").oninput = e => { f.objective = e.target.value; };
    $$("[data-t]", card).forEach(inp => { inp.oninput = e => { f.troops[e.target.dataset.t] = e.target.value; }; });
    card.querySelector("[data-pick]")?.addEventListener("click", () => openPicker(i));

    const slots = card.querySelector("[data-slots]");
    if (!f.chars.length) slots.innerHTML = `<div class="slot empty-slot">비어 있음</div>`;
    else f.chars.forEach((c, ci) => {
      const s = document.createElement("div");
      s.className = "slot";
      s.innerHTML = `<span class="grow">${esc(c.name)}${c.title ? ` <span class="dim">《${esc(c.title)}》</span>` : ""}</span>
                     <span class="tier">${esc(c.power_tier || "-")}</span>
                     ${guest ? "" : `<button class="x">✕</button>`}`;
      s.querySelector(".x")?.addEventListener("click", () => {
        f.chars.splice(ci, 1); buildForceCards(); syncSummary();
      });
      slots.appendChild(s);
    });
    wrap.appendChild(card);
  });
}

function openPicker(target) {
  pickTarget = target;
  const isGuest = target === "guest";
  const hi = isGuest ? M.slotCount : W.scale.chars_per_side[1];
  const bucket = () => isGuest ? M.myChars : W.forces[target].chars;
  const label = isGuest ? "내 캐릭터" : (W.forces[target].banner || "진영 " + KEYS[target]);

  const refresh = () => {
    $("#pick-title").textContent = `${label} — 캐릭터 선택 (${bucket().length}/${hi})`;
    $("#pick-grid").innerHTML = roster.map((c, ci) => `
      <div class="card pick ${bucket().some(x => x.name === c.name) ? "on" : ""}" data-i="${ci}">
        <h4>${esc(c.name)} <span class="tier">${esc(c.power_tier || "-")}</span></h4>
        <p>${esc(c.concept || "")}</p></div>`).join("");
  };
  $("#pick-empty").classList.toggle("hidden", roster.length > 0);
  refresh();

  $("#pick-grid").onclick = e => {
    const card = e.target.closest(".pick"); if (!card) return;
    const c = roster[+card.dataset.i];
    const arr = bucket();
    const at = arr.findIndex(x => x.name === c.name);
    if (at >= 0) arr.splice(at, 1);
    else if (arr.length >= hi) { toast(`최대 ${hi}명입니다`, true); return; }
    else { const cp = { ...c }; delete cp.id; arr.push(cp); }
    refresh();
    if (isGuest) renderGuestSlots(); else buildForceCards();
  };
  modal("modal-pick", true);
}

/* ── 스텝 이동 ─────────────────────────────────────────────────────── */

$("#setup-back").onclick = () => route(W.multi ? "lobby" : "title");
$("#step-prev").onclick = () => gotoStep(Math.max(0, W.step - 1));
$("#step-next").onclick = () => {
  const s = W.step;
  if (s === 0 && !W.scale) return toast("전투 형식을 골라 주세요", true);
  if (s === 1) {
    const [lo] = W.scale.chars_per_side;
    for (let i = 0; i < W.forces.length; i++) {
      if (W.forces[i].chars.length < lo) {
        const g = guestForIndex(i);
        return toast(g ? `${g.nick} 님의 캐릭터 제출을 기다리는 중입니다`
                       : `진영 ${KEYS[i]}에 캐릭터를 ${lo}명 이상 배치해 주세요`, true);
      }
    }
  }
  if (s === 2 && !W.env) return toast("전장을 골라 주세요", true);
  if (s === 4 && !W.tone) return toast("서술 톤을 골라 주세요", true);
  if (s === STEP_NAMES.length - 1) return finishWizard();
  gotoStep(s + 1);
};
$("#step-rail").onclick = e => {
  const t = e.target.closest(".step-tab");
  if (t && +t.dataset.s < W.step) gotoStep(+t.dataset.s);
};

function wizardToBattle() {
  const tone = W.tone || D.tones[0];
  return {
    config: {
      scale: W.scale.key,
      environment_name: W.env.name, environment_desc: W.env.desc,
      modifiers: W.mods, tone: tone.name, tone_desc: tone.desc,
      intensity: W.intensity, detail: W.detail, victory_condition: W.victory,
      max_rounds: W.maxRounds, extra_rules: W.extra, interactive: W.interactive,
    },
    forces: W.forces.map((f, i) => ({
      key: KEYS[i], banner: f.banner || `진영 ${KEYS[i]}`,
      role: f.role, objective: f.objective,
      characters: f.chars, troops: f.troops,
    })),
  };
}

function finishWizard() {
  const data = wizardToBattle();
  if (W.multi) { launchMulti(data); return; }
  $("#preset-name").value = data.forces.map(f => f.banner).join(" vs ");
  modal("modal-savepreset", true);
  $("#btn-savepreset-go").onclick = () => {
    S.saveBattle($("#preset-name").value.trim() || "battle", data);
    modal("modal-savepreset", false); toast("전투 설정을 저장했습니다"); beginBattle(data);
  };
  $("#btn-savepreset-skip").onclick = () => { modal("modal-savepreset", false); beginBattle(data); };
}

function launchMulti(data) {
  Net.send("battle_start", { battle: data, judgeId: M.judgeId });
  beginBattle(data, true);
}

/* ══════════════════════════════ 전투 ══════════════════════════════ */

function beginBattle(battle, multi) {
  M.active = !!multi;
  B.battle = battle;
  B.config = battle.config;
  B.forces = battle.forces.map(f => ({
    key: f.key, name: PR.forceName(f), role: f.role,
    members: (f.characters || []).map(c => c.name + (c.title ? `(${c.title})` : "")),
  }));
  B.round = 0; B.finished = false; B.auto = false;
  B.prevIntegrity = {}; B.resultShown = false; B.epilogueDone = false;
  B.forces.forEach(f => (B.prevIntegrity[f.key] = 100));

  B.runner = amJudge()
    ? new E.BattleRunner(battle, makeBackend(battle.forces.map(f => f.key), battle.config.max_rounds))
    : null;

  $("#log").innerHTML = "";
  $("#hud-env").textContent = B.config.environment_name;
  $("#hud-round").textContent = "0";
  $("#hud-max").textContent = B.config.max_rounds;
  $("#btn-intervene").classList.toggle("hidden", !B.config.interactive);
  $("#btn-auto").textContent = "자동 진행";
  $("#controls").classList.toggle("viewer", M.active && !amController());

  const roleBadge = $("#hud-role");
  if (M.active) {
    roleBadge.classList.remove("hidden");
    if (amJudge()) { roleBadge.textContent = "심판"; roleBadge.className = "badge judge"; }
    else { roleBadge.textContent = "관전"; roleBadge.className = "badge viewer"; }
  } else roleBadge.classList.add("hidden");

  buildForceBars();
  buildDetailPanel();
  show("battle");
  updateControls();

  if (amController()) command("opening", 0);
}

function buildForceBars() {
  const wrap = $("#force-bars");
  const duo = B.forces.length === 2;
  wrap.className = "forces" + (duo ? " duo" : "");
  wrap.innerHTML = "";
  B.forces.forEach((f, i) => {
    const d = document.createElement("div");
    d.className = "fbar" + (duo && i === 1 ? " right" : "");
    d.id = "fbar-" + f.key;
    d.style.setProperty("--sidecolor", SIDE_COLORS[i]);
    d.innerHTML = `
      <div class="fbar-top">
        <span class="fbar-name">${esc(f.name)}</span>
        <span class="fbar-num">100</span>
        <span class="fbar-members">${esc(f.members.join(", "))}</span>
      </div>
      <div class="track"><div class="ghostfill"></div><div class="fill"></div></div>
      <div class="morale"><span>사기</span><div class="morale-track">
        <div class="morale-fill" style="width:100%"></div></div></div>
      <div class="status-chips"></div>`;
    wrap.appendChild(d);
    if (duo && i === 0) {
      const vs = document.createElement("div");
      vs.className = "vs-mark"; vs.textContent = "VS";
      wrap.appendChild(vs);
    }
  });
}

function buildDetailPanel() {
  const c = B.config;
  const scale = (D.scales.find(s => s.key === c.scale) || {}).name || c.scale;
  $("#detail-body").innerHTML = `
    <div class="f"><label>형식</label><div>${esc(scale)}</div></div>
    <div class="f"><label>전장</label><div><b>${esc(c.environment_name)}</b>
      <div class="dim sm">${esc(c.environment_desc)}</div></div></div>
    <div class="f"><label>변수 · 디버프</label>
      ${c.modifiers?.length ? c.modifiers.map(m =>
        `<div style="margin-bottom:6px"><b>${esc(m.name)}</b>
          <div class="dim sm">${esc(m.desc)}</div></div>`).join("") : `<div class="dim">없음</div>`}</div>
    <div class="f2">
      <div class="f"><label>톤</label><div>${esc(c.tone)}</div></div>
      <div class="f"><label>승리 조건</label><div>${esc(c.victory_condition)}</div></div>
    </div>
    ${c.extra_rules ? `<div class="f"><label>추가 규칙</label><div>${esc(c.extra_rules)}</div></div>` : ""}
    <div class="f"><label>참전</label>
      ${B.forces.map(f => `<div style="margin-bottom:4px"><b>${esc(f.name)}</b>
        <span class="dim sm"> — ${esc(f.members.join(", "))}</span></div>`).join("")}</div>`;
}

/* ── 턴 실행 ───────────────────────────────────────────────────────── */

/** 방장이 내리는 진행 지시. 심판이 나면 바로 돌리고, 아니면 심판에게 보낸다. */
function command(action, n, injection) {
  if (M.active) {
    const inj = injection || M.pendingInject || undefined;
    M.pendingInject = null;
    if (amJudge()) runTurn(action, n, inj);
    else Net.broadcast("cmd", { action, n, injection: inj });
  } else {
    runTurn(action, n, injection);
  }
}

function newTurnNode() {
  B.raw = "";
  B.node = document.createElement("div");
  B.node.className = "turn";
  $("#log").appendChild(B.node);
}

let renderPending = false;
function renderTurn(final) {
  renderPending = false;
  const lw = $("#log-wrap");
  const atBottom = lw.scrollHeight - lw.scrollTop - lw.clientHeight < 160;
  B.node.innerHTML = final ? md(B.raw) : withCaret(md(B.raw));
  if (atBottom) lw.scrollTop = lw.scrollHeight;
}
function scheduleRender() {
  if (!renderPending) { renderPending = true; requestAnimationFrame(() => renderTurn(false)); }
}

async function runTurn(action, n, injection) {
  if (B.busy || !B.runner) return;
  B.busy = true;
  $("#controls").classList.add("busy");
  newTurnNode();
  if (M.active) Net.broadcast("turn_begin", { action, round: n });

  // 중계용 조각 버퍼 (매 글자 보내면 낭비라 100ms 로 묶는다)
  let outBuf = "";
  const flush = () => { if (outBuf) { Net.broadcast("chunk", { t: outBuf }); outBuf = ""; } };
  const timer = M.active ? setInterval(flush, 100) : null;

  let lastState = null;
  try {
    const gen = action === "opening" ? B.runner.opening()
      : action === "epilogue" ? B.runner.epilogue()
      : B.runner.round(n, injection);

    for await (const ev of gen) {
      if (ev.type === "text") {
        B.raw += ev.t;
        if (M.active) outBuf += ev.t;
        scheduleRender();
      } else {
        lastState = ev.state;
      }
    }
  } catch (e) {
    B.raw += `\n\n> **오류** — ${e.message}`;
    toast(e.message, true);
  } finally {
    if (timer) { clearInterval(timer); flush(); }
  }

  renderTurn(true);
  if (lastState) { applyState(lastState); appendVerdict(lastState); }

  const finishedNow = B.runner.finished;
  const payload = {
    action, round: action === "round" ? n : B.round,
    state: lastState, finished: finishedNow,
    winner: B.runner.winner, reason: B.runner.victoryReason,
  };
  if (M.active) Net.broadcast("turn_end", payload);

  concludeTurn(payload);
}

function concludeTurn(p) {
  B.busy = false;
  $("#controls").classList.remove("busy");
  B.finished = p.finished;
  if (p.action === "round") B.round = p.round;
  $("#hud-round").textContent = String(B.round);
  updateControls();

  if (p.finished && p.action !== "epilogue" && !B.resultShown) {
    B.resultShown = true;
    showResult(p.winner, p.reason);
  }
  if (B.auto && amController() && !B.finished && B.round < B.config.max_rounds && p.action !== "epilogue") {
    setTimeout(() => nextRound(), 700);
  }
}

/* ── 관전자 쪽 수신 ────────────────────────────────────────────────── */

function startRemoteTurn(action, round) {
  B.busy = true;
  $("#controls").classList.add("busy");
  newTurnNode();
}
function appendRemoteText(t) { B.raw += t; scheduleRender(); }
function endRemoteTurn(p) {
  renderTurn(true);
  if (p.state) { applyState(p.state); appendVerdict(p.state); }
  concludeTurn(p);
}

/* ── 진행 ──────────────────────────────────────────────────────────── */

function nextRound(injection) {
  if (B.finished || B.busy) return;
  const n = B.round + 1;
  if (n > B.config.max_rounds) return toast("최대 라운드에 도달했습니다");
  command("round", n, injection);
}

function updateControls() {
  const done = B.finished || B.round >= B.config.max_rounds;
  if (done && B.auto) { B.auto = false; $("#btn-auto").textContent = "자동 진행"; }
  $("#btn-next").disabled = done;
  $("#btn-auto").disabled = done;
  $("#btn-intervene").disabled = done;
  $("#btn-next").textContent = B.round === 0 ? "전투 개시" : "다음 라운드";
}

/* ── 전황 반영 ─────────────────────────────────────────────────────── */

function applyState(state) {
  (state.sides || []).forEach(s => {
    const el = $("#fbar-" + s.key);
    if (!el) return;
    const v = Math.max(0, Math.min(100, Number(s.integrity ?? 100)));
    const prev = B.prevIntegrity[s.key] ?? 100;
    $(".ghostfill", el).style.width = prev + "%";
    requestAnimationFrame(() => { $(".ghostfill", el).style.width = v + "%"; });
    $(".fill", el).style.width = v + "%";
    $(".fbar-num", el).textContent = String(v);
    el.classList.toggle("low", v <= 30);
    B.prevIntegrity[s.key] = v;
    const m = Math.max(0, Math.min(100, Number(s.morale ?? 100)));
    $(".morale-fill", el).style.width = m + "%";
    $(".status-chips", el).innerHTML = (s.status || [])
      .slice(0, 4).map(x => `<span class="chip">${esc(x)}</span>`).join("");
  });
  if (typeof state.round === "number" && state.round > 0) {
    B.round = state.round;
    $("#hud-round").textContent = String(state.round);
  }
}

function appendVerdict(state) {
  const names = {};
  B.forces.forEach(f => (names[f.key] = f.name));
  const rows = [];
  if (state.turning_point) rows.push(["분기점", esc(state.turning_point), ""]);
  if (state.momentum && names[state.momentum]) rows.push(["주도권", esc(names[state.momentum]), "mom"]);
  if (state.judge_note) rows.push(["심판 노트", esc(state.judge_note), ""]);
  if (!rows.length) return;
  const d = document.createElement("div");
  d.className = "verdict";
  d.innerHTML = rows.map(([l, t, c]) =>
    `<div class="vrow"><span class="vlabel">${l}</span><span class="vtext ${c}">${t}</span></div>`).join("");
  $("#log").appendChild(d);
  const lw = $("#log-wrap"); lw.scrollTop = lw.scrollHeight;
}

/* ── 결과 ──────────────────────────────────────────────────────────── */

function showResult(winner, reason) {
  const h = $("#result-winner");
  if (!winner || winner === "draw") { h.textContent = "무승부"; h.className = "draw"; }
  else {
    const f = B.forces.find(x => x.key === winner);
    h.textContent = (f ? f.name : winner) + " 승리";
    h.className = "win";
  }
  $("#result-tag").textContent = "결착";
  $("#result-reason").textContent = reason || "";
  $("#btn-epilogue").classList.toggle("hidden", !amController());
  setTimeout(() => modal("modal-result", true), 900);
}

$("#btn-epilogue").onclick = () => {
  modal("modal-result", false);
  if (B.epilogueDone) return;
  B.epilogueDone = true;
  command("epilogue", B.round);
};
$("#btn-result-close").onclick = () => modal("modal-result", false);

/* ── 컨트롤 ────────────────────────────────────────────────────────── */

$("#btn-next").onclick = () => {
  if (B.round === 0 && !B.runner && !M.active) return;
  nextRound();
};
$("#btn-intervene").onclick = () => { $("#inject-text").value = ""; modal("modal-inject", true); };
$("#btn-inject-go").onclick = () => {
  const t = $("#inject-text").value.trim();
  modal("modal-inject", false);
  if (!t) return;
  if (amController()) nextRound(t);
  else { Net.send("inject", { text: t }); toast("방장에게 개입을 제안했습니다"); }
};
$("#btn-auto").onclick = () => {
  B.auto = !B.auto;
  $("#btn-auto").textContent = B.auto ? "자동 중지" : "자동 진행";
  if (B.auto && !B.busy) nextRound();
};
$("#btn-detail").onclick = () => modal("modal-detail", true);
$("#btn-save-log").onclick = () => {
  if (!B.runner) {
    // 관전자는 화면에 쌓인 것을 그대로 저장한다
    const text = "# 전투 기록\n\n" + $$("#log .turn").map(n => n.innerText).join("\n\n");
    S.downloadText("aegis-battle.md", text);
    return;
  }
  const title = B.forces.map(f => f.name).join(" vs ");
  S.downloadText(`aegis-${title}.md`, B.runner.transcript());
  toast("내려받았습니다");
};
$("#btn-quit").onclick = () => {
  if (B.busy && !confirm("진행 중입니다. 정말 나갈까요?")) return;
  B.busy = false; B.auto = false;
  if (M.active && M.isHost) Net.send("quit", {});
  show(M.active ? "lobby" : "title");
};

/* ── 단축키 ────────────────────────────────────────────────────────── */

document.addEventListener("keydown", e => {
  if (e.key === "Escape") { closeTop(); return; }
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
  if (typing || openModals.length) return;
  if (!$("#screen-battle").classList.contains("active")) return;
  if ((e.key === " " || e.key === "Enter") && amController()) { e.preventDefault(); nextRound(); }
  else if (e.key.toLowerCase() === "i" && B.config?.interactive) $("#btn-intervene").click();
  else if (e.key.toLowerCase() === "a" && amController()) $("#btn-auto").click();
});

/* ══════════════════════════════ 시작 ══════════════════════════════ */

(function init() {
  loadRoster();
  buildStaticPickers();
  refreshModeBadge();
  // 주소창에 ?room=CODE 가 있으면 참가 화면을 미리 채워 준다
  const code = new URLSearchParams(location.search).get("room");
  if (code) {
    route("lobby");
    $("#join-code").value = code.toUpperCase();
  }
})();
