import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export interface FlowSummary {
  name: string;
  steps: string[];
}

export class FlowStore {
  constructor(private readonly filePath: string) {}

  async list(): Promise<string[]> {
    return Object.keys(await this.readMap());
  }

  async get(name: string): Promise<string[] | undefined> {
    const map = await this.readMap();
    return map[name];
  }

  async addStep(flowName: string, stepName: string): Promise<string[]> {
    const map = await this.readMap();
    const steps = map[flowName] ?? [];
    steps.push(stepName);
    map[flowName] = steps;
    await this.write(map);
    return Object.keys(map);
  }

  async setSteps(flowName: string, stepNames: string[]): Promise<string[]> {
    const map = await this.readMap();
    map[flowName] = stepNames;
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

  async search(query: string, page: number, pageSize: number): Promise<{ items: FlowSummary[]; total: number }> {
    const map = await this.readMap();
    const lowerQuery = query.toLowerCase();
    const matchingNames = Object.keys(map).filter((name) => name.toLowerCase().includes(lowerQuery));
    const total = matchingNames.length;
    const start = (page - 1) * pageSize;
    const pageNames = matchingNames.slice(start, start + pageSize);
    const items = pageNames.map((name) => ({ name, steps: map[name] }));
    return { items, total };
  }

  private async readMap(): Promise<Record<string, string[]>> {
    try {
      const contents = await readFile(this.filePath, 'utf8');
      return JSON.parse(contents) as Record<string, string[]>;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        await this.write({});
        return {};
      }
      throw err;
    }
  }

  private async write(map: Record<string, string[]>): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify(map, null, 2));
  }
}
