# Save as Reusable Step — Design Spec

## Goal

Add a "Save as Reusable Step" button to the REST GUI (right after "Run"), plus the minimal companion capability needed to make it actually useful: loading a previously saved step back into the form. This is a deliberately minimal walking skeleton toward the PRD's "Step Repository" pillar.

## Scope

**In scope:**
- A "Save as Reusable Step" button that saves the entire current form (Actor, Task, Method, URL, Params, Headers, Auth, Body, Extract, Questions) under a user-given name.
- A "Load Reusable Step" selector that restores a previously saved form by name.
- File-backed persistence on the server, mirroring the existing Actor/Task name-list pattern.

**Out of scope (deliberately deferred):**
- "Add to E2E Flow" — no E2E flow model, canvas, or UI at all. This was the second button originally requested; it's being tackled as its own future increment given the size of the Flow Builder pillar (drag-and-drop canvas, Condition/Loop/Delay nodes, Database/Kafka/Redis step types that don't exist in this codebase yet).
- The richer PRD "Save Reusable Step" dialog fields: Description, Folder, Version, Owner, Tags, Reusable Variables, Outputs, "Save Assertion," "Save Mock Data."
- Editing or deleting a saved step.
- Any folder/hierarchy organization of saved steps (PRD's `Payment > Create Payment` tree).
- Real Screenplay-level reuse (a step tied to a Task independent of Actor) — this increment saves/restores the whole form as one unit, Actor included.

## Architecture

**Backend** — a name→content **map** store, mirroring `NameListStore` but keyed (a step's content is an opaque JSON blob, not a string):

- **`packages/server/src/step-store.ts`** — `StepStore` class:
  ```ts
  export class StepStore {
    constructor(filePath: string);
    list(): Promise<string[]>;
    get(name: string): Promise<unknown | undefined>;
    save(name: string, content: unknown): Promise<string[]>; // returns updated name list
  }
  ```
  Backed by one JSON file (`packages/server/data/steps.json`), shaped `{ "Create Payment": {...}, "Get Payment": {...} }`. The server treats `content` as opaque — it has no dependency on `FormState`, which only exists in `packages/web`.

- **`packages/server/src/routes/steps.ts`**:
  - `GET /steps` → `string[]` of saved names.
  - `GET /steps/:name` → the saved content, or `404 { error }` if not found.
  - `POST /steps` with body `{ name: string, content: unknown }` → saves/overwrites, returns `201 { names: string[] }`. `400 { error }` if `name` is blank or `content` is missing.
  - Wired into `buildApp` alongside `actorStore`/`taskStore`, using the same `dataDir` option.

**Frontend:**
- **`packages/web/src/steps.ts`** — fetch wrappers mirroring `nameLists.ts`'s never-throw style:
  ```ts
  export async function fetchStepNames(): Promise<string[]>;
  export async function fetchStep(name: string): Promise<FormState | undefined>;
  export async function saveStep(name: string, form: FormState): Promise<string[] | undefined>; // undefined on failure
  ```
- **`packages/web/src/components/SaveStepButton.tsx`**:
  ```ts
  export interface SaveStepButtonProps {
    form: FormState;
    disabled: boolean;
    existingNames: string[];
    onSaved: (names: string[]) => void;
  }
  ```
  On click: `window.prompt` for a name → if trimmed name is in `existingNames`, `window.confirm` before overwriting → `saveStep` → `window.alert` reporting success or failure. Disabled using the same `isFormValid(form)` check `RunButton` already uses.

- **`packages/web/src/components/LoadStepSelect.tsx`**:
  ```ts
  export interface LoadStepSelectProps {
    stepNames: string[];
    onLoad: (form: FormState) => void;
  }
  ```
  A labeled `<select>` (styled like the Method dropdown) listing saved step names plus a disabled placeholder option. Picking a name fetches its content and calls `onLoad`, then resets to the placeholder.

- **`App.tsx`**: new `stepNames` state, fetched on mount alongside `actorOptions`/`taskOptions`. `LoadStepSelect` renders right after the Actor/Task row (`ScreenplayHeader`) — loading replaces the whole form, so it belongs before the user starts editing anything. `SaveStepButton` renders immediately after `RunButton`, matching the original request.

## Behavior Details

- **Save**: empty or cancelled `window.prompt` → no-op, nothing saved. Existing name → `window.confirm`; declining cancels the save without calling the API. Success and failure are both reported via `window.alert` — unlike the fire-and-forget Actor/Task name saves, a step save is a deliberate user action and its outcome must be visible.
- **Load**: selecting a name applies the fetched form immediately, no confirmation — matching the existing immediate-apply behavior of the Method/Auth-type selects and Paste cURL's Import button. If the fetch fails (e.g. a step deleted by another tab in a race), it's a silent no-op and the select resets to its placeholder.
- **Persistence**: `packages/server/data/steps.json` sits alongside `actors.json`/`tasks.json`, already covered by the existing `packages/server/data/` gitignore rule.

## Testing Plan

- **`packages/server/test/step-store.test.ts`** — empty list initially; save+get round-trip; save overwrites an existing name's content; persists across separate `StepStore` instances pointed at the same file; creates a nested data directory if needed.
- **`packages/server/test/steps-routes.test.ts`** — `GET /steps` returns `[]` initially; `POST /steps` saves and returns the updated names list; `GET /steps/:name` returns the saved content; `GET /steps/:name` 404s for an unknown name; `POST /steps` 400s for a blank name and for missing content; a second `POST /steps` under the same name overwrites the content.
- **`packages/web/test/steps.test.ts`** — `fetchStepNames`, `fetchStep`, `saveStep` each tested for both success and failure (network error / non-2xx), mirroring `nameLists.test.ts`.
- **`packages/web/test/components/SaveStepButton.test.tsx`** — mocking `window.prompt`/`confirm`/`alert`: saving a new name calls `saveStep` and `onSaved`; saving an existing name prompts to confirm overwrite (both confirmed and declined paths); the button is disabled when the form is invalid.
- **`packages/web/test/components/LoadStepSelect.test.tsx`** — selecting a name calls `fetchStep` and then `onLoad` with the fetched form.
- **`packages/web/test/App.test.tsx`** (extended) — add a `/steps` stub to the existing fetch-mocking helper so current tests keep passing, plus a save→load round-trip integration test.

No changes needed to the engine, runner packages, or the `TestDefinition`/DSL layer — this is purely a form-persistence feature layered on top of the existing REST GUI.
