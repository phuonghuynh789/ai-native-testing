import { describe, it, expect } from 'vitest';
import { parseCurl } from '../src/curl';

describe('parseCurl', () => {
  it('parses a simple GET command', () => {
    const result = parseCurl('curl https://api.example.com/x');
    expect(result).toEqual({
      ok: true,
      method: 'GET',
      url: 'https://api.example.com/x',
      headers: [],
      body: '',
    });
  });

  it('parses an explicit POST with a JSON body', () => {
    const result = parseCurl(`curl -X POST https://api.example.com/x -d '{"a":1}'`);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.method).toBe('POST');
    expect(result.url).toBe('https://api.example.com/x');
    expect(result.body).toBe('{"a":1}');
  });

  it('infers POST when -d is present without -X', () => {
    const result = parseCurl(`curl https://api.example.com/x -d '{"a":1}'`);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.method).toBe('POST');
  });

  it('parses multiple -H flags into separate header rows, preserving colons inside values', () => {
    const result = parseCurl(
      `curl https://api.example.com/x -H 'Content-Type: application/json' -H 'Authorization: Bearer abc:def'`
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.headers.map((h) => ({ key: h.key, value: h.value }))).toEqual([
      { key: 'Content-Type', value: 'application/json' },
      { key: 'Authorization', value: 'Bearer abc:def' },
    ]);
  });

  it('converts -u user:pass into a Basic Authorization header', () => {
    const result = parseCurl('curl https://api.example.com/x -u admin:secret');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.headers.map((h) => ({ key: h.key, value: h.value }))).toEqual([
      { key: 'Authorization', value: `Basic ${btoa('admin:secret')}` },
    ]);
  });

  it('joins backslash-newline continuations from a multi-line paste', () => {
    const result = parseCurl(
      `curl 'https://api.example.com/x' \\\n  -H 'Content-Type: application/json' \\\n  -d '{"a":1}'`
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.url).toBe('https://api.example.com/x');
    expect(result.body).toBe('{"a":1}');
  });

  it('uses only the last of multiple -d flags', () => {
    const result = parseCurl(`curl https://api.example.com/x -d 'first' -d 'second'`);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.body).toBe('second');
  });

  it('ignores unsupported flags like -F and --compressed without failing', () => {
    const result = parseCurl(`curl https://api.example.com/x -F 'file=@photo.png' --compressed`);
    expect(result).toEqual({
      ok: true,
      method: 'GET',
      url: 'https://api.example.com/x',
      headers: [],
      body: '',
    });
  });

  it('errors when the input does not start with curl', () => {
    const result = parseCurl('wget https://api.example.com/x');
    expect(result).toEqual({ ok: false, error: 'Command must start with "curl"' });
  });

  it('errors when no URL is present', () => {
    const result = parseCurl('curl -X POST');
    expect(result).toEqual({ ok: false, error: 'No URL found in command' });
  });

  it('errors on an unsupported method', () => {
    const result = parseCurl('curl -X HEAD https://api.example.com/x');
    expect(result).toEqual({ ok: false, error: 'Unsupported method: HEAD' });
  });
});
