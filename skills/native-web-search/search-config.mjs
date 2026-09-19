const PROVIDERS = new Set(["openai-codex", "anthropic"]);

function normalizeProvider(value) {
	if (!value) return undefined;
	const normalized = String(value).toLowerCase().trim();
	if (normalized.includes("anthropic") || normalized.includes("claude")) return "anthropic";
	if (normalized.includes("codex") || normalized === "openai" || normalized.startsWith("openai")) {
		return "openai-codex";
	}
	return undefined;
}

export function getSearchDefaults(settings = {}, env = process.env) {
	const provider =
		[
			env.NATIVE_WEB_SEARCH_PROVIDER,
			settings.nativeWebSearchProvider,
			settings.defaultProvider,
		]
			.map(normalizeProvider)
			.find((value) => PROVIDERS.has(value)) || "openai-codex";

	return {
		provider,
		model: env.NATIVE_WEB_SEARCH_MODEL || settings.nativeWebSearchModel || "gpt-5.6-luna",
	};
}
