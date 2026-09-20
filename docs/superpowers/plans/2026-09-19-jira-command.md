# Jira Command Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a safe, interactive `/jira` Pi extension for viewing, searching, creating, updating, commenting on, and assigning Jira Cloud work items through the configured `twg` CLI.

**Architecture:** Keep parsing, model conversion, prompting, `twg` execution, and output formatting in focused modules under `extensions/jira/`. `index.ts` adapts Pi's command context to injected testable dependencies and sequences context inference, user review, confirmation, typed `twg` operations, and compact rendering.

**Tech Stack:** TypeScript executed by Pi/jiti and Node 26, Node built-ins (`node:child_process`, `node:test`, `node:assert/strict`), `@earendil-works/pi-coding-agent`, and the installed `twg` CLI.

**Spec:** `docs/superpowers/specs/2026-09-19-jira-command-design.md`

## Global Constraints

- Support Jira Cloud only, through the currently configured `twg` OAuth-backed site; never accept or pass a site override.
- Do not manage credentials or make direct Jira REST API calls.
- Support only view, natural-language search, create, update, comment, and assign; reject transition and link as unsupported.
- Use subprocess argument arrays only; never interpolate a shell command.
- Request `twg` JSON with `-o json`, bound requests by timeout, and never expose credentials in errors.
- Require confirmation before search execution and every mutation; user cancellation is a successful no-op that does not spawn `twg`.
- Create inference independently proposes project, issue type, summary, and description only at conservative confidence, and every proposed value remains editable.
- Update exposes only summary, description, priority, assignee, and sprint; `assign` is assignee-only.

## Review Focus

- A malformed issue-key-like shorthand such as `PROJ-` must show help rather than issue a malformed get request. **Task 1** pins this.
- A model response wrapped in Markdown fences or with extra prose must be rejected, not extracted heuristically and executed. **Task 4** pins this.
- A cancelled editor/input/select/confirm response at every stage must stop before `twg` is invoked. **Tasks 5 and 6** pin this.
- A `twg` failure whose stderr contains a bearer token or OAuth value must render a redacted actionable error. **Task 3** pins this.
- A valid JSON envelope whose expected work-item array is absent must be reported as malformed output rather than as zero results. **Task 2** pins this.

---

## File structure

```text
package.json                         # discover nested extension entry points
extensions/jira/
  types.ts                           # shared parsed requests, field values, runner/model/UI interfaces
  parser.ts                          # verb/shorthand parser and deterministic help text
  jira-output.ts                     # runtime JSON shape validation and compact renderers
  twg.ts                             # typed argument builders and spawned JSON runner
  inference.ts                       # strict model JSON conversion for create inference and JQL
  prompts.ts                         # Pi UI adapters for field collection, review, and confirmation
  index.ts                           # Pi command registration and orchestration
  jira.test.ts                       # Node test coverage using injected fakes
```

`types.ts` contains no Pi runtime imports beyond type-only imports. It defines the request and boundary contracts used everywhere:

```ts
export type JiraAction = "help" | "view" | "search" | "create" | "update" | "comment" | "assign";
export type ParsedJiraCommand =
  | { action: "help" }
  | { action: "view"; key: string }
  | { action: "search"; text: string }
  | { action: "create"; project?: string }
  | { action: "update"; key?: string }
  | { action: "comment"; key?: string }
  | { action: "assign"; key?: string };
export type CreateDraft = { project: string; type: string; summary: string; description: string; assignee?: string; priority?: string; labels?: string; parent?: string };
export type UpdateDraft = { key: string; summary?: string; description?: string; priority?: string; assignee?: string; sprint?: string };
export type ModelJson = (prompt: string) => Promise<string>;
export type TwgRunner = (args: readonly string[], options: { timeoutMs: number }) => Promise<{ stdout: string; stderr: string; exitCode: number }>;
```

## Tasks

### Task 1: Package discovery and pure command parser

