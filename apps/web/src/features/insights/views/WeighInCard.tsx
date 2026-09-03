import { Button, NumberField } from '@freeforever/design-system';
import type { LocalDate } from '@freeforever/data';
import { useMemo, useState } from 'react';

import { createBodyStore } from '../../../data/bodyStore';
import { notifyLocalDataChanged } from '../../../data/insightsSource';
import { KILOGRAMS_PER_POUND } from '../select/constants';
import { toDisplayMass } from '../select/format';

/**
 * Where a weigh-in gets logged.
 *
 * Reported: "where do I log a weight in the app". Nowhere, was the answer. The Body tab
 * has always drawn a bodyweight chart, and its own empty state has always read "log a
 * weigh-in and the trend starts here" — promising a control that did not exist anywhere
 * in the app. The aggregate behind the chart was hardcoded `null`.
 *
 * ## Steppers, not a keyboard
 *
 * Same reasoning as the set editor. A number pad costs about 400px and this screen is
 * read one-handed; the steppers hold to repeat and accelerate, so 74 to 96 is a held
 * thumb rather than typing. Tapping the number still opens the keyboard for a value that
 * is faster to type than to reach.
 *
 * The step is 0.1 in whichever unit is displayed, because bodyweight is the one number
 * in this app where the tenth actually carries signal — a 0.5kg step would quantise away
 * most of a week's change.
 *
 * ## Kilograms on disk, display units on screen
 *
 * `toDisplayMass` converts out and the constant converts back. The store is always
 * kilograms: one that held whichever unit was selected at the time would silently
 * reinterpret every existing row the day somebody switched to pounds.
 */

export interface WeighInCardProps {
  readonly today: LocalDate;
  readonly massUnit: 'kg' | 'lb';
  /** Existing weigh-in for `today`, in kilograms, if there is one. */
  readonly todayKg: number | null;
  /** Injectable for tests. */
  readonly store?: ReturnType<typeof createBodyStore>;
}

const toKg = (display: number, unit: 'kg' | 'lb'): number =>
  unit === 'lb' ? display * KILOGRAMS_PER_POUND : display;

export function WeighInCard({ today, massUnit, todayKg, store }: WeighInCardProps) {
  const bodyStore = useMemo(() => store ?? createBodyStore(), [store]);

  // Seeded from today's entry so re-recording is a correction rather than a fresh guess,
  // and left null when there is none — null is not zero, and a ghost of 0kg would be
  // both wrong and the sort of default that teaches itself.
  const [entered, setEntered] = useState<number | null>(
    todayKg === null ? null : round1(toDisplayMass(todayKg, massUnit)),
  );
  const [saved, setSaved] = useState<string | null>(null);

  const save = (): void => {
    if (entered === null || entered <= 0) return;
    bodyStore.record(today, toKg(entered, massUnit));
    // The chart reads the same storage through `createLocalInsightsSource`, whose
    // freshness stamp includes the body key — but the `storage` event does not fire in
    // the tab that wrote, so without this the number would not appear until a reload.
    notifyLocalDataChanged();
    setSaved(`Saved ${entered} ${massUnit} for today.`);
  };

  return (
    <section className="ff-in-weighin" aria-labelledby="ff-in-weighin-heading">
      <h2 id="ff-in-weighin-heading" className="ff-in-cardtitle">
        Today&rsquo;s weigh-in
      </h2>
      <p className="ff-in-cardsub" role="status">
        {saved ??
          (todayKg === null
            ? 'One number, first thing, before you eat. Day to day it wanders; the trend is the part that means anything.'
            : `Logged ${round1(toDisplayMass(todayKg, massUnit))} ${massUnit} today. Saving again replaces it.`)}
      </p>
      <div className="ff-in-weighin__row">
        <NumberField
          label="Bodyweight"
          unit={massUnit}
          step={0.1}
          min={0}
          value={entered}
          onValueChange={setEntered}
        />
        <Button size="lg" variant="primary" onClick={save} disabled={entered === null}>
          Save
        </Button>
      </div>
    </section>
  );
}

/** One decimal. Bodyweight is the one place in this app where the tenth is signal. */
function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
