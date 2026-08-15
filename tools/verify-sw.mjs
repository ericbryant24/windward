/**
 * Checks that the offline build is real, in two halves.
 *
 * The static half is the one that stops the precache list rotting. sw.js does
 * not carry a list — it walks index.html to its transitive closure — but a
 * crawler can be wrong in the same silent way a list can, by missing a module
 * that only ever loads at runtime. So this runs sw.js's own deriveShell(), in
 * Node, against the live tree, and then checks the other direction too: every
 * .js under src/ and vendor/ must be reachable from it. Add a module and forget
 * to import it into the graph and this fails by name.
 *
 * The live half boots the game in Chromium, waits for the worker to precache
 * the shell, downloads a map through the menu the way a player would, and then
 * shuts the web server down and reloads. Shutting it down rather than switching
 * Playwright's offline flag on is the point: that flag does not reach fetches
 * made from inside a service worker, so an "offline" run under it quietly
 * passes on requests the worker forwarded to a server that was still there. A
 * dead socket cannot be fooled. The browser cache is emptied first for the same
 * reason, so the only thing left standing is the Cache Storage the worker
 * filled.
 *
 * The test server mounts the game under /windward/ — a project subpath, like
 * GitHub Pages — because scope and relative paths are exactly what a subpath
 * gets wrong.
 *
 *   node tools/verify-sw.mjs [--no-browser] [--map=chicago]
 */
import { readFile, readdir } from 'node:fs/promises';
import { createReadStream, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const PREFIX = '/windward/';
const MAP = arg('map', 'jungfrau');
const SHELL_BUDGET = 4 * 1024 * 1024;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  // Served as-is, with no Content-Encoding: the game gunzips these itself.
  '.gz': 'application/gzip',
};

/** A static server the test owns, so the test can also take it away. */
async function serve() {
  const overrides = new Map();
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (!url.pathname.startsWith(PREFIX)) {
      res.writeHead(404).end();
      return;
    }
    let rel = url.pathname.slice(PREFIX.length) || 'index.html';
    if (rel.endsWith('/')) rel += 'index.html';
    const patch = overrides.get(rel);
    if (patch) {
      res.writeHead(200, {
        'content-type': TYPES[path.extname(rel)] ?? 'application/octet-stream',
        'content-length': Buffer.byteLength(patch),
        'last-modified': new Date().toUTCString(),
        'cache-control': 'no-cache',
      });
      res.end(req.method === 'HEAD' ? undefined : patch);
      return;
    }
    const file = path.join(ROOT, rel);
    if (!file.startsWith(ROOT)) {
      res.writeHead(403).end();
      return;
    }
    let stat;
    try {
      stat = statSync(file);
    } catch {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
      return;
    }
    res.writeHead(200, {
      'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream',
      'content-length': stat.size,
      'last-modified': stat.mtime.toUTCString(),
      'cache-control': 'no-cache',
    });
    if (req.method === 'HEAD') res.end();
    else createReadStream(file).pipe(res);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${server.address().port}${PREFIX}`;
  return {
    origin,
    /** Stand in for a redeploy: change one file under the running site. */
    override: (rel, body) => overrides.set(rel, body),
    stop: () =>
      new Promise((r) => {
        server.closeAllConnections?.();
        server.close(r);
      }),
  };
}

const site = await serve();
const ORIGIN = site.origin;

let bad = 0;
const check = (ok, label, detail = '') => {
  if (!ok) bad++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? `  ${detail}` : ''}`);
  return ok;
};

// ------------------------------------------------------- the real crawler ---
/**
 * Run sw.js in Node and take its deriveShell out. Wrapping the source in a
 * function whose only parameter is `self` is enough of a worker: the file only
 * touches worker globals through `self.`, and nothing but listener registration
 * happens at the top level.
 */
async function loadWorker() {
  const source = await readFile(path.join(ROOT, 'sw.js'), 'utf8');
  const listeners = [];
  const fakeSelf = {
    addEventListener: (type) => listeners.push(type),
    location: { href: `${ORIGIN}sw.js`, origin: new URL(ORIGIN).origin },
    registration: null,
    fetch: (url, init) => fetch(url, init),
    caches: null,
    clients: null,
    crypto: globalThis.crypto,
  };
  const factory = vm.runInThisContext(`(function (self) { ${source}\n; return self.WINDWARD_SW; })`, {
    filename: 'sw.js',
  });
  const api = factory(fakeSelf);
  return { api, listeners };
}

console.log(`service worker — ${ORIGIN}`);

const { api, listeners } = await loadWorker();
check(typeof api?.deriveShell === 'function', 'sw.js exposes its crawler to the verifier');
for (const type of ['install', 'activate', 'fetch', 'message']) {
  check(listeners.includes(type), `sw.js handles "${type}"`);
}

