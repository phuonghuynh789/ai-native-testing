import { describe, it, expect, afterEach, vi } from 'vitest';
import * as grpc from '@grpc/grpc-js';
import { RunContext } from '@ai-native-testing/engine';
import { GrpcRunner } from '../src/grpc-runner.js';
import { startFakePaymentGrpcServer, type FakeGrpcServer } from '../src/testing.js';

describe('GrpcRunner', () => {
  let server: FakeGrpcServer | undefined;

  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  it('invokes a unary call and remembers the decoded response', async () => {
    server = await startFakePaymentGrpcServer();
    const runner = new GrpcRunner();
    const ctx = new RunContext();

    await runner.interact(
      'call',
      {
        proto: server.proto,
        serverAddress: server.address,
        service: 'PaymentService',
        method: 'CreatePayment',
        message: { amount: '100', customerId: 'CUS001' },
      },
      ctx
    );

    expect(await runner.ask('status', {}, ctx)).toBe(0);
    expect(await runner.ask('raw', {}, ctx)).toMatchObject({
      status: 0,
      body: { paymentId: 'pay-123', status: 'CREATED' },
    });
    expect(await runner.ask('jsonPath', { path: '$.paymentId' }, ctx)).toBe('pay-123');
  });

  it('throws a clear error when the service is unknown', async () => {
    server = await startFakePaymentGrpcServer();
    const runner = new GrpcRunner();
    const ctx = new RunContext();

    await expect(
      runner.interact(
        'call',
        {
          proto: server.proto,
          serverAddress: server.address,
          service: 'MissingService',
          method: 'CreatePayment',
          message: {},
        },
        ctx
      )
    ).rejects.toThrow('Service "MissingService" not found in proto');
  });

  it('throws when ask is called before any call interaction', async () => {
    const runner = new GrpcRunner();
    const ctx = new RunContext();
    await expect(runner.ask('status', {}, ctx)).rejects.toThrow(
      'GrpcRunner "status" called before any "call" interaction'
    );
  });

  it('rejects an unsupported interaction action', async () => {
    const runner = new GrpcRunner();
    const ctx = new RunContext();
    await expect(runner.interact('unknown', {}, ctx)).rejects.toThrow(
      'GrpcRunner does not support interaction "unknown"'
    );
  });

  it('captures both initial (leading) metadata and trailing metadata as headers', async () => {
    server = await startFakePaymentGrpcServer();
    const runner = new GrpcRunner();
    const ctx = new RunContext();

    await runner.interact(
      'call',
      {
        proto: server.proto,
        serverAddress: server.address,
        service: 'PaymentService',
        method: 'CreatePayment',
        message: { amount: '100', customerId: 'CUS001' },
      },
      ctx
    );

    // x-request-id is sent as initial/leading metadata via call.sendMetadata()
    // in the fake server; x-trailer-only is sent only as trailing metadata.
    // Both must be readable via the "header" question.
    expect(await runner.ask('header', { name: 'x-request-id' }, ctx)).toBe('req-abc-123');
    expect(await runner.ask('header', { name: 'x-trailer-only' }, ctx)).toBe('trailer-value');
  });

  it('closes the gRPC client after a call succeeds', async () => {
    server = await startFakePaymentGrpcServer();
    const closeSpy = vi.spyOn(grpc.Client.prototype, 'close');
    const runner = new GrpcRunner();
    const ctx = new RunContext();

    await runner.interact(
      'call',
      {
        proto: server.proto,
        serverAddress: server.address,
        service: 'PaymentService',
        method: 'CreatePayment',
        message: { amount: '100', customerId: 'CUS001' },
      },
      ctx
    );

    expect(closeSpy).toHaveBeenCalledTimes(1);
    closeSpy.mockRestore();
  });

  it('closes the gRPC client even when the interaction fails', async () => {
    server = await startFakePaymentGrpcServer();
    const closeSpy = vi.spyOn(grpc.Client.prototype, 'close');
    const runner = new GrpcRunner();
    const ctx = new RunContext();

    await expect(
      runner.interact(
        'call',
        {
          proto: server.proto,
          serverAddress: server.address,
          service: 'PaymentService',
          method: 'NoSuchMethod',
          message: {},
        },
        ctx
      )
    ).rejects.toThrow('Method "NoSuchMethod" not found on service "PaymentService"');

    expect(closeSpy).toHaveBeenCalledTimes(1);
    closeSpy.mockRestore();
  });

  it('applies a deadline to unary calls so a hung server eventually fails the call', async () => {
    // No server started at this address (or one that never responds) — grpc-js
    // will keep retrying/connecting. Without a deadline this would hang forever;
    // with one, callUnary rejects once the deadline is exceeded.
    const runner = new GrpcRunner({ timeoutMs: 200 });
    const ctx = new RunContext();
    const fakeServer = await startFakePaymentGrpcServer();
    server = fakeServer;

    await expect(
      runner.interact(
        'call',
        {
          proto: fakeServer.proto,
          // Unroutable address (TEST-NET-1, RFC 5737) so the call never completes.
          serverAddress: '192.0.2.1:50051',
          service: 'PaymentService',
          method: 'CreatePayment',
          message: { amount: '100', customerId: 'CUS001' },
        },
        ctx
      )
    ).resolves.toBeUndefined();

    expect(await runner.ask('status', {}, ctx)).not.toBe(0);
  }, 10_000);
});
