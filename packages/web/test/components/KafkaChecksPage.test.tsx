import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { KafkaChecksPage } from '../../src/components/KafkaChecksPage';
import type { KafkaCheckRow } from '../../src/kafkaChecks';

function makeRow(overrides: Partial<KafkaCheckRow> = {}): KafkaCheckRow {
  return {
    message_id: 'tx-1',
    name: 'Create Payment',
    topic: 'transLogV1',
    status: 'passed',
    missingFields: [],
    matchedMessage: { data: { transID: 1 } },
    created_at: '2026-08-05T00:00:00.000Z',
    updated_at: '2026-08-05T00:00:01.000Z',
    retry_count: 0,
    ...overrides,
  };
}

describe('KafkaChecksPage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('lists fetched rows with name, topic, and status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve([makeRow()]) }));
    render(<KafkaChecksPage />);
    const row = await screen.findByRole('button', { name: /Create Payment/ });
    expect(row).toHaveTextContent('transLogV1');
    expect(row).toHaveTextContent('passed');
  });

  it('expands a row to show the matched message', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve([makeRow()]) }));
    render(<KafkaChecksPage />);
    const row = await screen.findByRole('button', { name: /Create Payment/ });
    await userEvent.click(row);
    expect(await screen.findByText(/"transID": 1/)).toBeInTheDocument();
  });

  it('shows missing fields instead of the message when the check failed', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve([makeRow({ status: 'failed', missingFields: ['mcc'] })]),
      })
    );
    render(<KafkaChecksPage />);
    const row = await screen.findByRole('button', { name: /Create Payment/ });
    await userEvent.click(row);
    expect(await screen.findByText('Missing fields: mcc')).toBeInTheDocument();
  });

  it('shows an empty state when there are no checks yet', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve([]) }));
    render(<KafkaChecksPage />);
    expect(await screen.findByText('No Kafka checks yet.')).toBeInTheDocument();
  });
});

describe('KafkaChecksPage — manual check form', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('renders the transid textbox, Kafka Topic select, and Check Kafka button', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve([]) }));
    render(<KafkaChecksPage />);
    expect(screen.getByLabelText('Transaction ID')).toBeInTheDocument();
    expect(screen.getByLabelText('Kafka Topic')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Check Kafka' })).toBeInTheDocument();
  });

  it('lists all three known topics as options', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve([]) }));
    render(<KafkaChecksPage />);
    const optionTexts = screen.getAllByRole('option').map((o) => o.textContent);
    expect(optionTexts).toEqual(expect.arrayContaining(['transLogV1', 'refundLog', 'paymentAuth']));
  });

  it('disables Check Kafka until both transid and topic are filled', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve([]) }));
    render(<KafkaChecksPage />);
    expect(screen.getByRole('button', { name: 'Check Kafka' })).toBeDisabled();

    await userEvent.type(screen.getByLabelText('Transaction ID'), 'tx-123');
    expect(screen.getByRole('button', { name: 'Check Kafka' })).toBeDisabled();

    await userEvent.selectOptions(screen.getByLabelText('Kafka Topic'), 'transLogV1');
    expect(screen.getByRole('button', { name: 'Check Kafka' })).toBeEnabled();
  });

  it('registers a check using the transid as both message_id and name', async () => {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === '/kafka-checks' && init?.method === 'POST') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<KafkaChecksPage />);
    await userEvent.type(screen.getByLabelText('Transaction ID'), 'tx-123');
    await userEvent.selectOptions(screen.getByLabelText('Kafka Topic'), 'paymentAuth');
    await userEvent.click(screen.getByRole('button', { name: 'Check Kafka' }));

    expect(fetchMock).toHaveBeenCalledWith('/kafka-checks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message_id: 'tx-123', name: 'tx-123', topic: 'paymentAuth' }),
    });
  });

  it('shows an inline error when registration fails', async () => {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === '/kafka-checks' && init?.method === 'POST') {
        return Promise.resolve({ ok: false, json: () => Promise.resolve({}) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<KafkaChecksPage />);
    await userEvent.type(screen.getByLabelText('Transaction ID'), 'tx-123');
    await userEvent.selectOptions(screen.getByLabelText('Kafka Topic'), 'paymentAuth');
    await userEvent.click(screen.getByRole('button', { name: 'Check Kafka' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not register the Kafka check. Please try again.');
  });
});
