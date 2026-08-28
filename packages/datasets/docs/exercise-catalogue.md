# Exercise catalogue — consumer contract

873 exercises from free-exercise-db, normalised. Public domain (Unlicense);
attribution given anyway. See `../NOTICE.md` §3.

## ⚠ It is 213 KB gzipped and 1.66 MB parsed. Lazy-load it.

For scale: the workout feature chunk is around 17 KB gzipped. This catalogue is
**twelve times that compressed, and roughly a hundred times parsed**. If it ends
up in an eager import path it dominates the initial payload of an app whose
whole premise is that it works instantly on a bad connection.

```js
// Correct: reader and data both load on first exercise-picker open.
const { openExerciseCatalogue } = await import('@freeforever/datasets/exercises');
const catalogue = await openExerciseCatalogue({ url: '/data/exercises.json.gz' });

// Wrong: pulls the reader into the eager graph, and invites someone to call it there.
import { openExerciseCatalogue } from '@freeforever/datasets';
```

The recommended shape, which the workout team is already following: ship a small
synchronous starter set of the most common exercises, and lazy-load these 873
behind it on first picker open.

`openExerciseCatalogue()` is async and resolves its data at call time rather than
through a static import, so a bundler cannot pull the artefact into a chunk on
its own. Keeping the *call* off the startup path is still the caller's job.
`CATALOGUE_SIZE` is exported if you want to make the decision in code.

## Loading

| Form | When |
|---|---|
| `openExerciseCatalogue({ url })` | the app. Fetches and decompresses |
| `openExerciseCatalogue({ bytes })` | you already have the body |
| `openExerciseCatalogue()` | **Node only** — reads the packaged artefact. Tests and CI |

Gzip is handled by `DecompressionStream` where available, `node:zlib` otherwise.
A body the server already decompressed passes through unharmed.

## API

```ts
catalogue.get('Barbell_Squat')                     // Exercise | null
catalogue.all()                                    // Exercise[], name order
catalogue.search('bb squ', { limit: 20 })          // ExerciseSearchHit[]
catalogue.filter({ muscle: 'shoulders', equipment: 'barbell' })
catalogue.unmappedMuscleNames(myMuscleEnum)        // string[] — assert empty
catalogue.unmappedEquipmentNames(myEquipmentEnum)  // string[] — assert empty
```

`search()` folds identically to the food index — tokens ANDed, last token a
prefix, diacritics and punctuation ignored — so both search boxes behave the
same. Aliases carry gym shorthand: `ohp`, `rdl`, `bb squat`. An exact name match
outranks a longer variant, so `"barbell squat"` returns *Barbell Squat* above
*Barbell Full Squat*.

`filter({ muscle })` accepts either a specific head or a group: `shoulders`
matches `front-delts`, `side-delts` and `rear-delts` as well as the generic
value.

## The deltoid split

**Upstream has one muscle, `shoulders`. We publish three heads.** Volume
tracking needs them: a programme that presses a lot and never rows has a hole in
it that a single `shoulders` number hides.

The tempting inference is from `force` — push → front, pull → rear. It is wrong
often enough to matter. In this dataset *Side Lateral Raise*, *Seated Side
Lateral Raise*, *One-Arm Side Laterals*, *Alternating Deltoid Raise* and
*Lateral Raise - With Bands* are all marked `push` and are all lateral-head work;
*Cable Seated Lateral Raise* is marked `pull` and is also lateral. Movement names
carry what `force` does not.

So the pipeline matches names first, falls back to the movement class for
secondary involvement, and where neither is conclusive **keeps the generic
`shoulders` and says so** in `deltoidBasis`.

| `deltoidBasis` | Meaning | Primary | Secondary |
|---|---|---:|---:|
| `name` | the movement name was conclusive | 106 | 85 |
| `movement` | inferred from movement class (a bench press works the front delts) | — | 60 |
| `unspecified` | neither conclusive; generic `shoulders` kept | 21 | 64 |
| | **resolved** | **106/127** | **145/209** |

The 21 unresolved primaries are Turkish get-ups, battling ropes, shoulder
stretches and similar — movements that genuinely work all three heads or are
genuinely unclear. A confident single answer there would be fabricated. An
honest "don't know" is more useful, because a consumer can decide what to do
about it and cannot detect a plausible mistake.

Rotator-cuff movements (external rotation) map to `rear-delts`: the dataset has
no rotator cuff, the posterior deltoid is the nearest true thing, and the
alternative is discarding the record.

## Muscle contributions are binary, and we will not invent fractions

free-exercise-db distinguishes primary from secondary and nothing finer. There
is no basis in the data for 1.0/0.5, or for any other split.

That is not a gap this pipeline should fill. A fractional volume model is a
**training-domain decision** — it belongs in `packages/core/src/training` with
the progression and e1RM logic, where it can be argued about on the merits and
changed without rebuilding a dataset. If this package emitted numbers, they
would look like facts from the source and they would not be.

What we do guarantee: the primary/secondary distinction is faithful, and a
muscle never appears in both lists on the same exercise. The catalogue header
carries `contributions.model: "binary"` so the limitation is discoverable from
the artefact.

## `effortUnit`

How a set is counted: `reps` (732), `time` (130), `distance` (11).

Not in the upstream data, and not derivable from `category` alone — *Plank* and
*Push Up* are both `strength`, and one is held while the other is counted. It
takes name analysis, and analysis of the data belongs with the data rather than
in each consumer's adapter.

There is deliberately **no `loadKind`** companion. Load follows from `equipment`
with no analysis at all: `body only` is bodyweight, `bands` is elastic,
everything else is external. A second field carrying the same fact is a second
field that can disagree with the first.

## Form cues and common mistakes

Generated by a movement-pattern rule engine (`pipeline/lib/cues.mjs`), matching
82% of exercises. **Every one is marked `coachingAuthored: false`.** Render
generated coaching with less authority than written coaching. The flag exists so
that the top ~100 exercises can be replaced with human copy later without a
schema change.

## Guarding against upstream drift

`catalogue.muscles` and `catalogue.equipment` publish every value that can
appear. Assert your enum covers them:

```js
assert.deepEqual(catalogue.unmappedMuscleNames(MY_MUSCLES), []);
assert.deepEqual(catalogue.unmappedEquipmentNames(MY_EQUIPMENT), []);
```

The build enforces the same thing from its side: an unrecognised upstream muscle
name **fails the build** rather than shipping an exercise with a silently empty
muscle list.
