import { useMemo, useState } from 'react';
import { ChartFrame } from '../charts/ChartFrame';
import { BarList } from '../charts/BarList';
import { TableView } from '../charts/TableView';
import { useInsights } from '../data/context';
import { formatVolume } from '../select/format';
import { foldTail, muscleDistribution, muscleHeatmap } from '../select/muscles';
import { isoWeekOfLocalDate } from '../select/weeks';
import { MuscleMap, MuscleMapLegend } from './MuscleMap';
import { DEFAULT_RANGE, RANGE_WEEKS, RangePicker, type RangeKey } from './RangePicker';

/** How many muscles get their own bar before the tail folds into one row. */
const HEAD_ROWS = 8;

export function MusclesView() {
  const snapshot = useInsights();
  const [range, setRange] = useState<RangeKey>(DEFAULT_RANGE);
  const weeks = RANGE_WEEKS[range];
  const endWeek = isoWeekOfLocalDate(snapshot.today);
  const unit = snapshot.units.trainingLoad;

  const heatmap = useMemo(
    () =>
      endWeek === null
        ? null
        : muscleHeatmap(snapshot.trainingVolume, endWeek),
    [snapshot.trainingVolume, endWeek],
  );
  const distribution = useMemo(
    () =>
      endWeek === null
        ? null
        : muscleDistribution(snapshot.trainingVolume, endWeek, weeks),
    [snapshot.trainingVolume, endWeek, weeks],
  );

  const folded = distribution === null ? null : foldTail(distribution.totals, HEAD_ROWS);
  const heatRows =
    heatmap === null
      ? []
      : [...heatmap.byMuscle.values()].sort((a, b) => b.sets - a.sets || a.label.localeCompare(b.label));

  return (
    <>
      <div className="ff-in-filters">
        <RangePicker value={range} onChange={setRange} />
      </div>

      <ChartFrame
        title="This week"
        subtitle="Where the week's hard sets went. Darker is more."
        rebuilding={snapshot.rebuilding}
        empty={heatmap === null || heatmap.totalSets === 0}
        emptyMessage="No sets logged this week yet."
        table={
          <TableView
            caption="Hard sets per muscle this week, with each muscle's recent weekly average"
            rows={heatRows}
            rowKey={(row) => row.muscle}
            columns={[
              { key: 'muscle', header: 'Muscle', render: (row) => row.label },
              { key: 'sets', header: 'Sets', numeric: true, render: (row) => String(row.sets) },
              {
                key: 'baseline',
                header: 'Usual',
                numeric: true,
                render: (row) => (row.baselineSets === null ? '—' : row.baselineSets.toFixed(1)),
              },
            ]}
          />
        }
      >
        {heatmap !== null && (
          <>
            <MuscleMap heatmap={heatmap} />
            <MuscleMapLegend />
          </>
        )}
      </ChartFrame>

      <ChartFrame
        title="Distribution"
        subtitle={`Hard sets per muscle over ${weeks} weeks, split by each exercise's contribution`}
        rebuilding={snapshot.rebuilding}
        empty={distribution === null || distribution.totalSets === 0}
        table={
          <TableView
            caption={`Sets and volume per muscle over the last ${weeks} weeks`}
            rows={distribution?.totals ?? []}
            rowKey={(row) => row.muscle}
            columns={[
              { key: 'muscle', header: 'Muscle', render: (row) => row.label },
              { key: 'sets', header: 'Sets', numeric: true, render: (row) => String(row.sets) },
              {
                key: 'perweek',
                header: 'Per week',
                numeric: true,
                render: (row) => (row.sets / weeks).toFixed(1),
              },
              { key: 'volume', header: 'Volume', numeric: true, render: (row) => formatVolume(row.volumeKg, unit) },
              { key: 'share', header: 'Share', numeric: true, render: (row) => `${Math.round(row.share * 100)}%` },
            ]}
          />
        }
      >
        {folded !== null && (
          <BarList
            label={`Hard sets per muscle over the last ${weeks} weeks`}
            rows={[
              ...folded.head.map((row) => ({
                key: row.muscle,
                label: row.label,
                value: row.sets,
                valueText: String(row.sets),
                detail: `${(row.sets / weeks).toFixed(1)}/wk`,
              })),
              ...(folded.tailCount > 0
                ? [
                    {
                      key: 'other',
                      label: `Other (${folded.tailCount})`,
                      value: folded.tailSets,
                      valueText: String(folded.tailSets),
                      detail: 'in the table',
                    },
                  ]
                : []),
            ]}
          />
        )}
      </ChartFrame>
    </>
  );
}
