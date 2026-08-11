# Manual Kafka Check Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a manual entry point to the "Check Kafka" page (`KafkaChecksPage.tsx`) — a transid textbox, a Kafka Topic select, and a "Check Kafka" button — that registers a check via the existing `registerKafkaCheck`/`POST /kafka-checks` and shows an inline PASSED/FAILED (with missing fields) result panel driven by the page's existing 3-second poll.

**Architecture:** Frontend-only. No backend/server changes — `POST /kafka-checks` and `GET /kafka-checks` already do everything needed. Two tasks: Task 1 adds the form and registration call; Task 2 adds the inline result panel that derives its state from the row list the page already polls.

**Tech Stack:** React + TypeScript (`packages/web`), Vitest + React Testing Library.

## Global Constraints

- No new backend routes, no new client functions beyond what already exists (`registerKafkaCheck`, `fetchKafkaChecks`, `KafkaCheckRow`, `KAFKA_TOPICS`, `KafkaTopic`) — this is a pure UI addition reusing existing capability, per the design spec's explicit "zero backend changes" decision.
- **Accepted limitation, not a bug to fix:** a transid whose Kafka message already flowed through before the check is registered will time out as `failed` after the existing 60-second server-side sweep — this plan does not add any lookup-into-the-past capability.
- Follow this file's existing conventions: `className="label"` wrapping inputs, `className="text-input"` on the input/select itself, `className="card"` for a bordered section, `role="alert"`/`className="alert"` for inline errors (matches `RunButton`/other pages' error patterns).
- TDD throughout: write the failing test, run it, confirm the failure, implement, run again, confirm the pass, typecheck, commit.

---

### Task 1: Manual check form (transid, topic, register)

**Files:**
- Modify: `packages/web/src/components/KafkaChecksPage.tsx`
- Test: `packages/web/test/components/KafkaChecksPage.test.tsx`

**Interfaces:**
- Consumes: `registerKafkaCheck(params: { message_id: string; name: string; topic: KafkaTopic }): Promise<void>` (already exists in `packages/web/src/kafkaChecks.ts`, throws on failure), `KAFKA_TOPICS: KafkaTopic[]` and `type KafkaTopic` (already exist in `packages/web/src/types.ts`).

- [ ] **Step 1: Write the failing tests**

Add to `packages/web/test/components/KafkaChecksPage.test.tsx`, as a new `describe` block after the existing `describe('KafkaChecksPage', ...)` block:

```tsx
describe('KafkaChecksPage — manual check form', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('renders the transid textbox, Kafka Topic select, and Check Kafka button', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve([]) }));
    render(<KafkaChecksPage />);
    expect(screen.getByLabelText('Transaction ID')).toBeInTheDocument();
    expect(screen.getByLabelText('Kafka Topic')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Check Kafka' })).toBeInTheDocument();
  });

  it('lists all three known topics as options', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve([]) }));
    render(<KafkaChecksPage />);
    const optionTexts = screen.getAllByRole('option').map((o) => o.textContent);
    expect(optionTexts).toEqual(expect.arrayContaining(['transLogV1', 'refundLog', 'paymentAuth']));
  });

  it('disables Check Kafka until both transid and topic are filled', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve([]) }));
    render(<KafkaChecksPage />);
    expect(screen.getByRole('button', { name: 'Check Kafka' })).toBeDisabled();

    await userEvent.type(screen.getByLabelText('Transaction ID'), 'tx-123');
    expect(screen.getByRole('button', { name: 'Check Kafka' })).toBeDisabled();

    await userEvent.selectOptions(screen.getByLabelText('Kafka Topic'), 'transLogV1');
    expect(screen.getByRole('button', { name: 'Check Kafka' })).toBeEnabled();
  });

  it('registers a check using the transid as both message_id and name', async () => {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === '/kafka-checks' && init?.method === 'POST') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<KafkaChecksPage />);
    await userEvent.type(screen.getByLabelText('Transaction ID'), 'tx-123');
    await userEvent.selectOptions(screen.getByLabelText('Kafka Topic'), 'paymentAuth');
    await userEvent.click(screen.getByRole('button', { name: 'Check Kafka' }));

    expect(fetchMock).toHaveBeenCalledWith('/kafka-checks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message_id: 'tx-123', name: 'tx-123', topic: 'paymentAuth' }),
    });
  });

  it('shows an inline error when registration fails', async () => {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === '/kafka-checks' && init?.method === 'POST') {
        return Promise.resolve({ ok: false, json: () => Promise.resolve({}) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<KafkaChecksPage />);
    await userEvent.type(screen.getByLabelText('Transaction ID'), 'tx-123');
    await userEvent.selectOptions(screen.getByLabelText('Kafka Topic'), 'paymentAuth');
    await userEvent.click(screen.getByRole('button', { name: 'Check Kafka' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not register the Kafka check. Please try again.');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @ai-native-testing/web test -- KafkaChecksPage.test.tsx`
Expected: FAIL — `getByLabelText('Transaction ID')` etc. find nothing; the form doesn't exist yet.

