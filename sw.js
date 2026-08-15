/**
 * Windward offline.
 *
 * Two questions decide everything in here.
 *
 * WHAT GETS CACHED, AND WHEN. The app shell is about 2.4 MB — three quarters of
 * it three.js — and every session needs all of it whichever map you fly, so it
 * is precached as one unit. The maps are not: Jungfrau's data is 4.3 MB and
 * Chicago's 4.5, and pulling either down uninvited would more than double a
 * first visit for a player who may never go offline at all. Map data is cached
 * only when the player asks for it by name, from the menu, with a progress bar
 * and a byte count in front of them. The page also holds the shell install back
 * until the first flight has loaded, so the precache never competes for
 * bandwidth with the map somebody is waiting on.
 *
 * WHAT THE SHELL ACTUALLY IS. Not a list. A hand-written list is fine on the day
 * it is written and quietly wrong a week later, when the module that got added
 * is the one module that is missing offline. So the shell is walked: index.html
 * gives the stylesheet, the import map and the entry module, each module gives
 * its own imports, the manifest gives its icons, and the closure of that is the
 * shell. tools/verify-sw.mjs runs this same function against the real tree and
 * fails if anything on disk is unreachable from it.
 *
 * VERSIONING. The cache is named after a hash of every byte in the derived
 * graph, so a redeploy lands in a new cache rather than on top of the old one.
 * Nothing is served from the new cache until all of it is stored and the state
 * record is flipped to point at it, which is what stops a half-old, half-new
 * app: a page load reads one pointer and gets one consistent build. Map data
 * lives in its own cache that survives redeploys — a rebaked map is noticed by
 * tag and refetched file by file, rather than by throwing away 4 MB the player
 * chose to download.
 *
 * Everything here is scope-relative. The site is served from a project subpath
 * (/windward/ on GitHub Pages) and a single leading slash anywhere would break
 * it, so URLs are resolved against the registration scope and anything outside
 * it is left alone.
 */
'use strict';

const SHELL_PREFIX = 'windward-shell-';
const MAPS_CACHE = 'windward-maps-v1';
const STATE_CACHE = 'windward-state-v1';

/** The document the whole graph is walked from. */
const ENTRY = 'index.html';

/** Bookkeeping lives at synthetic in-scope URLs; no real file has these names. */
const STATE_KEY = '__windward-state.json';
const SHELL_SEAL = '__windward-shell.json';

/** Byte length and change tag, kept on stored responses so revalidation is a HEAD. */
const LEN_HEADER = 'x-windward-len';
const TAG_HEADER = 'x-windward-tag';

function scopeUrl() {
  // registration.scope in a worker; sw.js sits at the app root, so its own
  // directory is the same thing and lets the verifier run this file in Node.
  return self.registration ? self.registration.scope : new URL('./', self.location.href).href;
}

// ---------------------------------------------------------------- parsing ---

