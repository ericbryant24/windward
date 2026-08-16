import * as THREE from '../vendor/three.module.js';
import { MEDAL_NAMES, formatMetric, formatClock } from './challenges.js';
import { Air } from './flight.js';
import { ISSUED_AIRCRAFT, polar, getAircraft } from './fleet.js';

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
    this.glide = this.el('[data-glide]');
    this.compassTape = this.el('.compass-tape');
    this.varioAir = this.el('.vario-air');
    this.netto = this.el('[data-netto]');
    this.windArrow = this.el('.wind i');
    this.windSpeed = this.el('[data-wind]');
    this.arrow = this.el('.gate-arrow');
    this.arrowGlyph = this.el('.gate-arrow i');
    this.arrowName = this.el('.gate-arrow b');
    this.warn = this.el('.warn');
    this.task = this.el('.task');
    this.taskName = this.el('[data-taskname]');
    this.taskProgress = this.el('[data-taskprogress]');
    this.taskClock = this.el('[data-taskclock]');
    this.taskTime = this.el('[data-tasktime]');
    this.taskGhost = this.el('[data-taskghost]');
    this.ship = this.el('[data-ship]');
    this.shipPolar = this.el('[data-shippolar]');
    this.wear = this.el('.wear');
    this.wearFill = this.el('.wear u');
    this.flash = this.el('.crash-flash');
    this.offlineBlock = this.el('.offline-block');
    // The canvas only; what goes on it belongs to src/minimap.js, which the
    // game hands the world it is drawing.
    this.minimapCanvas = this.el('.minimap');

    // The hangar is machinery the game still has and currently does not use;
    // see ISSUED_AIRCRAFT in fleet.js. It stays in the template so that putting
    // the fleet back is one constant rather than a rewrite of this file.
    if (ISSUED_AIRCRAFT) this.el('.fleet').hidden = true;

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

  /**
   * Hand the loading screen back for a map change. The reload is real — four
   * megabytes of terrain have to be swapped — but it must not read as leaving
   * one game and starting another, so the destination's own loading screen goes
   * up before this document dies and the arriving one continues it.
   */
  showTransition(region) {
    this.loading.style.display = '';
    this.loading.classList.remove('gone');
    this.setRegion(region);
    this.setProgress(0.04, `crossing to ${region.name}…`);
  }

  /**
   * Point the menu and the loading screen at a region. The taglines are not
   * part of that any more: they used to name whichever terrain was in memory,
   * which made the two levels read as two games with two title screens. The
   * game is called Windward wherever you happen to be flying it, and the place
   * is already named twice on the screen underneath.
   */
  setRegion(region) {
    // A single-file build carries one map's data and cannot travel to the
    // other. It is also already as offline as a thing can be, so the download
    // shelf has nothing to say.
    if (window.WINDWARD_REGION) {
      this.root.querySelector('.menu').classList.add('single');
      const el = this.root.querySelector('.setting.offline');
      if (el) el.style.display = 'none';
    }
  }

  /**
   * The menu, which is a level select. Everything on it spans both maps: one
   * medal tally, one aircraft, one list of things left to do — the loaded
   * terrain is just which of the two you can reach without waiting.
   */
  showMenu(show, view = null) {
    this.menu.classList.toggle('open', show);
    if (!show || !view) return;
    this.view = view;
    // Landing on the level you are standing in, the first time. After that the
    // menu stays where the player last left it.
    if (!this.level || !view.levels.some((l) => l.id === this.level)) this.level = view.here;

    this.el('[data-goldcount]').textContent = `${view.golds} of ${view.total} golds`;
    this.el('[data-medalcount]').textContent = view.medalled
      ? `${view.medalled} of ${view.total} carry a medal`
      : 'nothing medalled yet — the map opens up as they do';
    this.el('.pips').innerHTML = view.levels
      .flatMap((l) => l.rows.map((r) => `<i class="pip m${r.medal}${r.open ? '' : ' shut'}"></i>`))
      .join('');

    this.el('.level-tabs').innerHTML = view.levels
      .map(
        (l) => `
        <button class="level-tab${l.id === this.level ? ' on' : ''}${l.id === view.here ? ' here' : ''}"
                data-action="level" data-value="${l.id}">
          <span>${l.name}</span>
          <em>${l.sub}</em>
          <b>${l.golds}/${l.total} golds</b>
        </button>`
      )
      .join('');

    this.el('[data-discovered]').textContent = `${view.discovered}/${view.places}`;
    this.el('[data-medalstat]').textContent = `${view.medalled}/${view.total}`;
    this.#drawLevel();
  }

  /**
   * Switch which level the list is showing — and which one Fly launches into.
   * Choosing a place and going flying used to be two presses, the second of
   * them a button that appeared and disappeared under the list; now picking
   * Chicago and pressing Fly puts you over Chicago, and whether that costs a
   * reload is the game's problem rather than something to ask about first.
   */
  selectLevel(id) {
    if (!this.view || this.level === id) return;
    this.level = id;
    for (const b of this.root.querySelectorAll('.level-tab')) {
      b.classList.toggle('on', b.dataset.value === id);
    }
    this.#drawLevel();
  }

  #drawLevel() {
    const level = this.view.levels.find((l) => l.id === this.level);
    if (!level) return;
    this.el('.level-blurb').textContent = level.blurb;
    this.el('.fly-btn').dataset.value = level.id;
    this.el('[data-flywhere]').textContent = level.name;
    this.el('.task-list').innerHTML = level.rows
      .map(({ def, medal, best, open }) =>
        open
          ? `<button class="task-row m${medal}" data-action="challenge" data-value="${def.id}">
               <i title="${MEDAL_NAMES[medal]}"></i>
               <div>
                 <span>${def.name}</span>
                 <em>${def.where} · ${def.blurb}</em>
               </div>
               <b>${best == null ? 'unflown' : formatMetric(def, best)}</b>
             </button>`
          : // Named, but not yet standing in the world. Hiding the name as well
            // would only make the list shorter — what the player needs from
            // this screen is the shape of what is left, and a row that says
            // "Locked" five times running is not a shape.
            `<div class="task-row locked">
               <i></i>
               <div>
                 <span>${def.name}</span>
                 <em>${def.where} · raised at ${def.needs} medals</em>
               </div>
               <b>${def.needs} med</b>
             </div>`
      )
      .join('');
  }

  showFlight(show) {
    this.flight.classList.toggle('open', show);
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
   * The hangar: which ship plain flying uses. Challenges name their own and
   * ignore this, which is why the shelf says so on the label rather than
   * pretending the choice reaches further than it does.
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
    this.setShip(list.find((s) => s.id === selectedId) ?? list[0]);
  }

  /** The instruments follow whatever is actually bolted on, chosen or issued. */
  setShip(spec) {
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

  /**
   * A toast that waits to be answered, and there is only ever one. Used for
   * the run you just lost: 2.6 seconds is long enough to read "out of time"
   * and nowhere near long enough to decide to go again.
   */
  ask(text, buttons) {
    this.dismissAsk();
    const el = document.createElement('div');
    el.className = 'toast ask bad';
    el.innerHTML =
      `<span>${text}</span>` +
      buttons.map((b) => `<button data-action="${b.action}">${b.label}</button>`).join('');
    // Any press answers it, including the one that only means "not now".
    el.addEventListener('click', () => this.dismissAsk());
    this._ask = el;
    this.toastArea.appendChild(el);
    requestAnimationFrame(() => el.classList.add('in'));
  }

  dismissAsk() {
    const el = this._ask;
    if (!el) return;
    this._ask = null;
    el.classList.remove('in');
    setTimeout(() => el.remove(), 500);
  }

  /**
   * Two bands, and they must not read alike at a glance: the stall and the
   * first flutter are things you fly out of, an airframe being used up is not.
   */
  setWarning(text) {
    const say = text || '';
    this.warn.textContent = say;
    this.warn.classList.toggle('on', !!say);
    this.warn.classList.toggle('buzz', say === 'STALL' || say === 'VNE');
    this.warn.classList.toggle('grave', say === 'OVERSPEED' || say.startsWith('AIRFRAME'));
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
    const { glider, ground, objective, camera, challenge } = state;

    this.alt.textContent = Math.round(glider.position.y);
    this.agl.textContent = `${Math.max(0, Math.round(glider.position.y - ground))} agl`;
    this.spd.textContent = Math.round(glider.airspeed * 3.6);
    const horizontal = Math.hypot(glider.velocity.x, glider.velocity.z);

    // The polar is quoted at sea level; thinner air up here means the same
    // wing needs more true airspeed for the same lift coefficient, so the
    // bands on the speed readout have to move with altitude or they lie.
    const thin = Math.sqrt(Air.density(0) / Air.density(glider.position.y));
    const best = this.polar.bestLDSpeed * thin;
    this.spd.classList.toggle('glide', Math.abs(glider.airspeed - best) < best * 0.07);
    this.spd.classList.toggle('slow', glider.airspeed < this.polar.stallSpeed * thin * 1.08);

    // The airframe never mends inside a flight, so this bar only ever fills.
    // That is the point of showing it: the second dive is not the first one.
    const wear = glider.broken ? 1 : glider.damage;
    this.wear.classList.toggle('on', wear > 0.001);
    this.wear.classList.toggle('bad', wear > 0.6);
    this.wearFill.style.width = `${Math.min(100, wear * 100).toFixed(0)}%`;

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
        this.#pointArrow(objective.position, camera, glider, objective.name);
      } else {
        this.objectiveDist.textContent = '';
        this.arrow.style.opacity = '0';
      }
    } else {
      this.objective.classList.remove('on');
      this.arrow.style.opacity = '0';
    }

    // What the ship is actually achieving, against the book figure written
    // underneath it. There is no engine any more, so how far the height in
    // hand will carry you is the whole of the tactical question — and the
    // difference between 36:1 on the card and 19:1 through the sink you are
    // in is the thing a vario alone will not tell you.
    const glideNow = glider.varioSmooth < -0.05 ? horizontal / -glider.varioSmooth : Infinity;
    this.glide.textContent = !isFinite(glideNow) ? '↑' : `${Math.min(99, glideNow).toFixed(0)}:1`;
    this.glide.classList.toggle('good', glideNow >= this.polar.bestLD * 0.8);

    this.task.classList.toggle('on', !!challenge);
    if (challenge) {
      this.taskName.textContent = challenge.name;
      this.taskProgress.textContent = challenge.progress;
      // A deck run's progress line IS its state — on the deck, too high, off
      // the line — and the colour carries most of that at a glance. Everything
      // else leaves the attribute empty and keeps the warm default.
      this.task.dataset.flag = challenge.flag ?? '';
      // The figure the medal ladder is flown against: it says which rung you
      // are still on for while there is time to fly differently. Remaining
      // only becomes interesting when it is about to end the run.
      this.taskClock.textContent = formatClock(challenge.clock);
      this.taskClock.dataset.standing = challenge.standing ?? '';
      this.taskTime.textContent = `−${formatClock(challenge.remaining)}`;
      this.taskTime.classList.toggle('low', challenge.remaining < 10);
      // Against your own best, at this point of the run. Only shown when there
      // is a ghost to be measured against.
      const d = challenge.ghost;
      this.taskGhost.classList.toggle('on', d != null);
      if (d != null) {
        this.taskGhost.textContent = `${d >= 0 ? '+' : '−'}${Math.abs(Math.round(d))}`;
        this.taskGhost.classList.toggle('ahead', d >= 0);
      }
    }
  }

  /** Chevron that points at the next gate when it is off screen. */
  #pointArrow(target, camera, glider, name) {
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
    // The wrapper is placed and the glyph inside it is turned. A bare chevron
    // is a thing pointing somewhere for no stated reason — its name lives at
    // the top of the screen in the objective chip, which is the other side of
    // the display — so the name comes with it, and stays the right way up
    // while the glyph swings.
    this.arrow.style.transform =
      `translate(-50%, -50%) translate(${Math.cos(angle) * r}px, ${-Math.sin(angle) * r}px)`;
    this.arrowGlyph.style.transform = `rotate(${-angle + Math.PI / 2}rad)`;
    this.arrowName.textContent = name ?? '';
  }
}

