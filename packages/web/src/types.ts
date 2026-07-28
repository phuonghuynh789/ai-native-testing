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

export interface FormState {
  actorName: string;
  taskName: string;
  variables: KeyValueRow[];
  method: string;
  url: string;
  params: KeyValueRow[];
  headers: KeyValueRow[];
  auth: AuthConfig;
  body: string;
  extracts: ExtractRow[];
  questions: QuestionRow[];
}
