/* Generate the README screenshots with Playwright.
 *
 *   npm run serve
 *   npm run screenshots
 *
 * Uses the locally installed Chrome; no Playwright browser download needed.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const base = process.env.BASE_URL || 'http://127.0.0.1:8099/';
const out = 'docs/screenshots';
mkdirSync(out, { recursive: true });

const chrome = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const browser = await chromium.launch({ executablePath: chrome, headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  deviceScaleFactor: 1
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', (err) => errors.push(String(err)));
page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });

await page.goto(base, { waitUntil: 'networkidle' });
await page.addStyleTag({ content: '#toasts{display:none!important}' });
await page.waitForTimeout(500);

async function shot(name, options = {}) {
  await page.screenshot({ path: join(out, name), animations: 'disabled', ...options });
  console.log('shot', name);
}

async function waitPaths() {
  await page.waitForFunction(() => {
    const el = document.getElementById('statPaths');
    return el && el.textContent && el.textContent !== '-' && el.textContent !== '—';
  }, null, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(900);
}

// 1. Overview with the built-in demo.
await page.locator('#btnDemo').click();
await waitPaths();
await shot('01-overview.png');

// 2. Uploaded photo: the app auto-selects Sketch and overlays the source.
await page.evaluate(async () => {
  const canvas = document.createElement('canvas');
  canvas.width = 640;
  canvas.height = 480;
  const g = canvas.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 640, 480);
  grad.addColorStop(0, '#101418');
  grad.addColorStop(0.45, '#9aa3ad');
  grad.addColorStop(1, '#f7f4ec');
  g.fillStyle = grad;
  g.fillRect(0, 0, 640, 480);
  g.fillStyle = '#090b0d';
  g.beginPath();
  g.arc(300, 240, 135, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#f7f4ec';
  g.font = 'bold 72px sans-serif';
  g.fillText('PHOTO', 150, 420);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  const file = new File([blob], 'photo.png', { type: 'image/png' });
  const dt = new DataTransfer();
  dt.items.add(file);
  document.getElementById('dropImage').dispatchEvent(new DragEvent('drop', {
    bubbles: true,
    cancelable: true,
    dataTransfer: dt
  }));
});
await page.waitForFunction(() => document.getElementById('imgInfo').textContent.includes('photo.png'), null, { timeout: 20000 }).catch(() => {});
await page.waitForTimeout(1800);
await shot('02-image-sketch.png');
await page.locator('#btnPhotoPreset').click();
await page.waitForTimeout(1600);
await shot('02b-image-halftone.png');
await page.locator('#btnSketchPreset').click();
await page.waitForTimeout(1000);
await page.locator('#pane-image').screenshot({ path: join(out, '03-image-controls.png'), animations: 'disabled' }).catch(() => {});

// 3. SVG import.
await page.locator('.tab[data-tab="svg"]').click();
const sampleSvg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <circle cx="28" cy="30" r="18" fill="none" stroke="#000" stroke-width="2"/>
  <path d="M55 15 L65 45 L95 45 L70 62 L80 92 L55 75 L30 92 L40 62 L15 45 L45 45 Z" fill="none" stroke="#000" stroke-width="2"/>
</svg>`;
await page.setInputFiles('#fileSvg', {
  name: 'sample.svg',
  mimeType: 'image/svg+xml',
  buffer: Buffer.from(sampleSvg)
});
await page.waitForTimeout(1600);
await shot('04-svg.png');

// 4. Text.
await page.locator('.tab[data-tab="text"]').click();
await page.fill('#textInput', 'HELLO WORLD\nPENPLOT');
await page.waitForTimeout(1600);
await shot('05-text.png');

// 5. Simulation.
await page.locator('.tab[data-tab="image"]').click();
await page.locator('#btnDemo').click();
await waitPaths();
await page.locator('#btnSimulate').click();
await page.waitForTimeout(900);
await shot('06-simulation.png');
await page.locator('#btnSimulate').click().catch(() => {});

// 6. Machine controls and settings.
await page.locator('.panel.right').screenshot({ path: join(out, '07-machine-controls.png'), animations: 'disabled' }).catch(() => {});
const rightScroll = page.locator('.panel.right .scroll');
await rightScroll.evaluate((el) => { el.scrollTop = el.scrollHeight; }).catch(() => {});
await page.waitForTimeout(350);
await shot('08-settings.png');

// 7. Small-screen layout.
const mobile = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 1,
  isMobile: true,
  hasTouch: true
});
const mp = await mobile.newPage();
await mp.goto(base, { waitUntil: 'networkidle' });
await mp.addStyleTag({ content: '#toasts{display:none!important}' });
await mp.locator('#btnDemo').click();
await mp.waitForTimeout(1600);
await mp.screenshot({ path: join(out, '09-mobile.png'), fullPage: true, animations: 'disabled' });
console.log('shot 09-mobile.png');

console.log('page errors:', errors.length ? errors : 'none');
await browser.close();
