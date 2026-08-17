import { REGIONS } from './regions.js';
import { store } from './store.js';

/**
 * The page's half of offline play: registers the worker, works out which files
 * a region is actually made of, and drives download/remove/update through it.
 *
 * The file list is derived here rather than in sw.js on purpose. The worker has
 * no business knowing that a region is a heightfield plus a vegetation mask
 * plus two packed binaries — regions.js knows that, and the vegetation file is
 * only named inside the terrain metadata, so the list has to be read out of the
 * same table the loader reads. Adding a fourth data file to a region will be
 * picked up here for free.
 */
export class Offline {
  constructor() {
    this.reg = null;
    this.state = { buildId: null, shellBytes: 0, maps: {} };
    this.updateReady = false;
    this.busy = null; // region id currently downloading
    this.progress = 0;
    this.onChange = () => {};
    this._sizes = readSizes();
  }

  get supported() {
    return 'serviceWorker' in navigator && /^https?:$/.test(location.protocol) && !window.WINDWARD_REGION;
  }

  /**
   * Pick up an existing worker without waiting for one to install. A first
   * visit must not block on registration — the player is here to fly, and the
   * shell precache is deliberately deferred until after the game has loaded.
   *
   * This sits on the boot path, so it fails soft in both directions. Reading
   * navigator.serviceWorker throws outright in a sandboxed or opaque-origin
   * frame, and a wedged registration leaves ready() pending forever; either
   * one would otherwise take the whole game down with it.
   */
  async attach() {
    try {
      if (!this.supported || !navigator.serviceWorker.controller) return false;
      navigator.serviceWorker.addEventListener('message', (e) => this.#onMessage(e));
      this.reg = await Promise.race([
        navigator.serviceWorker.ready,
        new Promise((r) => setTimeout(() => r(null), 2000)),
      ]);
      if (!this.reg) return false;
      this.#watch();
      await this.refresh();
      return true;
    } catch {
      return false;
    }
  }

  /** Install the worker, which precaches the shell. Safe to call twice. */
  async install() {
    if (!this.supported || this.reg) return this.reg;
    navigator.serviceWorker.addEventListener('message', (e) => this.#onMessage(e));
    this.reg = await navigator.serviceWorker.register('sw.js', { scope: './' });
    await navigator.serviceWorker.ready;
    this.#watch();
    await this.refresh();
    return this.reg;
  }

  /**
   * Two different things count as "there is a new version". Changing a module
   * leaves sw.js byte-identical, so nothing happens on its own and the worker
   * only finds out when checkForUpdate() re-walks the graph. Changing sw.js
   * itself makes the browser install a second worker that then sits waiting —
   * which needs noticing here, or the update never surfaces.
   */
  #watch() {
    if (this.reg.waiting && navigator.serviceWorker.controller) this.updateReady = true;
    this.reg.addEventListener('updatefound', () => {
      const incoming = this.reg.installing;
      incoming?.addEventListener('statechange', () => {
        if (incoming.state === 'installed' && navigator.serviceWorker.controller) {
          this.updateReady = true;
          this.onChange();
        }
      });
    });
  }

  #onMessage(event) {
    if (event.data?.type === 'windward-update-ready') {
      this.updateReady = true;
      this.onChange();
    }
  }

