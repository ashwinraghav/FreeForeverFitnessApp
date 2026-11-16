import { exerciseKey, type LocalDate } from '@freeforever/data';
import type {
  AdherenceAggregate,
  PersonalRecordsAggregate,
  PrAchievement,
  TrainingVolumeAggregate,
} from '@freeforever/data';
import type { CompletedSession } from '../../features/workout/model/history';
import type { DraftExercise, DraftSet } from '../../features/workout/model/types';
import type { MacroTargetValues } from '@freeforever/core/src/nutrition/index.js';
import type { NutritionDay } from '../../features/nutrition/data/types';

/**
 * The brief: everything the app knows, in a form a language model can read.
 *
 * ## Why this exists rather than an MCP server
 *
 * The obvious way to let someone ask an AI about their training is to expose the data
 * over MCP. That is not available here, and the reason is not cost — it is that
 * **there is nothing on a server to expose.** `../exportData.ts` says it plainly:
 * every session this app holds lives in `localStorage` on one device. A remote MCP
 * server would therefore need cloud sync, accounts, and the OAuth 2.1 + protected
 * resource metadata + dynamic client registration ladder the MCP spec requires of
 * HTTP transports, built before the first tool call could return a single set. That
 * is a standing service with a per-user cost, which ADR-0001 rule 2 forbids without a
 * ceiling, to serve data the user is already holding.
 *
 * So the data goes to the AI instead of the AI coming to the data. That is free by
 * construction: no endpoint, no key, no quota to enforce, and it works with whichever
 * assistant the user already pays for — which is also the only version of this that
 * honours rule 5, since the third-party call is theirs and not ours.
 *
 * ## Why not just hand over the JSON export
 *
 * Measured, by the size test at the bottom of `brief.test.ts`, on sessions of four
 * exercises and fourteen sets:
 *
 * | | export (pretty JSON) | brief | |
 * |---|---|---|---|
 * | one week, 56 sets | 49,698 B | 2,045 B | 24x |
 * | three weeks, 168 sets | 148,756 B | 3,534 B | 42x |
 * | a full store, 840 sets | 743,140 B | 12,462 B | **60x** |
 *
 * The ratio improves with size because the brief's fixed cost — the legend and the
 * suggested questions, about 1.4 KB — is paid once, while a set costs 11 bytes here
 * against roughly 630 in the export. That 630 is not whitespace: it is `id`,
 * `sortKey`, `loadKind`, `effortKind`, `state`, `performedAt` and four nulls on every
 * single set — fields that exist so two devices can merge a session without losing a
 * set, and that mean nothing to a reader.
 *
 * `MAX_LOCAL_HISTORY` caps the store at 60 sessions, so that 12 KB is not a typical
 * case, it is the **ceiling**: the largest brief this app can ever produce fits in any
 * context window with room to spare, where three quarters of a megabyte of JSON does
 * not.
 *
 * **This is an addition, never a replacement.** ADR-0001 rule 7 says export is
 * unconditional and complete, and the brief is deliberately lossy — it drops warm-ups,
 * ids, sort keys and per-set timestamps. `downloadLocalData()` stays exactly as it is
 * and remains the thing that means "take everything with you".
 *
 * ## Written to be read cold
 *
 * A model gets one shot at this with no schema and no follow-up questions, so the
 * brief explains its own notation in four lines and then never varies from it. Two
 * consequences worth keeping:
 *
 *  - **Numbers come from the same aggregates the Progress tab draws.** Volume, bests
 *    and streaks are read off `TrainingVolumeAggregate`, `PersonalRecordsAggregate`
 *    and `AdherenceAggregate` rather than recomputed here. A brief that disagreed with
 *    the chart on screen would be worse than no brief.
 *  - **A null aggregate omits its section.** A cold device mid-rebuild has nulls, and
 *    inventing a heading with nothing under it reads as "you have trained nothing".
 */