const shell = await api.deriveShell({ base: ORIGIN });
const rel = shell.map((u) => u.slice(ORIGIN.length));
console.log(`\nderived shell: ${shell.length} files`);

// --------------------------------------------------- the list is complete ---
async function walk(dir, out = []) {
  for (const entry of await readdir(path.join(ROOT, dir), { withFileTypes: true })) {
    const p = `${dir}/${entry.name}`;
    if (entry.isDirectory()) await walk(p, out);
    else out.push(p);
  }
  return out;
}

const onDisk = [...(await walk('src')), ...(await walk('vendor'))].filter((p) => p.endsWith('.js'));
const missing = onDisk.filter((p) => !rel.includes(p));
check(
  missing.length === 0,
  'every module on disk is reachable from index.html',
  missing.length ? `unreachable: ${missing.join(', ')}` : `${onDisk.length} modules`
);

const ghosts = rel.filter((p) => {
  try {
    return !statSync(path.join(ROOT, p)).isFile();
  } catch {
    return true;
  }
});
check(ghosts.length === 0, 'every derived URL is a file that exists', ghosts.join(', '));

for (const required of ['index.html', 'src/main.js', 'src/ui/style.css', 'manifest.webmanifest', 'vendor/three.module.js', 'vendor/three.core.js']) {
  check(rel.includes(required), `shell contains ${required}`);
}

// -------------------------------------------------- the shell stays small ---
let shellBytes = 0;
for (const p of rel) shellBytes += statSync(path.join(ROOT, p)).size;
check(
  shellBytes < SHELL_BUDGET,
  'shell fits its precache budget',
  `${(shellBytes / 1048576).toFixed(2)} MB of ${(SHELL_BUDGET / 1048576).toFixed(0)} MB`
);
// The whole design rests on map data never getting swept into the shell.
check(
  !rel.some((p) => p.startsWith('data/')),
  'no map data precached',
  rel.filter((p) => p.startsWith('data/')).join(', ')
);

// ------------------------------------------------- subpath-safe URLs only ---
const manifest = JSON.parse(await readFile(path.join(ROOT, 'manifest.webmanifest'), 'utf8'));
check(!manifest.start_url.startsWith('/'), 'manifest start_url is relative', manifest.start_url);
check(!manifest.scope.startsWith('/'), 'manifest scope is relative', manifest.scope);
check(
  manifest.icons.every((i) => !i.src.startsWith('/')) && manifest.icons.length >= 2,
  'manifest icons are relative'
);
check(
  manifest.icons.some((i) => (i.purpose || '').includes('maskable')),
  'manifest ships a maskable icon'
);
for (const icon of manifest.icons) {
  check(statSync(path.join(ROOT, icon.src)).size > 0, `icon exists: ${icon.src}`);
}

