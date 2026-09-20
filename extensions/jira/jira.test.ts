import test from "node:test";
import assert from "node:assert/strict";
import { JIRA_HELP, isIssueKey, parseJiraCommand } from "./parser.ts";
import { JiraOutputError, formatMutationResult, formatSearchResult, formatViewResult } from "./jira-output.ts";

test("routes an issue key shorthand and supported verbs", () => {
	assert.deepEqual(parseJiraCommand("PROJ-123"), { action: "view", key: "PROJ-123" });
	assert.deepEqual(parseJiraCommand("search open bugs"), { action: "search", text: "open bugs" });
	assert.deepEqual(parseJiraCommand("create ENG"), { action: "create", project: "ENG" });
	assert.deepEqual(parseJiraCommand("update PROJ-123"), { action: "update", key: "PROJ-123" });
	assert.deepEqual(parseJiraCommand("comment PROJ-123"), { action: "comment", key: "PROJ-123" });
	assert.deepEqual(parseJiraCommand("assign PROJ-123"), { action: "assign", key: "PROJ-123" });
});

test("empty, help, unsupported, and malformed shorthand route to help", () => {
	for (const args of ["", "help", "transition PROJ-123", "link PROJ-123", "PROJ-"]) {
		assert.deepEqual(parseJiraCommand(args), { action: "help" });
	}
	assert.equal(isIssueKey("PROJ-123"), true);
	assert.equal(isIssueKey("PROJ-"), false);
	assert.match(JIRA_HELP, /\/jira search <natural-language request>/);
});

const issue = {
	key: "PROJ-123", summary: "Ship Jira command", description: "A safe command.",
	priority: { name: "High" }, assignee: { displayName: "Ada" }, sprint: { name: "Sprint 42" },
	reporter: { displayName: "Lin" }, resolution: { name: "Done" }, labels: ["cli", "jira"],
	url: "https://example.atlassian.net/browse/PROJ-123",
};

test("renders selected compact view fields", () => {
	const text = formatViewResult({ data: { items: [issue] } });
	for (const expected of ["PROJ-123", "Ship Jira command", "Sprint 42", "Reporter: Lin", "Resolution: Done", "cli, jira"]) assert.match(text, new RegExp(expected));
});

test("renders compact search rows and rejects unknown envelopes", () => {
	assert.match(formatSearchResult({ data: { items: [{ ...issue, status: { name: "Open" }, updated: "2026-09-19" }] } }), /Open/);
	assert.throws(() => formatSearchResult({ data: {} }), JiraOutputError);
	assert.match(formatMutationResult("assign", { data: { item: issue } }), /Assigned.*PROJ-123/);
});
