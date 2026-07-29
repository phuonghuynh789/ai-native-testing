# REST GUI Visual Design (DESIGN.md application) — Design

## Context

The API Runner REST GUI (`packages/web`, on branch `worktree-api-runner-rest-gui`,
not yet merged to `main`) was built with zero styling — plain, unstyled
HTML controls, deliberately out of scope for that increment. A new file,
[`DESIGN.md`](../../../DESIGN.md), was added to the repo root: a full
design-token specification (colors, typography, spacing, shapes,
components) reverse-engineered from Ollama's marketing/docs site.

`DESIGN.md`'s foundational layer (colors, typography scale, spacing scale,
border-radius scale) applies to any UI. Its *components*, however
(`pricing-card`, `faq-row`, `terminal-card` with a llama mascot,
`primary-nav` with a search pill), are built for a marketing site and have
no direct equivalent in a functional testing tool with tabs, key/value row
editors, a JSON results viewer, and a Run button. This spec is about
applying the former faithfully and thoughtfully reinterpreting the latter —
not importing marketing-site components that don't fit.

## Goal

Give the REST GUI a real visual design, using `DESIGN.md`'s exact tokens
(colors, typography, spacing, radii) and its existing pill/card/code-block
component vocabulary, without changing any component's behavior, structure,
or the 47 tests already passing against it.

## Scope

**In scope:**
- A new global stylesheet (`packages/web/src/styles.css`) defining
  `DESIGN.md`'s tokens as CSS custom properties, plus reusable classes.
- Applying `className`s to every existing component's existing JSX.
- Reinterpreting `DESIGN.md` components (tabs, form fields, JSON/code
  blocks, error banner, pass/fail status) for elements it doesn't define.

**Out of scope:**
- Any behavioral or structural change to a component (no new props, no new
  DOM elements beyond what styling requires, e.g. no wrapper `<div>`s that
  change the accessible tree in a way existing tests would notice).
