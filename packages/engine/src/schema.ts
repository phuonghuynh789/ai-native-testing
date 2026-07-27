import { Ajv, type ErrorObject } from 'ajv';

const stepSchema = {
  $id: 'step',
  oneOf: [
    {
      type: 'object',
      required: ['type', 'runner', 'action'],
      additionalProperties: false,
      properties: {
        type: { const: 'interaction' },
        runner: { type: 'string' },
        action: { type: 'string' },
        with: { type: 'object' },
      },
    },
    {
      type: 'object',
      required: ['type', 'runner', 'action', 'expect'],
      additionalProperties: false,
      properties: {
        type: { const: 'question' },
        runner: { type: 'string' },
        action: { type: 'string' },
        with: { type: 'object' },
        expect: {
          type: 'object',
          required: ['equals'],
          additionalProperties: false,
          properties: { equals: {} },
        },
        remember: { type: 'string' },
      },
    },
    {
      type: 'object',
      required: ['type', 'name', 'steps'],
      additionalProperties: false,
      properties: {
        type: { const: 'task' },
        name: { type: 'string' },
        steps: { type: 'array', items: { $ref: 'step' } },
      },
    },
  ],
} as const;

const taskDefinitionSchema = {
  $id: 'taskDefinition',
  type: 'object',
  required: ['name', 'steps'],
  additionalProperties: false,
  properties: {
    name: { type: 'string' },
    steps: { type: 'array', minItems: 1, items: { $ref: 'step' } },
  },
} as const;

const testDefinitionSchema = {
  $id: 'testDefinition',
  type: 'object',
  required: ['actor', 'tasks'],
  additionalProperties: false,
  properties: {
    actor: {
      type: 'object',
      required: ['name', 'abilities'],
      additionalProperties: false,
      properties: {
        name: { type: 'string' },
        abilities: { type: 'array', items: { type: 'string' } },
      },
    },
    tasks: {
      type: 'array',
      minItems: 1,
      items: { $ref: 'taskDefinition' },
    },
  },
} as const;

const ajv = new Ajv({ allErrors: true, strict: false });
ajv.addSchema(stepSchema);
ajv.addSchema(taskDefinitionSchema);
const validateFn = ajv.compile(testDefinitionSchema);

export function validateTestDefinition(input: unknown): { valid: boolean; errors?: string[] } {
  const valid = validateFn(input);
  if (valid) {
    return { valid: true };
  }
  return { valid: false, errors: formatErrors(validateFn.errors) };
}

function formatErrors(errors: ErrorObject[] | null | undefined): string[] {
  return (errors ?? []).map((e) => `${e.instancePath || '(root)'} ${e.message}`);
}
