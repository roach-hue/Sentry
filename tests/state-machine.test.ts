import { describe, it, expect, beforeEach } from 'vitest';
import { step } from '~/core/state-machine';
import type { AlertConfig, WatchState } from '~/core/types';
import { emptyWatchState } from '~/storage/state-store';
import { ALL_SITES } from '~/core/types';
import {
  DEFAULT_SENTINEL_SPEC,
  fetchResult,
  listing,
  pollRound,
  resetCounter,
} from './helpers/builders';

const baseAlert: AlertConfig = {
  lowInventoryAt: 2,
  alertCooldownSec: 0,
};

function freshState(): WatchState {
  return emptyWatchState(ALL_SITES);
}

beforeEach(() => {
  resetCounter();
});

describe('state machine — "not yet open" disambiguation', () => {
  it('first-ever poll where real is empty but sentinel has data → notYetOpen, no alert', () => {
    const prev = freshState();
    const round = pollRound({
      perSite: {
        agoda: {
          real: fetchResult({ site: 'agoda', listings: [] }),
          sentinel: fetchResult({
            site: 'agoda',
            spec: DEFAULT_SENTINEL_SPEC,
            listings: [listing()],
          }),
        },
      },
    });

    const { next, events } = step(prev, round, baseAlert);

    expect(next.sites.agoda).toEqual({
      kind: 'notYetOpen',
      since: round.completedAt,
    });
    expect(events.filter((e) => e.site === 'agoda')).toEqual([]);
  });

  it('notYetOpen → still empty in next poll → stays notYetOpen, no spam', () => {
    const prev = freshState();
    prev.sites.agoda = { kind: 'notYetOpen', since: '2026-05-01T00:00:00Z' };
    const round = pollRound({
      perSite: {
        agoda: {
          real: fetchResult({ site: 'agoda', listings: [] }),
          sentinel: fetchResult({
            site: 'agoda',
            spec: DEFAULT_SENTINEL_SPEC,
            listings: [listing()],
          }),
        },
      },
    });

    const { next, events } = step(prev, round, baseAlert);

    expect(next.sites.agoda).toEqual({
      kind: 'notYetOpen',
      since: '2026-05-01T00:00:00Z', // unchanged
    });
    expect(events.filter((e) => e.site === 'agoda')).toEqual([]);
  });

  it('notYetOpen → real now has listings → JUST_OPENED + critical bookingOpened event', () => {
    const prev = freshState();
    prev.sites.agoda = { kind: 'notYetOpen', since: '2026-05-01T00:00:00Z' };
    const openingListing = listing({ name: 'Tokushima Grand', totalPriceJpy: 80000 });
    const round = pollRound({
      perSite: {
        agoda: {
          real: fetchResult({ site: 'agoda', listings: [openingListing] }),
        },
      },
    });

    const { next, events } = step(prev, round, baseAlert);

    expect(next.sites.agoda.kind).toBe('justOpened');
    const opened = events.find(
      (e) => e.kind === 'bookingOpened' && e.site === 'agoda',
    );
    expect(opened).toBeDefined();
    expect(opened?.urgency).toBe('critical');
  });
});

