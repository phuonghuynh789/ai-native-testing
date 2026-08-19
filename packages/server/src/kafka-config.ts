import { readFileSync } from 'node:fs';
import { load } from 'js-yaml';
import type { KafkaTopicKey } from './kafka-check-definitions.js';

export interface KafkaSaslConfig {
  mechanism: 'plain';
  username: string;
  password: string;
}

export interface KafkaTopicConfig {
  brokers: string[];
  topic: string;
  ssl?: boolean;
  sasl?: KafkaSaslConfig;
}

export interface KafkaConfig {
  groupID: string;
  topics: Record<KafkaTopicKey, KafkaTopicConfig>;
}

interface RawTopicConfig {
  brokers: string;
  topic: string;
  ssl?: boolean;
  sasl?: KafkaSaslConfig;
}

interface RawKafkaYaml {
  groupID: string;
  transLogV1: RawTopicConfig;
  refundLog: RawTopicConfig;
  paymentAuth: RawTopicConfig;
  disburseLog?: RawTopicConfig;
}

function toTopicConfig(raw: RawTopicConfig): KafkaTopicConfig {
  return {
    brokers: raw.brokers.split(',').map((broker) => broker.trim()),
    topic: raw.topic,
    ssl: raw.ssl,
    sasl: raw.sasl,
  };
}

export function loadKafkaConfig(filePath: string): KafkaConfig | undefined {
  let contents: string;
  try {
    contents = readFileSync(filePath, 'utf8');
  } catch {
    return undefined;
  }
  const raw = load(contents) as RawKafkaYaml;
  return {
    groupID: raw.groupID,
    topics: {
      transLogV1: toTopicConfig(raw.transLogV1),
      refundLog: toTopicConfig(raw.refundLog),
      paymentAuth: toTopicConfig(raw.paymentAuth),
    },
  };
}
