# pi-stuff

Ivan's personal [Pi](https://buildwithpi.ai/) coding agent package. It bundles my
extensions, skills, prompt commands, and themes into one package that Pi loads
from my user settings.

## Layout

Resources live in conventional directories and are declared in the `pi` key of
[`package.json`](package.json):

- `extensions/` - Pi extensions (`*.ts`)
- `skills/` - agent skills (`SKILL.md` folders)
- `prompts/` - prompt command templates (`*.md`)
- `themes/` - theme definitions (`*.json`)

## Extensions

- [`btw.ts`](extensions/btw.ts) - `/btw` opens a separate, context-aware side-chat overlay for focused questions, planning, debugging, and quick exploration. `/btw-edit` enables file editing only for an explicitly requested change; the side thread can be summarized back into the main conversation.
- [`diff.ts`](extensions/diff.ts) - `/diff` opens a GitHub-style viewer for staged and unstaged tracked changes.
- [`edit.ts`](extensions/edit.ts) - `/edit recent` or `/edit @path...` opens files and folders in `$EDITOR` from the current terminal.
- [`zed.ts`](extensions/zed.ts) - `/zed` opens the current session working
  directory (or one explicit directory) in [Zed](https://zed.dev). Launched
  detached so the agent keeps control; add `--wait` to block until the editor
  closes.
- [`plan-mode`](extensions/plan-mode/) - session-scoped read-only planning and explicit plan export; see [Plan mode](#plan-mode).
- [`jira`](extensions/jira/) - `/jira` manages Jira Cloud work items through
  the locally configured `twg` OAuth session. Use `/jira PROJ-123` to open a
  scrollable TUI view (60% terminal height; mouse wheel scrolls the description,
  Tab toggles additional fields in the dynamic footer, Esc closes it, and the
  full Jira URL is clickable when supported); non-TUI modes use compact output.
  Use `/jira search open bugs assigned to me` to generate and confirm JQL.
  `/jira create PROJ <instruction>` drafts a task from the instruction and current
  session; `/jira update PROJ-123 <instruction>` and `/jira comment PROJ-123
  <instruction>` first read the issue, then offer a grounded draft to confirm,
  edit, or cancel. `/jira create`, `/jira update PROJ-123`, and `/jira comment
  PROJ-123` retain manual workflows. Every write requires final confirmation.
  Run `twg login` if authentication is unavailable.

### Plan mode

Load `extensions/plan-mode/index.ts` (or install this package) and use `/plan`, `/plan on`, `/plan off`, or `Ctrl+Shift+P` to control the session-scoped mode. Start a session in it with `pi --plan`.

Plan mode leaves only `read`, `grep`, `find`, and `ls` active. It blocks all LLM mutation tools and every user shell command (`!` and `!!`); it does not try to infer whether a shell command is safe. Use `/save-plan [docs/plans/name.md]` to edit and explicitly confirm a Markdown export. The export refuses paths outside the workspace and refuses to overwrite an existing file.

## Skills

- [`github`](skills/github/SKILL.md) - use the `gh` CLI for GitHub issues, pull requests, Actions runs, and API queries.
- [`native-web-search`](skills/native-web-search/SKILL.md) - run concise web research with source URLs through the native search helper.
- [`summarize`](skills/summarize/SKILL.md) - convert URLs and local documents such as PDF, DOCX, and HTML into Markdown, optionally with a summary.
- [`uv`](skills/uv/SKILL.md) - use `uv` for Python scripts, dependencies, and virtual-environment-free workflows instead of `pip` or `venv`.

## Adding a resource

1. Drop the file/folder in the right directory above.
2. Reload Pi (`/reload`) so it picks up the change.
3. Commit it so the package stays reproducible.

## Install / enable

This package is registered as a local path in the user settings:

```sh
pi install /Users/ivan.pan/Projects/pi-stuff
pi list   # verify it shows up
```

To pin/uninstall later:

```sh
pi remove /Users/ivan.pan/Projects/pi-stuff
```
