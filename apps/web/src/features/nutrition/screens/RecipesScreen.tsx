import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, EmptyState, List, NumberField, TextField } from '@freeforever/design-system';
import {
  computePortionNutrition,
  computeRecipeTotals,
  formatEnergy,
  formatGrams,
} from '@freeforever/core/src/nutrition/index.js';
import { FoodRow } from '../components/FoodRow.js';
import { PortionSheet } from '../components/PortionSheet.js';
import { UndoToast } from '../components/UndoToast.js';
import { newId } from '../data/ids.js';
import { snapshotFromCustomFood, snapshotFromIndexFood, snapshotFromRecipe } from '../data/mapping.js';
import { useLogging } from '../data/useLogging.js';
import { useNutrition } from '../data/NutritionProvider.js';
import type { FoodSnapshot, Recipe, RecipeIngredient } from '../data/types.js';
import { searchFoods } from '../search/rank.js';

/**
 * Recipes: build a food once, log it like any other.
 *
 * The part worth getting right is cooked mass. A stew that goes in at 1,200 g
 * and comes out at 800 g has the same total energy and a third more of it per
 * gram. Every app that ignores this understates a reduced sauce badly, every
 * time. If the user weighs the finished dish, the per-100 g figure uses that
 * mass; otherwise it uses the ingredients' mass and says so.
 */