- Responsive breakpoints (`DESIGN.md`'s breakpoint table describes the
  marketing site's hero/pricing-grid collapse behavior, not this app).
- Dark mode.
- The llama mascot or any illustration.
- Hover-state polish (`DESIGN.md` documents none, "per system policy").
- Any `DESIGN.md` component with no real equivalent here: `pricing-card`,
  `faq-row`, `primary-nav` with search, `cta-strip-dark`.

## Tokens

All defined as CSS custom properties in `packages/web/src/styles.css`,
values copied verbatim from `DESIGN.md`'s front matter.

**Colors:**
```css
--color-primary: #000000;
--color-on-primary: #ffffff;
--color-ink: #000000;
--color-ink-deep: #090909;
--color-canvas: #ffffff;
--color-surface-soft: #fafafa;
--color-hairline: #e5e5e5;
--color-hairline-strong: #d4d4d4;
--color-charcoal: #525252;
--color-body: #737373;
--color-mute: #a3a3a3;
--color-terminal-red: #ff5f56;
--color-terminal-green: #27c93f;
--color-focus-ring: rgba(59, 130, 246, 0.5);
```

Text color follows `DESIGN.md`'s own rules: `--color-ink` for headings and
button text on light surfaces, `--color-body` for default paragraph/body
text, `--color-on-primary` for text on the solid black `button-primary`
pill.

`terminal-red`/`terminal-green` are repurposed beyond their original
decorative use (traffic-light dots) as this app's pass/fail status color —
a deliberate, confirmed decision (see "Pass/Fail Status" below), since
`DESIGN.md` has no error/success palette of its own ("no validation
states" is explicit system policy for the marketing site, but this is a
functional testing tool where scanning pass/fail matters).

**Typography:** font stacks exactly as `DESIGN.md` documents its own
fallback chain — no web-font loading, no new dependency:
```css
--font-heading: "SF Pro Rounded", system-ui, -apple-system, sans-serif;
--font-body: ui-sans-serif, system-ui, -apple-system, sans-serif;
--font-code: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
```
macOS users get real SF Pro Rounded (it ships with the OS); everyone else
gets `DESIGN.md`'s own documented `system-ui` fallback. Each type role
(`display-xl` 36px/500, `heading-md` 20px/500, `heading-sm` 18px/500,
`body-md` 16px/400, `body-sm-strong` 14px/500, `body-sm` 14px/400,
`code-sm` 14px/400, `code-md` 16px/400, `button-md` 14px/500) becomes a CSS
class with the exact size/weight/line-height `DESIGN.md` specifies.

**Spacing:** `--space-xxs` (2px) through `--space-section` (88px), matching
`DESIGN.md`'s scale exactly.

**Radii:** `--radius-full` (9999px, pills) and `--radius-lg` (12px, cards) —
the only two radius values this app needs, matching `DESIGN.md`'s own
observation that its dominant shape vocabulary is just those two.

## Component Mapping

| Element | Treatment |
|---|---|
| Page `<h1>` (`App`) | `display-xl` — this is genuinely the page-top headline `DESIGN.md` reserves that role for |
| "Request" `<h2>` (`RequestBuilder`) | `heading-md` |
| `<legend>` labels (`Variables`, `Params`, `Headers`, `Auth`, `Extract`, `Questions`) | `heading-sm` |
| Field labels (Actor, Task, Method, URL, etc.) | `body-sm-strong` |
| `<fieldset>` containers | Card treatment: `--color-canvas` background, 1px `--color-hairline` border, `--radius-lg`, replacing default browser fieldset styling |
| Text/select inputs (`KeyValueRows`, `ScreenplayHeader`, Auth fields, Method/URL) | Pill treatment: `--radius-full`, 1px hairline border, 40px height, `body-md` |
| Body (JSON) `<textarea>` (`RequestBuilder`) | `code-md` typography, `--radius-lg`, hairline border — borrows the `terminal-card`/`install-snippet` "this is code" treatment; multi-line content can't be a pill |
| Tab bars (`RequestBuilder`'s Params/Headers/Auth/Body/Extract/Questions nav, `ResultsPanel`'s Response/Saved Values/Context/Logs nav) | Inactive tab = `command-tag` style (soft pill, `--color-surface-soft`); active tab (`aria-current="true"`) = `button-primary` style (solid black pill) |
| Run button (`RunButton`) | `button-primary`; disabled → `button-disabled` (soft gray, `--color-mute` text) |
| Add/Remove row buttons (`KeyValueRows`, `ExtractEditor`, `QuestionsEditor`) | `button-secondary` (outline pill) |
| Response/Saved Values/Context JSON (`ResultsPanel`) | `terminal-card` treatment: hairline border, `--radius-lg`, `code-sm`, 16px padding |
| Logs list (`ResultsPanel`) | `body-sm`/`code-sm` rows, colored by `StepResult.status`: `passed` → `--color-terminal-green`, `failed` → `--color-terminal-red`, `pending`/`skipped` (steps never reached after a fail-fast stop) → default `--color-mute`, no special emphasis |
| Error banner (`role="alert"` in `App`) | `--color-terminal-red` text on `--color-surface-soft` background, 1px hairline border, `--radius-lg` — no dedicated banner component in `DESIGN.md`, so this reuses the same pass/fail color decision plus the generic card treatment |

## Pass/Fail Status

`DESIGN.md` states the marketing site has "no error/success/warning
palette" and "no validation states" — a deliberate choice for a docs/
marketing surface with no destructive flows. This app's entire purpose is
showing pass/fail results, so a purely typographic (no color) treatment
would hurt usability for no real fidelity gain. Confirmed with the user:
reuse `--color-terminal-red` / `--color-terminal-green` — colors that
already exist in the palette (previously scoped only to the decorative
terminal-mockup traffic-light dots) — for failed/passed status text,
rather than introducing new colors outside `DESIGN.md`'s set.

## Testing

No new automated tests for visual styling — CSS appearance isn't
meaningfully verifiable via React Testing Library/jsdom (no layout engine,
no real font rendering). The acceptance bar:

- All 47 existing `packages/web` tests keep passing **completely
  unmodified** — proving `className` additions introduce no behavioral or
  structural regression, since none of those tests assert on `className`
  or visual appearance, only on roles/labels/values/text content.
- A manual real-browser check (screenshot) at the end, the same way the
  unstyled GUI was verified working end-to-end earlier in this project.

## Out of Scope

Deferred/excluded, consistent with the Scope section above:

- Responsive breakpoints, dark mode, the llama mascot/illustrations,
  hover-state polish.
- Any `DESIGN.md` component with no equivalent in this app: `pricing-card`,
  `pricing-card-dark`, `faq-row`, `primary-nav` with search,
  `cta-strip-dark`.
- Any behavioral/structural change to a component.
