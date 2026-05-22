import { step } from '~/core/state-machine';
import { daysBetweenIso, isoDatePart, shiftIsoDate } from '~/core/normalize';
import type {
  Config,
  NotificationEvent,
  PollRound,
  SearchSpec,
  SiteId,
  SitePollResult,
  WatchTarget,
} from '~/core/types';
import { ALL_SITES } from '~/core/types';
import type { SiteFetcher } from '~/fetchers/interface';
import type { Notifier } from '~/notifiers/interface';
import type { StateStore } from '~/storage/state-store';

/**
 * Orchestrator — 한 폴 라운드를 종단으로 실행.
 *
 *   1. sentinel SearchSpec 계산 (real spec을 N일 뒤로 시프트).
 *   2. 각 활성 사이트에 대해 (real, sentinel) fetch를 병렬로 발사.
 *      여기서 "병렬"은 한 라운드 안의 I/O 동시화 (라운드 1회를 1분 이내로
 *      끝내기 위함)지, 기능 개발의 병렬이 아니다. fetcher 계약상 throw하지
 *      않으므로 모든 에러는 FetchResult.error로 표면화된다.
 *   3. PollRound 조립해서 step()에 전달.
 *   4. 다음 WatchState 영속화.
 *   5. 이벤트들을 설정된 모든 notifier에 순차적으로 fan-out. 순차로 하는
 *      이유는 한 notifier의 실패가 다른 notifier의 발사 순서에 사용자
 *      관점에서 영향을 주지 않도록 하기 위함.
 */
export interface OrchestratorDeps {
  fetchers: Record<SiteId, SiteFetcher>;
  notifiers: Notifier[];
  store: StateStore;
  /** 현재 시각을 ISO 문자열로 반환. 테스트에서 시간을 고정할 수 있도록 주입. */
  now: () => string;
}

export interface PollOutcome {
  round: PollRound;
  events: NotificationEvent[];
  notifierResults: Array<{ notifier: string; event: NotificationEvent; ok: boolean; error?: string }>;
}

export async function runPollRound(
  config: Config,
  target: WatchTarget,
  deps: OrchestratorDeps,
): Promise<PollOutcome> {
  const startedAt = deps.now();
  const sentinelSpec = makeSentinelSpec(target.spec, config.sentinelDaysFromNow, startedAt);

  const perSite = {} as Record<SiteId, SitePollResult>;
  for (const site of ALL_SITES) {
    const fetcher = deps.fetchers[site];
    if (!fetcher) {
      throw new Error(`Orchestrator: no fetcher configured for site=${site}`);
    }
    const [real, sentinel] = await Promise.all([
      fetcher.fetch(target.spec),
      fetcher.fetch(sentinelSpec),
    ]);
    perSite[site] = { real, sentinel };
  }

  const completedAt = deps.now();
  const round: PollRound = { startedAt, completedAt, perSite };

  const prev = await deps.store.load();
  const { next, events } = step(prev, round, config.alert, target.name);
  await deps.store.save(next);

  const notifierResults: PollOutcome['notifierResults'] = [];
  for (const event of events) {
    for (const notifier of deps.notifiers) {
      const result = await notifier.send(event);
      notifierResults.push({
        notifier: notifier.name,
        event,
        ok: result.ok,
        error: result.ok ? undefined : result.error,
      });
    }
  }

  return { round, events, notifierResults };
}

/**
 * 순수 헬퍼: 센티넬 SearchSpec을 만든다. 센티넬 체크인 = 오늘 + daysFromNow.
 * stay duration (checkOut - checkIn)은 real spec과 동일하게 유지.
 *
 * 이전 설계 (real에서 1년 전)는 real이 특수일(축제 등)이면 센티넬도 같은
 * 특수일이 되어 매물 부재가 정상인지 깨진 건지 구분 불가했음. now-기반으로
 * 바꿔서 거의 항상 매물 있는 평범한 날짜를 기준점으로 사용.
 */
export function makeSentinelSpec(
  spec: SearchSpec,
  daysFromNow: number,
  nowIso: string,
): SearchSpec {
  const today = isoDatePart(nowIso);
  const duration = daysBetweenIso(spec.checkIn, spec.checkOut);
  const sentinelCheckIn = shiftIsoDate(today, daysFromNow);
  const sentinelCheckOut = shiftIsoDate(sentinelCheckIn, duration);
  return {
    ...spec,
    checkIn: sentinelCheckIn,
    checkOut: sentinelCheckOut,
  };
}