/** Everything the brief is built from. Pure in, string out — no reads, no clock. */
export interface BriefInputs {
  /** Newest-last, as the store holds them. Retracted sessions already excluded. */
  readonly sessions: readonly CompletedSession[];
  readonly volume: TrainingVolumeAggregate | null;
  readonly records: PersonalRecordsAggregate | null;
  readonly adherence: AdherenceAggregate | null;
  /** Only days with something logged. Newest first or last — sorted here either way. */
  readonly nutritionDays: readonly NutritionDay[];
  /**
   * The target in force on each of those days, keyed by `localDate`.
   *
   * Supplied rather than derived, and it has to be per-day: a plan can cycle calories
   * across the week (`planWeeklyTargets`), so "the target" is not one number. Empty
   * when the user has set no targets, which is a normal state.
   */
  readonly nutritionTargets: Readonly<Record<string, MacroTargetValues>>;
  readonly today: LocalDate;
  readonly timeZone: string;
  /** Supplied, never read from a clock, so the output is reproducible in a test. */
  readonly generatedAt: Date;
}

/** Weeks of volume detail. Eight is two mesocycles — enough to see a trend in. */
const VOLUME_WEEKS = 8;
/** Weeks that also get their per-muscle set counts, which are the wordiest lines. */
const MUSCLE_WEEKS = 4;
/** Muscles named per week. The tail is long and mostly noise. */
const MUSCLES_PER_WEEK = 5;
/** Days of food. Four weeks answers "how has my intake been lately" and stops. */
const FOOD_DAYS = 28;
/** Window for the "trained on N of the last M days" line. */
const CONSISTENCY_DAYS = 28;

export function buildBrief(inputs: BriefInputs): string {
  const sessions = [...inputs.sessions].sort((a, b) => b.startedAt - a.startedAt);
  const blocks: string[] = [header(inputs, sessions)];

  if (sessions.length === 0 && inputs.nutritionDays.length === 0) {
    // Nothing to explain the notation of, and nothing to ask about. A brief that
    // said "## Sessions" over an empty list would read as data loss.
    blocks.push('Nothing has been logged on this device yet.');
    return `${blocks.join('\n\n')}\n`;
  }

  if (sessions.length > 0) blocks.push(HOW_TO_READ);

  const names = displayNames(sessions);
  const bests = bestsBlock(inputs.records, names);
  if (bests !== null) blocks.push(bests);

  const consistency = consistencyBlock(inputs.adherence, inputs.today);
  if (consistency !== null) blocks.push(consistency);

  const weeks = volumeBlock(inputs.volume);
  if (weeks !== null) blocks.push(weeks);

  if (sessions.length > 0) blocks.push(sessionsBlock(sessions));

  const food = foodBlock(inputs.nutritionDays, inputs.nutritionTargets, inputs.today);
  if (food !== null) blocks.push(food);

  blocks.push(WORTH_ASKING);

  return `${blocks.join('\n\n')}\n`;
}

// ---------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------

function header(inputs: BriefInputs, sessions: readonly CompletedSession[]): string {
  // One sentence per line, never wrapped by hand. The brief is read in a chat window,
  // a `<pre>` on a 390px phone and a text editor, all of which wrap for themselves —
  // and a hand-wrapped line inside a wrapping column double-wraps into a ragged mess.
  // Seen on the `/brief` page at 390px, which is what this note is for.
  const lines = [
    '# Training brief',
    '',
    `Written by The Free Forever Fitness App, from one device. Weights in kilograms, energy in kilocalories, dates in the lifter's own timezone (${inputs.timeZone}).`,
  ];

  if (sessions.length > 0) {
    const newest = sessions[0]?.localDate ?? inputs.today;
    const oldest = sessions[sessions.length - 1]?.localDate ?? inputs.today;
    lines.push(
      '',
      `${count(sessions.length, 'session')} logged, ${oldest} to ${newest}.`,
      `Today is ${inputs.today}. Generated ${inputs.generatedAt.toISOString().slice(0, 16)}Z.`,
    );
  } else {
    lines.push('', `Today is ${inputs.today}. No workouts logged.`);
  }

  return lines.join('\n');
}

