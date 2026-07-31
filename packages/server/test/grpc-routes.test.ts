import { describe, it, expect } from 'vitest';
import { buildApp } from '../src/app.js';

const SAMPLE_PROTO = `
syntax = "proto3";
package test;

message PingRequest {
  string message = 1;
}

message PingResponse {
  string reply = 1;
}

service PingService {
  rpc Ping (PingRequest) returns (PingResponse);
}
`;

describe('POST /grpc/introspect', () => {
  it('returns the services and methods discovered in a valid proto', async () => {
    const app = buildApp();
    const res = await app.inject({ method: 'POST', url: '/grpc/introspect', payload: { proto: SAMPLE_PROTO } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ services: [{ service: 'PingService', methods: ['Ping'] }] });
  });

  it('returns 400 for invalid proto content', async () => {
    const app = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/grpc/introspect',
      payload: { proto: 'not a valid proto file' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 for missing proto content', async () => {
    const app = buildApp();
    const res = await app.inject({ method: 'POST', url: '/grpc/introspect', payload: {} });
    expect(res.statusCode).toBe(400);
  });
});
