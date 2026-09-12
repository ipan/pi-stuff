/**
 * Zed Extension
 *
 * Registers a `/zed` command that opens the current working directory (or a
 * chosen set of paths) in the Zed editor.
 *
 * Usage:
 *
 *     /zed                 Open the current working directory
 *     /zed <path>...       Open one or more files or directories
 *     /zed <path>:line:col Open a file at a given line/column
 *
 * Extra flags are forwarded to the `zed` binary, e.g. `--new` (-n),
 * `--add` (-a), `--existing` (-e), and `--wait` (-w). Without `--wait` the
 * editor is launched detached so the command returns immediately; with
 * `--wait` the command blocks until the editor closes.
 */

import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { spawn } from "node:child_process";
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
	/** Positional path arguments (empty means "use the cwd"). */
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

/** Fall back to the cwd when no path was given; otherwise resolve relative paths. */
function resolveTargets(cwd: string, paths: string[]): string[] {
	if (paths.length === 0) {
		return [cwd];
	}
	return paths.map((candidate) =>
		path.isAbsolute(candidate) ? candidate : path.resolve(cwd, candidate),
	);
}

function labelFor(paths: string[]): string {
	return paths.length === 1
		? paths[0]
		: `${paths.length} paths: ${paths.join(", ")}`;
}

export default function (pi: ExtensionAPI): void {
	pi.registerCommand("zed", {
		description:
			"Open the current working directory (or given paths) in Zed. Usage: /zed [paths] [--new|-n|--add|-a|--existing|-e|--wait|-w]",
		handler: async (args, ctx) => {
			const { paths, zedFlags, wait } = parseArgs(tokenize(args.trim()));
			const targets = resolveTargets(ctx.cwd, paths);
			const spawnArgs = [...zedFlags, ...targets];
			if (wait && !spawnArgs.includes("--wait") && !spawnArgs.includes("-w")) {
				spawnArgs.push("--wait");
			}

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
