# Jira View Overlay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `/jira <issue-key>` open a scrollable TUI overlay with a fixed wrapped summary header, fixed metadata footer, clickable Jira URL, and Tab-controlled additional fields.

**Architecture:** Keep Jira JSON normalization in `jira-output.ts`, add a focused `JiraIssueOverlay` component in `jira-overlay.ts`, and make `index.ts` choose the overlay for TUI view commands while retaining notification fallback in non-TUI modes. The overlay will own scroll position and visibility state, render the body between fixed header/footer regions, and close through the existing `ctx.ui.custom()` completion callback.

**Tech Stack:** TypeScript, Pi extension API, `@earendil-works/pi-tui` custom components, Node test runner, jiti integration tests.

**Spec:** `docs/superpowers/specs/2026-09-20-jira-view-overlay-design.md`

## Global Constraints

- The `/jira` view action only changes its interactive presentation; search and mutation output remain unchanged.
- Use the theme and keybindings supplied by `ctx.ui.custom()`; do not import global theme state.
- Every rendered line must obey the TUI width contract.
- Header and footer stay fixed while the description body scrolls.
- `Tab` toggles the existing secondary fields; `Esc` closes the overlay.
- Malformed Jira output remains a `JiraOutputError` and non-TUI modes retain notification fallback.
- Use the existing dependency set; do not add a runtime package.

## Review Focus

- ADF descriptions with nested headings, lists, and text nodes must flatten into readable body lines; test in Task 1.
- Missing optional fields and missing URL must render placeholders without breaking fixed footer layout; test in Task 1 and Task 2.
- Very long summaries must wrap instead of exceeding overlay width; test in Task 2.
- Description shorter than the viewport must not produce invalid scroll positions; test in Task 2.
- TUI and non-TUI command contexts must select different output paths without invoking unavailable custom UI; test in Task 3.

---

### Task 1: Expose a structured Jira view model

**Files:**
- Modify: `extensions/jira/jira-output.ts`
- Test: `extensions/jira/jira.test.ts`

**Interfaces:**
- Produces `JiraViewModel` with `key`, `summary`, `description`, `issueType`, `priority`, `url`, and `additionalFields`.
- Produces `parseViewResult(payload: unknown): JiraViewModel`.
- Keeps `formatViewResult(payload: unknown): string` as the existing compact fallback, implemented from the same parsed model.

- [ ] **Step 1: Write failing parser/model tests**

Add a fixture containing the live `data: [...]` envelope shape, an ADF description with heading/paragraph/list nesting, issue type, priority, URL, and secondary fields. Add tests asserting:

```ts
const view = parseViewResult({ data: [{
  key: "IRS-66465",
  summary: "A very long summary",
  issuetype: { name: "Task" },
  priority: { name: "High" },
  description: { type: "doc", content: [
    { type: "heading", content: [{ type: "text", text: "Context" }] },
    { type: "paragraph", content: [{ type: "text", text: "Details" }] },
  ] },
  assignee: { displayName: "Ada" },
  sprint: { name: "Sprint 1" },
  reporter: { displayName: "Lin" },
  resolution: { name: "Done" },
  labels: ["one", "two"],
  url: "https://example.atlassian.net/browse/IRS-66465",
}] });
assert.deepEqual(view, {
  key: "IRS-66465",
  summary: "A very long summary",
  description: "Context\nDetails",
  issueType: "Task",
  priority: "High",
  url: "https://example.atlassian.net/browse/IRS-66465",
  additionalFields: [
    ["Assignee", "Ada"], ["Sprint", "Sprint 1"],
    ["Reporter", "Lin"], ["Resolution", "Done"], ["Labels", "one, two"],
  ],
});
```

Also assert missing optional values become `"—"`, missing URL becomes `undefined`, and malformed/no-item payloads throw `JiraOutputError`.

- [ ] **Step 2: Run the focused tests and verify failure**

Run:

```bash
node --test extensions/jira/jira.test.ts
```

Expected: FAIL because `parseViewResult` and `JiraViewModel` do not yet exist.

- [ ] **Step 3: Implement the structured parser minimally**

In `jira-output.ts`:

1. Export the `JiraViewModel` type.
2. Reuse the existing envelope/item validation.
3. Extract issue type from `issuetype.name`, priority from `priority.name` (or existing nested-name behavior), and the five secondary fields.
4. Flatten ADF recursively by collecting `text` nodes and joining block content with newlines; preserve plain string descriptions.
5. Export `parseViewResult`.
6. Build `formatViewResult` from the parsed model so fallback output retains its current labels and lines.

Keep the parser strict about missing key/summary and tolerant about optional fields.

- [ ] **Step 4: Run focused tests and verify green**

Run:

```bash
node --test extensions/jira/jira.test.ts
```

Expected: all existing tests plus the structured model tests pass.

- [ ] **Step 5: Commit the parser boundary**

```bash
git add extensions/jira/jira-output.ts extensions/jira/jira.test.ts
git commit -m "feat: expose structured jira view data"
```

### Task 2: Build the scrollable Jira issue overlay

**Files:**
- Create: `extensions/jira/jira-overlay.ts`
- Modify: `extensions/jira/jira.test.ts`

**Interfaces:**
- Consumes `JiraViewModel` from `jira-output.ts`.
- Exports `JiraIssueOverlay` implementing the Pi TUI component interface.
- Constructor shape:

```ts
new JiraIssueOverlay(
  view: JiraViewModel,
  theme: Theme,
  tui: TUI,
  done: () => void,
)
```

- [ ] **Step 1: Write failing component tests**

Add tests using a small fake TUI/theme and instantiate the component with an `IRS-66465` fixture. Assert:

