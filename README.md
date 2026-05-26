# Awaodori Hotel Watch

도쿠시마 아와오도리(8월 12~15일) 기간 호텔 매물을 **아고다·호텔스컴바인·트립닷컴** 세 사이트에서 자동 감시하는 Chrome 확장프로그램.

핵심 기능은 단순한 가격 모니터링이 아니라 **예약 오픈 시점 자동 감지**입니다. 아와오도리 호텔은 예약 오픈 후 수 시간 내에 매진되므로, 매일 폴링하다가 "오픈됐다"는 순간 사용자에게 critical 알림을 보냅니다.

## 빠른 시작

```bash
npm install
npm run build           # dist/ 생성
```

Chrome → [chrome://extensions](chrome://extensions) → 개발자 모드 → **압축해제된 확장 프로그램 로드** → `c:\Sentry\dist` 폴더 선택.

확장 아이콘 클릭 → 옵션 페이지 → 검색 조건 입력 → **저장** → **지금 테스트 실행** 누르면 즉시 한 라운드가 돌고 결과를 보여줍니다. 이후로는 매일 오전 9시에 자동 폴링.

## 핵심 설계 — "예약 미오픈" 판별

폴링 결과가 "0건"일 때 4가지 의미가 있습니다:

1. 예약 미오픈 (정상 — 기다리면 됨)
2. 검색 필터 너무 까다로움
3. 스크래퍼/셀렉터 깨짐 (코드 문제)
4. IP/세션 차단

겉으로는 다 똑같이 보입니다. 이걸 구분 못하면 **알림 시스템이 거짓 음성으로 무너집니다.**

**해결: 센티넬 쿼리.**

```
real:     도쿠시마, 2027-08-12 ~ 2027-08-15   (사용자 실 검색)
sentinel: 도쿠시마, 2026-08-12 ~ 2026-08-15   (1년 전 동일 조건)

real=0 && sentinel>0  → 예약 미오픈 (notYetOpen 상태)
real>0 && prev=notYetOpen → 🚨 예약 오픈! (bookingOpened critical)
real=0 && sentinel=0  → 스크래퍼 의심 (scraperSuspect)
```

상태머신 전체 상태:

```
unknown → notYetOpen → justOpened → tracking
                            │
                            ↓
        scraperSuspect ← (real=0 + sentinel=0)
```

## 아키텍처

```
┌──────────────────┐
│  chrome.alarms   │  매일 09:00 트리거
└────────┬─────────┘
         ↓
┌──────────────────┐
│  Orchestrator    │  runPollRound(config, deps)
│  src/orchestrator│
└─┬───────┬───────┬┘
  │       │       │
  ↓       ↓       ↓
┌─────┐ ┌─────┐ ┌─────┐
│Agoda│ │HC   │ │Trip │  SiteFetcher 인터페이스
└──┬──┘ └──┬──┘ └──┬──┘
   └───────┼───────┘
           ↓
   ┌───────────────┐
   │  step()       │  순수 함수 — 상태머신
   │  src/core     │  (테스트: 5 JSON × TS/Python 양쪽 검증)
   └───────┬───────┘
           ↓
   ┌───────────────┐
   │  Notifier     │  chrome.notifications + Kakao DM
   │  fan-out      │  (OAuth refresh 토큰 자동 갱신)
   └───────────────┘
```

자세한 식별자 정의: [NAMING.md](NAMING.md).

## 테스트 전략

세 단계로 검증합니다:

1. **TypeScript 단위/통합 테스트** (Vitest) — 47개 테스트
   - 상태머신 시나리오 16개 (빌더 기반 + JSON 픽스처 기반)
   - Orchestrator 종단 8개
   - Notifier 9개 (Kakao OAuth refresh 포함)
   - Fetcher 추출기 14개

2. **Python parity verifier** — 상태머신 핵심 로직을 Python으로 독립 재구현하여 같은 시나리오 JSON에 대해 같은 출력을 내는지 검증
   ```bash
   py verify/state_machine_parity.py
   ```
   같은 사람이 두 언어로 같은 버그를 동시에 심을 확률이 매우 낮으므로 parity가 맞으면 로직 정확성에 대한 신뢰도가 크게 올라갑니다.

3. **실 사이트 정찰** (Playwright) — 사용자가 수동 실행
   ```bash
   npm run recon
   ```
   3개 사이트의 실제 검색 페이지 HTML을 [tests/fixtures/html/](tests/fixtures/html/)에 저장. 셀렉터/JSON 구조가 변경됐을 때 회귀 테스트의 입력이 됩니다.

전체 검증:
```bash
npm run typecheck    # 0 error
npm test             # 47 passed
py verify/state_machine_parity.py   # 5 scenarios passed
```

## 트레이드오프 — 솔직히

**잘 됨**
- 상태머신 로직 — 순수 함수, TS+Python 양쪽 검증, 100% 결정적
- 알림 fan-out — 여러 채널 동시 지원, 한 채널 실패해도 나머지 정상
- Kakao OAuth — 401 시 자동 refresh + 토큰 영속화
- DI(의존성 주입) 일관 적용 — fetcher/notifier/store/clock 전부 교체 가능 → 테스트 결정성 100%

**드리프트 위험**
- 사이트 HTML 구조 변경 — JSON-LD나 `__NEXT_DATA__`가 바뀌면 추출기가 0건 반환. 이때 센티넬 쿼리 패턴 덕에 "스크래퍼 의심" 상태로 자동 전이하므로 **사용자에게 알림**으로 즉시 인지 가능. 그러나 수정은 사용자 몫. `npm run recon` → 새 HTML 보고 추출기 업데이트.
- 봇 차단 — Cloudflare/DataDome이 강화되면 fetch 자체가 막힘. Chrome 확장 컨텍스트에서는 일반 브라우저와 동일한 시그널을 보내므로 보통은 통과하지만 보장은 없습니다.

**의도적으로 안 함**
- 호텔명 cross-site 매칭의 fuzzy 매칭 — 현재는 정규화 키 일치만. 사이트 간 가격 비교는 다음 버전 과제.
- 매물 소진(`soldOut`) 상태 전이 — 타입에는 정의돼 있으나 step() 미구현.
- 통화 변환 — 모든 가격을 사이트가 JPY로 표시한다고 가정 (`currency=JPY` URL 파라미터). 다른 통화로 응답 오면 totalPriceJpy 값이 잘못됩니다.

## 파일 맵

| 디렉터리 | 내용 |
|---|---|
| [src/core/](src/core/) | 도메인 타입, 상태머신, 정규화 함수 |
| [src/fetchers/](src/fetchers/) | SiteFetcher 인터페이스 + 3개 사이트 구현 + Mock |
| [src/notifiers/](src/notifiers/) | Notifier 인터페이스 + Chrome/Kakao 구현 + 포메터 |
| [src/orchestrator/](src/orchestrator/) | 한 라운드 종단 실행 |
| [src/storage/](src/storage/) | chrome.storage + 인메모리 어댑터 |
| [src/background/](src/background/) | Service Worker 진입점 (chrome.alarms 등록) |
| [src/options/](src/options/) | 옵션 페이지 (HTML/CSS/TS) |
| [tests/](tests/) | Vitest 테스트 + 빌더 헬퍼 |
| [verify/](verify/) | Python parity verifier + 공유 JSON 픽스처 |
| [scripts/](scripts/) | esbuild 빌드 + Playwright 정찰 |
| [public/manifest.json](public/manifest.json) | Chrome 확장 매니페스트 |

## 개발 명령

```bash
npm run typecheck   # 타입 체크
npm test            # Vitest 전체
npm run test:watch  # Vitest 감시 모드
npm run build       # 프로덕션 번들 → dist/
npm run watch       # 빌드 감시 모드
npm run recon       # Playwright로 실 사이트 HTML 수집 (헤드 모드)
npm run lint        # Biome 린트
npm run format      # Biome 포맷
```
