import type {
  AlertConfig,
  Listing,
  NotificationEvent,
  PollRound,
  SiteId,
  SitePollResult,
  SiteState,
  WatchState,
} from './types';

/**
 * 순수 함수: 이전 WatchState와 새 PollRound를 받아, 다음 WatchState와
 * 발사할 NotificationEvent 배열을 계산해서 반환한다.
 *
 * "순수"의 의미: I/O 없음, Date.now() 호출 없음 — 시간 관련 값은 모두 입력
 * round에서 읽는다. 그래서 픽스처 입력으로 결정 로직 전체를 단위 테스트할
 * 수 있고 출력이 결정적이다.
 */
export function step(
  prev: WatchState,
  round: PollRound,
  alert: AlertConfig,
  targetName = '',
): { next: WatchState; events: NotificationEvent[] } {
  const events: NotificationEvent[] = [];
  const nextSites = { ...prev.sites };
  const nextListings = { ...prev.lastListings };

  for (const siteId of Object.keys(round.perSite) as SiteId[]) {
    const result = round.perSite[siteId];
    if (!result) continue;
    const prevState = prev.sites[siteId] ?? { kind: 'unknown' };
    const prevSiteListings = prev.lastListings[siteId] ?? {};

    const decision = stepSite(
      siteId,
      prevState,
      prevSiteListings,
      result,
      alert,
      round.completedAt,
      targetName,
    );
    nextSites[siteId] = decision.nextState;
    nextListings[siteId] = decision.nextListings;
    events.push(...decision.events);
  }

  return {
    next: {
      sites: nextSites,
      lastRound: round,
      lastListings: nextListings,
    },
    events,
  };
}

interface SiteDecision {
  nextState: SiteState;
  nextListings: Record<string, Listing>;
  events: NotificationEvent[];
}

function stepSite(
  siteId: SiteId,
  prevState: SiteState,
  prevListings: Record<string, Listing>,
  result: SitePollResult,
  alert: AlertConfig,
  now: string,
  targetName: string,
): SiteDecision {
  const real = result.real;
  const sentinel = result.sentinel;

  // fetcher 자체가 명시적으로 던진 에러 — scraperSuspect로 처리한다.
  if (real.error !== null) {
    return toScraperSuspect(siteId, prevState, prevListings, now, targetName);
  }

  // 핵심 분기: "결과 0건이 무슨 의미인가?"
  if (real.listings.length === 0) {
    // 센티넬도 0건(또는 에러)이면 스크래퍼 의심 — 1년 떨어진 두 날짜가
    // 동시에 0건인 건 정상 사이트에서는 거의 일어나지 않는다.
    if (sentinel.error !== null || sentinel.listings.length === 0) {
      return toScraperSuspect(siteId, prevState, prevListings, now, targetName);
    }
    // 센티넬엔 결과 있고 real만 0건 → 단순히 아직 예약 미오픈.
    if (prevState.kind === 'notYetOpen') {
      return { nextState: prevState, nextListings: prevListings, events: [] };
    }
    return {
      nextState: { kind: 'notYetOpen', since: now },
      nextListings: prevListings,
      events: [],
    };
  }

  // real에 결과가 있는 경우.
  const events: NotificationEvent[] = [];
  const wasNotOpen =
    prevState.kind === 'notYetOpen' ||
    prevState.kind === 'unknown' ||
    prevState.kind === 'scraperSuspect';

  // 헤드라인 이벤트 — 직전에 "닫혀있다"고 확정된 상태에서 방금 열렸을 때만 발사.
  // 진짜 notYetOpen → 열림 전이에서만 동작한다. "unknown"이나 "scraperSuspect"
  // → 열림 전이에는 이 알림이 발사되지 않는다 (닫혀있던 게 확인된 적이 없으므로).
  if (prevState.kind === 'notYetOpen') {
    events.push({
      kind: 'bookingOpened',
      site: siteId,
      targetName,
      detectedAt: now,
      sampleListings: real.listings.slice(0, 5),
      urgency: 'critical',
    });
  }

  // 잔여 객실 부족 감지 — "부족" 구간으로 새로 진입할 때만 발사.
  if (alert.lowInventoryAt !== null) {
    for (const listing of real.listings) {
      if (
        listing.roomsRemaining !== null &&
        listing.roomsRemaining <= alert.lowInventoryAt
      ) {
        const prior = prevListings[listing.normalizedName];
        const wasAbove =
          !prior ||
          prior.roomsRemaining === null ||
          prior.roomsRemaining > alert.lowInventoryAt;
        if (wasAbove) {
          events.push({
            kind: 'lowInventory',
            site: siteId,
            targetName,
            hotelName: listing.name,
            roomsRemaining: listing.roomsRemaining,
            urgency: 'high',
          });
        }
      }
    }
  }

  const nextListings: Record<string, Listing> = {};
  for (const l of real.listings) nextListings[l.normalizedName] = l;

  if (wasNotOpen) {
    return {
      nextState: {
        kind: 'justOpened',
        detectedAt: now,
        openingListings: real.listings.slice(0, 10),
      },
      nextListings,
      events,
    };
  }

  const newListings = real.listings.filter(
    (l) => !(l.normalizedName in prevListings),
  );
  if (newListings.length > 0) {
    events.push({
      kind: 'newHotelFound',
      site: siteId,
      targetName,
      newListings: newListings.slice(0, 5),
      urgency: 'high',
    });
  }

  return {
    nextState: { kind: 'tracking', since: now, lastSeenCount: real.listings.length },
    nextListings,
    events,
  };
}

function toScraperSuspect(
  siteId: SiteId,
  prevState: SiteState,
  prevListings: Record<string, Listing>,
  now: string,
  targetName: string,
): SiteDecision {
  const consecutiveFailures =
    prevState.kind === 'scraperSuspect' ? prevState.consecutiveFailures + 1 : 1;
  const events: NotificationEvent[] = [];
  if (consecutiveFailures === 1 || consecutiveFailures === 3) {
    events.push({
      kind: 'scraperSuspect',
      site: siteId,
      targetName,
      consecutiveFailures,
      urgency: 'medium',
    });
  }
  return {
    nextState: { kind: 'scraperSuspect', since: now, consecutiveFailures },
    nextListings: prevListings,
    events,
  };
}
