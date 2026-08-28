import type { MuscleGroup } from '@freeforever/data';
import type { HeatLevel, MuscleHeatmap } from '../select/muscles';

/**
 * The between-sets glance.
 *
 * The whole point of this component is that it requires no reading. A lifter with
 * ninety seconds of rest, out of breath, in bad light, looks at it and sees where the
 * week's work went — no axis, no legend to decode, no number to parse. Fitbod's map
 * works for exactly this reason and the idea is stolen deliberately.
 *
 * Three rules it holds to, none of them optional:
 *
 * 1. **Every region is outlined in `line-strong`**, which the design system asserts
 *    at 3:1 against all four surfaces. So the anatomy is legible even where the fill
 *    is faint or absent, and an untrained muscle is a visible empty shape rather than
 *    a hole. This is the same rule the plate calculator follows, for the same reason.
 * 2. **The fill is an ordinal ramp, four steps, one hue** — validated for monotone
 *    lightness and a floor of 2:1 against the card surface in both themes. It is the
 *    only thing in this feature encoded by colour, and it is a magnitude, not an
 *    identity, which is what makes a single hue correct rather than a compromise.
 * 3. **Nothing here is the only way to read the value.** The map is `role="img"` with
 *    a summary; the interactive, screen-reader-navigable, keyboard-operable version
 *    of the same data is the list beside it, with real 48px rows. A tap target inside
 *    an SVG the size of a thumbnail is not a tap target.
 *
 * It is stimulus, not recovery: the aggregate buckets by ISO week, so "trained
 * yesterday" and "trained six days ago" are the same fact here. See `select/muscles`.
 */

type Shape =
  | { readonly kind: 'rect'; readonly x: number; readonly y: number; readonly w: number; readonly h: number; readonly r: number }
  | { readonly kind: 'ellipse'; readonly cx: number; readonly cy: number; readonly rx: number; readonly ry: number };

interface Region {
  readonly muscle: MuscleGroup;
  readonly shapes: readonly Shape[];
}

const rect = (x: number, y: number, w: number, h: number, r = 3): Shape => ({ kind: 'rect', x, y, w, h, r });
const ell = (cx: number, cy: number, rx: number, ry: number): Shape => ({ kind: 'ellipse', cx, cy, rx, ry });

/** Anterior view, drawn in a 100 x 200 box. Schematic on purpose — a diagram, not a plate. */
const FRONT: readonly Region[] = [
  { muscle: 'neck', shapes: [rect(44, 24, 12, 8, 2)] },
  { muscle: 'chest', shapes: [rect(30, 33, 18, 16, 4), rect(52, 33, 18, 16, 4)] },
  { muscle: 'front_delts', shapes: [ell(26, 38, 7, 8), ell(74, 38, 7, 8)] },
  { muscle: 'side_delts', shapes: [ell(19, 42, 5, 9), ell(81, 42, 5, 9)] },
  { muscle: 'biceps', shapes: [rect(16, 52, 10, 21, 5), rect(74, 52, 10, 21, 5)] },
  { muscle: 'forearms', shapes: [rect(12, 75, 9, 25, 4), rect(79, 75, 9, 25, 4)] },
  { muscle: 'abs', shapes: [rect(41, 52, 18, 30, 4)] },
  { muscle: 'obliques', shapes: [rect(33, 55, 6, 26, 3), rect(61, 55, 6, 26, 3)] },
  { muscle: 'quads', shapes: [rect(31, 92, 14, 40, 6), rect(55, 92, 14, 40, 6)] },
  { muscle: 'adductors', shapes: [rect(46, 94, 8, 28, 4)] },
];

/** Posterior view, same box, rendered translated. */
const BACK: readonly Region[] = [
  { muscle: 'traps', shapes: [rect(37, 26, 26, 18, 6)] },
  { muscle: 'rear_delts', shapes: [ell(26, 40, 7, 8), ell(74, 40, 7, 8)] },
  { muscle: 'upper_back', shapes: [rect(36, 46, 28, 14, 4)] },
  { muscle: 'lats', shapes: [rect(29, 48, 13, 28, 5), rect(58, 48, 13, 28, 5)] },
  { muscle: 'triceps', shapes: [rect(16, 52, 10, 21, 5), rect(74, 52, 10, 21, 5)] },
  { muscle: 'forearms', shapes: [rect(12, 75, 9, 25, 4), rect(79, 75, 9, 25, 4)] },
  { muscle: 'lower_back', shapes: [rect(41, 62, 18, 16, 4)] },
  { muscle: 'glutes', shapes: [rect(33, 82, 16, 20, 6), rect(51, 82, 16, 20, 6)] },
  { muscle: 'abductors', shapes: [rect(25, 84, 7, 20, 3), rect(68, 84, 7, 20, 3)] },
  { muscle: 'hamstrings', shapes: [rect(33, 104, 15, 32, 5), rect(52, 104, 15, 32, 5)] },
  { muscle: 'calves', shapes: [rect(35, 144, 12, 26, 5), rect(53, 144, 12, 26, 5)] },
];

