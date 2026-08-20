# Sprint Report Design

## Context

A new, standalone feature: a "Sprint Report" page that pulls real data from a self-hosted Jira instance (`jira.zalopay.vn`) via JQL and renders a 4-part report (Sprint Delivery Summary, Quality Report, Impact Analysis Review, Executive Summary) across 5 project/domain rows, for the user's Head QE. This is unrelated to the platform's existing Screenplay/Runner/Kafka-contract-testing work — it's a new domain (Jira sprint reporting) added to the same app shell (same Sidebar, same server).

## Architecture

The browser never talks to Jira directly or sees the Jira credential. A new gitignored `packages/server/config/jira.yaml` (mirroring the existing `kafka.yaml` convention) holds the base URL and a Personal Access Token:

```yaml
baseUrl: https://jira.zalopay.vn
token: <personal access token>
```

Server-side, a `jira-client.ts` module wraps Jira's REST API (`GET /rest/api/2/search` with a `jql` query param, `fields=summary,status,priority,customfield_XXXXX,...`), sending `Authorization: Bearer <token>`. This module is the only place that constructs Jira HTTP requests, and it's the seam mocked in every test — no test ever calls the real Jira API, mirroring the `kafkajs`-mocking convention already established for Kafka work.

Flow: the user fills in Sprint Code, Start Date, End Date, and a Labels list on the Sprint Report page, clicks "Generate" → the server runs 4 JQL searches → groups results into 5 rows → computes every auto field → merges with any previously-saved manual fields for that sprint code → returns the full report to render. An explicit "Save" button persists the current state (computed + manual) to a new `SprintReportStore`.

## JQL Queries & Data Model

All four searches are templated with `{start}`/`{end}` (`YYYY/MM/DD`, from the Start Date/End Date inputs), `{end+1}` (the day after `{end}`, `YYYY/MM/DD`), and `{labels}` (comma-separated, from the Labels input):

**Committed** (Sprint Delivery Summary):
```
project in (PC, PCFUM, PCPOP) AND created >= "{start}" AND created <= "{end}"
AND type in (Task, Story) AND type != Bug AND reporter != jira-webhook-bot
AND status != Cancelled AND labels in ({labels})
```

**[Updated 2026-08-20]** Real dogfooding against `jira.zalopay.vn` showed this date-range approach doesn't match the user's actual Committed scope — sprints are tracked by Jira's native Sprint field, not `created` date, and each of the 3 projects names its sprints with its own template. Replaced with a Sprint-name match, **Committed only** (Delivered/Ready-for-Test above are unaffected and keep the date-range + `labels` approach):
```
reporter != jira-webhook-bot AND type in (Task, Story) AND status != Cancelled
AND Sprint in ("PCDPC - Sprint {sprintCode}","PCF-UM {sprintCode}","OPF - {sprintCode}")
```
`{sprintCode}` is the report's own Sprint Code input (e.g. `26.08.B`) substituted into each project's sprint-name template — `PCDPC - Sprint {sprintCode}` for `PC`, `PCF-UM {sprintCode}` for `PCFUM`, `OPF - {sprintCode}` for `PCPOP`. `project in (...)`, `created >=/<=`, `type != Bug`, and `labels in (...)` are dropped entirely for Committed, since Sprint membership already scopes precisely to the right issues. Also, an empty `labels` list must omit the `labels in (...)` clause rather than emit `labels in ()`, which Jira rejects as invalid JQL — found the same way, via a real Jira error response.

**Delivered** (Sprint Delivery Summary) — `type`/`labels` added to match Committed's scope, so Predictability % compares the same population at two points in its lifecycle:
```
status changed to Done during ("{start}", "{end}")
AND NOT status changed to Done during ("{end+1}", "2027/12/31")
AND statusCategory = Done AND status in (Done, Live)
AND project in (PC, PCFUM, PCPOP) AND type in (Task, Story) AND labels in ({labels})
```

**Ready for Test** (Sprint Delivery Summary; also supplies the Impact Analysis population) — same `type`/`labels` addition:
```
status changed to "Ready for Testing" during ("{start}", "{end}")
AND NOT status changed to "Ready for Testing" during ("{end+1}", "2027/12/31")
AND project in (PC, PCFUM, PCPOP) AND type in (Task, Story) AND labels in ({labels})
```

**New** (Sprint Delivery Summary) — **[Added 2026-08-20]** same Sprint-name scope as Committed, narrowed to tickets that haven't progressed past New yet:
```
reporter != jira-webhook-bot AND type in (Task, Story) AND status != Cancelled
and status not in ("ready for testing", "In test", Done)
AND Sprint in ("PCDPC - Sprint {sprintCode}","PCF-UM {sprintCode}","OPF - {sprintCode}")
```

