import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export class NameListStore {
  constructor(private readonly filePath: string) {}

  async list(): Promise<string[]> {
    try {
      const contents = await readFile(this.filePath, 'utf8');
      return JSON.parse(contents) as string[];
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        await this.write([]);
        return [];
      }
      throw err;
    }
  }

  async add(name: string): Promise<string[]> {
    const names = await this.list();
    if (!names.includes(name)) {
      names.push(name);
      await this.write(names);
    }
    return names;
  }

  private async write(names: string[]): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify(names, null, 2));
  }
}
