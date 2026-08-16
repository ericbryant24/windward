/**
 * Input. Portrait phone is the primary target: one thumb on a stick that lives
 * wherever you first touch the left half of the screen, the other on two big
 * buttons. Keyboard and gamepad come along for free on desktop.
 */
export class Controls {
  constructor(root) {
    this.root = root;
    this.state = { roll: 0, pitch: 0, brake: 0, throttle: 1 };
    /**
     * Which of the two right-hand controls is fitted. A sailplane gets the
     * airbrake button; anything with an engine gets a lever instead, because
     * they are not the same control and no aeroplane in the fleet has both.
     */
    this.powered = false;
    this._throttle = 1;
    this.keys = new Set();
    this.enabled = true;
    this.tilt = null;
    this.tiltZero = null;
    this.useTilt = false;
    this.invertPitch = false;
    this.sensitivity = 1;

    this.stick = { active: false, id: null, ox: 0, oy: 0, x: 0, y: 0 };
    this.#buildUi();
    this.#bindTouch();
    this.#bindKeys();
  }

  #buildUi() {
    const el = document.createElement('div');
    el.className = 'controls';
    el.innerHTML = `
      <div class="stick-zone" data-zone="stick">
        <div class="stick" hidden>
          <div class="stick-base"></div>
          <div class="stick-knob"></div>
        </div>
        <div class="stick-hint">drag to fly</div>
      </div>
      <div class="button-stack">
        <button class="round-btn brake" data-btn="brake" aria-label="Airbrakes">
          <span class="glyph">◤◥</span><span class="label">BRAKE</span>
        </button>
        <div class="throttle" data-zone="throttle" hidden>
          <div class="throttle-track"><u></u></div>
          <div class="throttle-label">THR <b>100</b></div>
        </div>
      </div>`;
    this.root.appendChild(el);
    this.el = el;
    this.stickEl = el.querySelector('.stick');
    this.knobEl = el.querySelector('.stick-knob');
    this.hintEl = el.querySelector('.stick-hint');
    this.brakeBtn = el.querySelector('[data-btn="brake"]');
    this.throttleEl = el.querySelector('.throttle');
    this.throttleFill = el.querySelector('.throttle-track u');
    this.throttleText = el.querySelector('.throttle-label b');
  }

  /**
   * Fit the right-hand control to the aeroplane. Called whenever the ship
   * changes, which while one is issued is once, at boot.
   */
  setAircraft(spec) {
    this.powered = !!spec?.power;
    this.brakeBtn.hidden = this.powered;
    this.throttleEl.hidden = !this.powered;
    this._throttle = this.powered ? 1 : 0;
  }

  #bindTouch() {
    const zone = this.el.querySelector('.stick-zone');
    const radius = () => Math.min(88, Math.max(58, innerWidth * 0.17));

    const start = (e) => {
      if (!this.enabled) return;
      for (const t of e.changedTouches ?? [e]) {
        if (this.stick.active) break;
        this.stick.active = true;
        this.stick.id = t.identifier ?? 'mouse';
        this.stick.ox = t.clientX;
        this.stick.oy = t.clientY;
        this.stickEl.hidden = false;
        this.hintEl.style.opacity = '0';
        this.stickEl.style.left = `${t.clientX}px`;
        this.stickEl.style.top = `${t.clientY}px`;
        this.#knob(0, 0);
      }
      e.preventDefault();
    };
    const move = (e) => {
      if (!this.stick.active) return;
      for (const t of e.changedTouches ?? [e]) {
        if ((t.identifier ?? 'mouse') !== this.stick.id) continue;
        const r = radius();
        const dx = clamp((t.clientX - this.stick.ox) / r, -1, 1);
        const dy = clamp((t.clientY - this.stick.oy) / r, -1, 1);
        this.stick.x = dx;
        this.stick.y = dy;
        this.#knob(dx * r, dy * r);
      }
      e.preventDefault();
    };
    const end = (e) => {
      for (const t of e.changedTouches ?? [e]) {
        if ((t.identifier ?? 'mouse') !== this.stick.id) continue;
        this.stick.active = false;
        this.stick.id = null;
        this.stick.x = 0;
        this.stick.y = 0;
        this.stickEl.hidden = true;
      }
    };

    zone.addEventListener('touchstart', start, { passive: false });
    zone.addEventListener('touchmove', move, { passive: false });
    zone.addEventListener('touchend', end);
    zone.addEventListener('touchcancel', end);
    zone.addEventListener('mousedown', start);
    addEventListener('mousemove', move);
    addEventListener('mouseup', end);

    // The lever. Touch it anywhere on the track and it goes there, then drags —
    // a slider you have to grab by a handle is a slider nobody moves in a turn.
    const lever = this.throttleEl;
    const setFromY = (clientY) => {
      const r = lever.getBoundingClientRect();
      this._throttle = clamp(1 - (clientY - r.top) / Math.max(r.height, 1), 0, 1);
    };
    const leverStart = (e) => {
      if (!this.enabled || !this.powered) return;
      e.preventDefault();
      this._leverId = e.changedTouches ? e.changedTouches[0].identifier : 'mouse';
      lever.classList.add('down');
      setFromY((e.changedTouches ? e.changedTouches[0] : e).clientY);
    };
    const leverMove = (e) => {
      if (this._leverId == null) return;
      for (const t of e.changedTouches ?? [e]) {
        if ((t.identifier ?? 'mouse') !== this._leverId) continue;
        setFromY(t.clientY);
        e.preventDefault();
      }
    };
    const leverEnd = () => {
      this._leverId = null;
      lever.classList.remove('down');
    };
    lever.addEventListener('touchstart', leverStart, { passive: false });
    lever.addEventListener('touchmove', leverMove, { passive: false });
    lever.addEventListener('touchend', leverEnd);
    lever.addEventListener('touchcancel', leverEnd);
    lever.addEventListener('mousedown', leverStart);
    addEventListener('mousemove', leverMove);
    addEventListener('mouseup', leverEnd);

    const hold = (btn, on, off) => {
      btn.addEventListener('touchstart', (e) => {
        e.preventDefault();
        btn.classList.add('down');
        on();
      }, { passive: false });
      const up = (e) => {
        e.preventDefault();
        btn.classList.remove('down');
        off();
      };
      btn.addEventListener('touchend', up);
      btn.addEventListener('touchcancel', up);
      btn.addEventListener('mousedown', () => {
        btn.classList.add('down');
        on();
      });
      addEventListener('mouseup', () => {
        btn.classList.remove('down');
        off();
      });
    };
    hold(this.brakeBtn, () => (this._brakeHeld = true), () => (this._brakeHeld = false));
  }

  #knob(x, y) {
    this.knobEl.style.transform = `translate(calc(-50% + ${x}px), calc(-50% + ${y}px))`;
  }

  #bindKeys() {
    addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
  }

  /** iOS needs a user gesture before it will hand over motion events. */
  async enableTilt() {
    const D = window.DeviceOrientationEvent;
    if (!D) return false;
    if (typeof D.requestPermission === 'function') {
      try {
        if ((await D.requestPermission()) !== 'granted') return false;
      } catch {
        return false;
      }
    }
    addEventListener('deviceorientation', (e) => {
      this.tilt = { beta: e.beta ?? 0, gamma: e.gamma ?? 0 };
      if (!this.tiltZero) this.tiltZero = { ...this.tilt };
    });
    this.useTilt = true;
    return true;
  }

  recentreTilt() {
    if (this.tilt) this.tiltZero = { ...this.tilt };
  }

  setVisible(v) {
    this.el.style.display = v ? '' : 'none';
    this.enabled = v;
    if (!v) {
      this.stick.active = false;
      this.stick.x = 0;
      this.stick.y = 0;
      this.stickEl.hidden = true;
      this._brakeHeld = false;
      this._leverId = null;
    }
  }

  sample() {
    let roll = 0;
    let pitch = 0;
    const k = this.keys;
    if (k.has('ArrowLeft') || k.has('KeyA')) roll -= 1;
    if (k.has('ArrowRight') || k.has('KeyD')) roll += 1;
    if (k.has('ArrowUp') || k.has('KeyW')) pitch -= 1;
    if (k.has('ArrowDown') || k.has('KeyS')) pitch += 1;

    if (this.stick.active) {
      roll = this.stick.x;
      pitch = this.stick.y;
    } else if (this.useTilt && this.tilt && this.tiltZero) {
      roll = clamp((this.tilt.gamma - this.tiltZero.gamma) / 32, -1, 1);
      pitch = clamp((this.tilt.beta - this.tiltZero.beta) / 26, -1, 1);
    }

    const pad = navigator.getGamepads?.().find(Boolean);
    if (pad) {
      const dz = (v) => (Math.abs(v) < 0.14 ? 0 : v);
      if (dz(pad.axes[0])) roll = dz(pad.axes[0]);
      if (dz(pad.axes[1])) pitch = dz(pad.axes[1]);
    }

    // Pulling the stick back (screen-down) should raise the nose.
    const s = this.sensitivity;
    this.state.roll = clamp(roll * s, -1, 1);
    this.state.pitch = clamp((this.invertPitch ? -pitch : pitch) * s, -1, 1);
    // Space and the gamepad's bottom face button are the airbrakes' second
    // home: they were the boost, they are where a thumb already goes, and
    // there is nothing else left for them to do.
    this.state.brake =
      !this.powered &&
      (this._brakeHeld || k.has('KeyB') || k.has('ShiftLeft') || k.has('Space') || pad?.buttons?.[0]?.pressed)
        ? 1
        : 0;

    // The lever, off the keyboard and the right trigger as well as the slider.
    // Ramped rather than stepped, because a throttle that snaps between idle
    // and full is a switch, and half of flying this aeroplane is the bit in
    // between.
    if (this.powered) {
      const dt = 1 / 60;
      if (k.has('ShiftLeft') || k.has('Equal') || k.has('NumpadAdd')) this._throttle += 1.6 * dt;
      if (k.has('ControlLeft') || k.has('Minus') || k.has('NumpadSubtract')) this._throttle -= 1.6 * dt;
      const trigger = pad?.buttons?.[7]?.value ?? 0;
      if (trigger > 0.02) this._throttle = trigger;
      this._throttle = clamp(this._throttle, 0, 1);
      this.state.throttle = this._throttle;
      const pct = Math.round(this._throttle * 100);
      this.throttleFill.style.height = `${pct}%`;
      this.throttleText.textContent = pct;
    } else {
      this.state.throttle = 0;
    }
    return this.state;
  }
}

function clamp(v, a, b) {
  return v < a ? a : v > b ? b : v;
}