const html = await readFile(path.join(ROOT, 'index.html'), 'utf8');
const rooted = [...html.matchAll(/\b(?:src|href)\s*=\s*"(\/[^/"][^"]*)"/g)].map((m) => m[1]);
check(rooted.length === 0, 'index.html has no origin-rooted URLs', rooted.join(', '));
const swSource = await readFile(path.join(ROOT, 'sw.js'), 'utf8');
check(!/register\(\s*['"]\//.test(swSource), 'sw.js registers nothing at the origin root');

if (process.argv.includes('--no-browser')) {
  await site.stop();
  finish();
}

// ------------------------------------------------------ it actually works ---
const { chromium } = await import('playwright');
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
// A fresh context every run: a stale worker from a previous run would make a
// pass here mean nothing.
const context = await browser.newContext({ viewport: { width: 430, height: 932 }, hasTouch: true });
const page = await context.newPage();
const problems = [];
let phase = 'online';
page.on('console', (m) => {
  if (m.type() !== 'error') return;
  // Chrome logs every failed subresource as an error. Once the server is gone
  // this run deliberately asks for something that is not cached, and the
  // worker's 503 placeholder is the correct answer to that, not a fault.
  if (phase === 'offline' && /status of 503 \(Offline\)/.test(m.text())) return;
  problems.push(`console: ${m.text()}`);
});
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));

const step = async (label, fn) => {
  try {
    const detail = await fn();
    console.log(`  ok    ${label}${detail ? `  ${detail}` : ''}`);
  } catch (err) {
    bad++;
    console.log(`  FAIL  ${label}: ${err.message}`);
  }
};

console.log('\nonline');
await page.goto(`${ORIGIN}index.html?map=${MAP}`, { waitUntil: 'load' });
await page.waitForFunction(() => window.WINDWARD?.ready || window.WINDWARD?.error, { timeout: 120000 });

await step('boots online', async () => {
  const err = await page.evaluate(() => window.WINDWARD.error);
  if (err) throw new Error(err);
  await page.waitForSelector('.menu.open', { timeout: 60000 });
});

await step('worker installs and precaches the shell', async () => {
  await page.waitForFunction(() => window.WINDWARD.offline?.state.buildId, { timeout: 120000 });
  const build = await page.evaluate(() => window.WINDWARD.offline.state.buildId);
  const controlled = await page.evaluate(() => !!navigator.serviceWorker.controller);
  if (!controlled) throw new Error('page is not controlled by the worker');
  return `build ${build}`;
});

await step('a redeploy lands as one whole new build', async () => {
  const before = await page.evaluate(() => window.WINDWARD.offline.state.buildId);
  const marker = `// redeploy ${Date.now()}`;
  const target = 'src/store.js';
  site.override(target, (await readFile(path.join(ROOT, target), 'utf8')) + `\n${marker}\n`);

  const result = await page.evaluate(() => window.WINDWARD.offline.checkForUpdate());
  if (!result) throw new Error('the changed build was not noticed');
  const after = await page.evaluate(() => window.WINDWARD.offline.state.buildId);
  if (after === before) throw new Error(`build id did not move from ${before}`);

  // The half-old, half-new failure would show up here: two shell caches alive
  // at once, or a shell whose store.js is the old one while its id is the new.
  const state = await page.evaluate(
    async ([prefix, url]) => {
      const shells = (await caches.keys()).filter((n) => n.startsWith(prefix));
      const cache = await caches.open(shells[0]);
      const seal = await (await cache.match(new URL('__windward-shell.json', location.href))).json();
      const stored = [];
      for (const u of seal.urls) if (!(await cache.match(u))) stored.push(u);
      return { shells, missing: stored, store: await (await cache.match(url)).text(), files: seal.urls.length };
    },
    [api.SHELL_PREFIX, `${ORIGIN}${target}`]
  );
  if (state.shells.length !== 1) throw new Error(`${state.shells.length} shell caches: ${state.shells.join(', ')}`);
  if (state.shells[0] !== `${api.SHELL_PREFIX}${after}`) throw new Error(`cache ${state.shells[0]} is not build ${after}`);
  if (state.missing.length) throw new Error(`build is incomplete: ${state.missing.join(', ')}`);
  if (!state.store.includes(marker)) throw new Error('the new build kept the old file');
  return `${before} -> ${after}, ${state.files} files, old cache swept`;
});

await step('the menu offers the map with a size on it', async () => {
  const row = page.locator(`.offline-map:has([data-value="${MAP}"])`);
  await row.waitFor({ timeout: 30000 });
  await page.waitForFunction(
    (id) => /\d/.test(document.querySelector(`.offline-map:has([data-value="${id}"]) em`)?.textContent ?? ''),
    MAP,
    { timeout: 30000 }
  );
  const label = (await row.locator('em').textContent()).trim();
  if (!/MB|kB/.test(label)) throw new Error(`size label reads "${label}"`);
  return label;
});

await step('downloading the map reports progress', async () => {
  // Watch the bar rather than the result: "with visible progress" is the
  // requirement, and a download that only ever reports 0% then 100% is not it.
  const seen = await page.evaluate(async (id) => {
    const values = new Set();
    const off = window.WINDWARD.offline;
    const previous = off.onChange;
    off.onChange = () => {
      values.add(Math.round(off.progress * 100));
      previous();
    };
    await off.download(id);
    off.onChange = previous;
    return [...values];
  }, MAP);
  const partial = seen.filter((v) => v > 0 && v < 100);
  if (!partial.length) throw new Error(`progress only reported ${seen.join(', ')}`);
  return `${seen.length} updates, ${partial.length} of them partial`;
});

await step('the map now says it is on the device', async () => {
  await page.waitForFunction(
    (id) =>
      window.WINDWARD.offline.cached(id) &&
      /device/.test(document.querySelector(`.offline-map:has([data-value="${id}"]) em`)?.textContent ?? ''),
    MAP,
    { timeout: 30000 }
  );
  return (await page.locator(`.offline-map:has([data-value="${MAP}"]) em`).textContent()).trim();
});

console.log('\noffline');
phase = 'offline';
// Empty the HTTP cache first, or a reload could be served by Chrome from bytes
// it happens to still be holding rather than by the worker.
const cdp = await context.newCDPSession(page);
await cdp.send('Network.clearBrowserCache');
await context.setOffline(true);
await site.stop();

await step('nothing is reachable any more', async () => {
  const reached = await page.evaluate(async (origin) => {
    try {
      const res = await fetch(`${origin}data/does-not-exist-${Date.now()}.png`);
      return `HTTP ${res.status}${res.headers.get('x-windward-offline') ? ' (worker placeholder)' : ' from somewhere'}`;
    } catch (err) {
      return `refused: ${err.message}`;
    }
  }, ORIGIN);
  // The worker's own 503 placeholder is the right answer; a 200 means the
  // server is still up and the rest of this section proves nothing.
  if (!/worker placeholder|refused/.test(reached)) throw new Error(reached);
  return reached;
});

await step('reloads with no network', async () => {
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => window.WINDWARD?.ready || window.WINDWARD?.error, { timeout: 180000 });
  const err = await page.evaluate(() => window.WINDWARD.error);
  if (err) throw new Error(err);
  const blocked = await page.evaluate(() => window.WINDWARD.blocked);
  if (blocked) throw new Error(`boot was blocked: ${blocked}`);
  await page.waitForSelector('.menu.open', { timeout: 90000 });
});

