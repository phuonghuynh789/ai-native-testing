import { describe, it, expect, afterEach } from 'vitest';
import http from 'node:http';
import { buildApp } from '../src/app.js';

interface FakePaymentServer {
  url: string;
  close: () => Promise<void>;
}

async function startFakePaymentApi(): Promise<FakePaymentServer> {
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      res.setHeader('Content-Type', 'application/json');

      if (req.method === 'POST' && req.url === '/login') {
        res.writeHead(200);
        res.end(JSON.stringify({ data: { accessToken: 'tok-abc' } }));
        return;
      }

      if (req.method === 'POST' && req.url === '/v1/payments') {
        if (req.headers.authorization !== 'Bearer tok-abc') {
          res.writeHead(401);
          res.end(JSON.stringify({ error: 'unauthorized' }));
          return;
        }
        JSON.parse(body); // proves the request body was sent as valid JSON
        res.writeHead(201);
        res.end(JSON.stringify({ data: { paymentId: 'pay-123' } }));
        return;
      }

      if (req.method === 'GET' && req.url === '/v1/payments/pay-123') {
        res.writeHead(200);
        res.end(JSON.stringify({ data: { status: 'SUCCESS' } }));
        return;
      }

      res.writeHead(404);
      res.end(JSON.stringify({ error: 'not found' }));
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('failed to determine fake payment API address');
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

describe('REST flow end-to-end', () => {
  let api: FakePaymentServer | undefined;

  afterEach(async () => {
    await api?.close();
    api = undefined;
  });

  it('runs Login -> Create Payment -> Get Payment Status through POST /runs', async () => {
    api = await startFakePaymentApi();
    const app = buildApp();

    const definition = {
      actor: { name: 'Authenticated Customer', abilities: ['rest'] },
      variables: {
        baseUrl: api.url,
        orderId: 'order-1',
        amount: 49.99,
      },
      tasks: [
        {
          name: 'Login',
          steps: [
            { type: 'interaction', runner: 'rest', action: 'request', with: { method: 'POST', url: '${baseUrl}/login', body: {} } },
            { type: 'question', runner: 'rest', action: 'status', expect: { equals: 200 } },
            { type: 'extract', runner: 'rest', action: 'jsonPath', with: { path: '$.data.accessToken' }, remember: 'accessToken' },
          ],
        },
        {
          name: 'Create Payment',
          steps: [
            {
              type: 'interaction',
              runner: 'rest',
              action: 'request',
              with: {
                method: 'POST',
                url: '${baseUrl}/v1/payments',
                auth: { type: 'bearer', token: '${accessToken}' },
                body: { orderId: '${orderId}', amount: '${amount}' },
              },
            },
            { type: 'question', runner: 'rest', action: 'status', expect: { equals: 201 } },
            { type: 'extract', runner: 'rest', action: 'jsonPath', with: { path: '$.data.paymentId' }, remember: 'paymentId' },
          ],
        },
        {
          name: 'Get Payment Status',
          steps: [
            {
              type: 'interaction',
              runner: 'rest',
              action: 'request',
              with: {
                method: 'GET',
                url: '${baseUrl}/v1/payments/${paymentId}',
                auth: { type: 'bearer', token: '${accessToken}' },
              },
            },
            { type: 'question', runner: 'rest', action: 'jsonPath', with: { path: '$.data.status' }, expect: { equals: 'SUCCESS' } },
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
