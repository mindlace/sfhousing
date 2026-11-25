import { describe, expect, it, vi } from 'vitest';
import {
  MASTER_GAIN,
  SILENT,
  SOUNDS,
  createSound,
  makeSound,
  type AudioLike,
  type SoundDeps
} from './sound';

type Call = [string, number, number];

class FakeParam {
  calls: Call[] = [];
  value = 0;
  setValueAtTime(v: number, t: number) {
    this.calls.push(['setValueAtTime', v, t]);
  }
  linearRampToValueAtTime(v: number, t: number) {
    this.calls.push(['linearRampToValueAtTime', v, t]);
  }
  exponentialRampToValueAtTime(v: number, t: number) {
    this.calls.push(['exponentialRampToValueAtTime', v, t]);
  }
}

class FakeNode {
  connected: unknown[] = [];
  connect(to: unknown) {
    this.connected.push(to);
  }
}

class FakeOsc extends FakeNode {
  type = '';
  frequency = new FakeParam();
  started: number[] = [];
  stopped: number[] = [];
  start(t: number) {
    this.started.push(t);
  }
  stop(t: number) {
    this.stopped.push(t);
  }
}

class FakeGain extends FakeNode {
  gain = new FakeParam();
}

class FakeAudio {
  currentTime = 0;
  state: string = 'running';
  destination = new FakeNode();
  resume = vi.fn(() => Promise.resolve());
  oscs: FakeOsc[] = [];
  gains: FakeGain[] = [];
  createOscillator() {
    const o = new FakeOsc();
    this.oscs.push(o);
    return o;
  }
  createGain() {
    const g = new FakeGain();
    this.gains.push(g);
    return g;
  }
}

function setup(muted = () => false) {
  const audio = new FakeAudio();
  let gesture: () => void = () => {};
  const makeContext = vi.fn(() => audio as unknown as AudioLike);
  const deps: SoundDeps = {
    makeContext,
    onGesture(fn) {
      gesture = fn;
      return () => {};
    }
  };
  const sound = makeSound(muted, deps);
  return { audio, sound, makeContext, fire: () => gesture() };
}

function close(call: Call | undefined, name: string, value: number, time: number) {
  expect(call?.[0]).toBe(name);
  expect(call?.[1]).toBeCloseTo(value, 9);
  expect(call?.[2]).toBeCloseTo(time, 9);
}

