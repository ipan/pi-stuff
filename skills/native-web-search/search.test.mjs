import test from "node:test";
import assert from "node:assert/strict";
import { getSearchDefaults } from "./search-config.mjs";
import { buildUserPrompt } from "./search.mjs";

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

test("research prompt requests current, authoritative evidence", () => {
	const prompt = buildUserPrompt("Node.js release", "update a dependency");

	assert.match(prompt, /official or primary sources/i);
	assert.match(prompt, /publication or update date/i);
	assert.match(prompt, /version numbers/i);
	assert.match(prompt, /uncertainty/i);
});
