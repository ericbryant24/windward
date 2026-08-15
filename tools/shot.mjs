/**
 * Screenshot harness: boots the game in headless Chromium and captures frames.
 *
 *   node tools/shot.mjs out.png [query] [--portrait] [--wait=ms]
 */
import { chromium } from 'playwright';

const [, , out = 'shot.png', query = '', ...rest] = process.argv;
const portrait = rest.includes('--portrait');
const waitArg = rest.find((a) => a.startsWith('--wait='));
const wait = waitArg ? Number(waitArg.split('=')[1]) : 2500;

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium',
  args: [
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist',
    '--disable-gpu-sandbox',
  ],
});
const page = await browser.newPage({
  viewport: portrait ? { width: 430, height: 932 } : { width: 1280, height: 720 },
  deviceScaleFactor: 1,
});
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push('[pageerror] ' + (e.stack || e.message)));

const urlArg = rest.find((a) => a.startsWith('--url='));
const target = urlArg ? urlArg.slice(6) : 'http://localhost:8080/index.html';
await page.goto(`${target}${query}`, { waitUntil: 'load' });
try {
  await page.waitForFunction(() => window.WINDWARD?.ready || window.WINDWARD?.error, { timeout: 90000 });
} catch {
  logs.push('[timeout] never became ready');
}
const evalArg = rest.find((a) => a.startsWith('--eval='));
if (evalArg) await page.evaluate(evalArg.slice(7));
await page.waitForTimeout(wait);

const info = await page.evaluate(() => ({
  error: window.WINDWARD?.error,
  frames: window.WINDWARD?.frames,
  stats: window.WINDWARD?.stats?.(),
}));
await page.screenshot({ path: out });
console.log(JSON.stringify(info, null, 2));
if (logs.length) console.log(logs.slice(0, 40).join('\n'));
await browser.close();
