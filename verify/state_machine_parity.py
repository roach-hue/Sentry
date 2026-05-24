"""
State machine parity verifier — 독립 검증 (Python 재구현)

목적:
  TypeScript의 src/core/state-machine.ts 가 가진 결정 로직을 Python으로
  독립 재구현하고, 시나리오 JSON 픽스처에 대해 같은 입력 → 같은 출력을 내는지
  검증한다. 같은 사람이 두 언어로 같은 버그를 동시에 심을 확률은 매우 낮으므로
  parity가 맞으면 로직 정확성에 대한 신뢰도가 크게 올라간다.

실행:
  python verify/state_machine_parity.py
  종료 코드: 0 = 모든 시나리오 일치, 1 = 불일치 또는 에러

이름 규약:
  NAMING.md 에 정의된 식별자만 사용. 변형 금지.
"""

from __future__ import annotations

import json
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional


# -----------------------------
# 타입 (Listing, SiteState, NotificationEvent 등) — TS와 동일 구조
# -----------------------------

ALL_SITES = ("agoda", "trip")


@dataclass
class Listing:
    id: str
    name: str
    normalizedName: str
    pricePerNightJpy: Optional[int]
    totalPriceJpy: int
    roomsRemaining: Optional[int]
    breakfastIncluded: Optional[bool]
    freeCancellation: Optional[bool]
    url: Optional[str]


@dataclass
class FetchResult:
    site: str
    spec: Dict[str, Any]
    fetchedAt: str
    listings: List[Listing]
    error: Optional[Dict[str, Any]]


@dataclass
class SitePollResult:
    real: FetchResult
    sentinel: FetchResult


@dataclass
class PollRound:
    startedAt: str
    completedAt: str
    perSite: Dict[str, SitePollResult]


# -----------------------------
# step() — TS와 동일한 결정 로직
# -----------------------------


def step(prev: dict, round_: PollRound, alert: dict) -> dict:
    events: List[dict] = []
    next_sites = dict(prev["sites"])
    next_listings = dict(prev["lastListings"])

    for site_id in round_.perSite.keys():
        result = round_.perSite[site_id]
        prev_state = prev["sites"].get(site_id, {"kind": "unknown"})
        prev_site_listings = prev["lastListings"].get(site_id, {})

        decision = step_site(
            site_id, prev_state, prev_site_listings, result, alert, round_.completedAt
        )
        next_sites[site_id] = decision["nextState"]
        next_listings[site_id] = decision["nextListings"]
        events.extend(decision["events"])

    return {
        "next": {
            "sites": next_sites,
            "lastRound": serialize_round(round_),
            "lastListings": next_listings,
        },
        "events": events,
    }


def step_site(
    site_id: str,
    prev_state: dict,
    prev_listings: Dict[str, dict],
    result: SitePollResult,
    alert: dict,
    now: str,
) -> dict:
    real = result.real
    sentinel = result.sentinel

    # 1) fetcher 자체 에러 → scraperSuspect
    if real.error is not None:
        return to_scraper_suspect(site_id, prev_state, prev_listings, now)

    # 2) 0건 분기
    if len(real.listings) == 0:
        if sentinel.error is not None or len(sentinel.listings) == 0:
            return to_scraper_suspect(site_id, prev_state, prev_listings, now)
        if prev_state["kind"] == "notYetOpen":
            return {
                "nextState": prev_state,
                "nextListings": prev_listings,
                "events": [],
            }
        return {
            "nextState": {"kind": "notYetOpen", "since": now},
            "nextListings": prev_listings,
            "events": [],
        }

    # 3) 매물 있음
    events: List[dict] = []
    was_not_open = prev_state["kind"] in ("notYetOpen", "unknown", "scraperSuspect")

    if prev_state["kind"] == "notYetOpen":
        events.append(
            {
                "kind": "bookingOpened",
                "site": site_id,
                "detectedAt": now,
                "sampleListings": [listing_to_dict(l) for l in real.listings[:5]],
                "urgency": "critical",
            }
        )

    # 4) 낮은 재고
    if alert.get("lowInventoryAt") is not None:
        low_at = alert["lowInventoryAt"]
        for listing in real.listings:
            if listing.roomsRemaining is not None and listing.roomsRemaining <= low_at:
                prior = prev_listings.get(listing.normalizedName)
                was_above = (
                    prior is None
                    or prior.get("roomsRemaining") is None
                    or prior["roomsRemaining"] > low_at
                )
                if was_above:
                    events.append(
                        {
                            "kind": "lowInventory",
                            "site": site_id,
                            "hotelName": listing.name,
                            "roomsRemaining": listing.roomsRemaining,
                            "urgency": "high",
                        }
                    )

    next_listings = {l.normalizedName: listing_to_dict(l) for l in real.listings}

    if was_not_open:
        return {
            "nextState": {
                "kind": "justOpened",
                "detectedAt": now,
                "openingListings": [listing_to_dict(l) for l in real.listings[:10]],
            },
            "nextListings": next_listings,
            "events": events,
        }

    return {
        "nextState": {
            "kind": "tracking",
            "since": now,
            "lastSeenCount": len(real.listings),
        },
        "nextListings": next_listings,
        "events": events,
    }


