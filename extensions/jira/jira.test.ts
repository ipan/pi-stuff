import test from "node:test";
import assert from "node:assert/strict";
import { JIRA_HELP, isIssueKey, parseJiraCommand } from "./parser.ts";
import { JiraOutputError, formatMutationResult, formatSearchResult, formatViewResult, parseViewResult } from "./jira-output.ts";
import { TwgError, buildAssignArgs, buildCreateArgs, buildSearchArgs, buildUpdateArgs, buildViewArgs, createTwgClient } from "./twg.ts";
import { ModelOutputError, convertNaturalLanguageToJql, draftComment, draftCreateFields, draftUpdateFields, inferCreateFields } from "./inference.ts";
import { collectCreateDraft, collectUpdateDraft } from "./prompts.ts";
import jiti from "/Users/ivan.pan/.asdf/installs/nodejs/26.8.2/lib/node_modules/@earendil-works/pi-coding-agent/node_modules/jiti/lib/jiti.mjs";

const piDirectory = "/Users/ivan.pan/.asdf/installs/nodejs/26.8.2/lib/node_modules/@earendil-works/pi-coding-agent";
const load = jiti(import.meta.url, { alias: { "@earendil-works/pi-coding-agent": `${piDirectory}/dist/index.js`, "@earendil-works/pi-tui": `${piDirectory}/node_modules/@earendil-works/pi-tui/dist/index.js` } });
const { createJiraCommandHandler } = await load("./index.ts");
const { JiraIssueOverlay } = await load("./jira-overlay.ts");
const { visibleWidth } = await load("@earendil-works/pi-tui");

test("routes an issue key shorthand and supported verbs", () => {
	assert.deepEqual(parseJiraCommand("PROJ-123"), { action: "view", key: "PROJ-123" });
	assert.deepEqual(parseJiraCommand("search open bugs"), { action: "search", text: "open bugs" });
	assert.deepEqual(parseJiraCommand("irs-66465"), { action: "view", key: "IRS-66465" });
	assert.deepEqual(parseJiraCommand("create ENG"), { action: "create", project: "ENG" });
	assert.deepEqual(parseJiraCommand("create PROJ based on the current design"), { action: "create", project: "PROJ", instruction: "based on the current design" });
	assert.deepEqual(parseJiraCommand("create based on the current design"), { action: "create", instruction: "based on the current design" });
	assert.deepEqual(parseJiraCommand("update PROJ-123"), { action: "update", key: "PROJ-123" });
	assert.deepEqual(parseJiraCommand("update PROJ-1234 update based on the latest change"), { action: "update", key: "PROJ-1234", instruction: "update based on the latest change" });
	assert.deepEqual(parseJiraCommand("comment PROJ-123"), { action: "comment", key: "PROJ-123" });
	assert.deepEqual(parseJiraCommand("comment PROJ-1234 summarize `PROJ-99`"), { action: "comment", key: "PROJ-1234", instruction: "summarize `PROJ-99`" });
});

