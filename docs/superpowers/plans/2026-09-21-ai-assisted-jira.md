# AI-assisted Jira Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `/jira` fast for issue viewing and safe, AI-grounded drafting of Jira creates, updates, and comments.

**Architecture:** Keep deterministic command parsing and `twg` execution as the trust boundary. Add typed AI draft functions that consume explicit instructions plus bounded session context (and a fetched issue for update/comment), validate their JSON output, then route the proposal through an editable preview and the existing final confirmation gate.

**Tech Stack:** TypeScript, Node `node:test`/`node:assert`, Pi extension APIs, Pi model streaming, and the locally configured `twg` CLI.

**Spec:** `docs/superpowers/specs/2026-09-21-ai-assisted-jira-design.md`

## Global Constraints

- Support only Jira view, create, update, and comment operations; do not add a natural-language catch-all, bulk operations, deletion, workflow transitions, sprint management, or autonomous writes.
- A bare issue key remains a read-only view and must not call a model.
- AI drafts use only the explicit instruction, bounded current-session context, and, for update/comment, the current Jira issue.
- Parse and validate structured model output before displaying or executing it; reject malformed JSON, empty required values, unsupported fields, and an invalid action.
- `twg` remains the sole Jira reader/writer; no direct Jira API calls or credentials management.
- Every mutation requires explicit final confirmation. Cancel, invalid output, unavailable model, or issue-fetch failure must not invoke a `twg` mutation.
- Retain the existing manual create/update/comment flows when no drafting instruction is supplied.

## Review Focus

- An instruction containing an issue-key-looking phrase or shell-like text is model input only and must never change deterministic parsing or subprocess arguments. **Task 1** pins this.
- An instructed update/comment must fetch its named issue before model invocation; fetch failure must make zero mutation calls. **Task 3** pins this.
- A model response with a valid JSON shape but an unknown update field, an empty comment, or extra prose must be rejected rather than partially accepted. **Task 2** pins this.
- Choosing Edit at preview must preserve the generated values in editable existing prompts; choosing Cancel must make no mutation. **Task 3** pins this.
- Existing no-instruction commands and read-only overlay view must retain their current behavior. **Tasks 1 and 4** pin this.

---

## File structure

```text
extensions/jira/
  types.ts          # Parsed commands, supported mutable fields, validated AI draft types
  parser.ts         # Deterministic command grammar and help text
  inference.ts      # Strict JSON model parsing and action-specific draft generation
  prompts.ts        # Existing field editors plus a draft preview decision prompt
  index.ts          # Context collection, issue retrieval, command orchestration, confirmation
  jira.test.ts      # Unit and orchestration tests with fake UI/model/twg clients
README.md           # Updated concise supported-command documentation
docs/superpowers/specs/2026-09-21-ai-assisted-jira-design.md
                     # Approved design (already committed)
```

`twg.ts`, `jira-output.ts`, and `jira-overlay.ts` retain their focused roles. Do not change their transport or rendering contracts unless tests show a concrete incompatibility.

## Tasks

### Task 1: Extend deterministic command grammar and shared types

**Files:**
- Modify: `extensions/jira/types.ts`
- Modify: `extensions/jira/parser.ts`
- Modify: `extensions/jira/jira.test.ts`

**Interfaces:**
- Consumes: raw argument string passed to `createJiraCommandHandler(args, ctx)`.
- Produces: instructed command variants:

```ts
export type ParsedJiraCommand =
  | { action: "help" }
  | { action: "view"; key: string }
  | { action: "search"; text: string }
  | { action: "create"; project?: string; instruction?: string }
  | { action: "update"; key?: string; instruction?: string }
  | { action: "comment"; key?: string; instruction?: string };

export type DraftPreview = {
  title: string;
  content: string;
  rationale: string;
};
```

- [ ] **Step 1: Add parser tests for instructed and legacy forms**

Add these cases to `extensions/jira/jira.test.ts` next to the current parser test:

```ts
assert.deepEqual(parseJiraCommand("create PROJ based on the current design"), {
  action: "create", project: "PROJ", instruction: "based on the current design",
});
assert.deepEqual(parseJiraCommand("create based on the current design"), {
  action: "create", instruction: "based on the current design",
});
assert.deepEqual(parseJiraCommand("update PROJ-1234 update based on the latest change"), {
  action: "update", key: "PROJ-1234", instruction: "update based on the latest change",
});
assert.deepEqual(parseJiraCommand("comment PROJ-1234 summarize `PROJ-99`"), {
  action: "comment", key: "PROJ-1234", instruction: "summarize `PROJ-99`",
});
assert.deepEqual(parseJiraCommand("create PROJ"), { action: "create", project: "PROJ" });
assert.deepEqual(parseJiraCommand("update PROJ-1234"), { action: "update", key: "PROJ-1234" });
```

