# Kafka Baseline Store — Design

## Overview

This is Step 2 of 4 in the Kafka contract-testing initiative (Consumer module → **Baseline Store** → Diff Engine → Integration). It builds on Step 1's `collectKafkaMessages` (`packages/server/src/kafka-message-collector.ts`) to capture and version a "known-good" set of Kafka messages for a given real test run, so a later step (the Diff Engine) can compare a new run's messages against it.

Like Step 1, this coexists with — does not replace — the existing ad-hoc Kafka Check Tracking system.

## Architecture & Placement

- New Node-runnable scripts in `packages/web/scripts/`: `capture-baseline.ts` and `update-baseline.ts` (run via `tsx`, never bundled into the browser build).
- This is the one place in the codebase where `packages/web`'s existing `buildTestDefinition` (`dsl.ts`) and `extractCorrelatorValue` (`kafkaChecks.ts`) are used alongside `packages/server`'s `collectKafkaMessages` — confirmed during brainstorming as an acceptable, Node-script-only dependency from `packages/web` on `packages/server` (added to `packages/web/package.json`), distinct from the browser bundle's existing HTTP-only relationship with the server.
- Baseline files live at repo-root `kafka-baselines/{version}/{status}.json`, committed to git. `version` identifies the release of the *service under test* (a tag/commit string supplied by the caller) — not this QA platform's own version.

## Capture Flow

1. Run `tsx packages/web/scripts/capture-baseline.ts --step "<saved step name>" --version <version>` (exact flags finalized in the plan).
2. The script fetches the named saved step's content via the real running server's `GET /steps/:name` (the same endpoint the browser already uses), builds a `TestDefinition` via the existing `buildTestDefinition`, and extracts the trans_id via the existing `extractCorrelatorValue`.
3. It calls `collectKafkaMessages(...)` *before* POSTing the built definition to `/runs` — mirroring Step 1's "start collecting, then trigger the action" pattern, so the real API call and the Kafka collection run concurrently rather than sequentially.
4. The **actual observed terminal status** from the collector's result (not a pre-declared expectation) determines the output filename.
5. **No silent overwrites**: if `kafka-baselines/{version}/{status}.json` already exists, `capture-baseline.ts` errors out and refuses to write, directing the user to `update-baseline.ts` instead.
6. Baseline file shape:
   ```json
   {
     "capturedAt": "2026-08-12T10:00:00.000Z",
     "version": "v1.2.3",
     "status": "SUCCESS",
     "terminatedBy": "terminal-status",
     "durationMs": 4213,
     "messages": [ /* the real messages collectKafkaMessages returned */ ]
   }
   ```

## Dedicated Update Script

`update-baseline.ts` shares the same core capture logic as `capture-baseline.ts` but always overwrites the target file. Kept as a genuinely separate script rather than a flag on the capture script — a flag could be triggered accidentally; typing a distinct script name is a deliberate act, matching the explicit "no silent automatic overwrites, distinct update path" requirement.

## Testing

- The core capture logic (steps 2-4 above) is extracted into a plain, testable function — mocking `fetch` (for the step lookup) and `collectKafkaMessages` (for the Kafka side), so it's testable without a real server or broker. The thin CLI wrapper (argument parsing, file I/O) gets lighter coverage.
- Overwrite-protection is directly tested: capturing twice for the same `version`/`status` fails the second time; updating twice succeeds both times.
