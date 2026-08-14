import * as THREE from '../vendor/three.module.js';

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
    this.arrow = this.el('.gate-arrow');
    this.warn = this.el('.warn');

    this._toasts = [];
    this._v = new THREE.Vector3();
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

  setMode(mode) {
    this.flight.dataset.mode = mode;
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

  /** Per-frame instrument refresh. */
  update(state) {
    const { glider, ground, objective, camera, mode, timer, score, streak } = state;

    this.alt.textContent = Math.round(glider.position.y);
    this.agl.textContent = `${Math.max(0, Math.round(glider.position.y - ground))} agl`;
    this.spd.textContent = Math.round(glider.airspeed * 3.6);

    const v = THREE.MathUtils.clamp(glider.varioSmooth / 5, -1, 1);
    this.varioFill.style.height = `${Math.abs(v) * 50}%`;
    this.varioFill.style.bottom = v >= 0 ? '50%' : `${50 - Math.abs(v) * 50}%`;
    this.varioFill.classList.toggle('down', v < 0);
    this.varioText.textContent = `${glider.varioSmooth >= 0 ? '+' : ''}${glider.varioSmooth.toFixed(1)}`;

    this.compassTape.style.backgroundPosition = `${-glider.headingDeg * 4}px 0`;

    if (objective) {
      this.objective.classList.add('on');
      this.objectiveName.textContent = objective.name;
      const d = objective.position.distanceTo(glider.position);
      this.objectiveDist.textContent = d > 1500 ? `${(d / 1000).toFixed(1)} km` : `${Math.round(d)} m`;
      this.#pointArrow(objective.position, camera, glider);
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
    <p>Soaring the Bernese Alps</p>
  </div>
  <div class="loading-bar"><span></span></div>
  <div class="loading-note">reading the terrain…</div>
</div>

<div class="menu">
  <div class="menu-inner">
    <header>
      <h1>WINDWARD</h1>
      <p class="sub">Jungfrau region · real terrain · 38 × 38 km</p>
    </header>

    <div class="modes">
      <button class="mode-card" data-action="start" data-value="free">
        <span class="mode-name">Free Flight</span>
        <span class="mode-desc">Hunt thermals, ride the ridges, find every landmark.</span>
      </button>
      <button class="mode-card" data-action="start" data-value="circuit">
        <span class="mode-name">Jungfrau Circuit</span>
        <span class="mode-desc">Eleven gates from Lauterbrunnen to the Eiger. Beat the clock.</span>
      </button>
      <button class="mode-card" data-action="start" data-value="climb">
        <span class="mode-name">Height Hunt</span>
        <span class="mode-desc">Five minutes. Climb as high as the air will let you.</span>
      </button>
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
        <span>Pull to climb</span>
        <div class="segmented" data-group="invert">
          <button class="on" data-action="invert" data-value="0">Normal</button>
          <button data-action="invert" data-value="1">Inverted</button>
        </div>
      </div>
    </div>

    <p class="hint">Keyboard: arrows or WASD to fly · Space boost · B airbrakes · C camera · R respawn</p>
  </div>
</div>

<div class="flight">
  <div class="top-bar">
    <div class="gauge">
      <b data-alt>0</b><span class="unit">m</span>
      <em data-agl>0 agl</em>
    </div>
    <div class="centre">
      <div class="compass"><div class="compass-tape"></div><div class="compass-mark"></div></div>
      <div class="objective">
        <span data-objective>—</span><b data-objdist>—</b>
      </div>
    </div>
    <div class="gauge right">
      <b data-spd>0</b><span class="unit">km/h</span>
      <em data-timer>0:00.0</em>
    </div>
  </div>

  <div class="vario">
    <div class="vario-track"><div class="vario-fill"></div></div>
    <span data-vario>0.0</span>
  </div>

  <div class="score-chip"><b data-score>0</b><span>pts</span></div>
  <div class="streak"></div>
  <div class="warn"></div>
  <div class="gate-arrow">➤</div>

  <button class="icon-btn pause" data-action="pause" aria-label="Pause">❚❚</button>
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
