import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export type KafkaCheckStatus = 'pending' | 'received' | 'passed' | 'failed';

export interface KafkaCheckRow {
  message_id: string;
  name: string;
  topic: string;
  status: KafkaCheckStatus;
  missingFields: string[];
  matchedMessage: unknown;
  created_at: string;
  updated_at: string;
  retry_count: number;
}

export class KafkaCheckStore {
  constructor(private readonly filePath: string) {}

  async list(): Promise<KafkaCheckRow[]> {
    const map = await this.readMap();
    return Object.values(map).sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
  }

  async get(messageId: string): Promise<KafkaCheckRow | undefined> {
    const map = await this.readMap();
    return map[messageId];
  }

  async create(row: KafkaCheckRow): Promise<void> {
    const map = await this.readMap();
    map[row.message_id] = row;
    await this.write(map);
  }

  async update(messageId: string, patch: Partial<KafkaCheckRow>): Promise<KafkaCheckRow | undefined> {
    const map = await this.readMap();
    const existing = map[messageId];
    if (!existing) {
      return undefined;
    }
    const updated: KafkaCheckRow = { ...existing, ...patch, updated_at: new Date().toISOString() };
    map[messageId] = updated;
    await this.write(map);
    return updated;
  }

  private async readMap(): Promise<Record<string, KafkaCheckRow>> {
    try {
      const contents = await readFile(this.filePath, 'utf8');
      return JSON.parse(contents) as Record<string, KafkaCheckRow>;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        await this.write({});
        return {};
      }
      throw err;
    }
  }

  private async write(map: Record<string, KafkaCheckRow>): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify(map, null, 2));
  }
}