  /** Round-trip one request through the worker on its own port. */
  #ask(message, onProgress) {
    const target = navigator.serviceWorker.controller ?? this.reg?.active;
    if (!target) return Promise.reject(new Error('no service worker'));
    return new Promise((resolve, reject) => {
      const channel = new MessageChannel();
      channel.port1.onmessage = (e) => {
        const data = e.data || {};
        if (data.progress) {
          onProgress?.(data.progress);
          return;
        }
        if (data.error) reject(new Error(data.error));
        else resolve(data);
      };
      target.postMessage(message, [channel.port2]);
    });
  }

  async refresh() {
    if (!this.supported) return this.state;
    try {
      const { status } = await this.#ask({ type: 'status' });
      if (status) this.state = status;
    } catch {
      /* worker not up yet; the menu just shows nothing cached */
    }
    return this.state;
  }

  cached(id) {
    return !!this.state.maps?.[id];
  }

  /** The maps that exist, for the menu to offer. */
  regions() {
    return Object.values(REGIONS).map((r) => ({ id: r.id, name: r.name }));
  }

  /**
   * Can this region be flown right now? Either its data is on the device, or
   * the network answers for it. The probe is the region's metadata file
   * because it is a kilobyte and the heightfield asks for it next anyway; the
   * worker marks its own offline placeholder with a header so a 503 body full
   * of JSON is not mistaken for terrain metadata.
   *
   * Only "nobody answered" counts as offline. A 500 or a 404 means the server
   * is right there, and refusing to start over one is worse than letting the
   * loader report whatever is actually wrong with the file.
   */
  async available(id) {
    if (this.cached(id)) return true;
    const region = REGIONS[id];
    if (!region) return false;
    // onLine is only trustworthy when it says no, which is exactly the case
    // worth short-circuiting: do not spend a round trip on a network that has
    // already told us it is not there.
    if (!navigator.onLine) return false;
    try {
      const res = await fetch(region.data.terrain.replace(/\.png$/, '.json'));
      return !res.headers.get('x-windward-offline');
    } catch {
      return false;
    }
  }

  /** Every region with its data on this device, so boot can fall back to one. */
  cachedRegions() {
    return Object.keys(this.state.maps ?? {}).filter((id) => REGIONS[id]);
  }

  /**
   * The files a region needs. The vegetation mask is named inside the terrain
   * metadata, so this reads it — from the cache when there is no network,
   * which is what makes "remove a downloaded map while offline" work.
   */
  async filesFor(id) {
    const region = REGIONS[id];
    if (!region) throw new Error(`unknown region ${id}`);
    const meta = region.data.terrain.replace(/\.png$/, '.json');
    const files = [region.data.terrain, meta, region.data.buildings, region.data.network];
    try {
      const json = await fetch(meta).then((r) => (r.ok ? r.json() : null));
      if (json?.vegetation?.file) files.push(json.vegetation.file);
    } catch {
      /* no metadata reachable: the four known files are still the bulk of it */
    }
    return files;
  }

  /** Download size, HEAD-measured once and remembered so it shows up offline too. */
  async sizeOf(id) {
    if (this.state.maps?.[id]) return this.state.maps[id].bytes;
    if (this._sizes[id]) return this._sizes[id];
    if (!this.supported || !navigator.onLine || this.busy || this._measuring) return null;
    this._measuring = true;
    try {
      const { bytes, known } = await this.#ask({ type: 'measure', urls: await this.filesFor(id) });
      if (!known || !bytes) return null;
      this._sizes[id] = bytes;
      store.set('windward.offline.sizes', JSON.stringify(this._sizes));
      return bytes;
    } catch {
      return null;
    } finally {
      this._measuring = false;
    }
  }

  async download(id) {
    if (this.busy) return;
    this.busy = id;
    this.progress = 0;
    this.onChange();
    try {
      const urls = await this.filesFor(id);
      const { status } = await this.#ask({ type: 'download', id, urls }, ({ loaded, total }) => {
        this.progress = total ? Math.min(1, loaded / total) : 0;
        this.onChange();
      });
      if (status) this.state = status;
    } finally {
      this.busy = null;
      this.progress = 0;
      this.onChange();
    }
  }

  async remove(id) {
    const { status } = await this.#ask({ type: 'remove', id });
    if (status) this.state = status;
    this.onChange();
  }

  /**
   * Ask the worker to re-derive the shell and compare it byte for byte with
   * what is stored. Cheap when nothing changed — the fetches revalidate, so a
   * matching build costs a round of 304s rather than 2.4 MB — but not free, so
   * it runs once a session, in the background, after the game is up.
   */
  async checkForUpdate() {
    if (!this.supported || !navigator.onLine) return false;
    try {
      const result = await this.#ask({ type: 'check-update' });
      if (result.status) this.state = result.status;
      if (result.changed) this.updateReady = true;
      this.onChange();
      return !!result.changed;
    } catch {
      return false;
    }
  }

  /**
   * Go and look, properly, whether the player asked at a good moment or not.
   *
   * The ordinary update path is passive: the browser notices a new sw.js when it
   * feels like it, the worker installs beside the old one and sits waiting, and
   * applyUpdate() takes it. That is right for the automatic case and useless as
   * an answer to "am I running the current build" — a browser holding a cached
   * sw.js can sit on a stale shell for a day.
   *
   * So this forces all of it: refetch sw.js, make the worker re-publish the
   * shell with no-cache so every file's change-tag is checked against the
   * network, take any worker that installs as a result, and say whether the
   * build id moved. The caller decides whether to reload.
   *
   * @returns {{changed:boolean, buildId:string|null, before:string|null}}
   */
  async forceUpdate() {
    const before = this.state.buildId ?? null;
    let changed = false;
    let buildId = before;
    try {
      await this.reg?.update();
    } catch {
      /* an unreachable network is an answer too: nothing changed */
    }
    try {
      const worker = this.reg?.active ?? navigator.serviceWorker?.controller;
      if (worker) {
        const result = await this.#askWorker(worker, { type: 'check-update' }, true);
        if (result && typeof result === 'object') {
          changed = !!result.changed;
          buildId = result.buildId ?? buildId;
          if (result.status) this.state = { ...this.state, ...result.status };
        }
      }
    } catch {
      /* fall through: the reload below still picks up whatever is there */
    }
    if (this.reg?.waiting) {
      try {
        await this.#askWorker(this.reg.waiting, { type: 'skip-waiting' });
        changed = true;
      } catch {
        /* nothing to take */
      }
    }
    return { changed, buildId, before };
  }

  /** Take the waiting worker, if the update arrived as a new sw.js, then reload. */
  async applyUpdate() {
    try {
      if (this.reg?.waiting) {
        await this.#askWorker(this.reg.waiting, { type: 'skip-waiting' });
      }
    } catch {
      /* reloading is what matters; the new shell is already published */
    }
    location.reload();
  }

  /**
   * @param {boolean} wantReply pass the worker's answer back rather than just
   *   resolving. check-update returns whether the build moved, which is the only
   *   thing the update button has to report.
   */
  #askWorker(worker, message, wantReply = false) {
    return new Promise((resolve) => {
      const channel = new MessageChannel();
      channel.port1.onmessage = (e) => resolve(wantReply ? e.data : undefined);
      worker.postMessage(message, [channel.port2]);
      // Republishing the shell checks forty files against the network, so this
      // needs longer than the fire-and-forget messages do.
      setTimeout(() => resolve(undefined), wantReply ? 20000 : 1500);
    });
  }

  /** Total origin usage, which is the honest answer to "how much space is this". */
  async storage() {
    try {
      const { usage, quota } = await navigator.storage.estimate();
      return { usage, quota };
    } catch {
      return null;
    }
  }
}

function readSizes() {
  try {
    return JSON.parse(store.get('windward.offline.sizes', '{}')) ?? {};
  } catch {
    return {};
  }
}

export function formatBytes(bytes) {
  if (bytes == null || !isFinite(bytes)) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} kB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}
