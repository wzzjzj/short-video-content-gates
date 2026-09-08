// Sample actual local HyperFrames timelines. Never renders a movie or publishes.
import { createRequire } from 'node:module';
import { readFile, mkdir, writeFile, readdir, access } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { auditDocument } from './check-visible-layout.mjs';
import { createHash } from 'node:crypto';

export async function checkPreview({ html, outDir, times, browserPath, puppeteerPackage }) {
  const source = resolve(html), output = resolve(outDir);
  await access(source);
  await mkdir(output, { recursive: true });
  if ((await readdir(output)).length) throw new Error('Use an empty output directory; previous evidence is preserved.');
  const zones = JSON.parse(await readFile(new URL('../references/douyin-1080x1920-safe-zones.json', import.meta.url), 'utf8'));
  const packagePath = resolve(puppeteerPackage || join(process.env.APPDATA || '', 'npm/node_modules/hyperframes/package.json'));
  const puppeteer = createRequire(packagePath)('puppeteer-core');
  const browser = await puppeteer.launch({ executablePath: browserPath || join(process.env['ProgramFiles(x86)'] || 'C:/Program Files (x86)', 'Microsoft/Edge/Application/msedge.exe'), headless: true });
  const issues = [], samples = [], frames = [], unavailable = [];
  const dependencies = new Map();
  const fingerprint = async path => ({ path, sha256: createHash('sha256').update(await readFile(path)).digest('hex') });
  dependencies.set(source, await fingerprint(source));
  try {
    const page = await browser.newPage();
    await page.setViewport(zones.canvas);
    // Local media are readable; only the standard public GSAP CDN script may load remotely.
    // Block writes and all unrelated remote requests from the inspected page.
    await page.setRequestInterception(true);
    page.on('request', async r => {
      const local = /^(file:|data:|about:)/.test(r.url());
      const gsap = /^https:\/\/cdn\.jsdelivr\.net\/npm\/gsap@[\d.]+\/dist\/gsap\.min\.js$/.test(r.url());
      if (r.method() === 'GET' && (local || gsap)) {
        if (r.url().startsWith('file:')) {
          try {
            const path = fileURLToPath(new URL(r.url()));
            if (!dependencies.has(path)) dependencies.set(path, await fingerprint(path));
          } catch (e) { unavailable.push('Dependency fingerprint failed: ' + e.message); }
        }
        r.continue();
      }
      else { if (['script', 'stylesheet', 'font'].includes(r.resourceType())) unavailable.push(r.resourceType() + ': ' + r.url()); r.abort(); }
    });
    page.on('pageerror', e => unavailable.push(e.message));
    page.on('requestfailed', r => { if (['script','stylesheet','font','image'].includes(r.resourceType())) unavailable.push('Failed: ' + r.url()); });
    await page.goto(pathToFileURL(source).href, { waitUntil: 'load', timeout: 30000 });
    // Use the installed framework runtime for clip visibility and media seeking as well as animation.
    if (!(await page.evaluate(() => !!window.__playerReady))) {
      const runtime = join(dirname(packagePath), 'dist/hyperframe.runtime.iife.js');
      dependencies.set(runtime, await fingerprint(runtime));
      await page.addScriptTag({ path: runtime });
    }
    await page.waitForFunction(() => window.__playerReady && window.__renderReady, { timeout: 15000 });
    await page.evaluate(async () => { await document.fonts.ready; document.querySelectorAll('audio,video').forEach(e => { e.pause(); e.muted = true; }); });
    const info = await page.evaluate(() => {
      const root = document.querySelector('[data-composition-id]');
      const timelines = Object.values(window.__timelines || {});
      return { width: Number(root?.dataset.width), height: Number(root?.dataset.height), duration: Number(root?.dataset.duration), timelines: timelines.length,
        safeLayers: document.querySelectorAll('.platform-safe-content').length,
        midpoints: [...document.querySelectorAll('[data-start][data-duration]')].map(e => Number(e.dataset.start) + Number(e.dataset.duration) / 2) };
    });
    if (info.width !== zones.canvas.width || info.height !== zones.canvas.height) throw new Error('Only declared Douyin 1080x1920 compositions are supported.');
    if (info.timelines !== 1 || !(info.duration > 0 && info.duration <= 600)) throw new Error('Require one seekable timeline and duration in (0,600]. Nested/multiple timelines need their own rendered review.');
    if (!info.safeLayers) issues.push({ code: 'SAFE_LAYOUT_NOT_CONNECTED' });
    const selected = [...new Set((times || info.midpoints).filter(t => Number.isFinite(t) && t >= 0 && t < info.duration))].sort((a,b) => a-b);
    if (!selected.length) throw new Error('No valid representative times.');
    const grid = new Set(selected);
    for (let t = 0; t < info.duration; t += .25) grid.add(Number(t.toFixed(3)));
    grid.add(Math.max(0, info.duration - .04));
    let firstFailureSaved = false;
    for (const t of [...grid].sort((a,b) => a-b)) {
      await page.evaluate(async t => { window.__player.pause(); window.__player.seek(t); await window.__hfWaitForSeekCompletion?.(); }, t);
      const result = await page.evaluate(auditDocument, zones.core);
      // Hidden configuration groups in other scenes are expected here; static binding diagnosis remains separate.
      const failures = result.failures.filter(f => f.code !== 'CONFIG_NOT_VISIBLE');
      if (!result.textNodes) unavailable.push('No inspectable HTML text');
      if (failures.length) samples.push({ time: t, failures });
      if (selected.includes(t) || (failures.length && !firstFailureSaved)) {
        const name = `frame-${frames.length.toString().padStart(2,'0')}-${t.toFixed(3)}s.png`;
        await page.screenshot({ path: join(output, name) });
        frames.push({ time: t, file: name, sha256: (await fingerprint(join(output, name))).sha256 });
        if (failures.length) firstFailureSaved = true;
      }
    }
    for (const item of dependencies.values()) {
      try {
        if ((await fingerprint(item.path)).sha256 !== item.sha256) unavailable.push('Dependency changed during inspection: ' + item.path);
      } catch (e) { unavailable.push('Dependency unavailable: ' + item.path); }
    }
    const report = { schemaVersion: 2, dependencies: [...dependencies.values()], status: issues.length || samples.length ? 'BLOCK' : unavailable.length ? 'INCOMPLETE' : 'SAMPLED_GEOMETRY_CLEAR',
      html: source, htmlSha256: createHash('sha256').update(await readFile(source)).digest('hex'), duration: info.duration, intervalSeconds: .25, issues, samples, frames, unavailable: [...new Set(unavailable)],
      limitations: ['Not a quality PASS. Sampling can miss motion between times; include known extrema with --times.', 'No OCR, pseudo-element/SVG/Canvas text, occlusion, photo identity, audio or continuous-view approval.', 'Screenshots are local preview evidence, not proof of a later exported movie.'] };
    await writeFile(join(output, 'layout-report.json'), JSON.stringify(report, null, 2));
    return report;
  } finally { await browser.close(); }
}

async function main() {
  const args = process.argv.slice(2), options = {};
  for (let i=0;i<args.length;i+=2) {
    if (!['--html','--out-dir','--times','--browser','--puppeteer-package'].includes(args[i]) || !args[i+1]) throw new Error('Usage: --html <local index.html> --out-dir <empty QA dir> [--times 1,3,7] [--browser <path>] [--puppeteer-package <package.json>]');
    options[args[i]] = args[i+1];
  }
  if (!options['--html'] || !options['--out-dir']) throw new Error('--html and --out-dir required');
  const times = options['--times']?.split(',').map(Number);
  if (times?.some(t => !Number.isFinite(t) || t < 0)) throw new Error('Invalid sample times');
  const result = await checkPreview({ html: options['--html'], outDir: options['--out-dir'], times, browserPath: options['--browser'], puppeteerPackage: options['--puppeteer-package'] });
  console.log(JSON.stringify({ status: result.status, issues: result.issues, failingSamples: result.samples.length, frames: result.frames, unavailable: result.unavailable }, null, 2));
  process.exitCode = result.status === 'SAMPLED_GEOMETRY_CLEAR' ? 0 : 1;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(e => { console.error('PREVIEW_UNVERIFIED: ' + e.message); process.exitCode = 2; });
