import type { NotificationEvent } from '~/core/types';

const SITE_LABEL: Record<string, string> = {
  agoda: '아고다',
  trip: '트립닷컴',
};

const URGENCY_PREFIX: Record<NotificationEvent['urgency'], string> = {
  critical: '🚨',
  high: '⚠️',
  medium: 'ℹ️',
  low: '·',
};

export interface FormattedNotification {
  title: string;
  body: string;
  urgency: NotificationEvent['urgency'];
}

/**
 * 순수 함수: NotificationEvent → 사람이 읽을 수 있는 한국어 텍스트.
 * 순수성 덕분에 notifier 전송 채널과 독립적으로 포메터만 따로 스냅샷
 * 테스트할 수 있다.
 */
export function formatEvent(event: NotificationEvent): FormattedNotification {
  const siteLabel = SITE_LABEL[event.site] ?? event.site;
  const prefix = URGENCY_PREFIX[event.urgency];

  const targetLabel = event.targetName ? ` — ${event.targetName}` : '';

  switch (event.kind) {
    case 'bookingOpened': {
      const sample = event.sampleListings
        .slice(0, 3)
        .map((l) => ` • ${l.name}${l.totalPriceJpy != null ? ` — ${formatJpy(l.totalPriceJpy)}` : ''}`)
        .join('\n');
      return {
        title: `${prefix} [${siteLabel}] 예약 오픈!${targetLabel}`,
        body: `예약이 열렸습니다. 빨리 잡으세요.\n${sample}`,
        urgency: event.urgency,
      };
    }
    case 'newHotelFound': {
      const list = event.newListings
        .slice(0, 3)
        .map((l) => ` • ${l.name}${l.totalPriceJpy != null ? ` — ${formatJpy(l.totalPriceJpy)}` : ''}`)
        .join('\n');
      return {
        title: `${prefix} [${siteLabel}] 새 숙소 ${event.newListings.length}건 발견${targetLabel}`,
        body: `이전에 없던 숙소가 나타났습니다.\n${list}`,
        urgency: event.urgency,
      };
    }
    case 'lowInventory':
      return {
        title: `${prefix} [${siteLabel}] 잔여 객실 ${event.roomsRemaining}개${targetLabel}`,
        body: `${event.hotelName} 매물이 곧 소진됩니다.`,
        urgency: event.urgency,
      };
    case 'scraperSuspect':
      return {
        title: `${prefix} [${siteLabel}] 스크래퍼 점검 필요${targetLabel}`,
        body: `사이트가 결과를 반환하지 않고 있습니다. 연속 실패 ${event.consecutiveFailures}회.`,
        urgency: event.urgency,
      };
    case 'soldOut':
      return {
        title: `${prefix} [${siteLabel}] 매물 소진${targetLabel}`,
        body: '이전에 잡혔던 매물이 모두 사라졌습니다.',
        urgency: event.urgency,
      };
  }
}

function formatJpy(value: number): string {
  return `¥${value.toLocaleString('ja-JP')}`;
}
