export class JiraOutputError extends Error {
	constructor(message: string) { super(message); this.name = "JiraOutputError"; }
}

type Item = Record<string, unknown>;
export type JiraViewModel = {
	key: string;
	summary: string;
	description: string;
	issueType: string;
	priority: string;
	url?: string;
	additionalFields: Array<[label: string, value: string]>;
};
const record = (value: unknown): Item | null => value && typeof value === "object" && !Array.isArray(value) ? value as Item : null;
const field = (item: Item, key: string): string => {
	const value = item[key];
	if (typeof value === "string") return value;
	const nested = record(value);
	return typeof nested?.name === "string" ? nested.name : typeof nested?.displayName === "string" ? nested.displayName : "—";
};
function items(payload: unknown): Item[] {
	const root = record(payload); const rawData = root?.data; const data = record(rawData) ?? root;
	const value = Array.isArray(rawData) ? rawData : data?.items ?? data?.item ?? (typeof data?.key === "string" ? data : undefined);
	const list = Array.isArray(value) ? value : value ? [value] : null;
	if (!list) throw new JiraOutputError("Jira returned malformed JSON output.");
	return list.map(record).filter((x): x is Item => !!x);
}
function valid(item: Item): Item {
	if (!field(item, "key") || field(item, "key") === "—" || !field(item, "summary") || field(item, "summary") === "—") throw new JiraOutputError("Jira returned a work item without a key or summary.");
	return item;
}
function description(value: unknown): string {
	if (typeof value === "string") return value;
	const node = record(value);
	if (!node) return "";
	const text = typeof node.text === "string" ? node.text : "";
	const children = Array.isArray(node.content) ? node.content.map(description).filter(Boolean).join("\n") : "";
	return [text, children].filter(Boolean).join("\n");
}
export function parseViewResult(payload: unknown): JiraViewModel {
	const item = valid(items(payload)[0] ?? {});
	const labels = Array.isArray(item.labels) ? item.labels.filter((x): x is string => typeof x === "string").join(", ") : "";
	return {
		key: field(item, "key"), summary: field(item, "summary"), description: description(item.description) || "—",
		issueType: field(item, "issuetype"), priority: field(item, "priority"),
		url: typeof item.url === "string" ? item.url : undefined,
		additionalFields: [["Assignee", field(item, "assignee")], ["Sprint", field(item, "sprint")], ["Reporter", field(item, "reporter")], ["Resolution", field(item, "resolution")], ["Labels", labels || "—"]],
	};
}
export function formatViewResult(payload: unknown): string {
	const view = parseViewResult(payload);
	const [assignee, sprint, reporter, resolution, labels] = view.additionalFields.map(([, value]) => value);
	return [`${view.key}: ${view.summary}`, `Priority: ${view.priority} · Assignee: ${assignee} · Sprint: ${sprint}`, `Reporter: ${reporter} · Resolution: ${resolution}`, `Labels: ${labels}`, view.description === "—" ? "Description: —" : view.description, view.url ?? ""].filter(Boolean).join("\n");
}
export function formatSearchResult(payload: unknown): string {
	const results = items(payload); if (!results.length) return "No Jira work items found.";
	return results.map((raw) => { const item = valid(raw); return `${field(item, "key")}: ${field(item, "summary")} · ${field(item, "status")} · ${field(item, "assignee")} · ${field(item, "updated")}`; }).join("\n");
}
export function formatMutationResult(action: "create" | "update" | "comment" | "assign", payload: unknown): string {
	const item = items(payload)[0]; const key = item ? field(item, "key") : "work item";
	return `${({ create: "Created", update: "Updated", comment: "Commented on", assign: "Assigned" } as const)[action]} ${key}.`;
}
