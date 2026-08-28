import type { Meta, StoryObj } from '@storybook/react';
import { useState } from 'react';

import { Button } from './Button.js';
import { Dialog } from './Dialog.js';

const meta: Meta<typeof Dialog> = {
  title: 'Primitives/Dialog',
  component: Dialog,
  parameters: {
    docs: {
      description: {
        component:
          'Banned from the workout flow (CLAUDE.md). A dialog that eats an entered set is the worst failure this product can produce. Use Sheet there.',
      },
    },
  },
};

export default meta;
type Story = StoryObj<typeof Dialog>;

function Demo() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="danger" onClick={() => setOpen(true)}>
        Delete workout
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Delete this workout?"
        actions={
          <>
            <Button onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant="danger" onClick={() => setOpen(false)}>
              Delete
            </Button>
          </>
        }
      >
        <p>Every set you logged in this session will be removed. This cannot be undone.</p>
      </Dialog>
    </>
  );
}

export const DestructiveConfirmation: Story = { render: () => <Demo /> };
