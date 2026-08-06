import type { StepResult } from '@ai-native-testing/engine';
import type { ExtractRow, KeyValueRow } from './types';

export interface RawResponse {
  status: number;
  headers: Record<string, string>;
  body: unknown;
}

export interface DerivedResults {
  response: RawResponse | null;
  savedValues: Record<string, unknown>;
  context: Record<string, unknown>;
  logs: string[];
}

const HIDDEN_RESPONSE_STEP_INDEX = 1;
const FIRST_EXTRACT_STEP_INDEX = 2;

export function deriveResults(
  extracts: ExtractRow[],
  afterResponse: KeyValueRow[],
  variables: Record<string, string>,
  stepResults: (StepResult | undefined)[]
): DerivedResults {
  const responseResult = stepResults[HIDDEN_RESPONSE_STEP_INDEX];
  const response = responseResult?.status === 'passed' ? (responseResult.actual as RawResponse) : null;

  const savedValues: Record<string, unknown> = {};
  extracts.forEach((row, index) => {
    const result = stepResults[FIRST_EXTRACT_STEP_INDEX + index];
    if (result?.status === 'passed') {
      savedValues[row.rememberAs] = result.actual;
    }
  });

  const nonBlankAfterResponse = afterResponse.filter((row) => row.key.trim() !== '');
  nonBlankAfterResponse.forEach((row, index) => {
    const result = stepResults[FIRST_EXTRACT_STEP_INDEX + extracts.length + index];
    if (result?.status === 'passed') {
      savedValues[row.key] = result.actual;
    }
  });

  const context: Record<string, unknown> = { ...variables, ...savedValues };

  const logs = stepResults
    .filter((_, index) => index !== HIDDEN_RESPONSE_STEP_INDEX)
    .filter((result): result is StepResult => result !== undefined)
    .map((result) => {
      const base = `${result.type} ${result.action} → ${result.status}`;
      if (result.status === 'failed') {
        return result.error
          ? `${base} (${result.error})`
          : `${base} (expected ${JSON.stringify(result.expected)}, got ${JSON.stringify(result.actual)})`;
      }
      return base;
    });

  return { response, savedValues, context, logs };
}