**Files:**
- Modify: `package.json:12-22`
- Create: `extensions/jira/types.ts`
- Create: `extensions/jira/parser.ts`
- Test: `extensions/jira/jira.test.ts`

**Interfaces:**
- Consumes: raw command argument text from Pi's `registerCommand` handler.
- Produces: `parseJiraCommand(args: string): ParsedJiraCommand`, `JIRA_HELP: string`, `isIssueKey(value: string): boolean`, and the shared types in `types.ts`.

- [ ] **Step 1: Write failing parser and package-discovery tests**

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { JIRA_HELP, isIssueKey, parseJiraCommand } from "./parser.ts";

test("routes an issue key shorthand and supported verbs", () => {
  assert.deepEqual(parseJiraCommand("PROJ-123"), { action: "view", key: "PROJ-123" });
  assert.deepEqual(parseJiraCommand("search open bugs"), { action: "search", text: "open bugs" });
  assert.deepEqual(parseJiraCommand("create ENG"), { action: "create", project: "ENG" });
  assert.deepEqual(parseJiraCommand("update PROJ-123"), { action: "update", key: "PROJ-123" });
  assert.deepEqual(parseJiraCommand("comment PROJ-123"), { action: "comment", key: "PROJ-123" });
  assert.deepEqual(parseJiraCommand("assign PROJ-123"), { action: "assign", key: "PROJ-123" });
});

test("empty, help, unsupported, and malformed shorthand route to help", () => {
  for (const args of ["", "help", "transition PROJ-123", "link PROJ-123", "PROJ-"]) {
    assert.deepEqual(parseJiraCommand(args), { action: "help" });
  }
  assert.equal(isIssueKey("PROJ-123"), true);
  assert.equal(isIssueKey("PROJ-"), false);
  assert.match(JIRA_HELP, /\/jira search <natural-language request>/);
});
```

- [ ] **Step 2: Run the parser test to verify it fails**

Run: `node --test extensions/jira/jira.test.ts`

Expected: FAIL because `extensions/jira/parser.ts` does not exist.

- [ ] **Step 3: Add nested extension discovery and minimal shared parser implementation**

Update the existing Pi configuration rather than replacing its top-level extension glob:

```json
"extensions": ["./extensions/*.ts", "./extensions/*/index.ts"]
```

Implement a fully anchored Jira key predicate and whitespace tokenization without shell parsing:

```ts
export const JIRA_HELP = [
  "Jira work items via the configured twg site:",
  "/jira PROJ-123                 View a work item",
  "/jira search <natural-language request>",
  "/jira create [PROJECT]",
  "/jira update [PROJ-123]",
  "/jira comment [PROJ-123]",
  "/jira assign [PROJ-123]",
].join("\n");

export function isIssueKey(value: string): boolean {
  return /^[A-Z][A-Z0-9]+-\d+$/u.test(value);
}

export function parseJiraCommand(args: string): ParsedJiraCommand {
  const trimmed = args.trim();
  if (!trimmed || trimmed === "help") return { action: "help" };
  if (isIssueKey(trimmed)) return { action: "view", key: trimmed };
  // Split the first token from the untouched remaining text; implement each
  // supported action explicitly and return help for every other verb.
}
```

Define the exact `JiraAction`, `ParsedJiraCommand`, `CreateDraft`, `UpdateDraft`, `ModelJson`, and `TwgRunner` types listed in File structure.

- [ ] **Step 4: Run parser tests to verify they pass**

Run: `node --test extensions/jira/jira.test.ts`

Expected: PASS for parser tests.

- [ ] **Step 5: Commit the parser foundation**

```bash
git add package.json extensions/jira/types.ts extensions/jira/parser.ts extensions/jira/jira.test.ts
git commit -m "feat: add jira command parser"
```

### Task 2: Validate and render Jira JSON output

**Files:**
- Create: `extensions/jira/jira-output.ts`
- Modify: `extensions/jira/jira.test.ts`

**Interfaces:**
- Consumes: parsed JSON values from `twg.ts` and the typed operation name.
- Produces: `formatViewResult(payload: unknown): string`, `formatSearchResult(payload: unknown): string`, and `formatMutationResult(action: "create" | "update" | "comment" | "assign", payload: unknown): string`; each throws `JiraOutputError` on unexpected shapes.

- [ ] **Step 1: Write failing formatter tests using representative envelopes**

```ts
import { JiraOutputError, formatMutationResult, formatSearchResult, formatViewResult } from "./jira-output.ts";

