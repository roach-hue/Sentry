import type { FetchResult, Listing, SearchSpec } from '~/core/types';
import { normalizeHotelName, daysBetweenIso } from '~/core/normalize';
import type { SiteFetcher } from './interface';
import { CITY_SEARCH_QUERY } from './agoda-query';

const GRAPHQL_URL = 'https://www.agoda.com/graphql/search';
const TOKUSHIMA_CITY_ID = 18816;

export class AgodaFetcher implements SiteFetcher {
  readonly site = 'agoda' as const;

  async fetch(spec: SearchSpec): Promise<FetchResult> {
    const fetchedAt = new Date().toISOString();
    try {
      const body = buildGraphQLBody(spec);
      const headers = buildHeaders();
      const response = await fetch(GRAPHQL_URL, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        credentials: 'omit',
      });
      if (!response.ok) {
        return errorResult(spec, fetchedAt,
          response.status === 429
            ? { kind: 'rateLimit', message: `HTTP ${response.status}` }
            : { kind: 'network', message: `HTTP ${response.status}` },
        );
      }
      const json = await response.json();
      const properties = json?.data?.citySearch?.properties;
      if (!Array.isArray(properties)) {
        return errorResult(spec, fetchedAt, {
          kind: 'parse',
          message: `응답에 properties 배열 없음: ${JSON.stringify(json?.data?.citySearch ?? json).substring(0, 200)}`,
        });
      }
      const nights = Math.max(1, daysBetweenIso(spec.checkIn, spec.checkOut));
      const listings = properties
        .map((p: unknown) => propertyToListing(p, nights, spec))
        .filter((l): l is Listing => l !== null);
      return { site: 'agoda', spec, fetchedAt, listings, error: null };
    } catch (e) {
      return errorResult(spec, fetchedAt, {
        kind: 'network',
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }
}

function uuid(): string {
  return crypto.randomUUID();
}

function buildHeaders(): Record<string, string> {
  const now = Date.now();
  const userId = uuid();
  const sessionId = uuid();
  const gateMeta = btoa(`${now}|${userId}|/graphql/search`);
  return {
    'Content-Type': 'application/json',
    'AG-LANGUAGE-LOCALE': 'ko-kr',
    'ag-debug-override-origin': 'KR',
    'AG-REQUEST-ID': uuid(),
    'AG-CORRELATION-ID': uuid(),
    'AG-ANALYTICS-SESSION-ID': sessionId,
    'AG-PAGE-TYPE-ID': '103',
    'AG-CID': '1922887',
    'AG-RETRY-ATTEMPT': '0',
    'AG-REQUEST-ATTEMPT': '1',
    'x-gate-meta': gateMeta,
  };
}

function buildGraphQLBody(spec: SearchSpec) {
  const los = Math.max(1, daysBetweenIso(spec.checkIn, spec.checkOut));
  const now = new Date().toISOString();
  const userId = uuid();
  const searchId = uuid();
  const checkInIso = `${spec.checkIn}T00:00:00.000Z`;
  const checkOutIso = `${spec.checkOut}T00:00:00.000Z`;

  return {
    operationName: 'citySearch',
    variables: {
      CitySearchRequest: {
        cityId: TOKUSHIMA_CITY_ID,
        searchRequest: {
          searchCriteria: {
            isAllowBookOnRequest: true,
            bookingDate: now,
            checkInDate: checkInIso,
            localCheckInDate: spec.checkIn,
            los,
            rooms: spec.rooms,
            adults: spec.adults,
            children: 0,
            childAges: [],
            ratePlans: [],
            featureFlagRequest: {
              fetchNamesForTealium: true,
              fiveStarDealOfTheDay: true,
              isAllowBookOnRequest: false,
              showUnAvailable: true,
              showRemainingProperties: true,
              isMultiHotelSearch: false,
              enableAgencySupplyForPackages: true,
              flags: [
                { feature: 'FamilyChildFriendlyPopularFilter', enable: true },
                { feature: 'FamilyChildFriendlyPropertyTypeFilter', enable: true },
                { feature: 'FamilyMode', enable: false },
              ],
              enableDealsOfTheDayFilter: false,
              isEnableSupplierFinancialInfo: false,
              citySearchIgnoreRoomsCountForNha: false,
              isFlexibleMultiRoomSearch: true,
              enableLuxuryHotelTSP: true,
            },
            isUserLoggedIn: false,
            currency: 'JPY',
            travellerType: 'Couple',
            isAPSPeek: false,
            enableOpaqueChannel: false,
            isEnabledPartnerChannelSelection: null,
            sorting: { sortField: 'Price', sortOrder: 'Asc', sortParams: null },
            requiredBasis: 'PRPN',
            requiredPrice: 'Exclusive',
            suggestionLimit: 0,
            synchronous: false,
            supplierPullMetadataRequest: null,
            isRoomSuggestionRequested: false,
            isAPORequest: false,
            hasAPOFilter: false,
          },
          searchContext: {
            userId,
            memberId: 0,
            locale: 'ko-kr',
            cid: 1922887,
            origin: 'KR',
            platform: 1,
            deviceTypeId: 1,
            experiments: {
              forceByVariant: null,
              forceByExperiment: [{ id: 'JGCW-204', variant: 'B' }],
            },
            isRetry: false,
            showCMS: false,
            storeFrontId: 3,
            pageTypeId: 103,
            whiteLabelKey: null,
            ipAddress: '',
            endpointSearchType: 'CitySearch',
            trackSteps: null,
            searchId,
          },
          matrix: null,
          matrixGroup: [
            { matrixGroup: 'AccommodationType', size: 100 },
            { matrixGroup: 'StarRatingWithLuxury', size: 20 },
          ],
          filterRequest: { idsFilters: [], rangeFilters: [], textFilters: [] },
          page: { pageSize: 45, pageNumber: 1, pageToken: '' },
          apoRequest: { apoPageSize: 10 },
          searchHistory: [],
          searchDetailRequest: { priceHistogramBins: 50 },
          isTrimmedResponseRequested: false,
          featuredAgodaHomesRequest: null,
          featuredLuxuryHotelsRequest: null,
          highlyRatedAgodaHomesRequest: {
            numberOfAgodaHomes: 30,
            minimumReviewScore: 7.5,
            minimumReviewCount: 3,
            accommodationTypes: [28, 29, 30, 102, 103, 106, 107, 108, 109, 110, 114, 115, 120, 131],
            sortVersion: 0,
          },
          extraAgodaHomesRequest: null,
          extraHotels: { extraHotelIds: [], enableFiltersForExtraHotels: false },
          rankingRequest: { isNhaKeywordSearch: false },
          rocketmilesRequestV2: null,
          featuredPulsePropertiesRequest: { numberOfPulseProperties: 15 },
        },
      },
      ContentSummaryRequest: {
        context: {
          rawUserId: userId,
          memberId: 0,
          userOrigin: 'KR',
          locale: 'ko-kr',
          forceExperimentsByIdNew: [{ key: 'JGCW-204', value: 'B' }],
          apo: false,
          searchCriteria: { cityId: TOKUSHIMA_CITY_ID },
          platform: { id: 1 },
          storeFrontId: 3,
          cid: '1922887',
          occupancy: {
            numberOfAdults: spec.adults,
            numberOfChildren: 0,
            travelerType: 0,
            checkIn: checkInIso,
          },
          deviceTypeId: 1,
          whiteLabelKey: '',
          correlationId: '',
        },
        summary: { highlightedFeaturesOrderPriority: null, includeHotelCharacter: true },
        reviews: {
          commentary: null,
          demographics: { providerIds: null, filter: { defaultProviderOnly: true } },
          summaries: { providerIds: null, apo: true, limit: 1, travellerType: 0 },
          cumulative: { providerIds: null },
          filters: null,
        },
        images: { page: null, maxWidth: 0, maxHeight: 0, imageSizes: null, indexOffset: null },
        rooms: {
          images: null, featureLimit: 0, filterCriteria: null,
          includeMissing: false, includeSoldOut: false, includeDmcRoomId: false,
          soldOutRoomCriteria: null, showRoomSize: true, showRoomFacilities: true, showRoomName: false,
        },
        nonHotelAccommodation: true,
        engagement: true,
        highlights: {
          maxNumberOfItems: 0,
          images: { imageSizes: [{ key: 'full', size: { width: 0, height: 0 } }] },
        },
        personalizedInformation: true,
        localInformation: { images: null },
        features: null,
        rateCategories: true,
        contentRateCategories: { escapeRateCategories: {} },
        synopsis: true,
      },
      PricingSummaryRequest: {
        cheapestOnly: true,
        context: {
          isAllowBookOnRequest: true,
          abTests: [
            { testId: 9021, abUser: 'B' },
            { testId: 9023, abUser: 'B' },
            { testId: 9024, abUser: 'B' },
            { testId: 9025, abUser: 'B' },
            { testId: 9027, abUser: 'B' },
            { testId: 9029, abUser: 'B' },
          ],
          clientInfo: {
            cid: 1922887,
            languageId: 9,
            languageUse: 1,
            origin: 'KR',
            platform: 1,
            searchId,
            storefront: 3,
            userId,
            ipAddress: '',
            attributionInfos: [
              { modelId: 19, cid: -1 },
              { modelId: 20, cid: 1922887 },
              { modelId: 99, cid: 1922887 },
            ],
          },
          experiment: [{ name: 'JGCW-204', variant: 'B' }],
          sessionInfo: { isLogin: false, memberId: 0, sessionId: 1 },
        },
        isSSR: true,
        pricing: {
          bookingDate: now,
          checkIn: checkInIso,
          checkout: checkOutIso,
          localCheckInDate: spec.checkIn,
          localCheckoutDate: spec.checkOut,
          currency: 'JPY',
          details: { cheapestPriceOnly: false, itemBreakdown: false, priceBreakdown: false },
          featureFlag: [
            'ClientDiscount', 'PriceHistory', 'VipPlatinum',
            'RatePlanPromosCumulative', 'PromosCumulative', 'MixAndSave',
            'APSPeek', 'StackChannelDiscount', 'AutoApplyPromos',
            'EnableAgencySupplyForPackages', 'EnableCashback',
            'CreditCardPromotionPeek', 'EnableCofundedCashback',
            'DispatchGoLocalForInternational', 'EnableGoToTravelCampaign',
            'EnableCashbackMildlyAggressiveDisplay',
          ],
          features: {
            calculateRareRoomBadge: false, crossOutRate: false, isAPSPeek: false,
            isAllOcc: false, isApsEnabled: false, isIncludeUsdAndLocalCurrency: false,
            isMSE: true, isRPM2Included: true, maxSuggestions: 0,
            isEnableSupplierFinancialInfo: false, isLoggingAuctionData: false,
            newRateModel: false, overrideOccupancy: false,
            filterCheapestRoomEscapesPackage: false, priusId: 0, synchronous: false,
            enableRichContentOffer: true, showCouponAmountInUserCurrency: false,
            disableEscapesPackage: false, enablePushDayUseRates: false,
            enableDayUseCor: false, ignoreRoomsCountForNha: false,
            enableSuggestPriceExclusiveWithFees: true,
          },
          filters: {
            cheapestRoomFilters: [], filterAPO: false,
            ratePlans: [1], secretDealOnly: false, suppliers: [], nosOfBedrooms: [],
          },
          includedPriceInfo: false,
          occupancy: {
            adults: spec.adults,
            children: 0,
            childAges: [],
            rooms: spec.rooms,
            childrenTypes: [],
          },
          supplierPullMetadata: { requiredPrecheckAccuracyLevel: 0 },
          mseHotelIds: [],
          mseClicked: '',
          ppLandingHotelIds: [],
          searchedHotelIds: [],
          paymentId: -1,
        },
        suggestedPrice: 'Exclusive',
      },
      PriceStreamMetaLabRequest: {
        attributesId: [8, 1, 18, 7, 11, 2, 3],
      },
      ContentTopicsRequest: {
        topicNames: ['Location'],
      },
    },
    query: CITY_SEARCH_QUERY,
  };
}

// biome-ignore lint/suspicious/noExplicitAny: arbitrary API response
function propertyToListing(p: any, nights: number, spec: SearchSpec): Listing | null {
  const info = p?.content?.informationSummary;
  if (!info) return null;

  const name = info.displayName ?? info.localeName ?? info.defaultName;
  if (typeof name !== 'string' || !name) return null;
  if (p.soldOut === true) return null;

  const propertyId = p.propertyId;
  const pagePath = info.propertyLinks?.propertyPage;
  const url = typeof pagePath === 'string'
    ? `https://www.agoda.com/ko-kr${pagePath}?checkIn=${spec.checkIn}&los=${nights}&adults=${spec.adults}&rooms=${spec.rooms}`
    : null;

  let pricePerNightJpy: number | null = null;
  let availableRooms: number | null = null;

  const offers = p.pricing?.offers;
  if (Array.isArray(offers)) {
    for (const offer of offers) {
      const roomOffers = offer?.roomOffers;
      if (!Array.isArray(roomOffers)) continue;
      for (const ro of roomOffers) {
        const room = ro?.room;
        if (!room) continue;
        if (availableRooms === null && typeof room.availableRooms === 'number') {
          availableRooms = room.availableRooms;
        }
        const pricing = room.pricing;
        if (!Array.isArray(pricing)) continue;
        for (const pr of pricing) {
          const perNight = pr?.price?.perNight?.inclusive?.display;
          if (typeof perNight === 'number' && pricePerNightJpy === null) {
            pricePerNightJpy = Math.round(perNight);
          }
        }
      }
    }
  }

  return {
    id: `agoda:${propertyId ?? name}`,
    name,
    normalizedName: normalizeHotelName(name),
    pricePerNightJpy,
    totalPriceJpy: pricePerNightJpy !== null ? pricePerNightJpy * nights : null,
    roomsRemaining: availableRooms,
    breakfastIncluded: null,
    freeCancellation: null,
    url,
  };
}

function errorResult(
  spec: SearchSpec,
  fetchedAt: string,
  error: { kind: 'network' | 'blocked' | 'parse' | 'rateLimit' | 'unknown'; message: string },
): FetchResult {
  return { site: 'agoda', spec, fetchedAt, listings: [], error };
}
