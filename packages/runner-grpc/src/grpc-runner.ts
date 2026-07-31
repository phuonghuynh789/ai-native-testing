import * as grpc from '@grpc/grpc-js';
import { extractJsonPath, type Runner, type RunContext } from '@ai-native-testing/engine';
import { findService } from './proto.js';

interface GrpcCallArgs {
  proto: string;
  serverAddress: string;
  service: string;
  method: string;
  message: unknown;
  metadata?: Record<string, string>;
}

interface GrpcResponse {
  status: number;
  headers: Record<string, string>;
  body: unknown;
}

const LAST_RESPONSE_KEY = '__grpc.lastResponse';

export class GrpcRunner implements Runner {
  name = 'grpc';

  async interact(action: string, args: Record<string, unknown>, ctx: RunContext): Promise<void> {
    if (action !== 'call') {
      throw new Error(`GrpcRunner does not support interaction "${action}"`);
    }
    const response = await this.callUnary(args as unknown as GrpcCallArgs);
    ctx.remember(LAST_RESPONSE_KEY, response);
  }

  async ask(action: string, args: Record<string, unknown>, ctx: RunContext): Promise<unknown> {
    const response = ctx.get(LAST_RESPONSE_KEY) as GrpcResponse | undefined;
    if (!response) {
      throw new Error(`GrpcRunner "${action}" called before any "call" interaction`);
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
        throw new Error(`GrpcRunner does not support question "${action}"`);
    }
  }

  private async callUnary(args: GrpcCallArgs): Promise<GrpcResponse> {
    const ServiceCtor = findService(args.proto, args.service);
    const client = new ServiceCtor(args.serverAddress, grpc.credentials.createInsecure());

    const grpcMetadata = new grpc.Metadata();
    for (const [key, value] of Object.entries(args.metadata ?? {})) {
      grpcMetadata.set(key, value);
    }

    const method = (client as unknown as Record<string, unknown>)[args.method];
    if (typeof method !== 'function') {
      throw new Error(`Method "${args.method}" not found on service "${args.service}"`);
    }

    return new Promise((resolve) => {
      let status = grpc.status.OK;
      let body: unknown = null;

      const call = (method as (...callArgs: unknown[]) => grpc.ClientUnaryCall).call(
        client,
        args.message,
        grpcMetadata,
        (err: grpc.ServiceError | null, response: unknown) => {
          if (err) {
            status = err.code ?? grpc.status.UNKNOWN;
            body = err.details ?? null;
          } else {
            body = response;
          }
        }
      );

      call.on('status', (callStatus: grpc.StatusObject) => {
        const headers: Record<string, string> = {};
        for (const [key, value] of Object.entries(callStatus.metadata.getMap())) {
          headers[key.toLowerCase()] = String(value);
        }
        resolve({ status, headers, body });
      });
    });
  }
}
