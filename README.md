# AI-Native Testing Platform

An AI-native QA platform built around the **Screenplay Pattern** (Actor → Ability → Task → Interaction → Question). The full vision spans six runners — API, UI, Database/Kafka/Redis, AI, Incident, and Performance (K6) — see [`docs/PRD.md`](docs/PRD.md) for the complete product spec.

This repo is being built incrementally: each increment gets its own design spec and implementation plan under [`docs/superpowers/specs/`](docs/superpowers/specs/) and [`docs/superpowers/plans/`](docs/superpowers/plans/) before it's coded.

## Status

- ✅ **Screenplay Engine (Core)** — domain model, JSON/YAML DSL, fail-fast Task Dispatcher, Fastify API with SSE event streaming.
- ✅ **API Runner** — REST support (`RestRunner`): requests, auth (Bearer/API key/Basic), JSONPath assertions.
- ✅ **REST GUI (Simple Mode)** — single-page builder for one REST test, styled per `DESIGN.md`.
- ✅ **Actor/Task dropdown** — reusable Actor/Task names, persisted to disk.
- ✅ **Paste cURL** — import a cURL command straight into the request builder.
- ✅ **Save as Reusable Step** — save/load a full request as a named, reusable step.
- ✅ **Add to E2E Flow** — chain saved steps into a named flow and run them as one multi-task test.
- ✅ **gRPC Runner** — protocol toggle, dynamic `.proto` loading, Service/Method suggestions, grpcurl import, mixed REST+gRPC flows.
- ✅ **gRPC TLS support** — Secure/Skip-certificate-verification toggles, grpcurl `-plaintext`/`-insecure` import.
- ✅ **Left menu navigation** — Simple Mode, End-to-end test, API Automation, and Check Kafka as separate pages.
- ✅ **E2E flow drag-and-drop builder** — reorder and remove a flow's steps via native drag-and-drop before running.
- ✅ **API Automation browser** — search every saved gRPC step by Service/Method/E2E flow, jump straight into Simple Mode.
- ✅ **API Automation Run** — batch-execute the filtered gRPC steps independently, Passed/Failed shown per step.
- ✅ **Kafka Check Tracking** — verify a run's transaction was published to Kafka with all required fields, tracked asynchronously on a dedicated page.
- 🚧 Next: UI Runner, then the remaining Database/Redis pieces, AI, Incident, and Performance (K6) runners.

`docs/PRD_APIRunner.md` also describes a larger API Runner vision (Step Repository, E2E Flow Builder, gRPC/GraphQL, Advanced Mode) that's deliberately being built up to in small, walking-skeleton increments rather than all at once.

## Project structure

A pnpm workspace monorepo:

| Package                 | Description                                                                 |
| ------------------------ | ---------------------------------------------------------------------------- |
| `packages/engine`        | Screenplay domain model, DSL/schema validation, Task Dispatcher              |
| `packages/runner-log`    | A minimal example runner (logs a message)                                   |
| `packages/runner-api`    | REST runner — HTTP requests, auth helpers, JSONPath-lite assertions          |
| `packages/runner-grpc`   | gRPC runner — dynamic proto loading, unary calls, plaintext/TLS              |
| `packages/server`        | Fastify backend: run/step/flow/Kafka-check persistence, SSE run events, background Kafka consumer |
| `packages/web`           | React + Vite frontend — API Runner: Simple Mode, End-to-end test, API Automation, Check Kafka |

## Getting started

Requires Node.js ≥ 20 and [pnpm](https://pnpm.io/).

```bash
pnpm install
```

Run everything:

```bash
pnpm test        # run all package test suites
pnpm typecheck   # typecheck all packages
```

Run the app locally (two terminals):

```bash
pnpm --filter @ai-native-testing/server start   # backend on http://localhost:3000
pnpm --filter @ai-native-testing/web dev        # frontend on http://localhost:5173
```

Then open http://localhost:5173.

Check Kafka is optional: without `packages/server/config/kafka.yaml`, the server boots normally with the feature disabled (logs a warning). To enable it, copy `packages/server/config/kafka.yaml.example` to `kafka.yaml` (gitignored) and fill in real broker addresses.

## Tech stack

TypeScript throughout, Fastify (backend), React + Vite (frontend), Vitest (tests), `kafkajs` + `js-yaml` (Kafka check consumer/config), `@grpc/grpc-js` + `@grpc/proto-loader` (gRPC runner), plain `fs/promises`-backed JSON files for persistence (no database yet).
