import type { NotificationEvent, Listing } from '~/core/types';
import type { Notifier, NotifierResult } from './interface';

/**
 * Telegram Bot API로 메시지 발송.
 * 서버 필요 없음 — 봇 토큰 + 채팅 ID만 있으면 크롬 확장에서 직접 HTTP POST.
 */

const API_BASE = 'https://api.telegram.org/bot';

const SITE_LABEL: Record<string, string> = {
  agoda: '아고다',
  trip: '트립닷컴',
};

export class TelegramNotifier implements Notifier {
  readonly name = 'telegram';

  constructor(
    private readonly botToken: string,
    private readonly chatId: string,
  ) {}

  async send(event: NotificationEvent): Promise<NotifierResult> {
    const text = formatTelegramMessage(event);

    try {
      const payload: Record<string, unknown> = {
        chat_id: this.chatId,
        text,
        parse_mode: 'Markdown',
      };

      // bookingOpened일 때 호텔별 딥링크 인라인 버튼
      if (event.kind === 'bookingOpened' && event.sampleListings.length > 0) {
        const buttons = event.sampleListings
          .slice(0, 5)
          .filter((l) => l.url)
          .map((l) => [{ text: `${l.name}`, url: l.url! }]);
        if (buttons.length > 0) {
          payload.reply_markup = JSON.stringify({ inline_keyboard: buttons });
        }
      }

      const res = await fetch(`${API_BASE}${this.botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const err = await res.text().catch(() => '');
        return { ok: false, error: `Telegram HTTP ${res.status}: ${err}`, retriable: res.status >= 500 };
      }
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e), retriable: true };
    }
  }
}

function formatTelegramMessage(event: NotificationEvent): string {
  const site = SITE_LABEL[event.site] ?? event.site;

  const target = event.targetName ? ` — ${event.targetName}` : '';

  switch (event.kind) {
    case 'bookingOpened': {
      const lines = event.sampleListings.slice(0, 5).map((l) => formatListing(l));
      return `🚨 *예약 오픈!* (${site}${target})\n\n${lines.join('\n\n')}`;
    }
    case 'newHotelFound': {
      const lines = event.newListings.slice(0, 5).map((l) => formatListing(l));
      return `⚠️ *새 숙소 ${event.newListings.length}건 발견* (${site}${target})\n\n${lines.join('\n\n')}`;
    }
    case 'lowInventory':
      return `⚠️ *잔여 ${event.roomsRemaining}개* (${site}${target})\n\n${event.hotelName}`;
    case 'scraperSuspect':
      return `ℹ️ *스크래퍼 점검 필요* (${site}${target})\n\n연속 실패 ${event.consecutiveFailures}회`;
    case 'soldOut':
      return `· *매물 소진* (${site}${target})`;
  }
}

function formatListing(l: Listing): string {
  const price = l.totalPriceJpy != null ? `¥${l.totalPriceJpy.toLocaleString('ja-JP')}` : '가격 미정';
  const link = l.url ? `[예약 페이지](${l.url})` : '';
  return `• ${l.name} — ${price}${link ? `\n  → ${link}` : ''}`;
}
