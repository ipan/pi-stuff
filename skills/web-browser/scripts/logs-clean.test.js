import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cleanLogs } from "./logs-clean.js";

test("removes log files older than the requested retention period", () => {
	const root = mkdtempSync(join(tmpdir(), "agent-web-logs-"));
	const oldFile = join(root, "old.jsonl");
	const newFile = join(root, "new.jsonl");
	writeFileSync(oldFile, "old");
	writeFileSync(newFile, "new");
	const oldDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
	utimesSync(oldFile, oldDate, oldDate);

	const removed = cleanLogs(root, 7);

	assert.equal(removed, 1);
	assert.equal(existsSync(oldFile), false);
	assert.equal(existsSync(newFile), true);
});

test("does not delete files when retention is zero or negative", () => {
	const root = mkdtempSync(join(tmpdir(), "agent-web-logs-"));
	const file = join(root, "keep.jsonl");
	writeFileSync(file, "keep");
	assert.equal(cleanLogs(root, 0), 0);
	assert.equal(existsSync(file), true);
});
