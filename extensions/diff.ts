import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { spawn } from "node:child_process";
import * as path from "node:path";
import { Key, matchesKey, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { TUI, TuiMouseEvent, TuiMouseEventResult } from "@earendil-works/pi-tui";
import { parseUnifiedDiff } from "./diff-tools.mjs";

type DiffRow = ReturnType<typeof parseUnifiedDiff>[number];
type Theme = ExtensionCommandContext["ui"]["theme"];
type FileSection = { name: string; rowIndex: number; untracked: boolean };

function notify(ctx: ExtensionCommandContext, message: string, level: "info" | "warning" | "error"): void {
	if (ctx.hasUI) ctx.ui.notify(message, level);
}

function getWheelScroll(event: TuiMouseEvent): number {
	return event.type === "wheel" ? event.wheelDelta ?? 0 : 0;
}

function isGitWorkTree(result: { code: number; stdout: string }): boolean {
	return result.code === 0 && result.stdout.trim() === "true";
}

function tokenize(input: string): string[] {
	const tokens: string[] = [];
	for (const match of input.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)) {
		const token = match[1] ?? match[2] ?? match[3];
		if (token !== undefined) tokens.push(token);
	}
	return tokens;
}

async function openFileInEditor(tui: TUI, ctx: ExtensionCommandContext, file: FileSection): Promise<void> {
	const editorCommand = process.env.EDITOR;
	if (!editorCommand) {
		notify(ctx, "No editor configured. Set $EDITOR.", "warning");
		return;
	}

	const [editor, ...editorArgs] = tokenize(editorCommand);
	if (!editor) {
		notify(ctx, "$EDITOR is empty.", "warning");
		return;
	}

	let stopped = false;
	let failure: string | undefined;
	try {
		tui.stop();
		stopped = true;
		const code = await new Promise<number | null>((resolve, reject) => {
			const child = spawn(editor, [...editorArgs, path.resolve(ctx.cwd, file.name)], {
				cwd: ctx.cwd,
				stdio: "inherit",
				shell: process.platform === "win32",
			});
			child.once("error", reject);
			child.once("close", resolve);
		});
		if (code !== 0) failure = `$EDITOR exited with status ${code ?? "unknown"}.`;
	} catch (error) {
		failure = `$EDITOR failed to launch (${error instanceof Error ? error.message : String(error)}).`;
	} finally {
		if (stopped) {
			tui.start();
			tui.requestRender(true);
		}
	}
	if (failure) notify(ctx, failure, "warning");
}

function padToWidth(value: string, width: number): string {
	const clipped = truncateToWidth(value, width, "");
	return clipped + " ".repeat(Math.max(0, width - visibleWidth(clipped)));
}

function getFileSections(rows: DiffRow[], untracked: Set<string>): FileSection[] {
	return rows.flatMap((row, rowIndex) =>
		row.kind === "file" ? [{ name: row.text, rowIndex, untracked: untracked.has(row.text) }] : [],
	);
}

export class DiffViewer {
	private offset = 0;
	private pageSize = 1;
	private selectedFile = 0;
	private panelFocused = true;
	private panelVisible = false;
	private readonly files: FileSection[];

	constructor(
		private readonly rows: DiffRow[],
		private readonly theme: Theme,
		private readonly requestRender: () => void,
		private readonly close: () => void,
		untracked: Set<string>,
		private readonly onEdit: (file: FileSection) => void,
	) {
		this.files = getFileSections(rows, untracked);
	}

	private jumpToFile(index: number): void {
		this.selectedFile = Math.max(0, Math.min(this.files.length - 1, index));
		const target = this.files[this.selectedFile];
		if (target) this.offset = target.rowIndex;
	}

	handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
		const delta = getWheelScroll(event);
		if (delta === 0) return undefined;

