export function getFileSections(rows, untracked = new Set()) {
	return rows.flatMap((row, rowIndex) =>
		row.kind === "file" ? [{ name: row.text, rowIndex, untracked: untracked.has(row.text) }] : [],
	);
}

export function getWheelScroll(event, _panelWidth) {
	if (event.type !== "wheel") return 0;
	return event.wheelDelta ?? 0;
}

export function parseUnifiedDiff(diff) {
	const rows = [];
	let oldLine = 0;
	let newLine = 0;
	let inHunk = false;

	for (const line of diff.split("\n")) {
		if (line.startsWith("diff --git ")) {
			const match = line.match(/^diff --git a\/(.+) b\/(.+)$/);
			rows.push({ kind: "file", text: match?.[2] ?? line.slice("diff --git ".length) });
			inHunk = false;
			continue;
		}

		const hunk = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
		if (hunk) {
			oldLine = Number(hunk[1]);
			newLine = Number(hunk[2]);
			inHunk = true;
			rows.push({ kind: "hunk", text: line });
			continue;
		}

		if (!inHunk) {
			if (line) rows.push({ kind: "meta", text: line });
			continue;
		}

		if (line.startsWith("+")) {
			rows.push({ kind: "add", oldLine: null, newLine, text: line });
			newLine++;
		} else if (line.startsWith("-")) {
			rows.push({ kind: "remove", oldLine, newLine: null, text: line });
			oldLine++;
		} else if (line.startsWith(" ")) {
			rows.push({ kind: "context", oldLine, newLine, text: line });
			oldLine++;
			newLine++;
		} else if (line) {
			rows.push({ kind: "meta", text: line });
		}
	}

	return rows;
}
