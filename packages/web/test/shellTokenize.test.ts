import { describe, it, expect } from 'vitest';
import { joinContinuations, tokenize } from '../src/shellTokenize';

describe('joinContinuations', () => {
  it('joins a backslash-newline continuation into a single space', () => {
    expect(joinContinuations('foo\\\nbar')).toBe('foo bar');
  });

  it('leaves a string with no continuations unchanged', () => {
    expect(joinContinuations('foo bar')).toBe('foo bar');
  });
});

describe('tokenize', () => {
  it('splits on whitespace', () => {
    expect(tokenize('foo bar baz')).toEqual(['foo', 'bar', 'baz']);
  });

  it('keeps single-quoted content literal, including spaces', () => {
    expect(tokenize(`foo 'bar baz'`)).toEqual(['foo', 'bar baz']);
  });

  it('keeps double-quoted content literal, including spaces', () => {
    expect(tokenize(`foo "bar baz"`)).toEqual(['foo', 'bar baz']);
  });

  it('unescapes an escaped single quote inside a single-quoted token', () => {
    expect(tokenize(`'it\\'s here'`)).toEqual(["it's here"]);
  });

  it('unescapes an escaped double quote inside a double-quoted token', () => {
    expect(tokenize(`"say \\"hi\\""`)).toEqual(['say "hi"']);
  });
});