const HOW_TO_READ = [
  '## How to read this',
  '',
  '- A session line is `date (duration, bodyweight)`.',
  '- An exercise line lists its sets in the order performed: `weight x reps @ effort`.',
  '- `@8` is RPE 8 out of 10. `@2rir` is 2 reps in reserve. No `@` means effort was not rated, which is common and not a gap in the data.',
  '- A trailing `!` means the set was attempted and missed: a failed rep, a bail, form gone. Missed sets are real work and count toward volume, but never set a record.',
  '- Warm-up sets are omitted. So are sets that were never attempted.',
  '- Bodyweight-only work has no weight, so it reads `x12`. Timed work reads `45s` and distance work `400m`.',
].join('\n');

const WORTH_ASKING = [
  '## Worth asking',
  '',
  'Questions this brief can answer, if the lifter is unsure where to start:',
  '',
  '- Which muscle groups am I under-training relative to the rest?',
  '- Has a given lift genuinely progressed over the last six weeks, or just moved around?',
  '- Where am I adding weight faster than my reps are holding up?',
  '- Which lifts have I not touched in a month?',
  '- Is my protein intake actually consistent, or does it only average out?',
  '- Do the days I train look any different from the days I do not?',
].join('\n');

/**
 * Bests, one line per exercise.
 *
 * `heaviest_weight` and `best_e1rm` only. The aggregate tracks seven record types and
 * listing all of them buries the two anybody quotes — and `best_set_volume` in
 * particular is a number no lifter has ever said out loud.
 */
function bestsBlock(
  records: PersonalRecordsAggregate | null,
  names: ReadonlyMap<string, string>,
): string | null {
  if (records === null) return null;

  const lines: string[] = [];
  for (const [key, achievements] of Object.entries(records.byExerciseKey)) {
    const heaviest = pick(achievements, 'heaviest_weight');
    const e1rm = pick(achievements, 'best_e1rm');
    const parts: string[] = [];
    if (heaviest !== null) {
      const reps = heaviest.reps ?? 1;
      parts.push(`heaviest ${kg(heaviest.value)}kg x ${reps} (${heaviest.achievedOn})`);
    }
    if (e1rm !== null) parts.push(`best est. 1RM ${kg(e1rm.value)}kg (${e1rm.achievedOn})`);
    if (parts.length === 0) continue;
    lines.push(`${names.get(key) ?? key}: ${parts.join(' · ')}`);
  }

  if (lines.length === 0) return null;
  lines.sort((a, b) => a.localeCompare(b));
  return ['## Bests', '', ...lines].join('\n');
}

function consistencyBlock(
  adherence: AdherenceAggregate | null,
  today: LocalDate,
): string | null {
  if (adherence === null) return null;
  const streak = adherence.trainingStreak;
  const recent = adherence.activeDates.filter((date) => withinDays(date, today, CONSISTENCY_DAYS));
  if (streak.longestDays === 0 && recent.length === 0) return null;

  return [
    '## Consistency',
    '',
    `Trained on ${recent.length} of the last ${CONSISTENCY_DAYS} days.`,
    `Current streak ${count(streak.currentDays, 'day')}; longest ever ${count(streak.longestDays, 'day')}.`,
  ].join('\n');
}

/**
 * Weekly volume, newest first, with the per-muscle set split on recent weeks only.
 *
 * Sets per muscle rather than tonnage per muscle, because sets are what programming
 * is actually written in — and because tonnage flatters whoever squats.
 */
