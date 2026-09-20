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
- [`zed.ts`](extensions/zed.ts) - `/zed` opens the current session working
  directory (or one explicit directory) in [Zed](https://zed.dev). Launched
  detached so the agent keeps control; add `--wait` to block until the editor
  closes.

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
