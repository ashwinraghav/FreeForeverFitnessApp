import { useId, useState, type ReactNode } from 'react';
import { Button, EmptyState } from '@freeforever/design-system';

export interface ChartFrameProps {
  readonly title: string;
  /** One line. Says what is plotted and over what window, so the chart needs no legend. */
  readonly subtitle?: string | undefined;
  readonly children: ReactNode;
  /** The same data as text. Required — a chart without one is colour-gated. */
  readonly table: ReactNode;
  /** True when there is genuinely nothing to draw yet. */
  readonly empty?: boolean;
  readonly emptyMessage?: string;
  /** Hold the last render, dimmed, while the fold rebuilds. Never a skeleton flash. */
  readonly rebuilding?: boolean;
  readonly action?: ReactNode | undefined;
}

/**
 * The card every chart sits in.
 *
 * It owns three things the individual charts must not each reinvent: the heading,
 * the table toggle, and the empty state. The table toggle is the reason this is a
 * frame and not a fragment — "every chart has a table view" is only true if it is
 * structurally impossible to add a chart without one, and `table` is a required prop.
 */
export function ChartFrame({
  title,
  subtitle,
  children,
  table,
  empty = false,
  emptyMessage = 'Nothing logged for this window yet.',
  rebuilding = false,
  action,
}: ChartFrameProps) {
  const [showTable, setShowTable] = useState(false);
  const panelId = useId();
  const headingId = useId();

  return (
    <section className="ff-in-card" aria-labelledby={headingId}>
      <header className="ff-in-cardhead">
        <div>
          <h2 id={headingId} className="ff-in-cardtitle">
            {title}
          </h2>
          {subtitle !== undefined && <p className="ff-in-cardsub">{subtitle}</p>}
        </div>
        {action}
      </header>

      {empty ? (
        <EmptyState title="No data yet" body={emptyMessage} />
      ) : (
        <>
          <div
            id={panelId}
            className={rebuilding ? 'ff-in-plot ff-in-plot--stale' : 'ff-in-plot'}
            aria-busy={rebuilding || undefined}
          >
            {showTable ? table : children}
          </div>
          <div className="ff-in-cardfoot">
            <Button
              variant="ghost"
              size="sm"
              aria-expanded={showTable}
              aria-controls={panelId}
              onClick={() => setShowTable((open) => !open)}
            >
              {showTable ? 'Show chart' : 'Show table'}
            </Button>
          </div>
        </>
      )}
    </section>
  );
}
