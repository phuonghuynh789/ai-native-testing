import { parseArgs } from 'node:util';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCapture } from './baseline-capture-core.js';
import { writeBaseline } from './write-baseline.js';
import type { KafkaTopicKey } from '@ai-native-testing/server/src/kafka-check-definitions.js';

const { values } = parseArgs({
  options: {
    step: { type: 'string' },
    version: { type: 'string' },
    topic: { type: 'string' },
    'server-url': { type: 'string', default: 'http://localhost:3000' },
    'kafka-config': { type: 'string' },
    'idle-timeout-ms': { type: 'string', default: '15000' },
    'baselines-dir': { type: 'string' },
  },
});

if (!values.step || !values.version || !values.topic) {
  console.error(
    'Usage: capture-baseline.ts --step <name> --version <version> --topic <transLogV1|refundLog|paymentAuth>'
  );
  process.exit(1);
}

const kafkaConfigPath =
  values['kafka-config'] ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'server', 'config', 'kafka.yaml');

const result = await runCapture({
  serverUrl: values['server-url']!,
  kafkaConfigPath,
  stepName: values.step,
  topic: values.topic as KafkaTopicKey,
  idleTimeoutMs: Number(values['idle-timeout-ms']),
  terminalStatuses: ['SUCCESS', 'FAILED', 'PENDING'],
});

const path = await writeBaseline(result, {
  version: values.version,
  allowOverwrite: false,
  baselinesDir: values['baselines-dir'],
});
console.log(`Baseline written to ${path}`);
