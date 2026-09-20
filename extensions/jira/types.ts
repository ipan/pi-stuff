export type JiraAction = "help" | "view" | "search" | "create" | "update" | "comment" | "assign";

export type ParsedJiraCommand =
	| { action: "help" }
	| { action: "view"; key: string }
	| { action: "search"; text: string }
	| { action: "create"; project?: string }
	| { action: "update"; key?: string }
	| { action: "comment"; key?: string }
	| { action: "assign"; key?: string };

export type CreateDraft = {
	project: string;
	type: string;
	summary: string;
	description: string;
	assignee?: string;
	priority?: string;
	labels?: string;
	parent?: string;
};

export type UpdateDraft = {
	key: string;
	summary?: string;
	description?: string;
	priority?: string;
	assignee?: string;
	sprint?: string;
};

export type ModelJson = (prompt: string) => Promise<string>;

export type TwgRunner = (
	args: readonly string[],
	options: { timeoutMs: number },
) => Promise<{ stdout: string; stderr: string; exitCode: number }>;
