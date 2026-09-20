import test from "node:test";
import assert from "node:assert/strict";
import { JIRA_HELP, isIssueKey, parseJiraCommand } from "./parser.ts";

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
