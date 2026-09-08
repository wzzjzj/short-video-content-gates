// Read-only static browser preflight. No page scripts, network, rendering or publishing.
import { createRequire } from 'node:module';
import { readFile, access } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

export function auditDocument(core) {
  const failures = [];
  const rect = r => ({ x: r.x, y: r.y, width: r.width, height: r.height });
  const label = e => e.id ? '#' + e.id : e.tagName.toLowerCase() + (e.className && typeof e.className === 'string' ? '.' + e.className.trim().split(/\s+/).join('.') : '');
  const hidden = e => {
    for (let p = e; p; p = p.parentElement) {
      const s = getComputedStyle(p);
      if (p.hidden || s.display === 'none' || s.visibility !== 'visible' || Number(s.opacity) === 0 || s.contentVisibility === 'hidden') return true;
    }
    return false;
  };
  const transparent = e => {
    const s = getComputedStyle(e);
    return s.color === 'transparent' || /rgba\([^)]*,\s*0\s*\)/.test(s.color) || s.webkitTextFillColor === 'transparent';
  };
  const within = (a, b) => a.x >= b.x - .5 && a.y >= b.y - .5 && a.x + a.width <= b.x + b.width + .5 && a.y + a.height <= b.y + b.height + .5;
  const clipped = (r, e) => {
    for (let p = e; p; p = p.parentElement) {
      const s = getComputedStyle(p), b = p.getBoundingClientRect();
      if (/(hidden|clip|scroll|auto)/.test(s.overflowX) && (r.x < b.x - .5 || r.right > b.right + .5)) return true;
      if (/(hidden|clip|scroll|auto)/.test(s.overflowY) && (r.y < b.y - .5 || r.bottom > b.bottom + .5)) return true;
    }
    return false;
  };
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const textNodes = [];
  while (walker.nextNode()) {
    const n = walker.currentNode;
    if (n.textContent.trim() && !n.parentElement.closest('script,style,template,noscript')) textNodes.push(n);
  }
  for (const e of document.querySelectorAll('[data-config-key]')) {
    const nodes = textNodes.filter(n => e.contains(n));
    const bad = hidden(e) || !nodes.length || nodes.some(n => {
      const p = n.parentElement, range = document.createRange();
      range.selectNodeContents(n);
      const r = range.getBoundingClientRect();
      return hidden(p) || transparent(p) || parseFloat(getComputedStyle(p).fontSize) <= 1 || !r.width || !r.height || clipped(r, p);
    });
    if (bad) failures.push({ code: 'CONFIG_NOT_VISIBLE', element: label(e), key: e.getAttribute('data-config-key') });
  }
  if (core) {
    for (const n of textNodes) {
      const p = n.parentElement;
      if (hidden(p) || transparent(p)) continue;
      const range = document.createRange(); range.selectNodeContents(n);
      const r = range.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      if (!within(r, core) || clipped(r, p)) failures.push({ code: 'TEXT_OUTSIDE_OR_CLIPPED', element: label(p), text: n.textContent.trim().slice(0, 100), bounds: rect(r) });
    }
    for (const e of document.querySelectorAll('[data-readable], img[alt*="Logo" i], img[alt*="logo"], img[class*="logo"]')) {
      if (hidden(e)) continue;
      const r = e.getBoundingClientRect();
      if (r.width && r.height && (!within(r, core) || clipped(r, e))) failures.push({ code: 'READABLE_OUTSIDE_OR_CLIPPED', element: label(e), bounds: rect(r) });
    }
  }
  return { failures, bindings: document.querySelectorAll('[data-config-key]').length, textNodes: textNodes.length };
}

export async function checkFile({ html, platform, browserPath, puppeteerPackage }) {
  if (platform && platform !== 'douyin') throw new Error('Only douyin has a verified shared geometry baseline. Omit --platform for binding visibility only.');
  const source = resolve(html); await access(source);
  const packagePath = puppeteerPackage || join(process.env.APPDATA || '', 'npm/node_modules/hyperframes/package.json');
  const puppeteer = createRequire(resolve(packagePath))('puppeteer-core');
  const executablePath = browserPath || join(process.env['ProgramFiles(x86)'] || 'C:/Program Files (x86)', 'Microsoft/Edge/Application/msedge.exe');
  await access(executablePath);
  const baseline = platform === 'douyin' ? JSON.parse(await readFile(new URL('../references/douyin-1080x1920-safe-zones.json', import.meta.url), 'utf8')) : null;
  const browser = await puppeteer.launch({ executablePath, headless: true });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: baseline?.canvas.width || 1080, height: baseline?.canvas.height || 1920 });
    await page.setJavaScriptEnabled(false);
    const blockedStyles = [];
    await page.setRequestInterception(true);
    page.on('request', request => {
      if (/^(file:|data:|about:)/.test(request.url())) request.continue();
      else { if (request.resourceType() === 'stylesheet' || request.resourceType() === 'font') blockedStyles.push(request.resourceType()); request.abort(); }
    });
    await page.goto(pathToFileURL(source).href, { waitUntil: 'load', timeout: 15000 });
    await page.addStyleTag({ content: '*,*::before,*::after{animation:none!important;transition:none!important}' });
    const result = await page.evaluate(auditDocument, baseline?.core || null);
    return { mode: 'static-preflight', status: result.failures.length ? 'BLOCK' : blockedStyles.length || !result.textNodes ? 'INCOMPLETE' : 'NO_STATIC_FINDINGS', ...result,
      limitations: ['Page JavaScript and animation are disabled; no timeline, occlusion, photo identity, audio or cover-crop approval.', 'Canvas, SVG, pseudo-element text and unmarked image labels require rendered review.', 'No findings is not pre-production PASS. Inspect actual rendered frames and continuous playback.', ...(!result.textNodes ? ['No inspectable HTML text; script-generated content may be absent.'] : []), ...(blockedStyles.length ? ['External styles/fonts were blocked; actual layout remains unverified.'] : [])] };
  } finally { await browser.close(); }
}

async function main() {
  const args = process.argv.slice(2);
  const values = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!['--html', '--platform', '--browser', '--puppeteer-package'].includes(args[i]) || !args[i + 1]) throw new Error('Usage: node check-visible-layout.mjs --html <index.html> [--platform douyin] [--browser <executable>] [--puppeteer-package <package.json>]');
    values[args[i]] = args[i + 1];
  }
  if (!values['--html']) throw new Error('--html is required');
  const result = await checkFile({ html: values['--html'], platform: values['--platform'], browserPath: values['--browser'], puppeteerPackage: values['--puppeteer-package'] });
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.status === 'NO_STATIC_FINDINGS' ? 0 : 1;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error('PRECHECK_UNVERIFIED: ' + error.message); process.exitCode = 2; });
