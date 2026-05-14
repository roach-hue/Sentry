#!/usr/bin/env node
/**
 * 사이트 정찰(reconnaissance) — Playwright로 실제 Chromium 브라우저를 띄워
 * 3개 타겟 사이트에서 검색을 수행하고, 렌더링된 HTML을 tests/fixtures/html/에
 * 저장한다. 이 스냅샷이 fetcher 추출기 단위 테스트의 입력이 되어, 사이트
 * 구조 변경이 무음으로 추출 결과를 깨뜨리는 대신 테스트 실패로 표면화된다.
 *
 * 수동 실행:
 *   npm run recon
 *
 * 브라우저가 헤드 모드로 뜬다. 각 사이트마다:
 *   1) 페이지가 로드됨 (또는 동의/쿠키 모달이 뜨면 사용자가 직접 닫음)
 *   2) 매물 목록이 실제로 보이는 상태가 되면 **터미널에서 Enter** 한 번
 *      → 즉시 HTML 캡처
 *   3) Enter 안 눌러도 180초 후 자동 캡처 (안전망)
 *   4) 다음 사이트로 이동
 *
 * 캡처된 HTML은 tests/fixtures/html/에 저장됨.
 */

import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import readline from 'node:readline';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(__dirname, '..', 'tests', 'fixtures', 'html');
const REPORT_DIR = resolve(__dirname, '..', 'tests', 'fixtures', 'recon-reports');

const SPEC = {
  checkIn: '2027-08-12',
  checkOut: '2027-08-15',
  adults: 2,
  rooms: 1,
};

const TARGETS = [
  {
    name: 'agoda',
    // recon (2026-05-21) 캡처 HTML의 "CityId":18816 에서 확인한 도쿠시마 city ID.
    url: `https://www.agoda.com/search?city=18816&checkIn=${SPEC.checkIn}&checkOut=${SPEC.checkOut}&adults=${SPEC.adults}&rooms=${SPEC.rooms}&locale=ko-kr&currency=JPY`,
  },
  {
    name: 'trip',
    // 슬러그 URL이 로그인 벽을 덜 탐. 쿼리 파라미터 방식(?city=1172&...)은 로그인 강제 리다이렉트 빈번.
    url: `https://kr.trip.com/hotels/tokushima-hotels-list-1172/?checkIn=${SPEC.checkIn}&checkOut=${SPEC.checkOut}&adult=${SPEC.adults}&children=0&crn=${SPEC.rooms}&curr=JPY`,
  },
];

const MAX_WAIT_MS = 180_000;

function waitForReadySignal(label) {
  return new Promise((resolve) => {
    console.log(
      `\n[recon] >>> ${label} <<<\n` +
        `        브라우저 창에서 작업 끝나면 (모달 닫기, 검색 결과 보이는지 확인 등)\n` +
        `        ▶ 이 터미널에서 Enter 한 번 누르면 즉시 캡처\n` +
        `        ▶ 그냥 두면 ${MAX_WAIT_MS / 1000}초 후 자동 캡처`,
    );
    let done = false;
    const finish = (reason) => {
      if (done) return;
      done = true;
      process.stdin.off('data', onData);
      clearTimeout(timer);
      resolve(reason);
    };
    const onData = (chunk) => {
      // 어떤 키든 입력 들어오면 Enter로 간주
      if (chunk.length > 0) finish('manual');
    };
    process.stdin.on('data', onData);
    const timer = setTimeout(() => finish('timeout'), MAX_WAIT_MS);
  });
}

/**
 * 페이지에서 핵심 정보를 추출하여 JSON 요약 생성.
 * 브라우저 컨텍스트에서 실행되므로 DOM API 사용 가능.
 */
