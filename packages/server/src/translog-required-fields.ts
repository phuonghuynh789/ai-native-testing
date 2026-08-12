import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

interface TransLogSchema {
  common_fields: { required_fields: string[] };
  schemas_by_status: Record<string, { required_fields: string[] }>;
}

const SCHEMA_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'config',
  'translog_required_fields_schema.json'
);

const SCHEMA: TransLogSchema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8'));

export function getTransLogRequiredFields(status: string | undefined): string[] {
  const statusFields = (status !== undefined ? SCHEMA.schemas_by_status[status]?.required_fields : undefined) ?? [];
  return [...new Set([...SCHEMA.common_fields.required_fields, ...statusFields])];
}
