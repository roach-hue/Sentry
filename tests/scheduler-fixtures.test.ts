import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { nextPollDelayMinutes } from '~/core/scheduler';
import type { PollingIntervalConfig, WatchState } from '~/core/types';

/**
 * 픽스처 기반 스케줄러 테스트 — verify/scheduler_parity.py와 동일 JSON을 공유.
 * TS와 Python 양쪽이 같은 입력에 같은 출력을 내면 cross-language parity 확보.
 */

interface SchedulerScenario {
  name: string;
  description: string;
  cfg: PollingIntervalConfig;
  state: WatchState;
  expected: number;
}

const FIXTURES_DIR = resolve(__dirname, '..', 'verify', 'scheduler_fixtures');
const fixtureFiles = readdirSync(FIXTURES_DIR)
  .filter((f) => f.endsWith('.json'))
  .sort();

describe('scheduler — JSON 픽스처 parity (Python verifier와 공유)', () => {
  for (const file of fixtureFiles) {
    const scenario: SchedulerScenario = JSON.parse(
      readFileSync(resolve(FIXTURES_DIR, file), 'utf-8'),
    );

    it(`${file} — ${scenario.name}`, () => {
      const actual = nextPollDelayMinutes(scenario.state, scenario.cfg);
      expect(actual).toBe(scenario.expected);
    });
  }
});
