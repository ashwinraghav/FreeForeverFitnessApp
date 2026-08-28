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
 * Canonical muscle vocabulary.
 *
 * free-exercise-db's list is close to what we want but splits the back into
 * "lats"/"middle back"/"lower back" and calls the quads "quadriceps". We keep
 * the distinctions (they matter for volume tracking) and only normalise the
 * spelling. NOTE for the domain-model team: if `packages/data` defines a muscle
 * enum, this map is the seam — change it here, not in the consumers.
 */
const MUSCLE = {
  abdominals: 'abdominals',
  abductors: 'abductors',
  adductors: 'adductors',
  biceps: 'biceps',
  calves: 'calves',
  chest: 'chest',
  forearms: 'forearms',
  glutes: 'glutes',
  hamstrings: 'hamstrings',
  lats: 'lats',
  'lower back': 'lower-back',
  'middle back': 'mid-back',
  neck: 'neck',
  quadriceps: 'quads',
  shoulders: 'shoulders',
  traps: 'traps',
  triceps: 'triceps',
};

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
let withoutCues = 0;

for (const src of raw) {
  const name = String(src.name ?? '').trim();
  const id = String(src.id ?? '').trim();
  if (!name || !id) continue;

  const equipment = normaliseEquipment(src.equipment);
  const primary = (src.primaryMuscles ?? []).map(muscle).filter(Boolean);
  const secondary = (src.secondaryMuscles ?? []).map(muscle).filter(Boolean);

  const ctx = {
    name: fold(name),
    equipment,
    category: String(src.category ?? 'strength'),
    mechanic: String(src.mechanic ?? ''),
    primary,
    secondary,
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

exercises.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

const catalogue = {
  schemaVersion: SCHEMA_VERSION,
  builtAt: new Date().toISOString(),
  count: exercises.length,
  muscles: [...new Set(Object.values(MUSCLE))].sort(),
  equipment: [...new Set(exercises.map((e) => e.equipment))].sort(),
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

/** @param {string} m */
function muscle(m) {
  return MUSCLE[/** @type {keyof typeof MUSCLE} */ (String(m).toLowerCase())] ?? null;
}

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