const issue = {
  key: "PROJ-123", summary: "Ship Jira command", description: "A safe command.",
  priority: { name: "High" }, assignee: { displayName: "Ada" }, sprint: { name: "Sprint 42" },
  reporter: { displayName: "Lin" }, resolution: { name: "Done" }, labels: ["cli", "jira"],
  url: "https://example.atlassian.net/browse/PROJ-123",
};

test("renders the selected compact view fields", () => {
  const text = formatViewResult({ data: { items: [issue] } });
  for (const expected of ["PROJ-123", "Ship Jira command", "Sprint 42", "Reporter: Lin", "Resolution: Done", "cli, jira"]) {
    assert.match(text, new RegExp(expected));
  }
});

test("renders compact search rows and rejects an unknown envelope", () => {
  assert.match(formatSearchResult({ data: { items: [{ ...issue, status: { name: "Open" }, updated: "2026-09-19" }] } }), /Open/);
  assert.throws(() => formatSearchResult({ data: {} }), JiraOutputError);
});

test("renders a concise mutation summary", () => {
  assert.match(formatMutationResult("assign", { data: { item: issue } }), /Assigned.*PROJ-123/);
});
```

- [ ] **Step 2: Run formatter tests to verify they fail**

Run: `node --test extensions/jira/jira.test.ts`

Expected: FAIL because `jira-output.ts` does not exist.

- [ ] **Step 3: Implement defensive JSON normalization and renderers**

Implement local runtime guards (`isRecord`, `stringAt`, `nameAt`, `firstItem`) rather than casting `unknown`. Accept the documented common envelope positions—`data.items`, `data.item`, `items`, and `item`—but require a record with a non-empty key and summary for work-item rendering. Render `—` for an absent optional view field, preserve descriptions as plain text, and return explicit no-results copy only for a verified empty search array.

```ts
export class JiraOutputError extends Error {
  constructor(message: string) { super(message); this.name = "JiraOutputError"; }
}

export function formatViewResult(payload: unknown): string {
  const item = requireSingleItem(payload);
  return [
    `${item.key}: ${item.summary}`,
    `Priority: ${item.priority ?? "—"} · Assignee: ${item.assignee ?? "—"} · Sprint: ${item.sprint ?? "—"}`,
    `Reporter: ${item.reporter ?? "—"} · Resolution: ${item.resolution ?? "—"}`,
    `Labels: ${item.labels.join(", ") || "—"}`,
    item.description || "Description: —",
    item.url || "",
  ].filter(Boolean).join("\n");
}
```

Make search use the same normalized fields, including status and updated time. Make mutation text action-specific and include a key/URL when the response supplies one. Do not turn a parse failure or missing collection into an empty result.

- [ ] **Step 4: Run formatter tests to verify they pass**

Run: `node --test extensions/jira/jira.test.ts`

Expected: PASS for parser and formatter tests.

- [ ] **Step 5: Commit output validation and formatting**

```bash
git add extensions/jira/jira-output.ts extensions/jira/jira.test.ts
git commit -m "feat: format jira command results"
```

### Task 3: Implement the typed, safe `twg` adapter

**Files:**
- Create: `extensions/jira/twg.ts`
- Modify: `extensions/jira/jira.test.ts`

**Interfaces:**
- Consumes: `CreateDraft`, `UpdateDraft`, a comment `{ key: string; body: string }`, or a JQL string.
- Produces: `TwgClient` with `view(key)`, `search(jql)`, `create(draft)`, `update(draft)`, `comment(key, body)`, and `assign(key, assignee)`, all returning parsed `unknown` JSON; `build*Args` helpers and `TwgError` are exported for tests.

- [ ] **Step 1: Write failing command-building and runner-error tests**

```ts
import { TwgError, buildAssignArgs, buildCreateArgs, buildSearchArgs, createTwgClient } from "./twg.ts";

