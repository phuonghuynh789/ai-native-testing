# REST GUI Visual Design (DESIGN.md application) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the REST GUI (`packages/web`) a real visual design using `DESIGN.md`'s exact colors/typography/spacing/radii and its pill/card/code-block component vocabulary, without changing any component's behavior, structure, or breaking any of its 47 existing tests.

**Architecture:** One new global stylesheet (`packages/web/src/styles.css`) defines every needed token as a CSS custom property plus a small set of reusable classes (`.heading-xl`, `.card`, `.text-input`, `.btn-primary`, `.tab`, `.code-block`, etc.). Every existing component gets `className` attributes added to its existing JSX — pure presentation layer, zero new props, zero new DOM structure beyond what a class name requires.

**Tech Stack:** Plain CSS with custom properties, imported once in `main.tsx`. No new dependency, no CSS framework, no CSS-in-JS.

Spec: [`docs/superpowers/specs/2026-07-29-rest-gui-design-system.md`](../specs/2026-07-29-rest-gui-design-system.md)

## Global Constraints

- No new dependencies (no CSS framework, no CSS-in-JS, no font-loading package). Font stacks use `DESIGN.md`'s own documented system-font fallback chains.
- Every task in this plan is presentation-only: no component's props, exported types, or DOM structure change beyond adding `className` attributes (and, where noted, one small local helper function that derives a class name from already-existing data — never new data).
- **This is a styling-only plan, so the usual TDD red/green cycle doesn't apply** — there is nothing meaningful to unit-test about "this button is black." Each task's verification step is instead: run `pnpm --filter @ai-native-testing/web test` and confirm **all 47 existing tests still pass, unmodified** (no test file is touched in this plan except as noted), plus `pnpm --filter @ai-native-testing/web typecheck`.
- Colors, exact hex values from `DESIGN.md`: `--color-primary` #000000, `--color-on-primary` #ffffff, `--color-ink` #000000, `--color-ink-deep` #090909, `--color-canvas` #ffffff, `--color-surface-soft` #fafafa, `--color-hairline` #e5e5e5, `--color-hairline-strong` #d4d4d4, `--color-charcoal` #525252, `--color-body` #737373, `--color-mute` #a3a3a3, `--color-terminal-red` #ff5f56, `--color-terminal-green` #27c93f, `--color-focus-ring` rgba(59,130,246,0.5).
- Typography font stacks: headings (`display-xl`, `display-lg`, `heading-lg` only) use `"SF Pro Rounded", system-ui, -apple-system, sans-serif`; everything else text-based (`heading-md`, `heading-sm`, `body-*`) uses `ui-sans-serif, system-ui, -apple-system, sans-serif`; code uses `ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace`.
- Radii: `--radius-full` 9999px (pills — every button/input), `--radius-lg` 12px (cards — the only two values this app needs).
- `--color-terminal-red`/`--color-terminal-green` are repurposed as this app's pass/fail status color (confirmed decision — see spec's "Pass/Fail Status" section), since `DESIGN.md` has no error/success palette of its own.
- Out of scope: responsive breakpoints, dark mode, the llama mascot/illustrations, hover-state polish, and any `DESIGN.md` component with no equivalent here (`pricing-card`, `faq-row`, `primary-nav` with search, `cta-strip-dark`).

## File Structure

```
packages/web/src/
├── vite-env.d.ts       # new — ambient types so `import './styles.css'` type-checks
├── styles.css          # new — all tokens + reusable classes
├── main.tsx            # modified — imports styles.css
├── App.tsx             # modified — className additions only
└── components/
    ├── ScreenplayHeader.tsx   # modified — className additions only
    ├── KeyValueRows.tsx       # modified — className additions only
    ├── RequestBuilder.tsx     # modified — className additions only
    ├── SourceKindSelector.tsx # modified — className addition only
    ├── ExtractEditor.tsx      # modified — className additions only
    ├── QuestionsEditor.tsx    # modified — className additions only
    ├── ResultsPanel.tsx       # modified — className additions + one local helper function
    └── RunButton.tsx          # modified — className addition only
```

---

### Task 1: Foundation — `styles.css` + ambient types + import

**Files:**
- Create: `packages/web/src/vite-env.d.ts`
- Create: `packages/web/src/styles.css`
- Modify: `packages/web/src/main.tsx`

