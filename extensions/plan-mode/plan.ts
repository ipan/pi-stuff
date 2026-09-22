import { existsSync, realpathSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

export type PlanExportInput = {
	cwd: string;
	pathArgument: string;
	content: string;
	now: Date;
};

function utcDate(now: Date): string {
	return [now.getUTCFullYear(), String(now.getUTCMonth() + 1).padStart(2, "0"), String(now.getUTCDate()).padStart(2, "0")].join("-");
}

export function defaultPlanPath(now: Date): string {
	return `docs/plans/${utcDate(now)}-plan.md`;
}

function isInsideWorkspace(workspace: string, candidate: string): boolean {
	const fromWorkspace = relative(workspace, candidate);
	return Boolean(fromWorkspace) && fromWorkspace !== ".." && !fromWorkspace.startsWith(`..${sep}`) && !isAbsolute(fromWorkspace);
}

export function resolvePlanPath(cwd: string, pathArgument: string, now: Date): string {
	const requested = pathArgument.trim() || defaultPlanPath(now);
	if (isAbsolute(requested)) throw new Error("Plan path must stay inside the workspace.");
	const target = resolve(cwd, requested);
	if (!isInsideWorkspace(cwd, target)) throw new Error("Plan path must stay inside the workspace.");

	let existingAncestor = target;
	while (!existsSync(existingAncestor)) {
		const parent = dirname(existingAncestor);
		if (parent === existingAncestor) throw new Error("Plan path must stay inside the workspace.");
		existingAncestor = parent;
	}
	const canonicalWorkspace = realpathSync(cwd);
	const canonicalAncestor = realpathSync(existingAncestor);
	if (canonicalAncestor !== canonicalWorkspace && !isInsideWorkspace(canonicalWorkspace, canonicalAncestor)) {
		throw new Error("Plan path must stay inside the workspace.");
	}
	return target;
}

export function renderPlanMarkdown(content: string, now: Date): string {
	const proposal = content.trim();
	if (!proposal) throw new Error("Plan content is empty.");
	return `# Plan\n\n> Saved from Pi plan mode on ${now.toISOString()}\n\n${proposal}\n`;
}

export function latestAssistantText(entries: readonly unknown[]): string | undefined {
	for (let index = entries.length - 1; index >= 0; index -= 1) {
		const entry = entries[index] as { type?: unknown; message?: { role?: unknown; content?: unknown } } | undefined;
		if (entry?.type !== "message" || entry.message?.role !== "assistant" || !Array.isArray(entry.message.content)) continue;
		const text = entry.message.content
			.filter((block): block is { type: "text"; text: string } => typeof block === "object" && block !== null && (block as { type?: unknown }).type === "text" && typeof (block as { text?: unknown }).text === "string")
			.map((block) => block.text)
			.join("\n")
			.trim();
		if (text) return text;
	}
	return undefined;
}

export async function writePlanFile(absolutePath: string, content: string): Promise<"created"> {
	try {
		await mkdir(dirname(absolutePath), { recursive: true });
		await writeFile(absolutePath, content, { encoding: "utf8", flag: "wx" });
		return "created";
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new Error("Plan file already exists.");
		throw error;
	}
}
