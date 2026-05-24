import { describe, it, expect, beforeEach } from 'vitest';
import { formatEvent } from '~/notifiers/format';
import { listing, resetCounter } from './helpers/builders';

beforeEach(() => resetCounter());

describe('formatEvent', () => {
  it('bookingOpened — critical urgency with sample listings', () => {
    const out = formatEvent({
      kind: 'bookingOpened',
      site: 'agoda',
      targetName: '테스트',
      detectedAt: '2026-08-15T12:00:00Z',
      sampleListings: [listing({ name: 'Tokushima Grand', totalPriceJpy: 80000 })],
      urgency: 'critical',
    });
    expect(out.title).toContain('아고다');
    expect(out.title).toContain('예약 오픈');
    expect(out.body).toContain('Tokushima Grand');
    expect(out.body).toContain('¥80,000');
    expect(out.urgency).toBe('critical');
  });

  it('lowInventory — shows rooms remaining', () => {
    const out = formatEvent({
      kind: 'lowInventory',
      site: 'trip',
      targetName: '테스트',
      hotelName: 'Kairaku',
      roomsRemaining: 2,
      urgency: 'high',
    });
    expect(out.title).toContain('트립닷컴');
    expect(out.title).toContain('2개');
    expect(out.body).toContain('Kairaku');
  });

  it('scraperSuspect — shows consecutive failure count', () => {
    const out = formatEvent({
      kind: 'scraperSuspect',
      site: 'agoda',
      targetName: '테스트',
      consecutiveFailures: 3,
      urgency: 'medium',
    });
    expect(out.body).toContain('3회');
  });
});
