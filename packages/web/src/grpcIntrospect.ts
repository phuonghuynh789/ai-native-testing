export interface ServiceDefinition {
  service: string;
  methods: string[];
}

export async function introspectProto(protoContent: string): Promise<ServiceDefinition[] | undefined> {
  try {
    const response = await fetch('/grpc/introspect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ proto: protoContent }),
    });
    if (!response.ok) {
      return undefined;
    }
    const body = (await response.json()) as { services: ServiceDefinition[] };
    return body.services;
  } catch {
    return undefined;
  }
}
