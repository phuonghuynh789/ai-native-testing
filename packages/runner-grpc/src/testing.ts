import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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

export interface FakeGrpcServer {
  address: string;
  proto: string;
  close: () => Promise<void>;
}

export async function startFakePaymentGrpcServer(): Promise<FakeGrpcServer> {
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
  const paymentServiceDefinition = packageObject.test.PaymentService.service;

  const server = new grpc.Server();
  server.addService(paymentServiceDefinition, {
    CreatePayment: (
      call: grpc.ServerUnaryCall<{ amount: string; customerId: string }, unknown>,
      callback: grpc.sendUnaryData<{ paymentId: string; status: string }>
    ) => {
      callback(null, { paymentId: 'pay-123', status: 'CREATED' });
    },
    GetPayment: (
      call: grpc.ServerUnaryCall<{ paymentId: string }, unknown>,
      callback: grpc.sendUnaryData<{ status: string }>
    ) => {
      callback(null, { status: 'SUCCESS' });
    },
  });

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
