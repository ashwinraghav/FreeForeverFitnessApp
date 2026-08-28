import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button, Chip, EmptyState, List, Skeleton, TextField } from '@freeforever/design-system';
import type { MealSlot } from '@freeforever/core/src/nutrition/index.js';
import { FoodRow } from '../components/FoodRow.js';
import { PortionSheet } from '../components/PortionSheet.js';
import { UndoToast } from '../components/UndoToast.js';
import { snapshotFromCustomFood, snapshotFromIndexFood, snapshotFromRecipe } from '../data/mapping.js';
import { rankRecents } from '../data/log.js';
import { useLogging } from '../data/useLogging.js';
import { useNutrition } from '../data/NutritionProvider.js';
import type { FoodSnapshot } from '../data/types.js';
import { searchFoods } from '../search/rank.js';

/**
 * Food search. The fallback path, not the default one.
 *
 * Search runs entirely against the on-device index — no request, no backend, no
 * per-query cost (ADR-0006). It is safe to run on every keystroke because the
 * index only decodes the postings for the terms in the query and only
 * materialises the records it returns.
 *
 * Your own foods come first and are matched separately, because a user who has
 * made a custom "my protein shake" means that one, not the four hundred branded
 * shakes in the catalogue.
 */

type Scope = 'all' | 'recents' | 'favourites' | 'mine';

const SCOPES: { id: Scope; label: string }[] = [
  { id: 'all', label: 'Everything' },
  { id: 'recents', label: 'Recent' },
  { id: 'favourites', label: 'Favourites' },
  { id: 'mine', label: 'My foods' },
];

/** Results shown at once. Over-fetching happens inside `searchFoods`. */
const DISPLAY_LIMIT = 30;