- [ ] **Step 3: Implement the form**

Replace `packages/web/src/components/KafkaChecksPage.tsx` in full:

```tsx
import { useEffect, useState } from 'react';
import { fetchKafkaChecks, registerKafkaCheck, type KafkaCheckRow } from '../kafkaChecks';
import { KAFKA_TOPICS, type KafkaTopic } from '../types';

const POLL_INTERVAL_MS = 3000;

export function KafkaChecksPage() {
  const [rows, setRows] = useState<KafkaCheckRow[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);

  const [transidInput, setTransidInput] = useState('');
  const [topicInput, setTopicInput] = useState<KafkaTopic | ''>('');
  const [registerError, setRegisterError] = useState<string | null>(null);

  useEffect(() => {
    fetchKafkaChecks().then(setRows);
    const id = setInterval(() => {
      fetchKafkaChecks().then(setRows);
    }, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  async function handleCheckKafka() {
    if (transidInput.trim() === '' || topicInput === '') {
      return;
    }
    try {
      await registerKafkaCheck({ message_id: transidInput, name: transidInput, topic: topicInput });
      setRegisterError(null);
    } catch {
      setRegisterError('Could not register the Kafka check. Please try again.');
    }
  }

  return (
    <main className="app-main">
      <h1 className="heading-xl">Check Kafka</h1>

      <section className="card">
        {registerError && (
          <p role="alert" className="alert">
            {registerError}
          </p>
        )}
        <label className="label">
          Transaction ID
          <input className="text-input" value={transidInput} onChange={(e) => setTransidInput(e.target.value)} />
        </label>
        <label className="label">
          Kafka Topic
          <select
            className="text-input"
            value={topicInput}
            onChange={(e) => setTopicInput(e.target.value as KafkaTopic | '')}
          >
            <option value="" disabled>
              — Select a topic —
            </option>
            {KAFKA_TOPICS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="btn-primary"
          disabled={transidInput.trim() === '' || topicInput === ''}
          onClick={handleCheckKafka}
        >
          Check Kafka
        </button>
      </section>

      {rows.length === 0 && <p className="body-strong">No Kafka checks yet.</p>}
      <ul className="step-browser-list">
        {rows.map((row) => (
          <li key={row.message_id}>
            <button
              type="button"
              className="step-browser-row"
              onClick={() => setExpanded(expanded === row.message_id ? null : row.message_id)}
            >
              <span className="step-browser-name">{row.name}</span>
              <span className="step-browser-meta">{row.topic}</span>
              <span className="step-browser-flows">{row.status}</span>
            </button>
            {expanded === row.message_id && (
              <pre className="code-block">
                {row.missingFields.length > 0
                  ? `Missing fields: ${row.missingFields.join(', ')}`
                  : JSON.stringify(row.matchedMessage, null, 2)}
              </pre>
            )}
          </li>
        ))}
      </ul>
    </main>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @ai-native-testing/web test -- KafkaChecksPage.test.tsx`
