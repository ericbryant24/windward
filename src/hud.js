import * as THREE from '../vendor/three.module.js';
import { MEDAL_NAMES, formatMetric } from './challenges.js';
import { Air } from './flight.js';
import { polar, getAircraft } from './fleet.js';

/**
 * All of the 2D UI: loading, menus, and the in-flight instruments. DOM rather
 * than canvas so text stays crisp on a phone and the layout can respect the
 * safe area insets.
 */
export class Hud {
  constructor(root) {
    this.root = root;
    this.root.innerHTML = TEMPLATE;
    this.el = (sel) => this.root.querySelector(sel);

    this.loading = this.el('.loading');
    this.loadingBar = this.el('.loading-bar span');
    this.loadingNote = this.el('.loading-note');
    this.menu = this.el('.menu');
    this.flight = this.el('.flight');
    this.toastArea = this.el('.toasts');
    this.results = this.el('.results');

    this.alt = this.el('[data-alt]');
    this.agl = this.el('[data-agl]');
    this.spd = this.el('[data-spd]');
    this.varioFill = this.el('.vario-fill');
    this.varioText = this.el('[data-vario]');
    this.objective = this.el('.objective');
    this.objectiveName = this.el('[data-objective]');
    this.objectiveDist = this.el('[data-objdist]');
    this.timer = this.el('[data-timer]');
    this.score = this.el('[data-score]');
    this.chip = this.el('.streak');
    this.compassTape = this.el('.compass-tape');
    this.varioAir = this.el('.vario-air');
    this.netto = this.el('[data-netto]');
    this.windArrow = this.el('.wind i');
    this.windSpeed = this.el('[data-wind]');
    this.arrow = this.el('.gate-arrow');
    this.warn = this.el('.warn');
    this.task = this.el('.task');
    this.taskName = this.el('[data-taskname]');
    this.taskProgress = this.el('[data-taskprogress]');
    this.taskTime = this.el('[data-tasktime]');
    this.ship = this.el('[data-ship]');
    this.shipPolar = this.el('[data-shippolar]');
    this.flash = this.el('.crash-flash');
    this.offlineBlock = this.el('.offline-block');

    this._v = new THREE.Vector3();
    this.polar = polar(getAircraft()); // until the game says which ship it is
    this.onAction = () => {};
    this.root.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      this.onAction(btn.dataset.action, btn.dataset.value, btn);
    });
  }

  setProgress(fraction, note) {
    this.loadingBar.style.width = `${Math.round(fraction * 100)}%`;
    if (note) this.loadingNote.textContent = note;
  }

  hideLoading() {
    this.loading.classList.add('gone');
    setTimeout(() => (this.loading.style.display = 'none'), 700);
  }

  /** Point the menu at a region: its name, its tagline, its course. */
  setRegion(region) {
    const set = (attr, text) => {
      const el = this.root.querySelector(`[${attr}]`);
      if (el) el.textContent = text;
    };
    set('data-tagline', region.tagline);
    set('data-loadline', region.loadingTagline);
    set('data-circuitname', region.circuitName);
    set('data-circuitdesc', region.circuitDesc);
    set('data-freedesc', region.freeDesc);
    for (const b of this.root.querySelectorAll('[data-action="map"]')) {
      b.classList.toggle('on', b.dataset.value === region.id);
    }
    // A single-file build carries one map's data and cannot switch, so do not
    // offer a choice that would only reload the same region. It is also already
    // as offline as a thing can be, so the download shelf has nothing to say.
    if (window.WINDWARD_REGION) {
      for (const sel of ['.maps', '.setting.offline']) {
        const el = this.root.querySelector(sel);
        if (el) el.style.display = 'none';
      }
    }
  }

  showMenu(show, { discovered = 0, total = 0, best = {} } = {}) {
    this.menu.classList.toggle('open', show);
    if (show) {
      this.el('[data-discovered]').textContent = `${discovered}/${total}`;
      const t = best.circuit;
      this.el('[data-bestcircuit]').textContent = t ? formatTime(t) : '—';
      this.el('[data-bestalt]').textContent = best.altitude ? `${Math.round(best.altitude)} m` : '—';
    }
  }

  showFlight(show) {
    this.flight.classList.toggle('open', show);
  }

  /**
   * The menu checklist. Challenges are found by flying into them, so this is a
   * scoreboard rather than a launcher — it says what is out there, where, and
   * what you have taken off it so far.
   */
  setChallenges({ rows, total, golds, medalled }) {
    this.el('[data-goldcount]').textContent = `${golds} of ${total} golds`;
    this.el('[data-medalcount]').textContent = medalled
      ? `${medalled}/${total} medalled`
      : 'none medalled yet';
    this.el('.task-list').innerHTML = rows
      .map(
        ({ def, medal, best }) => `
        <div class="task-row m${medal}">
          <i title="${MEDAL_NAMES[medal]}"></i>
          <div>
            <span>${def.name}</span>
            <em>${def.where} · ${def.blurb}</em>
          </div>
          <b>${best == null ? '—' : formatMetric(def, best)}</b>
        </div>`
      )
      .join('');
  }

  setMode(mode) {
    this.flight.dataset.mode = mode;
  }

  /**
   * The offline shelf. A map is 4-odd megabytes of somebody's phone, so the
   * size is on the button before it is pressed and again after, and the bar is
   * the real byte count coming down rather than a spinner.
   */
  setOffline({ note, space, maps = [], updateReady = false }) {
    this.el('[data-offlinespace]').textContent = space ?? '';
    this.el('[data-offlinenote]').textContent = note ?? '';
    this.el('.offline-maps').innerHTML = [
      ...maps.map(
        (m) => `
        <div class="offline-map${m.cached ? ' on' : ''}${m.busy ? ' busy' : ''}">
          <span>${m.name}</span>
          <em>${m.label}</em>
          <button ${m.busy ? 'disabled' : ''} data-action="${m.cached ? 'offline-remove' : 'offline-download'}" data-value="${m.id}">${
            m.busy ? `${Math.round(m.progress * 100)}%` : m.cached ? 'Remove' : 'Download'
          }</button>
          <i><b style="width:${(m.busy ? m.progress : m.cached ? 1 : 0) * 100}%"></b></i>
        </div>`
      ),
      updateReady
        ? `<div class="offline-map update">
             <span>New version</span>
             <em>downloaded and ready</em>
             <button data-action="offline-update">Reload</button>
           </div>`
        : '',
    ].join('');
  }

  /**
   * The dead end: no network, and the map this session wants is not on the
   * device. Said on the loading screen, because there is no world behind it to
   * put a menu on top of.
   */
  showOfflineBlock(message, buttons = []) {
    this.loading.classList.remove('gone');
    this.loading.classList.add('blocked');
    this.loading.style.display = '';
    this.offlineBlock.classList.add('on');
    this.el('.offline-block-msg').textContent = message;
    this.el('.offline-block-actions').innerHTML = buttons
      .map((b) => `<button class="btn ${b.primary ? 'primary' : ''}" data-action="${b.action}" data-value="${b.value ?? ''}">${b.label}</button>`)
      .join('');
  }

  /**
   * The hangar, and the instruments that go with whichever ship is chosen.
   *
   * Every figure on a card comes out of fleet.js polar(), which reads the same
   * coefficients the flight model does — so the card cannot flatter the ship.
   */
  setFleet(list, selectedId) {
    this.el('.fleet-list').innerHTML = list
      .map((spec) => {
        const p = polar(spec);
        return `
        <button class="ship-card ${spec.id === selectedId ? 'on' : ''}" data-action="aircraft" data-value="${spec.id}">
          <span class="ship-name">${spec.name}</span>
          <span class="ship-kind">${spec.kind}</span>
          <span class="ship-figures">
            <i><b>${p.bestLD.toFixed(0)}:1</b><em>glide</em></i>
            <i><b>${p.minSink.toFixed(1)}</b><em>m/s sink</em></i>
            <i><b>${Math.round(spec.trimSpeed * 3.6)}</b><em>km/h trim</em></i>
          </span>
          <span class="ship-blurb">${spec.blurb}</span>
        </button>`;
      })
      .join('');

    const spec = list.find((s) => s.id === selectedId) ?? list[0];
    this.polar = polar(spec);
    this.ship.textContent = spec.name;
    this.shipPolar.textContent = `${this.polar.bestLD.toFixed(0)}:1 · ↓${this.polar.minSink.toFixed(1)}`;
  }

  showResults(title, lines, buttons) {
    this.results.classList.add('open');
    this.el('.results h2').textContent = title;
    this.el('.results-lines').innerHTML = lines
      .map((l) => `<div class="rline"><span>${l[0]}</span><b>${l[1]}</b></div>`)
      .join('');
    this.el('.results-actions').innerHTML = buttons
      .map((b) => `<button class="btn ${b.primary ? 'primary' : ''}" data-action="${b.action}">${b.label}</button>`)
      .join('');
  }

  hideResults() {
    this.results.classList.remove('open');
  }

  toast(text, kind = '') {
    const el = document.createElement('div');
    el.className = `toast ${kind}`;
    el.innerHTML = text;
    this.toastArea.appendChild(el);
    requestAnimationFrame(() => el.classList.add('in'));
    setTimeout(() => {
      el.classList.remove('in');
      setTimeout(() => el.remove(), 500);
    }, 2600);
  }

  setWarning(text) {
    this.warn.textContent = text || '';
    this.warn.classList.toggle('on', !!text);
  }

  /** A hit felt through the screen: harder impacts flash longer and redder. */
  impact(severity) {
    this.flash.style.setProperty('--hit', severity.toFixed(2));
    this.flash.classList.remove('hit');
    void this.flash.offsetWidth; // restart the animation on a second crash
    this.flash.classList.add('hit');
    clearTimeout(this._flashTimer);
    this._flashTimer = setTimeout(() => this.flash.classList.remove('hit'), 1600);
  }

  /** Per-frame instrument refresh. */
  update(state) {
    const { glider, ground, objective, camera, mode, timer, score, streak, challenge } = state;

    this.alt.textContent = Math.round(glider.position.y);
    this.agl.textContent = `${Math.max(0, Math.round(glider.position.y - ground))} agl`;
    this.spd.textContent = Math.round(glider.airspeed * 3.6);

    // The polar is quoted at sea level; thinner air up here means the same
    // wing needs more true airspeed for the same lift coefficient, so the
    // bands on the speed readout have to move with altitude or they lie.
    const thin = Math.sqrt(Air.density(0) / Air.density(glider.position.y));
    const best = this.polar.bestLDSpeed * thin;
    this.spd.classList.toggle('glide', Math.abs(glider.airspeed - best) < best * 0.07);
    this.spd.classList.toggle('slow', glider.airspeed < this.polar.stallSpeed * thin * 1.08);

    const v = THREE.MathUtils.clamp(glider.varioSmooth / 5, -1, 1);
    this.varioFill.style.height = `${Math.abs(v) * 50}%`;
    this.varioFill.style.bottom = v >= 0 ? '50%' : `${50 - Math.abs(v) * 50}%`;
    this.varioFill.classList.toggle('down', v < 0);
    this.varioText.textContent = `${glider.varioSmooth >= 0 ? '+' : ''}${glider.varioSmooth.toFixed(1)}`;

    // Netto beside the ship's own vario: the mark is where the air is going,
    // the bar is where the ship is going, and the gap between them is what the
    // airframe costs to keep flying.
    const air = THREE.MathUtils.clamp(glider.nettoSmooth / 5, -1, 1);
    this.varioAir.style.bottom = `${50 + air * 50}%`;
    this.varioAir.classList.toggle('up', glider.nettoSmooth > 0.15);
    this.netto.textContent = `air ${glider.nettoSmooth >= 0 ? '+' : ''}${glider.nettoSmooth.toFixed(1)}`;
    this.netto.classList.toggle('up', glider.nettoSmooth > 0.15);

    this.compassTape.style.backgroundPosition = `${-glider.headingDeg * 4}px 0`;

    // Where the wind is going, seen from the cockpit: the top of the compass is
    // the nose, so an arrow pointing up is a tailwind. Read off the vector the
    // flight model just flew through, gradient and all, not the region's table.
    const wind = glider.wind;
    const bearing = (Math.atan2(wind.x, -wind.z) * 180) / Math.PI;
    this.windArrow.style.transform = `rotate(${bearing - glider.headingDeg - 90}deg)`;
    this.windSpeed.textContent = Math.round(Math.hypot(wind.x, wind.z) * 3.6);

    if (objective) {
      this.objective.classList.add('on');
      this.objectiveName.textContent = objective.name;
      // A readout with nothing to point at still has something to say: "no
      // lift within reach" is an answer, and a distance to nowhere is not.
      if (objective.position) {
        const d = objective.position.distanceTo(glider.position);
        this.objectiveDist.textContent = d > 1500 ? `${(d / 1000).toFixed(1)} km` : `${Math.round(d)} m`;
        this.#pointArrow(objective.position, camera, glider);
      } else {
        this.objectiveDist.textContent = '';
        this.arrow.style.opacity = '0';
      }
    } else {
      this.objective.classList.remove('on');
      this.arrow.style.opacity = '0';
    }

    if (mode === 'circuit') {
      this.timer.textContent = formatTime(timer);
    } else {
      this.timer.textContent = `${Math.round(glider.boost * 100)}%`;
    }
    this.score.textContent = Math.round(score).toLocaleString('en-US');

    if (streak > 1.05) {
      this.chip.classList.add('on');
      this.chip.textContent = `×${streak.toFixed(1)} ridge run`;
    } else {
      this.chip.classList.remove('on');
    }

    this.task.classList.toggle('on', !!challenge);
    if (challenge) {
      this.taskName.textContent = challenge.name;
      this.taskProgress.textContent = challenge.progress;
      this.taskTime.textContent = `${challenge.remaining.toFixed(1)}s`;
      this.taskTime.classList.toggle('low', challenge.remaining < 10);
    }
  }

  /** Chevron that points at the next gate when it is off screen. */
  #pointArrow(target, camera, glider) {
    const p = this._v.copy(target).project(camera);
    const onScreen = p.z < 1 && Math.abs(p.x) < 0.92 && Math.abs(p.y) < 0.92;
    if (onScreen) {
      this.arrow.style.opacity = '0';
      return;
    }
    let x = p.x;
    let y = p.y;
    if (p.z > 1) {
      x = -x;
      y = -y;
    }
    const angle = Math.atan2(y, x);
    const r = Math.min(innerWidth, innerHeight) * 0.31;
    this.arrow.style.opacity = '1';
    this.arrow.style.transform =
      `translate(-50%, -50%) translate(${Math.cos(angle) * r}px, ${-Math.sin(angle) * r}px) rotate(${-angle + Math.PI / 2}rad)`;
  }
}

