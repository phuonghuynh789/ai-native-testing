import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { KafkaContractChecksPage } from '../../src/components/KafkaContractChecksPage';
import type { KafkaContractCheckRow } from '../../src/kafkaContractChecks';

function makeRow(overrides: Partial<KafkaContractCheckRow> = {}): KafkaContractCheckRow {
  return {
    message_id: 'tx-1',
    name: 'Create Payment',
    topic: 'transLogV1',
    version: '1.0.0',
    status: 'passed',
    diffReport: { result: 'passed', findings: [] },
    errorMessage: null,
    created_at: '2026-08-13T00:00:00.000Z',
    updated_at: '2026-08-13T00:00:01.000Z',
    ...overrides,
  };
}

describe('KafkaContractChecksPage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('lists fetched rows with name, topic/version, and status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve([makeRow()]) }));
    render(<KafkaContractChecksPage />);
    const row = await screen.findByRole('button', { name: /Create Payment/ });
    expect(row).toHaveTextContent('transLogV1');
    expect(row).toHaveTextContent('1.0.0');
    expect(row).toHaveTextContent('passed');
  });

  it('expands a row to show its diff findings', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve([
            makeRow({
              status: 'failed',
              diffReport: {
                result: 'failed',
                findings: [
                  { kind: 'missing-field', status: 'SUCCESS', field: 'amount', severity: 'critical', baselineValue: 10000 },
                ],
              },
            }),
          ]),
      })
    );
    render(<KafkaContractChecksPage />);
    const row = await screen.findByRole('button', { name: /Create Payment/ });
    await userEvent.click(row);
    expect(await screen.findByText(/CRITICAL.*missing-field.*field=amount/)).toBeInTheDocument();
  });

  it('shows the error message instead of findings when the check errored', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve([
            makeRow({ status: 'error', diffReport: null, errorMessage: 'No baseline found at 1.0.0/SUCCESS.json' }),
          ]),
      })
    );
    render(<KafkaContractChecksPage />);
    const row = await screen.findByRole('button', { name: /Create Payment/ });
    await userEvent.click(row);
    expect(await screen.findByText('No baseline found at 1.0.0/SUCCESS.json')).toBeInTheDocument();
  });

  it('shows an empty state when there are no checks yet', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve([]) }));
    render(<KafkaContractChecksPage />);
    expect(await screen.findByText('No Kafka contract checks yet.')).toBeInTheDocument();
  });
});

