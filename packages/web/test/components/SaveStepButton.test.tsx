import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SaveStepButton } from '../../src/components/SaveStepButton';
import type { FormState } from '../../src/types';

function sampleForm(): FormState {
  return {
    actorName: '',
    taskName: 'Create Payment',
    variables: [],
    protocol: 'rest',
    method: 'POST',
    url: 'https://api.example.com/x',
    params: [],
    headers: [],
    auth: { type: 'none' },
    body: '',
    grpc: {
      protoContent: '',
      protoFilename: '',
      serverAddress: '',
      service: '',
      method: '',
      requestMessage: '',
      metadata: [],
      secure: true,
      skipCertVerification: false,
    },
    extracts: [],
    questions: [],
    kafkaCheck: { enabled: false, topic: 'transLogV1' },
    kafkaContractCheck: { enabled: false, topic: 'transLogV1', version: '' },
    afterResponse: [],
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('SaveStepButton', () => {
  it('is disabled when disabled is true', () => {
    render(<SaveStepButton form={sampleForm()} disabled={true} existingNames={[]} onSaved={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Save as Reusable Step' })).toBeDisabled();
  });

  it('saves under a new name and calls onSaved with the updated list', async () => {
    vi.spyOn(window, 'prompt').mockReturnValue('Create Payment');
    vi.spyOn(window, 'alert').mockImplementation(() => {});
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: () => Promise.resolve({ names: ['Create Payment'] }) });
    vi.stubGlobal('fetch', fetchMock);

    const onSaved = vi.fn();
    render(<SaveStepButton form={sampleForm()} disabled={false} existingNames={[]} onSaved={onSaved} />);
    await userEvent.click(screen.getByRole('button', { name: 'Save as Reusable Step' }));

    expect(fetchMock).toHaveBeenCalledWith('/steps', expect.objectContaining({ method: 'POST' }));
    expect(onSaved).toHaveBeenCalledWith(['Create Payment']);
    expect(window.alert).toHaveBeenCalledWith('Saved "Create Payment".');
  });

  it('does nothing when the prompt is cancelled', async () => {
    vi.spyOn(window, 'prompt').mockReturnValue(null);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    render(<SaveStepButton form={sampleForm()} disabled={false} existingNames={[]} onSaved={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Save as Reusable Step' }));

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('confirms before overwriting an existing name, and cancels the save if declined', async () => {
    vi.spyOn(window, 'prompt').mockReturnValue('Create Payment');
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    render(
      <SaveStepButton
        form={sampleForm()}
        disabled={false}
        existingNames={['Create Payment']}
        onSaved={vi.fn()}
      />
    );
    await userEvent.click(screen.getByRole('button', { name: 'Save as Reusable Step' }));

    expect(window.confirm).toHaveBeenCalledWith('"Create Payment" already exists. Overwrite it?');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('saves anyway when overwrite is confirmed', async () => {
    vi.spyOn(window, 'prompt').mockReturnValue('Create Payment');
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.spyOn(window, 'alert').mockImplementation(() => {});
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: () => Promise.resolve({ names: ['Create Payment'] }) });
    vi.stubGlobal('fetch', fetchMock);

    const onSaved = vi.fn();
    render(
      <SaveStepButton
        form={sampleForm()}
        disabled={false}
        existingNames={['Create Payment']}
        onSaved={onSaved}
      />
    );
    await userEvent.click(screen.getByRole('button', { name: 'Save as Reusable Step' }));

    expect(fetchMock).toHaveBeenCalled();
    expect(onSaved).toHaveBeenCalledWith(['Create Payment']);
  });

  it('alerts on failure without calling onSaved', async () => {
    vi.spyOn(window, 'prompt').mockReturnValue('Create Payment');
    vi.spyOn(window, 'alert').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: () => Promise.resolve({}) }));

    const onSaved = vi.fn();
    render(<SaveStepButton form={sampleForm()} disabled={false} existingNames={[]} onSaved={onSaved} />);
    await userEvent.click(screen.getByRole('button', { name: 'Save as Reusable Step' }));

    expect(onSaved).not.toHaveBeenCalled();
    expect(window.alert).toHaveBeenCalledWith('Could not save this step. Please try again.');
  });
});
