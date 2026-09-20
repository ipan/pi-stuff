import test from "node:test";
import assert from "node:assert/strict";
import { JIRA_HELP, isIssueKey, parseJiraCommand } from "./parser.ts";
import { JiraOutputError, formatMutationResult, formatSearchResult, formatViewResult } from "./jira-output.ts";
import { TwgError, buildAssignArgs, buildCreateArgs, buildSearchArgs, buildUpdateArgs, createTwgClient } from "./twg.ts";
import { ModelOutputError, convertNaturalLanguageToJql, inferCreateFields } from "./inference.ts";
import { collectCreateDraft, collectUpdateDraft } from "./prompts.ts";
import jiti from "/Users/ivan.pan/.asdf/installs/nodejs/26.8.2/lib/node_modules/@earendil-works/pi-coding-agent/node_modules/jiti/lib/jiti.mjs";

const piDirectory = "/Users/ivan.pan/.asdf/installs/nodejs/26.8.2/lib/node_modules/@earendil-works/pi-coding-agent";
const load = jiti(import.meta.url, { alias: { "@earendil-works/pi-coding-agent": `${piDirectory}/dist/index.js` } });
const { createJiraCommandHandler } = await load("./index.ts");

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
	assert.match(formatMutationResult("update", issue), /Updated.*PROJ-123/);
});

test("builds fixed JSON commands with no site override", () => {
	assert.deepEqual(buildSearchArgs("assignee = currentUser()"), ["jira", "workitem", "query", "--jql", "assignee = currentUser()", "--limit", "20", "-o", "json"]);
	assert.deepEqual(buildAssignArgs("PROJ-123", "me"), ["jira", "workitem", "update", "--id", "PROJ-123", "--assignee", "me", "-o", "json"]);
	assert.equal(buildCreateArgs({ project: "PROJ", type: "Task", summary: "S", description: "D" }).includes("--site"), false);
});

test("normalizes nonzero failures and redacts credentials", async () => {
	const client = createTwgClient(async () => ({ stdout: "", stderr: "Bearer secret-token", exitCode: 1 }), 1000);
	await assert.rejects(() => client.view("PROJ-123"), (error: unknown) => error instanceof TwgError && !error.message.includes("secret-token"));
});

test("returns only high-confidence create inference fields", async () => {
	const result = await inferCreateFields("context", async () => JSON.stringify({ project: { value: "PAY", confidence: 0.95 }, type: { value: "Bug", confidence: 0.9 }, summary: { value: "Fix cards", confidence: 0.9 }, description: { value: "Maybe", confidence: 0.4 } }));
	assert.deepEqual(result, { project: "PAY", type: "Bug", summary: "Fix cards" });
});

test("requires exact JSON JQL output", async () => {
	await assert.rejects(() => convertNaturalLanguageToJql("my bugs", async () => "```json\n{}\n```"), ModelOutputError);
	await assert.rejects(() => convertNaturalLanguageToJql("my bugs", async () => "{\"jql\":\"\"}"), ModelOutputError);
});

const scriptedUi = (answers: Array<string | boolean | undefined>) => ({ input: async (_title: string, initial = "") => answers.shift() as string | undefined ?? initial, editor: async (_title: string, initial = "") => answers.shift() as string | undefined ?? initial, select: async () => answers.shift() as string | undefined, confirm: async () => answers.shift() as boolean | undefined, notify: () => {} });
test("reviews inferred create fields and stops on update cancellation", async () => {
	const draft = await collectCreateDraft(scriptedUi(["PAY", "Bug", "Fix cards", "Description", "Skip optional fields"]), { project: "PAY", type: "Bug", summary: "Fix cards" });
	assert.deepEqual(draft, { project: "PAY", type: "Bug", summary: "Fix cards", description: "Description" });
	assert.equal(await collectUpdateDraft(scriptedUi(["PROJ-123", undefined])), null);
	assert.deepEqual(await collectUpdateDraft(scriptedUi(["PROJ-123", "Summary", "New summary", "Priority", "High", "Done"])), { key: "PROJ-123", summary: "New summary", priority: "High" });
});

test("shows JQL and does not query when search confirmation is declined", async () => {
	let queried = false; const notes: string[] = [];
	const handler = createJiraCommandHandler({ convertJql: async () => ({ jql: "status = Open", interpretation: "Open issues" }), twg: { search: async () => { queried = true; return {}; } } } as any);
	await handler("search open issues", { hasUI: true, ui: { ...scriptedUi([false]), notify: (message: string) => notes.push(message) } } as any);
	assert.equal(queried, false); assert.match(notes.join("\n"), /status = Open/);
});

test("rejects updates without fields and malformed twg JSON", async () => {
	assert.throws(() => buildUpdateArgs({ key: "PROJ-123" }), TwgError);
	const client = createTwgClient(async () => ({ stdout: "not-json", stderr: "", exitCode: 0 }));
	await assert.rejects(() => client.view("PROJ-123"), /malformed JSON/);
});

test("cancelled create does not invoke twg", async () => {
	let created = false;
	const handler = createJiraCommandHandler({ twg: { create: async () => { created = true; return {}; } } } as any);
	await handler("create PROJ", { hasUI: true, ui: scriptedUi([undefined]) } as any);
	assert.equal(created, false);
});

test("opens inferred required create values in editable editors", async () => {
	const editorInitials: string[] = [];
	const ui = { input: async () => "", editor: async (_title: string, initial: string) => { editorInitials.push(initial); return initial || "Description"; }, select: async () => "Skip optional fields", confirm: async () => true, notify: () => {} };
	await collectCreateDraft(ui, { project: "PAY", type: "Bug", summary: "Fix cards", description: "Investigate" });
	assert.deepEqual(editorInitials.slice(0, 4), ["PAY", "Bug", "Fix cards", "Investigate"]);
});
