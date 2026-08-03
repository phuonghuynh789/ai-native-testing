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

function buildRestRequestWith(form: FormState): Record<string, unknown> {
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
  return requestWith;
}

function buildInteractionStep(form: FormState): Step {
  if (form.protocol === 'grpc') {
    return {
      type: 'interaction',
      runner: 'grpc',
      action: 'call',
      with: {
        proto: form.grpc.protoContent,
        serverAddress: form.grpc.serverAddress,
        service: form.grpc.service,
        method: form.grpc.method,
        message: form.grpc.requestMessage.trim() === '' ? {} : JSON.parse(form.grpc.requestMessage),
        metadata: rowsToRecord(form.grpc.metadata),
        secure: form.grpc.secure,
        skipCertVerification: form.grpc.skipCertVerification,
      },
    };
  }
  return { type: 'interaction', runner: 'rest', action: 'request', with: buildRestRequestWith(form) };
}

export function buildTaskSteps(form: FormState): Step[] {
  const runner = form.protocol === 'grpc' ? 'grpc' : 'rest';
  return [
    buildInteractionStep(form),
    { type: 'extract', runner, action: 'raw', remember: HIDDEN_RESPONSE_VARIABLE },
    ...form.extracts.map((row): Step => {
      const { action, with: withFields } = sourceToStepFields(row.source, row.path);
      return { type: 'extract', runner, action, with: withFields, remember: row.rememberAs };
    }),
    ...form.questions.map((row): Step => {
      const { action, with: withFields } = sourceToStepFields(row.source, row.path);
      return {
        type: 'question',
        runner,
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
    actor: { name: form.actorName, abilities: [form.protocol] },
    variables: Object.keys(variables).length > 0 ? variables : undefined,
    tasks: [{ name: form.taskName, steps: buildTaskSteps(form) }],
  };
}

export function buildFlowDefinition(forms: FormState[]): TestDefinition {
  const mergedVariables: Record<string, string> = {};
  for (const form of forms) {
    Object.assign(mergedVariables, rowsToRecord(form.variables));
  }
  const abilities = Array.from(new Set(forms.map((form) => form.protocol)));

  return {
    actor: { name: forms[0].actorName, abilities },
    variables: Object.keys(mergedVariables).length > 0 ? mergedVariables : undefined,
    tasks: forms.map((form) => ({ name: form.taskName, steps: buildTaskSteps(form) })),
  };
}
