import { useCallback, useMemo, useState } from 'react';
import { CanvasChart } from '../charts/Canvas';
import type { ChartCursor } from '../charts/Canvas';
import { ChartFrame } from '../charts/ChartFrame';
import { StatTile } from '../charts/StatTile';
import { TableView } from '../charts/TableView';
import { CHART_HEIGHT } from '../charts/sizes';
import { drawColumns } from '../charts/draw';
import { useInsights } from '../data/context';
import { adherenceSummary, calendarGrid } from '../select/adherence';
import {
  formatCount,
  formatDurationHours,
  formatSignedPercent,
  formatVolume,
  formatWeekLabel,
  percentChange,
} from '../select/format';
import { prCounts, prTimeline } from '../select/prs';
import { peakIndex, volumeSeries, volumeSummary } from '../select/volume';
import { isoWeekOfLocalDate } from '../select/weeks';
import { AdherenceGrid } from './AdherenceGrid';
import { PrTimeline } from './PrTimeline';
import { DEFAULT_RANGE, RANGE_WEEKS, RangePicker, type RangeKey } from './RangePicker';

/**
 * The overview.
 *
 * A row of stat tiles, then the volume trend, then adherence, then records. The order
 * is the order the questions get asked: how much, how consistently, and did anything
 * change. Every card reads the same window from the one range control at the top.
 */