def to_scraper_suspect(
    site_id: str, prev_state: dict, prev_listings: Dict[str, dict], now: str
) -> dict:
    consecutive = (
        prev_state["consecutiveFailures"] + 1 if prev_state["kind"] == "scraperSuspect" else 1
    )
    events: List[dict] = []
    if consecutive in (1, 3):
        events.append(
            {
                "kind": "scraperSuspect",
                "site": site_id,
                "consecutiveFailures": consecutive,
                "urgency": "medium",
            }
        )
    return {
        "nextState": {
            "kind": "scraperSuspect",
            "since": now,
            "consecutiveFailures": consecutive,
        },
        "nextListings": prev_listings,
        "events": events,
    }


def listing_to_dict(l: Listing) -> dict:
    return {
        "id": l.id,
        "name": l.name,
        "normalizedName": l.normalizedName,
        "pricePerNightJpy": l.pricePerNightJpy,
        "totalPriceJpy": l.totalPriceJpy,
        "roomsRemaining": l.roomsRemaining,
        "breakfastIncluded": l.breakfastIncluded,
        "freeCancellation": l.freeCancellation,
        "url": l.url,
    }


def serialize_round(r: PollRound) -> dict:
    return {
        "startedAt": r.startedAt,
        "completedAt": r.completedAt,
        "perSite": {
            site_id: {
                "real": fetch_result_to_dict(spr.real),
                "sentinel": fetch_result_to_dict(spr.sentinel),
            }
            for site_id, spr in r.perSite.items()
        },
    }


def fetch_result_to_dict(fr: FetchResult) -> dict:
    return {
        "site": fr.site,
        "spec": fr.spec,
        "fetchedAt": fr.fetchedAt,
        "listings": [listing_to_dict(l) for l in fr.listings],
        "error": fr.error,
    }


# -----------------------------
# 시나리오 픽스처 로더
# -----------------------------


def load_listing(d: dict) -> Listing:
    return Listing(
        id=d["id"],
        name=d["name"],
        normalizedName=d["normalizedName"],
        pricePerNightJpy=d.get("pricePerNightJpy"),
        totalPriceJpy=d["totalPriceJpy"],
        roomsRemaining=d.get("roomsRemaining"),
        breakfastIncluded=d.get("breakfastIncluded"),
        freeCancellation=d.get("freeCancellation"),
        url=d.get("url"),
    )


def load_fetch_result(d: dict) -> FetchResult:
    return FetchResult(
        site=d["site"],
        spec=d.get("spec", {}),
        fetchedAt=d.get("fetchedAt", ""),
        listings=[load_listing(x) for x in d.get("listings", [])],
        error=d.get("error"),
    )


def load_round(d: dict) -> PollRound:
    return PollRound(
        startedAt=d["startedAt"],
        completedAt=d["completedAt"],
        perSite={
            site_id: SitePollResult(
                real=load_fetch_result(per["real"]),
                sentinel=load_fetch_result(per["sentinel"]),
            )
            for site_id, per in d["perSite"].items()
        },
    )


# -----------------------------
# 검증 실행 (시나리오 → 기대 출력 비교)
# -----------------------------


def run_scenario(scenario: dict) -> tuple[bool, str]:
    """returns (ok, message)"""
    prev_state = scenario["initialState"]
    alert = scenario["alert"]
    rounds_in = scenario["rounds"]
    expected = scenario["expected"]

    state = prev_state
    all_events: List[dict] = []
    for round_dict in rounds_in:
        round_ = load_round(round_dict)
        result = step(state, round_, alert)
        state = result["next"]
        all_events.extend(result["events"])

    # expected가 최종 state 일부 + 누적 events kind/site/urgency 검사
    diffs: List[str] = []

    # 사이트 상태 kind 비교
    for site_id, expected_kind in expected.get("finalSiteKinds", {}).items():
        actual = state["sites"].get(site_id, {}).get("kind")
        if actual != expected_kind:
            diffs.append(f"sites.{site_id}.kind: expected={expected_kind} actual={actual}")

    # 이벤트 sequence 비교 (kind+site+urgency만 본다 — 세부 필드는 너무 자세함)
    expected_events = expected.get("events", [])
    if len(expected_events) != len(all_events):
        diffs.append(
            f"events length: expected={len(expected_events)} actual={len(all_events)}"
        )
    else:
        for i, (e_exp, e_act) in enumerate(zip(expected_events, all_events)):
            for field_name in ("kind", "site", "urgency"):
                if e_exp.get(field_name) != e_act.get(field_name):
                    diffs.append(
                        f"events[{i}].{field_name}: expected={e_exp.get(field_name)} "
                        f"actual={e_act.get(field_name)}"
                    )

    # consecutiveFailures가 있으면 비교
    for site_id, expected_failures in expected.get("consecutiveFailures", {}).items():
        site_state = state["sites"].get(site_id, {})
        actual_failures = site_state.get("consecutiveFailures")
        if actual_failures != expected_failures:
            diffs.append(
                f"sites.{site_id}.consecutiveFailures: expected={expected_failures} "
                f"actual={actual_failures}"
            )

    if diffs:
        return False, "\n  ".join(diffs)
    return True, "OK"


def main() -> int:
    fixtures_dir = Path(__file__).parent / "fixtures"
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
        print(f"All {len(scenarios)} scenarios passed.")
        return 0
    print("One or more scenarios FAILED. State machine parity is broken.")
    return 1


if __name__ == "__main__":
    sys.exit(main())
