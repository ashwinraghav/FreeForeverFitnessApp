#!/usr/bin/env node
/**
 * Build the exercise catalogue from free-exercise-db.
 *
 *   node pipeline/build-exercise-catalogue.mjs [--input fixtures] [--out build]
 *
 * Output is gzipped JSON, not the binary format the food index uses. 873
 * exercises is three orders of magnitude smaller than the food corpus: the
 * catalogue gzips to well under the food index's *rounding error*, a linear
 * scan over 873 folded names is sub-millisecond, and a binary format plus a
 * search index would be more code, more schema surface and more ways to be
 * wrong, in exchange for kilobytes. Use the simple thing until the numbers say
 * otherwise.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

import { SCHEMA_VERSION } from '../src/schema.mjs';
import { fold } from '../src/text.mjs';
import { coachingFor } from './lib/cues.mjs';
import { ALL_MUSCLES, MUSCLE_GROUP, mapMuscles } from './lib/muscles.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const inputDir = resolve(ROOT, flag('--input', 'fixtures'));
const outDir = resolve(ROOT, flag('--out', 'build'));

/**
 * Pinned so a rebuild is reproducible and so the provenance recorded in
 * NOTICE.md §3 points at something specific rather than at "main".
 */
const UPSTREAM = {
  repo: 'yuhonas/free-exercise-db',
  url: 'https://github.com/yuhonas/free-exercise-db',
  licence: 'Unlicense',
  licenceUrl: 'https://unlicense.org/',
  imageBase: 'https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises/',
};

/**
 * How a set of this exercise is counted.
 *
 * Not in free-exercise-db, and not derivable from `category` alone: "Plank" and
 * "Push Up" are both `strength`, and one is held while the other is counted.
 * Emitted here rather than left to each consumer because it takes name
 * analysis, and analysis of the data belongs with the data.
 *
 * `loadKind` is deliberately NOT emitted: it follows from `equipment` with no
 * analysis at all ("body only" is bodyweight, "bands" is elastic, everything
 * else is external load), and a second field carrying the same fact is a second
 * field that can disagree with the first.
 *
 * EVERY category needs an entry. The first version of this function defaulted
 * to `reps` for anything it did not recognise, and `cardio` fell straight
 * through it — the whole category shipped claiming you do ten reps of an
 * elliptical. An exhaustive table plus a build failure on an unknown category
 * is the difference between a rule and a hope: the next category upstream adds
 * stops the build instead of quietly becoming reps.
 */
const CATEGORY_EFFORT = {
  strength: 'reps',
  powerlifting: 'reps',
  'olympic weightlifting': 'reps',
  plyometrics: 'reps',
  strongman: 'reps',
  stretching: 'time',
  /**
   * Time, uniformly. Every cardio movement here is legitimately logged by
   * duration, and duration is the axis that is never wrong — an elliptical and
   * a stationary bike have no distance to record. Outdoor running and rowing
   * can *also* be logged by distance, but that is a second metric alongside
   * time rather than a replacement for it, and choosing which axes a set
   * records is the logging schema's decision, not a property of the exercise.
   * A single-valued field should carry the axis you must record.
   */
  cardio: 'time',
};

/** Overrides the category default: a held or carried movement in any category. */
const TIMED = /plank|\bhold\b|isometric|wall sit|dead hang|side bridge/i;
const DISTANCE =
  /\bcarry\b|farmer'?s walk|monster walk|sled (drag|push|pull|row)|(backward|forward) drag|prowler|yoke walk|duck walk|waiter walk|overhead walk|bear crawl/i;

/**
 * @param {string} name @param {string} category
 * @returns {'reps'|'time'|'distance'|null} null when the category is unknown
 */
function effortUnitFor(name, category) {
  const base = CATEGORY_EFFORT[/** @type {keyof typeof CATEGORY_EFFORT} */ (category)];
  if (!base) return null;
  if (DISTANCE.test(name)) return 'distance';
  if (TIMED.test(name)) return 'time';
  return base;
}

/**
 * Gym shorthand, which is what people actually type into a search box mid-set.
 * Applied as aliases so "db curl" and "ohp" both find their exercise.
 */
const EQUIPMENT_SHORTHAND = {
  barbell: ['bb'],
  dumbbell: ['db'],
  kettlebells: ['kb', 'kettlebell'],
  'body only': ['bodyweight', 'no equipment'],
  'e-z curl bar': ['ez bar', 'ez curl'],
  machine: [],
  cable: [],
  bands: ['resistance band'],
};

