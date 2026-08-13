import { describe, it, expect, vi, afterEach } from 'vitest';
import { registerKafkaContractCheck, fetchKafkaContractChecks } from '../src/kafkaContractChecks';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('registerKafkaContractCheck', () => {
  it('POSTs the message_id, name, topic, and version', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });
    vi.stubGlobal('fetch', fetchMock);

    await registerKafkaContractCheck({
      message_id: 'tx-1',
      name: 'Create Payment',
      topic: 'transLogV1',
      version: '1.0.0',
    });

    expect(fetchMock).toHaveBeenCalledWith('/kafka-contract-checks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message_id: 'tx-1', name: 'Create Payment', topic: 'transLogV1', version: '1.0.0' }),
    });
  });

  it('throws when the response is not ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: () => Promise.resolve({}) }));
    await expect(
      registerKafkaContractCheck({ message_id: 'tx-1', name: 'x', topic: 'transLogV1', version: '1.0.0' })
    ).rejects.toThrow();
  });
});

describe('fetchKafkaContractChecks', () => {
  it('returns the parsed list on success', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve([{ message_id: 'tx-1' }]) })
    );
    expect(await fetchKafkaContractChecks()).toEqual([{ message_id: 'tx-1' }]);
  });

  it('returns an empty array when the response is not ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: () => Promise.resolve([]) }));
    expect(await fetchKafkaContractChecks()).toEqual([]);
  });

  it('returns an empty array when the request throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    expect(await fetchKafkaContractChecks()).toEqual([]);
  });
});
