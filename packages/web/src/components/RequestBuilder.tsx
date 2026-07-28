import { useState } from 'react';
import type { AuthConfig, ExtractRow, KeyValueRow, QuestionRow } from '../types';
import { KeyValueRows } from './KeyValueRows';
import { ExtractEditor } from './ExtractEditor';
import { QuestionsEditor } from './QuestionsEditor';

export interface RequestBuilderProps {
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
  extracts: ExtractRow[];
  onExtractsChange: (rows: ExtractRow[]) => void;
  questions: QuestionRow[];
  onQuestionsChange: (rows: QuestionRow[]) => void;
}

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
const AUTH_TYPES = ['none', 'bearer', 'apiKey', 'basic'] as const;

type RequestTab = 'params' | 'headers' | 'auth' | 'body' | 'extract' | 'questions';

const TABS: { id: RequestTab; label: string }[] = [
  { id: 'params', label: 'Params' },
  { id: 'headers', label: 'Headers' },
  { id: 'auth', label: 'Auth' },
  { id: 'body', label: 'Body' },
  { id: 'extract', label: 'Extract' },
  { id: 'questions', label: 'Questions' },
];

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
    extracts,
    onExtractsChange,
    questions,
    onQuestionsChange,
  } = props;

  const [tab, setTab] = useState<RequestTab>('params');

  return (
    <section>
      <h2>Request</h2>
      <label>
        Method
        <select value={method} onChange={(e) => onMethodChange(e.target.value)}>
          {METHODS.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </label>
      <label>
        URL
        <input value={url} onChange={(e) => onUrlChange(e.target.value)} />
      </label>

      <nav>
        {TABS.map(({ id, label }) => (
          <button key={id} type="button" aria-current={tab === id} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </nav>

      {tab === 'params' && <KeyValueRows label="Params" rows={params} onChange={onParamsChange} />}
      {tab === 'headers' && <KeyValueRows label="Headers" rows={headers} onChange={onHeadersChange} />}
      {tab === 'auth' && (
        <fieldset>
          <legend>Auth</legend>
          <label>
            Type
            <select
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
            <label>
              Token
              <input
                value={auth.token}
                onChange={(e) => onAuthChange({ type: 'bearer', token: e.target.value })}
              />
            </label>
          )}
          {auth.type === 'apiKey' && (
            <>
              <label>
                Header
                <input
                  value={auth.header}
                  onChange={(e) => onAuthChange({ type: 'apiKey', header: e.target.value, value: auth.value })}
                />
              </label>
              <label>
                Value
                <input
                  value={auth.value}
                  onChange={(e) => onAuthChange({ type: 'apiKey', header: auth.header, value: e.target.value })}
                />
              </label>
            </>
          )}
          {auth.type === 'basic' && (
            <>
              <label>
                Username
                <input
                  value={auth.username}
                  onChange={(e) =>
                    onAuthChange({ type: 'basic', username: e.target.value, password: auth.password })
                  }
                />
              </label>
              <label>
                Password
                <input
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
      {tab === 'body' && (
        <label>
          Body (JSON)
          <textarea value={body} onChange={(e) => onBodyChange(e.target.value)} />
        </label>
      )}
      {tab === 'extract' && <ExtractEditor rows={extracts} onChange={onExtractsChange} />}
      {tab === 'questions' && <QuestionsEditor rows={questions} onChange={onQuestionsChange} />}
    </section>
  );
}
