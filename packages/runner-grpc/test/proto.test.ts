import { describe, it, expect } from 'vitest';
import { listServices, findService } from '../src/proto.js';

const SAMPLE_PROTO = `
syntax = "proto3";
package payment;

message CreatePaymentRequest {
  string amount = 1;
}

message CreatePaymentResponse {
  string paymentId = 1;
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

describe('listServices', () => {
  it('enumerates the service and its methods from the proto content', () => {
    const services = listServices(SAMPLE_PROTO);
    expect(services).toEqual([{ service: 'PaymentService', methods: ['CreatePayment', 'GetPayment'] }]);
  });

  it('throws a clear error for malformed proto content', () => {
    expect(() => listServices('not a valid proto file')).toThrow();
  });
});

describe('findService', () => {
  it('locates a service by its bare name even though the proto declares a package', () => {
    const ServiceCtor = findService(SAMPLE_PROTO, 'PaymentService');
    expect(typeof ServiceCtor).toBe('function');
  });

  it('throws when no service matches the given name', () => {
    expect(() => findService(SAMPLE_PROTO, 'Missing')).toThrow('Service "Missing" not found in proto');
  });
});
