import { setDiagSink } from '@freeforever/design-system';
import { installGlobalCapture, record } from '../shell/diagnostics';
import { lazy, Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { ROUTES } from './routes';
import { AppFrame } from '../shell/AppFrame';
import { MoreScreen } from '../shell/MoreScreen';
import { hasUsedTheAppBefore } from '../shell/firstRun';
import { Booting } from '../shell/Booting';

/*
 * The design system emits pointer diagnostics through a sink so it never has
 * to import from the app. Hooking it up here is the app opting in; the sink is
 * a no-op until it does, and the recorder itself is off until a user turns it
 * on in More.
 */
setDiagSink(record);
installGlobalCapture();

// Each feature is code-split so the logging screen — the one people open
// between sets — never waits on the nutrition or insights bundle.
const WorkoutRoutes = lazy(() => import('../features/workout/WorkoutRoutes'));
const NutritionRoutes = lazy(() => import('../features/nutrition/NutritionRoutes'));
// Progress mounts through `data/InsightsScreen`, which injects the locally
// materialised aggregates the tab reads. Splitting on that module rather than on
// the feature keeps the reducers and the schema package inside this chunk.
const InsightsScreen = lazy(() => import('../data/InsightsScreen'));

export function App() {
  return (
    <BrowserRouter>
      <AppFrame>
        <Suspense fallback={<Booting />}>
          <Routes>
            {/* First open lands on More, which explains the tabs; every open
                after that goes straight to the session (see firstRun.ts). */}
            <Route
              path={ROUTES.today}
              element={
                <Navigate to={hasUsedTheAppBefore() ? ROUTES.workout : ROUTES.more} replace />
              }
            />
            <Route path={`${ROUTES.workout}/*`} element={<WorkoutRoutes />} />
            <Route path={`${ROUTES.nutrition}/*`} element={<NutritionRoutes />} />
            <Route path={`${ROUTES.insights}/*`} element={<InsightsScreen />} />
            <Route path={ROUTES.more} element={<MoreScreen />} />
            <Route path="*" element={<Navigate to={ROUTES.workout} replace />} />
          </Routes>
        </Suspense>
      </AppFrame>
    </BrowserRouter>
  );
}