test("empty, help, unsupported, and malformed shorthand route to help", () => {
	for (const args of ["", "help", "transition PROJ-123", "link PROJ-123", "PROJ-"]) {
		assert.deepEqual(parseJiraCommand(args), { action: "help" });
	}
	assert.equal(isIssueKey("PROJ-123"), true);
	assert.equal(isIssueKey("PROJ-"), false);
	assert.match(JIRA_HELP, /\/jira search <natural-language request>/);
	assert.match(JIRA_HELP, /\/jira create \[PROJECT\] <instruction>/);
	assert.match(JIRA_HELP, /\/jira update \[PROJ-123\] <instruction>/);
	assert.match(JIRA_HELP, /\/jira comment \[PROJ-123\] <instruction>/);
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

test("renders the live twg view envelope and ADF description", () => {
	const text = formatViewResult({ data: [{ key: "THB-8149", summary: "GenMax Sprint Build", description: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Generate the build." }] }] }, priority: { name: "Medium" }, assignee: { displayName: "Ivan Pan" }, reporter: { displayName: "Ada" }, resolution: { name: "Done" }, labels: [] }] });
	assert.match(text, /THB-8149: GenMax Sprint Build/);
	assert.match(text, /Generate the build\./);
});

test("parses structured Jira view data for the issue overlay", () => {
	const view = parseViewResult({ data: [{
		key: "IRS-66465", summary: "A very long summary",
		issuetype: { name: "Task" }, priority: { name: "High" },
		description: { type: "doc", content: [
			{ type: "heading", content: [{ type: "text", text: "Context" }] },
			{ type: "paragraph", content: [{ type: "text", text: "Details", marks: [{ type: "code" }] }] },
			{ type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "One" }] }] }] },
		] },
		assignee: { displayName: "Ada" }, sprint: { name: "Sprint 1" }, reporter: { displayName: "Lin" },
		resolution: { name: "Done" }, labels: ["one", "two"],
		url: "https://example.atlassian.net/browse/IRS-66465",
	}] });
	assert.deepEqual(view, {
		key: "IRS-66465", summary: "A very long summary", description: "# Context\n\n`Details`\n\n- One",
		issueType: "Task", priority: "High", url: "https://example.atlassian.net/browse/IRS-66465",
		additionalFields: [["Assignee", "Ada"], ["Sprint", "Sprint 1"], ["Reporter", "Lin"], ["Resolution", "Done"], ["Labels", "one, two"]],
	});
	assert.deepEqual(parseViewResult({ data: [{ key: "IRS-66465", summary: "Summary" }] }).additionalFields, [["Assignee", "—"], ["Sprint", "—"], ["Reporter", "—"], ["Resolution", "—"], ["Labels", "—"]]);
	assert.equal(parseViewResult({ data: [{ key: "IRS-66465", summary: "Summary" }] }).url, undefined);
	assert.throws(() => parseViewResult({ data: {} }), JiraOutputError);
});

test("renders and controls the Jira issue overlay", () => {
	const view = parseViewResult({ data: [{ key: "IRS-66465", summary: "A very long summary that should wrap across lines", issuetype: { name: "Task" }, priority: { name: "High" }, description: Array.from({ length: 12 }, (_, index) => `Description line ${index + 1}`).join("\n"), assignee: { displayName: "Ada" }, sprint: { name: "Sprint 1" }, reporter: { displayName: "Lin" }, resolution: { name: "Done" }, labels: ["one", "two"], url: "https://example.atlassian.net/browse/IRS-66465" }] });
	const tui = { requestRender: () => {}, terminal: { rows: 30 } } as any;
	const theme = { fg: (_name: string, text: string) => text, bold: (text: string) => text } as any;
	let closed = false;
	const overlay = new JiraIssueOverlay(view, theme, tui, () => { closed = true; });
	const initial = overlay.render(50);
	assert.match(initial.join("\n"), /A very long summary/);
	assert.match(initial.join("\n"), /Description line 1/);
	assert.match(initial.join("\n"), /Issue type: Task · Priority: High/);
	assert.match(initial.join("\n"), /https:\/\/example\.atlassian\.net\/browse\/IRS-66465/);
	assert.doesNotMatch(initial.join("\n"), /Assignee: Ada/);
	assert.ok(initial.every((line) => visibleWidth(line) <= 50));
	assert.equal(initial.length, 18);
	overlay.handleInput("\t");
	const expanded = overlay.render(50);
	assert.equal(expanded.length, 18);
	assert.match(expanded.join("\n"), /Assignee: Ada/);
	assert.match(overlay.render(50).join("\n"), /Labels: one, two/);
	const beforeScroll = overlay.render(50).join("\n");
	overlay.handleInput("\x1b[B");
	const afterScroll = overlay.render(50).join("\n");
	assert.notEqual(afterScroll, beforeScroll);
	assert.match(afterScroll, /A very long summary/);
	const beforeWheel = overlay.render(50).join("\n");
	overlay.handleMouse({ type: "wheel", button: "none", x: 0, y: 0, screenX: 0, screenY: 0, width: 50, height: 20, shift: false, alt: false, ctrl: false, wheelDelta: 1 });
	assert.notEqual(overlay.render(50).join("\n"), beforeWheel);
	assert.match(afterScroll, /Issue type: Task · Priority: High/);
	overlay.handleInput("\x1b");
	assert.equal(closed, true);
});

test("renders compact search rows and rejects unknown envelopes", () => {
	assert.match(formatSearchResult({ data: { items: [{ ...issue, status: { name: "Open" }, updated: "2026-09-19" }] } }), /Open/);
	assert.throws(() => formatSearchResult({ data: {} }), JiraOutputError);
	assert.match(formatMutationResult("assign", { data: { item: issue } }), /Assigned.*PROJ-123/);
	assert.match(formatMutationResult("update", issue), /Updated.*PROJ-123/);
});

