import { describe, it, expect, afterEach } from 'vitest';
import http from 'node:http';
import { buildApp } from '../src/app.js';
import { startFakePaymentGrpcServer, type FakeGrpcServer } from '@ai-native-testing/runner-grpc';

interface FakeHttpServer {
  url: string;
  close: () => Promise<void>;
}

async function startFakeAuthApi(): Promise<FakeHttpServer> {
  const server = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.method === 'POST' && req.url === '/login') {
      res.writeHead(200);
      res.end(JSON.stringify({ data: { customerId: 'CUS001' } }));
      return;
    }
    res.writeHead(404);
    res.end(JSON.stringify({ error: 'not found' }));
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('failed to determine fake auth API address');
  }

  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

async function pollUntilFinished(app: ReturnType<typeof buildApp>, jobId: string) {
  for (let i = 0; i < 50; i++) {
    const res = await app.inject({ method: 'GET', url: `/runs/${jobId}` });
    const body = res.json();
    if (body.status === 'passed' || body.status === 'failed') {
      return body;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('job did not finish in time');
}

describe('Mixed REST + gRPC flow end-to-end', () => {
  let httpApi: FakeHttpServer | undefined;
  let grpcServer: FakeGrpcServer | undefined;

  afterEach(async () => {
    await httpApi?.close();
    await grpcServer?.close();
    httpApi = undefined;
    grpcServer = undefined;
  });

  it('runs a REST login step followed by a gRPC payment step, chaining the extracted customerId', async () => {
    httpApi = await startFakeAuthApi();
    grpcServer = await startFakePaymentGrpcServer();
    const app = buildApp();

    const definition = {
      actor: { name: 'Authenticated Customer', abilities: ['rest', 'grpc'] },
      variables: { authBaseUrl: httpApi.url },
      tasks: [
        {
          name: 'Login',
          steps: [
            {
              type: 'interaction',
              runner: 'rest',
              action: 'request',
              with: { method: 'POST', url: '${authBaseUrl}/login', body: {} },
            },
            { type: 'question', runner: 'rest', action: 'status', expect: { equals: 200 } },
            {
              type: 'extract',
              runner: 'rest',
              action: 'jsonPath',
              with: { path: '$.data.customerId' },
              remember: 'customerId',
            },
          ],
        },
        {
          name: 'Create Payment',
          steps: [
            {
              type: 'interaction',
              runner: 'grpc',
              action: 'call',
              with: {
                proto: grpcServer.proto,
                serverAddress: grpcServer.address,
                service: 'PaymentService',
                method: 'CreatePayment',
                message: { amount: '100', customerId: '${customerId}' },
              },
            },
            { type: 'question', runner: 'grpc', action: 'status', expect: { equals: 0 } },
            {
              type: 'question',
              runner: 'grpc',
              action: 'jsonPath',
              with: { path: '$.status' },
              expect: { equals: 'CREATED' },
            },
          ],
        },
      ],
    };

    const submit = await app.inject({ method: 'POST', url: '/runs', payload: definition });
    expect(submit.statusCode).toBe(202);
    const { jobId } = submit.json();

    const job = await pollUntilFinished(app, jobId);
    expect(job.status).toBe('passed');
    expect(job.steps.every((s: { status: string }) => s.status === 'passed')).toBe(true);
  });
});