**Interfaces:**
- Produces: every CSS custom property and reusable class every later task applies via `className`. No later task creates new classes — Tasks 2–7 only ever reference classes defined here.

- [ ] **Step 1: Add ambient types for CSS imports**

Create `packages/web/src/vite-env.d.ts`:

```ts
/// <reference types="vite/client" />
```

Without this, `import './styles.css'` in `main.tsx` fails `tsc --noEmit` with "Cannot find module './styles.css'" — Vite's own client types declare the ambient module shape for asset imports (`*.css`, `*.svg`, etc.), and this project's `tsconfig.json` doesn't reference them yet.

- [ ] **Step 2: Create the stylesheet**

Create `packages/web/src/styles.css`:

```css
:root {
  /* Colors — exact hex values from DESIGN.md */
  --color-primary: #000000;
  --color-on-primary: #ffffff;
  --color-ink: #000000;
  --color-ink-deep: #090909;
  --color-canvas: #ffffff;
  --color-surface-soft: #fafafa;
  --color-hairline: #e5e5e5;
  --color-hairline-strong: #d4d4d4;
  --color-charcoal: #525252;
  --color-body: #737373;
  --color-mute: #a3a3a3;
  --color-terminal-red: #ff5f56;
  --color-terminal-green: #27c93f;
  --color-focus-ring: rgba(59, 130, 246, 0.5);

  /* Typography */
  --font-heading: "SF Pro Rounded", system-ui, -apple-system, sans-serif;
  --font-body: ui-sans-serif, system-ui, -apple-system, sans-serif;
  --font-code: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;

  /* Spacing */
  --space-xxs: 2px;
  --space-xs: 4px;
  --space-sm: 8px;
  --space-md: 12px;
  --space-lg: 16px;
  --space-xl: 24px;
  --space-xxl: 32px;
  --space-section: 88px;

  /* Radii */
  --radius-full: 9999px;
  --radius-lg: 12px;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  background: var(--color-canvas);
  color: var(--color-body);
  font-family: var(--font-body);
  font-size: 16px;
  line-height: 1.5;
}

.app-main {
  max-width: 720px;
  margin: 0 auto;
  padding: var(--space-xxl) var(--space-lg);
  display: flex;
  flex-direction: column;
  gap: var(--space-xl);
}

/* Typography */
.heading-xl {
  font-family: var(--font-heading);
  font-size: 36px;
  font-weight: 500;
  line-height: 1.11;
  color: var(--color-ink);
  margin: 0;
}

.heading-md {
  font-family: var(--font-body);
  font-size: 20px;
  font-weight: 500;
  line-height: 1.4;
  color: var(--color-ink);
  margin: 0 0 var(--space-md) 0;
}

.heading-sm {
  font-family: var(--font-body);
  font-size: 18px;
  font-weight: 500;
  line-height: 1.56;
  color: var(--color-ink);
}

.body-strong {
  font-family: var(--font-body);
  font-size: 16px;
  font-weight: 500;
  line-height: 1.5;
  color: var(--color-ink);
  margin: 0;
}

.label {
  font-family: var(--font-body);
  font-size: 14px;
  font-weight: 500;
  line-height: 1.43;
  color: var(--color-ink);
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
}

/* Cards (fieldsets/sections) */
.card {
  background: var(--color-canvas);
  border: 1px solid var(--color-hairline);
  border-radius: var(--radius-lg);
  padding: var(--space-lg);
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
}

.card > legend {
  padding: 0 var(--space-xs);
}

.row {
  display: flex;
  gap: var(--space-sm);
  align-items: center;
  flex-wrap: wrap;
}

/* Inputs */
.text-input {
  font-family: var(--font-body);
  font-size: 16px;
  line-height: 1.5;
  color: var(--color-ink);
  background: var(--color-canvas);
  border: 1px solid var(--color-hairline);
  border-radius: var(--radius-full);
  padding: var(--space-sm) var(--space-lg);
  height: 40px;
}

.text-input:focus {
  outline: none;
  border-color: var(--color-ink);
  box-shadow: 0 0 0 3px var(--color-focus-ring);
}

.code-input {
  font-family: var(--font-code);
  font-size: 16px;
  line-height: 1.5;
  color: var(--color-ink);
  background: var(--color-canvas);
  border: 1px solid var(--color-hairline);
  border-radius: var(--radius-lg);
  padding: var(--space-lg);
  min-height: 120px;
  resize: vertical;
}

.code-input:focus {
  outline: none;
  border-color: var(--color-ink);
  box-shadow: 0 0 0 3px var(--color-focus-ring);
}

/* Buttons */
.btn-primary {
  font-family: var(--font-body);
  font-size: 14px;
  font-weight: 500;
  line-height: 1;
  background: var(--color-primary);
  color: var(--color-on-primary);
  border: none;
  border-radius: var(--radius-full);
  padding: var(--space-sm) var(--space-xl);
  height: 36px;
  cursor: pointer;
}

.btn-primary:active {
  background: var(--color-ink-deep);
}

.btn-primary:disabled {
  background: var(--color-surface-soft);
  color: var(--color-mute);
  cursor: not-allowed;
}

.btn-secondary {
  font-family: var(--font-body);
  font-size: 14px;
  font-weight: 500;
  line-height: 1;
  background: var(--color-canvas);
  color: var(--color-ink);
  border: 1px solid var(--color-hairline-strong);
  border-radius: var(--radius-full);
  padding: var(--space-sm) var(--space-xl);
  height: 36px;
  cursor: pointer;
}

/* Tabs */
.tab-bar {
  display: flex;
  gap: var(--space-sm);
  padding: 0;
  margin: 0;
  flex-wrap: wrap;
}

.tab {
  font-family: var(--font-body);
  font-size: 14px;
  font-weight: 500;
  background: var(--color-surface-soft);
  color: var(--color-ink);
  border: none;
  border-radius: var(--radius-full);
  padding: var(--space-xs) var(--space-lg);
  cursor: pointer;
}

.tab[aria-current="true"] {
  background: var(--color-primary);
  color: var(--color-on-primary);
}

/* Code / JSON blocks */
.code-block {
  font-family: var(--font-code);
  font-size: 14px;
  line-height: 1.43;
  color: var(--color-ink);
  background: var(--color-canvas);
  border: 1px solid var(--color-hairline);
  border-radius: var(--radius-lg);
  padding: var(--space-lg);
  margin: 0;
  overflow-x: auto;
  white-space: pre-wrap;
  word-break: break-word;
}

/* Logs */
.log-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
}

.log-line {
  font-family: var(--font-code);
  font-size: 14px;
  line-height: 1.43;
}

.log-line--passed {
  color: var(--color-terminal-green);
}

.log-line--failed {
  color: var(--color-terminal-red);
}

.log-line--muted {
  color: var(--color-mute);
}

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

- [ ] **Step 3: Import the stylesheet**

In `packages/web/src/main.tsx`, change:

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
```

