import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { DiffReport } from './kafka-diff-engine.js';

export type KafkaContractCheckStatus = 'pending' | 'passed' | 'failed' | 'error';

export interface KafkaContractCheckRow {
  message_id: string;
  name: string;
  topic: string;
  version: string;
  status: KafkaContractCheckStatus;
  diffReport: DiffReport | null;
  errorMessage: string | null;
  created_at: string;
  updated_at: string;
}

export class KafkaContractCheckStore {
  constructor(private readonly filePath: string) {}

  async list(): Promise<KafkaContractCheckRow[]> {
    const map = await this.readMap();
    return Object.values(map).sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
  }

  async get(messageId: string): Promise<KafkaContractCheckRow | undefined> {
    const map = await this.readMap();
    return map[messageId];
  }

  async create(row: KafkaContractCheckRow): Promise<void> {
    const map = await this.readMap();
    map[row.message_id] = row;
    await this.write(map);
  }

  async update(
    messageId: string,
    patch: Partial<KafkaContractCheckRow>
  ): Promise<KafkaContractCheckRow | undefined> {
    const map = await this.readMap();
    const existing = map[messageId];
    if (!existing) {
      return undefined;
    }
    const updated: KafkaContractCheckRow = { ...existing, ...patch, updated_at: new Date().toISOString() };
    map[messageId] = updated;
    await this.write(map);
    return updated;
  }

  private async readMap(): Promise<Record<string, KafkaContractCheckRow>> {
    try {
      const contents = await readFile(this.filePath, 'utf8');
      return JSON.parse(contents) as Record<string, KafkaContractCheckRow>;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        await this.write({});
        return {};
      }
      throw err;
    }
  }

  private async write(map: Record<string, KafkaContractCheckRow>): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify(map, null, 2));
  }
}
