# NAMING — 변수/타입/파라미터 고정 사전

이 파일은 **코드 전체에서 사용되는 모든 식별자의 단일 진실 공급원(SSOT)** 입니다.
새 이름을 도입할 때마다 여기에 먼저 추가하고, 기존 이름은 절대 변형하지 않습니다
(예: `pricePerNightJpy`를 어떤 곳에서 `nightlyPrice`로 부르면 안 됨).

작성일: 2026-05-20  
프로젝트: 아와오도리 호텔 알림 크롬 확장 ([c:\Sentry](c:\Sentry))

---

## 1. 도메인 핵심 타입 ([src/core/types.ts](src/core/types.ts))

| 타입 | 설명 |
|---|---|
| `SiteId` | `'agoda' \| 'hotelsCombined' \| 'trip'` 셋 중 하나 |
| `ALL_SITES` | 위 3개를 담은 `readonly SiteId[]` 상수 |
| `SearchSpec` | 사용자가 검색하는 조건 (도시, 날짜, 인원) |
| `Listing` | 한 호텔의 한 시점 매물 정보 |
| `FetchResult` | 한 사이트 한 번 fetch 결과 (성공이든 실패든) |
| `FetchError` | fetcher 실패 종류 (`network` / `blocked` / `parse` / `rateLimit` / `unknown`) |
| `PollRound` | 한 라운드의 전체 결과 (3개 사이트 × real + sentinel) |
| `SitePollResult` | 한 사이트의 real + sentinel 쌍 |
| `SiteState` | 사이트별 상태머신 상태 |
| `WatchState` | 전체 영속 상태 (사이트별 상태 + 이전 라운드 + 이전 매물) |
| `NotificationEvent` | 알림 1건 (state machine이 생성, notifier가 소비) |
| `AlertConfig` | 사용자가 정의한 알림 임계값 |
| `Config` | 전체 설정 (SearchSpec + 센티넬 오프셋 + AlertConfig + 채널) |
| `NotificationChannelConfig` | 알림 채널 활성화 및 자격증명 |

### SiteState 변종

| `kind` | 의미 |
|---|---|
| `unknown` | 아직 한 번도 폴링 안 했거나 초기 상태 |
| `notYetOpen` | 예약 미오픈 (real 0건, sentinel 정상) |
| `justOpened` | 직전까지 미오픈 → 이번 라운드에 매물 등장 (1회성 상태) |
| `tracking` | 정상 추적 중 |
| `soldOut` | 이전에 매물 있었으나 지금 0건 (보류 — 추가 구현 필요) |
| `scraperSuspect` | real 0건 + sentinel도 0건 → 스크래퍼 의심 |

### NotificationEvent 변종 (`kind` 필드)

| `kind` | urgency | 트리거 |
|---|---|---|
| `bookingOpened` | `critical` | notYetOpen → 매물 등장 |
| `lowInventory` | `high` | 잔여 객실이 임계값 이하로 새로 진입 |
| `scraperSuspect` | `medium` | 연속 실패 1회차 또는 3회차 |
| `soldOut` | `low` | 매물 → 0건 전환 (추가 구현 필요) |

## 2. Listing 필드 (절대 다른 이름 쓰지 말 것)

| 필드 | 타입 | 의미 |
|---|---|---|
| `id` | `string` | 사이트가 부여한 호텔 ID (없으면 슬러그) |
| `name` | `string` | 사이트에 표시된 원문 이름 |
| `normalizedName` | `string` | 사이트간 매칭용 정규화 키 (소문자, 공백 단일화) |
| `pricePerNightJpy` | `number \| null` | 박당 가격 (JPY). 사이트가 총액만 주면 null |
| `totalPriceJpy` | `number` | 총 숙박 가격 (JPY). **항상 존재** |
| `roomsRemaining` | `number \| null` | 잔여 객실 수 (사이트가 노출 시) |
| `breakfastIncluded` | `boolean \| null` | 조식 포함 여부 |
| `freeCancellation` | `boolean \| null` | 무료 취소 가능 여부 |
| `url` | `string \| null` | 호텔 상세 페이지 링크 |

⚠ **금지 변형**: `priceJpy`, `nightlyPrice`, `total`, `cost`, `roomCount`, `available` 등은 절대 사용하지 말 것.

## 3. SearchSpec 필드

| 필드 | 타입 | 의미 |
|---|---|---|
| `destination` | `string` | 자유 텍스트 (예: "Tokushima"). fetcher가 사이트별 코드로 매핑 |
| `checkIn` | `string` | ISO YYYY-MM-DD |
| `checkOut` | `string` | ISO YYYY-MM-DD |
| `adults` | `number` | 성인 인원 |
| `rooms` | `number` | 객실 수 |