describe('sound', () => {
  it('SOUNDS holds the table', () => {
    const v = (
      type: 'sine' | 'triangle',
      from: number,
      to: number,
      glideS: number,
      atS: number,
      attackS: number,
      decayS: number,
      gain: number
    ) => ({ type, from, to, glideS, atS, attackS, decayS, gain });
    expect(SOUNDS).toEqual({
      pop: [v('triangle', 880, 1174.66, 0.03, 0, 0.005, 0.07, 0.05)],
      collect: [v('sine', 1318.51, 1760, 0.06, 0, 0.004, 0.12, 0.07)],
      goal: [
        v('triangle', 523.25, 523.25, 0, 0, 0.01, 0.35, 0.08),
        v('triangle', 659.25, 659.25, 0, 0.11, 0.01, 0.35, 0.08),
        v('triangle', 783.99, 783.99, 0, 0.22, 0.01, 0.35, 0.08),
        v('triangle', 1046.5, 1046.5, 0, 0.33, 0.01, 0.6, 0.08)
      ],
      buy: [
        v('sine', 587.33, 587.33, 0, 0, 0.005, 0.15, 0.07),
        v('sine', 880, 880, 0, 0.08, 0.005, 0.15, 0.07)
      ]
    });
    const total = Object.values(SOUNDS).reduce((n, voices) => n + voices.length, 0);
    expect(total).toBe(8);
  });

  it('plays nothing before the first gesture', () => {
    const { audio, sound, makeContext } = setup();
    sound.pop();
    expect(makeContext).not.toHaveBeenCalled();
    expect(audio.oscs).toHaveLength(0);
  });

  it('makes the context at the first gesture even while muted', () => {
    const { audio, sound, makeContext, fire } = setup(() => true);
    fire();
    expect(makeContext).toHaveBeenCalledTimes(1);
    expect(audio.gains).toHaveLength(1);
    sound.pop();
    expect(audio.oscs).toHaveLength(0);
  });

  it('plays nothing while muted', () => {
    let muted = true;
    const { audio, sound, fire } = setup(() => muted);
    fire();
    sound.pop();
    sound.collect();
    sound.goal();
    sound.buy();
    expect(audio.oscs).toHaveLength(0);
    muted = false;
    sound.pop();
    expect(audio.oscs).toHaveLength(1);
  });

  it("schedules each sound's voices with the table's numbers", () => {
    const { audio, sound, fire } = setup();
    fire();
    audio.currentTime = 2;
    sound.pop();
    const osc = audio.oscs[0];
    const gain = audio.gains[1];
    expect(osc.type).toBe('triangle');
    expect(osc.frequency.calls).toHaveLength(2);
    close(osc.frequency.calls[0], 'setValueAtTime', 880, 2);
    close(osc.frequency.calls[1], 'exponentialRampToValueAtTime', 1174.66, 2.03);
    expect(gain.gain.calls).toHaveLength(3);
    expect(gain.gain.calls[0]).toEqual(['setValueAtTime', SILENT, 2]);
    close(gain.gain.calls[1], 'linearRampToValueAtTime', 0.05, 2.005);
    close(gain.gain.calls[2], 'exponentialRampToValueAtTime', SILENT, 2.075);
    expect(osc.started).toEqual([2]);
    expect(osc.stopped[0]).toBeCloseTo(2.095, 9);
  });

  it('goal starts four oscillators on the table times, buy two, and a flat voice has no ramp', () => {
    const { audio, sound, fire } = setup();
    fire();
    audio.currentTime = 2;
    sound.goal();
    expect(audio.oscs).toHaveLength(4);
    const starts = audio.oscs.map((o) => o.started[0]);
    [2, 2.11, 2.22, 2.33].forEach((t, i) => expect(starts[i]).toBeCloseTo(t, 9));
    expect(audio.oscs[0].frequency.calls).toEqual([['setValueAtTime', 523.25, 2]]);
    expect(audio.oscs[3].stopped[0]).toBeCloseTo(2.33 + 0.01 + 0.6 + 0.02, 9);
    audio.currentTime = 10;
    sound.buy();
    expect(audio.oscs).toHaveLength(6);
    expect(audio.oscs[5].started[0]).toBeCloseTo(10.08, 9);
  });

  it('connects oscillator -> gain -> master, master at MASTER_GAIN -> destination, once', () => {
    const { audio, sound, fire } = setup();
    fire();
    sound.pop();
    const master = audio.gains[0];
    expect(master.gain.value).toBe(MASTER_GAIN);
    expect(master.connected).toEqual([audio.destination]);
    expect(audio.oscs[0].connected).toEqual([audio.gains[1]]);
    expect(audio.gains[1].connected).toEqual([master]);
    expect(audio.gains).toHaveLength(2);
  });

  it('drops a second pop 0.05 s after the first and plays one 0.08 s after', () => {
    const { audio, sound, fire } = setup();
    fire();
    audio.currentTime = 1;
    sound.pop();
    audio.currentTime = 1.05;
    sound.pop();
    expect(audio.oscs).toHaveLength(1);
    audio.currentTime = 1.08;
    sound.pop();
    expect(audio.oscs).toHaveLength(2);
  });

  it('a muted call does not move the last-played time', () => {
    let muted = false;
    const { audio, sound, fire } = setup(() => muted);
    fire();
    audio.currentTime = 1;
    sound.pop();
    muted = true;
    audio.currentTime = 1.05;
    sound.pop();
    muted = false;
    audio.currentTime = 1.08;
    sound.pop();
    expect(audio.oscs).toHaveLength(2);
  });

  it('resumes a suspended context and schedules the sound anyway', () => {
    const { audio, sound, fire } = setup();
    audio.state = 'suspended';
    fire();
    expect(audio.resume).toHaveBeenCalledTimes(1);
    sound.collect();
    expect(audio.resume).toHaveBeenCalledTimes(2);
    expect(audio.oscs).toHaveLength(1);
  });

  it('createSound without AudioContext returns a sound whose calls do nothing', () => {
    const s = createSound(() => false);
    expect(() => {
      s.pop();
      s.collect();
      s.goal();
      s.buy();
    }).not.toThrow();
  });
});
