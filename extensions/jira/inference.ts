import type { CommentDraftProposal, CreateDraftProposal, JiraDraftContext, ModelJson, UpdateDraftProposal } from "./types.ts";

export class ModelOutputError extends Error { constructor(message: string) { super(message); this.name = "ModelOutputError"; } }
const parse = (text: string, label: string): Record<string, unknown> => { try { const value = JSON.parse(text.trim()); if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(); return value as Record<string, unknown>; } catch { throw new ModelOutputError(`${label} returned invalid JSON.`); } };
const string = (value: unknown, label: string) => { if (typeof value !== "string" || !value.trim()) throw new ModelOutputError(`${label} returned invalid fields.`); return value.trim(); };
const allowOnly = (value: Record<string, unknown>, keys: readonly string[], label: string) => { if (Object.keys(value).some((key) => !keys.includes(key))) throw new ModelOutputError(`${label} returned unsupported fields.`); };
const references = (context: JiraDraftContext) => [
	`Instruction (reference data):\n${context.instruction}`,
	`Session context (reference data):\n${context.session || "Unavailable"}`,
	...(context.issue === undefined ? [] : [`Current Jira issue (reference data):\n${context.issue}`]),
].join("\n\n");
const request = (action: string, fields: string, context: JiraDraftContext) => `Return JSON only. Draft a Jira ${action} using only the delimited reference data below. Do not invent facts or return unsupported fields. ${fields}\n\n${references(context)}`;

export async function inferCreateFields(context: string, model: ModelJson): Promise<Partial<Record<"project" | "type" | "summary" | "description", string>>> { const value = parse(await model(`Return JSON only. Infer project shortname, Jira issue type, summary, and description from this session context. Do not invent facts. Each field is {value, confidence}:\n${context}`), "Create inference"); const result: Partial<Record<"project" | "type" | "summary" | "description", string>> = {}; for (const key of ["project", "type", "summary", "description"] as const) { const entry = value[key]; if (entry && typeof entry === "object" && typeof (entry as any).value === "string" && (entry as any).value.trim() && typeof (entry as any).confidence === "number" && Number.isFinite((entry as any).confidence) && (entry as any).confidence >= 0.8) result[key] = (entry as any).value.trim(); } return result; }
export async function convertNaturalLanguageToJql(requestText: string, model: ModelJson): Promise<{ jql: string; interpretation: string }> { const value = parse(await model(`Return JSON only with jql and interpretation. Convert this natural-language Jira Cloud search to valid JQL; do not use markdown:\n${requestText}`), "JQL conversion"); const jql = value.jql; const interpretation = value.interpretation; if (typeof jql !== "string" || !jql.trim() || /[\r\n]/u.test(jql) || jql.trimStart().startsWith("--") || typeof interpretation !== "string" || !interpretation.trim()) throw new ModelOutputError("JQL conversion returned invalid fields."); return { jql: jql.trim(), interpretation: interpretation.trim() }; }

export async function draftCreateFields(context: JiraDraftContext, model: ModelJson): Promise<CreateDraftProposal> {
	const value = parse(await model(request("create", "Return project, type, summary, description, optional assignee/priority/labels/parent, and rationale.", context)), "Create draft");
	allowOnly(value, ["project", "type", "summary", "description", "assignee", "priority", "labels", "parent", "rationale"], "Create draft");
	const draft: CreateDraftProposal = { project: string(value.project, "Create draft"), type: string(value.type, "Create draft"), summary: string(value.summary, "Create draft"), description: string(value.description, "Create draft"), rationale: string(value.rationale, "Create draft") };
	for (const key of ["assignee", "priority", "labels", "parent"] as const) if (value[key] !== undefined) draft[key] = string(value[key], "Create draft");
	return draft;
}
export async function draftUpdateFields(context: JiraDraftContext, model: ModelJson): Promise<UpdateDraftProposal> {
	const value = parse(await model(request("update", "Return one or more of summary, description, priority, assignee, sprint, and rationale.", context)), "Update draft");
	allowOnly(value, ["summary", "description", "priority", "assignee", "sprint", "rationale"], "Update draft");
	const draft: UpdateDraftProposal = { rationale: string(value.rationale, "Update draft") };
	for (const key of ["summary", "description", "priority", "assignee", "sprint"] as const) if (value[key] !== undefined) draft[key] = string(value[key], "Update draft");
	if (Object.keys(draft).length === 1) throw new ModelOutputError("Update draft returned invalid fields.");
	return draft;
}
export async function draftComment(context: JiraDraftContext, model: ModelJson): Promise<CommentDraftProposal> {
	const value = parse(await model(request("comment", "Return body and rationale.", context)), "Comment draft");
	allowOnly(value, ["body", "rationale"], "Comment draft");
	return { body: string(value.body, "Comment draft"), rationale: string(value.rationale, "Comment draft") };
}