		const panelWidth = this.panelVisible ? Math.min(32, Math.max(22, Math.floor(event.width * 0.28))) : 0;
		if (this.panelVisible && event.x < panelWidth) {
			this.panelFocused = true;
			this.jumpToFile(this.selectedFile + delta);
		} else {
			this.panelFocused = false;
			const maxOffset = Math.max(0, this.rows.length - this.pageSize);
			this.offset = Math.max(0, Math.min(maxOffset, this.offset + delta));
		}
		this.requestRender();
		return { handled: true, focus: true };
	}

	handleInput(data: string): void {
		if (data === "q" || matchesKey(data, Key.escape)) {
			this.close();
			return;
		}
		if (matchesKey(data, Key.tab) && this.panelVisible) {
			this.panelFocused = !this.panelFocused;
			this.requestRender();
			return;
		}

		if (this.panelFocused && this.panelVisible) {
			if (matchesKey(data, Key.up)) this.jumpToFile(this.selectedFile - 1);
			else if (matchesKey(data, Key.down)) this.jumpToFile(this.selectedFile + 1);
			else if (matchesKey(data, Key.enter)) this.panelFocused = false;
			else if (data === "e") {
				const file = this.files[this.selectedFile];
				if (file) queueMicrotask(() => this.onEdit(file));
			} else return;
			this.requestRender();
			return;
		}

		const maxOffset = Math.max(0, this.rows.length - this.pageSize);
		if (matchesKey(data, Key.up)) this.offset--;
		else if (matchesKey(data, Key.down)) this.offset++;
		else if (matchesKey(data, Key.pageUp)) this.offset -= this.pageSize;
		else if (matchesKey(data, Key.pageDown)) this.offset += this.pageSize;
		else if (matchesKey(data, Key.home)) this.offset = 0;
		else if (matchesKey(data, Key.end)) this.offset = maxOffset;
		else if (data === "[") this.jumpToFile(this.selectedFile - 1);
		else if (data === "]") this.jumpToFile(this.selectedFile + 1);
		else return;

		this.offset = Math.max(0, Math.min(maxOffset, this.offset));
		this.requestRender();
	}

	private renderRow(row: DiffRow, width: number): string {
		if (row.kind === "file") return this.theme.bg("toolPendingBg", padToWidth(`  ${this.theme.fg("accent", this.theme.bold(row.text))}`, width));
		if (row.kind === "hunk") return truncateToWidth(this.theme.fg("accent", row.text), width, "");
		if (row.kind === "meta") return truncateToWidth(this.theme.fg("muted", `    ${row.text}`), width, "");

		const oldNumber = row.oldLine === null ? "" : String(row.oldLine);
		const newNumber = row.newLine === null ? "" : String(row.newLine);
		const gutter = this.theme.fg("dim", `${oldNumber.padStart(5)} ${newNumber.padStart(5)} │ `);
		const color = row.kind === "add" ? "toolDiffAdded" : row.kind === "remove" ? "toolDiffRemoved" : "toolDiffContext";
		return truncateToWidth(gutter + this.theme.fg(color, row.text), width, "");
	}

	private renderPanel(width: number, height: number): string[] {
		const entries = this.files.flatMap((file, index) => {
			const previous = this.files[index - 1];
			const separator = file.untracked && !previous?.untracked ? [{ kind: "section" as const, text: " Untracked " }] : [];
			return [...separator, { kind: "file" as const, file, index }];
		});
		const selectedEntry = entries.findIndex((entry) => entry.kind === "file" && entry.index === this.selectedFile);
		const visibleCount = height - 1;
		const start = Math.max(0, Math.min(Math.max(0, entries.length - visibleCount), selectedEntry - Math.floor(visibleCount / 2)));
		const panel = [padToWidth(this.theme.fg("accent", this.theme.bold(" Files ")), width)];
		for (const entry of entries.slice(start, start + visibleCount)) {
			if (entry.kind === "section") panel.push(this.theme.fg("dim", padToWidth(entry.text, width)));
			else {
				const label = `${entry.index === this.selectedFile ? "›" : " "} ${entry.file.name}`;
				panel.push(entry.index === this.selectedFile
					? this.theme.bg(this.panelFocused ? "selectedBg" : "toolPendingBg", this.theme.fg("accent", padToWidth(label, width)))
					: this.theme.fg(entry.file.untracked ? "success" : "muted", padToWidth(label, width)));
			}
		}
		while (panel.length < height) panel.push(" ".repeat(width));
		return panel;
	}

	render(width: number): string[] {
		const height = Math.max(8, (process.stdout.rows ?? 30) - 3);
		this.pageSize = Math.max(1, height - 3);
		this.panelVisible = width >= 88 && this.files.length > 1;
		if (!this.panelVisible) this.panelFocused = false;
		const maxOffset = Math.max(0, this.rows.length - this.pageSize);
		this.offset = Math.min(this.offset, maxOffset);
		const panelWidth = this.panelVisible ? Math.min(32, Math.max(22, Math.floor(width * 0.28))) : 0;
		const diffWidth = width - panelWidth - (this.panelVisible ? 1 : 0);
		const visibleRows = this.rows.slice(this.offset, this.offset + this.pageSize);
		const body = visibleRows.map((row) => this.renderRow(row, diffWidth));
		while (body.length < this.pageSize) body.push("");

		const first = this.rows.length === 0 ? 0 : this.offset + 1;
		const last = Math.min(this.rows.length, this.offset + this.pageSize);
		const filePanelControls = this.panelVisible ? " · Tab files · e edit selected" : "";
		const footer = this.theme.fg("dim", ` ${first}-${last} of ${this.rows.length}${filePanelControls} · q/Esc close`);
		const diffLines = [
			truncateToWidth(this.theme.fg("accent", this.theme.bold(" Local changes ")), diffWidth, ""),
			this.theme.fg("borderMuted", "─".repeat(Math.max(1, diffWidth))),
			...body,
			truncateToWidth(footer, diffWidth, ""),
		];
		if (!this.panelVisible) return diffLines;
		const panel = this.renderPanel(panelWidth, diffLines.length);
		const divider = this.theme.fg("borderMuted", "│");
		return diffLines.map((line, index) => `${padToWidth(panel[index] ?? "", panelWidth)}${divider}${line}`);
	}

	invalidate(): void {}
}

