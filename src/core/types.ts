/**
 * 핵심 도메인 타입 — fetcher → parser → state machine → notifier 로 흐르는
 * 데이터의 단일 진실 공급원(SSOT).
 *
 * 전부 plain data (클래스 없음). 그래야 chrome.storage.local과 테스트 픽스처에
 * 매끄럽게 직렬화된다.
 */

export type SiteId = 'agoda' | 'trip';

export const ALL_SITES: readonly SiteId[] = ['agoda', 'trip'] as const;

export interface SearchSpec {
  /** 자유 텍스트 목적지 라벨 (예: "Tokushima"). fetcher가 사이트별 지역 코드로 매핑. */
  destination: string;
  /** ISO 날짜 YYYY-MM-DD */
  checkIn: string;
  /** ISO 날짜 YYYY-MM-DD */
  checkOut: string;
  adults: number;
  rooms: number;
  // TODO(deferred): children: number, childrenAges: number[].
  // 의도적으로 미지원. 어른 전용 흐름이 실 사이트에서 검증되면 그때 추가.
  // 이유: 사이트별 어린이 URL 파라미터 키/나이 컷오프가 달라서 recon으로
  // 실제 검색 URL을 보고 추가하는 게 정확함. 잊지 말 것 — HANDOFF.md 참조.
}

/** 한 사이트가 어떤 시점에 반환한 호텔 매물 1건. */
export interface Listing {
  /** 중복 제거용 식별자 (사이트가 hotel id를 주면 그걸, 없으면 슬러그화한 이름). */
  id: string;
  /** 사이트에 표시된 원문 호텔 이름. */
  name: string;
  /** 사이트간 매칭에 사용하는 정규화 이름. 소문자, ASCII 폴드, 공백 단일화 처리. */
  normalizedName: string;
  /** 박당 가격 (JPY). 파싱 시 항상 JPY로 정규화한다. 사이트가 총액만 노출하면 null. */
  pricePerNightJpy: number | null;
  /** 전체 숙박 총액 (JPY). 사이트가 가격을 노출하지 않으면 null. */
  totalPriceJpy: number | null;
  /** 잔여 객실 수 (사이트가 노출한 경우). 모르면 null. */
  roomsRemaining: number | null;
  /** 조식 포함 여부. 사이트가 명시 안 하면 null. */
  breakfastIncluded: boolean | null;
  /** 무료 취소 가능 여부. 사이트가 명시 안 하면 null. */
  freeCancellation: boolean | null;
  /** 호텔 상세 페이지로의 딥링크 (선택적). */
  url: string | null;
}

/** 한 쿼리에 대한 fetcher의 응답 (real 검색이든 sentinel이든). */
export interface FetchResult {
  site: SiteId;
  spec: SearchSpec;
  fetchedAt: string;
  listings: Listing[];
  /**
   * fetcher가 명시적인 실패 모드(네트워크 에러, 캡차, "해당 매물 없음" 페이지 등)에
   * 부딪힌 경우 여기에 기록. "정상 응답인데 결과가 0건"과는 구분된다 —
   * 후자는 그냥 listings가 빈 배열이고 error는 null이다.
   */
  error: FetchError | null;
}

export type FetchError =
  | { kind: 'network'; message: string }
  | { kind: 'blocked'; message: string }
  | { kind: 'parse'; message: string }
  | { kind: 'rateLimit'; message: string }
  | { kind: 'unknown'; message: string };

/**
 * 전체 사이트를 한 바퀴 돈 폴링 라운드: 사이트마다 real 쿼리 1번 + sentinel 쿼리 1번.
 * sentinel은 동일한 SearchSpec을 1년 뒤로 시프트한 것으로, "이 날짜에 이 사이트가
 * 매물을 안 풀어놓은 것"과 "스크래퍼가 깨진 것"을 구분하는 데 쓴다.
 */
export interface PollRound {
  startedAt: string;
  completedAt: string;
  perSite: Record<SiteId, SitePollResult>;
}

export interface SitePollResult {
  real: FetchResult;
  sentinel: FetchResult;
}

/** 사이트별 생애주기 상태. 알림 결정의 입력이 된다. */
export type SiteState =
  | { kind: 'unknown' }
  | { kind: 'notYetOpen'; since: string }
  | { kind: 'justOpened'; detectedAt: string; openingListings: Listing[] }
  | { kind: 'tracking'; since: string; lastSeenCount: number }
  | { kind: 'soldOut'; since: string }
  | { kind: 'scraperSuspect'; since: string; consecutiveFailures: number };

