import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const {
  PLAN_MODE_STATE_TYPE,
  activePlanTools,
  createPlanModeState,
  restoreActiveTools,
  restorePlanModeState,
} = await import("./state.ts");

test("plan mode keeps only known read tools and restores the exact prior loadout", () => {
  const all = ["read", "grep", "find", "ls", "bash", "write", "edit", "jira"];
  const before = ["read", "bash", "jira"];
  assert.deepEqual(activePlanTools(all), ["read", "grep", "find", "ls"]);
  assert.deepEqual(restoreActiveTools(before, all), before);
});

test("restores the last valid persisted state and ignores unavailable tools", () => {
  const entries = [
    { type: "custom", customType: PLAN_MODE_STATE_TYPE, data: { enabled: false, restoreTools: ["read"] } },
    { type: "custom", customType: PLAN_MODE_STATE_TYPE, data: { enabled: true, restoreTools: ["read", "bash", "removed"] } },
    { type: "custom", customType: PLAN_MODE_STATE_TYPE, data: { enabled: "wrong", restoreTools: [] } },
  ];
  assert.deepEqual(restorePlanModeState(entries), { enabled: true, restoreTools: ["read", "bash", "removed"] });
  assert.deepEqual(restoreActiveTools(["read", "bash", "removed"], ["read", "bash"]), ["read", "bash"]);
});

test("copies and normalizes state without persisting empty tool names", () => {
  const state = createPlanModeState(true, ["read", "", "read", " bash "]);
  assert.deepEqual(state, { enabled: true, restoreTools: ["read", "bash"] });
});

const {
  PLAN_MODE_BLOCK_REASON,
  default: planModeExtension,
  parsePlanModeArgs,
  planModeSystemPrompt,
  shouldBlockPlanTool,
} = await import("./index.ts");

test("parses explicit plan state and rejects invalid arguments", () => {
  assert.equal(parsePlanModeArgs("", false), true);
  assert.equal(parsePlanModeArgs("", true), false);
  assert.equal(parsePlanModeArgs("on", false), true);
  assert.equal(parsePlanModeArgs("off", true), false);
  assert.equal(parsePlanModeArgs("toggle", true), false);
  assert.equal(parsePlanModeArgs("later", false), undefined);
});

test("blocks every mutating or unknown LLM tool while retaining only read tools", () => {
  for (const name of ["write", "edit", "bash", "powershell", "deploy", "custom_writer"]) {
    assert.equal(shouldBlockPlanTool(name), true, name);
  }
  for (const name of ["read", "grep", "find", "ls"]) assert.equal(shouldBlockPlanTool(name), false, name);
  assert.match(planModeSystemPrompt("Base prompt"), /must not modify the workspace/i);
  assert.match(PLAN_MODE_BLOCK_REASON, /Plan mode is active/);
});

test("registers plan controls and safety event handlers", () => {
  const flags = [];
  const commands = [];
  const shortcuts = [];
  const events = [];
  planModeExtension({
    registerFlag: (name) => flags.push(name),
    registerCommand: (name) => commands.push(name),
    registerShortcut: (name) => shortcuts.push(name),
    on: (name) => events.push(name),
  });
  assert.deepEqual(flags, ["plan"]);
  assert.deepEqual(commands, ["plan", "save-plan"]);
  assert.deepEqual(shortcuts, ["ctrl+shift+p"]);
  assert.deepEqual(events, ["session_start", "before_agent_start", "tool_call", "user_bash"]);
});

const {
  defaultPlanPath,
  latestAssistantText,
  renderPlanMarkdown,
  resolvePlanPath,
  writePlanFile,
} = await import("./plan.ts");

