import { Button, IconButton, MinusGlyph, PlusGlyph } from '@freeforever/design-system';

import { announceClock, formatClock, isFinished, progress, remainingMs, type RestTimerState } from './restTimer.js';

/**
 * The rest timer, as a persistent bar rather than a screen.
 *
 * Ambient is the whole design. A full-screen countdown takes the session away from the
 * lifter at exactly the moment they want to look at what they just did and decide what
 * goes on the bar next — and then they have to dismiss it, which is one more tap
 * between them and the next set. This sits above the tab bar, always the same height,
 * and the list behind it stays scrollable and editable the whole time.
 *
 * The state that reaches this component is a start instant and a duration
 * (`restTimer.ts`), so the number is right on the first paint after the phone comes out
 * of a pocket, after a lock, and after the app is killed and reopened.
 *
 * Done is signalled three ways — the clock goes negative and gains a minus sign, the
 * colour changes, and the label changes from "Rest" to "Rest over". Never colour alone
 * (ADR-0013).
 */

export interface RestBarProps {
  readonly rest: RestTimerState;
  readonly now: number;
  /** What the rest follows, e.g. "Bench Press set 2". One line, no wrapping. */
  readonly forLabel: string;
  readonly onAdjust: (deltaSec: number) => void;
  readonly onSkip: () => void;
}

/** How much a nudge adds or removes. Big enough to matter, small enough to repeat. */
export const REST_NUDGE_SEC = 30;

export function RestBar({ rest, now, forLabel, onAdjust, onSkip }: RestBarProps) {
  const remaining = remainingMs(rest, now);
  const done = isFinished(rest, now);
  const fraction = progress(rest, now);

  return (
    <div className="ffw-restbar" data-ff-done={done ? 'true' : 'false'}>
      <div className="ffw-restbar__body">
        {/*
          `aria-live` is off. A timer that announces every second makes a screen reader
          unusable for the forty minutes it is on screen; the finish is announced once,
          below, and the clock itself is readable on demand.
        */}
        <span className="ffw-restbar__clock" aria-hidden="true">
          {formatClock(remaining)}
        </span>
        <span className="ff-visually-hidden" role="status">
          {done ? `Rest over for ${forLabel}` : ''}
        </span>

        <span className="ff-visually-hidden">
          {done ? 'Rest over' : 'Resting'}, {announceClock(remaining)}, {forLabel}
        </span>

        <span className="ffw-restbar__spacer" />

        <IconButton
          icon={<MinusGlyph />}
          aria-label={`Take ${REST_NUDGE_SEC} seconds off the rest`}
          size="xl"
          variant="secondary"
          onClick={() => onAdjust(-REST_NUDGE_SEC)}
        />
        <IconButton
          icon={<PlusGlyph />}
          aria-label={`Add ${REST_NUDGE_SEC} seconds to the rest`}
          size="xl"
          variant="secondary"
          onClick={() => onAdjust(REST_NUDGE_SEC)}
        />
        <Button size="xl" variant={done ? 'primary' : 'ghost'} onClick={onSkip}>
          {done ? 'Done' : 'Skip'}
        </Button>
      </div>

      {/* Under the clock, not beside it: on a 390px screen the clock and three
          controls take every pixel of the first row. */}
      <span className="ffw-restbar__for" aria-hidden="true">
        {done ? 'Rest over' : 'Rest'} · {forLabel}
      </span>

      <div
        className="ffw-restbar__track"
        role="progressbar"
        aria-label="Rest progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(fraction * 100)}
      >
        <div className="ffw-restbar__fill" style={{ inlineSize: `${fraction * 100}%` }} />
      </div>
    </div>
  );
}
