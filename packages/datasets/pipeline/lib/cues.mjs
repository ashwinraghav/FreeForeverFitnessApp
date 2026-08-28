/**
 * Form cues and common mistakes.
 *
 * free-exercise-db ships instructions but no coaching. We need both, for 873
 * exercises, and nobody is going to hand-write 873 sets of cues before v1.
 *
 * So this is a rule engine over movement patterns rather than a lookup table:
 * a squat pattern gets squat cues, a horizontal press gets press cues, and an
 * exercise matches several patterns and accumulates their cues. It is the
 * deterministic, zero-cost version that constitution rule 1 asks for, and it is
 * honest about what it is — `authored: false` on every generated cue, so the app
 * can render generated coaching differently from written coaching, and so the
 * top ~100 exercises can be replaced with human copy without a schema change.
 *
 * The rules encode uncontroversial, safety-relevant coaching. Nothing here is
 * novel technique advice; where a cue would be genuinely contested, there is no
 * rule, and the exercise simply carries fewer cues.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @typedef {object} Pattern
 * @property {string} id
 * @property {(ctx:MatchContext) => boolean} match
 * @property {string[]} cues
 * @property {string[]} mistakes
 */

/**
 * @typedef {object} MatchContext
 * @property {string} name        folded exercise name
 * @property {string} equipment
 * @property {string} category
 * @property {string} mechanic
 * @property {string[]} primary
 * @property {string[]} secondary
 */

/** @param {MatchContext} c @param {...string} words */
const named = (c, ...words) => words.some((w) => c.name.includes(w));

/** @param {MatchContext} c @param {...string} muscles */
const hits = (c, ...muscles) => muscles.some((m) => c.primary.includes(m));

