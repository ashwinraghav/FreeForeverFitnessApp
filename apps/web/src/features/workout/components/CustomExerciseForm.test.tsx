import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CustomExerciseForm } from './CustomExerciseForm';
import { listCustomExercises } from '../storage/customExercises.js';

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

const renderForm = (initialName = 'Jefferson Curl') => {
  const onCreated = vi.fn();
  const onCancel = vi.fn();
  render(
    <CustomExerciseForm initialName={initialName} onCreated={onCreated} onCancel={onCancel} />,
  );
  return { onCreated, onCancel };
};

describe('CustomExerciseForm', () => {
  it('starts on the name the lifter already typed, so the common case is zero typing', () => {
    renderForm('Jefferson Curl');
    expect(screen.getByLabelText(/name/i)).toHaveValue('Jefferson Curl');
  });

  it('saves and hands the entry back', async () => {
    const user = userEvent.setup();
    const { onCreated } = renderForm('Zercher Squat');

    await user.selectOptions(screen.getByLabelText(/main muscle/i), 'quads');
    await user.click(screen.getByRole('button', { name: /add and use it/i }));

    expect(onCreated).toHaveBeenCalledTimes(1);
    const entry = onCreated.mock.calls[0]?.[0];
    expect(entry).toMatchObject({
      name: 'Zercher Squat',
      muscles: [{ muscle: 'quads', fraction: 1 }],
      // Never asked, and false is the answer that cannot inflate a volume total.
      unilateral: false,
    });
    expect(listCustomExercises()).toHaveLength(1);
  });

  it('maps "how it is loaded" onto the load kind that drives plate maths', async () => {
    const user = userEvent.setup();
    const { onCreated } = renderForm('Pistol Squat');

    await user.selectOptions(screen.getByLabelText(/how it is loaded/i), 'bodyweight');
    await user.click(screen.getByRole('button', { name: /add and use it/i }));

    expect(onCreated.mock.calls[0]?.[0]).toMatchObject({
      loadKind: 'bodyweight',
      equipment: 'bodyweight',
    });
  });

  it('counts time as a duration, so the set editor renders the right control', async () => {
    const user = userEvent.setup();
    const { onCreated } = renderForm('Copenhagen Plank');

    await user.selectOptions(screen.getByLabelText(/what you count/i), 'duration');
    await user.click(screen.getByRole('button', { name: /add and use it/i }));

    expect(onCreated.mock.calls[0]?.[0]).toMatchObject({ effortKind: 'duration' });
  });

  it('refuses an empty name and says so instead of saving nothing', async () => {
    const user = userEvent.setup();
    const { onCreated } = renderForm('');

    await user.click(screen.getByRole('button', { name: /add and use it/i }));

    expect(onCreated).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(/give it a name/i);
    expect(listCustomExercises()).toEqual([]);
  });

  /*
   * The negative case proved against the positive one, per CLAUDE.md: this file also
   * asserts a successful save above, so a green result here cannot be a harness that
   * never ran the save path at all.
   */
  it('announces a storage refusal rather than appearing to succeed', async () => {
    const user = userEvent.setup();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('QuotaExceededError');
    });
    const { onCreated } = renderForm('Landmine Press');

    await user.click(screen.getByRole('button', { name: /add and use it/i }));

    expect(onCreated).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(/would not save/i);
  });

  it('goes back without saving', async () => {
    const user = userEvent.setup();
    const { onCancel, onCreated } = renderForm('Half Murph');

    await user.click(screen.getByRole('button', { name: /back to search/i }));

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onCreated).not.toHaveBeenCalled();
    expect(listCustomExercises()).toEqual([]);
  });
});
