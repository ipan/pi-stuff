import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { relative } from "node:path";
import {
	PLAN_MODE_STATE_TYPE,
	PLAN_SAFE_TOOLS,
	activePlanTools,
	createPlanModeState,
	restoreActiveTools,
	restorePlanModeState,
	type PlanModeState,
} from "./state.ts";
import { latestAssistantText, renderPlanMarkdown, resolvePlanPath, writePlanFile } from "./plan.ts";

export const PLAN_MODE_BLOCK_REASON = "Plan mode is active: workspace mutation is disabled. Use /plan off before editing or running shell commands.";

export function parsePlanModeArgs(args: string, currentlyEnabled: boolean): boolean | undefined {
	switch (args.trim().toLowerCase()) {
		case "":
		case "toggle":
			return !currentlyEnabled;
		case "on":
			return true;
		case "off":
			return false;
		default:
			return undefined;
	}
}

export function shouldBlockPlanTool(toolName: string): boolean {
	return !PLAN_SAFE_TOOLS.has(toolName);
}

export function planModeSystemPrompt(base: string): string {
	return `${base}\n\nPlan mode is active. You may investigate using read-only tools and must prepare a proposal. You must not modify the workspace or ask to bypass these controls.`;
}

function updateStatus(ctx: ExtensionContext, enabled: boolean): void {
	ctx.ui.setStatus("plan-mode", enabled ? "PLAN" : undefined);
}

function notify(ctx: ExtensionContext, message: string, level: "info" | "warning" = "info"): void {
	ctx.ui.notify(message, level);
}

export default function (pi: ExtensionAPI): void {
	let state: PlanModeState = { enabled: false, restoreTools: [] };

	const allToolNames = (): string[] => pi.getAllTools().map((tool) => tool.name);

	const activate = (restoreTools: readonly string[], ctx: ExtensionContext, persist: boolean): void => {
		state = createPlanModeState(true, restoreTools);
		pi.setActiveTools(activePlanTools(allToolNames()));
		if (persist) pi.appendEntry(PLAN_MODE_STATE_TYPE, state);
		updateStatus(ctx, true);
	};

	const deactivate = (ctx: ExtensionContext, persist: boolean): void => {
		pi.setActiveTools(restoreActiveTools(state.restoreTools, allToolNames()));
		state = createPlanModeState(false, state.restoreTools);
		if (persist) pi.appendEntry(PLAN_MODE_STATE_TYPE, state);
		updateStatus(ctx, false);
	};

	const setPlanMode = async (enabled: boolean, ctx: ExtensionCommandContext): Promise<void> => {
		await ctx.waitForIdle();
		if (enabled === state.enabled) return;
		if (enabled) {
			activate(pi.getActiveTools(), ctx, true);
			notify(ctx, "Plan mode enabled: workspace mutation is blocked.");
			return;
		}
		deactivate(ctx, true);
		notify(ctx, "Plan mode disabled: previous tools restored.");
	};

	pi.registerFlag("plan", {
		description: "Start in read-only plan mode",
		type: "boolean",
		default: false,
	});

	pi.registerCommand("plan", {
		description: "Toggle plan mode. Usage: /plan [on|off|toggle]",
		handler: async (args, ctx) => {
			const enabled = parsePlanModeArgs(args, state.enabled);
			if (enabled === undefined) {
				notify(ctx, "Usage: /plan [on|off|toggle]", "warning");
				return;
			}
			await setPlanMode(enabled, ctx);
		},
	});

	pi.registerCommand("save-plan", {
		description: "Save the latest proposal as a Markdown plan",
		handler: async (args, ctx) => {
			if (!ctx.hasUI) {
				notify(ctx, "Plan export requires an interactive confirmation.", "warning");
				return;
			}

			const now = new Date();
			let target: string;
			try {
				target = resolvePlanPath(ctx.cwd, args, now);
			} catch (error) {
				notify(ctx, error instanceof Error ? error.message : "Unable to resolve plan path.", "warning");
				return;
			}

			const proposal = latestAssistantText(ctx.sessionManager.getBranch());
			if (!proposal) {
				notify(ctx, "No assistant proposal is available to save.", "warning");
				return;
			}
			const edited = await ctx.ui.editor("Save plan", proposal);
			if (edited === undefined) return;

			let content: string;
			try {
				content = renderPlanMarkdown(edited, now);
			} catch (error) {
				notify(ctx, error instanceof Error ? error.message : "Unable to render plan.", "warning");
				return;
			}

			const displayPath = relative(ctx.cwd, target);
			if (!await ctx.ui.confirm("Save plan?", `Write ${displayPath}?`)) return;
			try {
				await writePlanFile(target, content);
				notify(ctx, `Plan saved to ${displayPath}.`);
			} catch (error) {
				notify(ctx, error instanceof Error ? error.message : "Unable to save plan.", "warning");
			}
		},
	});

	pi.registerShortcut("ctrl+shift+p", {
		description: "Toggle plan mode",
		handler: async (ctx) => setPlanMode(!state.enabled, ctx),
	});

	pi.on("session_start", (_event, ctx) => {
		const restored = restorePlanModeState(ctx.sessionManager.getBranch());
		if (pi.getFlag("plan")) {
			activate(pi.getActiveTools(), ctx, false);
			return;
		}
		state = restored;
		if (state.enabled) activate(state.restoreTools, ctx, false);
		else updateStatus(ctx, false);
	});

	pi.on("before_agent_start", (event) => {
		if (state.enabled) return { systemPrompt: planModeSystemPrompt(event.systemPrompt) };
	});

	pi.on("tool_call", (event) => {
		if (state.enabled && shouldBlockPlanTool(event.toolName)) {
			return { block: true, reason: PLAN_MODE_BLOCK_REASON };
		}
	});

	pi.on("user_bash", () => {
		if (state.enabled) {
			return {
				result: { output: PLAN_MODE_BLOCK_REASON, exitCode: 126, cancelled: false, truncated: false },
			};
		}
	});
}