⚠ `city`, `region`, `from`, `to`, `dateFrom`, `dateTo`, `guests`, `peopleCount` 등 금지.

## 4. AlertConfig 필드

| 필드 | 타입 | 의미 |
|---|---|---|
| `lowInventoryAt` | `number \| null` | 잔여 객실 이하 진입 시 알림 (null = 비활성) |
| `alertCooldownSec` | `number` | 같은 알림 재발사 방지 쿨다운 (초) |

## 5. PollRound / SitePollResult 필드

| 필드 | 타입 | 의미 |
|---|---|---|
| `startedAt` | `string` ISO datetime | 라운드 시작 시각 (UTC) |
| `completedAt` | `string` ISO datetime | 라운드 완료 시각 (UTC). **상태머신의 `now` 입력** |
| `perSite` | `Record<SiteId, SitePollResult>` | 사이트별 결과 |
| `real` | `FetchResult` | 사용자 실 검색 결과 |
| `sentinel` | `FetchResult` | 1년 전 같은 날짜 검색 결과 (스크래퍼 깨짐 판별용) |

## 6. SiteState 내부 필드

| 상태 | 필드 |
|---|---|
| `notYetOpen` | `since: string` (이 상태 진입 시각) |
| `justOpened` | `detectedAt: string`, `openingListings: Listing[]` (최대 10건) |
| `tracking` | `since: string`, `lastSeenCount: number` |
| `soldOut` | `since: string` |
| `scraperSuspect` | `since: string`, `consecutiveFailures: number` |

## 7. 인터페이스 ([src/fetchers/interface.ts](src/fetchers/interface.ts), [src/notifiers/interface.ts](src/notifiers/interface.ts))

```ts
interface SiteFetcher {
  readonly site: SiteId;
  fetch(spec: SearchSpec): Promise<FetchResult>;
}

interface Notifier {
  readonly name: string;
  send(event: NotificationEvent): Promise<NotifierResult>;
}

type NotifierResult =
  | { ok: true }
  | { ok: false; error: string; retriable: boolean };
```

## 8. 핵심 함수

| 함수 | 시그니처 | 위치 |
|---|---|---|
| `step` | `(prev: WatchState, round: PollRound, alert: AlertConfig) => { next: WatchState; events: NotificationEvent[] }` | [src/core/state-machine.ts](src/core/state-machine.ts) |
| `normalizeHotelName` | `(raw: string) => string` | [src/core/normalize.ts](src/core/normalize.ts) |
| `shiftIsoDate` | `(iso: string, deltaDays: number) => string` | [src/core/normalize.ts](src/core/normalize.ts) |
| `emptyWatchState` | `(allSites: readonly SiteId[]) => WatchState` | [src/storage/state-store.ts](src/storage/state-store.ts) |

⚠ **함수 파라미터 순서 고정**: `step(prev, round, alert)` — 절대 순서 바꾸지 말 것. 알림 임계값이 라운드 입력보다 뒤.

## 9. 검증(verification) 스크립트 네이밍

| 위치 | 목적 |
|---|---|
| `tests/*.test.ts` | Vitest 단위/통합 테스트 (1차 검증) |
| `verify/state_machine_parity.py` | 상태머신 Python 재구현 + 시나리오 JSON 동등성 검증 (2차 검증) |
| `verify/fixtures/*.json` | TS와 Python이 공유하는 시나리오 픽스처 |

## 10. 디렉터리 구조 — 고정

```
c:\Sentry\
├── .claude/                # Claude Code 설정 (gitignore된 settings.local.json만)
├── src/
│   ├── core/               # 도메인 로직 (types, state-machine, normalize)
│   ├── fetchers/           # SiteFetcher 인터페이스 + 구현
│   ├── notifiers/          # Notifier 인터페이스 + 구현
│   ├── storage/            # StateStore 인터페이스 + 구현
│   ├── background/         # service worker 진입점 (Chrome MV3)
│   ├── options/            # 설정 페이지 UI
│   └── orchestrator/       # 라운드 실행 조율
├── tests/                  # Vitest 테스트
│   ├── helpers/            # 빌더 함수
│   └── fixtures/           # 시나리오 JSON + HTML 스냅샷
├── verify/                 # Python 독립 검증 스크립트
│   └── fixtures/           # TS/Python 공유 JSON
├── scripts/                # 빌드/정찰 스크립트 (esbuild, Playwright)
├── public/                 # manifest.json, 아이콘
└── dist/                   # 빌드 산출물 (gitignore)
```