export default function (pi: ExtensionAPI): void {
	pi.registerCommand("diff", {
		description: "View staged, unstaged, and untracked changes in a GitHub-style diff viewer",
		handler: async (_args, ctx) => {
			const repository = await pi.exec("git", ["rev-parse", "--is-inside-work-tree"], { cwd: ctx.cwd, timeout: 10_000 });
			if (!isGitWorkTree(repository)) return notify(ctx, "/diff is only available inside a Git working tree.", "warning");

			const tracked = await pi.exec("git", ["diff", "HEAD", "--no-ext-diff", "--no-color"], { cwd: ctx.cwd, timeout: 10_000 });
			if (tracked.code !== 0) return notify(ctx, tracked.stderr.trim() || "Unable to read the Git diff.", "error");
			const untrackedResult = await pi.exec("git", ["ls-files", "--others", "--exclude-standard"], { cwd: ctx.cwd, timeout: 10_000 });
			if (untrackedResult.code !== 0) return notify(ctx, untrackedResult.stderr.trim() || "Unable to list untracked files.", "error");

			const untrackedFiles = untrackedResult.stdout.split("\n").filter(Boolean);
			const untrackedDiffs: string[] = [];
			for (const file of untrackedFiles) {
				const diff = await pi.exec("git", ["diff", "--no-index", "--no-ext-diff", "--no-color", "--", "/dev/null", file], { cwd: ctx.cwd, timeout: 10_000 });
				if (diff.code !== 0 && diff.code !== 1) return notify(ctx, diff.stderr.trim() || `Unable to diff untracked file: ${file}`, "error");
				if (diff.stdout) untrackedDiffs.push(diff.stdout.trimEnd());
			}
			const diffText = [tracked.stdout.trimEnd(), ...untrackedDiffs].filter(Boolean).join("\n");
			if (!diffText) return notify(ctx, "No staged, unstaged, or untracked changes.", "info");
			if (ctx.mode !== "tui") return notify(ctx, "The /diff viewer is available in interactive TUI mode.", "warning");
			await ctx.ui.custom<void>((tui, theme, _keybindings, done) =>
				new DiffViewer(
					parseUnifiedDiff(diffText),
					theme,
					() => tui.requestRender(),
					done,
					new Set(untrackedFiles),
					(file) => void openFileInEditor(tui, ctx, file),
				),
			);
		},
	});
}