/** Hand-curated synonyms for the movements people search for most. */
const NAME_ALIASES = [
  { match: /overhead press|shoulder press/i, aliases: ['ohp', 'press'] },
  { match: /bench press/i, aliases: ['bench'] },
  { match: /^barbell deadlift|conventional deadlift/i, aliases: ['deadlift', 'dl'] },
  { match: /romanian deadlift/i, aliases: ['rdl'] },
  { match: /barbell squat|back squat/i, aliases: ['squat'] },
  { match: /pullups?|pull-ups?/i, aliases: ['pull up', 'pullup'] },
  { match: /pushups?|push-ups?/i, aliases: ['push up', 'pushup', 'press up'] },
  { match: /lat pulldown/i, aliases: ['pulldown', 'lat pull'] },
  { match: /bent over row/i, aliases: ['barbell row', 'bor'] },
  { match: /hip thrust/i, aliases: ['glute bridge'] },
  { match: /triceps? pushdown|triceps? extension/i, aliases: ['tricep pushdown'] },
];

const raw = JSON.parse(await readFile(resolve(inputDir, 'free-exercise-db.json'), 'utf8'));

/** @type {any[]} */
const exercises = [];
/** @type {Record<string, number>} */
const patternCoverage = {};
const deltoidBasis = {
  /** @type {Record<string, number>} */ primary: {},
  /** @type {Record<string, number>} */ secondary: {},
};
/** @param {Record<string, number>} into @param {string} key */
const bump = (into, key) => {
  into[key] = (into[key] ?? 0) + 1;
};
/** @type {Set<string>} */
const unknownMuscles = new Set();
/** @type {Set<string>} */
const unknownCategories = new Set();
/** @type {Record<string, number>} */
const effortUnits = {};
let withoutCues = 0;

for (const src of raw) {
  const name = String(src.name ?? '').trim();
  const id = String(src.id ?? '').trim();
  if (!name || !id) continue;

  const equipment = normaliseEquipment(src.equipment);

  const p = mapMuscles(src.primaryMuscles ?? [], name, true);
  const sec = mapMuscles(src.secondaryMuscles ?? [], name, false);
  const primary = p.muscles;
  // A head that is a primary mover is not also a secondary one.
  const secondary = sec.muscles.filter((m) => !primary.includes(m));

  for (const u of [...p.unknown, ...sec.unknown]) unknownMuscles.add(u);
  if (p.basis) bump(deltoidBasis.primary, p.basis);
  if (sec.basis) bump(deltoidBasis.secondary, sec.basis);

  const ctx = {
    name: fold(name),
    equipment,
    category: String(src.category ?? 'strength'),
    mechanic: String(src.mechanic ?? ''),
    primary,
    secondary,
  };
  const effortUnit = () => {
    const unit = effortUnitFor(name, ctx.category);
    if (!unit) {
      unknownCategories.add(ctx.category);
      return 'reps';
    }
    return unit;
  };

  const coaching = coachingFor(ctx);
  for (const p of coaching.patterns) patternCoverage[p] = (patternCoverage[p] ?? 0) + 1;
  if (coaching.patterns.length === 0) withoutCues++;

  exercises.push({
    id,
    name,
    aliases: aliasesFor(name, equipment),
    // free-exercise-db leaves `mechanic` and `force` null on some entries;
    // null is carried through rather than guessed, so the app can hide the
    // field instead of showing a confident wrong answer.
    mechanic: src.mechanic ?? null,
    force: src.force ?? null,
    level: src.level ?? null,
    category: ctx.category,
    equipment,
    primaryMuscles: primary,
    secondaryMuscles: secondary,
    /**
     * How the deltoid split was determined for this exercise, or null if it has
     * no deltoid involvement. `unspecified` means the generic `shoulders` was
     * kept because neither the name nor the movement was conclusive — an honest
     * "don't know", not a default.
     */
    deltoidBasis: p.basis ?? sec.basis ?? null,
    effortUnit: effortUnit(),
    instructions: (src.instructions ?? []).map((/** @type {string} */ s) => s.trim()).filter(Boolean),
    formCues: coaching.cues,
    commonMistakes: coaching.mistakes,
    /**
     * False for every cue in this build: they are generated by the rule engine
     * in pipeline/lib/cues.mjs, not written by a coach. The app should render
     * generated coaching with less authority than authored coaching, and this
     * flag is how it tells them apart.
     */
    coachingAuthored: false,
    media: mediaRef(id),
    source: { repo: UPSTREAM.repo, id, licence: UPSTREAM.licence },
    upstreamImages: (src.images ?? []).map((/** @type {string} */ p) => UPSTREAM.imageBase + p),
  });
}

for (const e of exercises) effortUnits[e.effortUnit] = (effortUnits[e.effortUnit] ?? 0) + 1;

// An unrecognised upstream muscle name means free-exercise-db has been rebuilt
// with a vocabulary we do not know. Failing here is the point: the alternative
// is shipping exercises with silently empty muscle lists.
if (unknownMuscles.size > 0) {
  console.error(
    `\nunknown muscle name(s) from upstream: ${[...unknownMuscles].join(', ')}\n` +
      'Add them to MUSCLE in pipeline/lib/muscles.mjs before rebuilding.',
  );
  process.exit(1);
}

