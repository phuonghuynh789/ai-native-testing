import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AddToFlowButton } from '../../src/components/AddToFlowButton';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('AddToFlowButton', () => {
  it('opens the panel when clicked', async () => {
    render(<AddToFlowButton stepNames={[]} flowNames={[]} onAdded={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Add to E2E Flow' }));
    expect(screen.getByLabelText('Step')).toBeInTheDocument();
    expect(screen.getByLabelText('Flow')).toBeInTheDocument();
  });

  it('disables Add until a step and an existing flow are chosen', async () => {
    render(
      <AddToFlowButton
        stepNames={['Check Balance']}
        flowNames={['Transfer money by wallet']}
        onAdded={vi.fn()}
      />
    );
    await userEvent.click(screen.getByRole('button', { name: 'Add to E2E Flow' }));
    expect(screen.getByRole('button', { name: 'Add' })).toBeDisabled();

    await userEvent.selectOptions(screen.getByLabelText('Step'), 'Check Balance');
    await userEvent.selectOptions(screen.getByLabelText('Flow'), 'Transfer money by wallet');
    expect(screen.getByRole('button', { name: 'Add' })).toBeEnabled();
  });

  it('adds an existing step to an existing flow, closing the panel on success', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: () => Promise.resolve({ names: ['Transfer money by wallet'] }) });
    vi.stubGlobal('fetch', fetchMock);

    const onAdded = vi.fn();
    render(
      <AddToFlowButton
        stepNames={['Check Balance']}
        flowNames={['Transfer money by wallet']}
        onAdded={onAdded}
      />
    );
    await userEvent.click(screen.getByRole('button', { name: 'Add to E2E Flow' }));
    await userEvent.selectOptions(screen.getByLabelText('Step'), 'Check Balance');
    await userEvent.selectOptions(screen.getByLabelText('Flow'), 'Transfer money by wallet');
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));

    expect(fetchMock).toHaveBeenCalledWith('/flows', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ flowName: 'Transfer money by wallet', stepName: 'Check Balance' }),
    });
    expect(onAdded).toHaveBeenCalledWith(['Transfer money by wallet']);
    expect(screen.queryByLabelText('Step')).not.toBeInTheDocument();
  });

  it('creates a new flow via "+ New Flow"', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: () => Promise.resolve({ names: ['Transfer money by wallet'] }) });
    vi.stubGlobal('fetch', fetchMock);

    render(<AddToFlowButton stepNames={['Check Balance']} flowNames={[]} onAdded={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Add to E2E Flow' }));
    await userEvent.selectOptions(screen.getByLabelText('Step'), 'Check Balance');
    await userEvent.selectOptions(screen.getByLabelText('Flow'), '__new_flow__');
    await userEvent.type(screen.getByLabelText('New flow name'), 'Transfer money by wallet');
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));

    expect(fetchMock).toHaveBeenCalledWith(
      '/flows',
      expect.objectContaining({
        body: JSON.stringify({ flowName: 'Transfer money by wallet', stepName: 'Check Balance' }),
      })
    );
  });

  it('cancels without adding', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    render(
      <AddToFlowButton
        stepNames={['Check Balance']}
        flowNames={['Transfer money by wallet']}
        onAdded={vi.fn()}
      />
    );
    await userEvent.click(screen.getByRole('button', { name: 'Add to E2E Flow' }));
    await userEvent.selectOptions(screen.getByLabelText('Step'), 'Check Balance');
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('Step')).not.toBeInTheDocument();
  });

  it('alerts on failure without closing the panel', async () => {
    vi.spyOn(window, 'alert').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: () => Promise.resolve({}) }));

    render(
      <AddToFlowButton
        stepNames={['Check Balance']}
        flowNames={['Transfer money by wallet']}
        onAdded={vi.fn()}
      />
    );
    await userEvent.click(screen.getByRole('button', { name: 'Add to E2E Flow' }));
    await userEvent.selectOptions(screen.getByLabelText('Step'), 'Check Balance');
    await userEvent.selectOptions(screen.getByLabelText('Flow'), 'Transfer money by wallet');
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));

    expect(window.alert).toHaveBeenCalledWith('Could not add this step to the flow. Please try again.');
    expect(screen.getByLabelText('Step')).toBeInTheDocument();
  });
});