to:

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { App } from './App';
```

- [ ] **Step 4: Verify nothing broke**

Run: `pnpm --filter @ai-native-testing/web test`
Expected: PASS — all 47 tests, unchanged (this task touches no component and no test file; `main.tsx` isn't imported by any test, since tests render components directly).

Run: `pnpm --filter @ai-native-testing/web typecheck`
Expected: no errors (confirms `vite-env.d.ts` correctly resolves the CSS import).

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/vite-env.d.ts packages/web/src/styles.css packages/web/src/main.tsx
git commit -m "feat(web): add DESIGN.md tokens and base styles"
```

---

### Task 2: `App` + `ScreenplayHeader`

**Files:**
- Modify: `packages/web/src/App.tsx`
- Modify: `packages/web/src/components/ScreenplayHeader.tsx`

**Interfaces:**
- Consumes: `.app-main`, `.heading-xl`, `.alert`, `.row`, `.label`, `.text-input` from `styles.css` (Task 1).
- Produces: nothing new — no prop or type changes to either component.

- [ ] **Step 1: Style `App`**

In `packages/web/src/App.tsx`, change:

```tsx
  return (
    <main>
      <h1>API Runner — REST (Simple Mode)</h1>
      {error && <p role="alert">{error}</p>}
      <ScreenplayHeader
```

to:

```tsx
  return (
    <main className="app-main">
      <h1 className="heading-xl">API Runner — REST (Simple Mode)</h1>
      {error && (
        <p role="alert" className="alert">
          {error}
        </p>
      )}
      <ScreenplayHeader
```

- [ ] **Step 2: Style `ScreenplayHeader`**

Replace the entire contents of `packages/web/src/components/ScreenplayHeader.tsx` with:

