# `/jira` Pi Command Design

## Goal

Add a Pi extension that provides a friendly `/jira` command for common Jira Cloud work-item workflows through the user's already-configured, OAuth-backed `twg` CLI.

The extension does not manage credentials, select sites, or call Jira REST APIs directly.

## Scope

The initial command supports:

- view
- natural-language search
- create
- update
- comment
- assign

It does not support transitions or links.

Jira Cloud, the currently configured `twg` site, and its existing OAuth credentials are the only supported environment. The command never accepts or supplies a site override.

## User interface

Examples:

```text
/jira PROJ-123
/jira view PROJ-123
/jira search open bugs assigned to me this week
/jira create <PROJECT>
/jira update PROJ-123
/jira comment PROJ-123
/jira assign PROJ-123
```

`/jira` and `/jira help` show command help and examples. An issue-key-style invocation without a verb defaults to `view`; empty input shows help.

Prompts use Pi's `input`, `select`, `editor`, and `confirm` APIs. Missing values are collected interactively.

### Create

Create collects or infers:

- project shortname
- issue type
- summary
- description
- optional assignee
- optional priority
- optional labels
- optional parent

The extension attempts to infer project, summary, and description independently from recent session context. Each inferred value is proposed in an editable field only when confidence is conservatively high; otherwise that individual field is prompted. Inference never silently creates an issue.

### Update

Update prompts only for the fields initially supported by the friendly UI:

- summary
- description
- priority
- assignee
- sprint

`assign` is a focused assignee-only shortcut. It maps to the same underlying `twg` update operation.

### View

Compact view output includes:

- key and summary
- description
- priority
- assignee
- sprint
- reporter
- resolution
- labels
- Jira URL when supplied by `twg`

### Search

Search accepts natural language, not raw JQL as its primary interface. The active Pi model converts the request into structured output:

```json
{ "jql": "…", "interpretation": "…" }
```

The extension validates that response, displays both the interpretation and JQL, and requires confirmation before querying. Invalid or malformed conversion output is reported and never blindly retried.

Search results are compact rows containing key, summary, status, assignee, updated time, and URL when available.

## Installed `twg` adapter contract

The extension targets the currently installed `twg` work-item dialect. `twg.ts` exposes typed operations and builds only fixed subprocess argument arrays:

| Friendly action | `twg` operation |
| --- | --- |
| view | `twg jira workitem get <key> -o json` |
| search | `twg jira workitem query --jql <jql> --limit 20 -o json` |
| create | `twg jira workitem create --space <project> --type <type> --summary <summary> --description <description> --description-format markdown … -y -o json` |
| update | `twg jira workitem update --id <key> <changed-field-flags> -o json` |
| comment | `twg jira workitem comment create --issue-id <key> --body <body> --body-format markdown -o json` |
| assign | `twg jira workitem update --id <key> --assignee <assignee> -o json` |

`create` receives `-y` only after Pi's explicit confirmation, preventing a second CLI confirmation. The adapter never uses shell interpolation, accepts raw CLI options, or passes `--site`. Its isolated typed boundary permits a future `twg` version adapter without changing command routing or prompts.

## Architecture

```text
extensions/jira/
  index.ts          # /jira registration, routing, and orchestration
  parser.ts         # friendly command parsing and help text
  prompts.ts        # interactive field collection and confirmations
  inference.ts      # strict model responses for create-field inference
  jql.ts            # strict model responses for natural-language JQL
  twg.ts            # typed, safe twg subprocess adapter
  jira-output.ts    # JSON validation and compact rendering
  jira.test.ts      # isolated command, parser, and formatting tests
```

`package.json` must include `./extensions/*/index.ts` in its Pi extension discovery configuration; the existing top-level glob does not discover this directory entry point.

Responsibilities:

- `index.ts` registers `/jira`, coordinates parsing, prompts, model calls, confirmation, execution, and rendering.
- `parser.ts` parses friendly subcommands and positional values without shell evaluation.
- `prompts.ts` centralizes missing-value collection, editable inference review, and operation-specific confirmation text.
- `inference.ts` reads recent active-session context and requests strict model JSON for project, summary, and description plus confidence values.
- `jql.ts` requests and validates strict model JSON containing JQL and a concise interpretation.
- `twg.ts` invokes `twg` via an argument array, requests JSON, captures stdout/stderr, enforces a timeout, and normalizes failures.
- `jira-output.ts` validates expected JSON shapes and renders selected view fields, compact search rows, and mutation summaries.

## Data flow and safety

1. Parse `/jira` input.
2. Route an issue-key shorthand to view, route an explicit supported verb, or show help.
3. Collect missing fields. For create, infer project, summary, and description from recent context when reliable and present inferred values for editing.
4. For search, invoke the active model for JQL conversion; validate and display its interpretation and JQL.
5. Require confirmation before search execution and every mutation: create, update, comment, and assign.
6. On cancellation, stop successfully without spawning a query or mutation command.
7. Build and execute the fixed `twg` argument array with JSON output.
8. Validate and compactly render the result, or present an actionable error.

Missing `twg`, authentication failures, non-zero exit status, timeouts, malformed JSON, API errors, unsupported commands, absent active model, and invalid model output produce clear user-facing errors. Read/search failures are never rendered as empty results. Errors and notifications must not expose credentials.

## Testing

Tests mock the model converter, UI prompts, recent session context, and subprocess runner. The suite needs no Jira credentials, network access, or live `twg` session.

Coverage includes:

- issue-key shorthand, explicit subcommands, unsupported commands, and help output
- missing-field prompts and per-field context-inference fallback
- editable inferred project, summary, and description values
- create optional fields
- update's selected field set and assign's assignee-only flow
- JQL structured-response validation, display, confirmation, and cancellation
- mutation confirmation and cancellation
- safe `twg` argument construction and absence of a site override
- JSON parsing and selected compact view/search/mutation rendering
- missing executable, authentication failure, non-zero exit, timeout, and malformed output

## Out of scope

The initial implementation excludes Jira administration, project creation, dashboards, filters, sprints management, direct REST calls, multiple-site selection, a separate authentication flow, raw-JQL search as the main interface, transitions, and links.