Add a help assertion that documents the three instructed forms. Remove `assign` parser expectations because it is outside the approved scope.

- [ ] **Step 2: Run parser tests and verify they fail**

Run: `node --test extensions/jira/jira.test.ts`

Expected: FAIL because `instruction` is not returned and `assign` remains supported.

- [ ] **Step 3: Implement the exact grammar**

Change `parseJiraCommand` so it splits the verb from untouched remainder once. Implement:

```ts
// create: if the first remainder token is a project-like single token,
// use it as project; all remaining non-empty text is instruction.
// If no project token is present, the full remainder is instruction.
// update/comment: first token must be a normalized issue key when supplied;
// all remaining non-empty text is instruction.
```

Treat a project token as supplied only when its raw spelling is an uppercase Jira-style key (`^[A-Z][A-Z0-9]+$`). This makes `create PROJ based on ...` unambiguous while `create based on ...` keeps the full phrase as instruction. Preserve current normalized uppercase issue keys. Remove `assign` from `JiraAction`, `ParsedJiraCommand`, help text, and parser routing. Unsupported/malformed commands still return `{ action: "help" }`.

- [ ] **Step 4: Run parser tests and verify they pass**

Run: `node --test extensions/jira/jira.test.ts`

Expected: PASS for parser tests; unrelated handler tests may still fail until Task 3 adapts the removed action.

- [ ] **Step 5: Commit command grammar foundation**

```bash
git add extensions/jira/types.ts extensions/jira/parser.ts extensions/jira/jira.test.ts
git commit -m "feat: parse instructed jira commands"
```

### Task 2: Build strict, action-specific AI drafting

**Files:**
- Modify: `extensions/jira/types.ts`
- Modify: `extensions/jira/inference.ts`
- Modify: `extensions/jira/jira.test.ts`

**Interfaces:**
- Consumes:

```ts
export type JiraDraftContext = {
  instruction: string;
  session: string;
  issue?: string;
};
export type CreateDraftProposal = CreateDraft & { rationale: string };
export type UpdateDraftProposal = Omit<UpdateDraft, "key"> & { rationale: string };
export type CommentDraftProposal = { body: string; rationale: string };

export function draftCreateFields(context: JiraDraftContext, model: ModelJson): Promise<CreateDraftProposal>;
export function draftUpdateFields(context: JiraDraftContext, model: ModelJson): Promise<UpdateDraftProposal>;
export function draftComment(context: JiraDraftContext, model: ModelJson): Promise<CommentDraftProposal>;
```

- Produces: validated proposal objects or `ModelOutputError`; no method in this task calls UI or `twg`.

- [ ] **Step 1: Write failing validation tests**

Add a reusable model fake and tests:

```ts
const modelJson = (value: unknown) => async () => JSON.stringify(value);

test("accepts a complete create proposal and puts the instruction in the prompt", async () => {
  let prompt = "";
  const proposal = await draftCreateFields(
    { instruction: "based on the current design", session: "user: Design accepted" },
    async (input) => { prompt = input; return JSON.stringify({
      project: "PROJ", type: "Task", summary: "Implement design", description: "Build the approved design.", rationale: "Matches the accepted design.",
    }); },
  );
  assert.equal(proposal.summary, "Implement design");
  assert.match(prompt, /based on the current design/);
  assert.match(prompt, /user: Design accepted/);
});

test("rejects untrusted or incomplete update and comment proposals", async () => {
  await assert.rejects(() => draftUpdateFields({ instruction: "update it", session: "", issue: "PROJ-1" }, modelJson({ summary: "x", transition: "Done", rationale: "x" })), ModelOutputError);
  await assert.rejects(() => draftComment({ instruction: "comment", session: "", issue: "PROJ-1" }, modelJson({ body: "", rationale: "x" })), ModelOutputError);
  await assert.rejects(() => draftComment({ instruction: "comment", session: "", issue: "PROJ-1" }, async () => "Here is JSON: {}"), ModelOutputError);
});
```

- [ ] **Step 2: Run drafting tests and verify they fail**

Run: `node --test extensions/jira/jira.test.ts`

Expected: FAIL because the action-specific draft functions and types do not exist.

- [ ] **Step 3: Implement strict proposal parsers and prompts**

Reuse the existing exact-object JSON parser; it must parse the entire trimmed model response and never strip Markdown fences or extract embedded JSON. Add local helpers that require a trimmed non-empty string and reject unknown object keys.

Implement allowed fields exactly:

```ts
const CREATE_KEYS = ["project", "type", "summary", "description", "assignee", "priority", "labels", "parent", "rationale"];
const UPDATE_KEYS = ["summary", "description", "priority", "assignee", "sprint", "rationale"];
const COMMENT_KEYS = ["body", "rationale"];
```

Require all create required fields and rationale. Require update rationale and at least one supported changed field. Require comment body and rationale. Prompts must say “Return JSON only”, identify the requested operation, prohibit invented facts and unsupported fields, and delimit instruction/session/issue as reference data. Include the current issue string only in update/comment prompts.

Keep `inferCreateFields` and `convertNaturalLanguageToJql` unchanged for legacy flows and search.

- [ ] **Step 4: Run drafting tests and existing inference tests**

Run: `node --test extensions/jira/jira.test.ts`

Expected: PASS for all inference and parser tests.

- [ ] **Step 5: Commit strict AI drafting**

```bash
git add extensions/jira/types.ts extensions/jira/inference.ts extensions/jira/jira.test.ts
git commit -m "feat: add grounded jira draft inference"
```

### Task 3: Add proposal preview/edit behavior and orchestrate instructed mutations

**Files:**
- Modify: `extensions/jira/prompts.ts`
- Modify: `extensions/jira/index.ts`
- Modify: `extensions/jira/jira.test.ts`

**Interfaces:**
- Consumes: `CreateDraftProposal`, `UpdateDraftProposal`, `CommentDraftProposal`; existing `collectCreateDraft`, `collectUpdateDraft`, `collectComment`, `confirmOperation`; `TwgClient.view/create/update/comment`.
- Produces:

```ts
export type DraftDecision = "confirm" | "edit" | "cancel";
export function previewDraft(ui: JiraUi, preview: DraftPreview): Promise<DraftDecision>;
```

- [ ] **Step 1: Write failing preview and orchestration tests**

Add a UI fake whose `select` receives the prompt title and options. Test preview decisions:

```ts
test("preview returns edit, confirm, or cancel without mutating", async () => {
  assert.equal(await previewDraft(scriptedUi(["Edit"]) as any, { title: "Update PROJ-1", content: "Summary: New", rationale: "Latest change" }), "edit");
  assert.equal(await previewDraft(scriptedUi(["Confirm"]) as any, { title: "Comment on PROJ-1", content: "Done", rationale: "Verification" }), "confirm");
  assert.equal(await previewDraft(scriptedUi([undefined]) as any, { title: "Create", content: "Task", rationale: "Design" }), "cancel");
});

test("instructed update fetches before drafting and cannot mutate when fetch fails", async () => {
  let drafted = false;
  let updated = false;
  const handler = createJiraCommandHandler({
    twg: { view: async () => { throw new TwgError("twg failed: unavailable"); }, update: async () => { updated = true; return {}; } },
    draftUpdate: async () => { drafted = true; return { summary: "x", rationale: "x" }; },
  } as any);
  await handler("update PROJ-1 based on latest change", commandContextWithNotifications);
  assert.equal(drafted, false);
  assert.equal(updated, false);
});
```

Then add happy-path tests with injected `draftCreate`, `draftUpdate`, and `draftComment` functions that assert their received context. For update/comment, assert the draft call happens after fake `twg.view`, receives the serialized issue payload, and a `Confirm` selection plus final confirm `true` invokes exactly one correct mutation. Add an Edit test that supplies answers to the existing field editor and asserts the edited values—not proposal values—are submitted. Add Cancel and final-confirm-declined tests that assert no mutations.

- [ ] **Step 2: Run preview/orchestration tests and verify they fail**

Run: `node --test extensions/jira/jira.test.ts`

Expected: FAIL because preview behavior and injected draft dependencies do not exist.

- [ ] **Step 3: Implement preview and handler routing**

Add `previewDraft` in `prompts.ts`:

```ts
export async function previewDraft(ui: JiraUi, preview: DraftPreview): Promise<DraftDecision> {
  const choice = await ui.select(`${preview.title}\n\n${preview.content}\n\nWhy: ${preview.rationale}`, ["Confirm", "Edit", "Cancel"]);
  return choice === "Confirm" ? "confirm" : choice === "Edit" ? "edit" : "cancel";
}
```

In `index.ts`, extend `Deps` with optional injectable `draftCreate`, `draftUpdate`, and `draftComment` functions. For instructed paths, require an active/injected model; if absent notify `Select an active model to draft this Jira change.` and return. Collect session context with the existing `recentContext` helper.

Implement the mutation sequences exactly:

1. **Create instruction:** draft from `{ instruction, session }`; preview; Edit calls `collectCreateDraft(ui, proposal, parsed.project)`; Confirm uses proposal; both then call existing `confirmOperation` and `twg.create` only if accepted.
2. **Update instruction:** call `twg.view(parsed.key)` first; pass `JSON.stringify(payload)` as `issue` along with instruction/session to drafting; attach `key` only after draft validation; preview; Edit calls `collectUpdateDraft(ui, key)` (prefilling requires extending it with a `Partial<UpdateDraft>` parameter and passing proposal); final confirm then `twg.update`.
3. **Comment instruction:** fetch issue first; draft; preview; Edit calls `collectComment(ui, key, proposal.body)` (extend `collectComment` with optional initial body); final confirm then `twg.comment`.

For the update edit path, change `collectUpdateDraft` to accept `initial: Partial<UpdateDraft> = {}`. When the user selects a field, call the existing editor with `initial[field.toLowerCase()] ?? ""`; retain the selected fields only, so Edit is both prefilled and intentionally reviewable.

Render previews as readable field lines (not raw JSON). Use `formatMutationResult` for successful writes. On `ModelOutputError`, `TwgError`, or `JiraOutputError`, preserve the current safe error notification path. Do not offer automatic fallback after an instructed path fails; the user can explicitly use its legacy command.

- [ ] **Step 4: Run the complete Jira test file**

Run: `node --test extensions/jira/jira.test.ts`

Expected: PASS, including existing overlay/view tests and all preview safety tests.

- [ ] **Step 5: Commit preview and instructed mutation flows**

```bash
git add extensions/jira/prompts.ts extensions/jira/index.ts extensions/jira/jira.test.ts
git commit -m "feat: draft jira changes from instructions"
```

### Task 4: Remove out-of-scope assignment and document/verify the shipped interface

**Files:**
- Modify: `extensions/jira/index.ts`
- Modify: `extensions/jira/twg.ts`
- Modify: `extensions/jira/jira-output.ts`
- Modify: `extensions/jira/prompts.ts`
- Modify: `extensions/jira/jira.test.ts`
- Modify: `README.md`

**Interfaces:**
- Consumes: the approved scope and Task 1 parser, which has no `assign` action.
- Produces: public `/jira` help and README describing only view, search, create, update, and comment; no active assignment command path.

- [ ] **Step 1: Add scope and regression tests**

Replace current assignment formatter/argument/parser assertions with:

```ts
test("does not expose assignment and keeps legacy manual mutations", async () => {
  assert.deepEqual(parseJiraCommand("assign PROJ-123"), { action: "help" });
  // Exercise `create PROJ`, `update PROJ-123`, and `comment PROJ-123` with scripted UI;
  // assert each retains its existing manual path and invokes only its matching fake twg method after confirmation.
});

test("view remains model-free", async () => {
  let modelCalled = false;
  const handler = createJiraCommandHandler({
    model: () => async () => { modelCalled = true; return "{}"; },
    twg: { view: async () => viewPayload },
  } as any);
  await handler("PROJ-123", tuiContext);
  assert.equal(modelCalled, false);
});
```

Add README expectations for instructed create/update/comment forms and explicit final confirmation.

- [ ] **Step 2: Run scope/regression tests and verify they fail**

Run: `node --test extensions/jira/jira.test.ts`

Expected: FAIL while assignment helpers/routes/docs remain.

- [ ] **Step 3: Remove assignment surface and update docs**

Remove `collectAssignment`, `buildAssignArgs`, `TwgClient.assign`, and assign-specific mutation labels only after confirming no remaining imports. Retain search because it is a documented existing read-only capability, though it is not AI drafting scope. Update the README Jira paragraph to document:

```markdown
- `/jira PROJ-123` opens a read-only issue view.
- `/jira create PROJ <instruction>` drafts a create payload from the instruction and session context.
- `/jira update PROJ-123 <instruction>` and `/jira comment PROJ-123 <instruction>` first read the issue, draft the requested change, then offer Confirm, Edit, or Cancel.
- `/jira create`, `/jira update PROJ-123`, and `/jira comment PROJ-123` remain manual workflows.
```

State that all writes require final confirmation and that `twg login` is required for authentication.

- [ ] **Step 4: Run repository verification**

Run: `node --test extensions/jira/jira.test.ts && git diff --check && git status --short`

Expected: all tests PASS, no whitespace errors, and only intended files are unstaged.

- [ ] **Step 5: Commit scope cleanup and documentation**

```bash
git add extensions/jira/index.ts extensions/jira/twg.ts extensions/jira/jira-output.ts extensions/jira/prompts.ts extensions/jira/jira.test.ts README.md
git commit -m "docs: refine jira command scope"
```
