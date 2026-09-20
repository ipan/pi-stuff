import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const { buildSpawnArgs, resolveZedDirectory } = await import("./zed.ts");

test("buildSpawnArgs leaves explicit directory opening to Zed's documented default", () => {
	assert.deepEqual(buildSpawnArgs([], ["/repo"], false), ["/repo"]);
	assert.deepEqual(buildSpawnArgs(["--existing"], ["/repo"], false), ["--existing", "/repo"]);
});

test("resolveZedDirectory passes the session cwd when no directory is supplied", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "pi-zed-"));
	try {
		assert.equal(await resolveZedDirectory(cwd, []), cwd);
	} finally {
		await rm(cwd, { recursive: true, force: true });
	}
});

test("resolveZedDirectory resolves one explicit directory from the session cwd", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "pi-zed-"));
	const directory = join(cwd, "nested");
	try {
		await mkdir(directory);
		assert.equal(await resolveZedDirectory(cwd, ["nested"]), directory);
	} finally {
		await rm(cwd, { recursive: true, force: true });
	}
});

test("resolveZedDirectory rejects a file", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "pi-zed-"));
	const filePath = join(cwd, "file.ts");
	try {
		await writeFile(filePath, "export {};\n");
		await assert.rejects(resolveZedDirectory(cwd, ["file.ts"]), /not a directory/);
	} finally {
		await rm(cwd, { recursive: true, force: true });
	}
});

test("resolveZedDirectory rejects multiple directory arguments", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "pi-zed-"));
	try {
		await assert.rejects(resolveZedDirectory(cwd, [".", "."]), /at most one directory/);
	} finally {
		await rm(cwd, { recursive: true, force: true });
	}
});
