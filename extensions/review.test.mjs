import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = new URL("./review.ts", import.meta.url);
const readme = new URL("../README.md", import.meta.url);

test("ships the attributed review extension and documents its commands", async () => {
  const [extension, documentation] = await Promise.all([
    readFile(source, "utf8"),
    readFile(readme, "utf8"),
  ]);

  assert.match(extension, /Originally authored by Armin Ronacher/);
  assert.match(extension, /https:\/\/github\.com\/mitsuhiko\/agent-stuff/);
  assert.match(extension, /registerCommand\("review"/);
  assert.match(extension, /registerCommand\("end-review"/);
  assert.match(documentation, /\[\`review\.ts\`\]\(extensions\/review\.ts\)/);
});
