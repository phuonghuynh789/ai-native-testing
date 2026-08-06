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
