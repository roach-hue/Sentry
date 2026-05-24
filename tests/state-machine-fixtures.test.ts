import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { step } from '~/core/state-machine';
import type { AlertConfig, PollRound, WatchState } from '~/core/types';

/**
 * 픽스처 기반 테스트 — 이 JSON 파일들은 verify/state_machine_parity.py와
 * 공유된다. TS와 Python 양쪽이 동일 픽스처에서 모두 통과하면 결정 로직이
 * cross-language parity를 가졌다는 뜻. 두 구현 중 어느 쪽의 오타라도 즉시
 * 표면화된다.
 *
 * 시나리오 추가: verify/fixtures/에 새 JSON을 드롭하기만 하면 된다.
 */

interface Scenario {
  name: string;
  description: string;
  initialState: WatchState;
  alert: AlertConfig;
  rounds: PollRound[];
  expected: {
    finalSiteKinds?: Record<string, string>;
    consecutiveFailures?: Record<string, number>;
    events: Array<{ kind: string; site: string; urgency: string }>;
  };
}

const FIXTURES_DIR = resolve(__dirname, '..', 'verify', 'fixtures');
const fixtureFiles = readdirSync(FIXTURES_DIR)
  .filter((f) => f.endsWith('.json'))
  .sort();

describe('state machine — JSON fixture parity (shared with Python verifier)', () => {
  for (const file of fixtureFiles) {
    const scenario: Scenario = JSON.parse(
      readFileSync(resolve(FIXTURES_DIR, file), 'utf-8'),
    );

    it(`${file} — ${scenario.name}`, () => {
      let state = scenario.initialState;
      const allEvents: Array<{ kind: string; site: string; urgency: string }> = [];
      for (const round of scenario.rounds) {
        const result = step(state, round, scenario.alert);
        state = result.next;
        for (const e of result.events) {
          allEvents.push({ kind: e.kind, site: e.site, urgency: e.urgency });
        }
      }

      if (scenario.expected.finalSiteKinds) {
        for (const [siteId, expectedKind] of Object.entries(
          scenario.expected.finalSiteKinds,
        )) {
          expect(state.sites[siteId as keyof typeof state.sites].kind).toBe(expectedKind);
        }
      }

      if (scenario.expected.consecutiveFailures) {
        for (const [siteId, expectedFailures] of Object.entries(
          scenario.expected.consecutiveFailures,
        )) {
          const s = state.sites[siteId as keyof typeof state.sites];
          if (s.kind !== 'scraperSuspect') {
            throw new Error(
              `Expected ${siteId} to be scraperSuspect but got ${s.kind}`,
            );
          }
          expect(s.consecutiveFailures).toBe(expectedFailures);
        }
      }

      expect(allEvents).toEqual(scenario.expected.events);
    });
  }
});
