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
AND status not in (Done, Live)
AND project in (PC, PCFUM, PCPOP) AND type in (Task, Story) AND labels in ({labels})
```
**[Fixed 2026-08-21]** Added `AND status not in (Done, Live)`. Without it, a ticket that moved Ready for Testing → Done both within the same report window matched this query *and* the Delivered query, double-counting its story points across `Predictability` and `Predictability RFT` — real symptom: the three Predictability percentages summed to over 100%. Ready for Test now means "currently awaiting/in QA, not yet delivered," matching the mutual-exclusion pattern `buildNewJql` already used.

**[Replaced 2026-08-22]** The transition-based query above is gone entirely (`buildReadyForTestJql` deleted from `sprint-report-jql.ts`). Ready for Test Tickets/SP is no longer its own Jira search — it's now the exact same population as the Root Cause Tickets Trễ sub-table's ticket count (see below), unified with it at the user's request. The corresponding Jira link (`deliveryJiraLinks.readyForTest`) changed the same way. Impact Analysis Review's population followed along too, by explicit design choice: `impactAnalysisJiraLinks` and the keyword-check input (`rowReadyForTest` in `sprint-report-service.ts`) both derive from the same set, so `buildImpactAnalysisJiraLinks` dropped its `dateParams` argument in favor of `sprintCode`.

**[Broadened 2026-08-22]** One day later, the Root Cause sub-table's own population changed again (see below) from "Committed tickets currently Ready for Testing/In Test" to simply "all Committed tickets in the sprint" — no status filter at all. Kept unified per explicit user choice, Ready for Test Tickets/SP and Impact Analysis's population broadened the same way: `rowReadyForTest` in `sprint-report-service.ts` is now just `rowCommitted` directly (no filtering — `filterReadyOrInTest()` was deleted, fully unused). **Known consequence, confirmed acceptable to the user:** since Ready for Test SP now always equals Committed SP, **Predictability RFT is always exactly 100% for every row** — it no longer carries information, but was kept in place rather than removed. The Jira links for `readyForTest` (Sprint Delivery Summary), `ticketsInSprint` (Root Cause), and Impact Analysis's population are all built from `buildTicketsInSprintJql(sprintCode, scope)` in `sprint-report-jira-links.ts` — literally `buildCommittedJql({sprintCode}) + scope`, identical to the `committed` link's own JQL (two differently-labeled UI cells now share one query). Net effect versus the original design: one fewer Jira search per refresh (4 instead of 5), and Ready for Test/Impact Analysis/Root Cause all reflect the full committed backlog rather than a QA-stage-filtered subset.

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
- Bug severity: the `Priority` field. **[Corrected 2026-08-21]** This Jira instance's real Priority values are `P1 (Highest)` through `P5 (Lowest)`, not the plain `Highest`/`High`/etc. originally assumed — the mismatch meant Critical/Major/Minor silently stayed 0 even though Total Bugs was correct. Real mapping: `P1 (Highest)`/`P2 (High)` → Critical, `P3 (Medium)` → Major, `P4 (Low)`/`P5 (Lowest)` → Minor.
- Prod Bug: the `Bug in Environments:` field contains `Production`.
- **[Added 2026-08-20]** Sandbox Date: the `Sandbox Date` field, a plain date string, used only in the Root Cause table.

## Section-by-Section: Auto-Computed vs. Manual

**1. Sprint Delivery Summary**
- Auto: Committed Tickets/SP, Delivered Tickets/SP, Ready-for-Test Tickets/SP (all per row), Predictability % = `Delivered SP / Committed SP`. **[Added 2026-08-20]** Predictability RFT % = `Ready for Test SP / Committed SP`; New Tickets/SP (from the New query above); Predictability New % = `New SP / Committed SP`.
- Manual: "Nhận xét" free text (per row or one shared block — see Open Question below, resolved as one shared free-text block per section, not per row, matching the mockup's single "Nhận xét" area under the whole table).
- **Root Cause Tickets Trễ [Rewritten 2026-08-20]** — no longer a per-ticket manual table. It went through two real revisions in the same day: first narrowed to only tickets currently `Ready for Testing`/`In Test` with a new auto-populated `Sandbox Date` column (from Jira's real `Sandbox Date` field, filled in by DEV during planning to tell QE when a ticket lands in Sandbox), then replaced entirely with a fully auto-computed per-squad summary table — no manual fields (`Reason`/`Owner`/`Action`) remain. Columns as of that revision: **Ready for Testing or In Test Tickets** (count of committed tickets currently at that status), **Sandbox Date** (count of those with no Sandbox Date set), **Sandbox Date = Close Sprint** / **Sandbox Date - 1** / **Sandbox Date + 1** / **Sandbox Date + 2** (counts whose Sandbox Date falls exactly on, one day before, one day after, or two days after the report's End Date). A Sandbox Date more than 1 day before or more than 2 days after the sprint end isn't counted in any of the four offset buckets — only these five specific relationships to the sprint boundary are tracked.

**[Renamed & rebased 2026-08-22]** Columns renamed and their population broadened: **Ready for Testing or In Test Tickets** → **Tickets in Sprint** (`ticketsInSprint` field/link, `SandboxDateBreakdown`/`SandboxDateJiraLinks` in `sprint-report-delivery.ts`/`sprint-report-jira-links.ts`), now counting *every* Committed ticket regardless of current status (previously filtered to Ready for Testing/In Test only) — `computeSandboxDateBreakdown` no longer filters at all, it just uses the full `committed` list for both the ticket count and every Sandbox Date bucket below it. **Sandbox Date** → **Sandbox Date is EMPTY** (label clarification only, same `missingSandboxDate` field, no behavior change). **Sandbox Date - 1/+1/+2** → **Close Sprint Date - 1/+1/+2** (label only). **Sandbox Date = Close Sprint** is unchanged, by explicit user choice, despite the new adjacent naming pattern. This unification means Ready for Test Tickets/SP (Sprint Delivery Summary) and Impact Analysis's population changed the same way — see the Ready for Test JQL section above for that consequence (Predictability RFT is now always 100%).

**[Added 2026-08-22] Ticket created mid-sprint.** A new column inserted right after **Sandbox Date is EMPTY**: counts Committed tickets whose `created` date falls strictly between the report's Start Date and End Date, excluding both boundary days themselves — `created >= addDays(startDate, 1) AND created <= addDays(endDate, -1)`. This required adding `created` to `JiraIssue` (a standard Jira field, not custom — added to `STANDARD_FIELDS` in `jira-client.ts`) and a new `ticketsCreatedMidSprint`/`createdMidSprint` field/link pair on `SandboxDateBreakdown`/`SandboxDateJiraLinks`, computed the same way as the other Root Cause columns: filtered from the already-fetched `committed` list, no separate Jira search. `computeSandboxDateBreakdown` and `buildSandboxDateJiraLinks` both gained a `sprintStartDate` parameter for this (previously only took the end date). Jira's `created` field is a full ISO datetime (e.g. `2026-08-07T14:23:45.000+0700`); only the date portion (`.slice(0, 10)`) is compared, consistent with how Sandbox Date bucketing already treats dates as day-level with no time component.

**2. Quality Report**
- Auto: Total Bugs, Critical, Major, Minor, Prod Bug counts, per row. **[Rewritten 2026-08-21]** The manual Assessment select and the whole Quality Rating checklist (No Critical Bug / No Production Bug / Reopen Rate < 10% / UAT Stable) are removed. Replaced with an auto-computed **No RC** column: fetches each bug's description + comments (same fetch as the IA keyword check) and counts how many have neither a standalone `RC` nor the phrase `root cause` anywhere in that text — `hasRootCauseKeyword`, mirroring `hasImpactAnalysisKeyword`'s word-boundary-for-acronym / substring-for-phrase pattern. **[Updated 2026-08-21]** No RC now links to Jira too, via a `~` (fuzzy text search) JQL clause approximating the regex check — same approximation caveat as IA Good/Missing below: Jira's tokenized text search isn't guaranteed to return the exact ticket set the regex would.
- Manual: **[Added 2026-08-21]** a shared "Nhận xét" free-text block (`qualityComment`), same one-per-section pattern as Sprint Delivery Summary's, with a static Vietnamese hint below it suggesting what to cover (bug-to-delivered ratio, Prod Bug root cause, outstanding No RC tickets).

**3. Impact Analysis Review**
- Auto: Total Tickets (the Ready-for-Test population for that row), IA Good (keyword found), IA Missing Info (keyword not found). **[Updated 2026-08-21]** Total Tickets links to Jira — it reuses `deliveryJiraLinks.readyForTest` directly, since it's the exact same underlying ticket set as Sprint Delivery Summary's Ready for Test Tickets, no separate link needed. **[Updated 2026-08-21]** IA Good/IA Missing Info are now also linked, via a `~` (fuzzy text search) JQL clause approximating the regex check: `IA`/`Technical Impact`/`Impact Analysis` present (Good) or absent (Missing) in description/comments. This is a best-effort approximation, not an exact match — Jira's tokenized text search isn't guaranteed to return the same ticket set the regex would.
- Manual: **[Added 2026-08-21]** a shared "Nhận xét" free-text block (`impactAnalysisComment`), same pattern as above, with a Vietnamese hint suggesting what to cover (which tickets lack IA and why, trend vs. prior sprints, action if IA Missing Info is high). **[Removed 2026-08-21]** IA Wrong Scope (previously a hand-incremented number) is gone entirely — no backing data ever existed for it beyond the manual count, and it's not reflected anywhere else in the report. The Missing Impact Examples per-ticket table (`Ticket | Missing Info`) is also gone, along with its backing schema (`missingImpact`, `MissingImpactRow`, `prefillMissingImpactTable`).

**4. Executive Summary**
- Auto: **[Reversed 2026-08-22]** Delivery, Quality, and Impact Analysis are now pre-selected per row by `suggestExecutiveSummary()` (`packages/web/src/executiveSummarySuggestions.ts`), and Overall is derived from whichever of those three have data. This reverses the original "no invented numeric threshold" design call — the user explicitly asked for a self-assessment based on the computed results, so the thresholds below were confirmed with them rather than invented unilaterally:
  - **Delivery**: `good` if Predictability (Delivered SP / Committed SP) is ≥ 80%, else `bad`. `null` (no Committed SP) leaves the picker at `unset` — there's nothing to assess.
  - **Quality**: `good` only if Critical = 0 AND Major = 0 AND Prod Bug = 0 for that row this sprint; any one of them non-zero makes it `bad`.
  - **Impact Analysis**: `good` if IA Missing Info = 0; `bad` if `IA Missing Info / Total Tickets` is > 20%; `partial` in between (including exactly 20%). `Total Tickets = 0` leaves it `unset`.
  - **Overall**: `bad` if any of the three (that have data) is `bad`; `good` only if every one that has data is `good`; `partial` otherwise (covers Impact Analysis being `partial`, a mix of good/no-data, or no indicator having data at all — in which case Overall is left `unset` too). **[Renamed 2026-08-22]** This state was originally called `medium`; renamed to `partial` to match Impact Analysis's own middle-state wording, at the user's explicit request after seeing the two different terms side by side in the UI.
- Manual: all four indicators stay editable dropdowns — the system only pre-selects a value when the picker is still `unset` (a fresh row, or one a prior save never touched); a value the user (or a prior save) already set is never overwritten, matching the same "helpful default, still editable" pattern as the auto-filled Nhận xét templates. All free-text narrative commentary remains fully manual. **[Added 2026-08-21]** A static Vietnamese hint above the per-row commentary fields suggests writing a headline verdict tying the three indicators together, not restating their numbers. **[Added 2026-08-22]** A hint above the table explains that Delivery/Quality/Impact Analysis/Overall are system pre-filled and can be adjusted.
- The pre-fill runs client-side only, in `SprintReportPage.tsx`'s `handleGenerate` (via `fillExecutiveSummarySuggestions`, alongside the existing `fillEmptyComments`) — it never runs on "Load Saved", since that path is meant to restore exactly what was saved, `unset` fields included. The server's persistence/merge behavior (`executiveSummary: base.executiveSummary` in `sprint-report-service.ts`) is unchanged.

**[Added 2026-08-21] Commentary hints.** Every manual "Nhận xét"/commentary field in the report (Sprint Delivery Summary, Quality Report, Impact Analysis Review, Executive Summary) is followed by a static `.field-hint` block — generic Vietnamese example phrasing suggesting what's worth calling out in that field, not restating numbers the table already shows. These are static hints, not data-driven text generation: the user reads the suggestion and writes their own version. Quality Report and Impact Analysis Review each gained their own shared "Nhận xét" field for this (`qualityComment`/`impactAnalysisComment` on `SprintReport`, same one-per-section — not one-per-row — pattern as `deliveryComment`), since neither section had any manual field left after earlier simplification passes. Old saved reports predating these two fields are handled the same way as any other schema addition to this app — the page defaults a missing value to `''` at the point it's read (`report.qualityComment ?? ''`), not by migrating stored data.

**[Expanded 2026-08-21]** Each hint was expanded from a single condensed sentence into a `<ul className="field-hint">` of 4-5 detailed, professional Vietnamese bullet points, one per commentary field — including a dedicated hint for the Root Cause Tickets Trễ (Sandbox Date) sub-table under Sprint Delivery Summary, which shares that section's `deliveryComment` field but previously had no guidance of its own. Bullets cover: what pattern to look for, why it matters, and what action or comparison to make (e.g. compare against prior sprints, name specific ticket keys, flag the IA/RC keyword-match approximation before quoting it to management) — deliberately mirroring the depth of a human QA lead's real sprint-report commentary rather than a one-line reminder.

**[Added 2026-08-21] Auto-filled Nhận xét templates.** `handleGenerate` in `SprintReportPage.tsx` now runs the freshly-generated report through `fillEmptyComments()` before rendering: any of `deliveryComment`/`qualityComment`/`impactAnalysisComment` that comes back empty (`''`) is replaced with a generic Vietnamese fill-in-the-blank template (dash-bulleted, `[điền ...]` placeholders) matching that field's hint content, so the textarea starts with an editable skeleton instead of a blank box. A non-empty value already on the refreshed report (from a prior save) is left untouched — the fill only applies on empty, and only client-side at Generate time; the server's persistence/merge behavior (`sprint-report-service.ts`) is unchanged. "Load Saved" does not run this fill, since it's meant to restore exactly what was saved, including intentionally-blank fields. This does not extend to Executive Summary's per-row `commentary`, which keeps its hint-only treatment since a generic per-row template doesn't fit a field that's inherently squad-specific.

## Persistence & API

`SprintReportStore` (`packages/server/src/sprint-report-store.ts`) mirrors the existing `StepStore`/`KafkaContractCheckStore` shape: a flat JSON file (`packages/server/data/sprint-reports.json`, already covered by the existing `packages/server/data/` gitignore), keyed by sprint code, storing one `SprintReport` object per code (both the last-computed auto fields and all manual fields together, since manual edits must survive a page reload).

- **`POST /sprint-reports/:sprintCode/refresh`** — body `{ startDate, endDate, labels }`. Runs the 4 JQL searches, computes every auto field per row, and merges the result with the manual fields of any existing saved report for that sprint code (a fresh refresh must never silently discard typed commentary). Returns the merged `SprintReport`. Does not write to the store — refreshing is non-destructive preview until you explicitly save.
- **`PUT /sprint-reports/:sprintCode`** — body is a full `SprintReport` object as currently displayed (computed + manual). Persists it verbatim, overwriting any prior save for that code.
- **`GET /sprint-reports/:sprintCode`** — returns the saved `SprintReport`, or 404 if none exists yet.

## UI

New Sidebar entry "Sprint Report" (own route, `/sprint-report`). The page has an input card (Sprint Code, Start Date, End Date, Labels — a comma-separated text field) with a "Generate" button, followed by the 4 sections stacked vertically, each rendering its auto-computed table first and its manual inputs directly below. A page-level "Save" button persists everything via `PUT /sprint-reports/:sprintCode`. Loading a sprint code that was previously saved (e.g. navigating back to the page, or an explicit "Load" action) calls `GET /sprint-reports/:sprintCode` to restore state without hitting Jira.

**[Added 2026-08-20] Jira deep links.** Every count/SP cell in Sprint Delivery Summary (Committed/Delivered/Ready-for-Test/New Tickets & SP) and Quality Report (Total Bugs/Critical/Major/Minor/Prod Bug) is a link that opens the exact matching Jira issue search in a new tab, so the underlying tickets are one click away. Percentage cells (Predictability/RFT/New) stay plain text — there's no JQL search that produces a percentage. Links are computed server-side (`sprint-report-jira-links.ts`, only the server knows the Jira base URL) by reusing the same JQL builder that produced that metric's data, narrowed to the row's own project (and `Product Domain` for PCPOP rows) via `jqlProjectScope`; severity/Prod-Bug links add a `priority`/`"Bug in Environments:"` filter on top of the base Bugs query. **[Extended same day]** The Root Cause Tickets Trễ Sandbox Date breakdown got the same treatment: each of its 6 counts links to the matching search — the base population (`buildCommittedJql` + `status in ("Ready for Testing", "In Test")`), plus `"Sandbox Date" is EMPTY` for the missing count, or `"Sandbox Date" = "<date>"` for the four date-offset buckets, where `<date>` is the report's End Date shifted by the bucket's day offset (via a new `addDays(date, days)` helper generalized from the existing `nextDay`). Dates use `YYYY/MM/DD` to match this app's already-working JQL date format.

## Testing

`jira-client.ts` is the sole seam that talks to Jira and is mocked in every test, the same way `kafkajs` is mocked for the existing Kafka work — no test ever calls the real Jira API. Real unit-test coverage targets:
- JQL string construction for all 4 queries, given a sprint code/date range/labels list.
- Row grouping, including the `Product Domain` 3-way split for `PCPOP`.
- Story Points summation, Predictability % calculation.
- Priority → severity mapping (including values outside the known set).
- Prod Bug detection from `Bug in Environments:`.
- IA keyword search across description + comments (case-insensitivity, all 3 candidate phrases, absence case).
- RC keyword search across description + comments, mirroring the IA keyword search's test shape.
- The Sandbox Date breakdown computation.
- `SprintReportStore` CRUD, and the refresh-endpoint's merge-with-existing-manual-fields behavior.

## Error Handling

- Missing/unreadable `jira.yaml` → `POST /sprint-reports/:sprintCode/refresh` returns an error response (mirroring the Kafka Contract Check's "not configured" pattern) rather than attempting a request with no credential.
- A Jira API error (4xx/5xx, network failure) during refresh → the endpoint returns an error describing the failure; no partial/corrupt report is persisted, and any previously-saved report for that sprint code is left untouched.
- An issue missing an expected field (e.g. no `Story Points` set) is treated as `0` for summation purposes, not an error — Jira tickets frequently have optional fields unset.
