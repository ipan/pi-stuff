import test from "node:test";
import assert from "node:assert/strict";
import { createRecentFiles, recordChangedFile } from "./zed-tools.mjs";

test("recordChangedFile keeps changed files in most-recent order", () => {
	const recent = createRecentFiles();

	recordChangedFile(recent, "/repo/first.ts");
	recordChangedFile(recent, "/repo/second.ts");
	recordChangedFile(recent, "/repo/first.ts");

	assert.deepEqual(recent, ["/repo/first.ts", "/repo/second.ts"]);
});

test("recordChangedFile ignores empty paths", () => {
	const recent = createRecentFiles();

	recordChangedFile(recent, "");
	recordChangedFile(recent, "   ");

	assert.deepEqual(recent, []);
});