test("builds fixed JSON commands with no site override", () => {
  assert.deepEqual(buildSearchArgs("assignee = currentUser()"), ["jira", "workitem", "query", "--jql", "assignee = currentUser()", "--limit", "20", "-o", "json"]);
  assert.deepEqual(buildAssignArgs("PROJ-123", "me"), ["jira", "workitem", "update", "--id", "PROJ-123", "--assignee", "me", "-o", "json"]);
  assert.equal(buildCreateArgs({ project: "PROJ", type: "Task", summary: "S", description: "D" }).includes("--site"), false);
});

test("normalizes nonzero, timeout, malformed JSON, and redacts credentials", async () => {
  const client = createTwgClient(async () => ({ stdout: "", stderr: "Bearer secret-token", exitCode: 1 }), 1000);
  await assert.rejects(() => client.view("PROJ-123"), (error: unknown) => error instanceof TwgError && !error.message.includes("secret-token"));
});
```

- [ ] **Step 2: Run adapter tests to verify they fail**

Run: `node --test extensions/jira/jira.test.ts`

Expected: FAIL because `twg.ts` does not exist.

- [ ] **Step 3: Implement argument builders, spawned runner, and normalized errors**

Use `spawn("twg", args, { shell: false, stdio: ["ignore", "pipe", "pipe"] })`; collect both streams; reject `error` events as a missing-executable error; kill the process on the timeout; and parse stdout only when exit code is zero. Normalize auth-looking failures to a message that says to run `twg login` without echoing sensitive stderr. Redact values following `Bearer`, `token=`, `access_token=`, and `Authorization:` before any other error text is returned.

Implement these exact builders:

```ts
export const buildViewArgs = (key: string) => ["jira", "workitem", "get", key, "-o", "json"];
export const buildSearchArgs = (jql: string) => ["jira", "workitem", "query", "--jql", jql, "--limit", "20", "-o", "json"];
export const buildCommentArgs = (key: string, body: string) => ["jira", "workitem", "comment", "create", "--issue-id", key, "--body", body, "--body-format", "markdown", "-o", "json"];
export const buildAssignArgs = (key: string, assignee: string) => ["jira", "workitem", "update", "--id", key, "--assignee", assignee, "-o", "json"];
```

`buildCreateArgs` adds `--space`, `--type`, `--summary`, `--description`, `--description-format markdown`, optional flags only when non-empty, then `-y -o json`. `buildUpdateArgs` adds `--id` and only supported non-empty changed fields, using `--description-format markdown` if description is set. Reject an update draft with no changed fields before spawning. The client accepts an injected `TwgRunner` in tests and uses a 30,000 ms default runner timeout in production.

- [ ] **Step 4: Run adapter tests to verify they pass**

Run: `node --test extensions/jira/jira.test.ts`

Expected: PASS for parser, formatter, and adapter tests.

- [ ] **Step 5: Commit the safe `twg` adapter**

```bash
git add extensions/jira/twg.ts extensions/jira/jira.test.ts
git commit -m "feat: add safe jira twg adapter"
```

### Task 4: Add strict model conversion for create inference and JQL

**Files:**
- Create: `extensions/jira/inference.ts`
- Modify: `extensions/jira/jira.test.ts`

**Interfaces:**
- Consumes: `inferCreateFields(context: string, runModel: ModelJson): Promise<Partial<Record<"project" | "type" | "summary" | "description", string>>>` and `convertNaturalLanguageToJql(request: string, runModel: ModelJson): Promise<{ jql: string; interpretation: string }>`.
- Produces: `ModelOutputError` for no-model, malformed JSON, markdown-wrapped output, invalid values, or low-confidence inference.

- [ ] **Step 1: Write failing strict-model-output tests**

```ts
import { ModelOutputError, convertNaturalLanguageToJql, inferCreateFields } from "./inference.ts";

