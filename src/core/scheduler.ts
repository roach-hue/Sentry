import type { PollingIntervalConfig, SiteId, SiteState, WatchState } from './types';

/**
 * 순수 함수: 현재 WatchState와 폴링 설정을 보고 다음 폴까지 몇 분 기다릴지 결정.
 *
 * 우선순위 (types.ts의 PollingIntervalConfig 주석과 동일):
 *   1) 어느 사이트라도 notYetOpen / unknown → notYetOpenMinutes
 *   2) 모든 사이트가 scraperSuspect → 지수 백오프
 *   3) 그 외 → trackingMinutes
 *
 * 순수 함수라서 입력만으로 출력이 결정됨 → 픽스처 기반 테스트와
 * Python parity 검증이 그대로 가능.
 */
export function nextPollDelayMinutes(
  state: WatchState,
  cfg: PollingIntervalConfig,
): number {
  const sites = Object.keys(state.sites) as SiteId[];

  // 1) 빠른 폴링 우선순위: notYetOpen 또는 unknown이 하나라도 있으면 빠르게.
  for (const id of sites) {
    const s = state.sites[id];
    if (s && (s.kind === 'notYetOpen' || s.kind === 'unknown')) {
      return cfg.notYetOpenMinutes;
    }
  }

  // 2) 모든 사이트가 scraperSuspect인지 확인.
  let allScraperSuspect = sites.length > 0;
  let maxFailures = 0;
  for (const id of sites) {
    const s = state.sites[id];
    if (!s || s.kind !== 'scraperSuspect') {
      allScraperSuspect = false;
      break;
    }
    if (s.consecutiveFailures > maxFailures) {
      maxFailures = s.consecutiveFailures;
    }
  }
  if (allScraperSuspect && maxFailures > 0) {
    return backoffMinutes(maxFailures, cfg);
  }

  // 3) 기본: tracking / justOpened / soldOut 혼합 또는 일부 scraperSuspect 섞임.
  return cfg.trackingMinutes;
}

/**
 * 지수 백오프 계산: base × 2^(failures-1), 상한은 max.
 * 노출시켜서 단위 테스트가 직접 검증 가능.
 */
export function backoffMinutes(
  consecutiveFailures: number,
  cfg: PollingIntervalConfig,
): number {
  const exponent = Math.max(0, consecutiveFailures - 1);
  const raw = cfg.scraperSuspectBaseMinutes * Math.pow(2, exponent);
  return Math.min(raw, cfg.scraperSuspectMaxMinutes);
}

export function nextPollDelayMinutesMulti(
  states: WatchState[],
  cfg: PollingIntervalConfig,
): number {
  if (states.length === 0) return cfg.trackingMinutes;
  return Math.min(...states.map((s) => nextPollDelayMinutes(s, cfg)));
}

/** SiteState 분포 요약 — 디버깅/로깅용. */
export function summarizeStates(state: WatchState): Record<SiteState['kind'], number> {
  const counts: Record<SiteState['kind'], number> = {
    unknown: 0,
    notYetOpen: 0,
    justOpened: 0,
    tracking: 0,
    soldOut: 0,
    scraperSuspect: 0,
  };
  for (const id of Object.keys(state.sites) as SiteId[]) {
    const s = state.sites[id];
    if (s) counts[s.kind] += 1;
  }
  return counts;
}
