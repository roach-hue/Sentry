import type { FetchResult, SearchSpec, SiteId } from '~/core/types';

/**
 * 교체 가능한 fetcher 계약. 프로덕션 fetcher는 실 사이트를 호출하고,
 * mock fetcher는 테스트용 픽스처 데이터를 반환한다.
 *
 * 구현체는 네트워크/파싱 에러로 throw해서는 안 된다 — 대신 FetchResult를
 * 만들어서 `error` 필드에 채워 반환할 것. throw는 프로그래머 오류
 * (잘못된 SearchSpec 등)에만 사용한다.
 */
export interface SiteFetcher {
  readonly site: SiteId;
  fetch(spec: SearchSpec): Promise<FetchResult>;
}