/** 폴링 라운드 전반에 걸쳐 영속화되는 상태. */
export interface WatchState {
  /** 사이트별 상태머신 상태. */
  sites: Record<SiteId, SiteState>;
  /** 마지막 폴 라운드 (diff 용도로 저장). */
  lastRound: PollRound | null;
  /** 직전 "tracking" 라운드에서 본 매물들. 사이트 → normalizedName 키로 인덱싱. */
  lastListings: Record<SiteId, Record<string, Listing>>;
}

/** 발사 준비된 알림 1건 — state machine이 생성하고 Notifier가 소비. */
export type NotificationEvent =
  | {
      kind: 'bookingOpened';
      site: SiteId;
      targetName: string;
      detectedAt: string;
      sampleListings: Listing[];
      urgency: 'critical';
    }
  | {
      kind: 'lowInventory';
      site: SiteId;
      targetName: string;
      hotelName: string;
      roomsRemaining: number;
      urgency: 'high';
    }
  | {
      kind: 'newHotelFound';
      site: SiteId;
      targetName: string;
      newListings: Listing[];
      urgency: 'high';
    }
  | {
      kind: 'scraperSuspect';
      site: SiteId;
      targetName: string;
      consecutiveFailures: number;
      urgency: 'medium';
    }
  | {
      kind: 'soldOut';
      site: SiteId;
      targetName: string;
      urgency: 'low';
    };

/** 사용자가 설정하는 알림 임계값. */
export interface AlertConfig {
  /** roomsRemaining이 이 값 이하면 lowInventory 알림. null이면 비활성. */
  lowInventoryAt: number | null;
  /** 같은 알림을 매 폴마다 재발사하지 않게 하는 쿨다운. 단위: 초. */
  alertCooldownSec: number;
}

export interface WatchTarget {
  id: string;
  name: string;
  enabled: boolean;
  spec: SearchSpec;
}

export interface Config {
  /** 글로벌 감시 ON/OFF. false면 모든 감시 중단. */
  enabled: boolean;
  /** 개별 감시 대상. 각각 ON/OFF 가능. */
  targets: WatchTarget[];
  /**
   * 센티넬 체크인 날짜를 "오늘로부터 며칠 뒤"로 정한다.
   *
   * 이전 설계는 real에서 1년 전으로 시프트했는데, real이 특수한 날(예: 아와오도리 기간)이면
   * 1년 전도 같은 특수일이라 이미 매진돼 0건이 나옴 → 정상인지 깨짐인지 구분 불가.
   *
   * 그래서 "오늘 + 45일" 같은 임의의 평범한 날짜를 쓴다. 이런 날짜는 거의 항상 매물이 있어서
   * 스크래퍼 동작 여부를 안정적으로 검증한다.
   *
   * stay duration (checkOut - checkIn)은 real과 동일하게 유지.
   */
  sentinelDaysFromNow: number;
  alert: AlertConfig;
  /** 어느 알림 채널에 발사할지. */
  channels: NotificationChannelConfig;
  /** 상태별 적응형 폴링 간격. */
  polling: PollingIntervalConfig;
}

/**
 * 상태별 폴링 주기. 각 폴 라운드가 끝날 때마다 WatchState를 보고 다음
 * 알람까지 몇 분을 기다릴지 결정한다. nextPollDelayMinutes() 참고.
 *
 * 우선순위:
 *   1) 어느 사이트라도 notYetOpen / unknown → 빠른 폴링(notYetOpenMinutes).
 *      예약 오픈 감지가 핵심 가치라서 이 단계만 자주 폴링.
 *   2) 모든 사이트가 scraperSuspect → 지수 백오프
 *      (scraperSuspectBaseMinutes × 2^(maxFailures-1), 상한 scraperSuspectMaxMinutes).
 *      깨진 엔드포인트를 두드릴 이유가 없음.
 *   3) 그 외 (tracking / justOpened / soldOut 혼합) → trackingMinutes.
 *      매물이 잡힌 뒤에는 가격 변동이 시간 단위로 미세하므로 매일 1회면 충분.
 */
export interface PollingIntervalConfig {
  /** 미오픈/미관측 단계의 폴링 주기 (분). 기본 30. */
  notYetOpenMinutes: number;
  /** 정상 추적 단계의 폴링 주기 (분). 기본 1440 (24시간). */
  trackingMinutes: number;
  /** 스크래퍼 의심 상태의 기본 백오프 (분). 실패 누적될수록 2배씩 증가. 기본 60. */
  scraperSuspectBaseMinutes: number;
  /** 스크래퍼 의심 백오프 상한 (분). 기본 720 (12시간). */
  scraperSuspectMaxMinutes: number;
}

export interface NotificationChannelConfig {
  chromeNotification: boolean;
  telegram: {
    enabled: boolean;
    botToken: string | null;
    chatId: string | null;
  };
}
