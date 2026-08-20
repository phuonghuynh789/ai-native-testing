import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApp, DEFAULT_DATA_DIR } from './app.js';
import { loadKafkaConfig } from './kafka-config.js';
import { KafkaCheckStore } from './kafka-check-store.js';
import { startKafkaConsumers } from './kafka-consumer.js';
import { loadJiraConfig } from './jira-config.js';

const kafkaConfigPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'config', 'kafka.yaml');
const kafkaConfig = loadKafkaConfig(kafkaConfigPath);

const jiraConfigPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'config', 'jira.yaml');
const jiraConfig = loadJiraConfig(jiraConfigPath);

const app = buildApp({ kafkaConfig, jiraConfig });
const port = Number(process.env.PORT ?? 3000);

app.listen({ port, host: '0.0.0.0' }).then(() => {
  app.log.info(`server listening on port ${port}`);
});

if (kafkaConfig) {
  const kafkaCheckStore = new KafkaCheckStore(join(DEFAULT_DATA_DIR, 'kafka-checks.json'));
  startKafkaConsumers(kafkaConfig, kafkaCheckStore).catch((err) => {
    app.log.error(err, 'Failed to start Kafka consumers');
  });
} else {
  app.log.warn('Kafka check config not found at config/kafka.yaml — Check Kafka feature disabled');
}

if (!jiraConfig) {
  app.log.warn('Jira config not found at config/jira.yaml — Sprint Report feature disabled');
}
