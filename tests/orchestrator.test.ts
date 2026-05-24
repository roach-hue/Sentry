import { describe, it, expect, beforeEach } from 'vitest';
import { makeSentinelSpec, runPollRound } from '~/orchestrator/orchestrator';
import { MockFetcher } from '~/fetchers/mock';
import { MockNotifier } from '~/notifiers/mock';
import { InMemoryStateStore } from '~/storage/state-store';
import { ALL_SITES } from '~/core/types';
import type { Config, SearchSpec, SiteId, WatchTarget } from '~/core/types';
import {
  DEFAULT_SENTINEL_SPEC,
  DEFAULT_SPEC,
  fetchResult,
  listing,
  resetCounter,
} from './helpers/builders';

const DEFAULT_TARGET: WatchTarget = {
  id: 'test',
  name: '테스트',
  enabled: true,
  spec: DEFAULT_SPEC,
};

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    enabled: true,
    targets: [DEFAULT_TARGET],
    sentinelDaysFromNow: 45,
    alert: {
      lowInventoryAt: 2,
      alertCooldownSec: 0,
    },
    channels: {
      chromeNotification: true,
      telegram: { enabled: false, botToken: null, chatId: null },
    },
    polling: {
      notYetOpenMinutes: 30,
      trackingMinutes: 1440,
      scraperSuspectBaseMinutes: 60,
      scraperSuspectMaxMinutes: 720,
    },
    ...overrides,
  };
}

function makeFetchers(): Record<SiteId, MockFetcher> {
  return {
    agoda: new MockFetcher('agoda'),
    trip: new MockFetcher('trip'),
  };
}

function fixedClock(...isoStamps: string[]): () => string {
  const queue = [...isoStamps];
  return () => {
    const next = queue.shift();
    if (!next) throw new Error('fixedClock exhausted');
    return next;
  };
}

beforeEach(() => resetCounter());

describe('makeSentinelSpec', () => {
  it('센티넬 checkIn = 오늘 + daysFromNow, 나머지는 real spec 그대로', () => {
    const spec: SearchSpec = {
      destination: 'Tokushima',
      checkIn: '2027-08-12',
      checkOut: '2027-08-15',
      adults: 2,
      rooms: 1,
    };
    const sentinel = makeSentinelSpec(spec, 45, '2026-05-20T00:00:00Z');
    expect(sentinel.checkIn).toBe('2026-07-04'); // 2026-05-20 + 45일
    expect(sentinel.destination).toBe('Tokushima');
    expect(sentinel.adults).toBe(2);
    expect(sentinel.rooms).toBe(1);
  });

  it('stay duration (체크아웃 - 체크인)을 real과 동일하게 유지 — 3박', () => {
    const spec: SearchSpec = {
      destination: 'X',
      checkIn: '2027-08-12',
      checkOut: '2027-08-15', // 3박
      adults: 1,
      rooms: 1,
    };
    const sentinel = makeSentinelSpec(spec, 45, '2026-05-20T00:00:00Z');
    expect(sentinel.checkIn).toBe('2026-07-04');
    expect(sentinel.checkOut).toBe('2026-07-07'); // 3일 뒤
  });

  it('월/연 경계 넘나드는 시프트도 정확히 계산', () => {
    const spec: SearchSpec = {
      destination: 'X',
      checkIn: '2027-08-12',
      checkOut: '2027-08-14', // 2박
      adults: 1,
      rooms: 1,
    };
    // 2026-11-20 + 60일 = 2027-01-19
    const sentinel = makeSentinelSpec(spec, 60, '2026-11-20T00:00:00Z');
    expect(sentinel.checkIn).toBe('2027-01-19');
    expect(sentinel.checkOut).toBe('2027-01-21');
  });

  it('nowIso가 datetime이든 date-only든 동일 결과', () => {
    const spec: SearchSpec = {
      destination: 'X',
      checkIn: '2027-08-12',
      checkOut: '2027-08-14',
      adults: 1,
      rooms: 1,
    };
    const a = makeSentinelSpec(spec, 45, '2026-05-20T15:30:00Z');
    const b = makeSentinelSpec(spec, 45, '2026-05-20');
    expect(a.checkIn).toBe(b.checkIn);
    expect(a.checkOut).toBe(b.checkOut);
  });
});

