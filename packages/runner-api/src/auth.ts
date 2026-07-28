export type AuthConfig =
  | { type: 'bearer'; token: string }
  | { type: 'apiKey'; header: string; value: string }
  | { type: 'basic'; username: string; password: string };

export function buildAuthHeaders(auth: AuthConfig): Record<string, string> {
  switch (auth.type) {
    case 'bearer':
      return { Authorization: `Bearer ${auth.token}` };
    case 'apiKey':
      return { [auth.header]: auth.value };
    case 'basic': {
      const encoded = Buffer.from(`${auth.username}:${auth.password}`).toString('base64');
      return { Authorization: `Basic ${encoded}` };
    }
  }
}
