// ---------------------------------------------------------------------------
// Sound effects, synthesised on the fly with the Web Audio API.
//
// Deliberately asset-free (like the painted background and the star texture):
// nothing to download, nothing to cache-bust, and it stays tiny. Every cue is
// a short envelope on one or two oscillators.
//
// Browsers refuse to start audio before a user gesture, so the context is
// created lazily and `unlockAudio()` is called from the first pointer input.
// ---------------------------------------------------------------------------

let ctx: AudioContext | null = null;
let available = true;

function context(): AudioContext | null {
  if (!available) return null;
  if (!ctx) {
    const Ctor =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) {
      available = false;
      return null;
    }
    try {
      ctx = new Ctor();
    } catch {
      available = false;
      return null;
    }
  }
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

/** Call once from a real user gesture so the audio context may start. */
export function unlockAudio(): void {
  context();
}

interface Tone {
  freq: number;
  /** Optional glide target, reached by the end of the tone. */
  to?: number;
  dur?: number;
  type?: OscillatorType;
  gain?: number;
  /** Seconds to wait before this tone starts (used to build little melodies). */
  delay?: number;
}

function play({ freq, to, dur = 0.12, type = "sine", gain = 0.15, delay = 0 }: Tone): void {
  const ac = context();
  if (!ac) return;
  const t0 = ac.currentTime + delay;

  const osc = ac.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (to) osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), t0 + dur);

  // Quick attack, exponential decay — reads as a "pop" rather than a beep.
  const env = ac.createGain();
  env.gain.setValueAtTime(0.0001, t0);
  env.gain.linearRampToValueAtTime(gain, t0 + 0.012);
  env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

  osc.connect(env).connect(ac.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.03);
}

export const sfx = {
  /** Tapping a fruit loose. */
  release(): void {
    play({ freq: 520, to: 360, dur: 0.09, type: "triangle", gain: 0.09 });
  },

  /** A pair clearing. Pitch climbs with the combo so chains feel rewarding. */
  match(streak = 0): void {
    const base = 660 * Math.pow(1.14, Math.min(streak, 6));
    play({ freq: base, to: base * 1.7, dur: 0.16, gain: 0.16 });
    play({ freq: base * 2, dur: 0.09, gain: 0.05, delay: 0.02 });
  },

  /** Opening a reserve slot — a small three-note fanfare. */
  unlock(): void {
    [523, 659, 784].forEach((f, i) =>
      play({ freq: f, dur: 0.18, type: "triangle", gain: 0.13, delay: i * 0.07 }),
    );
  },

  shuffle(): void {
    play({ freq: 300, to: 720, dur: 0.22, type: "triangle", gain: 0.1 });
  },

  win(): void {
    [523, 659, 784, 1047].forEach((f, i) =>
      play({ freq: f, dur: 0.34, type: "triangle", gain: 0.16, delay: i * 0.12 }),
    );
  },

  lose(): void {
    play({ freq: 392, to: 150, dur: 0.55, type: "sawtooth", gain: 0.09 });
  },
};
