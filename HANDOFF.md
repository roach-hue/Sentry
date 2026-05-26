# HANDOFF — 사용자가 알아야 할 것

작성: 2026-05-20  
대상: 사용자 본인 (작업 인수인계용)  
원칙: 파일과 코드에 실제로 존재하는 것만 적음

---

## 1. 실행 명령 (이것만 알면 됨)

```bash
npm install                                # 1회
npm run build                              # dist/ 생성
npm test                                   # 69개 Vitest 통과 확인
py verify/state_machine_parity.py          # 4개 Python parity 통과 확인
py verify/scheduler_parity.py              # 7개 Python parity 통과 확인
npm run recon                              # (선택) Playwright로 실 사이트 HTML 캡처 — Chromium 자동 설치 후 실행
npm run typecheck                          # tsc --noEmit
```

Chrome 로드: [chrome://extensions](chrome://extensions) → 개발자 모드 → 압축해제된 확장 프로그램 로드 → [c:\Sentry\dist](c:\Sentry\dist).

---

## 2. 파일 맵 (총 38개 소스/테스트/검증 파일, 약 3,313 LOC)

### 도메인 & 로직 — 가장 중요

| 파일 | LOC | 역할 |
|---|---|---|
| [src/core/types.ts](src/core/types.ts) | 172 | 타입 정의 — 아래 표에서 보고 싶은 타입만 줄번호 따라 점프 |
| [src/core/state-machine.ts](src/core/state-machine.ts) | 211 | **여기를 먼저 봐야 함.** `step()` 함수가 모든 상태 전이 + 알림 결정. 순수 함수. |
| [src/core/normalize.ts](src/core/normalize.ts) | 41 | `normalizeHotelName()` (사이트간 호텔명 매칭), `shiftIsoDate()` (센티넬 날짜 계산) |

#### types.ts 내부 네비게이션

168줄 다 볼 필요 없습니다. **본인이 그 타입의 동작이 궁금할 때만** 해당 줄로 점프하세요.

| 타입 | 줄 | 이게 뭐냐 |
|---|---|---|
| `SiteId`, `ALL_SITES` | [9, 11](src/core/types.ts#L9) | 3개 사이트 식별자 ('agoda' / 'hotelsCombined' / 'trip') |
| `SearchSpec` | [13](src/core/types.ts#L13) | 사용자 검색 조건 (도시/날짜/인원). **여기 어린이 미지원 TODO 있음** |
| `Listing` | [29](src/core/types.ts#L29) | 호텔 1건 — 가격/잔여/조식 등 |
| `FetchResult`, `FetchError` | [51, 64](src/core/types.ts#L51) | 한 사이트 한 번 fetch 결과 (성공/실패) |
| `PollRound`, `SitePollResult` | [76, 82](src/core/types.ts#L76) | 한 라운드 통째 결과 (3사이트 × real+sentinel) |
| `SiteState` (notYetOpen / justOpened / tracking / scraperSuspect 등) | [88](src/core/types.ts#L88) | 사이트별 상태머신 상태 — **요거 보면 상태 종류 한눈에 보임** |
| `WatchState` | [97](src/core/types.ts#L97) | 영속화되는 전체 상태 |
| `NotificationEvent` (bookingOpened / lowInventory / scraperSuspect / soldOut) | [107](src/core/types.ts#L107) | 알림 1건 — **요거 보면 알림 종류 한눈에 보임** |
| `AlertConfig` | [144](src/core/types.ts#L144) | 사용자 임계값 설정 |
| `Config`, `NotificationChannelConfig` | [153, 162](src/core/types.ts#L153) | 전체 설정 + 채널별 설정 |

**처음 보실 때 추천 경로:** SearchSpec (검색 조건) → Listing (출력 단위) → SiteState (상태 종류) → NotificationEvent (알림 종류). 이 4개만 봐도 데이터 흐름 파악 끝납니다.

#### state-machine.ts 내부 네비게이션

**결정 로직은 사실 stepSite() 안에만 있고, 거기서도 4~5군데가 핵심**입니다. 위에서 아래로 그대로 읽으면 됩니다.

| 줄 | 뭐가 일어남 | 왜 중요한가 |
|---|---|---|
| [20-43](src/core/state-machine.ts#L20-L43) | `step()` 본체 — 사이트별로 stepSite 호출 + 결과 합치기 | **그냥 디스패처. 보지 마세요** — 본인이 본 29-31줄이 여기 |
| [64-75](src/core/state-machine.ts#L64-L75) | `stepSite()` 시작 — real/sentinel 추출 | 이름만 확인하고 통과 |
| [76-78](src/core/state-machine.ts#L76-L78) | **fetcher 에러 → scraperSuspect** | 분기 1번 |
| [80-96](src/core/state-machine.ts#L80-L96) | **🔑 핵심: real 0건일 때 4-way 판별** | 이게 이 프로젝트의 IP. 센티넬 비교로 미오픈 vs 깨짐 구분 |
| [108-116](src/core/state-machine.ts#L108-L116) | **🚨 bookingOpened 이벤트 발사** | notYetOpen → 매물 등장 시 critical 알림. 이게 킬러 기능 |
| [119-141](src/core/state-machine.ts#L119-L141) | lowInventory 감지 | "부족" 구간으로 새로 진입할 때만 발사 |
| [146-162](src/core/state-machine.ts#L146-L162) | justOpened vs tracking 상태 확정 | 위에서 wasNotOpen이면 justOpened, 아니면 tracking |
| [165-187](src/core/state-machine.ts#L165-L187) | `toScraperSuspect()` — 연속 실패 카운트 | **1회와 3회만 알림 발사** (그 외엔 무알림 — 사이트 다운 시 스팸 방지) |

**처음 읽으실 때 추천:** 80-96줄 먼저 보세요. 거기가 이 프로젝트의 차별점 전부입니다. 그 다음 108-116줄(킬러 알림). 나머지는 부수적입니다.

본인이 보신 [29-31](src/core/state-machine.ts#L29-L31)줄은 그냥 사이트별 루프라서 정말 볼 게 없습니다. 거기서 호출하는 `stepSite()`(64줄)부터가 본론입니다.

### 외부 의존성 인터페이스 & Mock

| 파일 | LOC | 역할 |
|---|---|---|
| [src/fetchers/interface.ts](src/fetchers/interface.ts) | 14 | `SiteFetcher` 인터페이스 정의 |
| [src/fetchers/mock.ts](src/fetchers/mock.ts) | 38 | `MockFetcher` — 테스트용, FetchResult 큐 기반 |
| [src/notifiers/interface.ts](src/notifiers/interface.ts) | 15 | `Notifier` 인터페이스 |
| [src/notifiers/mock.ts](src/notifiers/mock.ts) | 26 | `MockNotifier` — 호출 기록 |
| [src/storage/state-store.ts](src/storage/state-store.ts) | 81 | `StateStore` 인터페이스 + 인메모리/chrome.storage 두 구현 |
| [src/storage/config-store.ts](src/storage/config-store.ts) | 70 | `ConfigStore` + 기본값 `DEFAULT_CONFIG` |

### 사이트별 프로덕션 구현

| 파일 | LOC | 역할 | 주의 |
|---|---|---|---|
| [src/fetchers/html-utils.ts](src/fetchers/html-utils.ts) | 115 | JSON-LD/`__NEXT_DATA__` 추출, Cloudflare 차단 감지, 가격 파싱 | Service Worker는 DOMParser 없으므로 regex+JSON 추출 방식 |
| [src/fetchers/agoda.ts](src/fetchers/agoda.ts) | 170 | Agoda fetch + 추출 | `TOKUSHIMA_CITY_ID = '17263'` 하드코딩 — recon으로 확인 필요 |
| [src/fetchers/hotels-combined.ts](src/fetchers/hotels-combined.ts) | 136 | HotelsCombined fetch + 추출 | URL: `/Place/Tokushima.htm` |
| [src/fetchers/trip.ts](src/fetchers/trip.ts) | 142 | Trip.com fetch + 추출 | `TOKUSHIMA_CITY_ID = '774'` 하드코딩 |

### 알림 채널

| 파일 | LOC | 역할 |
|---|---|---|
| [src/notifiers/format.ts](src/notifiers/format.ts) | 74 | `formatEvent()` — NotificationEvent → 한국어 제목/본문 |
| [src/notifiers/chrome-notification.ts](src/notifiers/chrome-notification.ts) | 60 | `chrome.notifications.create()` 래퍼 |
| [src/notifiers/kakao.ts](src/notifiers/kakao.ts) | 137 | Kakao "나에게 보내기" + 401 시 refresh 토큰으로 자동 갱신 |

### 오케스트레이션 & 확장 진입점

| 파일 | LOC | 역할 |
|---|---|---|
| [src/orchestrator/orchestrator.ts](src/orchestrator/orchestrator.ts) | 94 | `runPollRound()` — fetch 3사이트 × 2(real+sentinel) → step() → 저장 → notifier fan-out |
| [src/background/service-worker.ts](src/background/service-worker.ts) | 152 | Manifest V3 service worker. `chrome.alarms` 매일 09:00, 메시지 핸들러 |
| [public/manifest.json](public/manifest.json) | — | Manifest V3 정의. host_permissions에 3개 사이트 + Kakao 도메인 |
| [src/options/options.html](src/options/options.html), [options.css](src/options/options.css), [options.ts](src/options/options.ts) | 103 + HTML/CSS | 옵션 페이지 (검색 조건/임계값/알림 채널) + "지금 테스트 실행" 버튼 |

### 빌드 & 정찰

| 파일 | 역할 |
|---|---|
| [scripts/build.mjs](scripts/build.mjs) | esbuild로 [dist/](dist/) 생성. 매니페스트 + HTML/CSS 복사 + 1×1 투명 PNG 아이콘 fallback |
| [scripts/recon.mjs](scripts/recon.mjs) | Playwright 헤드 모드로 3사이트 검색 후 HTML을 [tests/fixtures/html/](tests/fixtures/html/)에 저장. `npm run recon`이 Chromium 자동 설치 후 실행 (idempotent) |

### 테스트 (47개 통과)

| 파일 | 테스트 수 | 무엇을 검증 |
|---|---|---|
| [tests/state-machine.test.ts](tests/state-machine.test.ts) | 9 | step() 빌더 기반 시나리오 (notYetOpen, justOpened, scraperSuspect 1/3회 알림, lowInventory, 다중 사이트 독립성) |
| [tests/state-machine-fixtures.test.ts](tests/state-machine-fixtures.test.ts) | 4 | 위와 같은 로직을 JSON 픽스처로 다시 검증 (TS↔Python 공유 데이터) |
| [tests/orchestrator.test.ts](tests/orchestrator.test.ts) | 8 | makeSentinelSpec, 종단 흐름, 다중 notifier, notifier 실패 처리, fetcher 없을 때 throw |
| [tests/notifier.test.ts](tests/notifier.test.ts) | 8 | formatEvent 4종 + Kakao OAuth (200/401→refresh→retry/refresh keeps old token/refresh 실패/5xx) |
| [tests/scheduler.test.ts](tests/scheduler.test.ts) | 19 | nextPollDelayMinutes 우선순위 3단계, backoffMinutes 지수+상한, summarizeStates |
| [tests/scheduler-fixtures.test.ts](tests/scheduler-fixtures.test.ts) | 7 | 동일 로직을 JSON 픽스처로 검증 (verify/scheduler_parity.py와 공유) |
| [tests/fetcher-extract.test.ts](tests/fetcher-extract.test.ts) | 14 | URL 빌더 3개 + html-utils 5개 + Agoda/HC/Trip 추출기 6개 |
| [tests/helpers/builders.ts](tests/helpers/builders.ts) | (헬퍼) | `listing()`, `fetchResult()`, `pollRound()` 빌더 |

### Python 독립 검증

| 파일 | LOC | 역할 |
|---|---|---|
| [verify/state_machine_parity.py](verify/state_machine_parity.py) | 411 | state-machine.ts를 Python으로 독립 재구현. 5개 JSON 시나리오에 같은 출력 내는지 비교. **TS 버그를 발견하기 위한 안전망.** |
| [verify/fixtures/01_not_yet_open_first_observation.json](verify/fixtures/01_not_yet_open_first_observation.json) | — | 미오픈 + 센티넬 정상 |
| [verify/fixtures/02_booking_opens.json](verify/fixtures/02_booking_opens.json) | — | 예약 오픈 감지 (핵심 기능) |
| [verify/fixtures/03_scraper_broken.json](verify/fixtures/03_scraper_broken.json) | — | real+sentinel 둘 다 0 → scraperSuspect |
| [verify/fixtures/04_scraper_broken_silent_on_2nd.json](verify/fixtures/04_scraper_broken_silent_on_2nd.json) | — | 2회차 연속 실패는 무알림 (스팸 방지) |
| [verify/fixtures/05_price_drop_on_tracking.json](verify/fixtures/05_price_drop_on_tracking.json) | — | tracking 중 가격 임계값 진입 |

### 문서

| 파일 | 역할 |
|---|---|
| [README.md](README.md) | 빠른 시작 + 아키텍처 + 트레이드오프 |
| [NAMING.md](NAMING.md) | 모든 식별자/필드/파라미터 순서 고정 사전 |
| [HANDOFF.md](HANDOFF.md) | 이 파일 |

---

## 3. 검증 결과 (사실)

| 항목 | 결과 |
|---|---|
| `npx tsc --noEmit` | 0 에러 |
| `npx vitest run` | 69/69 통과 (7개 테스트 파일) |
| `py verify/state_machine_parity.py` | 4/4 시나리오 TS↔Python 일치 |
| `py verify/scheduler_parity.py` | 7/7 시나리오 TS↔Python 일치 |
| `node scripts/build.mjs` | dist/ 생성 |

### 폴링 스케줄링 (적응형)

매일 09:00 고정이 아닙니다. **상태 보고 자동 결정**:

| 사이트 상태 | 다음 폴까지 | 근거 |
|---|---|---|
| 미오픈/미관측 (어떤 사이트라도) | 30분 | 예약 오픈 감지가 이 시스템의 핵심 가치 — 평균 지연 15분 |
| 정상 추적 중 | 24시간 | 매물 확보 후 가격 변동은 시간 단위로 미세 |
| 모두 깨짐 | 60분 → 120 → 240 → 480 → 720분 (12시간 상한) | 깨진 엔드포인트 두드릴 이유 없음. 지수 백오프 |

결정 로직: [src/core/scheduler.ts:nextPollDelayMinutes()](src/core/scheduler.ts).  
설정값 변경: [src/storage/config-store.ts:DEFAULT_CONFIG.polling](src/storage/config-store.ts).

---

## 4. 직접 실 사이트 호출은 한 번도 안 했음 — 알아두실 것

**중요:** 이 빌드 동안 아고다/호텔스컴바인/트립닷컴에 **실제 요청을 보낸 적이 없습니다.** Playwright recon도 안 돌렸습니다. 이유:

- Claude Code 환경에서 헤드 브라우저 띄우는 건 사용자 환경의 디스플레이가 필요
- 실 사이트 응답은 IP/지역/쿠키 따라 다르므로 사용자가 본인 PC에서 돌려야 의미 있음

**결과적으로 검증되지 않은 부분:**
1. Agoda `TOKUSHIMA_CITY_ID = '17263'`이 현재 유효한지
2. Trip.com `TOKUSHIMA_CITY_ID = '774'`가 현재 유효한지
3. HotelsCombined URL `/Place/Tokushima.htm`이 검색 결과 페이지로 응답하는지
4. 세 사이트가 정말 JSON-LD 또는 `__NEXT_DATA__`에 호텔 정보를 노출하는지

**1차 실행 시 거의 확실히 일어날 일:**
- 셋 중 하나 이상이 0건 반환 → 상태머신이 자동으로 `scraperSuspect`로 전이 → "스크래퍼 점검 필요" 알림이 옴
- 이때 `npm run recon`으로 실 HTML 받아서 [src/fetchers/agoda.ts](src/fetchers/agoda.ts) 같은 파일의 추출 로직 보정해야 함
- 보정 가이드: 추출기 함수가 비어있으면 `extractJsonLd()` 호출하는 부분 디버깅, 또는 `__NEXT_DATA__` 대신 다른 글로벌 변수 찾기

---

## 5. 미완 부분 (의도적으로 안 만든 것)

| 항목 | 상태 | 이유 |
|---|---|---|
| `SiteState.soldOut` 전이 | 타입 정의만 있고 step()에서 미구현 | 우선순위 낮음, 추가 시나리오 필요 |
| 사이트간 호텔명 fuzzy 매칭 (Levenshtein 등) | 미구현 | `normalizedName` 완전 일치만 사용. 다음 버전 과제 |
| 통화 변환 | 미구현 | URL에 `currency=JPY` 강제. 사이트가 다른 통화로 응답하면 가격 잘못 들어감 |
| 디스코드 알림 | 미구현 | 사용자가 거절함 |
| 카카오 OAuth 최초 로그인 흐름 | 미구현 | refresh 토큰 갱신 로직만 구현. 최초 access/refresh 토큰 발급은 사용자가 카카오 개발자 콘솔에서 직접 수행 후 옵션 페이지에 붙여넣기 |
| 아이콘 PNG | 1×1 투명 placeholder | 사용자가 [public/icons/icon16.png](public/icons/icon16.png), `icon48.png`, `icon128.png`로 교체하면 빌드 시 자동 사용 |

---

## 6. 사용자가 카카오 알림 활성화하려면

1. [카카오 개발자 콘솔](https://developers.kakao.com) 로그인 → 애플리케이션 추가
2. "카카오 로그인" 활성화, Redirect URI 설정 (예: `http://localhost`)
3. "동의항목"에서 "카카오톡 메시지 전송" 권한 추가
4. REST API 키 복사
5. 한 번만 OAuth 인증 코드 받기 → access_token + refresh_token 발급 (외부 도구로)
6. 옵션 페이지에 REST API 키 / access_token / refresh_token 입력 후 저장
7. 이후로는 [src/notifiers/kakao.ts](src/notifiers/kakao.ts:67)의 401 핸들러가 refresh 자동 처리

---

## 7. 아키텍처 한 줄 요약

```
chrome.alarms (매일 09:00)
  → service-worker.ts (runOnce)
    → orchestrator.runPollRound(config, deps)
       ├─ Promise.all([real fetch, sentinel fetch]) × 3 사이트
       ├─ step(prev, round, alert)  ← 순수 함수, TS+Python 양쪽 검증
       ├─ store.save(next)
       └─ for each event × each notifier: notifier.send(event)
```

핵심 통찰: **fetcher가 0건 반환 = 4가지 의미를 가짐 (미오픈 / 필터 / 깨짐 / 차단).**  
센티넬 쿼리(1년 전 같은 날짜)로 "미오픈"과 "깨짐"을 자동 구분 — 이게 다른 모니터링 봇과의 핵심 차별점.

---

## 8. 다음에 해야 할 일 우선순위

1. **`npm run build` → dist/ → Chrome 로드 → 옵션 페이지 → "지금 테스트 실행"** — 실 사이트 첫 호출. 거의 확실히 일부 사이트에서 0건 또는 차단 발생할 것
2. **`npm run recon`** — 실 HTML 캡처 후 추출기 보정
3. (선택) 아이콘 추가 → 빌드 다시
4. (선택) 카카오 등록 → 옵션에 토큰 입력
5. 폴링은 **적응형** — 상태에 따라 30분 / 24시간 / 12시간 백오프 자동 결정. 기본값 변경은 [src/storage/config-store.ts:DEFAULT_CONFIG.polling](src/storage/config-store.ts)에서
