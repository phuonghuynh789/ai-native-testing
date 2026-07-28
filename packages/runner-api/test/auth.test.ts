import { describe, it, expect } from 'vitest';
import { buildAuthHeaders } from '../src/auth.js';

describe('buildAuthHeaders', () => {
  it('builds a Bearer authorization header', () => {
    expect(buildAuthHeaders({ type: 'bearer', token: 'abc123' })).toEqual({
      Authorization: 'Bearer abc123',
    });
  });

  it('builds an API key header using the given header name', () => {
    expect(buildAuthHeaders({ type: 'apiKey', header: 'X-API-Key', value: 'secret' })).toEqual({
      'X-API-Key': 'secret',
    });
  });

  it('builds a Basic authorization header from username and password', () => {
    const headers = buildAuthHeaders({ type: 'basic', username: 'alice', password: 'hunter2' });
    expect(headers.Authorization).toBe(`Basic ${Buffer.from('alice:hunter2').toString('base64')}`);
  });
});