describe('runPollRound — end to end with mocks', () => {
  it('first round, all sites in scraperSuspect (real & sentinel both empty) → 2 scraperSuspect events', async () => {
    const fetchers = makeFetchers();
    for (const site of ALL_SITES) {
      // 첫 fetch = real (빈 결과). 두 번째 fetch = sentinel (빈 결과).
      fetchers[site].enqueue(fetchResult({ site, listings: [] }));
      fetchers[site].enqueue(
        fetchResult({ site, spec: DEFAULT_SENTINEL_SPEC, listings: [] }),
      );
    }
    const notifier = new MockNotifier();
    const store = new InMemoryStateStore(ALL_SITES);
    const outcome = await runPollRound(makeConfig(), DEFAULT_TARGET, {
      fetchers,
      notifiers: [notifier],
      store,
      now: fixedClock('2026-05-20T00:00:00Z', '2026-05-20T00:01:00Z'),
    });

    expect(outcome.events.filter((e) => e.kind === 'scraperSuspect')).toHaveLength(2);
    expect(notifier.sent.filter((e) => e.kind === 'scraperSuspect')).toHaveLength(2);
  });

  it('two-round narrative: notYetOpen → bookingOpened (the killer feature)', async () => {
    const fetchers = makeFetchers();
    const notifier = new MockNotifier();
    const store = new InMemoryStateStore(ALL_SITES);

    // 라운드 1 — agoda는 real 비어있고 sentinel은 결과 있음.
    // trip은 무관 — 0/0 부여 (scraperSuspect 되지만 문제 없음).
    fetchers.agoda.enqueue(fetchResult({ site: 'agoda', listings: [] }));
    fetchers.agoda.enqueue(
      fetchResult({
        site: 'agoda',
        spec: DEFAULT_SENTINEL_SPEC,
        listings: [listing()],
      }),
    );
    fetchers.trip.enqueue(fetchResult({ site: 'trip', listings: [] }));
    fetchers.trip.enqueue(
      fetchResult({ site: 'trip', spec: DEFAULT_SENTINEL_SPEC, listings: [] }),
    );

    await runPollRound(makeConfig(), DEFAULT_TARGET, {
      fetchers,
      notifiers: [notifier],
      store,
      now: fixedClock('2026-05-20T00:00:00Z', '2026-05-20T00:01:00Z'),
    });
    const stateAfter1 = await store.load();
    expect(stateAfter1.sites.agoda.kind).toBe('notYetOpen');
    expect(notifier.sent.find((e) => e.kind === 'bookingOpened')).toBeUndefined();

    notifier.reset();

    // 라운드 2 — agoda에서 예약 오픈.
    fetchers.agoda.enqueue(
      fetchResult({
        site: 'agoda',
        listings: [
          listing({ name: 'Tokushima Grand', totalPriceJpy: 80000, roomsRemaining: 4 }),
        ],
      }),
    );
    fetchers.agoda.enqueue(
      fetchResult({
        site: 'agoda',
        spec: DEFAULT_SENTINEL_SPEC,
        listings: [listing()],
      }),
    );
    fetchers.trip.enqueue(fetchResult({ site: 'trip', listings: [] }));
    fetchers.trip.enqueue(
      fetchResult({ site: 'trip', spec: DEFAULT_SENTINEL_SPEC, listings: [] }),
    );

    const outcome2 = await runPollRound(makeConfig(), DEFAULT_TARGET, {
      fetchers,
      notifiers: [notifier],
      store,
      now: fixedClock('2026-08-15T12:00:00Z', '2026-08-15T12:01:00Z'),
    });
    const stateAfter2 = await store.load();
    expect(stateAfter2.sites.agoda.kind).toBe('justOpened');
    const opened = outcome2.events.find((e) => e.kind === 'bookingOpened' && e.site === 'agoda');
    expect(opened).toBeDefined();
    expect(opened?.urgency).toBe('critical');
    expect(notifier.sent.find((e) => e.kind === 'bookingOpened' && e.site === 'agoda')).toBeDefined();
  });

  it('multiple notifiers all receive each event', async () => {
    const fetchers = makeFetchers();
    for (const site of ALL_SITES) {
      fetchers[site].enqueue(fetchResult({ site, listings: [] }));
      fetchers[site].enqueue(
        fetchResult({ site, spec: DEFAULT_SENTINEL_SPEC, listings: [] }),
      );
    }
    const a = new MockNotifier();
    const b = new MockNotifier();
    const store = new InMemoryStateStore(ALL_SITES);
    await runPollRound(makeConfig(), DEFAULT_TARGET, {
      fetchers,
      notifiers: [a, b],
      store,
      now: fixedClock('2026-05-20T00:00:00Z', '2026-05-20T00:01:00Z'),
    });
    expect(a.sent.length).toBeGreaterThan(0);
    expect(b.sent.length).toBe(a.sent.length);
  });

  it('notifier failure is recorded but does not throw', async () => {
    const fetchers = makeFetchers();
    for (const site of ALL_SITES) {
      fetchers[site].enqueue(fetchResult({ site, listings: [] }));
      fetchers[site].enqueue(
        fetchResult({ site, spec: DEFAULT_SENTINEL_SPEC, listings: [] }),
      );
    }
    const flaky = new MockNotifier();
    flaky.shouldFail = true;
    const store = new InMemoryStateStore(ALL_SITES);
    const outcome = await runPollRound(makeConfig(), DEFAULT_TARGET, {
      fetchers,
      notifiers: [flaky],
      store,
      now: fixedClock('2026-05-20T00:00:00Z', '2026-05-20T00:01:00Z'),
    });
    expect(outcome.notifierResults.some((r) => !r.ok)).toBe(true);
  });

  it('throws if a site has no fetcher configured', async () => {
    const incomplete: Record<SiteId, MockFetcher> = {
      agoda: new MockFetcher('agoda'),
    } as Record<SiteId, MockFetcher>;
    incomplete.agoda.enqueue(fetchResult({ site: 'agoda', listings: [] }));
    incomplete.agoda.enqueue(
      fetchResult({ site: 'agoda', spec: DEFAULT_SENTINEL_SPEC, listings: [] }),
    );
    const store = new InMemoryStateStore(ALL_SITES);

    await expect(
      runPollRound(makeConfig(), DEFAULT_TARGET, {
        fetchers: incomplete,
        notifiers: [],
        store,
        now: fixedClock('2026-05-20T00:00:00Z', '2026-05-20T00:01:00Z'),
      }),
    ).rejects.toThrow(/no fetcher configured/);
  });
});

describe('runPollRound — propagates fetcher errors as FetchResult', () => {
  it('blocked error → site goes to scraperSuspect regardless of sentinel', async () => {
    const fetchers = makeFetchers();
    fetchers.agoda.enqueue(
      fetchResult({
        site: 'agoda',
        error: { kind: 'blocked', message: 'cloudflare' },
      }),
    );
    fetchers.agoda.enqueue(
      fetchResult({
        site: 'agoda',
        spec: DEFAULT_SENTINEL_SPEC,
        listings: [listing()],
      }),
    );
    fetchers.trip.enqueue(fetchResult({ site: 'trip', listings: [] }));
    fetchers.trip.enqueue(
      fetchResult({ site: 'trip', spec: DEFAULT_SENTINEL_SPEC, listings: [] }),
    );

    const store = new InMemoryStateStore(ALL_SITES);
    await runPollRound(makeConfig(), DEFAULT_TARGET, {
      fetchers,
      notifiers: [],
      store,
      now: fixedClock('2026-05-20T00:00:00Z', '2026-05-20T00:01:00Z'),
    });
    const state = await store.load();
    expect(state.sites.agoda.kind).toBe('scraperSuspect');
  });
});

