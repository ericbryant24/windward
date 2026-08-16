/**
 * Procedural sound. No asset files: wind is filtered noise, and the variometer
 * is the real instrument — pitch and beep rate track the climb rate, so you can
 * find a thermal with your ears while your eyes stay on the ridge.
 */
export class Audio {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.started = false;
    this._beepAt = 0;
  }

  /** Must be called from a user gesture; browsers will not start audio otherwise. */
  start() {
    if (this.started) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    this.ctx = new Ctx();
    this.started = true;

    const ctx = this.ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.enabled ? 1 : 0;
    this.master.connect(ctx.destination);

    // ---- wind: two bands of noise, one airy, one rumbling ----------------
    const seconds = 3;
    const buffer = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < data.length; i++) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02; // brown-ish, less hissy
      data[i] = last * 3.2;
    }
    this.noise = ctx.createBufferSource();
    this.noise.buffer = buffer;
    this.noise.loop = true;

    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'bandpass';
    this.windFilter.frequency.value = 420;
    this.windFilter.Q.value = 0.7;

    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;

    this.rumbleFilter = ctx.createBiquadFilter();
    this.rumbleFilter.type = 'lowpass';
    this.rumbleFilter.frequency.value = 180;
    this.rumbleGain = ctx.createGain();
    this.rumbleGain.gain.value = 0;

    this.noise.connect(this.windFilter).connect(this.windGain).connect(this.master);
    this.noise.connect(this.rumbleFilter).connect(this.rumbleGain).connect(this.master);
    this.noise.start();

    if (ctx.state === 'suspended') ctx.resume();
  }

  setEnabled(on) {
    this.enabled = on;
    if (this.master) this.master.gain.value = on ? 1 : 0;
  }

  /** @param {{airspeed:number, vario:number, brake:number}} s */
  update(dt, s) {
    if (!this.started || !this.enabled) return;
    const ctx = this.ctx;
    if (ctx.state === 'suspended') return;

    const v = Math.max(0, s.airspeed);
    const t = ctx.currentTime;
    const airy = Math.min(1, (v / 62) ** 2) * (0.16 + s.brake * 0.22) + s.brake * 0.05;
    this.windGain.gain.setTargetAtTime(airy, t, 0.12);
    this.windFilter.frequency.setTargetAtTime(300 + v * 14, t, 0.12);
    this.rumbleGain.gain.setTargetAtTime(Math.min(0.10, (v / 70) ** 3 * 0.14), t, 0.15);

    // ---- variometer -------------------------------------------------------
    const climb = s.vario;
    if (climb > 0.35) {
      // faster and higher as the lift improves, exactly like the real thing
      const rate = 1.6 + Math.min(climb, 6) * 1.5;
      if (t > this._beepAt) {
        this.#beep(420 + Math.min(climb, 6) * 135, 0.075, 0.055);
        this._beepAt = t + 1 / rate;
      }
    } else if (climb < -3.2) {
      if (t > this._beepAt) {
        this.#beep(150 + Math.max(climb, -8) * 8, 0.5, 0.022, 'sine');
        this._beepAt = t + 0.55;
      }
    }
  }

  #beep(freq, duration, gain, type = 'triangle') {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    const t = ctx.currentTime;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + duration + 0.02);
  }

  cue(kind) {
    if (!this.started || !this.enabled) return;
    if (kind === 'gun') {
      // Short, dry and low. A burst is a dozen of these on top of each other,
      // so any tail at all turns into a drone.
      this.#beep(150 + Math.random() * 40, 0.045, 0.05, 'square');
    } else if (kind === 'gate') {
      this.#beep(880, 0.13, 0.09);
      setTimeout(() => this.#beep(1320, 0.16, 0.075), 70);
    } else if (kind === 'discovery') {
      this.#beep(660, 0.18, 0.06, 'sine');
      setTimeout(() => this.#beep(990, 0.3, 0.05, 'sine'), 120);
    } else if (kind === 'crash') {
      const ctx = this.ctx;
      const src = ctx.createBufferSource();
      const buf = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length) ** 2;
      src.buffer = buf;
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 320;
      const g = ctx.createGain();
      g.gain.value = 0.35;
      src.connect(f).connect(g).connect(this.master);
      src.start();
    } else if (kind === 'finish') {
      [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => this.#beep(f, 0.28, 0.07, 'sine'), i * 120));
    }
  }
}
