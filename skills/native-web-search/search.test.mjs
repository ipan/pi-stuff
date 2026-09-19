import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { getSearchDefaults } from "./search-config.mjs";
import { buildUserPrompt } from "./search.mjs";

test("defaults to OpenAI Codex with gpt-5.6-luna", () => {
	assert.deepEqual(getSearchDefaults({}, {}), {
		provider: "openai-codex",
		model: "gpt-5.6-luna",
	});
});

test("prefers explicit native search environment defaults over Pi settings", () => {
	const defaults = getSearchDefaults(
		{
			defaultProvider: "anthropic",
			nativeWebSearchModel: "settings-model",
		},
		{
			NATIVE_WEB_SEARCH_PROVIDER: "openai-codex",
			NATIVE_WEB_SEARCH_MODEL: "env-model",
		},
	);

	assert.deepEqual(defaults, {
		provider: "openai-codex",
		model: "env-model",
	});
});

test("OpenAI fallback models prefer terra then sol", () => {
	const script = readFileSync(new URL("./search.mjs", import.meta.url), "utf8");

	assert.match(script, /\["gpt-5\.6-terra", "gpt-5\.6-sol"\]/);
});

test("research prompt requests current, authoritative evidence", () => {
	const prompt = buildUserPrompt("Node.js release", "update a dependency");

	assert.match(prompt, /official or primary sources/i);
	assert.match(prompt, /publication or update date/i);
	assert.match(prompt, /version numbers/i);
	assert.match(prompt, /uncertainty/i);
});