```tsx
interface ScreenplayHeaderProps {
  actorName: string;
  onActorNameChange: (value: string) => void;
  taskName: string;
  onTaskNameChange: (value: string) => void;
}

export function ScreenplayHeader({
  actorName,
  onActorNameChange,
  taskName,
  onTaskNameChange,
}: ScreenplayHeaderProps) {
  return (
    <section className="row">
      <label className="label">
        Actor
        <input
          className="text-input"
          value={actorName}
          onChange={(e) => onActorNameChange(e.target.value)}
        />
      </label>
      <label className="label">
        Task
        <input
          className="text-input"
          value={taskName}
          onChange={(e) => onTaskNameChange(e.target.value)}
        />
      </label>
    </section>
  );
}
```

- [ ] **Step 3: Verify**

Run: `pnpm --filter @ai-native-testing/web test`
Expected: PASS — all 47 tests, unchanged (className additions don't affect roles/labels/values these tests query by).

Run: `pnpm --filter @ai-native-testing/web typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/App.tsx packages/web/src/components/ScreenplayHeader.tsx
git commit -m "style(web): apply DESIGN.md tokens to App and ScreenplayHeader"
```

---

### Task 3: `KeyValueRows`

**Files:**
- Modify: `packages/web/src/components/KeyValueRows.tsx`

**Interfaces:**
- Consumes: `.card`, `.heading-sm`, `.row`, `.text-input`, `.btn-secondary` from `styles.css` (Task 1).
- Produces: nothing new — no prop or type changes. This component is reused by the Variables editor (`App`) and `RequestBuilder`'s Params/Headers tabs, so its new styling automatically applies everywhere it's used.

- [ ] **Step 1: Style `KeyValueRows`**

Replace the entire contents of `packages/web/src/components/KeyValueRows.tsx` with:

```tsx
import type { KeyValueRow } from '../types';

interface KeyValueRowsProps {
  label: string;
  rows: KeyValueRow[];
  onChange: (rows: KeyValueRow[]) => void;
}

export function KeyValueRows({ label, rows, onChange }: KeyValueRowsProps) {
  function updateRow(id: string, field: 'key' | 'value', value: string) {
    onChange(rows.map((row) => (row.id === id ? { ...row, [field]: value } : row)));
  }

  function removeRow(id: string) {
    onChange(rows.filter((row) => row.id !== id));
  }

  function addRow() {
    onChange([...rows, { id: crypto.randomUUID(), key: '', value: '' }]);
  }

  return (
    <fieldset className="card">
      <legend className="heading-sm">{label}</legend>
      {rows.map((row) => (
        <div key={row.id} className="row">
          <input
            className="text-input"
            aria-label={`${label} key`}
            value={row.key}
            onChange={(e) => updateRow(row.id, 'key', e.target.value)}
          />
          <input
            className="text-input"
            aria-label={`${label} value`}
            value={row.value}
            onChange={(e) => updateRow(row.id, 'value', e.target.value)}
          />
          <button
            type="button"
            className="btn-secondary"
            aria-label={`Remove ${label} row`}
            onClick={() => removeRow(row.id)}
          >
            Remove
          </button>
        </div>
      ))}
      <button type="button" className="btn-secondary" onClick={addRow}>
        Add {label} row
      </button>
    </fieldset>
  );
}
```

- [ ] **Step 2: Verify**

Run: `pnpm --filter @ai-native-testing/web test`
Expected: PASS — all 47 tests, unchanged.

Run: `pnpm --filter @ai-native-testing/web typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/components/KeyValueRows.tsx
git commit -m "style(web): apply DESIGN.md tokens to KeyValueRows"
```

---

### Task 4: `SourceKindSelector`, `ExtractEditor`, `QuestionsEditor`

**Files:**
- Modify: `packages/web/src/components/SourceKindSelector.tsx`
- Modify: `packages/web/src/components/ExtractEditor.tsx`
- Modify: `packages/web/src/components/QuestionsEditor.tsx`

**Interfaces:**
- Consumes: `.text-input`, `.card`, `.heading-sm`, `.row`, `.btn-secondary` from `styles.css` (Task 1).
- Produces: nothing new — no prop or type changes to any of the three components.

- [ ] **Step 1: Style `SourceKindSelector`**

Replace the entire contents of `packages/web/src/components/SourceKindSelector.tsx` with:

```tsx
import type { SourceKind } from '../types';

const SOURCE_KINDS: SourceKind[] = ['status', 'header', 'jsonPath'];

interface SourceKindSelectorProps {
  value: SourceKind;
  onChange: (value: SourceKind) => void;
  ariaLabel: string;
}

export function SourceKindSelector({ value, onChange, ariaLabel }: SourceKindSelectorProps) {
  return (
    <select
      className="text-input"
      aria-label={ariaLabel}
      value={value}
      onChange={(e) => onChange(e.target.value as SourceKind)}
    >
      {SOURCE_KINDS.map((kind) => (
        <option key={kind} value={kind}>
          {kind}
        </option>
      ))}
    </select>
  );
}
```

- [ ] **Step 2: Style `ExtractEditor`**

Replace the entire contents of `packages/web/src/components/ExtractEditor.tsx` with:

```tsx
import type { ExtractRow } from '../types';
import { SourceKindSelector } from './SourceKindSelector';

interface ExtractEditorProps {
  rows: ExtractRow[];
  onChange: (rows: ExtractRow[]) => void;
}

export function ExtractEditor({ rows, onChange }: ExtractEditorProps) {
  function updateRow(id: string, patch: Partial<ExtractRow>) {
    onChange(rows.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  }

  function removeRow(id: string) {
    onChange(rows.filter((row) => row.id !== id));
  }

  function addRow() {
    onChange([...rows, { id: crypto.randomUUID(), source: 'jsonPath', path: '', rememberAs: '' }]);
  }

  return (
    <fieldset className="card">
      <legend className="heading-sm">Extract</legend>
      {rows.map((row) => (
        <div key={row.id} className="row">
          <SourceKindSelector
            ariaLabel="Extract source"
            value={row.source}
            onChange={(source) => updateRow(row.id, { source })}
          />
          {row.source !== 'status' && (
            <input
              className="text-input"
              aria-label="Extract path"
              value={row.path}
              onChange={(e) => updateRow(row.id, { path: e.target.value })}
            />
          )}
          <input
            className="text-input"
            aria-label="Remember as"
            value={row.rememberAs}
            onChange={(e) => updateRow(row.id, { rememberAs: e.target.value })}
          />
          <button
            type="button"
            className="btn-secondary"
            aria-label="Remove extract row"
            onClick={() => removeRow(row.id)}
          >
            Remove
          </button>
        </div>
      ))}
      <button type="button" className="btn-secondary" onClick={addRow}>
        Add extract row
      </button>
    </fieldset>
  );
}
```

- [ ] **Step 3: Style `QuestionsEditor`**

Replace the entire contents of `packages/web/src/components/QuestionsEditor.tsx` with:

```tsx
import type { QuestionRow } from '../types';
import { SourceKindSelector } from './SourceKindSelector';

interface QuestionsEditorProps {
  rows: QuestionRow[];
  onChange: (rows: QuestionRow[]) => void;
}

export function QuestionsEditor({ rows, onChange }: QuestionsEditorProps) {
  function updateRow(id: string, patch: Partial<QuestionRow>) {
    onChange(rows.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  }

  function removeRow(id: string) {
    onChange(rows.filter((row) => row.id !== id));
  }

  function addRow() {
    onChange([...rows, { id: crypto.randomUUID(), source: 'status', path: '', expected: '' }]);
  }

  return (
    <fieldset className="card">
      <legend className="heading-sm">Questions</legend>
      {rows.map((row) => (
        <div key={row.id} className="row">
          <SourceKindSelector
            ariaLabel="Question source"
            value={row.source}
            onChange={(source) => updateRow(row.id, { source })}
          />
          {row.source !== 'status' && (
            <input
              className="text-input"
              aria-label="Question path"
              value={row.path}
              onChange={(e) => updateRow(row.id, { path: e.target.value })}
            />
          )}
          <input
            className="text-input"
            aria-label="Expected value"
            value={row.expected}
            onChange={(e) => updateRow(row.id, { expected: e.target.value })}
          />
          <button
            type="button"
            className="btn-secondary"
            aria-label="Remove question row"
            onClick={() => removeRow(row.id)}
          >
            Remove
          </button>
        </div>
      ))}
      <button type="button" className="btn-secondary" onClick={addRow}>
        Add question row
      </button>
    </fieldset>
  );
}
```

- [ ] **Step 4: Verify**

Run: `pnpm --filter @ai-native-testing/web test`
Expected: PASS — all 47 tests, unchanged.

Run: `pnpm --filter @ai-native-testing/web typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/components/SourceKindSelector.tsx packages/web/src/components/ExtractEditor.tsx packages/web/src/components/QuestionsEditor.tsx
git commit -m "style(web): apply DESIGN.md tokens to SourceKindSelector, ExtractEditor, QuestionsEditor"
```

---

### Task 5: `RequestBuilder`

**Files:**
- Modify: `packages/web/src/components/RequestBuilder.tsx`

**Interfaces:**
- Consumes: `.card`, `.heading-md`, `.heading-sm`, `.row`, `.label`, `.text-input`, `.code-input`, `.tab-bar`, `.tab` from `styles.css` (Task 1); styled `KeyValueRows` (Task 3), `ExtractEditor`/`QuestionsEditor` (Task 4).
- Produces: nothing new — no prop or type changes.

- [ ] **Step 1: Style `RequestBuilder`**

Replace the entire contents of `packages/web/src/components/RequestBuilder.tsx` with:

```tsx
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
    <section className="card">
      <h2 className="heading-md">Request</h2>
      <div className="row">
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
      </div>

      <nav className="tab-bar">
        {TABS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            className="tab"
            aria-current={tab === id}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </nav>

      {tab === 'params' && <KeyValueRows label="Params" rows={params} onChange={onParamsChange} />}
      {tab === 'headers' && <KeyValueRows label="Headers" rows={headers} onChange={onHeadersChange} />}
      {tab === 'auth' && (
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
                  onChange={(e) => onAuthChange({ type: 'apiKey', header: e.target.value, value: auth.value })}
                />
              </label>
              <label className="label">
                Value
                <input
                  className="text-input"
                  value={auth.value}
                  onChange={(e) => onAuthChange({ type: 'apiKey', header: auth.header, value: e.target.value })}
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
      {tab === 'extract' && <ExtractEditor rows={extracts} onChange={onExtractsChange} />}
      {tab === 'questions' && <QuestionsEditor rows={questions} onChange={onQuestionsChange} />}
    </section>
  );
}
```

- [ ] **Step 2: Verify**

Run: `pnpm --filter @ai-native-testing/web test`
Expected: PASS — all 47 tests, unchanged (the `aria-current={tab === id}` boolean prop already renders as the string `"true"`/`"false"` in React for `aria-*` attributes, matching the `.tab[aria-current="true"]` CSS selector — this was already true before this task, unaffected by the `className` addition).

Run: `pnpm --filter @ai-native-testing/web typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/components/RequestBuilder.tsx
git commit -m "style(web): apply DESIGN.md tokens to RequestBuilder"
```

---

### Task 6: `ResultsPanel`

**Files:**
- Modify: `packages/web/src/components/ResultsPanel.tsx`

**Interfaces:**
- Consumes: `.card`, `.tab-bar`, `.tab`, `.body-strong`, `.code-block`, `.log-list`, `.log-line`/`.log-line--passed`/`.log-line--failed`/`.log-line--muted` from `styles.css` (Task 1).
- Produces: a new local (non-exported) helper `logLineClassName(line: string): string` — presentational only, derives a class name from a log line's existing text; does not read or change `DerivedResults`' shape.

- [ ] **Step 1: Style `ResultsPanel`**

Replace the entire contents of `packages/web/src/components/ResultsPanel.tsx` with:

```tsx
import { useState } from 'react';
import type { DerivedResults } from '../results';

type Tab = 'response' | 'savedValues' | 'context' | 'logs';

interface ResultsPanelProps {
  results: DerivedResults | null;
}

const TABS: { id: Tab; label: string }[] = [
  { id: 'response', label: 'Response' },
  { id: 'savedValues', label: 'Saved Values' },
  { id: 'context', label: 'Context' },
  { id: 'logs', label: 'Logs' },
];

function logLineClassName(line: string): string {
  if (line.includes('→ passed')) {
    return 'log-line log-line--passed';
  }
  if (line.includes('→ failed')) {
    return 'log-line log-line--failed';
  }
  return 'log-line log-line--muted';
}

export function ResultsPanel({ results }: ResultsPanelProps) {
  const [tab, setTab] = useState<Tab>('response');

  if (!results) {
    return <p className="body-strong">No run yet.</p>;
  }

  return (
    <section className="card">
      <nav className="tab-bar">
        {TABS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            className="tab"
            aria-current={tab === id}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </nav>
      {tab === 'response' && (
        <div>
          {results.response ? (
            <>
              <p className="body-strong">Status: {results.response.status}</p>
              <pre className="code-block">{JSON.stringify(results.response.headers, null, 2)}</pre>
              <pre className="code-block">{JSON.stringify(results.response.body, null, 2)}</pre>
            </>
          ) : (
            <p className="body-strong">No response yet.</p>
          )}
        </div>
      )}
      {tab === 'savedValues' && (
        <pre className="code-block">{JSON.stringify(results.savedValues, null, 2)}</pre>
      )}
      {tab === 'context' && <pre className="code-block">{JSON.stringify(results.context, null, 2)}</pre>}
      {tab === 'logs' && (
        <ul className="log-list">
          {results.logs.map((line, index) => (
            <li key={index} className={logLineClassName(line)}>
              {line}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
```

Note on `logLineClassName`: `deriveResults` (`packages/web/src/results.ts`, already built) always formats a log line as `` `${type} ${action} → ${status}` ``, with `(expected ..., got ...)` or `(error)` appended only on failure. So `line.includes('→ passed')` and `line.includes('→ failed')` are exact, unambiguous substring checks against that fixed format — not a fragile guess.

- [ ] **Step 2: Verify**

Run: `pnpm --filter @ai-native-testing/web test`
Expected: PASS — all 47 tests, unchanged (existing tests assert on the log line's full text content via `getByText`, which still matches — the `<li>` gains a `className` but its text content is identical).

Run: `pnpm --filter @ai-native-testing/web typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/components/ResultsPanel.tsx
git commit -m "style(web): apply DESIGN.md tokens to ResultsPanel"
```

---

### Task 7: `RunButton`

**Files:**
- Modify: `packages/web/src/components/RunButton.tsx`

**Interfaces:**
- Consumes: `.btn-primary` from `styles.css` (Task 1).
- Produces: nothing new — no prop or type changes.

- [ ] **Step 1: Style `RunButton`**

In `packages/web/src/components/RunButton.tsx`, change:

```tsx
  return (
    <button type="button" onClick={handleClick} disabled={disabled}>
      Run
    </button>
  );
```

to:

```tsx
  return (
    <button type="button" className="btn-primary" onClick={handleClick} disabled={disabled}>
      Run
    </button>
  );
```

- [ ] **Step 2: Verify**

Run: `pnpm --filter @ai-native-testing/web test`
Expected: PASS — all 47 tests, unchanged.

Run: `pnpm --filter @ai-native-testing/web typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/components/RunButton.tsx
git commit -m "style(web): apply DESIGN.md tokens to RunButton"
```

---

### Task 8: Final verification

**Files:** none created or modified — this task only runs checks.

**Interfaces:** none.

- [ ] **Step 1: Run the full workspace test suite and typecheck**

Run: `pnpm test`
Expected: PASS across all 5 packages (`engine`, `runner-api`, `runner-log`, `server`, `web`) — 120 tests total, none newly failing.

Run: `pnpm typecheck`
Expected: no errors in any package.

- [ ] **Step 2: Manual browser verification**

Start the backend (`pnpm --filter @ai-native-testing/server start`) and the GUI dev server (`pnpm --filter @ai-native-testing/web dev`) as described in the project's existing run instructions. Open `http://localhost:5173`, fill in a Task name and URL, click through each Request tab (Params/Headers/Auth/Body/Extract/Questions) and each Results tab (Response/Saved Values/Context/Logs), and run one real request. Confirm visually:

- The page heading renders in the larger rounded display font, black text on white.
- Every button and text input is fully pill-shaped (rounded corners all the way round).
- Fieldset groups (Variables, Params, Headers, Auth, Extract, Questions) render as bordered cards, not default browser fieldset boxes.
- The active tab in both tab bars is a solid black pill; inactive tabs are soft gray pills.
- JSON output (Response/Saved Values/Context) renders in a monospace, bordered code block.
- A passed log line reads in green, a failed one in red.

Take a screenshot as evidence, same as the manual verification done for the unstyled GUI earlier in this project.

- [ ] **Step 3: Commit (if the manual check surfaced any fix)**

If Step 2 finds nothing to fix, there is nothing to commit for this task — all styling was already committed task-by-task. If it does surface an issue, fix it, re-run Step 1, and commit:

```bash
git add -A
git commit -m "fix(web): correct visual issue found during manual DESIGN.md verification"
```
