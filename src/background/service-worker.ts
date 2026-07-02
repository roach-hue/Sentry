/**
 * Service worker 진입점 — chrome.alarms 등록, 옵션 페이지로부터의 메시지
 * 수신, 알람 발사마다 한 폴 라운드 실행을 담당.
 *
 * Manifest V3의 service worker는 수명이 짧다(ephemeral): 약 30초간 유휴이면 Chrome이
 * 종료시킴. 그래서 글로벌 상태를 두지 않고 매 알람 발사 시점에 config와
 * 상태를 저장소에서 다시 로드한다.
 *
 * 스케줄링: 고정 주기가 아니라 **상태별 적응형**.
 *   - 미오픈/미관측 → 빠르게 (예약 오픈 감지가 핵심 가치)
 *   - 정상 추적 중 → 느리게 (가격 변동은 시간 단위로 미세)
 *   - 모두 스크래퍼 의심 → 지수 백오프
 * 결정 로직은 src/core/scheduler.ts의 nextPollDelayMinutes() 참조.
 * 폴 라운드가 끝날 때마다 새 일회성 알람을 다음 시각에 등록한다.
 */

import { runPollRound } from '~/orchestrator/orchestrator';
import { nextPollDelayMinutesMulti } from '~/core/scheduler';
import { TelegramNotifier } from '~/notifiers/telegram';
import { AgodaFetcher } from '~/fetchers/agoda';
import { TripFetcher } from '~/fetchers/trip';
import { ChromeNotificationNotifier } from '~/notifiers/chrome-notification';
import { ChromeConfigStore } from '~/storage/config-store';
import { ChromeStateStore } from '~/storage/state-store';
import { ALL_SITES } from '~/core/types';
import type { Notifier } from '~/notifiers/interface';
import type { SiteFetcher } from '~/fetchers/interface';
import type { Config, SearchSpec, SiteId, NotificationEvent, WatchState } from '~/core/types';

const ALARM_NAME = 'awaodori.adaptivePoll';

/** 폴 라운드 실행 중 예외로 다음 알람 등록을 못 했을 때의 안전망 (분). */
const FAILSAFE_DELAY_MINUTES = 60;

chrome.action.onClicked.addListener(() => {
  chrome.runtime.openOptionsPage();
});

chrome.runtime.onInstalled.addListener(async () => {
  await setupTripOriginRule();
  await scheduleNext(1);
  console.log('[awaodori] alarm registered:', ALARM_NAME);
});

async function setupTripOriginRule(): Promise<void> {
  try {
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: [1],
      addRules: [{
        id: 1,
        priority: 1,
        action: {
          type: chrome.declarativeNetRequest.RuleActionType.MODIFY_HEADERS,
          requestHeaders: [
            { header: 'Origin', operation: chrome.declarativeNetRequest.HeaderOperation.SET, value: 'https://kr.trip.com' },
          ],
        },
        condition: {
          urlFilter: 'https://kr.trip.com/restapi/*',
          resourceTypes: [chrome.declarativeNetRequest.ResourceType.XMLHTTPREQUEST],
        },
      }],
    });
  } catch (e) {
    console.warn('[awaodori] declarativeNetRequest 설정 실패:', e);
  }
}

chrome.runtime.onStartup.addListener(async () => {
  const existing = await chrome.alarms.get(ALARM_NAME);
  if (!existing) {
    await scheduleNext(1);
  }
});

chrome.notifications.onClicked.addListener(async (notifId) => {
  // notifId 형식: "awaodori:{site}:{targetName}:{timestamp}" 또는 "test-{timestamp}"
  const parts = notifId.split(':');
  const site = parts.length >= 2 ? parts[1] : null;
  const targetName = parts.length >= 3 ? decodeURIComponent(parts[2]!) : null;

  let url: string | null = null;
  if (targetName) {
    const config = await new ChromeConfigStore().load();
    const target = config.targets.find((t) => t.name === targetName);
    if (target) {
      url = buildSearchUrl(site ?? 'agoda', target.spec);
    }
  }
  url ??= 'https://www.agoda.com/ko-kr/search?city=18816&locale=ko-kr&currency=JPY';

  chrome.tabs.create({ url });
  chrome.notifications.clear(notifId);
});