test("returns only high-confidence create inference fields", async () => {
  const inferred = await inferCreateFields("We need a bug in PAYMENTS for declined cards.", async () => JSON.stringify({
    project: { value: "PAYMENTS", confidence: 0.95 }, type: { value: "Bug", confidence: 0.95 },
    summary: { value: "Handle declined cards", confidence: 0.95 }, description: { value: "Investigate declined-card flow.", confidence: 0.40 },
  }));
  assert.deepEqual(inferred, { project: "PAYMENTS", type: "Bug", summary: "Handle declined cards" });
});

test("requires an exact JSON JQL object", async () => {
  await assert.rejects(() => convertNaturalLanguageToJql("my open bugs", async () => "```json\n{\"jql\":\"assignee = currentUser()\",\"interpretation\":\"mine\"}\n```"), ModelOutputError);
  await assert.rejects(() => convertNaturalLanguageToJql("my open bugs", async () => "{\"jql\":\"\"}"), ModelOutputError);
});
```

- [ ] **Step 2: Run model-conversion tests to verify they fail**

Run: `node --test extensions/jira/jira.test.ts`

Expected: FAIL because `inference.ts` does not exist.

- [ ] **Step 3: Implement strict JSON parsers and prompts**

Use a single `JSON.parse` over the trimmed full model text; do not strip fences or search for embedded objects. Require non-empty string `jql` and `interpretation`. Reject JQL containing line breaks or a leading `--`, so model text cannot be mistaken for CLI flags. For inference, require an object for each accepted field with a non-empty string `value` and finite numeric `confidence`; return fields only with confidence `>= 0.8`. Include only recent context supplied by the caller and instruct the model to return JSON only, avoid invented facts, use project shortnames, and leave unknown fields absent.

```ts
export async function convertNaturalLanguageToJql(request: string, runModel: ModelJson) {
  const response = await runModel(`${JQL_SYSTEM_INSTRUCTIONS}\nRequest: ${request}`);
  const value = parseExactJsonObject(response, "JQL conversion");
  // validate exactly the jql and interpretation strings, then return them.
}
```

- [ ] **Step 4: Run model-conversion tests to verify they pass**

Run: `node --test extensions/jira/jira.test.ts`

Expected: PASS for all existing tests.

- [ ] **Step 5: Commit strict model conversion**

```bash
git add extensions/jira/inference.ts extensions/jira/jira.test.ts
git commit -m "feat: add jira inference and jql conversion"
```

### Task 5: Implement cancellable interactive prompt flows

**Files:**
- Create: `extensions/jira/prompts.ts`
- Modify: `extensions/jira/jira.test.ts`

**Interfaces:**
- Consumes: `JiraUi` (`input`, `select`, `editor`, `confirm`, `notify`) and partial create values from Task 4.
- Produces: `collectCreateDraft(ui, inferred, suppliedProject): Promise<CreateDraft | null>`, `collectUpdateDraft(ui, key?): Promise<UpdateDraft | null>`, `collectComment(ui, key?): Promise<{ key: string; body: string } | null>`, `collectAssignment(ui, key?): Promise<{ key: string; assignee: string } | null>`, and `confirmOperation(ui, summary): Promise<boolean>`.

- [ ] **Step 1: Write failing prompt-flow tests with a scripted UI fake**

```ts
import { collectCreateDraft, collectUpdateDraft } from "./prompts.ts";

const scriptedUi = (answers: Array<string | boolean | undefined>) => ({
  input: async () => answers.shift() as string | undefined,
  editor: async () => answers.shift() as string | undefined,
  select: async () => answers.shift() as string | undefined,
  confirm: async () => answers.shift() as boolean | undefined,
  notify: () => {},
});

