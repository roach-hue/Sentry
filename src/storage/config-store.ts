import type { Config, SearchSpec, WatchTarget } from '~/core/types';

/**
 * 기본 설정. 아와오도리 시나리오에 맞춰 튜닝됨: 도쿠시마, 2027-08-12 ~
 * 2027-08-15 각 1박씩, 성인 2명 / 객실 1개.
 */
export const DEFAULT_CONFIG: Config = {
  enabled: false,
  targets: [
    {
      id: 'awaodori2027-0812',
      name: '아와오도리 8/12',
      enabled: true,
      spec: { destination: 'Tokushima', checkIn: '2027-08-12', checkOut: '2027-08-13', adults: 2, rooms: 1 },
    },
    {
      id: 'awaodori2027-0813',
      name: '아와오도리 8/13',
      enabled: true,
      spec: { destination: 'Tokushima', checkIn: '2027-08-13', checkOut: '2027-08-14', adults: 2, rooms: 1 },
    },
    {
      id: 'awaodori2027-0814',
      name: '아와오도리 8/14',
      enabled: true,
      spec: { destination: 'Tokushima', checkIn: '2027-08-14', checkOut: '2027-08-15', adults: 2, rooms: 1 },
    },
  ],
  sentinelDaysFromNow: 45,
  alert: {
    lowInventoryAt: 3,
    alertCooldownSec: 3600,
  },
  channels: {
    chromeNotification: true,
    telegram: {
      enabled: true,
      botToken: null,
      chatId: null,
    },
  },
  polling: {
    notYetOpenMinutes: 30,
    trackingMinutes: 1440,
    scraperSuspectBaseMinutes: 60,
    scraperSuspectMaxMinutes: 720,
  },
};

export interface ConfigStore {
  load(): Promise<Config>;
  save(config: Config): Promise<void>;
}

export class ChromeConfigStore implements ConfigStore {
  private readonly key = 'awaodori.config.v1';

  async load(): Promise<Config> {
    const result = await chrome.storage.local.get(this.key);
    const stored = result[this.key] as (Config & { spec?: SearchSpec }) | undefined;
    if (!stored) return DEFAULT_CONFIG;

    let targets: WatchTarget[];
    if (stored.targets) {
      targets = stored.targets;
    } else {
      targets = DEFAULT_CONFIG.targets;
    }

    return {
      ...DEFAULT_CONFIG,
      ...stored,
      targets,
      alert: { ...DEFAULT_CONFIG.alert, ...stored.alert },
      channels: {
        ...DEFAULT_CONFIG.channels,
        ...stored.channels,
        telegram: { ...DEFAULT_CONFIG.channels.telegram, ...stored.channels?.telegram },
      },
      polling: { ...DEFAULT_CONFIG.polling, ...stored.polling },
    };
  }

  async save(config: Config): Promise<void> {
    await chrome.storage.local.set({ [this.key]: config });
  }
}

export class InMemoryConfigStore implements ConfigStore {
  constructor(private current: Config = DEFAULT_CONFIG) {}
  async load(): Promise<Config> {
    return this.current;
  }
  async save(config: Config): Promise<void> {
    this.current = config;
  }
}
