# Dual Correlator Fields for Kafka Check Matching — Design

## Overview

`transLogV1` and `refundLog` messages carry two identifying fields for the same transaction: `appTransID` (a client-assigned string, known before a request is sent) and `transID` (a numeric id assigned by the backend as it processes the transaction). Today, `KafkaCheckStore` matching only ever checks incoming messages against `appTransID` — a check registered under a `transID` value (as the user did manually, pasting a real transaction's numeric id) can never resolve, even when the real message clearly exists in Kafka, because the consumer is looking at the wrong field. This surfaced from a real manual check that timed out to FAILED despite the message existing in the app's own logs.

This is not a UI change — the Manual Check form already accepts any string as "Transaction ID." It's a backend matching change: let the consumer try multiple candidate fields per topic, so a check registered under either `appTransID` or `transID` resolves correctly.

## Architecture

- `KafkaTopicDefinition.correlatorField: string` (`packages/server/src/kafka-check-definitions.ts`) becomes `correlatorFields: string[]`.
  - `transLogV1`: `['appTransID', 'transID']`
  - `refundLog`: `['appTransID', 'transID']`
  - `paymentAuth`: `['order_no']` — unchanged behavior, wrapped in a single-element array for a consistent shape across all three topics. Not extended with `trans_id` (also present in its required fields) since it wasn't requested and there's no known real-world need for it yet.
- `kafka-check-logic.ts`'s `extractCorrelatorValue(message, topic): string | undefined` becomes `extractCorrelatorValues(message, topic): string[]`, returning every candidate value actually present in the message, in the definition's field order (so `appTransID` is checked before `transID` for `transLogV1`/`refundLog`).
- `kafka-consumer.ts`'s `handleIncomingMessage` iterates the candidate values returned by `extractCorrelatorValues` and looks up a pending row for each in turn, stopping at (and resolving) the first match. This preserves current behavior exactly for `paymentAuth` (a single candidate, same as today) and for any topic where only one of the two fields happens to be present in a given message.
- **No changes to the Run-triggered auto-registration path** (`packages/web/src/kafkaChecks.ts`'s client-side `CORRELATOR_FIELDS` map, used by `RunButton` to extract a value from the outgoing request *before* it's sent). It continues to register under `appTransID` only — `transID` is assigned by the backend during processing and can't be known by the client in advance. This asymmetry is intentional: the two registration paths (auto vs. manual) have genuinely different information available to them at registration time.

## Edge Case (Accepted, Not Engineered Around)

If two separate pending checks exist for the same underlying transaction — one registered under its `transID`, another under its `appTransID` — a single incoming message will only resolve whichever candidate field is checked first (per the array order above) and find a match for. The other pending check remains `pending` until it times out via the existing 60-second sweep. This is a rare, self-inflicted scenario (registering the same transaction twice under different id schemes) and isn't worth extra complexity to prevent.

## Testing

- `kafka-check-logic.test.ts`: `extractCorrelatorValues` returns both candidate values when both fields are present in a `transLogV1`/`refundLog` message, returns a single value when only one is present, and returns an empty array when neither is present. `paymentAuth` continues to return exactly one value (regression coverage for the unchanged path).
- `kafka-consumer.test.ts`: `handleIncomingMessage` resolves a pending row registered under `transID` when the real message only matches on `transID` (the exact scenario that motivated this fix), resolves a pending row registered under `appTransID` as before (regression), and continues to ignore messages that match neither a pending row's key.
