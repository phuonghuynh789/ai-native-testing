import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface ServiceDefinition {
  service: string;
  methods: string[];
}

interface ServiceLikeConstructor {
  service?: Record<string, unknown>;
}

export function loadPackageDefinition(protoContent: string): grpc.GrpcObject {
  const dir = mkdtempSync(join(tmpdir(), 'grpc-proto-'));
  const filePath = join(dir, 'service.proto');
  writeFileSync(filePath, protoContent);
  try {
    const packageDefinition = protoLoader.loadSync(filePath, {
      keepCase: true,
      longs: String,
      enums: String,
      defaults: true,
      oneofs: true,
    });
    return grpc.loadPackageDefinition(packageDefinition);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function walk(
  node: grpc.GrpcObject,
  visit: (key: string, ctor: ServiceLikeConstructor) => boolean
): boolean {
  for (const [key, value] of Object.entries(node)) {
    const ctor = value as unknown as ServiceLikeConstructor;
    if (typeof value === 'function' && ctor.service) {
      if (visit(key, ctor)) {
        return true;
      }
      continue;
    }
    if (typeof value === 'object' && value !== null) {
      if (walk(value as grpc.GrpcObject, visit)) {
        return true;
      }
    }
  }
  return false;
}

export function listServices(protoContent: string): ServiceDefinition[] {
  const packageObject = loadPackageDefinition(protoContent);
  const results: ServiceDefinition[] = [];
  walk(packageObject, (key, ctor) => {
    results.push({ service: key, methods: Object.keys(ctor.service ?? {}) });
    return false;
  });
  return results;
}

export function findService(protoContent: string, serviceName: string): grpc.ServiceClientConstructor {
  const packageObject = loadPackageDefinition(protoContent);
  let found: grpc.ServiceClientConstructor | undefined;
  walk(packageObject, (key, ctor) => {
    if (key === serviceName) {
      found = ctor as unknown as grpc.ServiceClientConstructor;
      return true;
    }
    return false;
  });
  if (!found) {
    throw new Error(`Service "${serviceName}" not found in proto`);
  }
  return found;
}
