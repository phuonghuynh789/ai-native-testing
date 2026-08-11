# Manual Kafka Check — Design

## Overview

Add a manual, on-demand entry point to the existing "Check Kafka" page: a transid textbox, a "Kafka Topic" combobox, and a "Check Kafka" button. Today, a Kafka check can only be registered as a side effect of clicking "Run" on a request in Simple Mode (`RunButton.tsx` extracts the correlator value from the outgoing request body/gRPC message). This adds a second, independent way to register a check — useful when the real transaction was triggered somewhere outside this tool (e.g. a mobile app, another test client, or a manually-run script) and the user just wants to verify its Kafka message using a known transaction id.

**Critical, explicitly accepted limitation:** the existing Kafka consumer (`packages/server/src/kafka-consumer.ts`) is register-then-wait only — it subscribes with `fromBeginning: false` and only matches messages that arrive *after* a pending row is registered, against a pre-existing pending row by correlator value. There is no admin client, no `seek()`, no offset/key-based lookup anywhere in this codebase. **This feature cannot look up a transaction whose Kafka message already flowed through before the user clicks "Check Kafka"** — if that's the case, the check will simply time out as FAILED after the existing 60-second sweep, identical to any other unmatched pending row today. This was surfaced and explicitly confirmed during brainstorming (the user's initial framing implied checking something already in the past; after learning the real constraint, they chose to proceed with register-then-wait rather than build genuinely new seek-back capability).

## Architecture & Data Flow

This is a **frontend-only** change — zero backend/server changes. The existing `POST /kafka-checks` route already accepts exactly `{ message_id, name, topic }` and creates a `pending` row (`packages/server/src/routes/kafka-checks.ts`); the existing `GET /kafka-checks` route already returns the full row list, including `status`/`missingFields`/`matchedMessage`. Both are reused verbatim.

- `KafkaChecksPage.tsx` gains a form (transid input, topic `<select>` sourced from the existing `KAFKA_TOPICS` constant in `packages/web/src/types.ts`, and a "Check Kafka" button) rendered above the existing polling list.
- On submit: `POST /kafka-checks` with `{ message_id: transid, name: transid, topic }` — the `name` field reuses the transid itself (no separate label input), matching how the row will display in both the new inline panel and the existing historical list.
- The page already polls `GET /kafka-checks` every 3 seconds (`POLL_INTERVAL_MS = 3000`) to render its historical list. The new inline result panel reuses that **same poll response** — no second network call — by finding the row whose `message_id` matches the most recently submitted transid.
- Resolution timing is entirely server-driven: the existing consumer resolves the row to `passed`/`failed` when/if a matching message arrives, and the existing 60-second timeout sweep (`sweepTimedOutChecks`) fails it if nothing arrives in time. The frontend does no timeout logic of its own — it just keeps rendering whatever status the polled row currently has.
- Because it's the same underlying store, the manually-registered check also appears as an ordinary entry in the historical list below, with no special-casing.

## UI & Interaction

- The "Check Kafka" button is disabled until both the transid field is non-blank and a topic is selected — mirroring existing disabled-until-valid patterns elsewhere in the app (e.g. the Run button).
- On submit, an inline result panel appears below the form showing the targeted row's current status:
  - `pending`: a pending/in-progress indicator.
  - `passed`: a pass indicator (styled like the existing list's passed status).
  - `failed`: a fail indicator plus the `missingFields` list, reusing the exact rendering the existing list's expand-detail view already uses for missing fields.
- The inline panel tracks only the single most-recently-submitted transid, not a history of manual checks — the historical list below already serves as that history (it includes both manually- and Run-registered checks, since they share one store).
- Submitting a transid that was already registered before (whether by this form or by a prior Run) overwrites that row fresh as `pending`, matching `KafkaCheckStore`'s existing keyed-by-`message_id` behavior — not a new edge case introduced by this feature.

## Error Handling

- `POST /kafka-checks` request failure (network error or non-2xx response): show an inline error message near the form; do not show a result panel.
- Blank transid or no topic selected: the button simply stays disabled — no separate error message is needed since submission isn't possible.

## Testing

- `KafkaChecksPage.test.tsx` gains cases for: the form rendering with the topic options from `KAFKA_TOPICS`, the button staying disabled until both fields are filled, a successful submit calling `POST /kafka-checks` with the expected body, the inline panel reflecting `pending` → `passed`/`failed` as the polled list updates, and the submitted check also appearing as a row in the historical list below.
- Manual verification: register a real check via this new form against the same fake/real broker setup already used for the original Kafka Check Tracking feature, and confirm it resolves identically to a Run-triggered registration (same store, same consumer, same timeout sweep).
