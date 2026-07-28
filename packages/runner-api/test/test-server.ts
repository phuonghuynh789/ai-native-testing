import http, { type IncomingMessage, type ServerResponse } from 'node:http';

export type TestServerHandler = (req: IncomingMessage, res: ServerResponse, body: string) => void;

export interface TestServer {
  url: string;
  close: () => Promise<void>;
}

export async function startTestServer(handler: TestServerHandler): Promise<TestServer> {
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      handler(req, res, Buffer.concat(chunks).toString('utf8'));
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('failed to determine test server address');
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
