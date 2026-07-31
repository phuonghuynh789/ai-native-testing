import type { KeyValueRow } from './types';
import { joinContinuations, tokenize } from './shellTokenize.js';

export type CurlParseResult =
  | { ok: true; method: string; url: string; headers: KeyValueRow[]; body: string }
  | { ok: false; error: string };

const SUPPORTED_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
const IGNORED_VALUE_FLAGS = new Set(['-F', '--form', '-A', '--user-agent']);

export function parseCurl(input: string): CurlParseResult {
  const trimmed = input.trim();
  if (!trimmed.startsWith('curl')) {
    return { ok: false, error: 'Command must start with "curl"' };
  }

  const tokens = tokenize(joinContinuations(trimmed)).slice(1);

  let explicitMethod: string | null = null;
  let url: string | null = null;
  const headers: KeyValueRow[] = [];
  let body: string | null = null;
  let userPass: string | null = null;

  for (let i = 0; i < tokens.length; i += 1) {
    let token = tokens[i];
    let inlineValue: string | null = null;

    if (token.startsWith('--')) {
      const eq = token.indexOf('=');
      if (eq !== -1) {
        inlineValue = token.slice(eq + 1);
        token = token.slice(0, eq);
      }
    }

    const takeValue = (): string => {
      if (inlineValue !== null) {
        return inlineValue;
      }
      i += 1;
      return tokens[i] ?? '';
    };

    switch (token) {
      case '-X':
      case '--request':
        explicitMethod = takeValue().toUpperCase();
        break;
      case '-H':
      case '--header': {
        const headerValue = takeValue();
        const colon = headerValue.indexOf(':');
        if (colon !== -1) {
          headers.push({
            id: crypto.randomUUID(),
            key: headerValue.slice(0, colon).trim(),
            value: headerValue.slice(colon + 1).trim(),
          });
        }
        break;
      }
      case '-d':
      case '--data':
      case '--data-raw':
      case '--data-binary':
      case '--data-ascii':
        body = takeValue();
        break;
      case '-u':
      case '--user':
        userPass = takeValue();
        break;
      case '-b':
      case '--cookie':
        headers.push({ id: crypto.randomUUID(), key: 'Cookie', value: takeValue() });
        break;
      case '--url':
        url = takeValue();
        break;
      default:
        if (IGNORED_VALUE_FLAGS.has(token)) {
          takeValue();
        } else if (!token.startsWith('-') && url === null) {
          url = inlineValue ?? token;
        }
        break;
    }
  }

  if (url === null || url === '') {
    return { ok: false, error: 'No URL found in command' };
  }

  const method = explicitMethod ?? (body !== null ? 'POST' : 'GET');
  if (!SUPPORTED_METHODS.includes(method)) {
    return { ok: false, error: `Unsupported method: ${method}` };
  }

  if (userPass !== null) {
    headers.push({
      id: crypto.randomUUID(),
      key: 'Authorization',
      value: `Basic ${btoa(userPass)}`,
    });
  }

  return { ok: true, method, url, headers, body: body ?? '' };
}
