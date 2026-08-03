import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export const FAKE_PAYMENT_PROTO = `
syntax = "proto3";
package test;

message CreatePaymentRequest {
  string amount = 1;
  string customerId = 2;
}

message CreatePaymentResponse {
  string paymentId = 1;
  string status = 2;
}

message GetPaymentRequest {
  string paymentId = 1;
}

message GetPaymentResponse {
  string status = 1;
}

service PaymentService {
  rpc CreatePayment (CreatePaymentRequest) returns (CreatePaymentResponse);
  rpc GetPayment (GetPaymentRequest) returns (GetPaymentResponse);
}
`;

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'test', 'fixtures');

export interface FakeGrpcServer {
  address: string;
  proto: string;
  close: () => Promise<void>;
}

export interface FakeSecureGrpcServer extends FakeGrpcServer {
  cert: Buffer;
}

function paymentServiceImplementation() {
  return {
    CreatePayment: (
      call: grpc.ServerUnaryCall<{ amount: string; customerId: string }, unknown>,
      callback: grpc.sendUnaryData<{ paymentId: string; status: string }>
    ) => {
      const initialMetadata = new grpc.Metadata();
      initialMetadata.set('x-request-id', 'req-abc-123');
      call.sendMetadata(initialMetadata);

      const trailer = new grpc.Metadata();
      trailer.set('x-trailer-only', 'trailer-value');
      callback(null, { paymentId: 'pay-123', status: 'CREATED' }, trailer);
    },
    GetPayment: (
      call: grpc.ServerUnaryCall<{ paymentId: string }, unknown>,
      callback: grpc.sendUnaryData<{ status: string }>
    ) => {
      callback(null, { status: 'SUCCESS' });
    },
  };
}

function loadPaymentServiceDefinition(): { dir: string; serviceDefinition: grpc.ServiceDefinition } {
  const dir = mkdtempSync(join(tmpdir(), 'fake-grpc-'));
  const protoPath = join(dir, 'test.proto');
  writeFileSync(protoPath, FAKE_PAYMENT_PROTO);

  const packageDefinition = protoLoader.loadSync(protoPath, {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
  });
  const packageObject = grpc.loadPackageDefinition(packageDefinition) as unknown as {
    test: { PaymentService: { service: grpc.ServiceDefinition } };
  };
  return { dir, serviceDefinition: packageObject.test.PaymentService.service };
}

export async function startFakePaymentGrpcServer(): Promise<FakeGrpcServer> {
  const { dir, serviceDefinition } = loadPaymentServiceDefinition();

  const server = new grpc.Server();
  server.addService(serviceDefinition, paymentServiceImplementation());

  const port = await new Promise<number>((resolve, reject) => {
    server.bindAsync('127.0.0.1:0', grpc.ServerCredentials.createInsecure(), (err, boundPort) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(boundPort);
    });
  });

  return {
    address: `127.0.0.1:${port}`,
    proto: FAKE_PAYMENT_PROTO,
    close: () =>
      new Promise<void>((resolve) => {
        server.tryShutdown(() => {
          rmSync(dir, { recursive: true, force: true });
          resolve();
        });
      }),
  };
}

export async function startFakeSecurePaymentGrpcServer(): Promise<FakeSecureGrpcServer> {
  const { dir, serviceDefinition } = loadPaymentServiceDefinition();
  const cert = readFileSync(join(FIXTURES_DIR, 'localhost-cert.pem'));
  const key = readFileSync(join(FIXTURES_DIR, 'localhost-key.pem'));

  const server = new grpc.Server();
  server.addService(serviceDefinition, paymentServiceImplementation());

  // Bound and addressed via the "localhost" hostname, never an IP literal:
  // Node's TLS layer refuses to set the SNI servername to an IP address
  // (RFC 6066), so a client connecting to "127.0.0.1:<port>" over TLS would
  // always fail the handshake regardless of certificate validity. Real-world
  // TLS gRPC targets are hostnames for the same reason.
  const port = await new Promise<number>((resolve, reject) => {
    server.bindAsync(
      'localhost:0',
      grpc.ServerCredentials.createSsl(null, [{ private_key: key, cert_chain: cert }]),
      (err, boundPort) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(boundPort);
      }
    );
  });

  return {
    address: `localhost:${port}`,
    proto: FAKE_PAYMENT_PROTO,
    cert,
    close: () =>
      new Promise<void>((resolve) => {
        server.tryShutdown(() => {
          rmSync(dir, { recursive: true, force: true });
          resolve();
        });
      }),
  };
}
