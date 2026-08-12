import { describe, it, expect } from 'vitest';
import { getTransLogRequiredFields } from '../src/translog-required-fields.js';

describe('getTransLogRequiredFields', () => {
  it('returns the common fields alone when status is undefined', () => {
    const fields = getTransLogRequiredFields(undefined);
    expect(fields.length).toBeGreaterThan(0);
    expect(fields).toContain('appTransID');
  });

  it('returns the common fields alone when status does not match any known schema', () => {
    expect(getTransLogRequiredFields('SOME_UNKNOWN_STATUS')).toEqual(getTransLogRequiredFields(undefined));
  });

  it('returns a deduplicated union when status matches a known schema', () => {
    const fields = getTransLogRequiredFields('SUCCESS');
    expect(new Set(fields).size).toBe(fields.length);
    expect(fields).toEqual(expect.arrayContaining(getTransLogRequiredFields(undefined)));
  });
});