function volumeBlock(volume: TrainingVolumeAggregate | null): string | null {
  if (volume === null || volume.weeks.length === 0) return null;

  const weeks = [...volume.weeks].sort((a, b) => b.week.localeCompare(a.week)).slice(0, VOLUME_WEEKS);
  const lines = weeks.map((bucket, index) => {
    const head =
      `${bucket.week}  ${count(bucket.sessionCount, 'session')}, ` +
      `${count(bucket.workingSetCount, 'set')}, ${group(Math.round(bucket.volumeKg))}kg` +
      (bucket.failedSetCount > 0 ? `, ${bucket.failedSetCount} missed` : '');
    if (index >= MUSCLE_WEEKS) return head;

    const top = Object.entries(bucket.setsByMuscle)
      .filter((entry): entry is [string, number] => typeof entry[1] === 'number' && entry[1] > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, MUSCLES_PER_WEEK)
      .map(([muscle, sets]) => `${muscle.replace(/_/gu, ' ')} ${sets}`);
    return top.length === 0 ? head : `${head}\n  sets by muscle: ${top.join(', ')}`;
  });

  return [
    '## Weekly volume',
    '',
    'ISO weeks, most recent first. Volume is every attempted working set, missed ones included.',
    '',
    ...lines,
  ].join('\n');
}

function sessionsBlock(sessions: readonly CompletedSession[]): string {
  const lines = sessions.map((session) => {
    const meta = [durationOf(session), session.bodyweightKg === undefined ? null : `bw ${kg(session.bodyweightKg)}kg`]
      .filter((part): part is string => part !== null)
      .join(', ');
    const head = meta === '' ? session.localDate : `${session.localDate} (${meta})`;
    const edited = session.editedAt === undefined ? '' : ' [edited after the session]';
    const body = session.exercises
      .map(exerciseLine)
      .filter((line): line is string => line !== null);
    return [`${head}${edited}`, ...body].join('\n');
  });

  return ['## Sessions', '', 'Most recent first.', '', lines.join('\n\n')].join('\n');
}

/**
 * Food, one line per logged day.
 *
 * Totals only. The individual entries are the bulk of the nutrition state and the
 * questions worth asking of it — intake against target, protein consistency — are all
 * answerable from a day total. "What did I eat on the 14th" is a question for the app.
 */
