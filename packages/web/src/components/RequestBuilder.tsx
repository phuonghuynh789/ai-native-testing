import { useEffect, useState } from 'react';
import {
  KAFKA_TOPICS,
  type AuthConfig,
  type ExtractRow,
  type GrpcFormState,
  type KafkaCheckFormState,
  type KeyValueRow,
  type Protocol,
  type QuestionRow,
} from '../types';
import { KeyValueRows } from './KeyValueRows';
import { ExtractEditor } from './ExtractEditor';
import { QuestionsEditor } from './QuestionsEditor';
import { CurlImport } from './CurlImport';
import { PasteGrpcurlPanel } from './PasteGrpcurlPanel';
import { introspectProto, type ServiceDefinition } from '../grpcIntrospect';

export interface RequestBuilderProps {
  protocol: Protocol;
  onProtocolChange: (protocol: Protocol) => void;
  method: string;
  onMethodChange: (method: string) => void;
  url: string;
  onUrlChange: (url: string) => void;
  params: KeyValueRow[];
  onParamsChange: (rows: KeyValueRow[]) => void;
  headers: KeyValueRow[];
  onHeadersChange: (rows: KeyValueRow[]) => void;
  auth: AuthConfig;
  onAuthChange: (auth: AuthConfig) => void;
  body: string;
  onBodyChange: (body: string) => void;
  grpc: GrpcFormState;
  onGrpcChange: (grpc: GrpcFormState) => void;
  extracts: ExtractRow[];
  onExtractsChange: (rows: ExtractRow[]) => void;
  questions: QuestionRow[];
  onQuestionsChange: (rows: QuestionRow[]) => void;
  variables: KeyValueRow[];
  onVariablesChange: (rows: KeyValueRow[]) => void;
  afterResponse: KeyValueRow[];
  onAfterResponseChange: (rows: KeyValueRow[]) => void;
  kafkaCheck: KafkaCheckFormState;
  onKafkaCheckChange: (kafkaCheck: KafkaCheckFormState) => void;
}

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
const AUTH_TYPES = ['none', 'bearer', 'apiKey', 'basic'] as const;
const PROTOCOLS: { id: Protocol; label: string }[] = [
  { id: 'rest', label: 'REST' },
  { id: 'grpc', label: 'gRPC' },
];

type RestTab = 'beforeInvoke' | 'params' | 'headers' | 'auth' | 'body' | 'curl' | 'afterResponse' | 'extract' | 'questions';
type GrpcTab = 'beforeInvoke' | 'proto' | 'service' | 'method' | 'message' | 'metadata' | 'grpcurl' | 'afterResponse' | 'extract' | 'questions';

const REST_TABS: { id: RestTab; label: string }[] = [
  { id: 'beforeInvoke', label: 'Before invoke' },
  { id: 'params', label: 'Params' },
  { id: 'headers', label: 'Headers' },
  { id: 'auth', label: 'Auth' },
  { id: 'body', label: 'Body' },
  { id: 'curl', label: 'Paste cURL' },
  { id: 'afterResponse', label: 'After response' },
  { id: 'extract', label: 'Extract' },
  { id: 'questions', label: 'Questions' },
];

const GRPC_TABS: { id: GrpcTab; label: string }[] = [
  { id: 'beforeInvoke', label: 'Before invoke' },
  { id: 'proto', label: 'Proto' },
  { id: 'service', label: 'Service' },
  { id: 'method', label: 'Method' },
  { id: 'message', label: 'Message' },
  { id: 'metadata', label: 'Metadata' },
  { id: 'grpcurl', label: 'Paste grpcurl' },
  { id: 'afterResponse', label: 'After response' },
  { id: 'extract', label: 'Extract' },
  { id: 'questions', label: 'Questions' },
];

