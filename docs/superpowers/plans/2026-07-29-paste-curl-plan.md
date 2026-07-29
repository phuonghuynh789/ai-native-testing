# Paste cURL Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Paste cURL" tab to the REST GUI's Request tab bar (right after "Body") that parses a pasted cURL command and populates Method, URL, Headers, and Body in one click.

**Architecture:** A pure parsing module (`packages/web/src/curl.ts`) turns a cURL command string into `{ method, url, headers, body }` or a parse error. A new `CurlImport` component wraps it in a textarea + "Import" button + inline success/error feedback. `RequestBuilder` gains a `'curl'` tab that renders `CurlImport` and wires its result into the four callbacks it already owns (`onMethodChange`/`onUrlChange`/`onHeadersChange`/`onBodyChange`).

**Tech Stack:** Same as the rest of `packages/web` — plain TypeScript, React, no new dependencies. `crypto.randomUUID()` and `btoa()` (both already used/available in this codebase's browser + jsdom test environment) — no polyfills needed.

Spec: [`docs/superpowers/specs/2026-07-29-paste-curl-design.md`](../specs/2026-07-29-paste-curl-design.md)

## Global Constraints

- Entirely a `packages/web` frontend feature — no backend/API changes, no `FormState` schema changes. The pasted cURL text is transient local UI state, never persisted or sent to the server.
- Nothing changes until the user clicks **Import** — no live/auto-parsing on paste.
- Recognized flags: `-X`/`--request`, `-H`/`--header` (repeatable), `-d`/`--data`/`--data-raw`/`--data-binary`/`--data-ascii`, `-u`/`--user`, `--url`, plus a bare positional URL. All other flags are silently ignored (never cause a parse failure) — including value-taking ones (`-F`/`--form`, `-b`/`--cookie`, `-A`/`--user-agent`), whose value token must also be consumed so it isn't mistaken for the URL.
- Method inference: explicit `-X`/`--request` always wins; otherwise any `-d`/`--data*` flag present ⇒ `POST`; otherwise ⇒ `GET`. Supported methods are exactly `GET`, `POST`, `PUT`, `PATCH`, `DELETE` (matches the existing Method `<select>`) — anything else is a parse error.
- Multiple `-d`/`--data*` flags: only the last one is used (no `&`-joining).
- `-u user:pass` becomes an appended `Authorization: Basic <base64>` header — it does NOT populate the Auth tab.
- Out of scope (do not implement): splitting the URL's query string into the Params tab, populating the Auth tab from `-u`, full POSIX shell parsing (`$VAR` expansion, command substitution), "Copy as cURL" (exporting the form back to a command).
- Import button is disabled when the textarea is empty — there is no "empty input" error state.
- On a successful import, the textarea keeps its text (not cleared) and a success message is shown. On a failed parse, `onImport` is NOT called and the existing Method/URL/Headers/Body are left untouched.

---

### Task 1: `curl.ts` (cURL command parser)

**Files:**
- Create: `packages/web/src/curl.ts`
- Test: `packages/web/test/curl.test.ts`

**Interfaces:**
- Produces: `CurlParseResult` (discriminated union) and `parseCurl(input: string): CurlParseResult`. Consumed by `CurlImport` (Task 2).

- [ ] **Step 1: Write failing tests**

Create `packages/web/test/curl.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseCurl } from '../src/curl';

describe('parseCurl', () => {
  it('parses a simple GET command', () => {
    const result = parseCurl('curl https://api.example.com/x');
    expect(result).toEqual({
      ok: true,
      method: 'GET',
      url: 'https://api.example.com/x',
      headers: [],
      body: '',
    });
  });

  it('parses an explicit POST with a JSON body', () => {
    const result = parseCurl(`curl -X POST https://api.example.com/x -d '{"a":1}'`);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.method).toBe('POST');
    expect(result.url).toBe('https://api.example.com/x');
    expect(result.body).toBe('{"a":1}');
  });

  it('infers POST when -d is present without -X', () => {
    const result = parseCurl(`curl https://api.example.com/x -d '{"a":1}'`);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.method).toBe('POST');
  });

  it('parses multiple -H flags into separate header rows, preserving colons inside values', () => {
    const result = parseCurl(
      `curl https://api.example.com/x -H 'Content-Type: application/json' -H 'Authorization: Bearer abc:def'`
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.headers.map((h) => ({ key: h.key, value: h.value }))).toEqual([
      { key: 'Content-Type', value: 'application/json' },
      { key: 'Authorization', value: 'Bearer abc:def' },
    ]);
  });

  it('converts -u user:pass into a Basic Authorization header', () => {
    const result = parseCurl('curl https://api.example.com/x -u admin:secret');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.headers.map((h) => ({ key: h.key, value: h.value }))).toEqual([
      { key: 'Authorization', value: `Basic ${btoa('admin:secret')}` },
    ]);
  });

  it('joins backslash-newline continuations from a multi-line paste', () => {
    const result = parseCurl(
      `curl 'https://api.example.com/x' \\\n  -H 'Content-Type: application/json' \\\n  -d '{"a":1}'`
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.url).toBe('https://api.example.com/x');
    expect(result.body).toBe('{"a":1}');
  });

  it('uses only the last of multiple -d flags', () => {
    const result = parseCurl(`curl https://api.example.com/x -d 'first' -d 'second'`);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.body).toBe('second');
  });

  it('ignores unsupported flags like -F and --compressed without failing', () => {
    const result = parseCurl(`curl https://api.example.com/x -F 'file=@photo.png' --compressed`);
    expect(result).toEqual({
      ok: true,
      method: 'GET',
      url: 'https://api.example.com/x',
      headers: [],
      body: '',
    });
  });

  it('errors when the input does not start with curl', () => {
    const result = parseCurl('wget https://api.example.com/x');
    expect(result).toEqual({ ok: false, error: 'Command must start with "curl"' });
  });

  it('errors when no URL is present', () => {
    const result = parseCurl('curl -X POST');
    expect(result).toEqual({ ok: false, error: 'No URL found in command' });
  });

  it('errors on an unsupported method', () => {
    const result = parseCurl('curl -X HEAD https://api.example.com/x');
    expect(result).toEqual({ ok: false, error: 'Unsupported method: HEAD' });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @ai-native-testing/web test`
Expected: FAIL — `../src/curl` does not exist.

- [ ] **Step 3: Implement `curl.ts`**

Create `packages/web/src/curl.ts`:

```ts
import type { KeyValueRow } from './types';

export type CurlParseResult =
  | { ok: true; method: string; url: string; headers: KeyValueRow[]; body: string }
  | { ok: false; error: string };

const SUPPORTED_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
const IGNORED_VALUE_FLAGS = new Set(['-F', '--form', '-b', '--cookie', '-A', '--user-agent']);

function joinContinuations(input: string): string {
  return input.replace(/\\[ \t]*\r?\n[ \t]*/g, ' ');
}

function tokenize(input: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let hasToken = false;
  let inSingle = false;
  let inDouble = false;
  let i = 0;

  while (i < input.length) {
    const ch = input[i];

    if (inSingle) {
      if (ch === '\\' && input[i + 1] === "'") {
        current += "'";
        i += 2;
        continue;
      }
      if (ch === "'") {
        inSingle = false;
        i += 1;
        continue;
      }
      current += ch;
      i += 1;
      continue;
    }

    if (inDouble) {
      if (ch === '\\' && (input[i + 1] === '"' || input[i + 1] === '\\')) {
        current += input[i + 1];
        i += 2;
        continue;
      }
      if (ch === '"') {
        inDouble = false;
        i += 1;
        continue;
      }
      current += ch;
      i += 1;
      continue;
    }

    if (ch === "'") {
      inSingle = true;
      hasToken = true;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inDouble = true;
      hasToken = true;
      i += 1;
      continue;
    }
    if (/\s/.test(ch)) {
      if (hasToken) {
        tokens.push(current);
        current = '';
        hasToken = false;
      }
      i += 1;
      continue;
    }

    current += ch;
    hasToken = true;
    i += 1;
  }

  if (hasToken) {
    tokens.push(current);
  }
  return tokens;
}

export function parseCurl(input: string): CurlParseResult {
  const trimmed = input.trim();
  if (!trimmed.startsWith('curl')) {
    return { ok: false, error: 'Command must start with "curl"' };
  }

  const tokens = tokenize(joinContinuations(trimmed)).slice(1);

  let explicitMethod: string | null = null;
  let url: string | null = null;
  const headers: KeyValueRow[] = [];
  let body: string | null = null;
  let userPass: string | null = null;

  for (let i = 0; i < tokens.length; i += 1) {
    let token = tokens[i];
    let inlineValue: string | null = null;

    if (token.startsWith('--')) {
      const eq = token.indexOf('=');
      if (eq !== -1) {
        inlineValue = token.slice(eq + 1);
        token = token.slice(0, eq);
      }
    }

    const takeValue = (): string => {
      if (inlineValue !== null) {
        return inlineValue;
      }
      i += 1;
      return tokens[i] ?? '';
    };

    switch (token) {
      case '-X':
      case '--request':
        explicitMethod = takeValue().toUpperCase();
        break;
      case '-H':
      case '--header': {
        const headerValue = takeValue();
        const colon = headerValue.indexOf(':');
        if (colon !== -1) {
          headers.push({
            id: crypto.randomUUID(),
            key: headerValue.slice(0, colon).trim(),
            value: headerValue.slice(colon + 1).trim(),
          });
        }
        break;
      }
      case '-d':
      case '--data':
      case '--data-raw':
      case '--data-binary':
      case '--data-ascii':
        body = takeValue();
        break;
      case '-u':
      case '--user':
        userPass = takeValue();
        break;
      case '--url':
        url = takeValue();
        break;
      default:
        if (IGNORED_VALUE_FLAGS.has(token)) {
          takeValue();
        } else if (!token.startsWith('-') && url === null) {
          url = inlineValue ?? token;
        }
        break;
    }
  }

  if (url === null || url === '') {
    return { ok: false, error: 'No URL found in command' };
  }

  const method = explicitMethod ?? (body !== null ? 'POST' : 'GET');
  if (!SUPPORTED_METHODS.includes(method)) {
    return { ok: false, error: `Unsupported method: ${method}` };
  }

  if (userPass !== null) {
    headers.push({
      id: crypto.randomUUID(),
      key: 'Authorization',
      value: `Basic ${btoa(userPass)}`,
    });
  }

  return { ok: true, method, url, headers, body: body ?? '' };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @ai-native-testing/web test`
Expected: PASS (all tests, including the 11 new ones in `curl.test.ts`).

- [ ] **Step 5: Typecheck and commit**

Run: `pnpm --filter @ai-native-testing/web typecheck`
Expected: no errors.

```bash
git add packages/web/src/curl.ts packages/web/test/curl.test.ts
git commit -m "feat(web): add parseCurl for importing cURL commands"
```

---

### Task 2: `CurlImport` component

**Files:**
- Create: `packages/web/src/components/CurlImport.tsx`
- Modify: `packages/web/src/styles.css`
- Test: `packages/web/test/components/CurlImport.test.tsx`

**Interfaces:**
- Consumes: `parseCurl` (Task 1).
- Produces: `CurlImportProps` — `{ onImport: (result: { method: string; url: string; headers: KeyValueRow[]; body: string }) => void }`. Consumed by `RequestBuilder` (Task 3).

- [ ] **Step 1: Write failing tests**

Create `packages/web/test/components/CurlImport.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CurlImport } from '../../src/components/CurlImport';

describe('CurlImport', () => {
  it('disables Import when the textarea is empty', () => {
    render(<CurlImport onImport={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Import' })).toBeDisabled();
  });

  it('calls onImport with the parsed result for a valid command', async () => {
    const onImport = vi.fn();
    render(<CurlImport onImport={onImport} />);
    fireEvent.change(screen.getByLabelText('cURL command'), {
      target: {
        value: `curl -X POST https://api.example.com/x -H 'Content-Type: application/json' -d '{"a":1}'`,
      },
    });
    await userEvent.click(screen.getByRole('button', { name: 'Import' }));
    expect(onImport).toHaveBeenCalledWith({
      method: 'POST',
      url: 'https://api.example.com/x',
      headers: [{ id: expect.any(String), key: 'Content-Type', value: 'application/json' }],
      body: '{"a":1}',
    });
    expect(screen.getByText('Imported.')).toBeInTheDocument();
  });

  it('shows an error and does not call onImport for an invalid command', async () => {
    const onImport = vi.fn();
    render(<CurlImport onImport={onImport} />);
    fireEvent.change(screen.getByLabelText('cURL command'), {
      target: { value: 'wget https://api.example.com/x' },
    });
    await userEvent.click(screen.getByRole('button', { name: 'Import' }));
    expect(onImport).not.toHaveBeenCalled();
    expect(screen.getByText('Command must start with "curl"')).toBeInTheDocument();
  });

  it('keeps the textarea text after a successful import', async () => {
    render(<CurlImport onImport={vi.fn()} />);
    const textarea = screen.getByLabelText('cURL command');
    fireEvent.change(textarea, { target: { value: 'curl https://api.example.com/x' } });
    await userEvent.click(screen.getByRole('button', { name: 'Import' }));
    expect(textarea).toHaveValue('curl https://api.example.com/x');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @ai-native-testing/web test`
Expected: FAIL — `../../src/components/CurlImport` does not exist.

- [ ] **Step 3: Implement `CurlImport`**

Create `packages/web/src/components/CurlImport.tsx`:

```tsx
import { useState } from 'react';
import type { KeyValueRow } from '../types';
import { parseCurl } from '../curl';

export interface CurlImportResult {
  method: string;
  url: string;
  headers: KeyValueRow[];
  body: string;
}

export interface CurlImportProps {
  onImport: (result: CurlImportResult) => void;
}

export function CurlImport({ onImport }: CurlImportProps) {
  const [text, setText] = useState('');
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  function handleImport() {
    const result = parseCurl(text);
    if (result.ok) {
      onImport({ method: result.method, url: result.url, headers: result.headers, body: result.body });
      setMessage({ type: 'success', text: 'Imported.' });
    } else {
      setMessage({ type: 'error', text: result.error });
    }
  }

  return (
    <fieldset className="card">
      <legend className="heading-sm">Paste cURL</legend>
      <label className="label">
        cURL command
        <textarea className="code-input" value={text} onChange={(e) => setText(e.target.value)} />
      </label>
      <button
        type="button"
        className="btn-secondary"
        disabled={text.trim() === ''}
        onClick={handleImport}
      >
        Import
      </button>
      {message && (
        <p className={message.type === 'error' ? 'alert' : 'alert alert--success'}>{message.text}</p>
      )}
    </fieldset>
  );
}
```

- [ ] **Step 4: Add the success message style**

In `packages/web/src/styles.css`, right after the existing `.alert` block:

```css
/* Alert banner */
.alert {
  font-family: var(--font-body);
  font-size: 14px;
  color: var(--color-terminal-red);
  background: var(--color-surface-soft);
  border: 1px solid var(--color-hairline);
  border-radius: var(--radius-lg);
  padding: var(--space-md) var(--space-lg);
  margin: 0;
}
```

add:

```css
.alert--success {
  color: var(--color-terminal-green);
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @ai-native-testing/web test`
Expected: PASS (all tests, including the 4 new ones in `CurlImport.test.tsx`).

- [ ] **Step 6: Typecheck and commit**

Run: `pnpm --filter @ai-native-testing/web typecheck`
Expected: no errors.

```bash
git add packages/web/src/components/CurlImport.tsx packages/web/src/styles.css packages/web/test/components/CurlImport.test.tsx
git commit -m "feat(web): add CurlImport component for pasting cURL commands"
```

---

### Task 3: Wire `CurlImport` into `RequestBuilder`

**Files:**
- Modify: `packages/web/src/components/RequestBuilder.tsx`
- Modify: `packages/web/test/components/RequestBuilder.test.tsx`

**Interfaces:**
- Consumes: `CurlImport`, `CurlImportProps` (Task 2).
- Produces: nothing new for later tasks — this is the final integration point for this feature.

- [ ] **Step 1: Write a failing test for the new tab**

In `packages/web/test/components/RequestBuilder.test.tsx`, add this import:

```ts
import { render, screen, fireEvent } from '@testing-library/react';
```

(replacing the existing `import { render, screen } from '@testing-library/react';`), and add this test at the end of the `describe('RequestBuilder', ...)` block, right before the closing `});`:

```tsx
  it('switches to the Paste cURL tab and applies a successful import', async () => {
    const onMethodChange = vi.fn();
    const onUrlChange = vi.fn();
    const onHeadersChange = vi.fn();
    const onBodyChange = vi.fn();
    render(
      <RequestBuilder
        {...baseProps({ onMethodChange, onUrlChange, onHeadersChange, onBodyChange })}
      />
    );
    await userEvent.click(screen.getByRole('button', { name: 'Paste cURL' }));
    fireEvent.change(screen.getByLabelText('cURL command'), {
      target: { value: `curl -X POST https://api.example.com/x -H 'X-Trace: abc' -d '{"a":1}'` },
    });
    await userEvent.click(screen.getByRole('button', { name: 'Import' }));
    expect(onMethodChange).toHaveBeenCalledWith('POST');
    expect(onUrlChange).toHaveBeenCalledWith('https://api.example.com/x');
    expect(onHeadersChange).toHaveBeenCalledWith([
      { id: expect.any(String), key: 'X-Trace', value: 'abc' },
    ]);
    expect(onBodyChange).toHaveBeenCalledWith('{"a":1}');
  });
```

- [ ] **Step 2: Run the tests to verify the new one fails**

Run: `pnpm --filter @ai-native-testing/web test`
Expected: FAIL — there is no "Paste cURL" tab button yet.

- [ ] **Step 3: Add the `curl` tab to `RequestBuilder`**

In `packages/web/src/components/RequestBuilder.tsx`, add the import:

```ts
import { CurlImport } from './CurlImport';
```

Change the `RequestTab` type:

```ts
type RequestTab = 'params' | 'headers' | 'auth' | 'body' | 'extract' | 'questions';
```

to:

```ts
type RequestTab = 'params' | 'headers' | 'auth' | 'body' | 'curl' | 'extract' | 'questions';
```

Change the `TABS` array:

```ts
const TABS: { id: RequestTab; label: string }[] = [
  { id: 'params', label: 'Params' },
  { id: 'headers', label: 'Headers' },
  { id: 'auth', label: 'Auth' },
  { id: 'body', label: 'Body' },
  { id: 'extract', label: 'Extract' },
  { id: 'questions', label: 'Questions' },
];
```

to:

```ts
const TABS: { id: RequestTab; label: string }[] = [
  { id: 'params', label: 'Params' },
  { id: 'headers', label: 'Headers' },
  { id: 'auth', label: 'Auth' },
  { id: 'body', label: 'Body' },
  { id: 'curl', label: 'Paste cURL' },
  { id: 'extract', label: 'Extract' },
  { id: 'questions', label: 'Questions' },
];
```

Add the tab's render block right after the `'body'` block and before the `'extract'` block:

```tsx
      {tab === 'body' && (
        <label className="label">
          Body (JSON)
          <textarea
            className="code-input"
            value={body}
            onChange={(e) => onBodyChange(e.target.value)}
          />
        </label>
      )}
      {tab === 'curl' && (
        <CurlImport
          onImport={(r) => {
            onMethodChange(r.method);
            onUrlChange(r.url);
            onHeadersChange(r.headers);
            onBodyChange(r.body);
          }}
        />
      )}
      {tab === 'extract' && <ExtractEditor rows={extracts} onChange={onExtractsChange} />}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @ai-native-testing/web test`
Expected: PASS (all tests, including the new "Paste cURL" tab test).

- [ ] **Step 5: Typecheck, run the whole workspace, and commit**

Run: `pnpm --filter @ai-native-testing/web typecheck`
Expected: no errors.

Run: `pnpm test && pnpm typecheck`
Expected: PASS across all packages (`engine`, `runner-api`, `runner-log`, `server`, `web`).

```bash
git add packages/web/src/components/RequestBuilder.tsx packages/web/test/components/RequestBuilder.test.tsx
git commit -m "feat(web): add Paste cURL tab to the Request builder"
```

---

### Task 4: Final verification

**Files:** none created or modified — this task only runs checks.

**Interfaces:** none.

- [ ] **Step 1: Run the full workspace test suite and typecheck**

Run: `pnpm test`
Expected: PASS across all 5 packages, no newly failing tests.

Run: `pnpm typecheck`
Expected: no errors in any package.

- [ ] **Step 2: Manual browser verification**

Start the backend (`pnpm --filter @ai-native-testing/server start`) and the GUI dev server (`pnpm --filter @ai-native-testing/web dev`). Open the GUI and confirm:

- The Request tab bar shows "Paste cURL" right after "Body".
- Pasting a real cURL command copied via a browser's DevTools "Copy as cURL" (or a hand-written one covering `-X`, `-H`, and `-d`) and clicking Import correctly updates the Method dropdown, URL field, Headers tab, and Body tab.
- Pasting something that isn't a valid cURL command (e.g. plain text) and clicking Import shows an inline error and leaves the existing Method/URL/Headers/Body untouched.
- After a successful import, running the request (clicking Run) still works end-to-end against a real endpoint.

Take a screenshot as evidence, same as prior manual verifications in this project.

- [ ] **Step 3: Commit (if the manual check surfaced any fix)**

If Step 2 finds nothing to fix, there is nothing to commit for this task. If it does surface an issue, fix it, re-run Step 1, and commit:

```bash
git add -A
git commit -m "fix(web): correct issue found during manual Paste cURL verification"
```
