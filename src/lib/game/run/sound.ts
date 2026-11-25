// R1: the run's four sounds, made with the Web Audio API. No file is loaded.
export interface Sound {
  pop(): void;
  collect(): void;
  goal(): void;
  buy(): void;
}

export type SoundName = 'pop' | 'collect' | 'goal' | 'buy';

export interface Voice {
  type: OscillatorType;
  from: number;
  to: number;
  glideS: number;
  atS: number;
  attackS: number;
  decayS: number;
  gain: number;
}

export interface AudioLike {
  readonly currentTime: number;
  readonly state: AudioContextState;
  readonly destination: AudioNode;
  resume(): Promise<void>;
  createOscillator(): OscillatorNode;
  createGain(): GainNode;
}

export interface SoundDeps {
  makeContext(): AudioLike | null;
  onGesture(fn: () => void): () => void;
}

export const SOUNDS: Record<SoundName, readonly Voice[]> = {
  pop: [
    {
      type: 'triangle',
      from: 880,
      to: 1174.66,
      glideS: 0.03,
      atS: 0,
      attackS: 0.005,
      decayS: 0.07,
      gain: 0.05
    }
  ],
  collect: [
    {
      type: 'sine',
      from: 1318.51,
      to: 1760,
      glideS: 0.06,
      atS: 0,
      attackS: 0.004,
      decayS: 0.12,
      gain: 0.07
    }
  ],
  goal: [
    {
      type: 'triangle',
      from: 523.25,
      to: 523.25,
      glideS: 0,
      atS: 0,
      attackS: 0.01,
      decayS: 0.35,
      gain: 0.08
    },
    {
      type: 'triangle',
      from: 659.25,
      to: 659.25,
      glideS: 0,
      atS: 0.11,
      attackS: 0.01,
      decayS: 0.35,
      gain: 0.08
    },
    {
      type: 'triangle',
      from: 783.99,
      to: 783.99,
      glideS: 0,
      atS: 0.22,
      attackS: 0.01,
      decayS: 0.35,
      gain: 0.08
    },
    {
      type: 'triangle',
      from: 1046.5,
      to: 1046.5,
      glideS: 0,
      atS: 0.33,
      attackS: 0.01,
      decayS: 0.6,
      gain: 0.08
    }
  ],
  buy: [
    {
      type: 'sine',
      from: 587.33,
      to: 587.33,
      glideS: 0,
      atS: 0,
      attackS: 0.005,
      decayS: 0.15,
      gain: 0.07
    },
    {
      type: 'sine',
      from: 880,
      to: 880,
      glideS: 0,
      atS: 0.08,
      attackS: 0.005,
      decayS: 0.15,
      gain: 0.07
    }
  ]
};

export const MIN_GAP_S: Record<SoundName, number> = {
  pop: 0.07,
  collect: 0.05,
  goal: 1,
  buy: 0.15
};
export const MASTER_GAIN = 1;
export const SILENT = 0.0001;

export function makeSound(muted: () => boolean, deps: SoundDeps): Sound {
  let ctx: AudioLike | null = null;
  let master: GainNode | null = null;
  const last: Record<SoundName, number> = {
    pop: -Infinity,
    collect: -Infinity,
    goal: -Infinity,
    buy: -Infinity
  };

  deps.onGesture(() => {
    const made = deps.makeContext();
    if (!made) return;
    ctx = made;
    master = made.createGain();
    master.gain.value = MASTER_GAIN;
    master.connect(made.destination);
    if (made.state === 'suspended') void made.resume();
  });

  function play(name: SoundName): void {
    if (!ctx || !master || muted()) return;
    const now = ctx.currentTime;
    if (now - last[name] < MIN_GAP_S[name]) return;
    last[name] = now;
    if (ctx.state === 'suspended') void ctx.resume();
    for (const v of SOUNDS[name]) {
      const t0 = now + v.atS;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = v.type;
      osc.frequency.setValueAtTime(v.from, t0);
      if (v.to !== v.from) osc.frequency.exponentialRampToValueAtTime(v.to, t0 + v.glideS);
      g.gain.setValueAtTime(SILENT, t0);
      g.gain.linearRampToValueAtTime(v.gain, t0 + v.attackS);
      g.gain.exponentialRampToValueAtTime(SILENT, t0 + v.attackS + v.decayS);
      osc.connect(g);
      g.connect(master);
      osc.start(t0);
      osc.stop(t0 + v.attackS + v.decayS + 0.02);
    }
  }

  return {
    pop: () => play('pop'),
    collect: () => play('collect'),
    goal: () => play('goal'),
    buy: () => play('buy')
  };
}

function nothing(): void {}

export function createSound(muted: () => boolean): Sound {
  if (typeof window === 'undefined' || typeof AudioContext === 'undefined') {
    return { pop: nothing, collect: nothing, goal: nothing, buy: nothing };
  }
  return makeSound(muted, {
    makeContext: () => new AudioContext(),
    onGesture(fn) {
      const events = ['pointerdown', 'keydown'] as const;
      const off = () => {
        for (const e of events) window.removeEventListener(e, handler, { capture: true });
      };
      const handler = () => {
        off();
        fn();
      };
      for (const e of events) window.addEventListener(e, handler, { capture: true });
      return off;
    }
  });
}