test("reviews inferred create fields and prompts only missing values", async () => {
  const draft = await collectCreateDraft(scriptedUi(["PAYMENTS", "Bug", "Handle declined cards", "Description", "Skip optional fields"]), { project: "PAYMENTS", type: "Bug", summary: "Handle declined cards" });
  assert.deepEqual(draft, { project: "PAYMENTS", type: "Bug", summary: "Handle declined cards", description: "Description" });
});

test("cancelling update field selection returns null", async () => {
  assert.equal(await collectUpdateDraft(scriptedUi(["PROJ-123", undefined])), null);
});
```

- [ ] **Step 2: Run prompt-flow tests to verify they fail**

Run: `node --test extensions/jira/jira.test.ts`

Expected: FAIL because `prompts.ts` does not exist.

- [ ] **Step 3: Implement sequential, editable field collection**

Adapt Pi UI to `JiraUi`, preserving `undefined` as cancellation. Use `input` for one-line fields and `editor(title, initialValue)` for summary/description so inferred values are editable. For create, collect required project/type/summary/description in order, then offer one select choice: `Add optional fields` or `Skip optional fields`; if selected, collect assignee, priority, labels, and parent, treating blank optional values as absent. For update, collect the key if missing, use a multi-select-by-repeated-select loop over exactly Summary, Description, Priority, Assignee, Sprint, and reject no selected changes. For comments, use an editor for the body. For assignment, prompt assignee with `me` and `none` accepted.

Return `null` immediately for any cancellation; do not notify success or construct `twg` arguments here. `confirmOperation` must show the complete values-to-be-sent summary and return false on cancellation.

- [ ] **Step 4: Run prompt-flow tests to verify they pass**

Run: `node --test extensions/jira/jira.test.ts`

Expected: PASS for all existing tests.

- [ ] **Step 5: Commit prompt flows**

```bash
git add extensions/jira/prompts.ts extensions/jira/jira.test.ts
git commit -m "feat: add jira interactive prompts"
```

### Task 6: Wire the Pi command orchestration

**Files:**
- Create: `extensions/jira/index.ts`
- Modify: `extensions/jira/jira.test.ts`

**Interfaces:**
- Consumes: parser, prompt, conversion, output, and `TwgClient` interfaces from Tasks 1-5; Pi `ExtensionAPI` and command context.
- Produces: default extension factory registering `pi.registerCommand("jira", …)` and exported `createJiraCommandHandler(deps)` for integration tests.

- [ ] **Step 1: Write failing orchestration tests with fake UI, model, and client**

```ts
import { createJiraCommandHandler } from "./index.ts";

test("shows JQL and does not query when search confirmation is declined", async () => {
  let queried = false;
  const handler = createJiraCommandHandler({
    convertJql: async () => ({ jql: "status = Open", interpretation: "Open issues" }),
    twg: { search: async () => { queried = true; return {}; } },
    // supply fake UI methods: confirm returns false and notify collects messages
  } as any);
  await handler("search open issues", fakeCommandContext);
  assert.equal(queried, false);
  assert.match(notifications.join("\n"), /status = Open/);
});

