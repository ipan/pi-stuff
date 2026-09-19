import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const script = readFileSync(new URL("./to-markdown.mjs", import.meta.url), "utf8");

test("summaries use OpenAI Codex gpt-5.6-luna", () => {
	assert.match(script, /'--provider', 'openai-codex'/);
	assert.match(script, /'--model', 'gpt-5\.6-luna'/);
	assert.doesNotMatch(script, /'--provider', 'anthropic'/);
	assert.doesNotMatch(script, /'--model', 'claude-haiku-4-5'/);
});
