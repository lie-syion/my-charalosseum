/* 브라우저 저장소 — 캐릭터 로스터, 전투 프리셋, 설정.
   API 키를 포함해 전부 이 브라우저의 localStorage 에만 남는다. 어디로도 전송되지 않는다. */
(function () {
"use strict";

  const NS = "aegis:";
  const K_CHARS = NS + "characters";
  const K_BATTLES = NS + "battles";
  const K_SETTINGS = NS + "settings";
  const K_SEEDED = NS + "seeded";

  function read(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) { return fallback; }
  }

  function write(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; }
    catch (e) { return false; }   // 사생활 보호 모드 등에서 실패할 수 있다
  }

  /* ── 설정 ────────────────────────────────────────────────────────────── */

  const DEFAULT_SETTINGS = {
    apiKey: "",
    model: window.AEGIS_ENGINE.DEFAULT_MODEL,
    maxTokens: 4000,
    nickname: "",
  };

  function getSettings() { return { ...DEFAULT_SETTINGS, ...read(K_SETTINGS, {}) }; }
  function saveSettings(patch) {
    const next = { ...getSettings(), ...patch };
    write(K_SETTINGS, next);
    return next;
  }
  function hasKey() { return !!getSettings().apiKey.trim(); }

  /* ── 캐릭터 ──────────────────────────────────────────────────────────── */

  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

  function listCharacters() {
    seedOnce();
    return read(K_CHARS, []);
  }

  function saveCharacter(data, id) {
    const list = read(K_CHARS, []);
    const rec = { ...data, id: id || data.id || uid() };
    const at = list.findIndex(c => c.id === rec.id);
    if (at >= 0) list[at] = rec; else list.push(rec);
    write(K_CHARS, list);
    return rec;
  }

  function deleteCharacter(id) {
    write(K_CHARS, read(K_CHARS, []).filter(c => c.id !== id));
  }

  /** 첫 방문에 샘플 캐릭터를 한 번만 넣어 준다. */
  function seedOnce() {
    if (localStorage.getItem(K_SEEDED)) return;
    const existing = read(K_CHARS, []);
    if (!existing.length) {
      write(K_CHARS, (window.AEGIS_DATA.sample_characters || []).map(c => ({ ...c, id: uid() })));
    }
    try { localStorage.setItem(K_SEEDED, "1"); } catch (e) {}
  }

  function resetSamples() {
    const list = read(K_CHARS, []);
    const names = new Set(list.map(c => c.name));
    (window.AEGIS_DATA.sample_characters || []).forEach(c => {
      if (!names.has(c.name)) list.push({ ...c, id: uid() });
    });
    write(K_CHARS, list);
    return list;
  }

  /* ── 전투 프리셋 ─────────────────────────────────────────────────────── */

  function listBattles() { return read(K_BATTLES, []); }

  function saveBattle(name, data) {
    const list = read(K_BATTLES, []);
    list.unshift({ id: uid(), name, data, at: Date.now() });
    write(K_BATTLES, list.slice(0, 40));
  }

  function deleteBattle(id) {
    write(K_BATTLES, read(K_BATTLES, []).filter(b => b.id !== id));
  }

  /* ── 전투 기록 내려받기 ──────────────────────────────────────────────── */

  function downloadText(filename, text) {
    const blob = new Blob([text], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  window.AEGIS_STORE = {
    getSettings, saveSettings, hasKey,
    listCharacters, saveCharacter, deleteCharacter, resetSamples,
    listBattles, saveBattle, deleteBattle,
    downloadText, uid,
  };

})();
