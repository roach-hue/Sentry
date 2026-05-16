/**
 * 호텔명 정규화. 같은 호텔이 세 사이트에서 세 가지 다른 이름으로 나오는 경우
 * ("Tokushima Grand Hotel", "도쿠시마 그랜드 호텔", "Hotel Grand Tokushima")
 * 동일 키로 매핑되도록 한다.
 *
 * 의도적으로 공격적인 정규화 — 거짓 양성(서로 다른 두 호텔이 하나로 뭉뚱그려짐)이
 * 거짓 음성(이름 한 글자 달라서 가격 하락을 놓침)보다 비용이 작다.
 */
export function normalizeHotelName(raw: string): string {
  return (
    raw
      .normalize('NFKD')
      // 결합문자(악센트 등) 제거
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      // 공통 노이즈 단어 제거
      .replace(/\b(hotel|inn|ryokan|호텔|료칸|ホテル|旅館)\b/g, '')
      // 알파벳/숫자/CJK 외의 문자는 공백으로
      .replace(/[^a-z0-9぀-ヿ一-鿿가-힯]+/g, ' ')
      .trim()
      .replace(/\s+/g, ' ')
  );
}

/**
 * ISO datetime 또는 YYYY-MM-DD에서 날짜 부분만 추출.
 */
export function isoDatePart(iso: string): string {
  return iso.length > 10 ? iso.slice(0, 10) : iso;
}

/**
 * 두 YYYY-MM-DD 사이의 일수 차이 (end - start). 음수도 허용.
 */
export function daysBetweenIso(startIso: string, endIso: string): number {
  const toUtc = (s: string): number => {
    const [y, m, d] = s.split('-').map(Number);
    if (y === undefined || m === undefined || d === undefined) {
      throw new Error(`Invalid ISO date: ${s}`);
    }
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((toUtc(endIso) - toUtc(startIso)) / 86_400_000);
}

/**
 * 날짜 헬퍼: YYYY-MM-DD를 N일만큼 시프트. 순수 UTC 계산이라 타임존 이슈 없음.
 * 반환 형식 YYYY-MM-DD.
 */
export function shiftIsoDate(iso: string, deltaDays: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  if (y === undefined || m === undefined || d === undefined) {
    throw new Error(`Invalid ISO date: ${iso}`);
  }
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + deltaDays);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}