// Same reasoning, and the failure that would have caught the cardio bug: a
// category with no declared effort unit is a decision nobody has made yet, and
// silently calling it `reps` is how "ten reps of an elliptical" shipped.
if (unknownCategories.size > 0) {
  console.error(
    `\nunknown exercise category from upstream: ${[...unknownCategories].join(', ')}\n` +
      'Add an entry to CATEGORY_EFFORT in this file — decide whether a set of it is\n' +
      'counted in reps, held for time, or covered as distance — before rebuilding.',
  );
  process.exit(1);
}

exercises.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

const catalogue = {
  schemaVersion: SCHEMA_VERSION,
  builtAt: new Date().toISOString(),
  count: exercises.length,
  /**
   * Every muscle name that can appear in this catalogue. Published so a
   * consumer can assert its own map covers all of them and fail CI the day
   * upstream adds one, rather than silently shipping an empty muscle split.
   */
  muscles: ALL_MUSCLES,
  /** Rolls a specific deltoid head up to `shoulders` for consumers that total by group. */
  muscleGroups: MUSCLE_GROUP,
  equipment: [...new Set(exercises.map((e) => e.equipment))].sort(),
  effortUnits,
  deltoids: {
    basis: deltoidBasis,
    note:
      'Upstream has one muscle, `shoulders`. Heads are split by movement name; ' +
      '`unspecified` records keep the generic `shoulders` because neither the name ' +
      'nor the movement class was conclusive.',
  },
  contributions: {
    model: 'binary',
    note:
      'free-exercise-db distinguishes primary from secondary and nothing finer. Any ' +
      'fractional volume model (1.0/0.5 or otherwise) is the consumer\'s choice, not ' +
      'a fact from the data, and this pipeline will not invent one.',
  },
  source: UPSTREAM,
  coaching: {
    generator: 'pipeline/lib/cues.mjs',
    authored: false,
    patternCoverage,
    exercisesWithNoPatternMatch: withoutCues,
  },
  exercises,
};

await mkdir(outDir, { recursive: true });
const json = Buffer.from(`${JSON.stringify(catalogue, null, 1)}\n`, 'utf8');
const gz = gzipSync(json, { level: 9 });
await writeFile(resolve(outDir, 'exercises.json.gz'), gz);

const meta = {
  file: 'exercises.json.gz',
  count: exercises.length,
  bytes: json.length,
  gzipBytes: gz.length,
  sha256: `sha256-${createHash('sha256').update(gz).digest('base64')}`,
  licence: UPSTREAM.licence,
  source: UPSTREAM.url,
};
await writeFile(resolve(outDir, 'exercises.manifest.json'), `${JSON.stringify(meta, null, 2)}\n`);

console.log(`exercises  ${exercises.length} written, ${(gz.length / 1024).toFixed(1)} KB gz`);
console.log(
  `coaching   ${exercises.length - withoutCues}/${exercises.length} matched a movement pattern ` +
    `(${((1 - withoutCues / exercises.length) * 100).toFixed(1)}%)`,
);
const thin = Object.entries(patternCoverage).sort((a, b) => b[1] - a[1]);
console.log(`patterns   ${thin.map(([k, v]) => `${k}:${v}`).join(' ')}`);
for (const role of /** @type {const} */ (['primary', 'secondary'])) {
  const b = deltoidBasis[role];
  const total = Object.values(b).reduce((n, v) => n + v, 0);
  const resolved = total - (b.unspecified ?? 0);
  console.log(
    `deltoid ${role.padEnd(9)} ${resolved}/${total} heads resolved  ` +
      `(${Object.entries(b).map(([k, v]) => `${k}:${v}`).join(' ')})`,
  );
}
console.log(`effort     ${Object.entries(effortUnits).map(([k, v]) => `${k}:${v}`).join(' ')}`);

/** @param {unknown} e */
function normaliseEquipment(e) {
  const s = String(e ?? 'body only').toLowerCase().trim();
  return s === 'other' || s === '' ? 'body only' : s;
}

/** @param {string} name @param {string} equipment */
function aliasesFor(name, equipment) {
  const out = new Set();
  for (const rule of NAME_ALIASES) {
    if (rule.match.test(name)) for (const a of rule.aliases) out.add(a);
  }
  for (const short of EQUIPMENT_SHORTHAND[/** @type {keyof typeof EQUIPMENT_SHORTHAND} */ (equipment)] ?? []) {
    // "Barbell Curl" -> "bb curl"
    const swapped = fold(name).replace(fold(equipment), short).trim();
    if (swapped && swapped !== fold(name)) out.add(swapped);
  }
  return [...out];
}

/**
 * Where the demo loop will live once the media pipeline has run. Immutable,
 * version-pinned jsDelivr paths (ADR-0007) — see docs/media-budget.md.
 * The app must treat a 404 here as "no demo yet" and fall back to the text
 * instructions, because media ships behind the catalogue.
 * @param {string} id
 */
function mediaRef(id) {
  return { id, formats: ['webp'], status: 'pending' };
}

/** @param {string} name @param {string} fallback */
function flag(name, fallback) {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? /** @type {string} */ (argv[i + 1]) : fallback;
}
