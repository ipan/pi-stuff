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

- [`diff.ts`](extensions/diff.ts) - `/diff` opens a GitHub-style viewer for staged and unstaged tracked changes.
- [`edit.ts`](extensions/edit.ts) - `/edit recent` or `/edit @path...` opens files and folders in `$EDITOR` from the current terminal.
- [`zed.ts`](extensions/zed.ts) - `/zed` opens the current session working
  directory (or one explicit directory) in [Zed](https://zed.dev). Launched
  detached so the agent keeps control; add `--wait` to block until the editor
  closes.
- [`jira`](extensions/jira/) - `/jira` manages Jira Cloud work items through
  the locally configured `twg` OAuth session. Use `/jira PROJ-123` to open a
  scrollable TUI view (Tab toggles additional fields, Esc closes it, and the
  full Jira URL is clickable when supported); non-TUI modes use compact output.
  Use `/jira search open bugs assigned to me` to generate and confirm JQL, or
  `/jira create`, `/jira update PROJ-123`, `/jira comment PROJ-123`, and
  `/jira assign PROJ-123` for confirmed interactive operations. Run `twg login`
  if authentication is unavailable.

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