export function SearchScreen() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { state, catalogue, catalogueStatus, catalogueError, ensureSearchIndex } = useNutrition();
  const logging = useLogging();

  const slot = (params.get('slot') as MealSlot | null) ?? 'other';
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<Scope>('all');
  const [portionFor, setPortionFor] = useState<FoodSnapshot | null>(null);

  useEffect(() => {
    void ensureSearchIndex();
  }, [ensureSearchIndex]);

  /** The user's own foods, matched by simple substring — the list is small. */
  const mine = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const customs = state.customFoods.map((food) => snapshotFromCustomFood(food));
    const recipes = state.recipes.map((recipe) => snapshotFromRecipe(recipe));
    const all = [...customs, ...recipes];
    if (needle === '') return all.slice(0, 12);
    return all.filter((snapshot) => snapshot.ref.name.toLowerCase().includes(needle)).slice(0, 12);
  }, [state.customFoods, state.recipes, query]);

  const catalogueResults = useMemo(() => {
    if (catalogue === null || scope === 'mine') return { hits: [], kind: 'empty' as const };
    const { query: classified, hits } = searchFoods(
      (raw, opts) => catalogue.search(raw, opts),
      query,
      DISPLAY_LIMIT,
    );
    return { hits, kind: classified.kind };
  }, [catalogue, query, scope]);

  const listed = useMemo(() => {
    const now = Date.now();
    if (scope === 'recents') return rankRecents(state.recents, now).map((r) => r.snapshot);
    if (scope === 'favourites') {
      return state.favourites
        .map((key) => state.recents.find((r) => r.snapshot.key === key)?.snapshot)
        .filter((s): s is FoodSnapshot => s !== undefined);
    }
    if (scope === 'mine') return mine;
    // Scope "all" with nothing typed: offer what they actually eat rather than
    // an empty state. Arriving at search already knowing what you want is the
    // common case, and "Start typing" spends a tap teaching nothing.
    if (query.trim() === '') return rankRecents(state.recents, now).map((r) => r.snapshot);
    return [];
  }, [scope, state.recents, state.favourites, mine, query]);

  const showingBrowse = scope !== 'all' || query.trim() === '';

  return (
    <div className="ffn">
      <div className="ffn-searchbar">
        <TextField
          label="Search foods"
          labelHidden
          type="search"
          autoFocus
          value={query}
          placeholder="Search foods"
          onChange={(event) => setQuery(event.currentTarget.value)}
        />
        <div className="ffn-scope">
          {SCOPES.map((option) => (
            <Chip key={option.id} selected={scope === option.id} onClick={() => setScope(option.id)}>
              {option.label}
            </Chip>
          ))}
        </div>
      </div>

      <div className="ffn-section">
        {mine.length > 0 && query.trim() !== '' && scope === 'all' ? (
          <>
            <h2 className="ffn-h2 ffn-pad">Your foods</h2>
            <List label="Your foods">
              {mine.map((snapshot) => (
                <FoodRow
                  key={snapshot.key}
                  name={snapshot.ref.name}
                  brand={snapshot.ref.brand}
                  nutrientsPer100g={snapshot.nutrientsPer100g}
                  energyUnit={state.preferences.energyUnit}
                  massUnit={state.preferences.massUnit}
                  onActivate={() => setPortionFor(snapshot)}
                  activateLabel={`Log ${snapshot.ref.name}`}
                />
              ))}
            </List>
          </>
        ) : null}

        {showingBrowse ? (
          listed.length > 0 ? (
            <List
              label={
                scope === 'all' && query.trim() === ''
                  ? 'Recent'
                  : (SCOPES.find((s) => s.id === scope)?.label ?? 'Foods')
              }
            >
              {listed.map((snapshot) => (
                <FoodRow
                  key={snapshot.key}
                  name={snapshot.ref.name}
                  brand={snapshot.ref.brand}
                  nutrientsPer100g={snapshot.nutrientsPer100g}
                  energyUnit={state.preferences.energyUnit}
                  massUnit={state.preferences.massUnit}
                  onActivate={() => setPortionFor(snapshot)}
                  activateLabel={`Log ${snapshot.ref.name}`}
                />
              ))}
            </List>
          ) : (
            <div className="ffn-pad">
              <EmptyState
                title={scope === 'all' ? 'Start typing' : 'Nothing here yet'}
                body={
                  scope === 'all'
                    ? 'The whole catalogue is on this device. Results appear as you type, offline.'
                    : 'Foods you log show up here automatically.'
                }
              />
            </div>
          )
        ) : catalogueStatus === 'loading' ? (
          <div className="ffn-pad ffn-stack">
            <Skeleton height="var(--ff-hit-min)" />
            <Skeleton height="var(--ff-hit-min)" />
            <Skeleton height="var(--ff-hit-min)" />
          </div>
        ) : catalogueStatus === 'error' ? (
          <div className="ffn-pad">
            <EmptyState
              title="The food catalogue could not be loaded"
              body={`Your own foods and recents still work. ${catalogueError ?? ''}`}
              action={
                <Button variant="secondary" size="lg" onClick={() => void ensureSearchIndex()}>
                  Try again
                </Button>
              }
            />
          </div>
        ) : catalogueResults.kind === 'not_yet_searchable' ? (
          /* Not "no results". The query has no indexable term in it yet —
             single letters and common words like "the" are deliberately not
             indexed, so this is an incomplete query rather than a missing food. */
          <div className="ffn-pad">
            <EmptyState title="Keep typing" body="Add another letter or a more specific word." />
          </div>
        ) : catalogueResults.hits.length === 0 ? (
          <div className="ffn-pad">
            <EmptyState
              title={`Nothing matching “${query.trim()}”`}
              body="The on-device catalogue has no typo tolerance, so check the spelling. Or add it yourself — it takes a minute and it is yours forever."
              action={
                <Button
                  variant="primary"
                  size="lg"
                  onClick={() => navigate(`../custom?name=${encodeURIComponent(query.trim())}`)}
                >
                  Create this food
                </Button>
              }
            />
          </div>
        ) : (
          <List label="Search results">
            {catalogueResults.hits.map((hit) => {
              const snapshot = snapshotFromIndexFood(hit.food, {
                imperial: state.preferences.massUnit === 'oz',
              });
              return (
                <FoodRow
                  key={hit.food.id}
                  name={hit.food.name}
                  brand={hit.food.brand}
                  nutrientsPer100g={snapshot.nutrientsPer100g}
                  previewGrams={hit.food.servingGrams ?? 100}
                  energyUnit={state.preferences.energyUnit}
                  massUnit={state.preferences.massUnit}
                  onActivate={() => setPortionFor(snapshot)}
                  activateLabel={`Log ${hit.food.name}`}
                />
              );
            })}
          </List>
        )}
      </div>

      <PortionSheet
        open={portionFor !== null}
        onClose={() => setPortionFor(null)}
        snapshot={portionFor}
        initialSlot={slot}
        massUnit={state.preferences.massUnit}
        energyUnit={state.preferences.energyUnit}
        isFavourite={portionFor !== null && state.favourites.includes(portionFor.key)}
        onToggleFavourite={() => {
          if (portionFor) logging.favourite(portionFor.key);
        }}
        onLog={({ quantity, serving, slot: chosen }) => {
          if (!portionFor) return;
          logging.log({ snapshot: portionFor, quantity, serving, slot: chosen });
          setPortionFor(null);
          navigate('..');
        }}
      />

      <UndoToast action={logging.undoAction} onDismiss={logging.dismissUndo} />
    </div>
  );
}
