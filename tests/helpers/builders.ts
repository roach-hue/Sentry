import { ALL_SITES } from '~/core/types';
import type {
  FetchError,
  FetchResult,
  Listing,
  PollRound,
  SearchSpec,
  SiteId,
  SitePollResult,
} from '~/core/types';
import { normalizeHotelName } from '~/core/normalize';

export const DEFAULT_SPEC: SearchSpec = {
  destination: 'Tokushima',
  checkIn: '2027-08-12',
  checkOut: '2027-08-15',
  adults: 2,
  rooms: 1,
};

export const DEFAULT_SENTINEL_SPEC: SearchSpec = {
  ...DEFAULT_SPEC,
  checkIn: '2026-08-12',
  checkOut: '2026-08-15',
};

let listingCounter = 0;
export function resetCounter(): void {
  listingCounter = 0;
}

export function listing(partial: Partial<Listing> = {}): Listing {
  listingCounter += 1;
  const name = partial.name ?? `Tokushima Test Hotel ${listingCounter}`;
  return {
    id: partial.id ?? `test-${listingCounter}`,
    name,
    normalizedName: partial.normalizedName ?? normalizeHotelName(name),
    pricePerNightJpy: partial.pricePerNightJpy ?? 15000,
    totalPriceJpy: partial.totalPriceJpy ?? 45000,
    roomsRemaining: partial.roomsRemaining ?? null,
    breakfastIncluded: partial.breakfastIncluded ?? null,
    freeCancellation: partial.freeCancellation ?? null,
    url: partial.url ?? null,
  };
}

interface FetchResultInput {
  site: SiteId;
  listings?: Listing[];
  error?: FetchError | null;
  spec?: SearchSpec;
  fetchedAt?: string;
}

export function fetchResult(input: FetchResultInput): FetchResult {
  return {
    site: input.site,
    spec: input.spec ?? DEFAULT_SPEC,
    fetchedAt: input.fetchedAt ?? '2026-05-20T00:00:00Z',
    listings: input.listings ?? [],
    error: input.error ?? null,
  };
}

interface RoundInput {
  perSite: Partial<Record<SiteId, Partial<SitePollResult>>>;
  startedAt?: string;
  completedAt?: string;
}

export function pollRound(input: RoundInput): PollRound {
  const perSite = {} as Record<SiteId, SitePollResult>;
  for (const site of ALL_SITES) {
    const provided = input.perSite[site];
    perSite[site] = {
      real: provided?.real ?? fetchResult({ site }),
      sentinel:
        provided?.sentinel ??
        fetchResult({ site, spec: DEFAULT_SENTINEL_SPEC, listings: [listing()] }),
    };
  }
  return {
    startedAt: input.startedAt ?? '2026-05-20T00:00:00Z',
    completedAt: input.completedAt ?? '2026-05-20T00:01:00Z',
    perSite,
  };
}
