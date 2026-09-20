import type { ParsedJiraCommand } from "./types.ts";

export const JIRA_HELP = [
	"Jira work items via the configured twg site:",
	"/jira PROJ-123                 View a work item",
	"/jira search <natural-language request>",
	"/jira create [PROJECT]",
	"/jira update [PROJ-123]",
	"/jira comment [PROJ-123]",
	"/jira assign [PROJ-123]",
].join("\n");

export function isIssueKey(value: string): boolean {
	return /^[A-Z][A-Z0-9]+-\d+$/iu.test(value);
}

function normalizedIssueKey(value: string): string | null {
	const normalized = value.toUpperCase();
	return isIssueKey(normalized) ? normalized : null;
}

export function parseJiraCommand(args: string): ParsedJiraCommand {
	const trimmed = args.trim();
	if (!trimmed || trimmed === "help") return { action: "help" };
	const shorthandKey = normalizedIssueKey(trimmed);
	if (shorthandKey) return { action: "view", key: shorthandKey };

	const [verb, ...rest] = trimmed.split(/\s+/u);
	const value = rest.join(" ").trim();
	switch (verb) {
		case "view": {
			const key = normalizedIssueKey(value);
			return key ? { action: "view", key } : { action: "help" };
		}
		case "search":
			return value ? { action: "search", text: value } : { action: "help" };
		case "create":
			return value && !/\s/u.test(value) ? { action: "create", project: value } : { action: "create" };
		case "update":
		case "comment":
		case "assign": {
			const key = normalizedIssueKey(value);
			return value && !key ? { action: "help" } : { action: verb, ...(key ? { key } : {}) };
		}
		default:
			return { action: "help" };
	}
}
