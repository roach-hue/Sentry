"""
스케줄러 parity verifier — TS의 src/core/scheduler.ts를 Python으로 독립 재구현하고
동일 JSON 픽스처에 대해 같은 출력을 내는지 검증한다.

상태머신 verifier와 같은 패턴: 두 언어가 같은 입력에 같은 결과를 내면
로직 정확성에 대한 신뢰도가 올라간다.

실행:
  python verify/scheduler_parity.py
종료 코드: 0 = 전부 일치, 1 = 불일치 또는 에러
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any, Dict, List


# -----------------------------
# 스케줄러 로직 — TS scheduler.ts와 동일
# -----------------------------


def next_poll_delay_minutes(state: dict, cfg: dict) -> int:
    sites = state.get("sites", {})

    # 1) 빠른 폴링 우선순위
    for site_id in sites:
        s = sites[site_id]
        if s["kind"] in ("notYetOpen", "unknown"):
            return cfg["notYetOpenMinutes"]

    # 2) 모든 사이트가 scraperSuspect?
    all_broken = len(sites) > 0
    max_failures = 0
    for site_id in sites:
        s = sites[site_id]
        if s["kind"] != "scraperSuspect":
            all_broken = False
            break
        if s.get("consecutiveFailures", 0) > max_failures:
            max_failures = s["consecutiveFailures"]

    if all_broken and max_failures > 0:
        return backoff_minutes(max_failures, cfg)

    # 3) 기본
    return cfg["trackingMinutes"]


def backoff_minutes(consecutive_failures: int, cfg: dict) -> int:
    exponent = max(0, consecutive_failures - 1)
    raw = cfg["scraperSuspectBaseMinutes"] * (2**exponent)
    return min(raw, cfg["scraperSuspectMaxMinutes"])


# -----------------------------
# 픽스처 실행
# -----------------------------


def run_scenario(scenario: dict) -> tuple[bool, str]:
    actual = next_poll_delay_minutes(scenario["state"], scenario["cfg"])
    expected = scenario["expected"]
    if actual != expected:
        return False, f"expected={expected} actual={actual}"
    return True, "OK"


def main() -> int:
    fixtures_dir = Path(__file__).parent / "scheduler_fixtures"
    if not fixtures_dir.exists():
        print(f"FAIL: fixtures directory not found at {fixtures_dir}")
        return 1

    scenarios = sorted(fixtures_dir.glob("*.json"))
    if not scenarios:
        print(f"FAIL: no scenario JSON files under {fixtures_dir}")
        return 1

    all_ok = True
    for path in scenarios:
        with open(path, "r", encoding="utf-8") as f:
            scenario = json.load(f)
        ok, msg = run_scenario(scenario)
        status = "PASS" if ok else "FAIL"
        print(f"[{status}] {path.name}")
        if not ok:
            print(f"  {msg}")
            all_ok = False

    print()
    if all_ok:
        print(f"All {len(scenarios)} scheduler scenarios passed.")
        return 0
    print("One or more scheduler scenarios FAILED.")
    return 1


if __name__ == "__main__":
    sys.exit(main())
