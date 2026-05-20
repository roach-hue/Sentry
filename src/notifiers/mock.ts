import type { NotificationEvent } from '~/core/types';
import type { Notifier, NotifierResult } from './interface';

/**
 * Notifier의 테스트 더블. 보내달라고 받은 모든 이벤트를 기록.
 * 테스트는 `.sent`에 대해 assertion 한다.
 */
export class MockNotifier implements Notifier {
  readonly name = 'mock';
  readonly sent: NotificationEvent[] = [];
  /** 테스트에서 notifier 장애를 시뮬레이션하려면 이걸 true로. */
  shouldFail = false;

  async send(event: NotificationEvent): Promise<NotifierResult> {
    if (this.shouldFail) {
      return { ok: false, error: 'mock failure', retriable: true };
    }
    this.sent.push(event);
    return { ok: true };
  }

  reset(): void {
    this.sent.length = 0;
    this.shouldFail = false;
  }
}
