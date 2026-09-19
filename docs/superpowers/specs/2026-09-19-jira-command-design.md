# `/jira` Pi Command Design

## Goal

Add a Pi extension providing a friendly `/jira` command for interacting with Jira Cloud through the user's already-configured OAuth-backed `twg` CLI.

The command should support common Jira work-item workflows without implementing Jira authentication or direct Jira API access.

## Agreed scope

- Jira Cloud only.
- Use the currently configured `twg` site and OAuth credentials; no site override.
- Friendly Pi command syntax rather than a raw `twg` passthrough.
- Supported initial operations: view, search, create, update, comment, transition, assign, and link.
- If no subcommand is provided, infer `view` when appropriate.
- Missing required values trigger interactive prompts.
- Every mutating operation requires explicit confirmation.
- View and search output is compact and human-readable.
- Search accepts natural language only and converts it to JQL before querying.
- Generated JQL is always displayed before search execution and must be confirmed.
- Create accepts an optional Jira space/project shortname. If absent, infer it from recent context when reliable, otherwise prompt.

## User interface

Examples:

```text
/jira PROJ-123
/jira view PROJ-123
/jira search open bugs assigned to me this week
/jira create <PROJECT>
/jira update PROJ-123
/jira comment PROJ-123
/jira transition PROJ-123
/jira assign PROJ-123
/jira link PROJ-123
```

`/jira` and `/jira help` show command help and examples. The view shorthand is the normal path for an issue key.

Interactive prompts collect missing fields using Pi's UI APIs (`input`, `select`, `editor`, and `confirm`). Create prompts include project, issue type, summary, description, and relevant optional fields. Other commands prompt only for fields required by the selected `twg` operation.

Mutation confirmation shows the planned operation and important values before invoking `twg`. Cancellation must stop without spawning a mutating command.

## Architecture

Implement a multi-file extension under `extensions/jira/`:

```text
extensions/jira/
  index.ts          # /jira registration and command routing
  parser.ts         # friendly command parsing
  prompts.ts        # interactive field collection
  twg.ts            # controlled subprocess wrapper
  jira-output.ts    # compact result formatting
  jql.ts            # natural-language to JQL conversion
  jira.test.ts      # parser, command, and formatting tests
```

Responsibilities:

- `index.ts`: register `/jira`, coordinate parsing, prompts, model-backed JQL conversion, execution, confirmation, and rendering.
- `parser.ts`: parse friendly subcommands and positional values without shell evaluation.
- `prompts.ts`: centralize missing-value prompts and confirmation text.
- `twg.ts`: invoke `twg` using a subprocess argument array, request JSON output, capture stdout/stderr, enforce a timeout, and normalize failures.
- `jira-output.ts`: validate the expected JSON shape and render compact issue/search/mutation summaries with Jira URLs where available.
- `jql.ts`: use the active Pi model to convert natural language into structured JQL output and validate the response before displaying it.

The extension must not manage credentials, call Jira REST APIs directly, or accept a site override. Authentication and site selection remain the responsibility of `twg`.

## Data flow

1. Parse the `/jira` input.
2. Default to view for an issue-key-style invocation; otherwise show help for an empty invocation.
3. Gather missing values through Pi UI prompts.
4. For create, inspect recent session context for a reliable project shortname; prompt if none can be safely inferred.
5. For search, provide the natural-language request and relevant Jira guidance to the active Pi model. Require a structured result containing JQL and an interpretation.
6. Display the interpretation and JQL and require confirmation before querying.
7. For mutations, display the planned operation and require confirmation.
8. Build a fixed `twg jira ...` argument array and execute it with JSON output.
9. Parse the result, render a compact summary, and report actionable errors.

## Search conversion

Search input is natural language only. Users do not provide raw JQL as the primary interface.

The model conversion prompt must require valid Jira Cloud JQL and a structured response containing:

- `jql`: the query to send to `twg`
- `interpretation`: a concise human-readable description

The command displays both values before execution. If conversion fails, the response is malformed, or JQL is rejected, report the error and do not retry blindly.

## Safety and errors

- All mutations require explicit confirmation, including create, update, comment, transition, assign, and link.
- User cancellation is a successful no-op and must not invoke `twg`.
- Subprocess arguments must never be assembled into an interpolated shell command.
- Missing `twg`, authentication failures, non-zero exit status, malformed JSON, unsupported commands, and API errors receive clear user-facing messages.
- Search and view failures must not be mistaken for empty results.
- The extension should respect Pi cancellation where supported and avoid leaking credentials in errors or notifications.

## Testing

Tests should cover:

- Default view routing and explicit subcommands.
- Argument parsing and help output.
- Missing-field prompt behavior and cancellation.
- Project inference success and prompt fallback.
- Model JQL response parsing and invalid-response handling.
- JQL display and confirmation behavior.
- Mutation confirmation and cancellation.
- Safe `twg` argument construction.
- JSON parsing and compact formatting.
- Missing executable, authentication failure, non-zero exit, timeout, and malformed output.

Tests should mock subprocess execution and model conversion so the suite does not require Jira credentials, network access, or a live `twg` session.

## Out of scope

The initial implementation does not include Jira administration, project creation, dashboards, sprints, filters, direct REST calls, multiple-site selection, raw-JQL search as the main interface, or a separate authentication flow.
