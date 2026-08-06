import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LoadStepSelect } from '../../src/components/LoadStepSelect';
import type { FormState } from '../../src/types';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function sampleForm(): FormState {
  return {
    actorName: 'Customer',
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
  };
}

describe('LoadStepSelect', () => {
  it('renders each stepNames entry as an option', () => {
    render(<LoadStepSelect stepNames={['Create Payment', 'Login']} onLoad={vi.fn()} />);
    expect(screen.getByRole('option', { name: 'Create Payment' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Login' })).toBeInTheDocument();
  });

  it('fetches and applies the selected step, then resets to the placeholder', async () => {
    const form = sampleForm();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(form) }));

    const onLoad = vi.fn();
    render(<LoadStepSelect stepNames={['Create Payment']} onLoad={onLoad} />);

    const select = screen.getByLabelText('Load Reusable Step') as HTMLSelectElement;
    await userEvent.selectOptions(select, 'Create Payment');

    expect(select.value).toBe('');
    await vi.waitFor(() => expect(onLoad).toHaveBeenCalledWith(form));
  });

  it('does nothing when the fetch fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: () => Promise.resolve({}) }));

    const onLoad = vi.fn();
    render(<LoadStepSelect stepNames={['Create Payment']} onLoad={onLoad} />);
    await userEvent.selectOptions(screen.getByLabelText('Load Reusable Step'), 'Create Payment');

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onLoad).not.toHaveBeenCalled();
  });
});