export function RecipesScreen() {
  const navigate = useNavigate();
  const { state, mutate, catalogue, ensureSearchIndex } = useNutrition();
  const logging = useLogging();

  const [editing, setEditing] = useState<Recipe | null>(null);
  const [name, setName] = useState('');
  const [servings, setServings] = useState<number | null>(4);
  const [cookedMass, setCookedMass] = useState<number | null>(null);
  const [ingredients, setIngredients] = useState<RecipeIngredient[]>([]);
  const [query, setQuery] = useState('');
  const [portionFor, setPortionFor] = useState<FoodSnapshot | null>(null);
  const [addingIngredient, setAddingIngredient] = useState<FoodSnapshot | null>(null);

  const totals = useMemo(
    () =>
      computeRecipeTotals({
        ingredients,
        servings: servings !== null && servings > 0 ? servings : 1,
        cookedMassG: cookedMass,
      }),
    [ingredients, servings, cookedMass],
  );

  const results = useMemo(() => {
    if (catalogue === null || query.trim() === '') return [];
    return searchFoods((raw, opts) => catalogue.search(raw, opts), query, 12).hits;
  }, [catalogue, query]);

  const startNew = () => {
    void ensureSearchIndex();
    setEditing({
      id: newId(),
      name: '',
      servings: 4,
      ingredients: [],
      totalMassG: 0,
      nutrientsPerServing: { energyKcal: 0, proteinG: 0, carbsG: 0, fatG: 0 },
      nutrientsPer100g: { energyKcal: 0, proteinG: 0, carbsG: 0, fatG: 0 },
      createdAt: Date.now(),
    });
    setName('');
    setServings(4);
    setCookedMass(null);
    setIngredients([]);
  };

  const saveRecipe = () => {
    if (editing === null || name.trim() === '' || ingredients.length === 0) return;
    const recipe: Recipe = {
      id: editing.id,
      name: name.trim(),
      servings: servings !== null && servings > 0 ? servings : 1,
      ingredients,
      totalMassG: totals.totalMassG,
      nutrientsPerServing: totals.nutrientsPerServing,
      nutrientsPer100g: totals.nutrientsPer100g,
      createdAt: editing.createdAt,
      ...(totals.usedCookedMass ? { cookedMassG: totals.basisMassG } : {}),
    };
    mutate((current) => ({
      ...current,
      recipes: [recipe, ...current.recipes.filter((r) => r.id !== recipe.id)],
    }));
    setEditing(null);
  };

  if (editing === null) {
    return (
      <div className="ffn ffn-pad">
        <div className="ffn-row-between" style={{ marginBlock: 'var(--ff-space-16)' }}>
          <h1 className="ffn-h1">Recipes</h1>
          <Button variant="primary" size="lg" onClick={startNew}>
            New recipe
          </Button>
        </div>

        {state.recipes.length === 0 ? (
          <EmptyState
            title="No recipes yet"
            body="Build a meal once from its ingredients, then log the whole thing in one tap for as long as you keep making it."
          />
        ) : (
          <List label="Recipes">
            {state.recipes.map((recipe) => {
              const snapshot = snapshotFromRecipe(recipe);
              return (
                <FoodRow
                  key={recipe.id}
                  name={recipe.name}
                  detail={`${recipe.servings} servings · ${formatEnergy(recipe.nutrientsPerServing.energyKcal)} kcal each`}
                  nutrientsPer100g={recipe.nutrientsPer100g}
                  previewGrams={snapshot.servings[0]?.gramsPerServing ?? 100}
                  energyUnit={state.preferences.energyUnit}
                  massUnit={state.preferences.massUnit}
                  onActivate={() => setPortionFor(snapshot)}
                  activateLabel={`Log ${recipe.name}`}
                />
              );
            })}
          </List>
        )}

        <PortionSheet
          open={portionFor !== null}
          onClose={() => setPortionFor(null)}
          snapshot={portionFor}
          initialSlot="dinner"
          massUnit={state.preferences.massUnit}
          energyUnit={state.preferences.energyUnit}
          onLog={({ quantity, serving, slot }) => {
            if (!portionFor) return;
            logging.log({ snapshot: portionFor, quantity, serving, slot });
            setPortionFor(null);
            navigate('..');
          }}
        />
        <UndoToast action={logging.undoAction} onDismiss={logging.dismissUndo} />
      </div>
    );
  }

  return (
    <div className="ffn ffn-pad">
      <h1 className="ffn-h1" style={{ marginBlock: 'var(--ff-space-16)' }}>
        New recipe
      </h1>

      <div className="ffn-fields">
        <TextField label="Name" value={name} onChange={(e) => setName(e.currentTarget.value)} required />
        <div className="ffn-fields-2">
          <NumberField label="Makes" unit="servings" value={servings} onValueChange={setServings} step={1} min={1} />
          <NumberField
            label="Cooked weight"
            unit="g"
            value={cookedMass}
            onValueChange={setCookedMass}
            step={10}
            min={0}
            hint="Optional. Weigh the finished dish and the per-100 g figures account for what boiled off."
          />
        </div>

        <h2 className="ffn-h2">Ingredients</h2>
        {ingredients.length === 0 ? (
          <p className="ffn-muted">Search below to add the first one.</p>
        ) : (
          <List label="Ingredients">
            {ingredients.map((ingredient) => (
              <li key={ingredient.sortKey}>
                <div className="ffn-row-between" style={{ minBlockSize: 'var(--ff-hit-min)' }}>
                  <div className="ffn-grow">
                    <div className="ffn-food-name">{ingredient.food.name}</div>
                    <div className="ffn-food-meta">
                      {formatGrams(ingredient.massG)} g ·{' '}
                      {formatEnergy(ingredient.nutrients.energyKcal)} kcal
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="md"
                    onClick={() =>
                      setIngredients((current) =>
                        current.filter((i) => i.sortKey !== ingredient.sortKey),
                      )
                    }
                  >
                    Remove
                  </Button>
                </div>
              </li>
            ))}
          </List>
        )}

        <div className="ffn-portion-summary">
          <div className="ffn-portion-figure">
            <b>{formatEnergy(totals.nutrientsPerServing.energyKcal)}</b>
            <span>kcal / serving</span>
          </div>
          <div className="ffn-portion-figure">
            <b>{formatGrams(totals.nutrientsPerServing.proteinG)}</b>
            <span>protein</span>
          </div>
          <div className="ffn-portion-figure">
            <b>{formatGrams(totals.nutrientsPerServing.carbsG)}</b>
            <span>carbs</span>
          </div>
          <div className="ffn-portion-figure">
            <b>{formatGrams(totals.nutrientsPerServing.fatG)}</b>
            <span>fat</span>
          </div>
        </div>
        <p className="ffn-muted">
          {totals.usedCookedMass
            ? `Per 100 g of the finished dish (${Math.round(totals.basisMassG)} g cooked, from ${Math.round(totals.totalMassG)} g of ingredients).`
            : `Per 100 g of ingredients (${Math.round(totals.totalMassG)} g). Weigh the cooked dish for a more accurate per-gram figure.`}
        </p>

        <TextField
          label="Add an ingredient"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.currentTarget.value)}
          placeholder="Search foods"
        />
        {results.length > 0 ? (
          <List label="Ingredient results">
            {results.map((hit) => {
              const snapshot = snapshotFromIndexFood(hit.food);
              return (
                <FoodRow
                  key={hit.food.id}
                  name={hit.food.name}
                  brand={hit.food.brand}
                  nutrientsPer100g={snapshot.nutrientsPer100g}
                  energyUnit={state.preferences.energyUnit}
                  massUnit={state.preferences.massUnit}
                  onActivate={() => setAddingIngredient(snapshot)}
                  activateLabel={`Add ${hit.food.name}`}
                />
              );
            })}
          </List>
        ) : null}
        {state.customFoods.length > 0 && query.trim() === '' ? (
          <List label="Your foods">
            {state.customFoods.slice(0, 8).map((food) => {
              const snapshot = snapshotFromCustomFood(food);
              return (
                <FoodRow
                  key={food.id}
                  name={food.name}
                  brand={food.brand}
                  nutrientsPer100g={food.nutrientsPer100g}
                  energyUnit={state.preferences.energyUnit}
                  massUnit={state.preferences.massUnit}
                  onActivate={() => setAddingIngredient(snapshot)}
                  activateLabel={`Add ${food.name}`}
                />
              );
            })}
          </List>
        ) : null}

        <Button
          variant="primary"
          size="xl"
          block
          disabled={name.trim() === '' || ingredients.length === 0}
          onClick={saveRecipe}
        >
          Save recipe
        </Button>
      </div>

      <PortionSheet
        open={addingIngredient !== null}
        onClose={() => setAddingIngredient(null)}
        snapshot={addingIngredient}
        initialSlot="other"
        massUnit={state.preferences.massUnit}
        energyUnit={state.preferences.energyUnit}
        submitLabel="Add to recipe"
        onLog={({ quantity, serving }) => {
          if (!addingIngredient) return;
          const portion = computePortionNutrition({
            nutrientsPer100g: addingIngredient.nutrientsPer100g,
            quantity,
            serving,
          });
          setIngredients((current) => [
            ...current,
            {
              sortKey: newId(),
              food: addingIngredient.ref,
              quantity,
              serving,
              massG: portion.massG,
              nutrients: portion.nutrients,
            },
          ]);
          setAddingIngredient(null);
          setQuery('');
        }}
      />
      <UndoToast action={logging.undoAction} onDismiss={logging.dismissUndo} />
    </div>
  );
}