**Bugs** (Quality Report) — deliberately no `labels` filter (bugs can be reported by anyone, not just the team):
```
type = Bug AND created >= "{start}" AND created <= "{end}"
AND NOT (reporter = automationtest_bot AND project = PQED)
AND project IN (PC, PCPOP, PCFUM)
```

**Impact Analysis** issues a zero extra queries: it reuses the *Ready for Test* result set directly. For each of those issues, the server fetches the issue's description and its comments (`GET /rest/api/2/issue/{key}?fields=description&expand=renderedFields` plus `GET /rest/api/2/issue/{key}/comment`) and checks, case-insensitively, whether any of `"IA"`, `"Technical Impact"`, `"Impact Analysis"` appears as a substring anywhere in that combined text.

**Row grouping:** every result set is grouped first by the issue's `project.key` into `PC` and `PCFUM` rows directly. `PCPOP` issues are further split by the `Product Domain` custom field value into three rows: `Merchant Platform` → `PCPOP_MP`, `Customer Experience` → `PCPOP_UO`, `Reconciliation Core` → `PCPOP_RC`. This produces exactly 5 rows, applied consistently across all 4 report sections (including the Executive Summary — confirmed not to use a different rollup).

**[Updated 2026-08-20]** Row key renamed `PCPOP_CE` → `PCPOP_UO` (cosmetic, matching the squad's actual short name). The middle `PCPOP` domain's Jira `Product Domain` value briefly changed to `User Operation` during dogfooding on a hunch that `Customer Experience` was why the row came back empty, but that also came back empty — reverted back to `Customer Experience` per direct confirmation from a real Jira lookup. The row still showed all zeros with either value in every real report generated so far; whether that's a genuinely empty squad for those sprints or a still-undiagnosed separate issue is not yet confirmed.

**Field mappings:**
- Story Points: the `Story Points` field, summed per row for Committed/Delivered/Ready-for-Test.
- Bug severity: the `Priority` field — `Highest` → Critical, `High`/`Medium` → Major, `Low`/`Lowest` → Minor.
- Prod Bug: the `Bug in Environments:` field contains `Production`.
- **[Added 2026-08-20]** Sandbox Date: the `Sandbox Date` field, a plain date string, used only in the Root Cause table.

## Section-by-Section: Auto-Computed vs. Manual

**1. Sprint Delivery Summary**
- Auto: Committed Tickets/SP, Delivered Tickets/SP, Ready-for-Test Tickets/SP (all per row), Predictability % = `Delivered SP / Committed SP`. **[Added 2026-08-20]** Predictability RFT % = `Ready for Test SP / Committed SP`; New Tickets/SP (from the New query above); Predictability New % = `New SP / Committed SP`.
- Manual: "Nhận xét" free text (per row or one shared block — see Open Question below, resolved as one shared free-text block per section, not per row, matching the mockup's single "Nhận xét" area under the whole table).
- **Root Cause Tickets Trễ [Rewritten 2026-08-20]** — no longer a per-ticket manual table. It went through two real revisions in the same day: first narrowed to only tickets currently `Ready for Testing`/`In Test` with a new auto-populated `Sandbox Date` column (from Jira's real `Sandbox Date` field, filled in by DEV during planning to tell QE when a ticket lands in Sandbox), then replaced entirely with a fully auto-computed per-squad summary table — no manual fields (`Reason`/`Owner`/`Action`) remain. Columns: **Ready for Testing or In Test Tickets** (count of committed tickets currently at that status), **Sandbox Date** (count of those with no Sandbox Date set), **Sandbox Date = Close Sprint** / **Sandbox Date - 1** / **Sandbox Date + 1** / **Sandbox Date + 2** (counts whose Sandbox Date falls exactly on, one day before, one day after, or two days after the report's End Date). A Sandbox Date more than 1 day before or more than 2 days after the sprint end isn't counted in any of the four offset buckets — only these five specific relationships to the sprint boundary are tracked.

**2. Quality Report**
- Auto: Total Bugs, Critical, Major, Minor, Prod Bug counts, per row.
- Manual: the 4-item Quality Rating checklist (No Critical Bug / No Production Bug / Reopen Rate < 10% / UAT Stable, each a tri-state: unset/pass/fail) and an overall Assessment (Good / Need Improvement), per row.

**3. Impact Analysis Review**
- Auto: Total Tickets (the Ready-for-Test population for that row), IA Good (keyword found), IA Missing Info (keyword not found).
- Manual: IA Wrong Scope (a number, starts at 0 — incremented by hand after actually reading a ticket's IA content and judging it insufficient; this project does not attempt to auto-move a ticket from "IA Good" to "IA Wrong Scope"). Missing Impact Examples table (`Ticket | Missing Info`) — **prefilled**: one row per ticket flagged "IA Missing Info", `Ticket` filled in, `Missing Info` left blank for manual entry.

**4. Executive Summary**
- Auto: nothing computed — this section is pure rollup/judgment on top of numbers already visible in the sections above.
- Manual: all four indicators per row (Delivery, Quality, Impact Analysis, Overall — each a simple ✅/🟡/🔴/⚠️/❌ picker) and all free-text narrative commentary. Turning a Predictability % or bug count into a traffic-light color is exactly the kind of judgment call already kept manual for the Quality Rating checklist and IA Wrong Scope elsewhere in this report — no invented numeric threshold decides it automatically.

## Persistence & API

`SprintReportStore` (`packages/server/src/sprint-report-store.ts`) mirrors the existing `StepStore`/`KafkaContractCheckStore` shape: a flat JSON file (`packages/server/data/sprint-reports.json`, already covered by the existing `packages/server/data/` gitignore), keyed by sprint code, storing one `SprintReport` object per code (both the last-computed auto fields and all manual fields together, since manual edits must survive a page reload).

- **`POST /sprint-reports/:sprintCode/refresh`** — body `{ startDate, endDate, labels }`. Runs the 4 JQL searches, computes every auto field per row, and merges the result with the manual fields of any existing saved report for that sprint code (a fresh refresh must never silently discard typed commentary). Returns the merged `SprintReport`. Does not write to the store — refreshing is non-destructive preview until you explicitly save.
- **`PUT /sprint-reports/:sprintCode`** — body is a full `SprintReport` object as currently displayed (computed + manual). Persists it verbatim, overwriting any prior save for that code.
- **`GET /sprint-reports/:sprintCode`** — returns the saved `SprintReport`, or 404 if none exists yet.

## UI

New Sidebar entry "Sprint Report" (own route, `/sprint-report`). The page has an input card (Sprint Code, Start Date, End Date, Labels — a comma-separated text field) with a "Generate" button, followed by the 4 sections stacked vertically, each rendering its auto-computed table first and its manual inputs directly below. A page-level "Save" button persists everything via `PUT /sprint-reports/:sprintCode`. Loading a sprint code that was previously saved (e.g. navigating back to the page, or an explicit "Load" action) calls `GET /sprint-reports/:sprintCode` to restore state without hitting Jira.

**[Added 2026-08-20] Jira deep links.** Every count/SP cell in Sprint Delivery Summary (Committed/Delivered/Ready-for-Test/New Tickets & SP) and Quality Report (Total Bugs/Critical/Major/Minor/Prod Bug) is a link that opens the exact matching Jira issue search in a new tab, so the underlying tickets are one click away. Percentage cells (Predictability/RFT/New) stay plain text — there's no JQL search that produces a percentage. Links are computed server-side (`sprint-report-jira-links.ts`, only the server knows the Jira base URL) by reusing the same JQL builder that produced that metric's data, narrowed to the row's own project (and `Product Domain` for PCPOP rows) via `jqlProjectScope`; severity/Prod-Bug links add a `priority`/`"Bug in Environments:"` filter on top of the base Bugs query.

## Testing

`jira-client.ts` is the sole seam that talks to Jira and is mocked in every test, the same way `kafkajs` is mocked for the existing Kafka work — no test ever calls the real Jira API. Real unit-test coverage targets:
- JQL string construction for all 4 queries, given a sprint code/date range/labels list.
- Row grouping, including the `Product Domain` 3-way split for `PCPOP`.
- Story Points summation, Predictability % calculation.
- Priority → severity mapping (including values outside the known set).
- Prod Bug detection from `Bug in Environments:`.
- IA keyword search across description + comments (case-insensitivity, all 3 candidate phrases, absence case).
- The Sandbox Date breakdown computation / Missing Impact Examples table prefill logic.
- `SprintReportStore` CRUD, and the refresh-endpoint's merge-with-existing-manual-fields behavior.

## Error Handling

- Missing/unreadable `jira.yaml` → `POST /sprint-reports/:sprintCode/refresh` returns an error response (mirroring the Kafka Contract Check's "not configured" pattern) rather than attempting a request with no credential.
- A Jira API error (4xx/5xx, network failure) during refresh → the endpoint returns an error describing the failure; no partial/corrupt report is persisted, and any previously-saved report for that sprint code is left untouched.
- An issue missing an expected field (e.g. no `Story Points` set) is treated as `0` for summation purposes, not an error — Jira tickets frequently have optional fields unset.
