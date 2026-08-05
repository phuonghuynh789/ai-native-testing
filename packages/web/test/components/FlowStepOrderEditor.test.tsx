import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FlowStepOrderEditor } from '../../src/components/FlowStepOrderEditor';

describe('FlowStepOrderEditor', () => {
  it('renders available steps and flow order steps in their respective columns', () => {
    render(
      <FlowStepOrderEditor
        availableSteps={['Get User']}
        flowOrder={['Check Balance', 'Transfer Money']}
        onFlowOrderChange={vi.fn()}
      />
    );
    expect(screen.getByText('Get User')).toBeInTheDocument();
    expect(screen.getByText('Check Balance')).toBeInTheDocument();
    expect(screen.getByText('Transfer Money')).toBeInTheDocument();
  });

  it('adds an available step to the end of flow order when dropped on the trailing drop zone', () => {
    const onFlowOrderChange = vi.fn();
    render(
      <FlowStepOrderEditor
        availableSteps={['Get User']}
        flowOrder={['Check Balance']}
        onFlowOrderChange={onFlowOrderChange}
      />
    );
    fireEvent.dragStart(screen.getByText('Get User'));
    fireEvent.dragOver(screen.getByText('Drop here to add'));
    fireEvent.drop(screen.getByText('Drop here to add'));
    expect(onFlowOrderChange).toHaveBeenCalledWith(['Check Balance', 'Get User']);
  });

  it('inserts an available step before the row it is dropped on', () => {
    const onFlowOrderChange = vi.fn();
    render(
      <FlowStepOrderEditor
        availableSteps={['Get User']}
        flowOrder={['Check Balance', 'Transfer Money']}
        onFlowOrderChange={onFlowOrderChange}
      />
    );
    fireEvent.dragStart(screen.getByText('Get User'));
    fireEvent.dragOver(screen.getByText('Transfer Money'));
    fireEvent.drop(screen.getByText('Transfer Money'));
    expect(onFlowOrderChange).toHaveBeenCalledWith(['Check Balance', 'Get User', 'Transfer Money']);
  });

  it('reorders within flow order when an already-included step is dragged to a new position', () => {
    const onFlowOrderChange = vi.fn();
    render(
      <FlowStepOrderEditor
        availableSteps={[]}
        flowOrder={['Check Balance', 'Transfer Money', 'Confirm Transfer']}
        onFlowOrderChange={onFlowOrderChange}
      />
    );
    fireEvent.dragStart(screen.getByText('Check Balance'));
    fireEvent.dragOver(screen.getByText('Confirm Transfer'));
    fireEvent.drop(screen.getByText('Confirm Transfer'));
    expect(onFlowOrderChange).toHaveBeenCalledWith(['Transfer Money', 'Check Balance', 'Confirm Transfer']);
  });

  it('removes a step from flow order when its remove button is clicked', () => {
    const onFlowOrderChange = vi.fn();
    render(
      <FlowStepOrderEditor
        availableSteps={[]}
        flowOrder={['Check Balance', 'Transfer Money']}
        onFlowOrderChange={onFlowOrderChange}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Remove Check Balance from flow' }));
    expect(onFlowOrderChange).toHaveBeenCalledWith(['Transfer Money']);
  });
});
