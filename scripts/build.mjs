#!/usr/bin/env node
/**
 * 크롬 확장용 esbuild 번들러.
 *
 *   dist/
 *   ├── manifest.json              (public/에서 복사)
 *   ├── background/service-worker.js
 *   ├── options/options.html       (복사)
 *   ├── options/options.css        (복사)
 *   ├── options/options.js         (src/options/options.ts에서 번들)
 *   └── icons/                     (없으면 placeholder)
 *
 *   npm run build      — 1회 빌드
 *   npm run watch      — 변경 감시 재빌드
 */

import { build, context } from 'esbuild';
import { cp, mkdir, rm, writeFile, access } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { constants } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const SRC = resolve(ROOT, 'src');
const PUBLIC = resolve(ROOT, 'public');
const DIST = resolve(ROOT, 'dist');

const watchMode = process.argv.includes('--watch');

const SHARED_OPTIONS = {
  bundle: true,
  format: 'esm',
  target: 'chrome120',
  platform: 'browser',
  sourcemap: true,
  logLevel: 'info',
  loader: { '.png': 'file' },
  alias: { '~': SRC },
};

const ENTRY_POINTS = [
  {
    in: resolve(SRC, 'background', 'service-worker.ts'),
    out: resolve(DIST, 'background', 'service-worker.js'),
  },
  {
    in: resolve(SRC, 'options', 'options.ts'),
    out: resolve(DIST, 'options', 'options.js'),
  },
];

async function exists(path) {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function copyStatic() {
  await mkdir(resolve(DIST, 'options'), { recursive: true });
  await mkdir(resolve(DIST, 'icons'), { recursive: true });
  await cp(resolve(PUBLIC, 'manifest.json'), resolve(DIST, 'manifest.json'));
  await cp(resolve(SRC, 'options', 'options.html'), resolve(DIST, 'options', 'options.html'));
  await cp(resolve(SRC, 'options', 'options.css'), resolve(DIST, 'options', 'options.css'));

  // 아이콘이 제공되지 않은 경우 매니페스트 파싱이 깨지지 않도록 placeholder 생성.
  for (const size of [16, 48, 128]) {
    const iconPath = resolve(DIST, 'icons', `icon${size}.png`);
    const sourcePath = resolve(PUBLIC, 'icons', `icon${size}.png`);
    if (await exists(sourcePath)) {
      await cp(sourcePath, iconPath);
    } else {
      // 1x1 투명 PNG fallback — 매니페스트 로딩 시 아이콘 파싱 에러 방지.
      const transparentPng = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
        'base64',
      );
      await writeFile(iconPath, transparentPng);
    }
  }
}

async function run() {
  await rm(DIST, { recursive: true, force: true });
  await mkdir(DIST, { recursive: true });
  await copyStatic();

  if (watchMode) {
    const ctx = await context({
      ...SHARED_OPTIONS,
      entryPoints: ENTRY_POINTS.map((e) => e.in),
      outdir: DIST,
      outbase: SRC,
    });
    await ctx.watch();
    console.log('[build] watching...');
  } else {
    await build({
      ...SHARED_OPTIONS,
      entryPoints: ENTRY_POINTS.map((e) => e.in),
      outdir: DIST,
      outbase: SRC,
    });
    console.log('[build] dist/ ready. Load it in chrome://extensions (Developer mode → Load unpacked).');
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