export function formatTime(seconds) {
  if (!isFinite(seconds)) return '—';
  const m = Math.floor(seconds / 60);
  const s = seconds - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
}

const TEMPLATE = /* html */ `
<div class="loading">
  <div class="brand">
    <h1>WINDWARD</h1>
    <p data-loadline>Soaring the Bernese Alps</p>
  </div>
  <div class="loading-bar"><span></span></div>
  <div class="loading-note">reading the terrain…</div>
  <div class="offline-block">
    <h2>No connection</h2>
    <p class="offline-block-msg"></p>
    <div class="offline-block-actions"></div>
  </div>
</div>

<div class="menu">
  <div class="menu-inner">
    <header>
      <h1>WINDWARD</h1>
      <p class="sub" data-tagline>Jungfrau region · real terrain · 38 × 38 km</p>
    </header>

    <div class="maps" data-group="map">
      <button class="map-card on" data-action="map" data-value="jungfrau">
        <span class="map-name">Jungfrau</span>
        <span class="map-sub">38 × 38 km · Switzerland</span>
        <span class="map-blurb">Ridge lift off the big north faces, thermals over the meadows.</span>
      </button>
      <button class="map-card" data-action="map" data-value="chicago">
        <span class="map-name">Chicago</span>
        <span class="map-sub">14 × 14 km · Illinois</span>
        <span class="map-blurb">No hills to lean on. Thermals off hot roofs, and the lake kills you.</span>
      </button>
    </div>

    <div class="fleet">
      <div class="fleet-head"><span>Aircraft</span><b>numbers off its own polar</b></div>
      <div class="fleet-list"></div>
    </div>

    <div class="modes">
      <button class="mode-card" data-action="start" data-value="free">
        <span class="mode-name">Free Flight</span>
        <span class="mode-desc" data-freedesc>Hunt thermals, ride the ridges, find every landmark.</span>
      </button>
      <button class="mode-card" data-action="start" data-value="circuit">
        <span class="mode-name" data-circuitname>Jungfrau Circuit</span>
        <span class="mode-desc" data-circuitdesc>Eleven gates from Lauterbrunnen to the Eiger. Beat the clock.</span>
      </button>
      <button class="mode-card" data-action="start" data-value="climb">
        <span class="mode-name">Height Hunt</span>
        <span class="mode-desc">Five minutes. Climb as high as the air will let you.</span>
      </button>
    </div>

    <div class="tasks">
      <div class="task-head">
        <span>Challenges</span>
        <b data-goldcount>0 of 0 golds</b>
      </div>
      <p class="task-note">Out in the map. Fly into a marker to start one — <em data-medalcount>none medalled yet</em>.</p>
      <div class="task-list"></div>
    </div>

    <div class="stats">
      <div><span>Landmarks found</span><b data-discovered>0/0</b></div>
      <div><span>Best circuit</span><b data-bestcircuit>—</b></div>
      <div><span>Best climb</span><b data-bestalt>—</b></div>
    </div>

    <div class="settings">
      <div class="setting">
        <span>Time of day</span>
        <div class="segmented" data-group="time">
          <button data-action="time" data-value="morning">Morning</button>
          <button data-action="time" data-value="midday">Noon</button>
          <button class="on" data-action="time" data-value="afternoon">Afternoon</button>
          <button data-action="time" data-value="golden">Golden</button>
        </div>
      </div>
      <div class="setting">
        <span>Quality</span>
        <div class="segmented" data-group="quality">
          <button data-action="quality" data-value="low">Low</button>
          <button class="on" data-action="quality" data-value="med">Medium</button>
          <button data-action="quality" data-value="high">High</button>
        </div>
      </div>
      <div class="setting">
        <span>Controls</span>
        <div class="segmented" data-group="input">
          <button class="on" data-action="input" data-value="stick">Thumb stick</button>
          <button data-action="input" data-value="tilt">Tilt</button>
        </div>
      </div>
      <div class="setting">
        <span>Sound</span>
        <div class="segmented" data-group="sound">
          <button class="on" data-action="sound" data-value="1">On</button>
          <button data-action="sound" data-value="0">Off</button>
        </div>
      </div>
      <div class="setting">
        <span>Pull to climb</span>
        <div class="segmented" data-group="invert">
          <button class="on" data-action="invert" data-value="0">Normal</button>
          <button data-action="invert" data-value="1">Inverted</button>
        </div>
      </div>
      <div class="setting offline">
        <div class="offline-head">
          <span>Offline play</span>
          <b data-offlinespace></b>
        </div>
        <p class="offline-note" data-offlinenote></p>
        <div class="offline-maps"></div>
      </div>
    </div>

    <p class="hint">Keyboard: arrows or WASD to fly · Space boost · B airbrakes · C camera · R respawn</p>
    <p class="credit">
      Terrain from public elevation data · buildings ©
      <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>
      contributors, ODbL
    </p>
  </div>
</div>

<div class="flight">
  <div class="top-bar">
    <div class="gauge">
      <b data-alt>0</b><span class="unit">m</span>
      <em data-agl>0 agl</em>
    </div>
    <div class="centre">
      <div class="compass">
        <div class="compass-tape"></div>
        <div class="compass-mark"></div>
      </div>
      <div class="wind"><i>➤</i><b data-wind>0</b></div>
      <div class="objective">
        <span data-objective>—</span><b data-objdist>—</b>
      </div>
    </div>
    <div class="gauge right">
      <b data-spd>0</b><span class="unit">km/h</span>
      <em data-timer>0:00.0</em>
      <em class="ship"><b data-ship>—</b><span data-shippolar>—</span></em>
    </div>
  </div>

  <div class="vario">
    <div class="vario-track"><div class="vario-fill"></div><i class="vario-air"></i></div>
    <span data-vario>0.0</span>
    <em class="netto" data-netto>air 0.0</em>
  </div>

  <div class="score-chip"><b data-score>0</b><span>pts</span></div>
  <div class="task">
    <span data-taskname>—</span>
    <b data-taskprogress>—</b>
    <em data-tasktime>—</em>
  </div>
  <div class="streak"></div>
  <div class="warn"></div>
  <div class="gate-arrow">➤</div>

  <button class="icon-btn pause" data-action="pause" aria-label="Pause">❚❚</button>
  <div class="crash-flash"></div>
</div>

<div class="toasts"></div>

<div class="results">
  <div class="results-card">
    <h2>Flight complete</h2>
    <div class="results-lines"></div>
    <div class="results-actions"></div>
  </div>
</div>
`;
