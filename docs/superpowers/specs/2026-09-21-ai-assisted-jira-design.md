# AI-assisted Jira redesign

## Purpose

Make `/jira` a fast terminal alternative to the Jira web UI for three focused workflows:

1. View an issue quickly.
2. Create an issue from an explicit instruction and relevant coding-session context.
3. Update an issue or add a comment from an explicit instruction and relevant coding-session context.

The extension remains deliberately limited to Jira view, create, update, and comment operations. It does not become a general Jira agent.

## Principles

- Preserve direct, predictable commands for deterministic actions.
- Use AI only to draft structured Jira changes and explain its proposal.
- Require an explicit review and confirmation before every Jira mutation.
- Keep `twg` as the only component that reads or writes Jira.
- Ground drafts in the user's instruction, current-session context, and, for updates, the current Jira issue.
- Never invent unsupported fields or silently broaden a requested operation.

## Command interface

### View

`/jira PROJ-1234` and `/jira view PROJ-1234` immediately retrieve and display the issue using the existing TUI overlay. This is read-only and makes no model call.

### Create

`/jira create PROJ based on the current design` accepts an optional project and a free-text drafting instruction. The extension derives a create draft from the instruction and recent session context.

Existing forms remain supported:

- `/jira create`
- `/jira create PROJ`

When no instruction is supplied, the extension opens the existing interactive create flow, optionally prefilled by the current basic inference behavior.

### Update

`/jira update PROJ-1234 update based on the latest change` accepts an issue key and a free-text drafting instruction. The extension reads the current issue, drafts only a field patch relevant to the instruction, then asks for review.

`/jira update PROJ-1234` retains the existing interactive update flow.

### Comment

`/jira comment PROJ-1234 summarize the implementation and verification` drafts a single comment from the explicit instruction, relevant session context, and current issue details. `/jira comment PROJ-1234` retains the manual editor flow.

## Architecture

### Command parser

Extend the deterministic parser to return an action, optional project or issue key, and optional instruction. A bare issue key always remains a view. Known verbs route commands; unsupported or malformed commands show help rather than attempting natural-language intent classification.

### Context collector

A focused context collector provides recent session messages. For draft updates and comments, the handler additionally fetches the target issue before model invocation. Context is bounded and passed as untrusted reference material, not as instructions.

### Drafting module

Replace the two narrow AI helpers with action-specific drafting functions. Each function requests JSON only and validates it before the UI sees it:

- create: project, issue type, summary, description, and supported optional fields
- update: supported field patch and a short rationale
- comment: comment body and a short rationale

The validator rejects malformed JSON, empty values, unknown fields, and fields unsuitable for the requested action. Invalid output does not cause a write.

### Preview and mutation

A preview presents the action, proposal, and rationale with three outcomes:

- **Confirm:** pass the validated payload to the existing `twg` mutation client.
- **Edit:** open existing field editors prefilled with the proposal, then confirm the edited payload.
- **Cancel:** exit without calling a mutation method.

The existing confirmation dialog remains the final authorization boundary. The model never invokes `twg` or chooses confirmation.

## Data flow

1. Parse the command deterministically.
2. For view, retrieve and display the issue.
3. For an instructed create, collect relevant session context.
4. For an instructed update/comment, retrieve the issue, then collect session context.
5. Ask the model for an action-specific structured draft.
6. Validate and normalize the draft against the supported schema.
7. Present preview; the user confirms, edits, or cancels.
8. Only after explicit confirmation, execute the corresponding `twg` mutation.
9. Render the mutation result using the existing output formatting.

## Errors and fallback

- No active model: explain that an AI draft requires a model and offer the existing manual workflow.
- Context unavailable: use the explicit instruction and issue data where applicable, or offer the manual workflow.
- Jira retrieval failure: show the `twg` error; do not draft an update/comment against unknown current state.
- Invalid model output: show a clear drafting error and do not mutate Jira.
- User cancellation at preview, edit, or confirmation: make no mutation.

## Testing

Add or extend tests for:

- parser handling of instructed create/update/comment forms and legacy forms
- structured output validation, including rejected unknown fields and malformed JSON
- correct grounding inputs: instruction, session context, and current issue for update/comment
- preview Confirm, Edit, and Cancel behavior
- invariant that no `twg.create`, `twg.update`, or `twg.comment` call occurs before final confirmation
- fallback behavior for missing model, failed issue fetch, and invalid model output
- regression coverage for existing view overlay and manual workflows

## Explicit non-goals

- Natural-language catch-all routing for arbitrary `/jira` text
- Autonomous Jira writes
- Bulk operations, deletion, workflow transitions, sprint management, or issue assignment
- Expanding the extension beyond Jira Cloud through the configured `twg` client