describe('KafkaContractChecksPage — manual check form', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('renders the transid textbox, Kafka Topic select, Version input, and Check Contract button', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve([]) }));
    render(<KafkaContractChecksPage />);
    expect(screen.getByLabelText('Transaction ID')).toBeInTheDocument();
    expect(screen.getByLabelText('Kafka Topic')).toBeInTheDocument();
    expect(screen.getByLabelText('Version')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Check Contract' })).toBeInTheDocument();
  });

  it('disables Check Contract until transid, topic, and version are all filled', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve([]) }));
    render(<KafkaContractChecksPage />);
    expect(screen.getByRole('button', { name: 'Check Contract' })).toBeDisabled();

    await userEvent.type(screen.getByLabelText('Transaction ID'), 'tx-123');
    expect(screen.getByRole('button', { name: 'Check Contract' })).toBeDisabled();

    await userEvent.selectOptions(screen.getByLabelText('Kafka Topic'), 'transLogV1');
    expect(screen.getByRole('button', { name: 'Check Contract' })).toBeDisabled();

    await userEvent.type(screen.getByLabelText('Version'), '1.0.0');
    expect(screen.getByRole('button', { name: 'Check Contract' })).toBeEnabled();
  });

  it('registers a check using the transid as both message_id and name', async () => {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === '/kafka-contract-checks' && init?.method === 'POST') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<KafkaContractChecksPage />);
    await userEvent.type(screen.getByLabelText('Transaction ID'), 'tx-123');
    await userEvent.selectOptions(screen.getByLabelText('Kafka Topic'), 'paymentAuth');
    await userEvent.type(screen.getByLabelText('Version'), '1.0.0');
    await userEvent.click(screen.getByRole('button', { name: 'Check Contract' }));

    expect(fetchMock).toHaveBeenCalledWith('/kafka-contract-checks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message_id: 'tx-123', name: 'tx-123', topic: 'paymentAuth', version: '1.0.0' }),
    });
  });

  it('shows an inline error when registration fails', async () => {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === '/kafka-contract-checks' && init?.method === 'POST') {
        return Promise.resolve({ ok: false, json: () => Promise.resolve({}) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<KafkaContractChecksPage />);
    await userEvent.type(screen.getByLabelText('Transaction ID'), 'tx-123');
    await userEvent.selectOptions(screen.getByLabelText('Kafka Topic'), 'paymentAuth');
    await userEvent.type(screen.getByLabelText('Version'), '1.0.0');
    await userEvent.click(screen.getByRole('button', { name: 'Check Contract' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not register the Kafka contract check. Please try again.'
    );
  });
});

describe('KafkaContractChecksPage — inline result panel', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('shows a pending panel immediately after registering, before the tracked row appears in the polled list', async () => {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === '/kafka-contract-checks' && init?.method === 'POST') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<KafkaContractChecksPage />);
    await userEvent.type(screen.getByLabelText('Transaction ID'), 'tx-123');
    await userEvent.selectOptions(screen.getByLabelText('Kafka Topic'), 'paymentAuth');
    await userEvent.type(screen.getByLabelText('Version'), '1.0.0');
    await userEvent.click(screen.getByRole('button', { name: 'Check Contract' }));

    expect(await screen.findByText('Pending…')).toBeInTheDocument();
  });

  it('shows PASSED once the tracked row resolves as passed in the polled list', async () => {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === '/kafka-contract-checks' && init?.method === 'POST') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve([makeRow({ message_id: 'tx-123', status: 'passed' })]),
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<KafkaContractChecksPage />);
    await userEvent.type(screen.getByLabelText('Transaction ID'), 'tx-123');
    await userEvent.selectOptions(screen.getByLabelText('Kafka Topic'), 'paymentAuth');
    await userEvent.type(screen.getByLabelText('Version'), '1.0.0');
    await userEvent.click(screen.getByRole('button', { name: 'Check Contract' }));

    expect(await screen.findByText('PASSED')).toBeInTheDocument();
  });

  it('shows FAILED once the tracked row resolves as failed', async () => {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === '/kafka-contract-checks' && init?.method === 'POST') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
      }
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve([
            makeRow({
              message_id: 'tx-123',
              status: 'failed',
              diffReport: {
                result: 'failed',
                findings: [
                  { kind: 'missing-field', status: 'SUCCESS', field: 'amount', severity: 'critical', baselineValue: 10000 },
                ],
              },
            }),
          ]),
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<KafkaContractChecksPage />);
    await userEvent.type(screen.getByLabelText('Transaction ID'), 'tx-123');
    await userEvent.selectOptions(screen.getByLabelText('Kafka Topic'), 'paymentAuth');
    await userEvent.type(screen.getByLabelText('Version'), '1.0.0');
    await userEvent.click(screen.getByRole('button', { name: 'Check Contract' }));

    expect(await screen.findByText('FAILED')).toBeInTheDocument();
  });

  it('shows ERROR with the error message once the tracked row resolves as error', async () => {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === '/kafka-contract-checks' && init?.method === 'POST') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
      }
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve([
            makeRow({
              message_id: 'tx-123',
              status: 'error',
              diffReport: null,
              errorMessage: 'No baseline found at 1.0.0/SUCCESS.json',
            }),
          ]),
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<KafkaContractChecksPage />);
    await userEvent.type(screen.getByLabelText('Transaction ID'), 'tx-123');
    await userEvent.selectOptions(screen.getByLabelText('Kafka Topic'), 'paymentAuth');
    await userEvent.type(screen.getByLabelText('Version'), '1.0.0');
    await userEvent.click(screen.getByRole('button', { name: 'Check Contract' }));

    expect(await screen.findByText('ERROR')).toBeInTheDocument();
    expect(await screen.findByText('No baseline found at 1.0.0/SUCCESS.json')).toBeInTheDocument();
  });
});
