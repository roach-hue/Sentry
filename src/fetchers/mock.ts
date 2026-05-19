import type { FetchResult, SearchSpec, SiteId } from '~/core/types';
import type { SiteFetcher } from './interface';

/**
 * SiteFetcher의 테스트 더블. 테스트가 미리 FetchResult 큐를 적재해두면
 * 각 fetch() 호출마다 큐의 앞에서 하나씩 꺼내 반환한다. 큐가 비어있는데
 * fetch가 호출되면 throw — 이건 테스트 설정 버그를 표면화시키는 장치
 * ("테스트가 스크립트에 없는 폴 라운드를 추가로 돌렸다"는 신호).
 */
export class MockFetcher implements SiteFetcher {
  private queue: FetchResult[] = [];

  constructor(readonly site: SiteId) {}

  /** 이 사이트의 다음 응답을 큐에 추가. */
  enqueue(result: FetchResult): this {
    this.queue.push(result);
    return this;
  }

  enqueueMany(results: FetchResult[]): this {
    this.queue.push(...results);
    return this;
  }

  async fetch(_spec: SearchSpec): Promise<FetchResult> {
    const next = this.queue.shift();
    if (!next) {
      throw new Error(
        `MockFetcher(${this.site}): no more canned responses queued`,
      );
    }
    return next;
  }

  get remaining(): number {
    return this.queue.length;
  }
}
