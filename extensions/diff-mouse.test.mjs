import test from "node:test";
import assert from "node:assert/strict";
import { getWheelScroll } from "./diff-tools.mjs";

test("getWheelScroll moves the diff offset for wheel events over the diff panel", () => {
	assert.equal(getWheelScroll({ type: "wheel", x: 60, wheelDelta: 1 }, 40), 1);
	assert.equal(getWheelScroll({ type: "wheel", x: 60, wheelDelta: -1 }, 40), -1);
});

test("getWheelScroll moves the selected file for wheel events over the file panel", () => {
	assert.equal(getWheelScroll({ type: "wheel", x: 10, wheelDelta: 1 }, 20), 1);
	assert.equal(getWheelScroll({ type: "wheel", x: 10, wheelDelta: -1 }, 20), -1);
});
