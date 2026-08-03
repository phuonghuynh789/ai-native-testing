import type { KeyValueRow } from './types';
import { joinContinuations, tokenize } from './shellTokenize.js';

export type GrpcurlParseResult =
  | {
      ok: true;
      serverAddress: string;
      service: string;
      method: string;
      message: string;
      metadata: KeyValueRow[];
      secure: boolean;
      skipCertVerification: boolean;
    }
  | { ok: false; error: string };

export function parseGrpcurl(input: string): GrpcurlParseResult {
  const trimmed = input.trim();
  if (!trimmed.startsWith('grpcurl')) {
    return { ok: false, error: 'Command must start with "grpcurl"' };
  }

  const tokens = tokenize(joinContinuations(trimmed)).slice(1);

  let message: string | null = null;
  let plaintext = false;
  let insecure = false;
  const metadata: KeyValueRow[] = [];
  const positional: string[] = [];

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
      case '-d':
      case '--data':
        message = takeValue();
        break;
      case '-H':
      case '--header':
      case '--rpc-header': {
        const headerValue = takeValue();
        const colon = headerValue.indexOf(':');
        if (colon !== -1) {
          metadata.push({
            id: crypto.randomUUID(),
            key: headerValue.slice(0, colon).trim(),
            value: headerValue.slice(colon + 1).trim(),
          });
        }
        break;
      }
      case '-proto':
      case '--proto':
        takeValue();
        break;
      case '-plaintext':
      case '--plaintext':
        plaintext = true;
        break;
      case '-insecure':
      case '--insecure':
        insecure = true;
        break;
      default:
        if (!token.startsWith('-')) {
          positional.push(inlineValue ?? token);
        }
        break;
    }
  }

  if (positional.length < 2) {
    return { ok: false, error: 'Command must include an address and a package.Service/Method' };
  }

  const serverAddress = positional[positional.length - 2];
  const symbol = positional[positional.length - 1];
  const slash = symbol.indexOf('/');
  if (slash === -1) {
    return { ok: false, error: `Could not parse service/method from "${symbol}"` };
  }
  const servicePath = symbol.slice(0, slash);
  const method = symbol.slice(slash + 1);
  const lastDot = servicePath.lastIndexOf('.');
  const service = lastDot === -1 ? servicePath : servicePath.slice(lastDot + 1);

  const secure = !plaintext;
  const skipCertVerification = secure && insecure;
  return { ok: true, serverAddress, service, method, message: message ?? '', metadata, secure, skipCertVerification };
}
