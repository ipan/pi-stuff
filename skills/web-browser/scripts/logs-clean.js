#!/usr/bin/env node

import { existsSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export function cleanLogs(root, retentionDays) {
	if (!Number.isFinite(retentionDays) || retentionDays <= 0 || !existsSync(root)) return 0;
	const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
	let removed = 0;

	function visit(directory) {
		for (const entry of readdirSync(directory, { withFileTypes: true })) {
			const path = join(directory, entry.name);
			if (entry.isDirectory()) {
				visit(path);
			} else if (entry.isFile() && entry.name.endsWith(".jsonl") && statSync(path).mtimeMs < cutoff) {
				unlinkSync(path);
				removed += 1;
			}
		}
	}

	visit(root);
	return removed;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	const retentionDays = Number(process.argv[2] || 30);
	const root = process.env.AGENT_WEB_LOG_ROOT || join(homedir(), ".cache", "agent-web", "logs");
	const removed = cleanLogs(root, retentionDays);
	console.log(`Removed ${removed} log file${removed === 1 ? "" : "s"} older than ${retentionDays} day${retentionDays === 1 ? "" : "s"}.`);
}