await step('flies with no network', async () => {
  await page.click('[data-action="start"][data-value="free"]');
  await page.waitForSelector('.flight.open', { timeout: 10000 });
  const before = await page.evaluate(() => window.WINDWARD.stats());
  const box = await page.evaluate(() => ({ w: innerWidth, h: innerHeight }));
  await page.mouse.move(box.w * 0.2, box.h * 0.75);
  await page.mouse.down();
  await page.mouse.move(box.w * 0.2 + 70, box.h * 0.75, { steps: 5 });
  await page.waitForTimeout(3000);
  await page.mouse.up();
  const after = await page.evaluate(() => window.WINDWARD.stats());
  const bank = await page.evaluate(() => window.WINDWARD.game.glider.bankDeg);
  if (after.phase !== 'flying') throw new Error(`phase ${after.phase}`);
  if (!isFinite(after.alt) || after.alt < 200) throw new Error(`altitude ${after.alt}`);
  if (bank < 12) throw new Error(`stick right produced bank ${bank.toFixed(1)}deg`);
  return `alt ${before.alt}->${after.alt} m, bank ${bank.toFixed(0)}deg`;
});

await step('the world is really there, not a stub', async () => {
  // Buildings and terrain come out of the cached data files; if the worker had
  // served an empty or truncated body the game would still boot and be empty.
  const s = await page.evaluate(() => window.WINDWARD.stats());
  if (!s.buildingTiles && !s.trees) throw new Error('no buildings and no trees loaded');
  const cells = await page.evaluate(() => window.WINDWARD.hf.size);
  if (!(cells > 256)) throw new Error(`heightfield is ${cells} cells across`);
  return `${cells}^2 terrain, ${s.buildingTiles} building tiles, ${s.trees} trees`;
});

await step('an undownloaded map says so instead of hanging', async () => {
  const other = await page.evaluate(
    (id) => window.WINDWARD.offline.regions().map((r) => r.id).find((r) => r !== id),
    MAP
  );
  if (!other) return 'only one region exists';
  await page.goto(`${ORIGIN}index.html?map=${other}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.WINDWARD?.ready || window.WINDWARD?.error, { timeout: 120000 });
  // Either it falls back to the map that is here, or it says plainly that it
  // cannot. What it must not do is throw a stack trace at the player.
  const err = await page.evaluate(() => window.WINDWARD.error);
  if (err) throw new Error(err);
  const flown = await page.evaluate(() => window.WINDWARD.region?.id);
  const blocked = await page.evaluate(() => window.WINDWARD.blocked);
  if (blocked) {
    await page.waitForSelector('.offline-block.on', { timeout: 5000 });
    return 'showed the no-connection panel';
  }
  if (flown !== MAP) throw new Error(`fell back to ${flown}`);
  await page.waitForSelector('.menu.open', { timeout: 90000 });
  return `fell back to ${flown}`;
});

await step('with nothing stored and nothing reachable, it says so', async () => {
  // The genuine dead end. Throw the map away while still offline, which is a
  // cache deletion and needs no network, then reload into nothing.
  await page.evaluate((id) => window.WINDWARD.offline.remove(id), MAP);
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => window.WINDWARD?.ready || window.WINDWARD?.error, { timeout: 120000 });
  const err = await page.evaluate(() => window.WINDWARD.error);
  if (err) throw new Error(err);
  await page.waitForSelector('.offline-block.on', { timeout: 10000 });
  const text = (await page.locator('.offline-block-msg').textContent()).trim();
  if (!(await page.isVisible('[data-action="offline-retry"]'))) throw new Error('no way out of the panel');
  return `"${text.slice(0, 58)}…"`;
});

// A console error offline is the whole failure mode this is here to catch, so
// it counts as a failure rather than a note.
if (problems.length) {
  bad += problems.length;
  console.log('\npage problems:\n' + problems.map((p) => ' - ' + p).join('\n'));
}

await browser.close();
await site.stop();
finish();

function finish() {
  console.log(bad ? `\n${bad} problem(s)` : '\nall good');
  process.exit(bad ? 1 : 0);
}
