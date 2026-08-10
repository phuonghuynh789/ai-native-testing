import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export interface StepSummary {
  name: string;
  protocol: string;
  method: string;
  url: string;
  grpcService: string;
  grpcMethod: string;
}

function toStepSummary(name: string, content: unknown): StepSummary {
  const record = (content ?? {}) as Record<string, unknown>;
  const grpc = (record.grpc ?? {}) as Record<string, unknown>;
  return {
    name,
    protocol: typeof record.protocol === 'string' ? record.protocol : '',
    method: typeof record.method === 'string' ? record.method : '',
    url: typeof record.url === 'string' ? record.url : '',
    grpcService: typeof grpc.service === 'string' ? grpc.service : '',
    grpcMethod: typeof grpc.method === 'string' ? grpc.method : '',
  };
}

export class StepStore {
  constructor(private readonly filePath: string) {}

  async list(): Promise<string[]> {
    return Object.keys(await this.readMap());
  }

  async get(name: string): Promise<unknown | undefined> {
    const map = await this.readMap();
    return map[name];
  }

  async save(name: string, content: unknown): Promise<string[]> {
    const map = await this.readMap();
    map[name] = content;
    await this.write(map);
    return Object.keys(map);
  }

  async delete(name: string): Promise<string[] | undefined> {
    const map = await this.readMap();
    if (!(name in map)) {
      return undefined;
    }
    delete map[name];
    await this.write(map);
    return Object.keys(map);
  }

  async search(query: string, page: number, pageSize: number): Promise<{ items: StepSummary[]; total: number }> {
    const map = await this.readMap();
    const lowerQuery = query.toLowerCase();
    const matchingNames = Object.keys(map).filter((name) => name.toLowerCase().includes(lowerQuery));
    const total = matchingNames.length;
    const start = (page - 1) * pageSize;
    const pageNames = matchingNames.slice(start, start + pageSize);
    const items = pageNames.map((name) => toStepSummary(name, map[name]));
    return { items, total };
  }

  private async readMap(): Promise<Record<string, unknown>> {
    try {
      const contents = await readFile(this.filePath, 'utf8');
      return JSON.parse(contents) as Record<string, unknown>;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        await this.write({});
        return {};
      }
      throw err;
    }
  }

  private async write(map: Record<string, unknown>): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify(map, null, 2));
  }
}
