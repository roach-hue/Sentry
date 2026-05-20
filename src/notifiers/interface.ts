import type { NotificationEvent } from '~/core/types';

/**
 * 교체 가능한 notifier. 한 구현체는 하나의 물리적 채널(chrome 알림, 카카오 DM,
 * 콘솔 로그 등)을 담당. orchestrator는 활성화된 모든 notifier에 이벤트를
 * fan-out 한다.
 */
export interface Notifier {
  readonly name: string;
  send(event: NotificationEvent): Promise<NotifierResult>;
}

export type NotifierResult =
  | { ok: true }
  | { ok: false; error: string; retriable: boolean };
