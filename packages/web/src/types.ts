export interface KeyValueRow {
  id: string;
  key: string;
  value: string;
}

export type SourceKind = 'status' | 'header' | 'jsonPath';

export interface ExtractRow {
  id: string;
  source: SourceKind;
  path: string;
  rememberAs: string;
}

export interface QuestionRow {
  id: string;
  source: SourceKind;
  path: string;
  expected: string;
}

export type AuthConfig =
  | { type: 'none' }
  | { type: 'bearer'; token: string }
  | { type: 'apiKey'; header: string; value: string }
  | { type: 'basic'; username: string; password: string };

export type Protocol = 'rest' | 'grpc';

export type KafkaTopic = 'transLogV1' | 'refundLog' | 'paymentAuth';

export const KAFKA_TOPICS: KafkaTopic[] = ['transLogV1', 'refundLog', 'paymentAuth'];

export interface KafkaCheckFormState {
  enabled: boolean;
  topic: KafkaTopic;
}

export interface GrpcFormState {
  protoContent: string;
  protoFilename: string;
  serverAddress: string;
  service: string;
  method: string;
  requestMessage: string;
  metadata: KeyValueRow[];
  secure: boolean;
  skipCertVerification: boolean;
}

export interface FormState {
  actorName: string;
  taskName: string;
  variables: KeyValueRow[];
  protocol: Protocol;
  method: string;
  url: string;
  params: KeyValueRow[];
  headers: KeyValueRow[];
  auth: AuthConfig;
  body: string;
  grpc: GrpcFormState;
  extracts: ExtractRow[];
  questions: QuestionRow[];
  kafkaCheck: KafkaCheckFormState;
  afterResponse: KeyValueRow[];
}
