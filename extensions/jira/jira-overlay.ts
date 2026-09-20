import type { Theme } from "@earendil-works/pi-coding-agent";
import { Key, matchesKey, truncateToWidth, wrapTextWithAnsi, type TUI } from "@earendil-works/pi-tui";
import type { JiraViewModel } from "./jira-output.ts";

const BODY_LINES = 8;
const hyperlink = (url: string) => `\x1b]8;;${url}\x07${url}\x1b]8;;\x07`;

export class JiraIssueOverlay {
	private scrollTop = 0;
	private showAdditional = false;
	private bodyViewport = BODY_LINES;

	constructor(
		view: JiraViewModel,
		theme: Theme,
		tui: TUI,
		done: () => void,
	) {
		this.view = view;
		this.theme = theme;
		this.tui = tui;
		this.done = done;
	}

	private readonly view: JiraViewModel;
	private readonly theme: Theme;
	private readonly tui: TUI;
	private readonly done: () => void;

	private bodyLines(): string[] {
		return this.view.description.split("\n");
	}

	private footerLines(): string[] {
		const fields = this.showAdditional ? this.view.additionalFields.map(([label, value]) => `${label}: ${value}`) : [];
		return [
			...fields,
			`Issue type: ${this.view.issueType} · Priority: ${this.view.priority}`,
			this.view.url ? hyperlink(this.view.url) : "Jira URL: —",
		];
	}

	private clampScroll(): void {
		this.scrollTop = Math.max(0, Math.min(this.scrollTop, Math.max(0, this.bodyLines().length - this.bodyViewport)));
	}

	handleMouse(event: { type: string; wheelDelta?: number }): { handled: boolean; render: boolean } | undefined {
		if (event.type !== "wheel" || event.wheelDelta === undefined) return undefined;
		const previous = this.scrollTop;
		this.scrollTop += event.wheelDelta;
		this.clampScroll();
		if (this.scrollTop !== previous) {
			this.invalidate();
			this.tui.requestRender();
		}
		return { handled: true, render: this.scrollTop !== previous };
	}

	handleInput(data: string): void {
		const oldScroll = this.scrollTop;
		const oldAdditional = this.showAdditional;
		if (matchesKey(data, Key.escape)) {
			this.done();
			return;
		}
		if (matchesKey(data, Key.tab)) {
			this.showAdditional = !this.showAdditional;
		} else if (matchesKey(data, Key.up)) {
			this.scrollTop--;
		} else if (matchesKey(data, Key.down)) {
			this.scrollTop++;
		} else if (matchesKey(data, Key.pageUp)) {
			this.scrollTop -= this.bodyViewport;
		} else if (matchesKey(data, Key.pageDown)) {
			this.scrollTop += this.bodyViewport;
		} else if (matchesKey(data, Key.home)) {
			this.scrollTop = 0;
		} else if (matchesKey(data, Key.end)) {
			this.scrollTop = this.bodyLines().length;
		} else {
			return;
		}
		this.clampScroll();
		if (oldScroll !== this.scrollTop || oldAdditional !== this.showAdditional) {
			this.invalidate();
			this.tui.requestRender();
		}
	}

	render(width: number): string[] {
		const innerWidth = Math.max(1, width - 4);
		const border = this.theme.fg("borderMuted", "│");
		const horizontal = this.theme.fg("borderMuted", "─".repeat(innerWidth + 2));
		const line = (value: string) => `${border} ${truncateToWidth(value, innerWidth, "", true)} ${border}`;
		const header = wrapTextWithAnsi(this.theme.fg("accent", this.view.summary), innerWidth);
		const footer = this.footerLines();
		const maxHeight = Math.floor((this.tui.terminal?.rows ?? (BODY_LINES + header.length + footer.length + 4)) * 0.6);
		this.bodyViewport = Math.max(1, maxHeight - header.length - footer.length - 4);
		this.clampScroll();
		const body = this.bodyLines().slice(this.scrollTop, this.scrollTop + this.bodyViewport);
		while (body.length < this.bodyViewport) body.push("");
		return [
			this.theme.fg("borderMuted", `╭${horizontal}╮`),
			...header.map(line),
			this.theme.fg("borderMuted", `├${horizontal}┤`),
			...body.map(line),
			this.theme.fg("borderMuted", `├${horizontal}┤`),
			...footer.map(line),
			this.theme.fg("borderMuted", `╰${horizontal}╯`),
		].map((value) => truncateToWidth(value, width, ""));
	}

	invalidate(): void {}
}
