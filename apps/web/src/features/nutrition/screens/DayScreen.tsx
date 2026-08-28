import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Button,
  Divider,
  EmptyState,
  IconButton,
  List,
  ChevronDownGlyph,
  PlusGlyph,
} from '@freeforever/design-system';
import {
  formatEnergy,
  formatPortion,
  isoWeekdayOf,
  planWeeklyTargets,
  summariseDay,
  type MealSlot,
} from '@freeforever/core/src/nutrition/index.js';
import { MacroRing } from '../components/MacroRing.js';
import { MacroRows } from '../components/MacroRows.js';
import { MicronutrientPanel } from '../components/MicronutrientPanel.js';
import { PortionSheet } from '../components/PortionSheet.js';
import { QuickAddSheet } from '../components/QuickAddSheet.js';
import { RepeatStrip } from '../components/RepeatStrip.js';
import { UndoToast } from '../components/UndoToast.js';
import { addDays, dayLabel, today } from '../data/dates.js';
import { addWater } from '../data/log.js';
import { rankRecents } from '../data/log.js';
import { useLogging } from '../data/useLogging.js';
import { useNutrition } from '../data/NutritionProvider.js';
import type { FoodSnapshot, RecentFood } from '../data/types.js';

/**
 * The daily view. The screen this feature is judged on.
 *
 * Reading order top to bottom is: the one number that matters, the macros
 * behind it, what was eaten, and then — in the reachable third at the bottom —
 * the actions. Recents sit immediately above the action bar because logging a
 * repeat food is the most common thing anyone does here, and it must not be
 * behind a menu.
 *
 * Everything on this screen reads from local state. There is no request on this
 * path, which is why it renders instantly offline and costs nothing to serve.
 */

const SLOT_LABELS: Record<MealSlot, string> = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  dinner: 'Dinner',
  snack: 'Snacks',
  pre_workout: 'Pre-workout',
  post_workout: 'Post-workout',
  other: 'Other',
};

/** A glass of water, in the unit the body actually uses. */
const GLASS_ML = 250;

/** How many repeat shortcuts fit before the strip becomes a list to read. */
const REPEAT_STRIP_SIZE = 12;

