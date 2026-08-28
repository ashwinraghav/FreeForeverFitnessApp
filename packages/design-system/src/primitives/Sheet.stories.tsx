import type { Meta, StoryObj } from '@storybook/react';
import { useState } from 'react';

import { Button } from './Button.js';
import { Sheet } from './Sheet.js';

const meta: Meta<typeof Sheet> = {
  title: 'Primitives/Sheet',
  component: Sheet,
};

export default meta;
type Story = StoryObj<typeof Sheet>;

function Demo({ modal }: { modal?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="primary" onClick={() => setOpen(true)}>
        Open sheet
      </Button>
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title="Plate breakdown"
        modal={modal ?? false}
        actions={
          <Button variant="primary" block onClick={() => setOpen(false)}>
            Done
          </Button>
        }
      >
        <p>Per side: 20kg, 10kg, 2.5kg.</p>
      </Sheet>
    </>
  );
}

export const NonBlocking: Story = {
  name: 'Non-blocking (the default - use this during a workout)',
  render: () => <Demo />,
};

export const Modal: Story = {
  name: 'Modal (opt-in - never during a workout)',
  render: () => <Demo modal />,
};