function readFileAsText(file: File): Promise<string> {
  // Uses FileReader rather than the newer File.prototype.text() — jsdom
  // (this project's test environment) doesn't implement text()/arrayBuffer()
  // on Blob/File, only the long-standing FileReader API. Behavior is identical
  // in real browsers.
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

function blankAuth(type: (typeof AUTH_TYPES)[number]): AuthConfig {
  switch (type) {
    case 'none':
      return { type: 'none' };
    case 'bearer':
      return { type: 'bearer', token: '' };
    case 'apiKey':
      return { type: 'apiKey', header: '', value: '' };
    case 'basic':
      return { type: 'basic', username: '', password: '' };
  }
}

export function RequestBuilder(props: RequestBuilderProps) {
  const {
    protocol,
    onProtocolChange,
    method,
    onMethodChange,
    url,
    onUrlChange,
    params,
    onParamsChange,
    headers,
    onHeadersChange,
    auth,
    onAuthChange,
    body,
    onBodyChange,
    grpc,
    onGrpcChange,
    extracts,
    onExtractsChange,
    questions,
    onQuestionsChange,
    variables,
    onVariablesChange,
    afterResponse,
    onAfterResponseChange,
    kafkaCheck,
    onKafkaCheckChange,
  } = props;

  const [restTab, setRestTab] = useState<RestTab>('params');
  const [grpcTab, setGrpcTab] = useState<GrpcTab>('proto');
  const [services, setServices] = useState<ServiceDefinition[]>([]);
  const [protoError, setProtoError] = useState<string | null>(null);

  // Re-introspects whenever protoContent changes for any reason: a fresh
  // upload, loading a previously-saved step (LoadStepSelect), or switching
  // between two saved gRPC steps. This keeps the Service/Method datalists in
  // sync with the proto that's actually loaded, instead of only working
  // right after an upload.
  useEffect(() => {
    let cancelled = false;
    if (!grpc.protoContent) {
      setServices([]);
      setProtoError(null);
      return;
    }
    introspectProto(grpc.protoContent).then((result) => {
      if (cancelled) {
        return;
      }
      if (result) {
        setServices(result);
        setProtoError(null);
      } else {
        setServices([]);
        setProtoError('Could not parse this .proto file.');
      }
    });
    return () => {
      cancelled = true;
    };
  }, [grpc.protoContent]);

  async function handleProtoFile(file: File) {
    const content = await readFileAsText(file);
    onGrpcChange({ ...grpc, protoContent: content, protoFilename: file.name });
  }

  const methodSuggestions = services.find((s) => s.service === grpc.service)?.methods ?? [];

  return (
    <section className="card">
      <h2 className="heading-md">Request</h2>
      <div className="row">
        <label className="label">
          Protocol
          <select
            className="text-input"
            value={protocol}
            onChange={(e) => onProtocolChange(e.target.value as Protocol)}
          >
            {PROTOCOLS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        {protocol === 'rest' ? (
          <>
            <label className="label">
              Method
              <select
                className="text-input"
                value={method}
                onChange={(e) => onMethodChange(e.target.value)}
              >
                {METHODS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </label>
            <label className="label">
              URL
              <input className="text-input" value={url} onChange={(e) => onUrlChange(e.target.value)} />
            </label>
          </>
        ) : (
          <>
            <label className="label">
              Server Address
              <input
                className="text-input"
                value={grpc.serverAddress}
                onChange={(e) => onGrpcChange({ ...grpc, serverAddress: e.target.value })}
              />
            </label>
            <label className="label">
              Secure (TLS)
              <input
                type="checkbox"
                checked={grpc.secure}
                onChange={(e) => onGrpcChange({ ...grpc, secure: e.target.checked })}
              />
            </label>
            <label className="label">
              Skip certificate verification
              <input
                type="checkbox"
                checked={grpc.skipCertVerification}
                disabled={!grpc.secure}
                onChange={(e) => onGrpcChange({ ...grpc, skipCertVerification: e.target.checked })}
              />
            </label>
          </>
        )}
      </div>

      <div className="row">
        <label className="label">
          Check Kafka
          <input
            type="checkbox"
            checked={kafkaCheck.enabled}
            onChange={(e) => onKafkaCheckChange({ ...kafkaCheck, enabled: e.target.checked })}
          />
        </label>
        {kafkaCheck.enabled && (
          <label className="label">
            Kafka Topic
            <select
              className="text-input"
              value={kafkaCheck.topic}
              onChange={(e) =>
                onKafkaCheckChange({ ...kafkaCheck, topic: e.target.value as KafkaCheckFormState['topic'] })
              }
            >
              {KAFKA_TOPICS.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {protocol === 'rest' ? (
        <>
          <nav className="tab-bar">
            {REST_TABS.map(({ id, label }) => (
              <button
                key={id}
                type="button"
                className="tab"
                aria-current={restTab === id}
                onClick={() => setRestTab(id)}
              >
                {label}
              </button>
            ))}
          </nav>

          {restTab === 'beforeInvoke' && (
            <div className="card">
              <KeyValueRows label="Before invoke" rows={variables} onChange={onVariablesChange} />
              <p className="field-hint">
                {'Reference elsewhere via ${key}. Value can be a literal, or the special value $now for the current timestamp.'}
              </p>
            </div>
          )}
          {restTab === 'params' && <KeyValueRows label="Params" rows={params} onChange={onParamsChange} />}
          {restTab === 'headers' && <KeyValueRows label="Headers" rows={headers} onChange={onHeadersChange} />}
          {restTab === 'auth' && (
            <fieldset className="card">
              <legend className="heading-sm">Auth</legend>
              <label className="label">
                Type
                <select
                  className="text-input"
                  value={auth.type}
                  onChange={(e) => onAuthChange(blankAuth(e.target.value as (typeof AUTH_TYPES)[number]))}
                >
                  {AUTH_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </label>
              {auth.type === 'bearer' && (
                <label className="label">
                  Token
                  <input
                    className="text-input"
                    value={auth.token}
                    onChange={(e) => onAuthChange({ type: 'bearer', token: e.target.value })}
                  />
                </label>
              )}
              {auth.type === 'apiKey' && (
                <>
                  <label className="label">
                    Header
                    <input
                      className="text-input"
                      value={auth.header}
                      onChange={(e) =>
                        onAuthChange({ type: 'apiKey', header: e.target.value, value: auth.value })
                      }
                    />
                  </label>
                  <label className="label">
                    Value
                    <input
                      className="text-input"
                      value={auth.value}
                      onChange={(e) =>
                        onAuthChange({ type: 'apiKey', header: auth.header, value: e.target.value })
                      }
                    />
                  </label>
                </>
              )}
              {auth.type === 'basic' && (
                <>
                  <label className="label">
                    Username
                    <input
                      className="text-input"
                      value={auth.username}
                      onChange={(e) =>
                        onAuthChange({ type: 'basic', username: e.target.value, password: auth.password })
                      }
                    />
                  </label>
                  <label className="label">
                    Password
                    <input
                      className="text-input"
                      value={auth.password}
                      onChange={(e) =>
                        onAuthChange({ type: 'basic', username: auth.username, password: e.target.value })
                      }
                    />
                  </label>
                </>
              )}
            </fieldset>
          )}
          {restTab === 'body' && (
            <label className="label">
              Body (JSON)
              <textarea
                className="code-input"
                value={body}
                onChange={(e) => onBodyChange(e.target.value)}
              />
            </label>
          )}
          {restTab === 'curl' && (
            <CurlImport
              onImport={(r) => {
                onMethodChange(r.method);
                onUrlChange(r.url);
                onHeadersChange(r.headers);
                onBodyChange(r.body);
              }}
            />
          )}
          {restTab === 'afterResponse' && (
            <div className="card">
              <KeyValueRows label="After response" rows={afterResponse} onChange={onAfterResponseChange} />
              <p className="field-hint">
                {'Value can be a literal, or reference the response: ${response.body.foo}, ${response.body.items[0].id}, ${response.headers.x-request-id}, ${response.status}'}
              </p>
            </div>
          )}
          {restTab === 'extract' && <ExtractEditor rows={extracts} onChange={onExtractsChange} />}
          {restTab === 'questions' && <QuestionsEditor rows={questions} onChange={onQuestionsChange} />}
        </>
      ) : (
        <>
          <nav className="tab-bar">
            {GRPC_TABS.map(({ id, label }) => (
              <button
                key={id}
                type="button"
                className="tab"
                aria-current={grpcTab === id}
                onClick={() => setGrpcTab(id)}
              >
                {label}
              </button>
            ))}
          </nav>

          {grpcTab === 'beforeInvoke' && (
            <div className="card">
              <KeyValueRows label="Before invoke" rows={variables} onChange={onVariablesChange} />
              <p className="field-hint">
                {'Reference elsewhere via ${key}. Value can be a literal, or the special value $now for the current timestamp.'}
              </p>
            </div>
          )}
          {grpcTab === 'proto' && (
            <fieldset className="card">
              <legend className="heading-sm">Proto File</legend>
              <label className="label">
                Proto File
                <input
                  className="text-input"
                  type="file"
                  accept=".proto"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      handleProtoFile(file);
                    }
                  }}
                />
              </label>
              {grpc.protoFilename !== '' && <p className="body-strong">{grpc.protoFilename}</p>}
              {protoError && <p className="alert">{protoError}</p>}
            </fieldset>
          )}
          {grpcTab === 'service' && (
            <label className="label">
              Service
              <input
                className="text-input"
                list="grpc-service-options"
                value={grpc.service}
                onChange={(e) => onGrpcChange({ ...grpc, service: e.target.value })}
              />
              <datalist id="grpc-service-options">
                {services.map((s) => (
                  <option key={s.service} value={s.service} />
                ))}
              </datalist>
            </label>
          )}
          {grpcTab === 'method' && (
            <label className="label">
              Method
              <input
                className="text-input"
                list="grpc-method-options"
                value={grpc.method}
                onChange={(e) => onGrpcChange({ ...grpc, method: e.target.value })}
              />
              <datalist id="grpc-method-options">
                {methodSuggestions.map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
            </label>
          )}
          {grpcTab === 'message' && (
            <label className="label">
              Message (JSON)
              <textarea
                className="code-input"
                value={grpc.requestMessage}
                onChange={(e) => onGrpcChange({ ...grpc, requestMessage: e.target.value })}
              />
            </label>
          )}
          {grpcTab === 'metadata' && (
            <KeyValueRows
              label="Metadata"
              rows={grpc.metadata}
              onChange={(metadata) => onGrpcChange({ ...grpc, metadata })}
            />
          )}
          {grpcTab === 'grpcurl' && (
            <PasteGrpcurlPanel
              onImport={(r) =>
                onGrpcChange({
                  ...grpc,
                  serverAddress: r.serverAddress,
                  service: r.service,
                  method: r.method,
                  requestMessage: r.message,
                  metadata: r.metadata,
                  secure: r.secure,
                  skipCertVerification: r.skipCertVerification,
                })
              }
            />
          )}
          {grpcTab === 'afterResponse' && (
            <div className="card">
              <KeyValueRows label="After response" rows={afterResponse} onChange={onAfterResponseChange} />
              <p className="field-hint">
                {'Value can be a literal, or reference the response: ${response.body.foo}, ${response.body.items[0].id}, ${response.headers.x-request-id}, ${response.status}'}
              </p>
            </div>
          )}
          {grpcTab === 'extract' && <ExtractEditor rows={extracts} onChange={onExtractsChange} />}
          {grpcTab === 'questions' && <QuestionsEditor rows={questions} onChange={onQuestionsChange} />}
        </>
      )}
    </section>
  );
}
