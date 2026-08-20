import { readFileSync } from 'node:fs';
import { load } from 'js-yaml';

export interface JiraConfig {
  baseUrl: string;
  token: string;
}

interface RawJiraYaml {
  baseUrl: string;
  token: string;
}

export function loadJiraConfig(filePath: string): JiraConfig | undefined {
  let contents: string;
  try {
    contents = readFileSync(filePath, 'utf8');
  } catch {
    return undefined;
  }
  const raw = load(contents) as RawJiraYaml;
  return { baseUrl: raw.baseUrl, token: raw.token };
}
