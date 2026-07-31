import { describe, it, expect, afterEach } from 'vitest';
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
});