export function OverviewView() {
  const snapshot = useInsights();
  const [range, setRange] = useState<RangeKey>(DEFAULT_RANGE);
  const weeks = RANGE_WEEKS[range];
  const endWeek = isoWeekOfLocalDate(snapshot.today);

  const series = useMemo(
    () => (endWeek === null ? [] : volumeSeries(snapshot.trainingVolume, endWeek, weeks)),
    [snapshot.trainingVolume, endWeek, weeks],
  );
  const summary = useMemo(
    () =>
      endWeek === null
        ? null
        : volumeSummary(snapshot.trainingVolume, endWeek, weeks),
    [snapshot.trainingVolume, endWeek, weeks],
  );
  const adherence = useMemo(
    () => adherenceSummary(snapshot.adherence, snapshot.today, weeks),
    [snapshot.adherence, snapshot.today, weeks],
  );
  const calendar = useMemo(
    () => calendarGrid(snapshot.adherence, snapshot.today, Math.min(weeks, 12)),
    [snapshot.adherence, snapshot.today, weeks],
  );
  const records = useMemo(
    () => prTimeline(snapshot.personalRecords, snapshot.exerciseProgress, { limit: 8 }),
    [snapshot.personalRecords, snapshot.exerciseProgress],
  );
  const counts = useMemo(
    () => prCounts(prTimeline(snapshot.personalRecords, snapshot.exerciseProgress), snapshot.today),
    [snapshot.personalRecords, snapshot.exerciseProgress, snapshot.today],
  );

  const unit = snapshot.units.trainingLoad;
  const peak = peakIndex(series);
  const lastIndex = series.length - 1;

  const drawVolume = useCallback(
    (ctx: Parameters<typeof drawColumns>[0], frame: Parameters<typeof drawColumns>[1]): ChartCursor => {
      const layout = drawColumns(ctx, frame, {
        values: series.map((point) => point.volumeKg),
        xLabels: series.map((point) => formatWeekLabel(point.week)),
        formatValue: (value) => formatVolume(value, unit),
        // Two direct labels at most: the peak, and the week the reader is standing in.
        labelledBands: peak === null || peak === lastIndex ? [lastIndex] : [peak, lastIndex],
      });
      return {
        plotTop: layout.plot.top,
        plotBottom: layout.plot.bottom,
        targets: layout.bars.map((bar, index) => {
          const point = series[index];
          return {
            x: bar.x + bar.w / 2,
            readout:
              point === undefined
                ? ''
                : `Week of ${formatWeekLabel(point.week)}: ${formatVolume(point.volumeKg, unit)}, ` +
                  `${formatCount(point.workingSetCount, 'set')} over ${formatCount(point.sessionCount, 'session')}`,
          };
        }),
      };
    },
    [series, unit, peak, lastIndex],
  );

  const volumeDelta =
    summary === null || summary.previousMeanWeeklyVolumeKg === null
      ? null
      : percentChange(summary.meanWeeklyVolumeKg, summary.previousMeanWeeklyVolumeKg);

  return (
    <>
      <div className="ff-in-filters">
        <RangePicker value={range} onChange={setRange} />
      </div>

      <div className="ff-in-tiles">
        <StatTile
          label="Weekly volume"
          value={summary === null ? '—' : formatVolume(summary.meanWeeklyVolumeKg, unit)}
          {...(volumeDelta === null
            ? {}
            : {
                delta: {
                  text: `${formatSignedPercent(volumeDelta)} vs previous ${weeks} weeks`,
                  direction: volumeDelta > 0 ? ('up' as const) : volumeDelta < 0 ? ('down' as const) : ('flat' as const),
                },
              })}
          detail={summary === null ? undefined : `mean over ${weeks} weeks`}
        />
        <StatTile
          label="Sessions"
          value={String(adherence.sessionsInWindow)}
          detail={`${adherence.sessionsPerWeek.toFixed(1)} per week`}
        />
        <StatTile
          label="Current streak"
          value={formatCount(adherence.currentStreakDays, 'day')}
          detail={`longest ${formatCount(adherence.longestStreakDays, 'day')}`}
        />
        <StatTile
          label="Records"
          value={String(counts.last90Days)}
          detail="in the last 90 days"
        />
      </div>

      <ChartFrame
        title="Training volume"
        subtitle={`Total load lifted each week, last ${weeks} weeks`}
        rebuilding={snapshot.rebuilding}
        empty={summary === null || summary.totalVolumeKg === 0}
        emptyMessage="Log a session and this fills in. Nothing here is calculated from anything but your own sessions."
        table={
          <TableView
            caption={`Weekly training volume over the last ${weeks} weeks`}
            rows={series}
            rowKey={(row) => row.week}
            columns={[
              { key: 'week', header: 'Week', render: (row) => formatWeekLabel(row.week) },
              { key: 'volume', header: 'Volume', numeric: true, render: (row) => formatVolume(row.volumeKg, unit) },
              { key: 'sets', header: 'Sets', numeric: true, render: (row) => String(row.workingSetCount) },
              { key: 'sessions', header: 'Sessions', numeric: true, render: (row) => String(row.sessionCount) },
              { key: 'time', header: 'Time', numeric: true, render: (row) => formatDurationHours(row.durationSec) },
            ]}
          />
        }
      >
        <CanvasChart
          draw={drawVolume}
          height={CHART_HEIGHT.standard}
          label={`Column chart of weekly training volume over the last ${weeks} weeks.`}
        />
      </ChartFrame>

      <ChartFrame
        title="Sessions logged"
        subtitle="One dot per day. A day without a session is just a day without a session."
        rebuilding={snapshot.rebuilding}
        empty={calendar.length === 0}
        table={
          <TableView
            caption="Sessions logged per week"
            rows={calendar}
            rowKey={(row) => row.week}
            columns={[
              { key: 'week', header: 'Week', render: (row) => formatWeekLabel(row.week) },
              { key: 'trained', header: 'Days trained', numeric: true, render: (row) => String(row.trainedCount) },
              {
                key: 'planned',
                header: 'Planned',
                numeric: true,
                render: (row) => (row.plannedSessions === null ? '—' : String(row.plannedSessions)),
              },
            ]}
          />
        }
      >
        <AdherenceGrid weeks={calendar} />
      </ChartFrame>

      <ChartFrame
        title="Recent records"
        subtitle={`${counts.total} in total, across ${counts.exercises} exercises`}
        rebuilding={snapshot.rebuilding}
        empty={records.length === 0}
        emptyMessage="Records appear here the first time a completed working set beats your previous best."
        table={
          <TableView
            caption="Personal records, most recent first"
            rows={records}
            rowKey={(row) => `${row.exerciseKey}-${row.type}-${row.achievedAt}`}
            columns={[
              { key: 'name', header: 'Exercise', render: (row) => row.exerciseName },
              { key: 'type', header: 'Record', render: (row) => row.typeLabel },
              { key: 'date', header: 'Date', render: (row) => row.achievedOn },
              { key: 'value', header: 'Value', numeric: true, render: (row) => String(row.value) },
            ]}
          />
        }
      >
        <PrTimeline entries={records} unit={unit} />
      </ChartFrame>
    </>
  );
}