const TEST_ALARM = 'awaodori.testNotification';

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === TEST_ALARM) {
    await fireTestNotification();
    return;
  }
  if (alarm.name !== ALARM_NAME) return;
  await runOnce('alarm');
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.kind === 'runNow') {
    runOnce('manual')
      .then((res) =>
        sendResponse({ ok: true, events: res.events.length, errors: res.errors, summaries: res.summaries }),
      )
      .catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  }
  if (msg?.kind === 'ping') {
    sendResponse({ ok: true, pong: Date.now() });
    return false;
  }
  if (msg?.kind === 'scheduleTestNotification' && typeof msg.when === 'number') {
    chrome.alarms.create(TEST_ALARM, { when: msg.when });
    const eta = new Date(msg.when).toLocaleString('ko-KR');
    console.log(`[awaodori] 테스트 알림 예약: ${eta}`);
    sendResponse({ ok: true, eta });
    return false;
  }
  return false;
});

const FAILED_EVENTS_KEY = 'awaodori.failedEvents';

async function loadFailedEvents(): Promise<NotificationEvent[]> {
  const result = await chrome.storage.local.get(FAILED_EVENTS_KEY);
  return (result[FAILED_EVENTS_KEY] as NotificationEvent[] | undefined) ?? [];
}

async function saveFailedEvents(events: NotificationEvent[]): Promise<void> {
  if (events.length === 0) {
    await chrome.storage.local.remove(FAILED_EVENTS_KEY);
  } else {
    await chrome.storage.local.set({ [FAILED_EVENTS_KEY]: events });
  }
}

async function retryFailedEvents(notifiers: Notifier[]): Promise<void> {
  const failed = await loadFailedEvents();
  if (failed.length === 0 || notifiers.length === 0) return;

  const stillFailed: NotificationEvent[] = [];
  for (const event of failed) {
    let allOk = true;
    for (const notifier of notifiers) {
      const result = await notifier.send(event);
      if (!result.ok) allOk = false;
    }
    if (!allOk) stillFailed.push(event);
  }
  await saveFailedEvents(stillFailed);
  if (failed.length > stillFailed.length) {
    console.log(`[awaodori] 재전송 성공: ${failed.length - stillFailed.length}건`);
  }
}

interface RunOnceResult {
  events: unknown[];
  errors: string[];
  summaries: string[];
}

async function runOnce(trigger: 'alarm' | 'manual'): Promise<RunOnceResult> {
  const errors: string[] = [];
  const summaries: string[] = [];
  let nextDelayMin = FAILSAFE_DELAY_MINUTES;
  try {
    const configStore = new ChromeConfigStore();
    const config = await configStore.load();

    await chrome.storage.local.set({ 'awaodori.lastPoll': new Date().toISOString() });

    if (!config.enabled) {
      console.log('[awaodori] 감시 꺼짐 — 스킵');
      return { events: [], errors: [], summaries: ['감시 꺼짐'] };
    }

    const enabledTargets = config.targets.filter((t) => t.enabled);
    if (enabledTargets.length === 0) {
      console.log('[awaodori] 활성 감시 대상 없음 — 스킵');
      return { events: [], errors: [], summaries: ['활성 감시 대상 없음'] };
    }

    const fetchers: Record<SiteId, SiteFetcher> = {
      agoda: new AgodaFetcher(),
      trip: new TripFetcher(),
    };
    const notifiers = assembleNotifiers(config);

    await retryFailedEvents(notifiers);

    const allEvents: unknown[] = [];
    const allStates: WatchState[] = [];

    for (const target of enabledTargets) {
      const stateStore = new ChromeStateStore(ALL_SITES, target.id);
      const outcome = await runPollRound(config, target, {
        fetchers,
        notifiers,
        store: stateStore,
        now: () => new Date().toISOString(),
      });

      const siteParts: string[] = [];
      for (const site of ALL_SITES) {
        const r = outcome.round.perSite[site];
        if (r) {
          const re = r.real;
          const se = r.sentinel;
          console.log(
            `[awaodori] ${target.name} | ${site} | real: ${re.listings.length}건${re.error ? ` ERR(${re.error.kind}: ${re.error.message})` : ''} | sentinel: ${se.listings.length}건${se.error ? ` ERR(${se.error.kind}: ${se.error.message})` : ''}`,
          );
          if (re.error) {
            siteParts.push(`${site}: 오류`);
          } else {
            siteParts.push(`${site}: ${re.listings.length}건`);
          }
        }
      }
      summaries.push(`${target.name} → ${siteParts.join(' / ')}`);

      allEvents.push(...outcome.events);

      const newFailed: NotificationEvent[] = [];
      for (const r of outcome.notifierResults) {
        if (!r.ok && r.error) errors.push(`${r.notifier}: ${r.error}`);
        if (!r.ok && r.event.urgency === 'critical') {
          newFailed.push(r.event);
        }
      }
      if (newFailed.length > 0) {
        const existing = await loadFailedEvents();
        await saveFailedEvents([...existing, ...newFailed]);
      }

      allStates.push(await stateStore.load());
    }

    nextDelayMin = nextPollDelayMinutesMulti(allStates, config.polling);

    console.log(
      `[awaodori] poll (${trigger}) — targets=${enabledTargets.length}, events=${allEvents.length}, errors=${errors.length}, nextDelayMin=${nextDelayMin}`,
    );
    return { events: allEvents, errors, summaries };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[awaodori] poll failed:', msg);
    return { events: [], errors: [msg], summaries: [] };
  } finally {
    // 항상 다음 알람을 등록 — 예외로 빠지더라도 시스템이 멈추지 않음.
    await scheduleNext(nextDelayMin);
  }
}

