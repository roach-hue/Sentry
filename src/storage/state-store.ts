import type { SiteId, WatchState } from '~/core/types';

/**
 * 영속 상태 저장소. 프로덕션은 chrome.storage.local을, 테스트는 인메모리 맵을
 * 사용한다. 어느 쪽이든 동일 인터페이스라서 orchestrator는 환경별로 분기할
 * 필요가 없다.
 */
export interface StateStore {
  load(): Promise<WatchState>;
  save(state: WatchState): Promise<void>;
  reset(): Promise<void>;
}

export function emptyWatchState(allSites: readonly SiteId[]): WatchState {
  const sites = {} as Record<SiteId, WatchState['sites'][SiteId]>;
  const lastListings = {} as Record<SiteId, Record<string, never>>;
  for (const s of allSites) {
    sites[s] = { kind: 'unknown' };
    lastListings[s] = {};
  }
  return {
    sites,
    lastRound: null,
    lastListings,
  };
}

export class InMemoryStateStore implements StateStore {
  private state: WatchState;

  constructor(allSites: readonly SiteId[]) {
    this.state = emptyWatchState(allSites);
  }

  async load(): Promise<WatchState> {
    return structuredClone(this.state);
  }

  async save(state: WatchState): Promise<void> {
    this.state = structuredClone(state);
  }

  async reset(): Promise<void> {
    this.state = emptyWatchState(Object.keys(this.state.sites) as SiteId[]);
  }
}

export class ChromeStateStore implements StateStore {
  private readonly key: string;

  constructor(private readonly allSites: readonly SiteId[], targetId: string) {
    this.key = `awaodori.watchState.v1.${targetId}`;
  }

  async load(): Promise<WatchState> {
    const result = await chrome.storage.local.get(this.key);
    let stored = result[this.key] as WatchState | undefined;

    // v1 → v2: 구 키(targetId 없는)에서 상태 복사
    if (!stored) {
      const legacyKey = 'awaodori.watchState.v1';
      const legacy = await chrome.storage.local.get(legacyKey);
      const legacyState = legacy[legacyKey] as WatchState | undefined;
      if (legacyState) {
        stored = legacyState;
        await this.save(stored);
        await chrome.storage.local.remove(legacyKey);
      }
    }

    if (!stored) return emptyWatchState(this.allSites);
    return this.migrate(stored);
  }

  async save(state: WatchState): Promise<void> {
    await chrome.storage.local.set({ [this.key]: state });
  }

  async reset(): Promise<void> {
    await chrome.storage.local.remove(this.key);
  }

  /**
   * 전방 호환성: 나중에 새 사이트를 추가했을 때 기존 저장소에는 그 사이트
   * 엔트리가 없다. 빈 값으로 채워서 호출자가 전체 shape에 의존할 수 있게 한다.
   */
  private migrate(stored: WatchState): WatchState {
    const fallback = emptyWatchState(this.allSites);
    return {
      ...fallback,
      ...stored,
      sites: { ...fallback.sites, ...stored.sites },
      lastListings: { ...fallback.lastListings, ...stored.lastListings },
    };
  }
}