Expected: PASS (all tests, including the 4 pre-existing ones).

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @ai-native-testing/web typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/components/KafkaChecksPage.tsx packages/web/test/components/KafkaChecksPage.test.tsx
git commit -m "feat(web): add manual Kafka check form to the Check Kafka page"
```

---

### Task 2: Inline PASSED/FAILED result panel

**Files:**
- Modify: `packages/web/src/components/KafkaChecksPage.tsx`
- Test: `packages/web/test/components/KafkaChecksPage.test.tsx`

**Interfaces:**
- Consumes: the `rows` state already populated by the existing poll (Task 1 leaves this untouched).

- [ ] **Step 1: Write the failing tests**

Add to `packages/web/test/components/KafkaChecksPage.test.tsx`, as a new `describe` block:

```tsx
describe('KafkaChecksPage — inline result panel', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('shows a pending panel immediately after registering, before the tracked row appears in the polled list', async () => {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === '/kafka-checks' && init?.method === 'POST') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<KafkaChecksPage />);
    await userEvent.type(screen.getByLabelText('Transaction ID'), 'tx-123');
    await userEvent.selectOptions(screen.getByLabelText('Kafka Topic'), 'paymentAuth');
    await userEvent.click(screen.getByRole('button', { name: 'Check Kafka' }));

    expect(await screen.findByText('Pending…')).toBeInTheDocument();
  });

  it('shows PASSED once the tracked row resolves as passed in the polled list', async () => {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === '/kafka-checks' && init?.method === 'POST') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve([makeRow({ message_id: 'tx-123', status: 'passed' })]),
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<KafkaChecksPage />);
    await userEvent.type(screen.getByLabelText('Transaction ID'), 'tx-123');
    await userEvent.selectOptions(screen.getByLabelText('Kafka Topic'), 'paymentAuth');
    await userEvent.click(screen.getByRole('button', { name: 'Check Kafka' }));

    expect(await screen.findByText('PASSED')).toBeInTheDocument();
  });

  it('shows FAILED with the missing fields once the tracked row resolves as failed', async () => {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === '/kafka-checks' && init?.method === 'POST') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve([makeRow({ message_id: 'tx-123', status: 'failed', missingFields: ['mcc'] })]),
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<KafkaChecksPage />);
    await userEvent.type(screen.getByLabelText('Transaction ID'), 'tx-123');
    await userEvent.selectOptions(screen.getByLabelText('Kafka Topic'), 'paymentAuth');
    await userEvent.click(screen.getByRole('button', { name: 'Check Kafka' }));

    expect(await screen.findByText('FAILED')).toBeInTheDocument();
    expect(await screen.findByText('Missing fields: mcc')).toBeInTheDocument();
  });

  it('clears the panel and shows the error instead when a later registration fails', async () => {
    let postCount = 0;
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === '/kafka-checks' && init?.method === 'POST') {
        postCount += 1;
        return Promise.resolve({ ok: postCount === 1, json: () => Promise.resolve({}) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<KafkaChecksPage />);
    await userEvent.type(screen.getByLabelText('Transaction ID'), 'tx-123');
    await userEvent.selectOptions(screen.getByLabelText('Kafka Topic'), 'paymentAuth');
    await userEvent.click(screen.getByRole('button', { name: 'Check Kafka' }));
    expect(await screen.findByText('Pending…')).toBeInTheDocument();

    await userEvent.clear(screen.getByLabelText('Transaction ID'));
    await userEvent.type(screen.getByLabelText('Transaction ID'), 'tx-456');
    await userEvent.click(screen.getByRole('button', { name: 'Check Kafka' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not register the Kafka check. Please try again.');
    expect(screen.queryByText('Pending…')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @ai-native-testing/web test -- KafkaChecksPage.test.tsx`
Expected: FAIL — no "Pending…"/"PASSED"/"FAILED" text exists yet.

- [ ] **Step 3: Implement the result panel**

In `packages/web/src/components/KafkaChecksPage.tsx`:

1. Add tracked-id state alongside the existing form state:
   ```ts
   const [trackedMessageId, setTrackedMessageId] = useState<string | null>(null);
   ```
2. Update `handleCheckKafka` to set/clear it:
   ```ts
   async function handleCheckKafka() {
     if (transidInput.trim() === '' || topicInput === '') {
       return;
     }
     try {
       await registerKafkaCheck({ message_id: transidInput, name: transidInput, topic: topicInput });
       setRegisterError(null);
       setTrackedMessageId(transidInput);
     } catch {
       setRegisterError('Could not register the Kafka check. Please try again.');
       setTrackedMessageId(null);
     }
   }
   ```
3. Add a derived lookup and the panel JSX, right after the manual-check-form `<section className="card">` block and before the `{rows.length === 0 && ...}` empty-state line:
   ```tsx
   const trackedRow = rows.find((r) => r.message_id === trackedMessageId);
   ```
   (place this `const` right above the `return` statement, alongside other derived values — not inside the JSX)
   ```tsx
   {trackedMessageId && (
     <section className="card">
       <h2 className="heading-md">Result</h2>
       {!trackedRow || trackedRow.status === 'pending' || trackedRow.status === 'received' ? (
         <p className="body-strong">Pending…</p>
       ) : trackedRow.status === 'passed' ? (
         <p className="body-strong">PASSED</p>
       ) : (
         <>
           <p className="body-strong">FAILED</p>
           <p>Missing fields: {trackedRow.missingFields.join(', ')}</p>
         </>
       )}
     </section>
   )}
   ```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @ai-native-testing/web test -- KafkaChecksPage.test.tsx`
Expected: PASS (all tests, including Task 1's and the 4 originally pre-existing ones).

- [ ] **Step 5: Full workspace verification**

Run, from the repo root:
```bash
pnpm test
pnpm typecheck
```
Expected: all packages green, zero typecheck errors.

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/components/KafkaChecksPage.tsx packages/web/test/components/KafkaChecksPage.test.tsx
git commit -m "feat(web): add inline PASSED/FAILED result panel to the manual Kafka check"
```

- [ ] **Step 7: Manual verification**

Using the same fake/real broker setup already available for the original Kafka Check Tracking feature: start the backend and web dev server, navigate to "Check Kafka," and:
1. Confirm the form (Transaction ID, Kafka Topic, Check Kafka) renders above the existing historical list.
2. With no transaction in flight, type an arbitrary transid, pick a topic, click Check Kafka — confirm the panel shows "Pending…" and, after the existing 60-second timeout sweep, transitions to FAILED (since nothing will ever arrive for a made-up id) — this also confirms the accepted "can't look into the past" limitation behaves as designed rather than hanging forever.
3. Trigger a real message on that topic with a transid you've just registered (e.g. via a real Run against the fake broker, using the same transid as the correlator value) and confirm the panel transitions to PASSED (or FAILED with real missing fields, depending on the message content) once the consumer picks it up.
4. Confirm the manually-registered check also appears in the historical list below like any other row.