/** @type {Pattern[]} */
export const PATTERNS = [
  {
    id: 'squat',
    match: (c) => named(c, 'squat', 'lunge', 'step up', 'split squat', 'leg press'),
    cues: [
      'Drive through the middle of the foot, not the toes.',
      'Knees track over the toes — let them travel forward, keep them from collapsing inward.',
      'Brace as if about to be pushed, then start the descent.',
    ],
    mistakes: [
      'Knees caving in as you stand up.',
      'Heels lifting off the floor at the bottom.',
      'Losing the brace and rounding at the bottom of the rep.',
    ],
  },
  {
    id: 'hinge',
    match: (c) =>
      named(c, 'deadlift', 'good morning', 'romanian', 'hip thrust', 'swing', 'back extension'),
    cues: [
      'Push the hips back before the knees bend.',
      'Keep the bar or weight close to the legs the whole way.',
      'Finish by squeezing the glutes, not by leaning back.',
    ],
    mistakes: [
      'Rounding the lower back to reach the weight.',
      'Turning it into a squat by bending the knees first.',
      'Hyperextending at the top to "finish" the rep.',
    ],
  },
  {
    id: 'horizontal-press',
    match: (c) =>
      named(c, 'bench press', 'chest press', 'push up', 'pushup', 'fly', 'dip', 'floor press'),
    cues: [
      'Set the shoulder blades down and back, and keep them there.',
      'Elbows around 45° from the torso, not flared to 90°.',
      'Full range: touch, then press.',
    ],
    mistakes: [
      'Bouncing the weight off the chest.',
      'Flaring the elbows straight out to the sides.',
      'Letting the shoulders roll forward at lockout.',
    ],
  },
  {
    id: 'vertical-press',
    match: (c) => named(c, 'overhead press', 'shoulder press', 'military press', 'push press'),
    cues: [
      'Squeeze the glutes and brace so the ribs stay down.',
      'Move the head back out of the way, then back under the weight at the top.',
      'Press to full lockout with the biceps beside the ears.',
    ],
    mistakes: [
      'Leaning back and turning it into an incline press.',
      'Stopping short of lockout.',
      'Flaring the ribs and losing the brace.',
    ],
  },
  {
    id: 'vertical-pull',
    match: (c) => named(c, 'pull up', 'pullup', 'chin up', 'chinup', 'pulldown', 'lat pull'),
    cues: [
      'Start by pulling the shoulder blades down, then bend the arms.',
      'Drive the elbows down towards the back pockets.',
      'Control the way down — that half of the rep is where the size comes from.',
    ],
    mistakes: [
      'Kipping or swinging to get through the sticking point.',
      'Shrugging the shoulders up at the start of the pull.',
      'Dropping out of the bottom instead of lowering under control.',
    ],
  },
  {
    id: 'horizontal-pull',
    match: (c) => named(c, 'row', 'face pull', 'rear delt', 'shrug'),
    cues: [
      'Pull with the elbow, not the hand.',
      'Keep the torso still — if it swings, the weight is too heavy.',
      'Pause briefly at the top with the shoulder blade retracted.',
    ],
    mistakes: [
      'Using the lower back to heave the weight up.',
      'Cutting the range short at the bottom.',
      'Shrugging instead of rowing.',
    ],
  },
  {
    id: 'single-joint-arm',
    match: (c) => c.mechanic === 'isolation' && hits(c, 'biceps', 'triceps', 'forearms'),
    cues: [
      'Keep the upper arm still; only the elbow moves.',
      'Control the lowering — take about twice as long as the lift.',
    ],
    mistakes: ['Swinging the weight up with the torso.', 'Letting the elbow drift forward or back.'],
  },
  {
    id: 'core',
    match: (c) => hits(c, 'abdominals') || named(c, 'plank', 'crunch', 'sit up', 'hollow'),
    cues: [
      'Breathe. Holding your breath is not bracing.',
      'Move the ribs towards the hips rather than pulling on the neck.',
    ],
    mistakes: ['Pulling the head forward with the hands.', 'Letting the lower back arch off the floor.'],
  },
  {
    id: 'barbell',
    match: (c) => c.equipment === 'barbell',
    cues: ['Set the grip evenly — check the knurling marks on both sides before every set.'],
    mistakes: ['Uneven grip, which loads one side more than the other for the whole set.'],
  },
  {
    id: 'cable',
    match: (c) => c.equipment === 'cable',
    cues: ['Step out far enough that the stack never rests between reps.'],
    mistakes: ['Standing too close, so the weight touches down and the muscle unloads mid-set.'],
  },
  {
    id: 'stretch',
    match: (c) => c.category === 'stretching',
    cues: ['Ease to mild tension and hold; never bounce.', 'Keep breathing steadily through the hold.'],
    mistakes: ['Bouncing at end range.', 'Holding your breath.'],
  },
  {
    id: 'plyometric',
    match: (c) => c.category === 'plyometrics',
    cues: ['Land quietly — noise means the landing was not absorbed.', 'Keep the sets short; quality falls off fast.'],
    mistakes: ['Grinding out reps once the landings get sloppy.', 'Landing with locked-out knees.'],
  },
];

/**
 * Cues that apply to every loaded exercise. Kept to two: a wall of generic
 * advice on every screen trains people to ignore all of it.
 */
const UNIVERSAL = {
  cues: ['Pick a load that leaves the last rep clean.'],
  mistakes: [],
};

/**
 * @param {MatchContext} ctx
 * @returns {{cues:string[], mistakes:string[], patterns:string[]}}
 */
export function coachingFor(ctx) {
  /** @type {string[]} */
  const cues = [];
  /** @type {string[]} */
  const mistakes = [];
  /** @type {string[]} */
  const patterns = [];

  for (const p of PATTERNS) {
    if (!p.match(ctx)) continue;
    patterns.push(p.id);
    cues.push(...p.cues);
    mistakes.push(...p.mistakes);
  }
  if (ctx.category !== 'stretching') {
    cues.push(...UNIVERSAL.cues);
    mistakes.push(...UNIVERSAL.mistakes);
  }

  // Cap at four each. The design context is someone out of breath between sets,
  // and a list they will not read is the same as no list. (CLAUDE.md)
  return {
    cues: [...new Set(cues)].slice(0, 4),
    mistakes: [...new Set(mistakes)].slice(0, 4),
    patterns,
  };
}
