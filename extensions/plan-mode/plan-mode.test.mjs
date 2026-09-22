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