async function extractPageSummary(page, target) {
  const finalUrl = page.url();
  const title = await page.title();

  const siteName = target.name;
  const summary = await page.evaluate((site) => {
    let heading = null;
    let searchBarText = null;
    let hotelCardCount = 0;
    const samples = [];

    if (site === 'agoda') {
      const headingEl =
        document.querySelector('h1') ||
        document.querySelector('[data-selenium="area-city-text"]');
      heading = headingEl?.textContent?.trim() ?? null;

      const hotelCards = document.querySelectorAll('[data-selenium="hotel-item"]');
      hotelCardCount = hotelCards.length;

      const searchInput = document.querySelector('input[data-selenium="textInput"]');
      searchBarText = searchInput?.value ?? null;

      for (const card of [...hotelCards].slice(0, 5)) {
        const nameEl = card.querySelector('[data-selenium="hotel-name"]');
        const priceEl =
          card.querySelector('[data-selenium="display-price"]') ||
          card.querySelector('[data-selenium="total-price-per-night"]');
        samples.push({
          name: nameEl?.textContent?.trim() ?? null,
          price: priceEl?.textContent?.trim() ?? null,
        });
      }
    } else if (site === 'trip') {
      // Trip.com: 로그인 벽이 뜨면 heading/cards 없음 — title로 판별
      heading = document.querySelector('h1')?.textContent?.trim() ?? null;

      // Trip.com 호텔 카드: JSON-LD의 Hotel 항목 또는 리스트 아이템
      const jsonLds = document.querySelectorAll('script[type="application/ld+json"]');
      for (const el of jsonLds) {
        try {
          const data = JSON.parse(el.textContent ?? '');
          if (data?.['@type'] === 'Hotel' || data?.['@type'] === 'LodgingBusiness') {
            hotelCardCount++;
            if (samples.length < 5) {
              samples.push({ name: data.name ?? null, price: data.offers?.price ?? null });
            }
          }
        } catch {}
      }

      // URL의 city 파라미터에서 도시 추출
      const urlCity = new URL(location.href).searchParams.get('city');
      searchBarText = urlCity ? `city=${urlCity}` : null;
    }

    return { heading, searchBarText, hotelCardCount, samples };
  }, siteName);

  return {
    site: target.name,
    capturedAt: new Date().toISOString(),
    requestUrl: target.url,
    finalUrl,
    pageTitle: title,
    ...summary,
  };
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  await mkdir(REPORT_DIR, { recursive: true });
  const reports = [];

  // stdin을 raw 모드로 — Enter 외 다른 키도 잡으려면 필요하지만,
  // 일반적으로 readline 없이 Enter를 잡으려면 stdin이 흐름 모드여야 함.
  if (process.stdin.isTTY) {
    process.stdin.resume();
  }

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    locale: 'ko-KR',
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
  });

  for (const target of TARGETS) {
    const page = await context.newPage();
    console.log(`\n[recon] 페이지 열기: ${target.url}`);
    try {
      await page.goto(target.url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
      // 초기 SPA 렌더링 약간 기다리기 (그동안 사용자가 봇 차단/모달 확인 가능).
      await page.waitForTimeout(3_000);

      const reason = await waitForReadySignal(target.name);
      console.log(`[recon]   캡처 시작 (${reason})`);

      // 페이지 요약 추출 (HTML 저장 전에 — DOM이 살아있는 동안)
      const report = await extractPageSummary(page, target);
      reports.push(report);

      const html = await page.content();
      const outPath = resolve(OUT_DIR, `${target.name}-2027-08-12.html`);
      await writeFile(outPath, html, 'utf-8');
      console.log(`[recon]   HTML 저장: ${outPath} (${html.length.toLocaleString()} bytes)`);
      console.log(`[recon]   최종 URL: ${report.finalUrl}`);
      console.log(`[recon]   페이지 제목: ${report.pageTitle}`);
      console.log(`[recon]   표시된 도시: ${report.searchBarText ?? report.heading ?? '(감지 못함)'}`);
      console.log(`[recon]   호텔 카드 수: ${report.hotelCardCount}`);
    } catch (e) {
      console.error(`[recon] ${target.name} 실패:`, e instanceof Error ? e.message : e);
    } finally {
      await page.close();
    }
  }

  await context.close();
  await browser.close();

  // stdin 정리해서 프로세스가 매달리지 않도록.
  process.stdin.pause();

  // JSON 리포트 저장
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const reportPath = resolve(REPORT_DIR, `recon-${timestamp}.json`);
  await writeFile(reportPath, JSON.stringify(reports, null, 2), 'utf-8');

  console.log(`\n[recon] 리포트 저장: ${reportPath}`);
  console.log('\n[recon] === 요약 ===');
  for (const r of reports) {
    const city = r.searchBarText ?? r.heading ?? '(감지 못함)';
    const status = city.includes('도쿠시마') || city.toLowerCase().includes('tokushima')
      ? '✓ 도쿠시마'
      : `✗ ${city}`;
    console.log(`  ${r.site.padEnd(18)} ${status} | 호텔 ${r.hotelCardCount}개`);
  }
  console.log('\n[recon] 완료. 도시가 틀리면 해당 사이트의 city ID를 갱신할 것.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => {
    process.stdin.pause();
  });