⚠ 새 디렉터리 추가 시 이 표 먼저 갱신할 것.

## 11. Orchestrator ([src/orchestrator/orchestrator.ts](src/orchestrator/orchestrator.ts))

| 식별자 | 종류 | 설명 |
|---|---|---|
| `OrchestratorDeps` | interface | 외부 의존성 (fetchers, notifiers, store, now) — 모두 DI |
| `PollOutcome` | interface | 한 라운드의 결과: `round`, `events`, `notifierResults` |
| `runPollRound(config, deps)` | function | 한 라운드 종단 실행. 사이트별 real+sentinel fetch → step() → 저장 → 알림 fan-out |
| `makeSentinelSpec(spec, offsetDays)` | function | SearchSpec의 checkIn/checkOut을 N일 뒤로 시프트 |
| `notifierResults[i].notifier` | string | 알림 채널 이름 |
| `notifierResults[i].event` | NotificationEvent | 발사된 이벤트 |
| `notifierResults[i].ok` | boolean | 전송 성공 여부 |
| `notifierResults[i].error` | string \| undefined | 실패 시 메시지 |

⚠ Orchestrator는 절대 throw 하지 않고 fetcher 에러는 FetchResult.error로 흡수. throw는 **설정 오류**(사이트에 fetcher 없음 등)일 때만.

## 12. 시간 처리 규약

- 모든 시각은 **ISO 8601 UTC 문자열** (`2026-08-15T12:00:00Z`)
- 상태머신은 `Date.now()`를 직접 호출하지 않고 `round.completedAt`를 `now`로 사용
- Orchestrator는 `deps.now: () => string` 주입으로 시간 픽스 가능 (테스트 결정성)

## 13. 적응형 스케줄러 ([src/core/scheduler.ts](src/core/scheduler.ts))

| 식별자 | 종류 | 설명 |
|---|---|---|
| `PollingIntervalConfig` | interface | 상태별 폴링 주기 4개 (types.ts 정의) |
| `nextPollDelayMinutes(state, cfg)` | function | 현재 WatchState 보고 다음 폴까지 몇 분인지 반환. 순수 함수 |
| `backoffMinutes(failures, cfg)` | function | 지수 백오프 헬퍼 — base × 2^(failures-1), 상한 적용 |
| `summarizeStates(state)` | function | 사이트별 SiteState.kind 카운트 — 디버깅/로깅용 |

### PollingIntervalConfig 필드 (기본값)

| 필드 | 단위 | 기본 | 의미 |
|---|---|---|---|
| `notYetOpenMinutes` | 분 | 30 | 미오픈/미관측 단계 폴링 주기 |
| `trackingMinutes` | 분 | 1440 | 정상 추적 단계 (24시간) |
| `scraperSuspectBaseMinutes` | 분 | 60 | 의심 상태 백오프 base (2배씩 증가) |
| `scraperSuspectMaxMinutes` | 분 | 720 | 의심 상태 백오프 상한 (12시간) |

### 우선순위 규칙

1. **어떤 사이트라도** `notYetOpen` 또는 `unknown` → `notYetOpenMinutes`
2. **모든 사이트가** `scraperSuspect` → 지수 백오프 (max failures 기준)
3. 그 외 → `trackingMinutes`

⚠ "일부만 깨진" 케이스는 `trackingMinutes` — 일부가 작동하는 한 정상 주기 유지.

## 변경 이력

- 2026-05-20 (v1): 초기 작성. 타입/필드/함수/디렉터리 정의.
- 2026-05-20 (v2): Orchestrator + 시간 처리 규약 추가.
- 2026-05-20 (v3): 적응형 스케줄러 (PollingIntervalConfig, nextPollDelayMinutes, backoffMinutes) 추가. SearchSpec에 어린이 미지원 TODO 명시.
- 2026-05-20 (v4): `priceDrop` 이벤트와 `AlertConfig.priceThresholdJpy` 제거. 아와오도리 시나리오에서 무가치한 기능으로 판단 (예약 오픈 후 매진까지 가격 변동 거의 없음).
- 2026-05-20 (v5): 센티넬 계산 방식을 "real에서 N일 전" → **"오늘로부터 N일 뒤"**로 변경. real이 축제일이면 1년 전 센티넬도 매진 상태라 0건이 "정상인지 깨짐인지" 구분 불가했음. `sentinelOffsetDays` → `sentinelDaysFromNow` 리네임, 기본값 365 → 45.
