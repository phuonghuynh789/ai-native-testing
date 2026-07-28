import { describe, it, expect } from 'vitest';
import { validateTestDefinition } from '../src/schema.js';

const validDefinition = {
  actor: { name: 'Authenticated Customer', abilities: ['log'] },
  tasks: [
    {
      name: 'Create Payment',
      steps: [
        { type: 'interaction', runner: 'log', action: 'log', with: { message: 'creating payment' } },
        { type: 'question', runner: 'log', action: 'echo', with: { value: 201 }, expect: { equals: 201 }, remember: 'statusCode' },
        { type: 'question', runner: 'log', action: 'echo', with: { value: '${statusCode}' }, expect: { equals: 201 } },
      ],
    },
  ],
};

describe('validateTestDefinition', () => {
  it('accepts a well-formed test definition', () => {
    expect(validateTestDefinition(validDefinition)).toEqual({ valid: true });
  });

  it('rejects a definition missing the actor field', () => {
    const { actor, ...withoutActor } = validDefinition;
    const result = validateTestDefinition(withoutActor);
    expect(result.valid).toBe(false);
    expect(result.errors?.length).toBeGreaterThan(0);
  });

  it('rejects an interaction step missing the action field', () => {
    const invalid = {
      actor: validDefinition.actor,
      tasks: [{ name: 'Bad', steps: [{ type: 'interaction', runner: 'log', with: {} }] }],
    };
    expect(validateTestDefinition(invalid).valid).toBe(false);
  });

  it('rejects a question step missing the expect field', () => {
    const invalid = {
      actor: validDefinition.actor,
      tasks: [{ name: 'Bad', steps: [{ type: 'question', runner: 'log', action: 'echo', with: {} }] }],
    };
    expect(validateTestDefinition(invalid).valid).toBe(false);
  });

  it('accepts a definition with a nested task step', () => {
    const nested = {
      actor: validDefinition.actor,
      tasks: [
        {
          name: 'Outer',
          steps: [
            {
              type: 'task',
              name: 'Inner',
              steps: [{ type: 'interaction', runner: 'log', action: 'log', with: { message: 'nested' } }],
            },
          ],
        },
      ],
    };
    expect(validateTestDefinition(nested)).toEqual({ valid: true });
  });

  it('accepts a definition with a variables field', () => {
    const withVariables = {
      ...validDefinition,
      variables: { baseUrl: 'https://api.example.com' },
    };
    expect(validateTestDefinition(withVariables)).toEqual({ valid: true });
  });

  it('accepts an extract step', () => {
    const withExtract = {
      actor: validDefinition.actor,
      tasks: [
        {
          name: 'T',
          steps: [{ type: 'extract', runner: 'log', action: 'echo', with: { value: 1 }, remember: 'x' }],
        },
      ],
    };
    expect(validateTestDefinition(withExtract)).toEqual({ valid: true });
  });

  it('rejects an extract step missing the remember field', () => {
    const invalid = {
      actor: validDefinition.actor,
      tasks: [{ name: 'T', steps: [{ type: 'extract', runner: 'log', action: 'echo', with: {} }] }],
    };
    expect(validateTestDefinition(invalid).valid).toBe(false);
  });
});
