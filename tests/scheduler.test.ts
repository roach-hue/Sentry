import { describe, it, expect } from 'vitest';
import {
  backoffMinutes,
  nextPollDelayMinutes,
  summarizeStates,
} from '~/core/scheduler';
import type {
  PollingIntervalConfig,
  SiteId,
  SiteState,
  WatchState,
} from '~/core/types';
import { ALL_SITES } from '~/core/types';

const CFG: PollingIntervalConfig = {
  notYetOpenMinutes: 30,
  trackingMinutes: 1440,
  scraperSuspectBaseMinutes: 60,
  scraperSuspectMaxMinutes: 720,
};

/** 사이트 3개의 상태를 한 번에 지정하는 헬퍼. */
function stateWith(per: Partial<Record<SiteId, SiteState>>): WatchState {
  const sites = {} as Record<SiteId, SiteState>;
  const lastListings = {} as Record<SiteId, Record<string, never>>;
  for (const s of ALL_SITES) {
    sites[s] = per[s] ?? { kind: 'unknown' };
    lastListings[s] = {};
  }
  return { sites, lastRound: null, lastListings };
}

describe('nextPollDelayMinutes — 빠른 폴링(우선순위 1)', () => {
  it('모든 사이트가 unknown → notYetOpenMinutes 반환', () => {
    const s = stateWith({});
    expect(nextPollDelayMinutes(s, CFG)).toBe(30);
  });

  it('모든 사이트가 notYetOpen → notYetOpenMinutes', () => {
    const s = stateWith({
      agoda: { kind: 'notYetOpen', since: '2026-05-20T00:00:00Z' },
      trip: { kind: 'notYetOpen', since: '2026-05-20T00:00:00Z' },
    });
    expect(nextPollDelayMinutes(s, CFG)).toBe(30);
  });

  it('한 사이트라도 notYetOpen이면 나머지가 tracking이어도 빠른 폴링이 이김', () => {
    const s = stateWith({
      agoda: { kind: 'notYetOpen', since: '2026-05-20T00:00:00Z' },
      trip: { kind: 'tracking', since: '2026-05-20T00:00:00Z', lastSeenCount: 5 },
    });
    expect(nextPollDelayMinutes(s, CFG)).toBe(30);
  });

  it('unknown 하나 + tracking 하나 → 여전히 빠른 폴링 (unknown은 notYetOpen 동급)', () => {
    const s = stateWith({
      trip: { kind: 'tracking', since: '2026-05-20T00:00:00Z', lastSeenCount: 3 },
    });
    // agoda는 default unknown
    expect(nextPollDelayMinutes(s, CFG)).toBe(30);
  });
});

describe('nextPollDelayMinutes — 정상 추적(우선순위 3)', () => {
  it('모든 사이트가 tracking → trackingMinutes', () => {
    const s = stateWith({
      agoda: { kind: 'tracking', since: '2026-05-20T00:00:00Z', lastSeenCount: 10 },
      trip: { kind: 'tracking', since: '2026-05-20T00:00:00Z', lastSeenCount: 10 },
    });
    expect(nextPollDelayMinutes(s, CFG)).toBe(1440);
  });

  it('justOpened + tracking 혼합 → trackingMinutes', () => {
    const s = stateWith({
      agoda: { kind: 'justOpened', detectedAt: '2026-08-15T00:00:00Z', openingListings: [] },
      trip: { kind: 'tracking', since: '2026-05-20T00:00:00Z', lastSeenCount: 3 },
    });
    expect(nextPollDelayMinutes(s, CFG)).toBe(1440);
  });

  it('soldOut 포함 혼합 → trackingMinutes', () => {
    const s = stateWith({
      agoda: { kind: 'soldOut', since: '2026-08-15T00:00:00Z' },
      trip: { kind: 'justOpened', detectedAt: '2026-08-15T00:00:00Z', openingListings: [] },
    });
    expect(nextPollDelayMinutes(s, CFG)).toBe(1440);
  });

  it('scraperSuspect 1개 + tracking 1개 → trackingMinutes (모두 의심 아님)', () => {
    const s = stateWith({
      agoda: { kind: 'scraperSuspect', since: '2026-05-20T00:00:00Z', consecutiveFailures: 5 },
      trip: { kind: 'tracking', since: '2026-05-20T00:00:00Z', lastSeenCount: 3 },
    });
    expect(nextPollDelayMinutes(s, CFG)).toBe(1440);
  });
});

describe('nextPollDelayMinutes — 스크래퍼 의심 백오프(우선순위 2)', () => {
  function allBroken(failuresPerSite: number[]): WatchState {
    const [a, t] = failuresPerSite;
    return stateWith({
      agoda: { kind: 'scraperSuspect', since: '2026-05-20T00:00:00Z', consecutiveFailures: a ?? 1 },
      trip: {
        kind: 'scraperSuspect',
        since: '2026-05-20T00:00:00Z',
        consecutiveFailures: t ?? 1,
      },
    });
  }

  it('모두 의심 + 최대 실패 1회 → base × 2^0 = 60', () => {
    expect(nextPollDelayMinutes(allBroken([1, 1]), CFG)).toBe(60);
  });

  it('최대 실패 2회 → base × 2 = 120', () => {
    expect(nextPollDelayMinutes(allBroken([2, 1]), CFG)).toBe(120);
  });

  it('최대 실패 4회 → base × 8 = 480', () => {
    expect(nextPollDelayMinutes(allBroken([4, 3]), CFG)).toBe(480);
  });

  it('최대 실패 5회 → base × 16 = 960이지만 상한 720에 걸림', () => {
    expect(nextPollDelayMinutes(allBroken([5, 1]), CFG)).toBe(720);
  });

  it('최대 실패 10회 → 여전히 상한 720', () => {
    expect(nextPollDelayMinutes(allBroken([10, 9]), CFG)).toBe(720);
  });
});

describe('backoffMinutes — 노출된 지수 백오프 함수', () => {
  it('failures=0 → exponent 0 → base', () => {
    expect(backoffMinutes(0, CFG)).toBe(60);
  });
  it('failures=1 → exponent 0 → base', () => {
    expect(backoffMinutes(1, CFG)).toBe(60);
  });
  it('failures=2 → exponent 1 → base × 2', () => {
    expect(backoffMinutes(2, CFG)).toBe(120);
  });
  it('failures=3 → exponent 2 → base × 4', () => {
    expect(backoffMinutes(3, CFG)).toBe(240);
  });
  it('상한 적용 — failures=20도 max를 넘지 않음', () => {
    expect(backoffMinutes(20, CFG)).toBe(720);
  });
});

describe('summarizeStates — 사이트 상태 분포', () => {
  it('각 종류별로 카운트한다', () => {
    const s = stateWith({
      agoda: { kind: 'tracking', since: '2026-05-20T00:00:00Z', lastSeenCount: 5 },
      trip: { kind: 'scraperSuspect', since: '2026-05-20T00:00:00Z', consecutiveFailures: 2 },
    });
    const summary = summarizeStates(s);
    expect(summary).toEqual({
      unknown: 0,
      notYetOpen: 0,
      justOpened: 0,
      tracking: 1,
      soldOut: 0,
      scraperSuspect: 1,
    });
  });
});
