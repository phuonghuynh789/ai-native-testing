# Paste cURL — Design Spec

## Goal

Add a "Paste cURL" tab to the API Runner REST GUI's Request tab bar, positioned right after "Body", so a user can paste a cURL command (e.g. copied from browser DevTools or API docs) and have it populate Method, URL, Headers, and Body in one step, instead of manually re-entering them.

This is a standalone increment, deliberately kept separate from the Actor/Task dropdown persistence work that shipped just before it.

## Scope

**In scope:**
- A new "cURL" tab in `RequestBuilder`'s tab bar (`packages/web/src/components/RequestBuilder.tsx`), between "Body" and "Extract".
- Parsing a pasted cURL command string into Method, URL, Headers, Body.
- An explicit "Import" button — nothing changes until the user clicks it.
- Inline success/error feedback within the tab.

**Out of scope (deliberately deferred):**
- Splitting the URL's query string into the Params tab.
- Populating the Auth tab from `-u`/`--user` (it becomes a raw `Authorization: Basic ...` header instead).
- Full POSIX shell parsing (`$VAR` expansion, command substitution, nested quoting beyond one level).
- Any backend/API change — this is entirely a `packages/web` frontend feature. The pasted text is transient local UI state, not part of `FormState`, and is never persisted or sent to the server.
- "Copy as cURL" (exporting the current form back to a cURL command) — this spec is import-only.

## Architecture

Two new files, plus a small addition to `RequestBuilder.tsx`:

- **`packages/web/src/curl.ts`** — pure parsing logic (no React, no DOM). Exports:
  ```ts
  export function parseCurl(input: string): CurlParseResult;

  export type CurlParseResult =
    | { ok: true; method: string; url: string; headers: KeyValueRow[]; body: string }
    | { ok: false; error: string };
  ```
- **`packages/web/src/components/CurlImport.tsx`** — the tab's UI component:
  ```ts
  export interface CurlImportProps {
    onImport: (result: { method: string; url: string; headers: KeyValueRow[]; body: string }) => void;
  }
  ```
- **`RequestBuilder.tsx`** — add `'curl'` to the `RequestTab` union and to the `TABS` array (between `'body'` and `'extract'`), and render:
  ```tsx
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
  ```
  No new props are added to `RequestBuilder` itself — it already owns `onMethodChange`/`onUrlChange`/`onHeadersChange`/`onBodyChange`.

## Parsing Rules

`parseCurl` uses a small shell-like tokenizer, not a full POSIX shell parser — scoped to what real "Copy as cURL" output from browser DevTools and API docs actually produces:

- **Line continuations**: `\`-terminated lines are joined before tokenizing (handles DevTools' multi-line copy format).
- **Quoting**: single-quoted and double-quoted tokens support basic backslash-escaping of the surrounding quote character inside them; unquoted tokens split on whitespace. No `$VAR` expansion, no command substitution.
- **Recognized flags**:
  - `-X` / `--request <METHOD>`
  - `-H` / `--header "<Key>: <Value>"` (repeatable)
  - `-d` / `--data` / `--data-raw` / `--data-binary` / `--data-ascii <BODY>`
  - `-u` / `--user <user:pass>`
  - `--url <URL>`, or a bare positional URL argument
- **Ignored flags** (never cause failure, simply skipped): everything not listed above — e.g. `-k`, `--compressed`, `-L`/`--location`, `-F`/`--form`, `-b`/`--cookie`, `-A`/`--user-agent`, `-s`/`--silent`, `-v`/`--verbose`.
- **Method inference**: explicit `-X`/`--request` always wins. Otherwise, any `-d`/`--data*` flag present ⇒ method is `POST`. Otherwise ⇒ `GET`.
- **Multiple `-d`/`--data*` flags**: only the **last** one is used. (Real cURL joins repeated `-d` values with `&`, which only makes sense for form-encoded bodies — this GUI's Body tab targets JSON, so joining would produce invalid JSON. Using the last value is simpler and matches the common case of exactly one `-d`.)
- **`-u user:pass`**: converted into an appended header `Authorization: Basic <base64(user:pass)>` (not routed into the Auth tab — see Out of scope).
- **Supported methods**: `GET`, `PUT`, `POST`, `PATCH`, `DELETE` (matches the existing Method dropdown in `RequestBuilder`). Any other method is a parse error.

**Parse failure (`ok: false`) cases:**
- Input doesn't start with `curl` (after trimming whitespace).
- No URL found (`--url`, no bare positional argument).
- An explicit `-X`/`--request` method that isn't one of the five supported methods.

## Component Behavior

- `CurlImport` holds local state: `text` (textarea contents) and `message` (`{ type: 'success' | 'error'; text: string } | null`).
- The Import button is **disabled when `text.trim() === ''`** — there is no "empty input" error state, since there's nothing to click.
- Clicking Import calls `parseCurl(text)`:
  - **Success**: calls `onImport({ method, url, headers, body })`; sets `message` to a success confirmation. The textarea **keeps its text** — a successful import doesn't clear it, so the user can tweak and re-import.
  - **Failure**: sets `message` to the parse error text; `onImport` is **not** called, so Method/URL/Headers/Body are left completely untouched.
- Re-clicking Import after editing the textarea re-parses and re-applies (or re-errors) with no additional "dirty" tracking.

## Testing Plan

- **`packages/web/test/curl.test.ts`** (new) — `parseCurl` unit tests:
  - Simple `GET` (bare `curl https://api.example.com/x`)
  - `POST` via explicit `-X POST` with a `-d` JSON body
  - `POST` inferred from `-d` alone (no `-X`)
  - Multiple `-H` flags → multiple header rows, including a value containing a colon (e.g. `Authorization: Bearer abc:def`)
  - `-u user:pass` → appends a Base64-encoded `Authorization: Basic ...` header
  - Multi-line command with trailing `\` continuations
  - Multiple `-d` flags → only the last one wins
  - An ignored flag present (e.g. `-F foo=bar`, `--compressed`) → still parses successfully
  - Errors: doesn't start with `curl`; no URL present; unsupported method (e.g. `-X HEAD`)

- **`packages/web/test/components/CurlImport.test.tsx`** (new) — component tests:
  - Import disabled when textarea is empty
  - Valid paste + click Import → `onImport` called with the correct parsed shape
  - Invalid paste + click Import → error message shown, `onImport` NOT called, textarea text preserved
  - After a successful import, textarea still shows the pasted text and a success message appears

- **`packages/web/test/components/RequestBuilder.test.tsx`** (existing, extend) — add a case confirming the "cURL" tab appears after "Body", and that completing an import through it calls through to the existing `onMethodChange`/`onUrlChange`/`onHeadersChange`/`onBodyChange` props.

No backend tests — this feature is entirely within `packages/web`.
