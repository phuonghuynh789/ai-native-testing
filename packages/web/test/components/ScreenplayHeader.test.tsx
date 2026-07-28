import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ScreenplayHeader } from '../../src/components/ScreenplayHeader';

describe('ScreenplayHeader', () => {
  it('calls onActorNameChange and onTaskNameChange as their inputs change', async () => {
    const onActorNameChange = vi.fn();
    const onTaskNameChange = vi.fn();
    render(
      <ScreenplayHeader
        actorName=""
        onActorNameChange={onActorNameChange}
        taskName=""
        onTaskNameChange={onTaskNameChange}
      />
    );
    await userEvent.type(screen.getByLabelText('Actor'), 'A');
    await userEvent.type(screen.getByLabelText('Task'), 'T');
    expect(onActorNameChange).toHaveBeenCalledWith('A');
    expect(onTaskNameChange).toHaveBeenCalledWith('T');
  });
});