function foodBlock(
  days: readonly NutritionDay[],
  targets: Readonly<Record<string, MacroTargetValues>>,
  today: LocalDate,
): string | null {
  const recent = days
    .filter((day) => day.entryCount > 0 && withinDays(day.localDate, today, FOOD_DAYS))
    .sort((a, b) => b.localDate.localeCompare(a.localDate));
  if (recent.length === 0) return null;

  const lines = recent.map((day) => {
    const t = day.totals;
    // `targetSnapshot` first, exactly as `DayScreen` does it: history is judged
    // against what was set at the time. Nothing writes a snapshot today, so in
    // practice this is always the plan's entry for that weekday — which is why the
    // plan has to be passed in. Reading only the snapshot, as the first version did,
    // meant the target never appeared at all on a real device.
    const target = day.targetSnapshot ?? targets[day.localDate];
    const against =
      target === undefined
        ? ''
        : `  / ${group(Math.round(target.energyKcal))} kcal P ${Math.round(target.proteinG)}g`;
    return (
      `${day.localDate}  ${group(Math.round(t.energyKcal))} kcal  ` +
      `P ${Math.round(t.proteinG)}g  C ${Math.round(t.carbsG)}g  F ${Math.round(t.fatG)}g${against}`
    );
  });

  const anyTarget = recent.some(
    (day) => (day.targetSnapshot ?? targets[day.localDate]) !== undefined,
  );

  return [
    `## Food`,
    '',
    `${count(recent.length, 'day')} logged in the last ${FOOD_DAYS}. Day totals only — the individual foods are not here.`,
    anyTarget
      ? 'After the slash is the target in force that day, which can differ across the week when calories are cycled.'
      : 'No calorie or macro target has been set, so there is nothing to judge these against.',
    '',
    ...lines,
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Lines and values
// ---------------------------------------------------------------------------

function exerciseLine(exercise: DraftExercise): string | null {
  const sets = exercise.sets.filter((set) => set.type !== 'warmup' && set.state !== 'pending');
  if (sets.length === 0) return null;
  return `  ${exercise.exercise.name}: ${sets.map(setNotation).join(' ')}`;
}

/**
 * One set, as short as it can be without becoming ambiguous.
 *
 * Built from which fields are actually present rather than from `loadKind`. The two
 * agree today; if they ever disagree, the numbers on the page are the truth and the
 * declared kind is the thing that is wrong.
 */
export function setNotation(set: DraftSet): string {
  const parts: string[] = [];

  if (set.weightKg !== null && set.reps !== null) parts.push(`${kg(set.weightKg)}x${set.reps}`);
  else if (set.reps !== null) parts.push(`x${set.reps}`);
  else if (set.weightKg !== null) parts.push(`${kg(set.weightKg)}`);

  if (set.durationSec !== null) parts.push(`${set.durationSec}s`);
  if (set.distanceM !== null) parts.push(`${set.distanceM}m`);
  if (parts.length === 0) parts.push('logged');

  let notation = parts.join(' ');
  if (set.effortRating !== undefined) {
    const { scale, value } = set.effortRating;
    notation += scale === 'rir' ? `@${trim(value)}rir` : `@${trim(value)}`;
  }
  if (set.state === 'failed') notation += '!';
  return notation;
}

function pick(achievements: readonly PrAchievement[], type: PrAchievement['type']): PrAchievement | null {
  // Newest first per the aggregate's contract, so the first match is the current
  // best — but the sort is cheap and makes that not something to remember.
  const matching = achievements.filter((a) => a.type === type);
  if (matching.length === 0) return null;
  return matching.reduce((best, next) => (next.value > best.value ? next : best));
}

/**
 * `exerciseKey` → the name as it read when logged.
 *
 * From the sessions rather than the catalogue, deliberately. `ExerciseRef` carries the
 * name because history has to render offline from one document (SCHEMA.md), so the
 * brief needs no catalogue load and can never rename a lift out from under a lifter's
 * own log. Newest session wins, which is why this walks newest-first input.
 */
function displayNames(sessions: readonly CompletedSession[]): ReadonlyMap<string, string> {
  const names = new Map<string, string>();
  for (const session of sessions) {
    for (const exercise of session.exercises) {
      const key = exerciseKey(exercise.exercise);
      if (!names.has(key)) names.set(key, exercise.exercise.name);
    }
  }
  return names;
}

function durationOf(session: CompletedSession): string | null {
  if (session.endedAt === undefined) return null;
  const minutes = Math.round((session.endedAt - session.startedAt) / 60_000);
  return minutes <= 0 ? null : `${minutes} min`;
}

/** Days between two `YYYY-MM-DD`s, inclusive of today. Calendar days, not elapsed ms. */
function withinDays(date: LocalDate | string, today: LocalDate, days: number): boolean {
  const then = Date.parse(`${date}T00:00:00Z`);
  const now = Date.parse(`${today}T00:00:00Z`);
  if (Number.isNaN(then) || Number.isNaN(now)) return false;
  const elapsed = (now - then) / 86_400_000;
  return elapsed >= 0 && elapsed < days;
}

/** `82.5`, `80`, never `80.0` — a trailing zero reads as precision that is not there. */
function kg(value: number): string {
  return `${trim(Math.round(value * 100) / 100)}`;
}

function trim(value: number): string {
  return String(Number(value.toFixed(2)));
}

/**
 * `18,400`. Grouped by hand rather than through `toLocaleString`, which would put a
 * different separator in the file depending on which device generated it — and the
 * reader is a model that should never have to guess whether `18.400` is eighteen
 * thousand or eighteen and change.
 */
function group(value: number): string {
  const [whole = '', ...rest] = String(Math.abs(value)).split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/gu, ',');
  const decimals = rest.length > 0 ? `.${rest.join('.')}` : '';
  return `${value < 0 ? '-' : ''}${grouped}${decimals}`;
}

function count(value: number, noun: string): string {
  return `${group(value)} ${noun}${value === 1 ? '' : 's'}`;
}