describe('state machine — scraper suspect detection', () => {
  it('real empty + sentinel empty → scraperSuspect, alert fires on first failure', () => {
    const prev = freshState();
    const round = pollRound({
      perSite: {
        agoda: {
          real: fetchResult({ site: 'agoda', listings: [] }),
          sentinel: fetchResult({
            site: 'agoda',
            spec: DEFAULT_SENTINEL_SPEC,
            listings: [],
          }),
        },
      },
    });

    const { next, events } = step(prev, round, baseAlert);

    expect(next.sites.agoda).toMatchObject({
      kind: 'scraperSuspect',
      consecutiveFailures: 1,
    });
    expect(
      events.find((e) => e.kind === 'scraperSuspect' && e.site === 'agoda'),
    ).toBeDefined();
  });

  it('consecutive scraper failures: alert at 1 and 3, silent at 2 and 4', () => {
    let state = freshState();
    const buildRound = () =>
      pollRound({
        perSite: {
          agoda: {
            real: fetchResult({ site: 'agoda', listings: [] }),
            sentinel: fetchResult({
              site: 'agoda',
              spec: DEFAULT_SENTINEL_SPEC,
              listings: [],
            }),
          },
        },
      });

    // 라운드 1 — 알림 발사.
    let result = step(state, buildRound(), baseAlert);
    state = result.next;
    expect(
      result.events.filter((e) => e.kind === 'scraperSuspect' && e.site === 'agoda'),
    ).toHaveLength(1);

    // 라운드 2 — 무음.
    result = step(state, buildRound(), baseAlert);
    state = result.next;
    expect(
      result.events.filter((e) => e.kind === 'scraperSuspect' && e.site === 'agoda'),
    ).toHaveLength(0);

    // 라운드 3 — 다시 알림 발사.
    result = step(state, buildRound(), baseAlert);
    state = result.next;
    expect(
      result.events.filter((e) => e.kind === 'scraperSuspect' && e.site === 'agoda'),
    ).toHaveLength(1);

    // 라운드 4 — 무음 (스팸 방지).
    result = step(state, buildRound(), baseAlert);
    state = result.next;
    expect(
      result.events.filter((e) => e.kind === 'scraperSuspect' && e.site === 'agoda'),
    ).toHaveLength(0);

    expect(state.sites.agoda).toMatchObject({
      kind: 'scraperSuspect',
      consecutiveFailures: 4,
    });
  });

  it('fetcher error → scraperSuspect regardless of sentinel', () => {
    const prev = freshState();
    const round = pollRound({
      perSite: {
        agoda: {
          real: fetchResult({
            site: 'agoda',
            error: { kind: 'blocked', message: 'cloudflare challenge' },
          }),
          sentinel: fetchResult({
            site: 'agoda',
            spec: DEFAULT_SENTINEL_SPEC,
            listings: [listing()],
          }),
        },
      },
    });

    const { next, events } = step(prev, round, baseAlert);
    expect(next.sites.agoda.kind).toBe('scraperSuspect');
    expect(
      events.find((e) => e.kind === 'scraperSuspect' && e.site === 'agoda'),
    ).toBeDefined();
  });
});

describe('state machine — low inventory detection', () => {
  it('rooms drop to threshold → lowInventory event', () => {
    const prev = freshState();
    const hotel = 'Sakura Ryokan';
    const fullStock = listing({ name: hotel, totalPriceJpy: 80000, roomsRemaining: 5 });
    prev.sites.trip = { kind: 'tracking', since: '2026-05-01T00:00:00Z', lastSeenCount: 1 };
    prev.lastListings.trip = { [fullStock.normalizedName]: fullStock };

    const lowStock = listing({ name: hotel, totalPriceJpy: 80000, roomsRemaining: 2 });
    const round = pollRound({
      perSite: {
        trip: { real: fetchResult({ site: 'trip', listings: [lowStock] }) },
      },
    });

    const { events } = step(prev, round, baseAlert);
    const lowEvent = events.find((e) => e.kind === 'lowInventory');
    expect(lowEvent).toMatchObject({
      kind: 'lowInventory',
      hotelName: hotel,
      roomsRemaining: 2,
    });
  });
});

describe('state machine — guard rails', () => {
  it('unknown → tracking does NOT fire bookingOpened (we never confirmed closed)', () => {
    const prev = freshState();
    const round = pollRound({
      perSite: {
        agoda: { real: fetchResult({ site: 'agoda', listings: [listing()] }) },
      },
    });

    const { events } = step(prev, round, baseAlert);
    expect(events.filter((e) => e.kind === 'bookingOpened')).toEqual([]);
  });

  it('processes both sites independently', () => {
    const prev = freshState();
    prev.sites.agoda = { kind: 'notYetOpen', since: '2026-05-01T00:00:00Z' };
    const round = pollRound({
      perSite: {
        agoda: {
          // 방금 오픈됨.
          real: fetchResult({ site: 'agoda', listings: [listing()] }),
        },
        trip: {
          // 스크래퍼 깨짐.
          real: fetchResult({ site: 'trip', listings: [] }),
          sentinel: fetchResult({
            site: 'trip',
            spec: DEFAULT_SENTINEL_SPEC,
            listings: [],
          }),
        },
      },
    });

    const { next, events } = step(prev, round, baseAlert);
    expect(next.sites.agoda.kind).toBe('justOpened');
    expect(next.sites.trip.kind).toBe('scraperSuspect');

    expect(events.find((e) => e.kind === 'bookingOpened' && e.site === 'agoda')).toBeDefined();
    expect(events.find((e) => e.kind === 'scraperSuspect' && e.site === 'trip')).toBeDefined();
  });
});
