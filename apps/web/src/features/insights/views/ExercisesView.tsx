import { useCallback, useMemo, useState } from 'react';
import { Select } from '@freeforever/design-system';
import { CanvasChart } from '../charts/Canvas';
import type { ChartCursor } from '../charts/Canvas';
import { ChartFrame } from '../charts/ChartFrame';
import { StatTile } from '../charts/StatTile';
import { TableView } from '../charts/TableView';
import { CHART_HEIGHT } from '../charts/sizes';
import { drawLine } from '../charts/draw';
import { useInsights } from '../data/context';
import { findSeries, orderedSeries, progressChartSeries, progressSummary } from '../select/e1rm';
import { formatDateShort, formatMass } from '../select/format';
import { prTimeline } from '../select/prs';
import { PrTimeline } from './PrTimeline';

/**
 * One exercise at a time.
 *
 * The chart is an estimated-1RM line, which is the only way to compare a set of five
 * at 100kg against a set of eight at 90kg on one axis. Sessions that set a record are
 * drawn as diamonds — a shape, so it survives greyscale — and never as a second
 * colour, because this palette has one signal colour and spending it on "records" and
 * "not records" would leave the line itself unmarked.
 */
export function ExercisesView() {
  const snapshot = useInsights();
  const [selected, setSelected] = useState<string | null>(null);
  const unit = snapshot.units.trainingLoad;

  const options = useMemo(() => orderedSeries(snapshot.exerciseProgress), [snapshot.exerciseProgress]);
  const series = useMemo(
    () => findSeries(snapshot.exerciseProgress, selected),
    [snapshot.exerciseProgress, selected],
  );
  const points = useMemo(
    () => progressChartSeries(series, snapshot.personalRecords),
    [series, snapshot.personalRecords],
  );
  const summary = useMemo(() => progressSummary(points), [points]);
  const records = useMemo(
    () =>
      series === null
        ? []
        : prTimeline(snapshot.personalRecords, snapshot.exerciseProgress).filter(
            (entry) => entry.exerciseKey === series.exerciseKey,
          ),
    [snapshot.personalRecords, snapshot.exerciseProgress, series],
  );

  const drawProgress = useCallback(
    (ctx: Parameters<typeof drawLine>[0], frame: Parameters<typeof drawLine>[1]): ChartCursor => {
      const labelStep = Math.max(1, Math.ceil(points.length / 4));
      const layout = drawLine(ctx, frame, {
        points: points.map((point) => ({
          x: point.dayIndex,
          y: point.e1rmKg,
          ...(point.isRecord ? { emphasis: true } : {}),
        })),
        xLabels: points
          .filter((_, index) => index % labelStep === 0 || index === points.length - 1)
          .map((point) => ({ x: point.dayIndex, text: formatDateShort(point.localDate) })),
        formatValue: (value) => formatMass(value, unit, 0),
        // A 1RM axis from zero puts every session in the top few percent of the plot.
        zeroBased: false,
        labelExtremes: true,
      });
      return {
        plotTop: layout.plot.top,
        plotBottom: layout.plot.bottom,
        targets: layout.screen.map((at, index) => {
          const point = points[index];
          return {
            x: at.x,
            readout:
              point === undefined
                ? ''
                : `${formatDateShort(point.localDate)}: ${formatMass(point.e1rmKg, unit)} estimated, ` +
                  `top set ${formatMass(point.topSetLoadKg, unit)} for ${point.topSetReps}` +
                  `${point.isRecord ? '. Personal record.' : ''}`,
          };
        }),
      };
    },
    [points, unit],
  );

  return (
    <>
      <div className="ff-in-filters">
        <Select
          label="Exercise"
          value={series?.exerciseKey ?? ''}
          onChange={(event) => setSelected(event.currentTarget.value)}
          disabled={options.length === 0}
        >
          {options.length === 0 && <option value="">No exercises logged yet</option>}
          {options.map((option) => (
            <option key={option.exerciseKey} value={option.exerciseKey}>
              {option.displayName}
            </option>
          ))}
        </Select>
      </div>

      {summary !== null && (
        <div className="ff-in-tiles">
          <StatTile
            label="Estimated 1RM"
            value={formatMass(summary.last.e1rmKg, unit)}
            delta={{
              text: `${formatMass(Math.abs(summary.changeKg), unit)} over ${summary.sessions} sessions`,
              direction: summary.changeKg > 0 ? 'up' : summary.changeKg < 0 ? 'down' : 'flat',
            }}
          />
          <StatTile
            label="Best"
            value={formatMass(summary.best.e1rmKg, unit)}
            detail={formatDateShort(summary.best.localDate)}
          />
          <StatTile
            label="Last top set"
            value={`${formatMass(summary.last.topSetLoadKg, unit)} × ${summary.last.topSetReps}`}
            detail={formatDateShort(summary.last.localDate)}
          />
        </div>
      )}

      <ChartFrame
        title={series?.displayName ?? 'Estimated 1RM'}
        subtitle="Estimated one-rep max from each session's best completed working set. Diamonds are records."
        rebuilding={snapshot.rebuilding}
        empty={points.length === 0}
        emptyMessage="Log this exercise twice and a progression line appears."
        table={
          <TableView
            caption={`Session history for ${series?.displayName ?? 'this exercise'}`}
            rows={[...points].reverse()}
            rowKey={(row) => row.localDate}
            columns={[
              { key: 'date', header: 'Date', render: (row) => formatDateShort(row.localDate) },
              { key: 'e1rm', header: 'Est. 1RM', numeric: true, render: (row) => formatMass(row.e1rmKg, unit) },
              {
                key: 'top',
                header: 'Top set',
                numeric: true,
                render: (row) => `${formatMass(row.topSetLoadKg, unit)} × ${row.topSetReps}`,
              },
              { key: 'record', header: 'Record', render: (row) => (row.isRecord ? 'Yes' : '—') },
            ]}
          />
        }
      >
        <CanvasChart
          draw={drawProgress}
          height={CHART_HEIGHT.tall}
          label={`Line chart of estimated one-rep max for ${series?.displayName ?? 'the selected exercise'} across ${points.length} sessions.`}
        />
      </ChartFrame>

      <ChartFrame
        title="Records for this lift"
        rebuilding={snapshot.rebuilding}
        empty={records.length === 0}
        emptyMessage="No records logged for this exercise yet."
        table={
          <TableView
            caption="Records for this exercise"
            rows={records}
            rowKey={(row) => `${row.type}-${row.achievedAt}`}
            columns={[
              { key: 'type', header: 'Record', render: (row) => row.typeLabel },
              { key: 'date', header: 'Date', render: (row) => row.achievedOn },
              { key: 'value', header: 'Value', numeric: true, render: (row) => String(row.value) },
              {
                key: 'previous',
                header: 'Previous',
                numeric: true,
                render: (row) => (row.previousValue === null ? 'first' : String(row.previousValue)),
              },
            ]}
          />
        }
      >
        <PrTimeline entries={records} unit={unit} />
      </ChartFrame>
    </>
  );
}
