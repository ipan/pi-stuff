/**
 * Zed Extension
 *
 * Registers a `/zed` command that opens the current session working directory
 * or one explicit directory in Zed.
 *
 * Usage:
 *
 *     /zed             Open the current session working directory
 *     /zed <directory> Open one directory
 *
 * Extra flags are forwarded to the `zed` binary, e.g. `--new` (-n),
 * `--add` (-a), `--existing` (-e), and `--wait` (-w). Without `--wait` the
 * editor is launched detached so the command returns immediately; with
 * `--wait` the command blocks until the editor closes.
 */

import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import * as path from "node:path";

type Level = "info" | "warning" | "error";

/** zed flags that make the binary block until its window closes. */
const WAIT_FLAGS = new Set(["--wait", "-w"]);

function notify(ctx: ExtensionCommandContext, message: string, level: Level = "info"): void {
	if (!ctx.hasUI) {
		return;
	}
	ctx.ui.notify(message, level);
}

/** Split a command string into tokens, honoring single and double quotes. */
function tokenize(input: string): string[] {
	const tokens: string[] = [];
	for (const match of input.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)) {
		const token = match[1] ?? match[2] ?? match[3];
		if (token !== undefined) {
			tokens.push(token);
		}
	}
	return tokens;
}

interface ParsedZedArgs {
	/** Positional directory arguments (empty means "use the cwd"). */
	paths: string[];
	/** Flags forwarded unchanged to the zed binary. */
	zedFlags: string[];
	/** Whether the caller asked zed to block until it closes. */
	wait: boolean;
}

function parseArgs(tokens: string[]): ParsedZedArgs {
	const paths: string[] = [];
	const zedFlags: string[] = [];
	let wait = false;

	for (const token of tokens) {
		if (token.startsWith("-")) {
			if (WAIT_FLAGS.has(token)) {
				wait = true;
			} else {
				zedFlags.push(token);
			}
			continue;
		}
		paths.push(token);
	}

	return { paths, zedFlags, wait };
}

export async function resolveZedDirectory(cwd: string, paths: string[]): Promise<string> {
	if (paths.length > 1) {
		throw new Error("/zed accepts at most one directory.");
	}

	const target = paths.length === 0 ? cwd : path.resolve(cwd, paths[0]);
	const info = await stat(target);
	if (!info.isDirectory()) {
		throw new Error(`Path is not a directory: ${target}`);
	}
	return target;
}

export function buildSpawnArgs(zedFlags: string[], targets: string[], wait: boolean): string[] {
	const args = [...zedFlags];
	if (wait && !args.includes("--wait") && !args.includes("-w")) {
		args.push("--wait");
	}
	return [...args, ...targets];
}

function labelFor(paths: string[]): string {
	return paths.length === 1
		? paths[0]
		: `${paths.length} paths: ${paths.join(", ")}`;
}

export default function (pi: ExtensionAPI): void {
	pi.registerCommand("zed", {
		description:
			"Open the current working directory or one directory in Zed. Usage: /zed [directory] [--new|-n|--add|-a|--existing|-e|--wait|-w]",
		handler: async (args, ctx) => {
			const { paths, zedFlags, wait } = parseArgs(tokenize(args.trim()));
			let target: string;
			try {
				target = await resolveZedDirectory(ctx.cwd, paths);
			} catch (error) {
				notify(ctx, error instanceof Error ? error.message : "Unable to resolve Zed directory.", "error");
				return;
			}
			const targets = [target];
			const spawnArgs = buildSpawnArgs(zedFlags, targets, wait);

			// Blocking mode: run zed in the foreground of this handler and wait
			// for its window to close before reporting back.
			if (wait) {
				notify(ctx, `Opening ${labelFor(targets)} in Zed (blocking)...`, "info");
				const outcome = await new Promise<Error | undefined>((resolve) => {
					const child = spawn("zed", spawnArgs, { cwd: ctx.cwd, stdio: "ignore" });
					let launchError: Error | undefined;
					let settled = false;
					const finish = (error?: Error): void => {
						if (settled) {
							return;
						}
						settled = true;
						resolve(launchError ?? error);
					};
					child.once("error", (error) => {
						launchError = error;
						finish(error);
					});
					child.once("exit", finish);
				});

				if (outcome) {
					notify(ctx, `Zed failed to launch (${outcome.message}). Is Zed installed?`, "error");
				} else {
					notify(ctx, `Zed closed for ${labelFor(targets)}.`, "info");
				}
				return;
			}

			// Default mode: launch detached so the editor opens and the agent
			// immediately regains control.
			const child = spawn("zed", spawnArgs, {
				cwd: ctx.cwd,
				detached: true,
				stdio: "ignore",
			});
			child.once("error", (error) => {
				notify(ctx, `Zed failed to launch (${error.message}). Is Zed installed?`, "error");
			});
			child.unref();

			notify(ctx, `Opened ${labelFor(targets)} in Zed.`, "info");
		},
	});
}