test("uses a deterministic in-workspace default and rejects traversal", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-plan-path-"));
  const now = new Date("2026-09-22T12:00:00Z");
  try {
    assert.equal(defaultPlanPath(now), "docs/plans/2026-09-22-plan.md");
    assert.equal(resolvePlanPath(cwd, "", now), join(cwd, "docs/plans/2026-09-22-plan.md"));
    assert.throws(() => resolvePlanPath(cwd, "../escape.md", now), /inside the workspace/);
    assert.throws(() => resolvePlanPath(cwd, "/tmp/escape.md", now), /inside the workspace/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("rejects an export whose existing parent symlink resolves outside the workspace", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-plan-workspace-"));
  const outside = await mkdtemp(join(tmpdir(), "pi-plan-outside-"));
  try {
    await symlink(outside, join(cwd, "docs"));
    assert.throws(() => resolvePlanPath(cwd, "docs/plans/escaped.md", new Date("2026-09-22T12:00:00Z")), /inside the workspace/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test("renders a proposal as a plan document and selects the latest assistant response", () => {
  const markdown = renderPlanMarkdown("## Steps\n\n1. Add a gate.", new Date("2026-09-22T12:00:00Z"));
  assert.match(markdown, /^# Plan\n/m);
  assert.match(markdown, /## Steps/);
  const entries = [
    { type: "message", message: { role: "assistant", content: [{ type: "text", text: "old" }] } },
    { type: "message", message: { role: "user", content: [{ type: "text", text: "request" }] } },
    { type: "message", message: { role: "assistant", content: [{ type: "text", text: "new proposal" }] } },
  ];
  assert.equal(latestAssistantText(entries), "new proposal");
});

test("writes once and refuses an existing export", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-plan-"));
  const target = join(cwd, "docs", "plans", "proposal.md");
  try {
    assert.equal(await writePlanFile(target, "# Plan\n"), "created");
    await assert.rejects(() => writePlanFile(target, "# Plan\n"), /already exists/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

function createExtensionHarness() {
  const commands = new Map();
  planModeExtension({
    registerFlag: () => {}, registerShortcut: () => {}, on: () => {},
    registerCommand: (name, command) => commands.set(name, command),
    getActiveTools: () => ["read", "write"],
    getAllTools: () => [{ name: "read" }, { name: "write" }],
    setActiveTools: () => {}, appendEntry: () => {}, getFlag: () => false,
  });
  return commands;
}

test("save-plan writes only after editor and confirmation approve it", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-plan-command-"));
  const command = createExtensionHarness().get("save-plan");
  const entries = [{ type: "message", message: { role: "assistant", content: [{ type: "text", text: "Proposal" }] } }];
  const notices = [];
  const context = (editor, confirm, hasUI = true) => ({
    cwd, hasUI, mode: hasUI ? "tui" : "print", sessionManager: { getBranch: () => entries },
    ui: { editor, confirm, notify: (message) => notices.push(message), setStatus: () => {} },
  });
  try {
    await command.handler("docs/plans/cancelled.md", context(async () => undefined, async () => true));
    await assert.rejects(() => readFile(join(cwd, "docs/plans/cancelled.md"), "utf8"));
    await command.handler("docs/plans/declined.md", context(async () => "Proposal", async () => false));
    await assert.rejects(() => readFile(join(cwd, "docs/plans/declined.md"), "utf8"));
    await command.handler("docs/plans/saved.md", context(async () => "Edited proposal", async () => true));
    assert.match(await readFile(join(cwd, "docs/plans/saved.md"), "utf8"), /Edited proposal/);
    await command.handler("docs/plans/print.md", context(async () => "Proposal", async () => true, false));
    await assert.rejects(() => readFile(join(cwd, "docs/plans/print.md"), "utf8"));
    assert.ok(notices.includes("Plan export requires an interactive confirmation."));
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

function createLifecycleHarness({ active = ["read", "bash"], all = ["read", "grep", "find", "ls", "bash"], flag = false } = {}) {
  const commands = new Map();
  const handlers = new Map();
  const setActiveTools = [];
  const statuses = [];
  const notifications = [];
  const entries = [];
  planModeExtension({
    registerFlag: () => {}, registerShortcut: () => {},
    registerCommand: (name, command) => commands.set(name, command),
    on: (name, handler) => handlers.set(name, handler),
    getActiveTools: () => active,
    getAllTools: () => all.map((name) => ({ name })),
    setActiveTools: (tools) => setActiveTools.push(tools),
    appendEntry: (...entry) => entries.push(entry), getFlag: () => flag,
  });
  const context = (branch) => ({
    hasUI: true, cwd: "/repo", mode: "tui", waitForIdle: async () => {},
    sessionManager: { getBranch: () => branch },
    ui: { setStatus: (_key, value) => statuses.push(value), notify: (message) => notifications.push(message) },
  });
  return { commands, context, entries, handlers, notifications, setActiveTools, statuses };
}

test("restores plan-mode state idempotently and restores only available tools on exit", async () => {
  const enabled = createLifecycleHarness();
  const branch = [{ type: "custom", customType: PLAN_MODE_STATE_TYPE, data: { enabled: true, restoreTools: ["read", "bash", "removed-tool"] } }];
  await enabled.handlers.get("session_start")({}, enabled.context(branch));
  assert.deepEqual(enabled.setActiveTools, [["read", "grep", "find", "ls"]]);
  assert.deepEqual(enabled.statuses, ["PLAN"]);
  assert.deepEqual(enabled.entries, []);
  await enabled.commands.get("plan").handler("off", enabled.context(branch));
  assert.deepEqual(enabled.setActiveTools.at(-1), ["read", "bash"]);
  assert.equal(enabled.notifications.at(-1), "Plan mode disabled: previous tools restored.");

  const disabled = createLifecycleHarness();
  await disabled.handlers.get("session_start")({}, disabled.context([{ type: "custom", customType: PLAN_MODE_STATE_TYPE, data: { enabled: false, restoreTools: ["read"] } }]));
  assert.deepEqual(disabled.setActiveTools, []);
  assert.deepEqual(disabled.statuses, [undefined]);
});

test("documents plan controls and their shell safety boundary", async () => {
  const readme = await readFile(new URL("../../README.md", import.meta.url), "utf8");
  for (const text of ["/plan", "--plan", "/save-plan", "explicitly confirm", "every user shell command"]) {
    assert.match(readme, new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});