const TEMPLATE = /* html */ `
<div class="loading">
  <div class="brand">
    <h1>WINDWARD</h1>
    <p>Three hundred horsepower over real ground</p>
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
      <p class="sub">Three hundred horsepower over real ground</p>
    </header>

    <button class="fly-btn" data-action="fly">
      <span class="fly-go">Fly</span>
      <span class="fly-where" data-flywhere></span>
    </button>

    <div class="tasks">
      <div class="task-head">
        <span>Challenges</span>
        <b data-goldcount>0 of 0 golds</b>
      </div>
      <div class="pips"></div>
      <p class="task-note" data-medalcount>nothing medalled yet</p>

      <div class="level-tabs"></div>
      <p class="level-blurb"></p>
      <div class="task-list"></div>
    </div>

    <div class="fleet">
      <div class="fleet-head"><span>Aircraft</span><b>for flying · challenges name their own</b></div>
      <div class="fleet-list"></div>
    </div>

    <div class="stats">
      <div><span>Landmarks</span><b data-discovered>0/0</b></div>
      <div><span>Medalled</span><b data-medalstat>0/0</b></div>
    </div>

    <div class="settings">
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

    <p class="hint">Keyboard: arrows or WASD to fly · B or Space airbrakes · C camera · R respawn</p>
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
      <em class="glide" data-glide>—</em>
      <em class="ship"><b data-ship>—</b><span data-shippolar>—</span><i class="wear"><u></u></i></em>
    </div>
  </div>

  <div class="vario">
    <div class="vario-track"><div class="vario-fill"></div><i class="vario-air"></i></div>
    <span data-vario>0.0</span>
    <em class="netto" data-netto>air 0.0</em>
  </div>

  <canvas class="minimap"></canvas>

  <div class="task">
    <span data-taskname>—</span>
    <b data-taskprogress>—</b>
    <em class="clock" data-taskclock>—</em>
    <i data-tasktime>—</i>
    <u class="ghost" data-taskghost></u>
  </div>
  <div class="warn"></div>
  <div class="gate-arrow"><i>➤</i><b></b></div>

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
