"""
recon HTML 분석 스크립트 — agoda/hotels-combined HTML에서 실제 호텔 카드
구조와 가격 패턴을 식별. 추출기를 정공법으로 다시 작성하기 위한 정찰 도구.
"""

import re
import sys
from pathlib import Path

# Windows 콘솔 cp949 한계 회피 — UTF-8로 강제.
sys.stdout.reconfigure(encoding="utf-8")

FIXTURES = Path(__file__).parent.parent / "tests" / "fixtures" / "html"


def analyze_agoda():
    html = (FIXTURES / "agoda-2027-08-12.html").read_text(encoding="utf-8")
    print(f"=== AGODA ({len(html):,} bytes) ===")

    # 가격 패턴
    for pat, label in [
        (r"JPY\s*[\d,]+", "JPY {n}"),
        (r"¥\s*[\d,]+", "¥{n}"),
        (r"\$[\d,]+", "${n}"),
        (r'data-currency-amount="[\d.]+"', 'data-currency-amount="..."'),
        (r'data-selenium="display-price"', 'data-selenium="display-price"'),
        (r'data-selenium="price"', 'data-selenium="price"'),
    ]:
        m = re.findall(pat, html)
        if m:
            print(f"  {label}: {len(m)} matches, samples: {m[:3]}")

    # 호텔 카드 블록 추출
    cards = re.findall(
        r'<li[^>]*data-selenium="hotel-item"[^>]*>(.*?)</li>',
        html,
        flags=re.DOTALL,
    )
    print(f"\n  hotel-item <li> 블록: {len(cards)}개")
    if cards:
        c = cards[0]
        print(f"  첫 카드 길이: {len(c):,} chars")
        # data-hotelid는 li 자체에 있으니 카드 안에는 없을 수 있음 - 카드 시작부 다시 보기
        full_card_match = re.search(
            r'<li[^>]*data-hotelid="(\d+)"[^>]*data-selenium="hotel-item"[^>]*>',
            html,
        )
        if full_card_match:
            print(f"  첫 카드 - data-hotelid: {full_card_match.group(1)}")

        # 카드 내 hotel-name
        name_m = re.search(r'data-selenium="hotel-name"[^>]*>([^<]+)', c)
        name_val = name_m.group(1).strip() if name_m else None
        print(f"  첫 카드 - hotel-name selector: {name_val!r}")

        # 스크린리더 텍스트에서 호텔 이름
        sr_m = re.search(r'<span class="ScreenReaderOnly[^"]*[^>]*>([^<]+)</span>', c)
        if sr_m:
            print(f"  첫 카드 - ScreenReader 텍스트: {sr_m.group(1).strip()!r}")

        # 가격
        price_m = re.search(r"(JPY|¥)\s*[\d,]+", c)
        print(f"  첫 카드 - 가격(텍스트): {price_m.group() if price_m else None!r}")

        # display-price 셀렉터
        dp_m = re.search(r'data-selenium="display-price"[^>]*>(.*?)</', c, re.DOTALL)
        print(f"  첫 카드 - display-price 셀렉터: {dp_m.group(1).strip()[:80] if dp_m else None!r}")


def deep_inspect_agoda_card():
    html = (FIXTURES / "agoda-2027-08-12.html").read_text(encoding="utf-8")
    print("\n=== AGODA: 카드 1개 깊이 분석 ===")
    # 더 큰 카드 블록 잡기 (li ... </li>를 중첩 없이)
    # data-hotelid 시작점부터 다음 li 시작 전까지
    m = re.search(
        r'<li[^>]*data-hotelid="(\d+)"[^>]*data-selenium="hotel-item"[^>]*>',
        html,
    )
    if not m:
        print("  card start not found")
        return
    start = m.start()
    # 같은 li가 닫히는 곳 찾기 — DOM이 평평하지 않으니 다음 hotel-item li 시작 전까지로 근사
    next_m = re.search(
        r'<li[^>]*data-selenium="hotel-item"',
        html[m.end():],
    )
    end = m.end() + (next_m.start() if next_m else 5000)
    card = html[start:end]
    print(f"  card chunk size: {len(card):,} chars")
    print(f"  data-hotelid: {m.group(1)}")
    # 카드 안에 있을만한 것들 모두 탐색
    samples = {
        "JPY/¥ 가격": re.findall(r"(JPY|¥)\s*[\d,]+", card)[:3],
        "data-selenium 변종": list(set(re.findall(r'data-selenium="([^"]+)"', card)))[:20],
        "data-element-name": list(set(re.findall(r'data-element-name="([^"]+)"', card)))[:20],
        "data-* 속성 이름": list(set(re.findall(r"data-([a-z][\w-]+)=", card)))[:20],
        "현지 통화 토큰": re.findall(r"\b[0-9,]{4,}\s*(?:원|엔|JPY|円)", card)[:3],
        "price 클래스": re.findall(r'class="[^"]*[Pp]rice[^"]*"', card)[:3],
        "aria-label 가격류": re.findall(r'aria-label="[^"]*[\d,]+\s*(?:원|엔|JPY|¥|円)[^"]*"', card)[:3],
    }
    for k, v in samples.items():
        if v:
            print(f"  {k}: {v}")

    # 카드 끝부분(가격은 보통 카드 우측에 있음) 직접 보기
    print(f"\n  카드 끝 800자 미리보기:")
    print("  " + card[-800:].replace("\n", " "))


def analyze_hotels_combined():
    html = (FIXTURES / "hotels-combined-2027-08-12.html").read_text(encoding="utf-8")
    print(f"\n=== HOTELS-COMBINED ({len(html):,} bytes) ===")

    # Agoda와 같은 셀렉터로 시도
    for pat, label in [
        (r'data-hotelid="(\d+)"', "data-hotelid (Agoda style)"),
        (r'data-selenium="hotel-item"', 'data-selenium="hotel-item"'),
        (r'data-selenium="hotel-name"', 'data-selenium="hotel-name"'),
        (r'data-selenium="display-price"', 'data-selenium="display-price"'),
        (r'data-selenium="total-price-per-night"', 'data-selenium="total-price-per-night"'),
        # hotels-combined 고유 패턴
        (r'data-cy="[\w-]+"', 'data-cy="..."'),
        (r'data-test="property', 'data-test="property*"'),
        (r'class="PropertyCard ', "PropertyCard 클래스 시작"),
    ]:
        m = re.findall(pat, html)
        if m:
            samples = m[:3] if len(m) > 0 and len(str(m[0])) < 50 else []
            print(f"  {label}: {len(m)} matches" + (f", samples: {samples}" if samples else ""))

    # 도쿠시마/Tokushima 위치 확인
    tokushima_pos = html.find("Tokushima")
    print(f"\n  Tokushima 첫 위치: {tokushima_pos}")
    if tokushima_pos > 0:
        print(f"  주변 context (200자 앞뒤):")
        s = max(0, tokushima_pos - 100)
        e = min(len(html), tokushima_pos + 200)
        print("  " + html[s:e].replace("\n", " "))


if __name__ == "__main__":
    analyze_agoda()
    deep_inspect_agoda_card()
