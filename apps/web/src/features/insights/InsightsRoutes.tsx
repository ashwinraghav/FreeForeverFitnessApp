import { useMemo, type CSSProperties } from 'react';
import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import type { LocalDate } from '@freeforever/data';
import './insights.css';
import { heatVariables } from './charts/palette';
import { InsightsProvider, emptyInsightsSource } from './data/context';
import type { InsightsDataSource, ProgressPhotoStore } from './data/ports';
import { formatLocalDate } from './select/weeks';
import { BodyView } from './views/BodyView';
import { ExercisesView } from './views/ExercisesView';
import { MusclesView } from './views/MusclesView';
import { OverviewView } from './views/OverviewView';

/**
 * Entry point for the insights feature. OWNED BY THE insights TEAM.
 *
 * The shell renders this behind its route and code-splits it, so nothing here is on
 * the critical path of the logging screen.
 *
 * ## Where the data comes from
 *
 * Everything on these screens is read from locally materialised aggregates through
 * one injected port (`data/ports.ts`). There is no Firestore import anywhere in this
 * directory and no way to add one that survives CI — `test/no-firestore.test.ts`
 * walks the whole feature tree and fails the build on any client SDK import, any
 * query builder, and any `await` on a data read. ADR-0005 calls that a build failure
 * rather than a review comment, so it is one.
 *
 * The sync team supplies the real source:
 *
 * ```tsx
 * <InsightsRoutes source={aggregateStore} photos={devicePhotoStore} />
 * ```
 *
 * With no source, every screen renders its empty state. That is the correct behaviour
 * for a cold device mid-rebuild, so it is also the correct default.
 */
export interface InsightsRoutesProps {
  readonly source?: InsightsDataSource;
  readonly photos?: ProgressPhotoStore;
}

/**
 * The one clock read in the feature.
 *
 * Every selector takes `today` as an argument so it stays pure and reproducible; the
 * composition root is the only place allowed to ask what day it is, and this is it.
 */
function todayFromDevice(): LocalDate {
  const now = new Date();
  return formatLocalDate(new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())));
}

const TABS = [
  { to: '.', end: true, label: 'Overview' },
  { to: 'muscles', end: false, label: 'Muscles' },
  { to: 'exercises', end: false, label: 'Lifts' },
  { to: 'body', end: false, label: 'Body' },
] as const;

export default function InsightsRoutes({ source, photos }: InsightsRoutesProps = {}) {
  const fallback = useMemo(() => emptyInsightsSource(todayFromDevice()), []);

  return (
    <InsightsProvider source={source ?? fallback} {...(photos === undefined ? {} : { photos })}>
      <div className="ff-insights" style={heatVariables() as CSSProperties}>
        <nav className="ff-insights__nav ff-in-filters" aria-label="Insights sections">
          {TABS.map((tab) => (
            <NavLink key={tab.label} to={tab.to} end={tab.end} className="ff-in-tab ff-focusable">
              {tab.label}
            </NavLink>
          ))}
        </nav>

        <Routes>
          <Route index element={<OverviewView />} />
          <Route path="muscles" element={<MusclesView />} />
          <Route path="exercises" element={<ExercisesView />} />
          <Route path="body" element={<BodyView />} />
          <Route path="*" element={<Navigate to="." replace />} />
        </Routes>
      </div>
    </InsightsProvider>
  );
}
