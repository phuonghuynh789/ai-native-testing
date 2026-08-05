# Kafka Check Tracking — Design Spec

## Goal

Add a "Check Kafka" checkbox to Simple Mode's Request card that, when enabled, registers an async tracking record for the current run's transaction and a background consumer independently verifies — once ZaloPay's real backend publishes the corresponding Kafka message — that message contains all the fields required for that topic. Results surface on a new "Check Kafka" left-menu page as PENDING → PASSED/FAILED, not inline in the run's results.

## Scope

**In scope:**
- A "Check Kafka" checkbox + a "Kafka Topic" `<select>` (three options: `transLogV1`, `refundLog`, `paymentAuth`) in Simple Mode's Request card, for both REST and gRPC.
- On Run, if enabled: the web app pulls a correlator value out of the current request body/gRPC message and registers a tracking record (`POST /kafka-checks`) in parallel with the normal run — the REST/gRPC run itself, the engine, the dispatcher, and the existing results/SSE model are **completely unchanged**.
- A long-lived background Kafka consumer per topic, started when `packages/server` boots, that matches incoming messages to PENDING tracking records by correlator value and checks required-field presence.
- A periodic timeout sweep that marks PENDING records FAILED if no matching message arrives within 60 seconds.
- A new "Check Kafka" left-menu page listing every tracking record (message_id, name, topic, status, updated_at), with click-to-expand full matched-message detail.
- Config split: real broker/topic/groupID addresses in a gitignored `packages/server/config/kafka.yaml` (a `.example` template with placeholder values is committed); per-topic correlator field name and required-fields list live in TypeScript source (`kafka-check-definitions.ts`), since those are business rules, not infrastructure.
- Three topics fully specified this increment: `transLogV1` (topic `ZPReportTransLogQC`), `refundLog` (topic `ZPReportTransLog`), `paymentAuth` (topic `payment_authentication_auth_session_status_qc`).

**Out of scope (deliberately deferred):**
- `disburseLog` — the yaml config slot exists, but no topic option appears in the UI and no check runs until a field list/example is provided.
- Any change to the engine, `RunnerRegistry`, `dsl.ts`, or the step/question model — this feature does not need a new Runner/ability.
- A genuinely separate standalone service/process — this lives inside `packages/server`, same process, same deploy.
- Inline/blocking Kafka verification in Simple Mode's results panel — results only ever appear on the new Check Kafka page.
- Pagination on `GET /kafka-checks`.
- Automated end-to-end testing against a real Kafka broker (see Risks).

## Data Model & Correlation

