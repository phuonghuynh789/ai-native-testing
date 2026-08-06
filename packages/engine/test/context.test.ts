import { describe, it, expect } from 'vitest';
import { RunContext } from '../src/context.js';

describe('RunContext', () => {
  it('returns undefined for a variable that was never remembered', () => {
    const ctx = new RunContext();
    expect(ctx.get('missing')).toBeUndefined();
  });

  it('remembers and retrieves a variable', () => {
    const ctx = new RunContext();
    ctx.remember('paymentId', 'pay_123');
    expect(ctx.get('paymentId')).toBe('pay_123');
  });

  it('resolves a plain string unchanged', () => {
    const ctx = new RunContext();
    expect(ctx.resolve('hello')).toBe('hello');
  });

  it('resolves a ${var} reference to the remembered value', () => {
    const ctx = new RunContext();
    ctx.remember('statusCode', 201);
    expect(ctx.resolve('${statusCode}')).toBe(201);
  });

  it('resolves ${var} references inside nested objects and arrays', () => {
    const ctx = new RunContext();
    ctx.remember('paymentId', 'pay_123');
    const resolved = ctx.resolve({
      body: { id: '${paymentId}' },
      tags: ['${paymentId}', 'static'],
    });
    expect(resolved).toEqual({
      body: { id: 'pay_123' },
      tags: ['pay_123', 'static'],
    });
  });

  it('resolves an unset ${var} reference to undefined', () => {
    const ctx = new RunContext();
    expect(ctx.resolve('${missing}')).toBeUndefined();
  });

  it('resolves ${var} embedded within a larger string, coercing to string', () => {
    const ctx = new RunContext();
    ctx.remember('baseUrl', 'https://api.example.com');
    expect(ctx.resolve('${baseUrl}/login')).toBe('https://api.example.com/login');
  });

  it('resolves multiple ${var} references embedded within one string', () => {
    const ctx = new RunContext();
    ctx.remember('baseUrl', 'https://api.example.com');
    ctx.remember('paymentId', 'pay_123');
    expect(ctx.resolve('${baseUrl}/v1/payments/${paymentId}')).toBe(
      'https://api.example.com/v1/payments/pay_123'
    );
  });

  it('still returns the raw, non-stringified value when the whole string is a single ${var}', () => {
    const ctx = new RunContext();
    ctx.remember('amount', 49.99);
    expect(ctx.resolve('${amount}')).toBe(49.99);
  });

  it('resolves a ${var.path} reference into a nested property', () => {
    const ctx = new RunContext();
    ctx.remember('response', { body: { foo: 'bar' } });
    expect(ctx.resolve('${response.body.foo}')).toBe('bar');
  });

  it('resolves a ${var.path[0].more} reference with array indexing', () => {
    const ctx = new RunContext();
    ctx.remember('response', { body: { items: [{ id: 'a' }, { id: 'b' }] } });
    expect(ctx.resolve('${response.body.items[1].id}')).toBe('b');
  });

  it('resolves a ${var.path} reference embedded within a larger string', () => {
    const ctx = new RunContext();
    ctx.remember('response', { body: { token: 'abc123' } });
    expect(ctx.resolve('Bearer ${response.body.token}')).toBe('Bearer abc123');
  });

  it('throws when a ${var.path} reference does not resolve to a value', () => {
    const ctx = new RunContext();
    ctx.remember('response', { body: {} });
    expect(() => ctx.resolve('${response.body.missing}')).toThrow(/did not resolve to a value/);
  });
});
