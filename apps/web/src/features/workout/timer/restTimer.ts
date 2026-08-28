/**
 * The rest timer, as arithmetic.
 *
 * **A rest timer must never count.** `setInterval` is throttled to once a minute in a
 * backgrounded tab, stops entirely when the phone locks, and does not exist at all
 * after the app is killed and reopened. A timer built by decrementing a counter is
 * therefore wrong in the three situations it is most needed: pocket, lock screen, and
 * "I switched to Spotify between sets".
 *
 * So nothing here counts. The whole state is a **start instant and a duration**, both
 * plain numbers, and every displayed value is a function of those two and `Date.now()`.
 * An interval exists in the hook upstairs purely to repaint; if it is throttled to
 * once a minute, or stops, or never runs, the number shown on the next repaint is
 * still exactly right. Persist `{ startedAt, durationSec }` and the timer survives a
 * kill for free, because there was never any in-memory progress to lose.
 *
 * The one thing this cannot survive is the wall clock itself moving — an NTP
 * correction or a manual clock change mid-rest shifts the remaining time. The
 * alternative, a monotonic clock, does not survive a reload, and of the two failures
 * a rare few-second jump beats losing the timer every time the screen locks.
 */

export interface RestTimerState {
  /** Wall clock at the moment the rest started, epoch ms. The whole source of truth. */
  readonly startedAt: number;
  readonly durationSec: number;
  /** Which set this rest follows, so the row can show it and the next set can log it. */
  readonly exerciseId: string;
  readonly setId: string;
  /** Set once the finish has been signalled, so a resume does not re-alarm. */
  readonly alarmedAt?: number;
}

export const DEFAULT_REST_SEC = 120;
export const MIN_REST_SEC = 5;
export const MAX_REST_SEC = 3600;

/**
 * How far past the deadline a resume will still sound the alarm.
 *
 * Coming back to the app four seconds after the timer ran out should buzz. Coming
 * back twenty minutes later should not — the rest is long over, and a phone that
 * vibrates in the changing room is a phone people turn the feature off on.
 */
export const ALARM_GRACE_MS = 20_000;

export function startRest(
  exerciseId: string,
  setId: string,
  durationSec: number,
  now: number = Date.now(),
): RestTimerState {
  return { startedAt: now, durationSec: clampDuration(durationSec), exerciseId, setId };
}

/** Milliseconds since the rest began. Never negative, even if the clock went backwards. */
export function elapsedMs(state: RestTimerState, now: number): number {
  return Math.max(0, now - state.startedAt);
}

/** Milliseconds left. Goes **negative** past the deadline: overtime is information. */
export function remainingMs(state: RestTimerState, now: number): number {
  return state.durationSec * 1000 - elapsedMs(state, now);
}

export function isFinished(state: RestTimerState, now: number): boolean {
  return remainingMs(state, now) <= 0;
}

/** 0 to 1, clamped. For a progress bar that must not overflow its track in overtime. */
export function progress(state: RestTimerState, now: number): number {
  if (state.durationSec <= 0) return 1;
  return Math.min(1, Math.max(0, elapsedMs(state, now) / (state.durationSec * 1000)));
}

/** Rest actually taken, in whole seconds — what gets written to `restSecBefore`. */
export function restTakenSec(state: RestTimerState, now: number): number {
  return Math.round(elapsedMs(state, now) / 1000);
}

/**
 * Add or remove time without restarting.
 *
 * Adjusts the duration rather than the start, so the elapsed time — and therefore the
 * `restSecBefore` eventually logged — stays true to what actually happened.
 */
export function adjustRest(state: RestTimerState, deltaSec: number): RestTimerState {
  const next = clampDuration(state.durationSec + deltaSec);
  if (next === state.durationSec) return state;
  // Re-arm: extending a finished timer means the lifter wants another alarm.
  const rearmed = omitAlarm(state);
  return { ...rearmed, durationSec: next };
}

/** Mark the finish as signalled, so a later resume stays quiet. */
export function markAlarmed(state: RestTimerState, now: number): RestTimerState {
  return { ...state, alarmedAt: now };
}

/**
 * Should the alarm fire right now?
 *
 * True only on the transition: the deadline has passed, it has not been signalled
 * before, and it passed recently enough that a buzz still means something.
 */
export function shouldAlarm(state: RestTimerState, now: number): boolean {
  if (state.alarmedAt !== undefined) return false;
  const remaining = remainingMs(state, now);
  return remaining <= 0 && remaining > -ALARM_GRACE_MS;
}

/**
 * Did the deadline pass while nobody was looking?
 *
 * Distinct from {@link shouldAlarm} because the two want opposite treatment: this one
 * marks the timer as done silently, so returning to the app after a long break does
 * not buzz for a rest that ended twenty minutes ago.
 */
export function missedAlarm(state: RestTimerState, now: number): boolean {
  return state.alarmedAt === undefined && remainingMs(state, now) <= -ALARM_GRACE_MS;
}

/**
 * `m:ss`, or `-m:ss` in overtime.
 *
 * Rounds away from zero on both sides, so a timer started at 90 seconds reads "1:30"
 * on its first frame rather than flashing "1:29", and the first millisecond past the
 * deadline reads "-0:01" rather than "0:00". Both halves use `ceil` on the magnitude,
 * which is what makes the two sides symmetric: fifteen seconds over is "-0:15", not
 * "-0:16".
 */
export function formatClock(ms: number): string {
  const overtime = ms < 0;
  const totalSeconds = Math.ceil(Math.abs(ms) / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${overtime ? '-' : ''}${minutes}:${String(seconds).padStart(2, '0')}`;
}

/** The same value, spoken. Screen readers read "1:30" as "one hundred thirty". */
export function announceClock(ms: number): string {
  const overtime = ms < 0;
  const totalSeconds = Math.ceil(Math.abs(ms) / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const parts: string[] = [];
  if (minutes > 0) parts.push(`${minutes} minute${minutes === 1 ? '' : 's'}`);
  if (seconds > 0 || minutes === 0) parts.push(`${seconds} second${seconds === 1 ? '' : 's'}`);
  return overtime ? `${parts.join(' ')} over` : `${parts.join(' ')} left`;
}

function clampDuration(seconds: number): number {
  if (!Number.isFinite(seconds)) return DEFAULT_REST_SEC;
  return Math.min(MAX_REST_SEC, Math.max(MIN_REST_SEC, Math.round(seconds)));
}

function omitAlarm(state: RestTimerState): RestTimerState {
  const { alarmedAt: _alarmed, ...rest } = state;
  return rest;
}
