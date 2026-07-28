import { describe, it, expect, afterEach } from 'vitest';
import { RunContext } from '@ai-native-testing/engine';
import { RestRunner } from '../src/rest-runner.js';
import { startTestServer, type TestServer } from './test-server.js';

let server: TestServer | undefined;

afterEach(async () => {
  await server?.close();
  server = undefined;
});

describe('RestRunner', () => {
  it('sends a GET request and stores the response for later ask calls', async () => {
    server = await startTestServer((req, res) => {
      expect(req.method).toBe('GET');
      expect(req.url).toBe('/v1/payments/pay_123');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: { status: 'SUCCESS' } }));
    });

    const runner = new RestRunner();
    const ctx = new RunContext();
    await runner.interact('request', { method: 'GET', url: `${server.url}/v1/payments/pay_123` }, ctx);

    expect(await runner.ask('status', {}, ctx)).toBe(200);
    expect(await runner.ask('jsonPath', { path: '$.data.status' }, ctx)).toBe('SUCCESS');
  });

  it('sends a JSON body on POST and sets Content-Type automatically', async () => {
    let receivedBody = '';
    let receivedContentType: string | undefined;
    server = await startTestServer((req, res, body) => {
      receivedBody = body;
      receivedContentType = req.headers['content-type'];
      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: { paymentId: 'pay_123' } }));
    });

    const runner = new RestRunner();
    const ctx = new RunContext();
    await runner.interact(
      'request',
      { method: 'POST', url: server.url, body: { orderId: 'order-1', amount: 10 } },
      ctx
    );

    expect(JSON.parse(receivedBody)).toEqual({ orderId: 'order-1', amount: 10 });
    expect(receivedContentType).toBe('application/json');
  });

  it('applies a bearer auth header', async () => {
    let receivedAuth: string | undefined;
    server = await startTestServer((req, res) => {
      receivedAuth = req.headers.authorization;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{}');
    });

    const runner = new RestRunner();
    const ctx = new RunContext();
    await runner.interact(
      'request',
      { method: 'GET', url: server.url, auth: { type: 'bearer', token: 'tok-1' } },
      ctx
    );

    expect(receivedAuth).toBe('Bearer tok-1');
  });

  it('appends query parameters to the URL', async () => {
    let receivedUrl = '';
    server = await startTestServer((req, res) => {
      receivedUrl = req.url ?? '';
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{}');
    });

    const runner = new RestRunner();
    const ctx = new RunContext();
    await runner.interact('request', { method: 'GET', url: server.url, query: { page: '2' } }, ctx);

    expect(receivedUrl).toBe('/?page=2');
  });

  it('reads a response header value', async () => {
    server = await startTestServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json', 'X-Request-Id': 'req-42' });
      res.end('{}');
    });

    const runner = new RestRunner();
    const ctx = new RunContext();
    await runner.interact('request', { method: 'GET', url: server.url }, ctx);

    expect(await runner.ask('header', { name: 'X-Request-Id' }, ctx)).toBe('req-42');
  });

  it('throws when extracting via jsonPath from a non-JSON response body', async () => {
    server = await startTestServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('hello world');
    });

    const runner = new RestRunner();
    const ctx = new RunContext();
    await runner.interact('request', { method: 'GET', url: server.url }, ctx);

    await expect(runner.ask('jsonPath', { path: '$.foo' }, ctx)).rejects.toThrow(/did not resolve to a value/);
  });

  it('does not throw on a non-2xx HTTP status, so negative tests can assert it', async () => {
    server = await startTestServer((req, res) => {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'not found' }));
    });

    const runner = new RestRunner();
    const ctx = new RunContext();
    await runner.interact('request', { method: 'GET', url: server.url }, ctx);

    expect(await runner.ask('status', {}, ctx)).toBe(404);
  });

  it('rejects an unknown interaction action', async () => {
    const runner = new RestRunner();
    const ctx = new RunContext();
    await expect(runner.interact('unknown', {}, ctx)).rejects.toThrow(
      'RestRunner does not support interaction "unknown"'
    );
  });

  it('rejects an unknown question action', async () => {
    server = await startTestServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{}');
    });

    const runner = new RestRunner();
    const ctx = new RunContext();
    await runner.interact('request', { method: 'GET', url: server.url }, ctx);

    await expect(runner.ask('unknown', {}, ctx)).rejects.toThrow(
      'RestRunner does not support question "unknown"'
    );
  });

  it('throws when asked before any request has been made', async () => {
    const runner = new RestRunner();
    const ctx = new RunContext();
    await expect(runner.ask('status', {}, ctx)).rejects.toThrow(
      'RestRunner "status" called before any "request" interaction'
    );
  });

  it('throws when the server is unreachable', async () => {
    const runner = new RestRunner();
    const ctx = new RunContext();
    await expect(runner.interact('request', { method: 'GET', url: 'http://127.0.0.1:1' }, ctx)).rejects.toThrow();
  });

  it('throws when the request exceeds the configured timeout', async () => {
    server = await startTestServer(() => {
      // Never responds — this test uses a short timeoutMs instead of waiting
      // out the real 30s default, so it stays fast.
    });

    const runner = new RestRunner({ timeoutMs: 50 });
    const ctx = new RunContext();
    await expect(runner.interact('request', { method: 'GET', url: server.url }, ctx)).rejects.toThrow();
  });

  it('returns the whole response via the raw action', async () => {
    server = await startTestServer((req, res) => {
      res.writeHead(201, { 'Content-Type': 'application/json', 'X-Request-Id': 'req-1' });
      res.end(JSON.stringify({ data: { paymentId: 'pay_1' } }));
    });

    const runner = new RestRunner();
    const ctx = new RunContext();
    await runner.interact('request', { method: 'GET', url: server.url }, ctx);

    const raw = (await runner.ask('raw', {}, ctx)) as {
      status: number;
      headers: Record<string, string>;
      body: unknown;
    };
    expect(raw.status).toBe(201);
    expect(raw.headers['content-type']).toBe('application/json');
    expect(raw.headers['x-request-id']).toBe('req-1');
    expect(raw.body).toEqual({ data: { paymentId: 'pay_1' } });
  });
});
