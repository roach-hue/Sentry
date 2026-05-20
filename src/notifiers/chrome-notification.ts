import type { NotificationEvent } from '~/core/types';
import { formatEvent } from './format';
import type { Notifier, NotifierResult } from './interface';

/**
 * chrome.notifications API로 Windows/macOS 토스트를 발사. 크롬 확장 런타임
 * 안에서만 동작 가능 — 테스트는 대신 MockNotifier를 사용.
 */
export class ChromeNotificationNotifier implements Notifier {
  readonly name = 'chromeNotification';

  async send(event: NotificationEvent): Promise<NotifierResult> {
    if (typeof chrome === 'undefined' || !chrome.notifications) {
      return { ok: false, error: 'chrome.notifications unavailable', retriable: false };
    }
    const { title, body, urgency } = formatEvent(event);
    try {
      const notifId = `awaodori:${event.site}:${encodeURIComponent(event.targetName)}:${Date.now()}`;
      await new Promise<string>((resolve, reject) => {
        chrome.notifications.create(notifId, {
            type: 'basic',
            iconUrl: chrome.runtime.getURL('icons/icon128.png'),
            title,
            message: body,
            priority: urgencyToPriority(urgency),
            requireInteraction: urgency === 'critical',
          },
          (id) => {
            const lastError = chrome.runtime.lastError;
            if (lastError) {
              reject(new Error(lastError.message));
              return;
            }
            resolve(id);
          },
        );
      });
      return { ok: true };
    } catch (e) {
      return {
        ok: false,
        error: e instanceof Error ? e.message : String(e),
        retriable: true,
      };
    }
  }
}

function urgencyToPriority(urgency: NotificationEvent['urgency']): number {
  switch (urgency) {
    case 'critical':
      return 2;
    case 'high':
      return 1;
    case 'medium':
      return 0;
    case 'low':
      return -1;
  }
}
