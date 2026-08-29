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
import { MEASUREMENT_LABELS } from '../data/proposed';
import { availableSites, change, measurementSeries, weightSeries } from '../select/body';
import { formatDateShort, formatLength, formatMass } from '../select/format';
import { PhotoGallery } from './PhotoGallery';

/*
 * Empty-state copy.
 *
 * One message per chart, whether the underlying numbers have not been computed yet
 * or simply have not been logged. That distinction is ours, not the reader's — from
 * where they are standing, "the aggregate has not been materialised" and "you have
 * not weighed yourself" produce the same blank chart and the same next action. Saying
 * so in our words instead of theirs explains nothing and sounds like a fault.
 */
const NO_WEIGHT_MESSAGE =
  'Log a weigh-in and the trend starts here. Nothing is charted but the numbers you enter yourself.';

const NO_MEASUREMENTS_MESSAGE =
  'Log a tape measurement and it starts tracking here. Waist, chest, arms — whichever you choose to record.';

/**
 * Bodyweight and measurements.
 *
 * The smoothed line is the emphasis series and the daily weigh-ins sit behind it as
 * de-emphasised dots — the honest way round, because day-to-day bodyweight moves
 * several kilos on water alone and the raw series reads as fat gain to anyone not
 * expecting it.
 *
 * There is no goal line, no target band, and no colour that says a direction is good.
 * The app does not know which way the user is trying to go, and a screen in this
 * category that guesses is a screen that tells someone they are failing.
 */
