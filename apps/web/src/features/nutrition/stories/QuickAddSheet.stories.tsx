import { useState } from 'react';
import { Button } from '@freeforever/design-system';
import { QuickAddSheet } from '../components/QuickAddSheet.js';
import type { Meta, StoryObj } from './csf.js';
import '../nutrition.css';

type Props = Parameters<typeof QuickAddSheet>[0];

/**
 * Macros with no food behind them.
 *
 * The escape hatch that keeps the rest of the log honest. Someone eats a meal
 * no database contains; the choice is between recording what they know and
 * abandoning the day, and an abandoned day is worse than an approximate one.
 *
 * The energy field's ghost value is the Atwater sum of whatever macros were
 * entered — visibly not an entered value, and used if left alone.
 */
const meta: Meta<Props> = { title: 'Nutrition/QuickAddSheet', component: QuickAddSheet };
export default meta;

function Demo() {
  const [open, setOpen] = useState(true);
  return (
    <>
      <Button variant="secondary" size="lg" onClick={() => setOpen(true)}>
        Open quick add
      </Button>
      <QuickAddSheet
        open={open}
        onClose={() => setOpen(false)}
        initialSlot="dinner"
        energyUnit="kcal"
        onAdd={() => setOpen(false)}
      />
    </>
  );
}

export const Empty: StoryObj<Props> = { render: () => <Demo /> };
