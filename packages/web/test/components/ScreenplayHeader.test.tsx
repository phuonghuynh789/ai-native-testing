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
        actorOptions={[]}
        taskOptions={[]}
      />
    );
    await userEvent.type(screen.getByLabelText('Actor'), 'A');
    await userEvent.type(screen.getByLabelText('Task'), 'T');
    expect(onActorNameChange).toHaveBeenCalledWith('A');
    expect(onTaskNameChange).toHaveBeenCalledWith('T');
  });

  it('renders each actorOptions entry as a datalist option for the Actor field', () => {
    render(
      <ScreenplayHeader
        actorName=""
        onActorNameChange={() => {}}
        taskName=""
        onTaskNameChange={() => {}}
        actorOptions={['Customer', 'Admin']}
        taskOptions={[]}
      />
    );
    const actorInput = screen.getByLabelText('Actor');
    const listId = actorInput.getAttribute('list');
    expect(listId).toBeTruthy();
    const options = document.querySelectorAll(`#${listId} option`);
    expect(Array.from(options).map((o) => o.getAttribute('value'))).toEqual(['Customer', 'Admin']);
  });

  it('renders each taskOptions entry as a datalist option for the Task field', () => {
    render(
      <ScreenplayHeader
        actorName=""
        onActorNameChange={() => {}}
        taskName=""
        onTaskNameChange={() => {}}
        actorOptions={[]}
        taskOptions={['Create Payment', 'Get Payment Status']}
      />
    );
    const taskInput = screen.getByLabelText('Task');
    const listId = taskInput.getAttribute('list');
    expect(listId).toBeTruthy();
    const options = document.querySelectorAll(`#${listId} option`);
    expect(Array.from(options).map((o) => o.getAttribute('value'))).toEqual([
      'Create Payment',
      'Get Payment Status',
    ]);
  });
});
