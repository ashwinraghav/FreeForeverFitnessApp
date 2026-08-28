import { List } from '@freeforever/design-system';
import { FoodRow } from '../components/FoodRow.js';
import type { Meta, StoryObj } from './csf.js';
import '../nutrition.css';

type Props = Parameters<typeof FoodRow>[0];

/**
 * One food in a list.
 *
 * The energy shown is for the amount that will actually be logged, not a flat
 * per-100 g figure. A row reading "165 kcal" that logs 280 on tap teaches users
 * to distrust every number in the app.
 */
const meta: Meta<Props> = {
  title: 'Nutrition/FoodRow',
  component: FoodRow,
  args: {
    name: 'Chicken breast, raw',
    nutrientsPer100g: { energyKcal: 165, proteinG: 31, carbsG: 0, fatG: 3.6 },
    energyUnit: 'kcal',
    massUnit: 'g',
    onActivate: () => undefined,
    activateLabel: 'Log Chicken breast, raw',
  },
};
export default meta;

export const Playground: StoryObj<Props> = {
  render: (args) => (
    <List label="Search results">
      <FoodRow {...args} />
    </List>
  ),
};

export const Branded: StoryObj<Props> = {
  render: () => (
    <List label="Search results">
      <FoodRow
        name="Greek Style Natural Yogurt"
        brand="Fage"
        nutrientsPer100g={{ energyKcal: 133, proteinG: 5.7, carbsG: 4.9, fatG: 10.2 }}
        previewGrams={170}
        energyUnit="kcal"
        massUnit="g"
        onActivate={() => undefined}
        activateLabel="Log Greek Style Natural Yogurt"
      />
    </List>
  ),
};

export const AListOfResults: StoryObj<Props> = {
  name: 'A list, with the tabular figures lining up',
  render: () => (
    <List label="Search results">
      <FoodRow name="Oats, rolled" nutrientsPer100g={{ energyKcal: 389, proteinG: 16.9, carbsG: 66.3, fatG: 6.9 }} energyUnit="kcal" massUnit="g" onActivate={() => undefined} activateLabel="Log oats" />
      <FoodRow name="Rice, white, cooked" nutrientsPer100g={{ energyKcal: 130, proteinG: 2.7, carbsG: 28, fatG: 0.3 }} previewGrams={250} energyUnit="kcal" massUnit="g" onActivate={() => undefined} activateLabel="Log rice" />
      <FoodRow name="Olive oil" nutrientsPer100g={{ energyKcal: 884, proteinG: 0, carbsG: 0, fatG: 100 }} previewGrams={14} energyUnit="kcal" massUnit="g" onActivate={() => undefined} activateLabel="Log olive oil" />
      <FoodRow name="Diet cola" brand="Store brand" nutrientsPer100g={{ energyKcal: 0, proteinG: 0, carbsG: 0, fatG: 0 }} previewGrams={330} energyUnit="kcal" massUnit="g" onActivate={() => undefined} activateLabel="Log diet cola" />
    </List>
  ),
};
