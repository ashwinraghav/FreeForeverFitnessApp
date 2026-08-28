import { lazy, Suspense } from 'react';
import { Route, Routes } from 'react-router-dom';
import { Skeleton } from '@freeforever/design-system';
import { NutritionProvider } from './data/NutritionProvider.js';
import { DayScreen } from './screens/DayScreen.js';
import './nutrition.css';

/**
 * Entry point for the nutrition feature. OWNED BY THE nutrition TEAM.
 *
 * The shell renders this behind `/nutrition` and code-splits it; the routing
 * below is the feature's own and `src/app/routes.ts` is not touched
 * (ADR-0018).
 *
 * The day view is the landing screen and is imported eagerly — it is what the
 * tab opens onto, and a spinner between tapping "Eat" and seeing today's
 * numbers is the whole feature failing at its one job. The scanner, the target
 * calculator and the recipe editor are each split out: the scanner pulls a
 * decoder in on some browsers, and none of the three is on the common path.
 */

const SearchScreen = lazy(() =>
  import('./screens/SearchScreen.js').then((m) => ({ default: m.SearchScreen })),
);
const ScanScreen = lazy(() =>
  import('./screens/ScanScreen.js').then((m) => ({ default: m.ScanScreen })),
);
const CustomFoodScreen = lazy(() =>
  import('./screens/CustomFoodScreen.js').then((m) => ({ default: m.CustomFoodScreen })),
);
const RecipesScreen = lazy(() =>
  import('./screens/RecipesScreen.js').then((m) => ({ default: m.RecipesScreen })),
);
const TargetsScreen = lazy(() =>
  import('./screens/TargetsScreen.js').then((m) => ({ default: m.TargetsScreen })),
);

function ScreenFallback() {
  return (
    <div className="ffn ffn-pad ffn-stack" style={{ paddingBlockStart: 'var(--ff-space-24)' }}>
      <Skeleton height="var(--ff-hit-mid-set)" />
      <Skeleton height="var(--ff-hit-min)" />
      <Skeleton height="var(--ff-hit-min)" />
    </div>
  );
}

export default function NutritionRoutes() {
  return (
    <NutritionProvider>
      <Suspense fallback={<ScreenFallback />}>
        <Routes>
          <Route index element={<DayScreen />} />
          <Route path="search" element={<SearchScreen />} />
          <Route path="scan" element={<ScanScreen />} />
          <Route path="custom" element={<CustomFoodScreen />} />
          <Route path="recipes" element={<RecipesScreen />} />
          <Route path="targets" element={<TargetsScreen />} />
          {/* Anything unrecognised under /nutrition lands on the day view
              rather than a blank screen. */}
          <Route path="*" element={<DayScreen />} />
        </Routes>
      </Suspense>
    </NutritionProvider>
  );
}
