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
- 🚧 Next: UI Runner, then Database/Kafka/Redis, AI, Incident, and Performance (K6) runners.

`docs/PRD_APIRunner.md` also describes a larger API Runner vision (Step Repository, E2E Flow Builder, gRPC/GraphQL, Advanced Mode) that's deliberately being built up to in small, walking-skeleton increments rather than all at once.

## Project structure

A pnpm workspace monorepo:

| Package                 | Description                                                                 |
| ------------------------ | ---------------------------------------------------------------------------- |
| `packages/engine`        | Screenplay domain model, DSL/schema validation, Task Dispatcher              |
| `packages/runner-log`    | A minimal example runner (logs a message)                                   |
| `packages/runner-api`    | REST runner — HTTP requests, auth helpers, JSONPath-lite assertions          |
| `packages/server`        | Fastify backend: `POST /runs`, SSE run events, Actor/Task/Step persistence  |
| `packages/web`           | React + Vite frontend: the REST GUI (API Runner, Simple Mode)                |

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

Run the REST GUI locally (two terminals):

```bash
pnpm --filter @ai-native-testing/server start   # backend on http://localhost:3000
pnpm --filter @ai-native-testing/web dev        # frontend on http://localhost:5173
```

Then open http://localhost:5173.

## Tech stack

TypeScript throughout, Fastify (backend), React + Vite (frontend), Vitest (tests), plain `fs/promises`-backed JSON files for persistence (no database yet), no external dependencies beyond what's listed per package.