/** The silhouette both views are drawn on. Never carries data — it is the ground. */
const SILHOUETTE =
  'M50 4c-6 0-10 4-10 10 0 5 2 8 4 10-8 2-16 6-20 12-4 6-6 16-7 26-1 8-3 20-5 28-1 5 6 7 8 2 ' +
  '2-7 4-16 5-22 1 8 1 18 1 26 0 10-1 22-1 34 0 10 1 22 2 32 1 8 2 18 2 26 0 5 8 5 9 0 1-8 2-18 ' +
  '3-28 1-8 2-18 3-24 1 6 2 16 3 24 1 10 2 20 3 28 1 5 9 5 9 0 0-8 1-18 2-26 1-10 2-22 2-32 ' +
  '0-12-1-24-1-34 0-8 0-18 1-26 1 6 3 15 5 22 2 5 9 3 8-2-2-8-4-20-5-28-1-10-3-20-7-26-4-6-12-10-20-12 ' +
  '2-2 4-5 4-10 0-6-4-10-10-10z';

const LEVEL_TEXT: Readonly<Record<HeatLevel, string>> = {
  0: 'not trained this week',
  1: 'light',
  2: 'moderate',
  3: 'high',
  4: 'highest this week',
};

function RegionShapes({ region, level }: { region: Region; level: HeatLevel }) {
  return (
    <g className={`ff-in-region ff-in-region--${level}`}>
      {region.shapes.map((shape, index) =>
        shape.kind === 'rect' ? (
          <rect
            key={index}
            x={shape.x}
            y={shape.y}
            width={shape.w}
            height={shape.h}
            rx={shape.r}
          />
        ) : (
          <ellipse key={index} cx={shape.cx} cy={shape.cy} rx={shape.rx} ry={shape.ry} />
        ),
      )}
    </g>
  );
}

export interface MuscleMapProps {
  readonly heatmap: MuscleHeatmap;
}

export function MuscleMap({ heatmap }: MuscleMapProps) {
  const levelOf = (muscle: MuscleGroup): HeatLevel => heatmap.byMuscle.get(muscle)?.level ?? 0;

  const trained = [...heatmap.byMuscle.values()]
    .filter((entry) => entry.sets > 0)
    .sort((a, b) => b.sets - a.sets);
  const summary =
    trained.length === 0
      ? 'No sets logged this week.'
      : `This week: ${trained
          .slice(0, 4)
          .map((entry) => `${entry.label} ${LEVEL_TEXT[entry.level]}`)
          .join(', ')}${trained.length > 4 ? `, and ${trained.length - 4} more` : ''}.`;

  return (
    <figure className="ff-in-map">
      <svg viewBox="0 0 216 190" role="img" aria-label={summary} className="ff-in-map__svg">
        {[FRONT, BACK].map((regions, viewIndex) => (
          <g key={viewIndex} transform={`translate(${viewIndex * 116} 0) scale(0.95)`}>
            <path className="ff-in-silhouette" d={SILHOUETTE} />
            {regions.map((region) => (
              <RegionShapes key={region.muscle} region={region} level={levelOf(region.muscle)} />
            ))}
          </g>
        ))}
      </svg>
      <figcaption className="ff-in-map__caption">
        <span>Front</span>
        <span>Back</span>
      </figcaption>
    </figure>
  );
}

/**
 * The scale legend. Steps are labelled in words as well as painted, because a
 * continuous colour scale with no key is exactly the colour-only encoding ADR-0013
 * forbids.
 */
export function MuscleMapLegend() {
  const levels: readonly HeatLevel[] = [0, 1, 2, 3, 4];
  return (
    <ul className="ff-in-legend" aria-label="Volume scale">
      {levels.map((level) => (
        <li key={level} className="ff-in-legend__item">
          <span className={`ff-in-swatch ff-in-swatch--${level}`} aria-hidden="true" />
          <span>{level === 0 ? 'None' : level === 4 ? 'Most' : LEVEL_TEXT[level]}</span>
        </li>
      ))}
    </ul>
  );
}
