import type { CalendarWeek } from '../select/adherence';
import { formatDateLong, formatWeekLabel } from '../select/format';

const DAY_TEXT = {
  trained: 'trained',
  untrained: 'no session',
  future: 'upcoming',
  'before-history': 'before your history starts',
} as const;

/**
 * The adherence calendar. Neutral dots, and nothing else.
 *
 * The states are `trained`, `untrained`, `future` and `before-history` — there is no
 * "missed", and that is a deliberate absence rather than an oversight. A filled dot
 * is a session; an outlined dot is a day with no session, drawn in the same neutral
 * ink as everything else on the screen. Nothing is red, nothing counts down, nothing
 * says "don't break it". This is a body-image-adjacent product and streak-loss
 * shaming is precisely the dark pattern constitution rule 6 refuses.
 *
 * Shape carries the state, not colour: filled versus outlined versus dashed reads
 * identically in greyscale.
 */
export function AdherenceGrid({ weeks }: { readonly weeks: readonly CalendarWeek[] }) {
  return (
    <div className="ff-in-calendar">
      {weeks.map((week) => (
        <div key={week.week} className="ff-in-calendar__row">
          {week.days.map((day) => (
            <span
              key={day.date}
              className={`ff-in-day ff-in-day--${day.state}`}
              role="img"
              aria-label={`${formatDateLong(day.date)}: ${DAY_TEXT[day.state]}`}
            />
          ))}
          <span className="ff-in-calendar__count">
            {formatWeekLabel(week.week)} · {week.trainedCount}
          </span>
        </div>
      ))}
    </div>
  );
}