async function scheduleNext(delayMinutes: number): Promise<void> {
  // chrome.alarms.create는 동일 이름의 기존 알람을 자동으로 덮어쓴다.
  chrome.alarms.create(ALARM_NAME, {
    when: Date.now() + delayMinutes * 60_000,
  });
}

function assembleNotifiers(config: Config): Notifier[] {
  const notifiers: Notifier[] = [];
  if (config.channels.chromeNotification) {
    notifiers.push(new ChromeNotificationNotifier());
  }
  if (
    config.channels.telegram.enabled &&
    config.channels.telegram.botToken &&
    config.channels.telegram.chatId
  ) {
    notifiers.push(
      new TelegramNotifier(
        config.channels.telegram.botToken,
        config.channels.telegram.chatId,
      ),
    );
  }
  return notifiers;
}

function buildSearchUrl(site: string, spec: SearchSpec): string {
  if (site === 'trip') {
    return `https://kr.trip.com/hotels/list?city=1172&countryId=78&checkin=${spec.checkIn}&checkout=${spec.checkOut}&adult=${spec.adults}&room=${spec.rooms}`;
  }
  return `https://www.agoda.com/ko-kr/search?city=18816&locale=ko-kr&currency=JPY&checkIn=${spec.checkIn}&checkOut=${spec.checkOut}&rooms=${spec.rooms}&adults=${spec.adults}`;
}

async function fireTestNotification(): Promise<void> {
  const { formatEvent } = await import('~/notifiers/format');
  const formatted = formatEvent({
    kind: 'bookingOpened',
    site: 'agoda',
    targetName: '테스트 알림',
    urgency: 'critical',
    detectedAt: new Date().toISOString(),
    sampleListings: [
      { id: 'test-1', name: '[테스트] JR Hotel Clement Tokushima', normalizedName: '', pricePerNightJpy: null, totalPriceJpy: 80000, roomsRemaining: null, breakfastIncluded: null, freeCancellation: null, url: null },
      { id: 'test-2', name: '[테스트] Smile Hotel Tokushima', normalizedName: '', pricePerNightJpy: null, totalPriceJpy: 45000, roomsRemaining: null, breakfastIncluded: null, freeCancellation: null, url: null },
    ],
  });
  chrome.notifications.create(`test-${Date.now()}`, {
    type: 'basic',
    iconUrl: chrome.runtime.getURL('icons/icon128.png'),
    title: formatted.title,
    message: formatted.body,
    priority: 2,
  });
  console.log('[awaodori] 테스트 알림 발사 완료');
}

