import { describe, it, expect, vi, afterEach } from 'vitest';
import { introspectProto } from '../src/grpcIntrospect';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('introspectProto', () => {
  it('returns the parsed services on success', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ services: [{ service: 'PaymentService', methods: ['CreatePayment'] }] }),
      })
    );
    expect(await introspectProto('syntax = "proto3";')).toEqual([
      { service: 'PaymentService', methods: ['CreatePayment'] },
    ]);
  });

  it('returns undefined when the response is not ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: () => Promise.resolve({}) }));
    expect(await introspectProto('not valid')).toBeUndefined();
  });

  it('returns undefined when the request throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    expect(await introspectProto('syntax = "proto3";')).toBeUndefined();
  });

  it('POSTs the proto content as JSON', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: () => Promise.resolve({ services: [] }) });
    vi.stubGlobal('fetch', fetchMock);
    await introspectProto('syntax = "proto3";');
    expect(fetchMock).toHaveBeenCalledWith('/grpc/introspect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ proto: 'syntax = "proto3";' }),
    });
  });
});