Each of the three in-scope topics defines:
- **Correlator**: the field name matched between the caller's request body and the Kafka message. `transLogV1` and `refundLog` both correlate on `appTransID` (present in both real examples). `paymentAuth` correlates on `order_no` — **this is my best-guess default, not confirmed against a real request shape; flagging for your review.**
- **Required fields** (presence-only — a field counts as present if the key exists in the parsed JSON, regardless of whether its value is empty/null; nested objects like `additionalTransInfo` are checked as a single key, not expanded):
  - `transLogV1`: `transID, appID, transType, pmcID, amount, userChargeAmount, userFeeAmount, transStatus, status, userID, appTransID, isFullFlow, authInfo, merchantCategoryCode, productType, orderNo, paymentNo, paymentMethod, destTxnStatus, sourceTxnStatus, destAssetType, destAssetData, sourceAssetData` (your original curated list, checked inside the message's `data` object).
  - `refundLog`: `transID, appID, appTransID, transType, pmcID, amount, userChargeAmount, userFeeAmount, transStatus, bankCode, ccBankCode, refundType, refundStatus, internalRefundStatus, refundCaller, refundAmount, requestRefundAmount, requestRefundFeeAmount, refundReasonType, refundResponse, refundID, refundBeginDate, refundEndDate, mRefundID, isRefundByChargeAmount, callApiBeginDate, callApiEndDate, isFinal, discountAmount, remainingAmount, userId, refundDescription, applyRevamp, promotionRefundAmount, userFeeRefundAmount, productCode, eventCode, mcc, additionalTransInfo, eventContext, paymentNo, status, internalStatus` (every field found in `data` in your example, checked inside the message's `data` object; logging/tracing fields like `trace_id`, `kafka.consumer.topic`, `spanId` excluded as log-shipping metadata, not payment data).
  - `paymentAuth`: `payment_no, order_no, auth_session_id, auth_data, trans_id, fund_type, detail_reason, transaction` (checked at the top level of the message — this topic's messages have no `data` wrapper).
- The `message_id` used as the tracking record's primary key **is** the correlator value itself (the `appTransID`/`order_no` pulled from the request body) — no separate tracking ID is minted.

## Architecture & Data Flow

**On Run (web, `RunButton.tsx`):** if `form.kafkaCheck.enabled`, extract the topic's correlator field from `form.body` (REST) or `form.grpc.requestMessage` (gRPC), parsed as JSON. If the field is missing, show an inline error via the existing `onError` callback and skip registration (the REST/gRPC run itself still proceeds normally). Otherwise, fire `POST /kafka-checks` with `{message_id, name: form.taskName, topic}` — not awaited before/blocking the run start.

**Server (`packages/server`):**
- `kafka-check-store.ts`: flat JSON store at `data/kafka-checks.json` (gitignored, matching `steps.json`/`flows.json`), same read/write pattern as `StepStore`. Row shape: `{message_id, name, topic, status: 'pending'|'received'|'passed'|'failed', missingFields: string[], matchedMessage: unknown | null, created_at, updated_at, retry_count}`.
- `kafka-config.ts`: loads `config/kafka.yaml` at boot (via `js-yaml`) for `groupID` + per-topic `brokers`/`topic`.
- `kafka-check-definitions.ts`: the correlator field name + required-fields list per topic, as plain TypeScript data (see Data Model above).
- `kafka-consumer.ts`: for each of the 3 topics, on server boot, connects one `kafkajs` consumer (unique consumer group per topic, e.g. `${groupID}-${topic}`, subscribed from `fromBeginning: false` so only new messages are seen). On each message: parse the value as JSON, read the correlator field, look up a `pending` row with matching `message_id`+`topic` in the store; if found, mark `received`, run the required-fields check, set `passed`/`failed` (+`missingFields`, +`matchedMessage`). A `setInterval` sweep (every 5s) marks `pending` rows older than 60s as `failed` (`missingFields: ['(timeout: no message received)']`), incrementing `retry_count` each sweep.
- `routes/kafka-checks.ts`: `POST /kafka-checks` (create a `pending` row), `GET /kafka-checks` (list all rows, newest first).

**New "Check Kafka" page (web):** fetches `GET /kafka-checks` on mount, renders a table (message_id, name, topic, status, updated_at), clicking a row expands `matchedMessage`/`missingFields` inline (reusing the existing JSON-viewer styling from `ResultsPanel`).

## Known Risks

1. **Message shape uncertainty**: the example messages you provided read like application log lines (a `topic, recordMetadata=...` prefix, logger fields like `spanId`/`traceId` mixed in) rather than raw Kafka message bytes. The actual `message.value` kafkajs receives on the wire may not match this shape exactly — parsing logic will likely need adjustment once tested against the real broker.
2. **Network reachability**: the broker addresses (`10.50.x`, `10.60.x`) are internal ZaloPay network IPs, unreachable from this development/testing environment. Automated end-to-end verification against the real, live consumer is not possible here — that verification happens in your own environment once this ships.

## Testing

- Pure-function unit tests: required-fields presence checker, correlator-value extractor (web-side, pulling the field out of a JSON body), and the message-handling function (parse → correlate → update store) — all directly testable with hand-crafted JSON, no real Kafka connection.
- `KafkaCheckStore` tests mirror `StepStore`'s existing test pattern (create/list/update).
- `POST`/`GET /kafka-checks` route tests mirror `steps-routes.test.ts`, with the background consumer/sweep not started during tests.
- Timeout-sweep logic tested with injected timestamps rather than real elapsed time.
- Frontend: checkbox/dropdown render + validation-error test on `RequestBuilder`/`RunButton`, the new page's list/expand behavior, `Sidebar`/`App.tsx` nav/route wiring — all mirroring existing component test conventions in this codebase.
- No automated test against a real Kafka broker (see Risks).
