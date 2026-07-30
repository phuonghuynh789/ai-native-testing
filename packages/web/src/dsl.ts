import type { Step, TestDefinition } from '@ai-native-testing/engine';
import type { AuthConfig, FormState, KeyValueRow, SourceKind } from './types';

export const HIDDEN_RESPONSE_VARIABLE = '__response';

function rowsToRecord(rows: KeyValueRow[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const row of rows) {
    if (row.key.trim() !== '') {
      result[row.key] = row.value;
    }
  }
  return result;
}

function authToDsl(auth: AuthConfig): Record<string, unknown> | undefined {
  switch (auth.type) {
    case 'none':
      return undefined;
    case 'bearer':
      return { type: 'bearer', token: auth.token };
    case 'apiKey':
      return { type: 'apiKey', header: auth.header, value: auth.value };
    case 'basic':
      return { type: 'basic', username: auth.username, password: auth.password };
  }
}

function sourceToStepFields(
  source: SourceKind,
  path: string
): { action: string; with?: Record<string, unknown> } {
  switch (source) {
    case 'status':
      return { action: 'status' };
    case 'header':
      return { action: 'header', with: { name: path } };
    case 'jsonPath':
      return { action: 'jsonPath', with: { path } };
  }
}

function parseExpected(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

export function buildTaskSteps(form: FormState): Step[] {
  const requestWith: Record<string, unknown> = {
    method: form.method,
    url: form.url,
  };
  const params = rowsToRecord(form.params);
  if (Object.keys(params).length > 0) {
    requestWith.query = params;
  }
  const headers = rowsToRecord(form.headers);
  if (Object.keys(headers).length > 0) {
    requestWith.headers = headers;
  }
  const auth = authToDsl(form.auth);
  if (auth) {
    requestWith.auth = auth;
  }
  if (form.body.trim() !== '') {
    requestWith.body = JSON.parse(form.body);
  }

  return [
    { type: 'interaction', runner: 'rest', action: 'request', with: requestWith },
    { type: 'extract', runner: 'rest', action: 'raw', remember: HIDDEN_RESPONSE_VARIABLE },
    ...form.extracts.map((row): Step => {
      const { action, with: withFields } = sourceToStepFields(row.source, row.path);
      return { type: 'extract', runner: 'rest', action, with: withFields, remember: row.rememberAs };
    }),
    ...form.questions.map((row): Step => {
      const { action, with: withFields } = sourceToStepFields(row.source, row.path);
      return {
        type: 'question',
        runner: 'rest',
        action,
        with: withFields,
        expect: { equals: parseExpected(row.expected) },
      };
    }),
  ];
}

export function buildTestDefinition(form: FormState): TestDefinition {
  const variables = rowsToRecord(form.variables);

  return {
    actor: { name: form.actorName, abilities: ['rest'] },
    variables: Object.keys(variables).length > 0 ? variables : undefined,
    tasks: [{ name: form.taskName, steps: buildTaskSteps(form) }],
  };
}

export function buildFlowDefinition(forms: FormState[]): TestDefinition {
  const mergedVariables: Record<string, string> = {};
  for (const form of forms) {
    Object.assign(mergedVariables, rowsToRecord(form.variables));
  }

  return {
    actor: { name: forms[0].actorName, abilities: ['rest'] },
    variables: Object.keys(mergedVariables).length > 0 ? mergedVariables : undefined,
    tasks: forms.map((form) => ({ name: form.taskName, steps: buildTaskSteps(form) })),
  };
}
