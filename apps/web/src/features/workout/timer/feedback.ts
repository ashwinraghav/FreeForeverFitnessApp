/**
 * Haptics and sound for the rest timer.
 *
 * Both are best-effort and both are feature-detected, because the alternative — a
 * thrown exception inside a timer tick — takes the whole screen down mid-session.
 * Everything here returns a boolean saying whether it actually happened, so a caller
 * can decide whether the visual signal has to work harder.
 *
 * The timer bar is never *only* audible or *only* haptic: the bar itself changes
 * colour and glyph and announces politely. Sound is a bonus for a phone in a pocket.
 */

/** A short double buzz. Distinct from the single tick a set log gives. */
export const REST_DONE_PATTERN: readonly number[] = [120, 80, 200];
/** One short tick, for a logged set. */
export const SET_LOGGED_PATTERN: readonly number[] = [25];

export function vibrate(pattern: readonly number[]): boolean {
  const navigator = globalThis.navigator as Navigator & {
    vibrate?: (pattern: number | number[]) => boolean;
  };
  if (typeof navigator?.vibrate !== 'function') return false;
  try {
    return navigator.vibrate([...pattern]);
  } catch {
    // Safari has shipped a `vibrate` that throws under some privacy settings.
    return false;
  }
}

type AudioContextCtor = new () => AudioContext;

let context: AudioContext | null = null;

function audioContextCtor(): AudioContextCtor | null {
  const scope = globalThis as unknown as {
    AudioContext?: AudioContextCtor;
    webkitAudioContext?: AudioContextCtor;
  };
  return scope.AudioContext ?? scope.webkitAudioContext ?? null;
}

/**
 * Create and unlock the audio context.
 *
 * Must be called from inside a real user gesture — tapping the log button is the
 * natural one — or every browser's autoplay policy leaves the context suspended and
 * the rest alarm is silent two minutes later with no error anywhere.
 */
export function primeAudio(): void {
  const Ctor = audioContextCtor();
  if (Ctor === null) return;
  try {
    context ??= new Ctor();
    if (context.state === 'suspended') void context.resume();
  } catch {
    context = null;
  }
}

/**
 * A short two-tone chime, synthesised rather than fetched.
 *
 * No audio file: the app has to work fully offline from a cold cache in a basement
 * gym, and an oscillator is a few lines against a network request and a cache entry.
 */
export function playRestDone(): boolean {
  if (context === null) primeAudio();
  const ctx = context;
  if (ctx === null) return false;
  if (ctx.state === 'suspended') void ctx.resume();

  try {
    const now = ctx.currentTime;
    for (const [index, frequency] of [880, 1320].entries()) {
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.value = frequency;
      const start = now + index * 0.16;
      // A hard start and stop on a sine is an audible click. Ramp both ends.
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.25, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.14);
      oscillator.connect(gain).connect(ctx.destination);
      oscillator.start(start);
      oscillator.stop(start + 0.16);
    }
    return true;
  } catch {
    return false;
  }
}

/** Everything the end of a rest should do, in one call. Silent failures are fine. */
export function signalRestDone(): void {
  vibrate(REST_DONE_PATTERN);
  playRestDone();
}

/** Release the audio context. For a screen unmounting, and for tests. */
export function releaseAudio(): void {
  const ctx = context;
  context = null;
  try {
    void ctx?.close();
  } catch {
    /* Already closed, or never really open. */
  }
}
