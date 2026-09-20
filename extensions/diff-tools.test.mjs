import test from "node:test";
import assert from "node:assert/strict";
import { getFileSections, parseUnifiedDiff } from "./diff-tools.mjs";

test("getFileSections returns each file name and its first diff row", () => {
	const rows = parseUnifiedDiff([
		"diff --git a/README.md b/README.md",
		"--- a/README.md",
		"+++ b/README.md",
		"@@ -1 +1 @@",
		"-old",
		"+new",
		"diff --git a/src/app.ts b/src/app.ts",
		"--- a/src/app.ts",
		"+++ b/src/app.ts",
		"@@ -1 +1 @@",
		"-old",
		"+new",
	].join("\n"));

	assert.deepEqual(getFileSections(rows, new Set(["src/app.ts"])), [
		{ name: "README.md", rowIndex: 0, untracked: false },
		{ name: "src/app.ts", rowIndex: 6, untracked: true },
	]);
});

test("parseUnifiedDiff tracks old and new line numbers through a hunk", () => {
	const diff = [
		"diff --git a/src/app.ts b/src/app.ts",
		"index 1111111..2222222 100644",
		"--- a/src/app.ts",
		"+++ b/src/app.ts",
		"@@ -10,3 +10,4 @@ function greet() {",
		" const name = getName();",
		"-return `Hi ${name}`;",
		"+return `Hello ${name}`;",
		"+console.log(name);",
		" }",
	].join("\n");

	assert.deepEqual(parseUnifiedDiff(diff), [
		{ kind: "file", text: "src/app.ts" },
		{ kind: "meta", text: "index 1111111..2222222 100644" },
		{ kind: "meta", text: "--- a/src/app.ts" },
		{ kind: "meta", text: "+++ b/src/app.ts" },
		{ kind: "hunk", text: "@@ -10,3 +10,4 @@ function greet() {" },
		{ kind: "context", oldLine: 10, newLine: 10, text: " const name = getName();" },
		{ kind: "remove", oldLine: 11, newLine: null, text: "-return `Hi ${name}`;" },
		{ kind: "add", oldLine: null, newLine: 11, text: "+return `Hello ${name}`;" },
		{ kind: "add", oldLine: null, newLine: 12, text: "+console.log(name);" },
		{ kind: "context", oldLine: 12, newLine: 13, text: " }" },
	]);
});