const TAG_RE = /<(script|link)\b([^>]*?)\/?>/gi;
const ATTR_RE = /([a-zA-Z-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
const IMPORTMAP_RE = /<script\b[^>]*\btype\s*=\s*["']importmap["'][^>]*>([\s\S]*?)<\/script>/i;

// Static `import x from 'y'` / `export * from 'y'`, side-effect `import 'y'`,
// and dynamic `import('y')`. Anything computed at runtime cannot be walked
// statically by anyone, which is why verify-sw.mjs also checks the other
// direction: every file on disk must be reachable from here.
const JS_FROM_RE = /\b(?:import|export)\b[^;'"()]*?\bfrom\s*['"]([^'"]+)['"]/g;
const JS_SIDE_RE = /\bimport\s+['"]([^'"]+)['"]/g;
const JS_DYNAMIC_RE = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
const CSS_URL_RE = /url\(\s*['"]?([^'")]+)['"]?\s*\)/g;
const CSS_IMPORT_RE = /@import\s+(?:url\(\s*)?['"]([^'"]+)['"]/g;

function attrs(text) {
  const out = {};
  ATTR_RE.lastIndex = 0;
  for (let m; (m = ATTR_RE.exec(text)); ) out[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? '';
  return out;
}

function matchAll(re, text, fn) {
  re.lastIndex = 0;
  for (let m; (m = re.exec(text)); ) fn(m[1]);
}

/**
 * Walk index.html to its transitive closure of modules, styles and icons.
 *
 * @param {{base?: string, fetch?: (url: string) => Promise<Response>}} [opts]
 * @returns {Promise<string[]>} absolute, in-scope URLs, sorted and unique
 */
async function deriveShell(opts) {
  const base = (opts && opts.base) || scopeUrl();
  const get = (opts && opts.fetch) || ((url) => self.fetch(url, { cache: 'no-cache' }));

  const seen = new Map(); // href -> 'html' | 'js' | 'css' | 'manifest' | 'asset'
  const queue = [];
  let importMap = { imports: {} };

  const kindOf = (href) => {
    if (href.endsWith('.js') || href.endsWith('.mjs')) return 'js';
    if (href.endsWith('.css')) return 'css';
    if (href.endsWith('.webmanifest') || href.endsWith('manifest.json')) return 'manifest';
    return 'asset';
  };

  // `module` marks a JavaScript import specifier rather than a plain URL in
  // markup: only those go through the import map, and only those can be bare.
  const add = (spec, from, kind, module) => {
    if (!spec) return;
    // `three` has to reach vendor/three.module.js the same way the browser
    // gets it there. Import map values resolve against the document, not
    // against the importing module.
    const bare = module && !/^(?:\.{1,2}\/|\/)/.test(spec) && !/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(spec);
    let target = spec;
    let against = from;
    if (bare) {
      const map = importMap.imports || {};
      let mapped = map[spec];
      if (!mapped) {
        for (const key of Object.keys(map)) {
          if (key.endsWith('/') && spec.startsWith(key)) {
            mapped = map[key] + spec.slice(key.length);
            break;
          }
        }
      }
      if (!mapped) return; // no mapping, so not something this origin serves
      target = mapped;
      against = base;
    }
    let href;
    try {
      href = new URL(target, against).href;
    } catch {
      return; // data: and other things a cache has no business storing
    }
    href = href.split('#')[0];
    // Off-origin or outside the registration scope is somebody else's problem.
    if (!href.startsWith(base)) return;
    if (seen.has(href)) return;
    const k = kind || kindOf(href);
    seen.set(href, k);
    if (k !== 'asset') queue.push([href, k]);
  };

  add(ENTRY, base, 'html');

  while (queue.length) {
    const [href, kind] = queue.shift();
    const res = await get(href);
    if (!res || !res.ok) throw new Error(`${href}: HTTP ${res ? res.status : 'no response'}`);
    const text = await res.text();

    if (kind === 'html') {
      const im = IMPORTMAP_RE.exec(text);
      if (im) {
        try {
          importMap = JSON.parse(im[1]);
        } catch {
          throw new Error('index.html: import map is not valid JSON');
        }
      }
      TAG_RE.lastIndex = 0;
      for (let m; (m = TAG_RE.exec(text)); ) {
        const a = attrs(m[2]);
        if (m[1].toLowerCase() === 'script') {
          add(a.src, href);
        } else {
          const rel = (a.rel || '').toLowerCase();
          if (/\b(stylesheet|manifest|icon|apple-touch-icon|preload)\b/.test(rel)) add(a.href, href);
        }
      }
    } else if (kind === 'js') {
      matchAll(JS_FROM_RE, text, (s) => add(s, href, null, true));
      matchAll(JS_SIDE_RE, text, (s) => add(s, href, null, true));
      matchAll(JS_DYNAMIC_RE, text, (s) => add(s, href, null, true));
    } else if (kind === 'css') {
      matchAll(CSS_IMPORT_RE, text, (s) => add(s, href));
      matchAll(CSS_URL_RE, text, (s) => add(s, href));
    } else if (kind === 'manifest') {
      const json = JSON.parse(text);
      for (const icon of json.icons || []) add(icon.src, href);
      for (const s of json.shortcuts || []) for (const icon of s.icons || []) add(icon.src, href);
    }
  }

  return [...seen.keys()].sort();
}

// ------------------------------------------------------------- versioning ---

async function sha256Hex(buffer) {
  const digest = await self.crypto.subtle.digest('SHA-256', buffer);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** A tag that changes when the file does, without downloading it again. */
function changeTag(res) {
  return (
    res.headers.get('etag') ||
    res.headers.get('last-modified') ||
    res.headers.get('content-length') ||
    ''
  );
}

/**
 * Re-serve fetched bytes from the cache without lying about them. The transfer
 * encoding was already undone by fetch(), so carrying Content-Encoding or the
 * wire Content-Length across would make the cached copy undecodable — which
 * matters here, where the map data is .bin.gz that the game gunzips itself.
 */
function storable(res, buffer) {
  const headers = new Headers();
  for (const [k, v] of res.headers.entries()) {
    if (k === 'content-encoding' || k === 'content-length') continue;
    headers.set(k, v);
  }
  headers.set(LEN_HEADER, String(buffer.byteLength));
  headers.set(TAG_HEADER, changeTag(res));
  return new Response(buffer, { status: 200, statusText: 'OK', headers });
}

async function readState() {
  try {
    const cache = await self.caches.open(STATE_CACHE);
    const res = await cache.match(new URL(STATE_KEY, scopeUrl()).href);
    if (res) return await res.json();
  } catch {
    /* first run, or storage was cleared under us */
  }
  return { shell: null, buildId: null, maps: {} };
}

async function writeState(state) {
  const cache = await self.caches.open(STATE_CACHE);
  await cache.put(
    new URL(STATE_KEY, scopeUrl()).href,
    new Response(JSON.stringify(state), { headers: { 'content-type': 'application/json' } })
  );
}

/** Fetch with a small concurrency cap: enough to hide latency, not enough to stall a phone. */
async function fetchAll(urls, mode, onEach) {
  const results = new Array(urls.length);
  let next = 0;
  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= urls.length) return;
      const res = await self.fetch(urls[i], { cache: mode });
      if (!res.ok) throw new Error(`${urls[i]}: HTTP ${res.status}`);
      const buffer = await res.arrayBuffer();
      results[i] = { url: urls[i], res, buffer };
      if (onEach) onEach(results[i]);
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  return results;
}

/**
 * Derive, download, hash, store, then publish — in that order.
 *
 * Publishing last is the whole point. Every fetch has to succeed and every byte
 * has to be in the new cache before any page is pointed at it, so a deploy that
 * lands mid-install, or a phone that loses signal halfway, leaves the previous
 * build serving intact rather than a shell with two files missing.
 *
 * @param {'reload'|'no-cache'} mode 'reload' ignores the HTTP cache outright;
 *   'no-cache' revalidates, so an update check that finds nothing new costs a
 *   round of 304s rather than 2.4 MB.
 */
async function publishShell(mode) {
  const urls = await deriveShell();
  const parts = await fetchAll(urls, mode);

  const lines = [];
  for (const part of parts) lines.push(`${part.url} ${await sha256Hex(part.buffer)}`);
  const buildId = (await sha256Hex(new TextEncoder().encode(lines.join('\n')))).slice(0, 16);

  const name = SHELL_PREFIX + buildId;
  const sealUrl = new URL(SHELL_SEAL, scopeUrl()).href;
  const cache = await self.caches.open(name);
  if (!(await cache.match(sealUrl))) {
    // No seal means either a fresh build or an install that died partway, and
    // there is no way to tell the two apart — so write the whole thing again.
    for (const part of parts) await cache.put(part.url, storable(part.res, part.buffer));
    await cache.put(
      sealUrl,
      new Response(JSON.stringify({ buildId, urls, bytes: totalBytes(parts), at: Date.now() }), {
        headers: { 'content-type': 'application/json' },
      })
    );
  }

  const state = await readState();
  const changed = state.buildId !== buildId;
  state.shell = name;
  state.buildId = buildId;
  state.shellBytes = totalBytes(parts);
  await writeState(state);
  await sweep(name);
  return { buildId, changed, bytes: state.shellBytes };
}

function totalBytes(parts) {
  let n = 0;
  for (const part of parts) n += part.buffer.byteLength;
  return n;
}

/** Drop shell caches from earlier builds. The maps cache is deliberately spared. */
async function sweep(keep) {
  for (const name of await self.caches.keys()) {
    if (name.startsWith(SHELL_PREFIX) && name !== keep) await self.caches.delete(name);
  }
}

// ---------------------------------------------------------------- serving ---

async function shellCache() {
  const state = await readState();
  return state.shell ? await self.caches.open(state.shell) : null;
}

/** Everything the player has chosen to keep, plus the shell, in one lookup. */
async function cachedMatch(url) {
  const shell = await shellCache();
  if (shell) {
    const hit = await shell.match(url);
    if (hit) return hit;
  }
  const maps = await self.caches.open(MAPS_CACHE);
  return (await maps.match(url)) || null;
}

function offlineResponse(url) {
  return new Response(JSON.stringify({ offline: true, url }), {
    status: 503,
    statusText: 'Offline',
    headers: { 'content-type': 'application/json', 'x-windward-offline': '1' },
  });
}

async function handleNavigate(request) {
  // Any URL under the scope is the same document — ?map=chicago, /windward/,
  // /windward/index.html — so they all resolve to the one cached entry.
  const entry = new URL(ENTRY, scopeUrl()).href;
  const hit = await cachedMatch(entry);
  if (hit) return hit;
  try {
    return await self.fetch(request);
  } catch {
    return new Response(
      '<!doctype html><meta charset="utf-8"><title>Windward</title>' +
        '<body style="background:#060d15;color:#eef5fc;font:15px system-ui;display:grid;place-items:center;height:100vh;margin:0">' +
        '<p>Windward is not installed for offline use yet. Reconnect once and it will be.</p>',
      { status: 503, headers: { 'content-type': 'text/html; charset=utf-8' } }
    );
  }
}

async function handleGet(request) {
  const hit = await cachedMatch(request.url);
  if (hit) return hit;
  try {
    // Deliberately not written to any cache. Map data is 4 MB a time and the
    // player decides when to spend that, not a stray fetch.
    return await self.fetch(request);
  } catch {
    return offlineResponse(request.url);
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(publishShell('reload'));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      await sweep((await readState()).shell);
      // Claim so the first visit is covered without a reload; the shell cache
      // pointer, not the controller, is what keeps a build consistent.
      await self.clients.claim();
    })()
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }
  if (url.origin !== self.location.origin) return;
  if (request.mode === 'navigate') {
    event.respondWith(handleNavigate(request));
    return;
  }
  if (!url.href.startsWith(scopeUrl())) return;
  event.respondWith(handleGet(request));
});

// ------------------------------------------------------------- map storage ---

function inScope(urls) {
  const base = scopeUrl();
  return urls.map((u) => new URL(u, base).href).filter((u) => u.startsWith(base));
}

/** What a map costs, before the player commits to it. HEAD, so it costs nothing. */
async function measure(urls) {
  let bytes = 0;
  let known = true;
  for (const url of inScope(urls)) {
    const cached = await cachedMatch(url);
    if (cached) {
      bytes += Number(cached.headers.get(LEN_HEADER) || 0);
      continue;
    }
    try {
      const res = await self.fetch(url, { method: 'HEAD', cache: 'no-cache' });
      const len = Number(res.headers.get('content-length') || 0);
      if (!res.ok || !len) known = false;
      else bytes += len;
    } catch {
      known = false;
    }
  }
  return { bytes, known };
}

async function download(id, urls, onProgress) {
  const list = inScope(urls);
  const { bytes: total } = await measure(list);
  const cache = await self.caches.open(MAPS_CACHE);
  const written = [];
  let loaded = 0;

  try {
    for (const url of list) {
      const res = await self.fetch(url, { cache: 'no-cache' });
      if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
      // Read it in chunks so the bar moves through the 3.5 MB file rather than
      // sitting still and then jumping; on a phone that is most of the download.
      const chunks = [];
      if (res.body && res.body.getReader) {
        const reader = res.body.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
          loaded += value.byteLength;
          onProgress({ loaded, total, url });
        }
      } else {
        const buf = new Uint8Array(await res.arrayBuffer());
        chunks.push(buf);
        loaded += buf.byteLength;
        onProgress({ loaded, total, url });
      }
      let size = 0;
      for (const c of chunks) size += c.byteLength;
      const buffer = new Uint8Array(size);
      let at = 0;
      for (const c of chunks) {
        buffer.set(c, at);
        at += c.byteLength;
      }
      await cache.put(url, storable(res, buffer.buffer));
      written.push(url);
    }
  } catch (err) {
    // Losing signal three files into a four megabyte map is the case this
    // whole feature exists for. Nothing records those files until the map
    // lands whole, so leaving them behind would strand megabytes that neither
    // remove() nor sweep() can ever reach.
    for (const url of written) await cache.delete(url);
    throw err;
  }

  const state = await readState();
  state.maps = state.maps || {};
  state.maps[id] = { urls: list, bytes: loaded, at: Date.now() };
  await writeState(state);
  return { id, bytes: loaded };
}

async function remove(id) {
  const state = await readState();
  const entry = (state.maps || {})[id];
  if (!entry) return { id, bytes: 0 };
  const cache = await self.caches.open(MAPS_CACHE);
  for (const url of entry.urls) await cache.delete(url);
  delete state.maps[id];
  await writeState(state);
  return { id, bytes: 0 };
}

/**
 * A rebaked map is a different 4 MB under the same name. Re-download the files
 * whose tag moved and leave the rest alone, rather than making the player pay
 * for the whole map because one file changed.
 */
async function revalidateMaps() {
  const state = await readState();
  const cache = await self.caches.open(MAPS_CACHE);
  let refreshed = 0;
  for (const [id, entry] of Object.entries(state.maps || {})) {
    for (const url of entry.urls) {
      const stored = await cache.match(url);
      if (!stored) continue;
      let head;
      try {
        head = await self.fetch(url, { method: 'HEAD', cache: 'no-cache' });
      } catch {
        return refreshed; // offline; try again another day
      }
      if (!head.ok || changeTag(head) === stored.headers.get(TAG_HEADER)) continue;
      const res = await self.fetch(url, { cache: 'reload' });
      if (!res.ok) continue;
      await cache.put(url, storable(res, await res.arrayBuffer()));
      refreshed++;
    }
    if (refreshed) state.maps[id].at = Date.now();
  }
  if (refreshed) await writeState(state);
  return refreshed;
}

async function status() {
  const state = await readState();
  const maps = {};
  for (const [id, entry] of Object.entries(state.maps || {})) maps[id] = { bytes: entry.bytes, at: entry.at };
  return {
    buildId: state.buildId,
    shellBytes: state.shellBytes || 0,
    maps,
    version: self.registration ? self.registration.scope : null,
  };
}

async function notify(message) {
  for (const client of await self.clients.matchAll({ includeUncontrolled: true })) client.postMessage(message);
}

self.addEventListener('message', (event) => {
  const msg = event.data || {};
  const port = event.ports && event.ports[0];
  const reply = (data) => port && port.postMessage(data);

  const run = async () => {
    switch (msg.type) {
      case 'status':
        reply({ done: true, status: await status() });
        break;
      case 'measure':
        reply({ done: true, ...(await measure(msg.urls || [])) });
        break;
      case 'download':
        await download(msg.id, msg.urls || [], (p) => reply({ progress: p }));
        reply({ done: true, status: await status() });
        break;
      case 'remove':
        await remove(msg.id);
        reply({ done: true, status: await status() });
        break;
      case 'check-update': {
        const result = await publishShell('no-cache');
        if (result.changed) {
          await revalidateMaps();
          await notify({ type: 'windward-update-ready', buildId: result.buildId });
        }
        reply({ done: true, ...result, status: await status() });
        break;
      }
      case 'skip-waiting':
        await self.skipWaiting();
        reply({ done: true });
        break;
      default:
        reply({ done: true });
    }
  };

  event.waitUntil(run().catch((err) => reply({ done: true, error: String((err && err.message) || err) })));
});

// The verifier runs this file in Node to walk the real tree with the real
// crawler, which is the only way the shell list and the module graph can be
// checked against each other instead of trusted.
self.WINDWARD_SW = { deriveShell, ENTRY, SHELL_PREFIX, MAPS_CACHE };
