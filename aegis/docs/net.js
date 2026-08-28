/* 멀티플레이 — PeerJS(WebRTC) 로 브라우저끼리 직접 연결한다.
   서버가 없으므로 방장(호스트)이 중계 지점이 된다: 게스트는 호스트하고만 연결하고,
   호스트가 나머지에게 퍼뜨린다. 전투 판정을 실제로 돌리는 쪽을 '심판'이라고 부르며,
   기본값은 호스트지만 키를 가진 다른 참가자에게 넘길 수 있다. */
(function () {
"use strict";

  const PREFIX = "aegis-v1-";
  const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";   // 헷갈리는 0/O/1/I 제외
  const CDNS = [
    "https://cdn.jsdelivr.net/npm/peerjs@1.5.4/dist/peerjs.min.js",
    "https://cdnjs.cloudflare.com/ajax/libs/peerjs/1.5.4/peerjs.min.js",
  ];

  let peerLibPromise = null;

  function loadPeerLib() {
    if (window.Peer) return Promise.resolve(true);
    if (peerLibPromise) return peerLibPromise;
    peerLibPromise = new Promise(resolve => {
      let i = 0;
      const tryNext = () => {
        if (i >= CDNS.length) return resolve(false);
        const s = document.createElement("script");
        s.src = CDNS[i++];
        s.onload = () => resolve(!!window.Peer);
        s.onerror = tryNext;
        document.head.appendChild(s);
      };
      tryNext();
    });
    return peerLibPromise;
  }

  function randomCode(n = 5) {
    let s = "";
    for (let i = 0; i < n; i++) s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
    return s;
  }

  /* ── 방 ──────────────────────────────────────────────────────────────── */

  const Net = {
    peer: null,
    isHost: false,
    code: null,
    myId: null,          // 호스트는 "host", 게스트는 자기 peer id
    conns: new Map(),    // 호스트: peerId → DataConnection
    hostConn: null,      // 게스트: 호스트와의 연결
    onEvent: null,       // (type, payload, fromId) => void
    onStatus: null,      // (text, kind) => void
    connected: false,

    available() { return loadPeerLib(); },

    status(text, kind) { this.onStatus?.(text, kind || "info"); },

    /** 방 만들기. 성공하면 방 코드를 돌려준다. */
    async host({ nick, onEvent, onStatus }) {
      if (!(await loadPeerLib())) throw new Error("멀티플레이 모듈을 불러오지 못했습니다. 네트워크를 확인해 주세요.");
      this.reset();
      this.onEvent = onEvent; this.onStatus = onStatus;
      this.isHost = true; this.myId = "host"; this.nick = nick;

      // 코드 충돌 시 몇 번 다시 시도한다
      for (let attempt = 0; attempt < 5; attempt++) {
        const code = randomCode();
        try {
          await this._open(PREFIX + code);
          this.code = code;
          break;
        } catch (e) {
          if (e.type !== "unavailable-id" || attempt === 4) throw this._friendly(e);
        }
      }

      this.peer.on("connection", conn => this._acceptGuest(conn));
      this.connected = true;
      this.status(`방이 열렸습니다 — 코드 ${this.code}`, "ok");
      return this.code;
    },

    /** 방 코드로 입장. */
    async join(code, { nick, onEvent, onStatus }) {
      if (!(await loadPeerLib())) throw new Error("멀티플레이 모듈을 불러오지 못했습니다. 네트워크를 확인해 주세요.");
      this.reset();
      this.onEvent = onEvent; this.onStatus = onStatus;
      this.isHost = false; this.nick = nick;
      code = String(code || "").trim().toUpperCase();
      if (!code) throw new Error("방 코드를 입력해 주세요.");

      await this._open(null);
      this.myId = this.peer.id;
      this.code = code;

      const conn = this.peer.connect(PREFIX + code, { reliable: true, metadata: { nick } });
      this.hostConn = conn;

      await new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error("방을 찾지 못했습니다. 코드를 다시 확인해 주세요.")), 15000);
        conn.on("open", () => { clearTimeout(timer); resolve(); });
        conn.on("error", e => { clearTimeout(timer); reject(this._friendly(e)); });
        this.peer.on("error", e => {
          if (e.type === "peer-unavailable") {
            clearTimeout(timer);
            reject(new Error("그런 방이 없습니다. 방장이 창을 닫았거나 코드가 틀렸을 수 있어요."));
          }
        });
      });

      conn.on("data", d => this._onData(d, "host"));
      conn.on("close", () => {
        this.connected = false;
        this.status("방장과의 연결이 끊겼습니다.", "err");
        this.onEvent?.("peer_left", { id: "host" }, "host");
      });

      this.connected = true;
      this.send("join", { nick });
      this.status("방에 들어왔습니다.", "ok");
    },

    _open(id) {
      return new Promise((resolve, reject) => {
        this.peer = id ? new window.Peer(id, { debug: 0 }) : new window.Peer({ debug: 0 });
        const timer = setTimeout(() => reject(new Error("연결 서버 응답이 없습니다.")), 15000);
        this.peer.on("open", () => { clearTimeout(timer); resolve(); });
        this.peer.on("error", e => { clearTimeout(timer); reject(e); });
      });
    },

    _acceptGuest(conn) {
      conn.on("open", () => {
        this.conns.set(conn.peer, conn);
        this.onEvent?.("peer_joined", { id: conn.peer, nick: conn.metadata?.nick }, conn.peer);
      });
      conn.on("data", d => this._onData(d, conn.peer));
      conn.on("close", () => {
        this.conns.delete(conn.peer);
        this.onEvent?.("peer_left", { id: conn.peer }, conn.peer);
      });
      conn.on("error", () => {
        this.conns.delete(conn.peer);
        this.onEvent?.("peer_left", { id: conn.peer }, conn.peer);
      });
    },

    _onData(msg, fromId) {
      if (!msg || typeof msg !== "object") return;
      // 호스트는 중계자: 퍼뜨려야 할 메시지를 다른 참가자에게 그대로 넘긴다
      if (this.isHost && msg.relay) {
        this.conns.forEach((c, id) => { if (id !== fromId && c.open) c.send(msg); });
      }
      this.onEvent?.(msg.type, msg.payload, msg.from || fromId);
    },

    /** 호스트: 전원에게. 게스트: 호스트에게. */
    send(type, payload) {
      const msg = { type, payload, from: this.myId };
      if (this.isHost) {
        this.conns.forEach(c => { if (c.open) c.send(msg); });
      } else if (this.hostConn?.open) {
        this.hostConn.send(msg);
      }
    },

    /** 게스트가 보낸 것도 방 전체에 퍼지게 한다 (호스트가 중계). */
    broadcast(type, payload) {
      const msg = { type, payload, from: this.myId, relay: true };
      if (this.isHost) {
        this.conns.forEach(c => { if (c.open) c.send(msg); });
      } else if (this.hostConn?.open) {
        this.hostConn.send(msg);
      }
    },

    peerCount() { return this.isHost ? this.conns.size : (this.hostConn?.open ? 1 : 0); },

    reset() {
      try { this.conns.forEach(c => c.close()); } catch (e) {}
      try { this.hostConn?.close(); } catch (e) {}
      try { this.peer?.destroy(); } catch (e) {}
      this.peer = null; this.conns = new Map(); this.hostConn = null;
      this.code = null; this.myId = null; this.isHost = false; this.connected = false;
    },

    _friendly(e) {
      const map = {
        "browser-incompatible": "이 브라우저는 WebRTC를 지원하지 않습니다.",
        "network": "연결 서버에 닿지 못했습니다. 네트워크를 확인해 주세요.",
        "peer-unavailable": "그런 방이 없습니다.",
        "unavailable-id": "방 코드가 이미 쓰이고 있습니다. 다시 시도해 주세요.",
        "ssl-unavailable": "보안 연결에 실패했습니다. https 주소로 접속해 주세요.",
        "webrtc": "WebRTC 연결에 실패했습니다. 방화벽이나 VPN을 확인해 주세요.",
      };
      return new Error(map[e?.type] || e?.message || "연결에 실패했습니다.");
    },
  };

  window.AEGIS_NET = Net;

})();
