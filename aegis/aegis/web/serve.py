"""docs/ 를 로컬에서 띄우는 아주 작은 정적 서버.

사이트 버전은 서버가 전혀 필요 없지만, file:// 로 열면 브라우저가 일부 기능을
막기 때문에 로컬에서도 http 로 여는 편이 낫다. 배포는 docs/ 폴더를 그대로
GitHub Pages 등에 올리면 된다.
"""
from __future__ import annotations

import http.server
import socketserver
import threading
import webbrowser
from functools import partial
from pathlib import Path

DOCS = Path(__file__).resolve().parent.parent.parent / "docs"


class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, *args):  # 조용히
        pass


def serve(host: str = "127.0.0.1", port: int = 8420, open_browser: bool = True) -> None:
    if not (DOCS / "index.html").exists():
        raise SystemExit(
            f"{DOCS} 에 사이트 파일이 없습니다. `python build_static.py` 를 먼저 돌려 주세요."
        )
    handler = partial(Handler, directory=str(DOCS))
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.ThreadingTCPServer((host, port), handler) as httpd:
        url = f"http://{host}:{port}"
        if open_browser:
            threading.Timer(0.8, lambda: webbrowser.open(url)).start()
        print(f"\n  AEGIS  →  {url}   (종료: Ctrl+C)")
        print(f"  (이 서버는 docs/ 를 그대로 내보낼 뿐입니다. API 키는 브라우저 안에만 있습니다.)\n")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n종료합니다.")