- initial `render(50)` contains the wrapped summary, description, `Task · High`, and the raw URL text;
- initial output does not contain `Assignee:`;
- `handleInput` with `Key.tab` causes the next render to contain `Assignee: Ada`, `Sprint: Sprint 1`, `Reporter: Lin`, `Resolution: Done`, and `Labels: one, two`;
- `handleInput` with `Key.escape` calls `done`;
- long description plus `Key.down` changes the visible body while the summary and footer remain present;
- no rendered line exceeds the supplied width.

Use `matchesKey` and `Key` in the test expectations rather than hardcoding escape byte sequences.

- [ ] **Step 2: Run component tests and verify failure**

Run:

```bash
node --test extensions/jira/jira.test.ts
```

Expected: FAIL because `jira-overlay.ts` does not yet exist.

- [ ] **Step 3: Implement the overlay**

Implement `JiraIssueOverlay` with:

1. Fixed header lines produced by `wrapTextWithAnsi(view.summary, innerWidth)`.
2. A body line array from `view.description.split("\n")`, with an explicit empty-description line.
3. A dynamic footer containing the five additional-field lines when `showAdditional` is true, followed by `Issue type: ${view.issueType} · Priority: ${view.priority}` and the URL wrapped in the OSC 8 sequence `\x1b]8;;${url}\x07${url}\x1b]8;;\x07` when present.
4. Keep header and footer outside the scroll window; the footer height changes with the Tab toggle.
5. `scrollTop` clamped to the available body line count and viewport height.
6. Keyboard handling for `Key.up`, `Key.down`, `Key.pageUp`, `Key.pageDown`, `Key.home`, `Key.end`, `Key.tab`, and `Key.escape`, plus mouse-wheel handling through `handleMouse`; every state change calls `tui.requestRender()` and `invalidate()`.
7. A framed overlay render that pads/truncates each line to the requested width and never emits lines wider than `width`.

Use the theme from the constructor and `matchesKey` for input matching. Do not use a global theme import.

- [ ] **Step 4: Run component tests and verify green**

Run:

```bash
node --test extensions/jira/jira.test.ts
```

Expected: all parser and overlay tests pass.

- [ ] **Step 5: Commit the overlay**

```bash
git add extensions/jira/jira-overlay.ts extensions/jira/jira.test.ts
git commit -m "feat: add scrollable jira issue overlay"
```

### Task 3: Route `/jira view` through the overlay

**Files:**
- Modify: `extensions/jira/index.ts`
- Modify: `extensions/jira/jira.test.ts`

**Interfaces:**
- Consumes `parseViewResult` and `JiraIssueOverlay`.
- Uses the existing `Context` fields and `ctx.mode` to distinguish TUI mode.
- Uses `ctx.ui.custom<void>(factory, { overlay: true, overlayOptions: { anchor: "center", width: "80%", minWidth: 60, maxHeight: "60%" } })`.

- [ ] **Step 1: Write failing handler tests**

Add a test with a fake TUI context and injected `twg.view` returning the `IRS-66465` fixture. Assert that a TUI context invokes `ui.custom` with `overlay: true` and that its factory receives the parsed view. Add a non-TUI test asserting the existing `ui.notify(formatViewResult(...))` fallback is used and `ui.custom` is not called.

- [ ] **Step 2: Run handler tests and verify failure**

Run:

```bash
node --test extensions/jira/jira.test.ts
```

Expected: FAIL because the current handler always calls `notify` for `view` and does not expose `mode` or custom overlay behavior.

- [ ] **Step 3: Implement TUI routing**

Update the command context type to include `mode?: string`. In the `view` branch:

```ts
const payload = await twg.view(parsed.key);
if (ctx.mode === "tui" && typeof ctx.ui.custom === "function") {
  const view = parseViewResult(payload);
  await ctx.ui.custom<void>(
    (tui, theme, _keybindings, done) => new JiraIssueOverlay(view, theme, tui, done),
    {
      overlay: true,
      overlayOptions: { anchor: "center", width: "80%", minWidth: 60, maxHeight: "60%" },
    },
  );
  return;
}
notify(ctx, formatViewResult(payload));
```

Preserve the existing catch block so parser, `twg`, and overlay errors use current user-facing error handling.

- [ ] **Step 4: Run handler and full tests**

Run:

```bash
node --test extensions/jira/jira.test.ts
node --test extensions/*.test.mjs extensions/jira/jira.test.ts
```

Expected: 14+ Jira tests and the complete repository suite pass with zero failures.

- [ ] **Step 5: Commit command integration**

```bash
git add extensions/jira/index.ts extensions/jira/jira.test.ts
git commit -m "feat: show jira views in an interactive overlay"
```

### Task 4: Final verification and documentation

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Document overlay behavior**

Update the Jira README section to state that `/jira <KEY>` opens an interactive overlay in TUI mode, with scrollable description, `Tab` for additional fields, `Esc` to close, and clickable URL when supported. Keep non-TUI behavior documented as compact output.

- [ ] **Step 2: Run final verification**

Run:

```bash
node --test extensions/*.test.mjs extensions/jira/jira.test.ts
git diff --check
git status --short
```

Expected: all tests pass, diff check produces no output, and only intended working-tree changes remain.

- [ ] **Step 3: Review the final diff against the spec**

Verify each spec requirement: fixed wrapped summary, scrollable description, fixed two-line footer, clickable URL, Tab toggle, Esc close, malformed-output handling, and non-TUI fallback.

- [ ] **Step 4: Commit documentation and final changes**

```bash
git add README.md extensions/jira extensions/jira/jira.test.ts
git commit -m "docs: describe jira issue overlay"
```
