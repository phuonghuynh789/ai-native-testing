import { describe, it, expect } from 'vitest';
import { parseGrpcurl } from '../src/grpcurl';

describe('parseGrpcurl', () => {
  it('parses address, service, method, message, and metadata', () => {
    const result = parseGrpcurl(
      `grpcurl -plaintext -d '{"amount":"100"}' -H 'x-request-id: abc' localhost:50051 payment.PaymentService/CreatePayment`
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.serverAddress).toBe('localhost:50051');
    expect(result.service).toBe('PaymentService');
    expect(result.method).toBe('CreatePayment');
    expect(result.message).toBe('{"amount":"100"}');
    expect(result.metadata.map((m) => ({ key: m.key, value: m.value }))).toEqual([
      { key: 'x-request-id', value: 'abc' },
    ]);
  });

  it('strips the package prefix from the service, keeping the bare name', () => {
    const result = parseGrpcurl('grpcurl localhost:50051 payment.v1.PaymentService/CreatePayment');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.service).toBe('PaymentService');
  });

  it('handles a service with no package prefix', () => {
    const result = parseGrpcurl('grpcurl localhost:50051 PaymentService/CreatePayment');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.service).toBe('PaymentService');
  });

  it('ignores -proto and its value without treating the path as positional', () => {
    const result = parseGrpcurl(
      'grpcurl -proto payment.proto -plaintext localhost:50051 payment.PaymentService/CreatePayment'
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.serverAddress).toBe('localhost:50051');
  });

  it('supports multi-line continuations', () => {
    const result = parseGrpcurl(
      `grpcurl -plaintext \\\n  -d '{"amount":"100"}' \\\n  localhost:50051 payment.PaymentService/CreatePayment`
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.message).toBe('{"amount":"100"}');
  });

  it('errors when the input does not start with grpcurl', () => {
    const result = parseGrpcurl('curl localhost:50051');
    expect(result).toEqual({ ok: false, error: 'Command must start with "grpcurl"' });
  });

  it('errors when there are fewer than two positional arguments', () => {
    const result = parseGrpcurl('grpcurl -plaintext localhost:50051');
    expect(result).toEqual({
      ok: false,
      error: 'Command must include an address and a package.Service/Method',
    });
  });

  it('errors when the symbol has no slash', () => {
    const result = parseGrpcurl('grpcurl localhost:50051 PaymentService.CreatePayment');
    expect(result).toEqual({
      ok: false,
      error: 'Could not parse service/method from "PaymentService.CreatePayment"',
    });
  });

  it('defaults to secure with verification when neither -plaintext nor -insecure is present', () => {
    const result = parseGrpcurl('grpcurl localhost:50051 payment.PaymentService/CreatePayment');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.secure).toBe(true);
    expect(result.skipCertVerification).toBe(false);
  });

  it('sets secure to false when -plaintext is present', () => {
    const result = parseGrpcurl('grpcurl -plaintext localhost:50051 payment.PaymentService/CreatePayment');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.secure).toBe(false);
    expect(result.skipCertVerification).toBe(false);
  });

  it('sets secure true and skipCertVerification true when -insecure is present', () => {
    const result = parseGrpcurl('grpcurl -insecure localhost:50051 payment.PaymentService/CreatePayment');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.secure).toBe(true);
    expect(result.skipCertVerification).toBe(true);
  });

  it('lets -plaintext win when both -plaintext and -insecure are present', () => {
    const result = parseGrpcurl(
      'grpcurl -plaintext -insecure localhost:50051 payment.PaymentService/CreatePayment'
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.secure).toBe(false);
    expect(result.skipCertVerification).toBe(false);
  });
});
