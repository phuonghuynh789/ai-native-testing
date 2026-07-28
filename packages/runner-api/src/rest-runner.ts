import type { Runner, RunContext } from '@ai-native-testing/engine';
import { buildAuthHeaders, type AuthConfig } from './auth.js';
import { extractJsonPath } from './json-path.js';

interface RestResponse {
  status: number;
  headers: Record<string, string>;
  body: unknown;
}

interface RequestArgs {
  method: string;
  url: string;
  headers?: Record<string, string>;
  query?: Record<string, string>;
  body?: unknown;
  auth?: AuthConfig;
}

const LAST_RESPONSE_KEY = '__rest.lastResponse';
const DEFAULT_TIMEOUT_MS = 30_000;

export interface RestRunnerOptions {
  timeoutMs?: number;
}

export class RestRunner implements Runner {
  name = 'rest';
  private readonly timeoutMs: number;

  constructor(options?: RestRunnerOptions) {
    this.timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async interact(action: string, args: Record<string, unknown>, ctx: RunContext): Promise<void> {
    if (action !== 'request') {
      throw new Error(`RestRunner does not support interaction "${action}"`);
    }
    const response = await this.sendRequest(args as unknown as RequestArgs);
    ctx.remember(LAST_RESPONSE_KEY, response);
  }

  async ask(action: string, args: Record<string, unknown>, ctx: RunContext): Promise<unknown> {
    const response = ctx.get(LAST_RESPONSE_KEY) as RestResponse | undefined;
    if (!response) {
      throw new Error(`RestRunner "${action}" called before any "request" interaction`);
    }
    switch (action) {
      case 'status':
        return response.status;
      case 'header':
        return response.headers[String(args.name).toLowerCase()];
      case 'jsonPath':
        return extractJsonPath(response.body, String(args.path));
      case 'raw':
        return response;
      default:
        throw new Error(`RestRunner does not support question "${action}"`);
    }
  }

  private async sendRequest(args: RequestArgs): Promise<RestResponse> {
    const url = new URL(args.url);
    if (args.query) {
      for (const [key, value] of Object.entries(args.query)) {
        url.searchParams.set(key, value);
      }
    }

    const headers: Record<string, string> = { ...args.headers };
    if (args.auth) {
      Object.assign(headers, buildAuthHeaders(args.auth));
    }

    const hasBody = args.body !== undefined;
    if (hasBody && !Object.keys(headers).some((h) => h.toLowerCase() === 'content-type')) {
      headers['Content-Type'] = 'application/json';
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(url, {
        method: args.method,
        headers,
        body: hasBody ? JSON.stringify(args.body) : undefined,
        signal: controller.signal,
      });

      const responseHeaders: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        responseHeaders[key.toLowerCase()] = value;
      });

      const text = await response.text();
      let body: unknown = text;
      if (responseHeaders['content-type']?.includes('application/json') && text.length > 0) {
        body = JSON.parse(text);
      }

      return { status: response.status, headers: responseHeaders, body };
    } finally {
      clearTimeout(timeout);
    }
  }
}