export function DayScreen() {
  const navigate = useNavigate();
  const { state, mutate, selectedDate, setSelectedDate, tzOffsetMinutes } = useNutrition();
  const logging = useLogging();

  const [portionFor, setPortionFor] = useState<{ snapshot: FoodSnapshot; slot: MealSlot; recent?: RecentFood } | null>(null);
  const [quickAddSlot, setQuickAddSlot] = useState<MealSlot | null>(null);
  const [showMicros, setShowMicros] = useState(false);

  const day = state.days[selectedDate];

  // The target in force on this day: the plan's weekday entry, or the day's own
  // snapshot if one was taken. History is judged against what was set then.
  const target = useMemo(() => {
    if (day?.targetSnapshot) return day.targetSnapshot;
    const plan = state.target;
    if (!plan) return undefined;
    const week = planWeeklyTargets({
      base: plan.base,
      plan: { trainingDays: plan.trainingDays as never, swingFraction: plan.swingFraction },
      energyFloorKcal: plan.energyFloorKcal,
    });
    return week.days[isoWeekdayOf(selectedDate)];
  }, [day?.targetSnapshot, state.target, selectedDate]);

  const summary = useMemo(
    () =>
      summariseDay({
        totals: day?.totals ?? { energyKcal: 0, proteinG: 0, carbsG: 0, fatG: 0 },
        target,
        waterMl: day?.waterMl ?? 0,
      }),
    [day?.totals, day?.waterMl, target],
  );

  const recents = useMemo(
    () => rankRecents(state.recents, Date.now()).slice(0, REPEAT_STRIP_SIZE),
    [state.recents],
  );

  const includesBundled = useMemo(
    () => (day?.meals ?? []).some((meal) => meal.entries.some((e) => e.food.source === 'bundled')),
    [day?.meals],
  );

  const isToday = selectedDate === today();

  return (
    <div className="ffn">
      <div className="ffn-daybar">
        <IconButton
          icon={<ChevronDownGlyph style={{ transform: 'rotate(90deg)' }} />}
          aria-label="Previous day"
          variant="ghost"
          onClick={() => setSelectedDate(addDays(selectedDate, -1))}
        />
        <div className="ffn-daybar-label">{dayLabel(selectedDate)}</div>
        <IconButton
          icon={<ChevronDownGlyph style={{ transform: 'rotate(-90deg)' }} />}
          aria-label="Next day"
          variant="ghost"
          disabled={isToday}
          onClick={() => setSelectedDate(addDays(selectedDate, 1))}
        />
      </div>

      <section className="ffn-section ffn-pad" aria-label="Today's energy">
        <MacroRing
          energy={summary.energy}
          floorKcal={state.target?.energyFloorKcal}
          energyUnit={state.preferences.energyUnit}
        />
        {target === undefined ? (
          <p className="ffn-muted" style={{ marginBlockStart: 'var(--ff-space-12)' }}>
            No target set. <Link to="targets">Work one out</Link> — it takes four numbers and
            runs on this device.
          </p>
        ) : null}
      </section>

      <section className="ffn-section ffn-pad" aria-label="Macros">
        <MacroRows summary={summary} massUnit={state.preferences.massUnit} />
        <div className="ffn-row" style={{ marginBlockStart: 'var(--ff-space-12)' }}>
          <Button
            variant="secondary"
            size="md"
            onClick={() =>
              mutate((current) =>
                addWater(current, { date: selectedDate, tzOffsetMinutes, millilitres: GLASS_ML }),
              )
            }
          >
            + Water
          </Button>
          <Button variant="ghost" size="md" onClick={() => setShowMicros((v) => !v)}>
            {showMicros ? 'Hide' : 'Show'} micronutrients
          </Button>
        </div>
        {showMicros ? (
          <div style={{ marginBlockStart: 'var(--ff-space-12)' }}>
            <MicronutrientPanel
              nutrients={day?.totals ?? { energyKcal: 0, proteinG: 0, carbsG: 0, fatG: 0 }}
              massUnit={state.preferences.massUnit}
              includesBundledFoods={includesBundled}
            />
          </div>
        ) : null}
      </section>

      <section className="ffn-section" aria-label="Meals">
        <h2 className="ffn-h2 ffn-pad">Eaten</h2>
        {day === undefined || day.meals.length === 0 ? (
          <div className="ffn-pad">
            <EmptyState
              title="Nothing logged yet"
              body="Scan a barcode, or search. Anything you log once becomes a one-tap shortcut."
              action={
                <Button variant="primary" size="lg" onClick={() => navigate('scan')}>
                  Scan a barcode
                </Button>
              }
            />
          </div>
        ) : (
          day.meals.map((meal) => (
            <div key={meal.id} className="ffn-section">
              <div className="ffn-row-between ffn-pad">
                <h3 className="ffn-h2" style={{ margin: 0 }}>
                  {meal.name ?? SLOT_LABELS[meal.slot]}
                </h3>
                <span className="ffn-macro-value">
                  {formatEnergy(meal.totals.energyKcal, state.preferences.energyUnit)}{' '}
                  {state.preferences.energyUnit}
                </span>
              </div>
              <List label={SLOT_LABELS[meal.slot]}>
                {meal.entries.map((entry) => (
                  <li key={entry.id}>
                    <div className="ffn-row-between ffn-pad" style={{ minBlockSize: 'var(--ff-hit-min)' }}>
                      <div className="ffn-grow">
                        <div className="ffn-food-name">{entry.food.name}</div>
                        <div className="ffn-food-meta">
                          {formatPortion(entry.quantity, entry.serving)} ·{' '}
                          {formatEnergy(entry.nutrients.energyKcal, state.preferences.energyUnit)}{' '}
                          {state.preferences.energyUnit}
                        </div>
                      </div>
                      <Button variant="ghost" size="md" onClick={() => logging.remove(entry.id)}>
                        Remove
                      </Button>
                    </div>
                  </li>
                ))}
              </List>
              <div className="ffn-pad">
                <Button
                  variant="ghost"
                  size="md"
                  onClick={() => navigate(`search?slot=${meal.slot}`)}
                >
                  Add to {SLOT_LABELS[meal.slot].toLowerCase()}
                </Button>
              </div>
            </div>
          ))
        )}
      </section>

      {recents.length > 0 ? (
        <section aria-label="Log again">
          <Divider />
          <h2 className="ffn-h2 ffn-pad" style={{ marginBlockStart: 'var(--ff-space-12)' }}>
            Log again — one tap
          </h2>
          <RepeatStrip
            recents={recents}
            energyUnit={state.preferences.energyUnit}
            onLogAgain={logging.logAgainFromRecent}
            onOpenPortion={(recent) =>
              setPortionFor({ snapshot: recent.snapshot, slot: recent.lastSlot, recent })
            }
          />
        </section>
      ) : null}

      <div className="ffn-actions">
        <Button variant="primary" size="xl" onClick={() => navigate('scan')}>
          Scan
        </Button>
        <Button variant="secondary" size="xl" onClick={() => navigate('search')}>
          Search
        </Button>
        <IconButton
          icon={<PlusGlyph />}
          aria-label="Quick add macros"
          variant="secondary"
          size="xl"
          onClick={() => setQuickAddSlot('other')}
        />
      </div>

      <PortionSheet
        open={portionFor !== null}
        onClose={() => setPortionFor(null)}
        snapshot={portionFor?.snapshot ?? null}
        initialSlot={portionFor?.slot ?? 'other'}
        {...(portionFor?.recent
          ? { initialQuantity: portionFor.recent.lastQuantity, initialServing: portionFor.recent.lastServing }
          : {})}
        massUnit={state.preferences.massUnit}
        energyUnit={state.preferences.energyUnit}
        isFavourite={portionFor ? state.favourites.includes(portionFor.snapshot.key) : false}
        onToggleFavourite={() => {
          if (portionFor) logging.favourite(portionFor.snapshot.key);
        }}
        onLog={({ quantity, serving, slot }) => {
          if (!portionFor) return;
          logging.log({ snapshot: portionFor.snapshot, quantity, serving, slot });
          setPortionFor(null);
        }}
      />

      <QuickAddSheet
        open={quickAddSlot !== null}
        onClose={() => setQuickAddSlot(null)}
        initialSlot={quickAddSlot ?? 'other'}
        energyUnit={state.preferences.energyUnit}
        onAdd={(input) => {
          logging.addQuick(input);
          setQuickAddSlot(null);
        }}
      />

      <UndoToast action={logging.undoAction} onDismiss={logging.dismissUndo} />
    </div>
  );
}
