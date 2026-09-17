import test from "node:test";
import assert from "node:assert/strict";
import { getBtwTools } from "./btw-tools.mjs";

test("default BTW mode is read-only", () => {
	assert.deepEqual(getBtwTools(false), ["read", "bash"]);
});

test("BTW edit mode enables file editing tools", () => {
	assert.deepEqual(getBtwTools(true), ["read", "bash", "edit", "write"]);
});
