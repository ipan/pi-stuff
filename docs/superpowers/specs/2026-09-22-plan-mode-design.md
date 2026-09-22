# Plan Mode Design

## Status

Proposed design for a project-local Pi extension. This document covers the first implementation: a session-scoped, read-only planning mode with explicit Markdown plan export.

## Goal

Provide a Pi mode in which the model can inspect the repository and develop a proposal, but cannot edit files, write files, or execute mutation-capable shell commands. A plan is saved to disk only after the user explicitly requests and confirms the save.

## Non-goals

- No changes to Pi core.
- No automatic implementation after a plan is saved.
- No attempt to statically prove that arbitrary shell commands are read-only.
- No automatic plan saving on turn completion.
- No general permission framework for normal mode.

## User experience

- `/plan` toggles plan mode. The command is idempotent when passed an explicit state: `/plan on` and `/plan off` are supported.
- `Ctrl+Shift+P` provides an optional shortcut for toggling the mode.
- `pi --plan` starts the session in plan mode.
- The footer displays `PLAN` while active; the status is refreshed after session start, mode changes, and session restoration.
- In plan mode the model receives a concise instruction that it is preparing a proposal and must not modify the workspace.
- `/save-plan [path]` explicitly requests export. If no path is provided, the extension proposes a deterministic default under `docs/plans/` and asks for confirmation before writing.
- The save command exports the latest assistant proposal, or the user-provided content when supplied through the command/editor flow. It does not trigger an LLM turn.
- `/save-plan` is unavailable or reports a clear error in non-interactive modes when confirmation cannot be obtained, unless an explicit path and non-interactive policy are later added.

## Safety model

Plan mode uses two layers:

1. **Active-tool restriction:** on entry, retain only read-oriented tools (`read`, `grep`, `find`, and `ls`) plus the extension's plan-specific tools if any. On exit, restore the exact prior active-tool set rather than assuming the default set.
2. **Execution gate:** register a `tool_call` handler that blocks `write`, `edit`, `bash`, `powershell`, and any other known mutation-capable tool while plan mode is active. This remains fail-safe if another extension reactivates a blocked tool or a tool call was already present in the model context.

User-entered `!`/`!!` shell commands are also blocked in plan mode through the `user_bash` event. Read-only shell commands are not selectively allowed because shell command intent cannot be safely classified in the general case.

The extension must keep a denylist for mutation-capable tools and document that custom tools are not automatically safe. A future API can allow explicitly trusted read-only custom tools, but the first version should leave unknown custom tools inactive in plan mode.

The system prompt is supplemental guidance only; it is not the enforcement mechanism.

## Extension architecture

Create a directory extension at `extensions/plan-mode/` with these responsibilities:

- `index.ts`: registers the flag, command, shortcut, lifecycle hooks, tool gate, and UI status.
- `state.ts`: owns the session mode state and restoration metadata.
- `plan.ts`: extracts/normalizes the latest proposal and renders Markdown export content.
- Tests colocated with the implementation, following existing repository test conventions.

State is session-scoped and reconstructed on `session_start` from a custom session entry such as `plan-mode-state`. Mode transitions append an entry so session branching and resume can restore the intended mode. The extension must avoid persisting absolute paths or secrets in plan metadata.

When the active tool set changes, store the prior set in extension memory and in the state entry. On session restoration, use the persisted prior set only to restore when leaving plan mode; if it contains unavailable tools, intersect with `pi.getAllTools()` and notify the user.

## Plan export

The first version saves a Markdown document with:

- title and timestamp;
- project working directory (relative or basename only where possible);
- objective/user request;
- repository findings and relevant files;
- proposed implementation steps;
- testing/verification approach;
- risks, assumptions, and open questions.

The export should prefer the latest assistant response that is a proposal. If the latest response is not clearly a proposal, `/save-plan` should ask the user to provide or edit the content rather than guessing. Use `ctx.ui.editor()` in TUI/RPC-capable modes for editing/confirmation when appropriate, and use `ctx.ui.confirm()` immediately before filesystem mutation.

Writing the plan is an extension-owned filesystem operation, not the model's `write` tool. Resolve relative paths against `ctx.cwd`, create parent directories only after confirmation, refuse paths outside the working directory unless an explicit future policy permits them, and use exclusive-create or an overwrite confirmation to avoid accidental replacement.

## Lifecycle and edge cases

- Entering plan mode while the agent is running must queue the transition or reject it; it must not change tool policy halfway through an in-flight tool batch.
- `/plan off` must wait for idle before restoring tools.
- Session fork/new/resume/reload must reinitialize state and UI without carrying stale closures or stale session managers.
- If a blocked tool call occurs, return a clear error to the model and include the reason in the TUI result.
- If a custom extension registers a mutation tool after plan mode starts, the execution gate still blocks it unless explicitly classified as safe.
- If plan mode cannot enforce the gate because the host does not expose the relevant event, startup should fail closed for mutation tools and show a warning.
- Normal mode should restore the previous tool set, not blindly enable all built-ins or disable tools owned by other extensions.

## Testing strategy

Unit/integration coverage should verify:

- `/plan on`, `/plan off`, toggle behavior, and startup `--plan` flag;
- state persistence and restoration across session start/resume/fork/reload;
- active-tool transitions preserve the pre-plan set;
- `tool_call` blocks built-in mutation tools and unknown/custom tools in plan mode;
- read tools remain usable;
- `user_bash` is blocked in plan mode;
- blocked tool calls provide a useful reason and do not execute;
- `/save-plan` requires explicit confirmation and writes only after confirmation;
- default paths, path traversal/out-of-workspace paths, and overwrite behavior;
- print/JSON/RPC behavior does not silently write plans;
- mode status accurately reflects state.

Manual verification should run Pi with `--plan`, inspect files before and after attempted edits/bash commands, toggle back to normal, and verify normal editing works again.

## Recommended implementation order

1. Implement state and mode transitions with status/flag/command.
2. Add active-tool restriction and execution/user-shell gates.
3. Add plan extraction, confirmation, and safe export.
4. Add persistence and session lifecycle handling.
5. Add tests and manual CLI verification.
