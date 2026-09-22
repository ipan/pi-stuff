import type { ParsedJiraCommand } from "./types.ts";

export const JIRA_HELP = [
	"Jira work items via the configured twg site:",
	"/jira PROJ-123                 View a work item",
	"/jira search <natural-language request>",
	"/jira create [PROJECT] <instruction>",
	"/jira update [PROJ-123] <instruction>",
	"/jira comment [PROJ-123] <instruction>",
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

	const match = /^(\S+)(?:\s+([\s\S]*))?$/u.exec(trimmed);
	if (!match) return { action: "help" };
	const [, verb, remainder = ""] = match;
	const value = remainder.trim();
	switch (verb) {
		case "view": {
			const key = normalizedIssueKey(value);
			return key ? { action: "view", key } : { action: "help" };
		}
		case "search":
			return value ? { action: "search", text: value } : { action: "help" };
		case "create": {
			if (!value) return { action: "create" };
			const [first, ...rest] = value.split(/\s+/u);
			const instruction = rest.join(" ").trim();
			if (/^[A-Z][A-Z0-9]+$/u.test(first)) return { action: "create", project: first, ...(instruction ? { instruction } : {}) };
			return { action: "create", instruction: value };
		}
		case "update":
		case "comment": {
			if (!value) return { action: verb };
			const [first, ...rest] = value.split(/\s+/u);
			const key = normalizedIssueKey(first);
			if (!key) return { action: "help" };
			const instruction = rest.join(" ").trim();
			return { action: verb, key, ...(instruction ? { instruction } : {}) };
		}
		default:
			return { action: "help" };
	}
}
