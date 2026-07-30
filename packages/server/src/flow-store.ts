import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

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