export function BodyView() {
  const snapshot = useInsights();
  const [site, setSite] = useState<string | null>(null);
  const massUnit = snapshot.units.bodyMass;
  const lengthUnit = snapshot.units.bodyLength;

  const weight = useMemo(() => weightSeries(snapshot.bodyMetrics), [snapshot.bodyMetrics]);
  const weightChange = useMemo(() => change(weight), [weight]);
  const sites = useMemo(() => availableSites(snapshot.bodyMetrics), [snapshot.bodyMetrics]);
  const activeSite = site ?? sites[0] ?? null;
  const measurement = useMemo(
    () => (activeSite === null ? null : measurementSeries(snapshot.bodyMetrics, activeSite)),
    [snapshot.bodyMetrics, activeSite],
  );

  const drawWeight = useCallback(
    (ctx: Parameters<typeof drawLine>[0], frame: Parameters<typeof drawLine>[1]): ChartCursor => {
      const step = Math.max(1, Math.ceil(weight.smoothed.length / 4));
      const layout = drawLine(ctx, frame, {
        points: weight.smoothed.map((point) => ({ x: point.dayIndex, y: point.value })),
        contextPoints: weight.raw.map((point) => ({ x: point.dayIndex, y: point.value })),
        xLabels: weight.smoothed
          .filter((_, index) => index % step === 0 || index === weight.smoothed.length - 1)
          .map((point) => ({ x: point.dayIndex, text: formatDateShort(point.localDate) })),
        formatValue: (value) => formatMass(value, massUnit, 1),
        zeroBased: false,
        labelExtremes: true,
      });
      return {
        plotTop: layout.plot.top,
        plotBottom: layout.plot.bottom,
        targets: layout.screen.map((at, index) => {
          const point = weight.smoothed[index];
          return {
            x: at.x,
            readout:
              point === undefined
                ? ''
                : `${formatDateShort(point.localDate)}: ${formatMass(point.value, massUnit)} trend`,
          };
        }),
      };
    },
    [weight, massUnit],
  );

  const drawMeasurement = useCallback(
    (ctx: Parameters<typeof drawLine>[0], frame: Parameters<typeof drawLine>[1]): ChartCursor => {
      const points = measurement?.smoothed ?? [];
      const step = Math.max(1, Math.ceil(points.length / 4));
      const layout = drawLine(ctx, frame, {
        points: points.map((point) => ({ x: point.dayIndex, y: point.value })),
        contextPoints: (measurement?.raw ?? []).map((point) => ({ x: point.dayIndex, y: point.value })),
        xLabels: points
          .filter((_, index) => index % step === 0 || index === points.length - 1)
          .map((point) => ({ x: point.dayIndex, text: formatDateShort(point.localDate) })),
        formatValue: (value) => formatLength(value, lengthUnit),
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
                : `${formatDateShort(point.localDate)}: ${formatLength(point.value, lengthUnit)}`,
          };
        }),
      };
    },
    [measurement, lengthUnit],
  );

  return (
    <>
      {weightChange !== null && (
        <div className="ff-in-tiles">
          <StatTile
            label="Weight"
            value={formatMass(weightChange.last.value, massUnit)}
            delta={{
              text: `${formatMass(Math.abs(weightChange.change), massUnit)} over ${weightChange.days} days`,
              direction:
                weightChange.change > 0 ? 'up' : weightChange.change < 0 ? 'down' : 'flat',
            }}
            detail="7-day weighted mean"
          />
          <StatTile
            label="Weigh-ins"
            value={String(weight.raw.length)}
            detail="logged"
          />
        </div>
      )}

      <ChartFrame
        title="Bodyweight"
        subtitle="Smoothed trend in the accent line, individual weigh-ins as dots behind it"
        rebuilding={snapshot.rebuilding}
        empty={weight.smoothed.length === 0}
        emptyMessage={NO_WEIGHT_MESSAGE}
        table={
          <TableView
            caption="Bodyweight, most recent first"
            rows={[...weight.raw].reverse()}
            rowKey={(row) => row.localDate}
            columns={[
              { key: 'date', header: 'Date', render: (row) => formatDateShort(row.localDate) },
              { key: 'weight', header: 'Weight', numeric: true, render: (row) => formatMass(row.value, massUnit) },
            ]}
          />
        }
      >
        <CanvasChart
          draw={drawWeight}
          height={CHART_HEIGHT.tall}
          label={`Line chart of smoothed bodyweight across ${weight.raw.length} weigh-ins.`}
        />
      </ChartFrame>

      <ChartFrame
        title="Measurements"
        subtitle="Tape measurements, smoothed over three weeks"
        rebuilding={snapshot.rebuilding}
        empty={measurement === null || measurement.smoothed.length === 0}
        emptyMessage={NO_MEASUREMENTS_MESSAGE}
        action={
          sites.length > 1 ? (
            <Select
              label="Site"
              labelHidden
              value={activeSite ?? ''}
              onChange={(event) => setSite(event.currentTarget.value)}
            >
              {sites.map((option) => (
                <option key={option} value={option}>
                  {MEASUREMENT_LABELS[option] ?? option}
                </option>
              ))}
            </Select>
          ) : undefined
        }
        table={
          <TableView
            caption="Measurements, most recent first"
            rows={[...(measurement?.raw ?? [])].reverse()}
            rowKey={(row) => row.localDate}
            columns={[
              { key: 'date', header: 'Date', render: (row) => formatDateShort(row.localDate) },
              { key: 'value', header: 'Measurement', numeric: true, render: (row) => formatLength(row.value, lengthUnit) },
            ]}
          />
        }
      >
        <CanvasChart
          draw={drawMeasurement}
          height={CHART_HEIGHT.standard}
          label={`Line chart of ${activeSite === null ? 'measurements' : (MEASUREMENT_LABELS[activeSite] ?? activeSite)} over time.`}
        />
      </ChartFrame>

      <section className="ff-in-card" aria-labelledby="ff-in-photos-heading">
        <header className="ff-in-cardhead">
          <div>
            <h2 id="ff-in-photos-heading" className="ff-in-cardtitle">
              Progress photos
            </h2>
            <p className="ff-in-cardsub">On this device only, unless you say otherwise.</p>
          </div>
        </header>
        <PhotoGallery />
      </section>
    </>
  );
}