test("a cancelled mutation never invokes twg", async () => {
  let created = false;
  // Fake prompt collection returns a complete draft; fake confirmation returns false.
  await handler("create PROJ", fakeCommandContext);
  assert.equal(created, false);
});
```

- [ ] **Step 2: Run orchestration tests to verify they fail**

Run: `node --test extensions/jira/jira.test.ts`

Expected: FAIL because `index.ts` does not exist.

- [ ] **Step 3: Implement the command handler and production adapters**

`createJiraCommandHandler(deps)` parses input and follows this exact routing:

1. Help: notify `JIRA_HELP`; return.
2. View: invoke `twg.view(key)`; notify `formatViewResult(payload)`.
3. Search: reject blank natural-language text; call `convertNaturalLanguageToJql`; notify interpretation and JQL; require `confirmOperation`; call `twg.search(jql)` only after confirmation; notify formatted search results.
4. Create: obtain recent context via `buildSessionContext(ctx.sessionManager.getEntries(), ctx.sessionManager.getLeafId()).messages`, serialize only the latest 40 text-bearing user/assistant messages, call inference when an active model exists, collect/edit the create draft, confirm it, then call `twg.create` and notify the mutation result.
5. Update, comment, assign: collect the draft/value; confirm; invoke exactly one matching typed client method; notify the mutation result.

The production model adapter must check `ctx.model`, call `ctx.modelRegistry.streamSimple(ctx.model, { messages: [{ role: "user", content: prompt, timestamp: Date.now() }] }, { reasoning: "low" })`, await `stream.result()`, reject `stopReason` `"error"` or `"aborted"`, and join only assistant text content. Keep this adapter behind the injected `ModelJson` boundary so tests do not call a provider.

Catch expected `ModelOutputError`, `TwgError`, `JiraOutputError`, and prompt validation errors; notify only their safe message at error level. Catch unknown errors and notify `Jira command failed.` without serializing error objects. All cancellation paths return before a `twg` client call.

- [ ] **Step 4: Run orchestration tests to verify they pass**

Run: `node --test extensions/jira/jira.test.ts`

Expected: PASS for all existing tests.

- [ ] **Step 5: Commit the `/jira` command**

```bash
git add extensions/jira/index.ts extensions/jira/jira.test.ts
git commit -m "feat: add jira command"
```

### Task 7: Complete failure-path coverage and verify the package

**Files:**
- Modify: `extensions/jira/jira.test.ts`
- Modify: `README.md:1-200`

**Interfaces:**
- Consumes: the completed command and test fakes from Tasks 1-6.
- Produces: documented `/jira` availability and a credential-free test suite that exercises all specified failures.

- [ ] **Step 1: Add failing end-to-end boundary tests**

Add test cases for every review-focus item and remaining required failure path:

```ts
test("does not run twg after cancelled create editor, optional-field prompt, or confirmation", async () => {
  // Run three scripted create flows, each returning undefined at one stage.
  // Assert the fake client's create call count stays zero for all three.
});

test("surfaces missing executable, timeout, auth failure, nonzero exit, and malformed JSON as safe errors", async () => {
  // Inject runners that reject with ENOENT, never settle until timeout, return auth stderr,
  // return exit code 1, and return stdout "not-json". Assert distinct actionable safe messages.
});

test("does not use raw JQL or unsupported verbs as a subprocess command", async () => {
  // `/jira search project = PROJ` must still call model conversion; `transition` and `link`
  // must show help and leave the fake runner's calls empty.
});
```

- [ ] **Step 2: Run the focused extension suite to verify new tests fail**

Run: `node --test extensions/jira/jira.test.ts`

Expected: FAIL until all described boundaries are handled.

- [ ] **Step 3: Make only the required robustness fixes and document usage**

Add the smallest guard needed for each failing test. Do not add transitions, links, raw-JQL mode, site selection, credentials, direct API calls, dashboards, or sprint management. Add a concise README section:

```markdown
## Jira

`/jira` uses the locally configured `twg` OAuth session for Jira Cloud work items.

- `/jira PROJ-123` views an issue.
- `/jira search open bugs assigned to me` converts the request to JQL and asks before querying.
- `/jira create`, `/jira update PROJ-123`, `/jira comment PROJ-123`, and `/jira assign PROJ-123` collect fields interactively and require confirmation.

Run `twg login` if the command reports that authentication is unavailable.
```

- [ ] **Step 4: Run the complete repository test suite and package sanity checks**

Run: `node --test extensions/*.test.mjs extensions/jira/jira.test.ts && git diff --check && git status --short`

Expected: all tests PASS, whitespace check succeeds, and only the intended README/test changes are unstaged before the commit.

- [ ] **Step 5: Commit final coverage and documentation**

```bash
git add extensions/jira/jira.test.ts README.md
git commit -m "test: cover jira command failures"
```
