import test from "node:test";
import assert from "node:assert/strict";
import jiti from "/Users/ivan.pan/.asdf/installs/nodejs/26.8.2/lib/node_modules/@earendil-works/pi-coding-agent/node_modules/jiti/lib/jiti.mjs";

const piDirectory = "/Users/ivan.pan/.asdf/installs/nodejs/26.8.2/lib/node_modules/@earendil-works/pi-coding-agent";
const load = jiti(import.meta.url, {
	alias: {
		"@earendil-works/pi-coding-agent": `${piDirectory}/dist/index.js`,
		"@earendil-works/pi-tui": `${piDirectory}/node_modules/@earendil-works/pi-tui/dist/index.js`,
	},
});
const { DiffViewer } = await load("./diff.ts");

const theme = {
	fg: (_color, text) => text,
	bg: (_color, text) => text,
	bold: (text) => text,
};

function createViewer(onEdit) {
	const rows = [
		{ kind: "file", text: "first.ts" },
		{ kind: "meta", text: "first metadata" },
		{ kind: "file", text: "second.ts" },
		{ kind: "meta", text: "second metadata" },
	];
	const viewer = new DiffViewer(rows, theme, () => {}, () => {}, new Set(), onEdit);
	viewer.render(120);
	return viewer;
}

test("the edit shortcut is shown only when the file panel is visible", () => {
	const viewer = createViewer(() => {});

	assert.match(viewer.render(120).join("\n"), /e edit selected/);
	assert.doesNotMatch(viewer.render(80).join("\n"), /e edit selected/);
});

test("e defers opening the selected file until after the focused file-panel input event", async () => {
	const opened = [];
	const viewer = createViewer((file) => opened.push(file.name));

	viewer.handleInput("e");
	assert.deepEqual(opened, []);
	await new Promise(queueMicrotask);
	viewer.handleInput("\t");
	viewer.handleInput("e");
	await new Promise(queueMicrotask);

	assert.deepEqual(opened, ["first.ts"]);
});
