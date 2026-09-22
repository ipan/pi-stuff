export const PLAN_MODE_STATE_TYPE = "plan-mode-state";
export const PLAN_SAFE_TOOLS = new Set(["read", "grep", "find", "ls"]);

export type PlanModeState = {
	enabled: boolean;
	restoreTools: string[];
};

function normalizeToolNames(toolNames: readonly string[]): string[] {
	return [...new Set(toolNames.map((name) => name.trim()).filter(Boolean))];
}

export function createPlanModeState(enabled: boolean, restoreTools: readonly string[]): PlanModeState {
	return { enabled, restoreTools: normalizeToolNames(restoreTools) };
}

export function restorePlanModeState(entries: readonly unknown[]): PlanModeState {
	for (let index = entries.length - 1; index >= 0; index -= 1) {
		const entry = entries[index] as { type?: unknown; customType?: unknown; data?: unknown } | undefined;
		if (entry?.type !== "custom" || entry.customType !== PLAN_MODE_STATE_TYPE) continue;
		const data = entry.data as { enabled?: unknown; restoreTools?: unknown } | undefined;
		if (typeof data?.enabled !== "boolean" || !Array.isArray(data.restoreTools) || !data.restoreTools.every((tool) => typeof tool === "string")) continue;
		return createPlanModeState(data.enabled, data.restoreTools);
	}
	return { enabled: false, restoreTools: [] };
}

export function activePlanTools(allToolNames: readonly string[]): string[] {
	return allToolNames.filter((name) => PLAN_SAFE_TOOLS.has(name));
}

export function restoreActiveTools(restoreTools: readonly string[], allToolNames: readonly string[]): string[] {
	const available = new Set(allToolNames);
	return [...new Set(restoreTools)].filter((name) => available.has(name));
}
