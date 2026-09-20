import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { spawn } from "node:child_process";
import * as path from "node:path";
import type { TUI } from "@earendil-works/pi-tui";

type Level = "info" | "warning" | "error";

type ParsedEditArgs = {
	recent: boolean;
	paths: string[];
};

type EditorInvocation = {
	command: string;
	args: string[];
};

type EditorOutcome =
	| { kind: "closed"; code: number | null }
	| { kind: "error"; error: Error };

function notify(ctx: ExtensionCommandContext, message: string, level: Level = "info"): void {
	if (ctx.hasUI) ctx.ui.notify(message, level);
}

/** Split a command string into tokens, honoring single and double quotes. */
function tokenize(input: string): string[] {
	const tokens: string[] = [];
	for (const match of input.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)) {
		const token = match[1] ?? match[2] ?? match[3];
		if (token !== undefined) tokens.push(token);
	}
	return tokens;
}

export function parseEditArgs(tokens: string[]): ParsedEditArgs {
	return tokens.length === 1 && tokens[0] === "recent"
		? { recent: true, paths: [] }
		: { recent: false, paths: tokens };
}

export function resolveEditTargets(cwd: string, paths: string[]): string[] {
	return paths.map((candidate) => {
		if (!candidate.startsWith("@")) {
			throw new Error("/edit paths must begin with @.");
		}
		const target = candidate.slice(1);
		if (!target) throw new Error("/edit requires a path after @.");
		return path.resolve(cwd, target);
	});
}

export function buildEditorInvocation(editorCommand: string, targets: string[]): EditorInvocation {
	const [command, ...args] = tokenize(editorCommand.trim());
	if (!command) throw new Error("$EDITOR is empty.");
	return { command, args: [...args, ...targets] };
}

export function createRecentFiles(): string[] {
	return [];
}

export function getChangedFilePath(toolName: string, args: unknown, cwd: string): string | undefined {
	if (toolName !== "write" && toolName !== "edit") return undefined;
	const input = args as { path?: unknown } | undefined;
	return typeof input?.path === "string" ? path.resolve(cwd, input.path) : undefined;
}

export function recordChangedFile(recentFiles: string[], filePath: string): void {
	const normalized = filePath.trim();
	if (!normalized) return;

	const existingIndex = recentFiles.indexOf(normalized);
	if (existingIndex !== -1) recentFiles.splice(existingIndex, 1);
	recentFiles.unshift(normalized);
}

async function launchEditor(tui: TUI, invocation: EditorInvocation, cwd: string): Promise<EditorOutcome> {
	let stopped = false;
	try {
		tui.stop();
		stopped = true;
		const code = await new Promise<number | null>((resolve, reject) => {
			const child = spawn(invocation.command, invocation.args, {
				cwd,
				stdio: "inherit",
				shell: process.platform === "win32",
			});
			child.once("error", reject);
			child.once("close", resolve);
		});
		return { kind: "closed", code };
	} catch (error) {
		return { kind: "error", error: error instanceof Error ? error : new Error(String(error)) };
	} finally {
		if (stopped) {
			tui.start();
			tui.requestRender(true);
		}
	}
}

export default function (pi: ExtensionAPI): void {
	const recentFiles = createRecentFiles();
	const pendingChangedFiles = new Map<string, string>();

	pi.on("tool_execution_start", (event, ctx) => {
		const filePath = getChangedFilePath(event.toolName, event.args, ctx.cwd);
		if (filePath) pendingChangedFiles.set(event.toolCallId, filePath);
	});

	pi.on("tool_execution_end", (event) => {
		const filePath = pendingChangedFiles.get(event.toolCallId);
		pendingChangedFiles.delete(event.toolCallId);
		if (!event.isError && filePath) recordChangedFile(recentFiles, filePath);
	});

	pi.registerCommand("edit", {
		description: "Open recent changed files or @paths with $EDITOR. Usage: /edit recent | /edit @path...",
		handler: async (args, ctx) => {
			if (ctx.mode !== "tui") {
				notify(ctx, "/edit is available only in interactive TUI mode.", "warning");
				return;
			}

			const { recent, paths } = parseEditArgs(tokenize(args.trim()));
			if (!recent && paths.length === 0) {
				notify(ctx, "Usage: /edit recent | /edit @path...", "warning");
				return;
			}
			if (recent && recentFiles.length === 0) {
				notify(ctx, "No files have been changed by the agent in this session.", "info");
				return;
			}

			const editorCommand = process.env.EDITOR;
			if (!editorCommand) {
				notify(ctx, "No editor configured. Set $EDITOR.", "warning");
				return;
			}

			let invocation: EditorInvocation;
			try {
				const targets = recent ? recentFiles : resolveEditTargets(ctx.cwd, paths);
				invocation = buildEditorInvocation(editorCommand, targets);
			} catch (error) {
				notify(ctx, error instanceof Error ? error.message : "Unable to open editor.", "error");
				return;
			}

			const outcome = await ctx.ui.custom<EditorOutcome>((tui, theme, _keybindings, done) => {
				queueMicrotask(() => {
					void launchEditor(tui, invocation, ctx.cwd).then(done);
				});
				return {
					render: () => [theme.fg("dim", `Opening ${editorCommand}…`)],
					invalidate: () => {},
				};
			});

			if (outcome?.kind === "error") {
				notify(ctx, `$EDITOR failed to launch (${outcome.error.message}).`, "error");
			} else if (outcome?.kind === "closed" && outcome.code !== 0) {
				notify(ctx, `$EDITOR exited with status ${outcome.code ?? "unknown"}.`, "warning");
			}
		},
	});
}
