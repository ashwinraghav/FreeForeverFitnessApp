import { Route, Routes, useNavigate } from 'react-router-dom';

import './workout.css';
import { ActiveWorkoutScreen } from './screens/ActiveWorkoutScreen.js';
import { localWorkoutRepository } from './storage/workoutStore.js';

/**
 * Entry point for the workout feature. OWNED BY THE workout TEAM.
 *
 * The shell renders this behind `/workout` and code-splits it, so the logging screen —
 * the one people open between sets — never waits on the nutrition or insights bundle.
 * Routing *inside* the feature lives here; `src/app/routes.ts` is integrator-owned and
 * is not touched.
 *
 * `/workout` is the active session and it is also the landing screen, because the app
 * opening straight onto the thing the lifter came to do is most of the ten-second
 * cold-start budget. There is no "start a workout" step: if a session is in progress
 * it is resumed from local storage, and if there is not one, an empty one is created
 * on the spot and only written once something is logged.
 *
 * ## What is wired to a real backend, and what is not
 *
 * The screen talks to a `WorkoutRepository` port. The implementation here is
 * device-local (`storage/workoutStore.ts`) and covers the case Firestore's own offline
 * persistence does not: an *unfinished* session, mid-edit, across an app kill.
 * Swapping in a Firestore-backed implementation is a one-line change here and no
 * change at all to the screen — that boundary is deliberate, and it is the sync team's
 * file to write.
 */
export default function WorkoutRoutes() {
  const navigate = useNavigate();

  return (
    <Routes>
      <Route
        index
        element={
          <ActiveWorkoutScreen
            repository={localWorkoutRepository}
            onFinished={() => navigate('.', { replace: true })}
          />
        }
      />
      {/* Anything deeper falls back to the session rather than a dead end. */}
      <Route
        path="*"
        element={<ActiveWorkoutScreen repository={localWorkoutRepository} />}
      />
    </Routes>
  );
}