test("builds fixed JSON commands with no site override", () => {
	assert.deepEqual(buildSearchArgs("assignee = currentUser()"), ["jira", "workitem", "query", "--jql", "assignee = currentUser()", "--limit", "20", "-o", "json", "--output-summary", "none"]);
	assert.deepEqual(buildAssignArgs("PROJ-123", "me"), ["jira", "workitem", "update", "--id", "PROJ-123", "--assignee", "me", "-o", "json", "--output-summary", "none"]);
	assert.deepEqual(buildViewArgs("THB-8149").slice(-4), ["-o", "json", "--output-summary", "none"]);
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

const modelJson = (value: unknown) => async () => JSON.stringify(value);
test("accepts a complete create proposal and puts the instruction in the prompt", async () => {
	let prompt = "";
	const proposal = await draftCreateFields({ instruction: "based on the current design", session: "user: Design accepted" }, async (input) => {
		prompt = input;
		return JSON.stringify({ project: "PROJ", type: "Task", summary: "Implement design", description: "Build the approved design.", rationale: "Matches the accepted design." });
	});
	assert.equal(proposal.summary, "Implement design");
	assert.match(prompt, /based on the current design/);
	assert.match(prompt, /user: Design accepted/);
});

test("rejects untrusted or incomplete update and comment proposals", async () => {
	await assert.rejects(() => draftUpdateFields({ instruction: "update it", session: "", issue: "PROJ-1" }, modelJson({ summary: "x", transition: "Done", rationale: "x" })), ModelOutputError);
	await assert.rejects(() => draftComment({ instruction: "comment", session: "", issue: "PROJ-1" }, modelJson({ body: "", rationale: "x" })), ModelOutputError);
	await assert.rejects(() => draftComment({ instruction: "comment", session: "", issue: "PROJ-1" }, async () => "Here is JSON: {}"), ModelOutputError);
});

const scriptedUi = (answers: Array<string | boolean | undefined>) => ({ input: async (_title: string, initial = "") => answers.shift() as string | undefined ?? initial, editor: async (_title: string, initial = "") => answers.shift() as string | undefined ?? initial, select: async () => answers.shift() as string | undefined, confirm: async () => answers.shift() as boolean | undefined, notify: () => {} });
test("reviews inferred create fields and stops on update cancellation", async () => {
	const draft = await collectCreateDraft(scriptedUi(["PAY", "Bug", "Fix cards", "Description", "Skip optional fields"]), { project: "PAY", type: "Bug", summary: "Fix cards" });
	assert.deepEqual(draft, { project: "PAY", type: "Bug", summary: "Fix cards", description: "Description" });
	assert.equal(await collectUpdateDraft(scriptedUi(["PROJ-123", undefined])), null);
	assert.deepEqual(await collectUpdateDraft(scriptedUi(["PROJ-123", "Summary", "New summary", "Priority", "High", "Done"])), { key: "PROJ-123", summary: "New summary", priority: "High" });
});

test("opens Jira views in TUI overlays and keeps notification fallback elsewhere", async () => {
	const payload = { data: [{ key: "IRS-66465", summary: "Build issue", issuetype: { name: "Task" }, priority: { name: "High" }, description: "Details", url: "https://example.atlassian.net/browse/IRS-66465" }] };
	let customOptions: any;
	let rendered = "";
	const handler = createJiraCommandHandler({ twg: { view: async () => payload } } as any);
	await handler("irs-66465", { hasUI: true, mode: "tui", ui: { custom: async (factory: any, options: any) => { customOptions = options; rendered = factory({ requestRender: () => {} }, { fg: (_name: string, text: string) => text }, {}, () => {}).render(50).join("\n"); } } } as any);
	assert.equal(customOptions.overlay, true);
	assert.equal(customOptions.overlayOptions.anchor, "center");
	assert.equal(customOptions.overlayOptions.minWidth, 60);
	assert.equal(customOptions.overlayOptions.maxHeight, "60%");
	assert.match(rendered, /IRS-66465|Build issue/);

	const notes: string[] = [];
	await handler("irs-66465", { hasUI: true, mode: "print", ui: { notify: (message: string) => notes.push(message) } } as any);
	assert.match(notes.join("\n"), /IRS-66465: Build issue/);
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
