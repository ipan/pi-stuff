import test from "node:test";
import assert from "node:assert/strict";

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
