import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const {
	buildEditorInvocation,
	createRecentFiles,
	getChangedFilePath,
	parseEditArgs,
	recordChangedFile,
	resolveEditTargets,
} = await import("./edit.ts");

test("parseEditArgs reserves recent as the recent-files subcommand", () => {
	assert.deepEqual(parseEditArgs(["recent"]), { recent: true, paths: [] });
	assert.deepEqual(parseEditArgs(["@notes.md"]), { recent: false, paths: ["@notes.md"] });
});

test("resolveEditTargets resolves @ paths and allows a new file", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "pi-edit-"));
	try {
		assert.deepEqual(resolveEditTargets(cwd, ["@notes.md", "@folder/file.ts"]), [
			join(cwd, "notes.md"),
			join(cwd, "folder/file.ts"),
		]);
	} finally {
		await rm(cwd, { recursive: true, force: true });
	}
});

test("buildEditorInvocation preserves editor flags and target arguments", () => {
	assert.deepEqual(buildEditorInvocation("nvim -f", ["/repo/file one.ts"]), {
		command: "nvim",
		args: ["-f", "/repo/file one.ts"],
	});
});

test("recent files retain changed paths in most-recent order", () => {
	const recent = createRecentFiles();
	recordChangedFile(recent, "/repo/first.ts");
	recordChangedFile(recent, "/repo/second.ts");
	recordChangedFile(recent, "/repo/first.ts");

	assert.deepEqual(recent, ["/repo/first.ts", "/repo/second.ts"]);
	assert.equal(getChangedFilePath("write", { path: "src/app.ts" }, "/repo"), "/repo/src/app.ts");
	assert.equal(getChangedFilePath("read", { path: "src/app.ts" }, "/repo"), undefined);
});
