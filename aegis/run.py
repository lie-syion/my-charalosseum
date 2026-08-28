#!/usr/bin/env python3
"""AEGIS 실행 진입점.

    python run.py                 # docs/ 사이트를 로컬에서 열기 (기본)
    python run.py --port 9000     # 포트 지정
    python run.py --no-browser    # 브라우저 자동 실행 없이 서버만
    python run.py --cli           # 터미널 버전 (.env 의 ANTHROPIC_API_KEY 사용)
    python run.py --cli --demo    # 터미널에서 샘플 즉석 전투
    python run.py --cli --mock    # 터미널에서 키 없이 흐름만 확인

사이트 버전은 서버가 필요 없습니다. docs/ 폴더를 그대로 GitHub Pages 등에
올리면 그게 곧 배포입니다. (README 의 '사이트로 올리기' 참고)
"""
import os
import sys


def main() -> int:
    argv = sys.argv[1:]
    if "--mock" in argv:
        os.environ["AEGIS_MOCK"] = "1"

    if "--cli" in argv:
        from aegis.cli import main as cli_main
        return cli_main([a for a in argv if a != "--cli"])

    port = 8420
    if "--port" in argv:
        try:
            port = int(argv[argv.index("--port") + 1])
        except (IndexError, ValueError):
            print("--port 뒤에 포트 번호를 적어 주세요.")
            return 2

    from aegis.web.serve import serve
    serve(port=port, open_browser="--no-browser" not in argv)
    return 0


if __name__ == "__main__":
    sys.exit(main())
