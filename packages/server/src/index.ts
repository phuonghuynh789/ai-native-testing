import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApp, DEFAULT_DATA_DIR } from './app.js';
import { loadKafkaConfig } from './kafka-config.js';
import { KafkaCheckStore } from './kafka-check-store.js';
import { startKafkaConsumers } from './kafka-consumer.js';

const app = buildApp();
const port = Number(process.env.PORT ?? 3000);

app.listen({ port, host: '0.0.0.0' }).then(() => {
  app.log.info(`server listening on port ${port}`);
});

const kafkaConfigPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'config', 'kafka.yaml');
const kafkaConfig = loadKafkaConfig(kafkaConfigPath);
if (kafkaConfig) {
  const kafkaCheckStore = new KafkaCheckStore(join(DEFAULT_DATA_DIR, 'kafka-checks.json'));
  startKafkaConsumers(kafkaConfig, kafkaCheckStore).catch((err) => {
    app.log.error(err, 'Failed to start Kafka consumers');
  });
} else {
  app.log.warn('Kafka check config not found at config/kafka.yaml — Check Kafka feature disabled');
}
