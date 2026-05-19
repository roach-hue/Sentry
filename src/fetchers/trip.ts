import type { FetchResult, Listing, SearchSpec } from '~/core/types';
import { normalizeHotelName, daysBetweenIso } from '~/core/normalize';
import type { SiteFetcher } from './interface';

const API_URL = 'https://kr.trip.com/restapi/soa2/34951/fetchHotelList';
const TOKUSHIMA_CITY_ID = 1172;
const JAPAN_COUNTRY_ID = 78;

export class TripFetcher implements SiteFetcher {
  readonly site = 'trip' as const;

  async fetch(spec: SearchSpec): Promise<FetchResult> {
    const fetchedAt = new Date().toISOString();
    try {
      const body = buildRequestBody(spec);
      const response = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        return errorResult(spec, fetchedAt,
          response.status === 429
            ? { kind: 'rateLimit', message: `HTTP ${response.status}` }
            : { kind: 'network', message: `HTTP ${response.status}` },
        );
      }
      const json = await response.json();
      const hotelList = json?.data?.hotelList;
      if (!Array.isArray(hotelList)) {
        return errorResult(spec, fetchedAt, {
          kind: 'parse',
          message: `응답에 hotelList 배열 없음: ${JSON.stringify(json?.data ?? json).substring(0, 200)}`,
        });
      }
      const nights = Math.max(1, daysBetweenIso(spec.checkIn, spec.checkOut));
      const listings = hotelList
        .map((h: unknown) => hotelToListing(h, nights, spec))
        .filter((l): l is Listing => l !== null);
      return { site: 'trip', spec, fetchedAt, listings, error: null };
    } catch (e) {
      return errorResult(spec, fetchedAt, {
        kind: 'network',
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }
}

function toCompactDate(iso: string): string {
  return iso.replace(/-/g, '');
}

function buildRequestBody(spec: SearchSpec) {
  return {
    date: {
      dateType: 1,
      dateInfo: {
        checkInDate: toCompactDate(spec.checkIn),
        checkOutDate: toCompactDate(spec.checkOut),
      },
    },
    destination: {
      type: 1,
      geo: { cityId: TOKUSHIMA_CITY_ID, countryId: JAPAN_COUNTRY_ID },
      keyword: { word: 'Tokushima City' },
    },
    filters: [
      { type: '19', value: String(TOKUSHIMA_CITY_ID), filterId: `19|${TOKUSHIMA_CITY_ID}` },
      { type: '17', value: '1', filterId: '17|1' },
      { type: '80', value: '2', filterId: '80|2|1' },
      { type: '29', value: `${spec.adults}|0`, filterId: '29|1' },
    ],
    roomQuantity: spec.rooms,
    paging: { pageIndex: 1, pageSize: 20, pageCode: '' },
    hotelIdFilter: { hotelAldyShown: [] },
    extraFilter: {
      childInfoItems: [],
      ctripMainLandBDCoordinate: true,
      sessionId: '',
      extendableParams: {
        tripWalkDriveSwitch: 'T',
        timeStamp: String(Date.now()),
      },
    },
    head: {
      platform: 'PC',
      cver: '0',
      cid: crypto.randomUUID(),
      bu: 'IBU',
      group: 'trip',
      aid: '14887',
      sid: '1621818',
      locale: 'ko-KR',
      timezone: '9',
      currency: 'JPY',
      isSSR: false,
      extension: [
        { name: 'cityId', value: String(TOKUSHIMA_CITY_ID) },
        { name: 'checkIn', value: spec.checkIn },
        { name: 'checkOut', value: spec.checkOut },
        { name: 'region', value: 'KR' },
      ],
    },
  };
}

// biome-ignore lint/suspicious/noExplicitAny: arbitrary API response
function hotelToListing(h: any, nights: number, spec: SearchSpec): Listing | null {
  const hotelInfo = h?.hotelInfo;
  if (!hotelInfo) return null;

  if (hotelInfo.statusInfo?.status === 0) return null;

  const name: unknown = hotelInfo.nameInfo?.name;
  if (typeof name !== 'string' || !name) return null;

  const hotelId = hotelInfo.summary?.hotelId;
  const url = hotelId
    ? `https://kr.trip.com/hotels/detail/?hotelId=${hotelId}&checkIn=${spec.checkIn}&checkOut=${spec.checkOut}&adult=${spec.adults}&room=${spec.rooms}`
    : null;

  let pricePerNightJpy: number | null = null;
  let roomsRemaining: number | null = null;

  const roomInfo = h.roomInfo;
  if (roomInfo && typeof roomInfo === 'object') {
    const firstRoom = roomInfo['0'] ?? Object.values(roomInfo)[0];
    if (firstRoom) {
      const priceInfo = firstRoom.priceInfo;
      if (priceInfo) {
        if (typeof priceInfo.price === 'number' && priceInfo.price > 0) {
          pricePerNightJpy = Math.round(priceInfo.price);
        } else if (typeof priceInfo.displayPrice === 'string') {
          pricePerNightJpy = parsePriceString(priceInfo.displayPrice);
        }
        if (pricePerNightJpy === null && typeof priceInfo.deletePrice === 'number') {
          pricePerNightJpy = Math.round(priceInfo.deletePrice);
        }
      }

      const roomTags = firstRoom.roomTags;
      if (Array.isArray(roomTags)) {
        for (const tag of roomTags) {
          const title = tag?.tagTitle ?? tag?.title ?? '';
          if (typeof title === 'string') {
            const match = title.match(/(\d+)\s*개/);
            if (match) {
              roomsRemaining = parseInt(match[1]!, 10);
              break;
            }
          }
        }
      }
    }
  }

  return {
    id: `trip:${hotelId ?? name}`,
    name,
    normalizedName: normalizeHotelName(name),
    pricePerNightJpy,
    totalPriceJpy: pricePerNightJpy !== null ? pricePerNightJpy * nights : null,
    roomsRemaining,
    breakfastIncluded: null,
    freeCancellation: null,
    url,
  };
}

function parsePriceString(s: string): number | null {
  const digits = s.replace(/[^0-9]/g, '');
  if (!digits) return null;
  const n = parseInt(digits, 10);
  return n > 0 ? n : null;
}

function errorResult(
  spec: SearchSpec,
  fetchedAt: string,
  error: { kind: 'network' | 'blocked' | 'parse' | 'rateLimit' | 'unknown'; message: string },
): FetchResult {
  return { site: 'trip', spec, fetchedAt, listings: [], error };
}
