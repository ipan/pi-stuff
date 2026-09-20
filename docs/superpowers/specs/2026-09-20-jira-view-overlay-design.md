# Jira View Overlay Design

## Goal

Make `/jira <issue-key>` open a focused, readable issue overlay instead of displaying the full view as a transient notification. The overlay must keep the issue summary and metadata visible while allowing long descriptions to scroll.

## Scope

This change applies to the Jira `view` action only. Search, create, update, comment, and assign output remain unchanged.

## Interaction and Layout

`/jira thb-8149` and equivalent issue-key invocations fetch the issue and open a TUI overlay in interactive TUI mode.

The overlay has three regions:

1. **Fixed header** — the issue summary, word-wrapped to the available overlay width.
2. **Scrollable body** — the issue description, rendered as readable text from Jira's string or ADF description shape.
3. **Fixed footer** — two rows:
   - issue type and priority;
   - the complete Jira URL rendered as an OSC 8 clickable hyperlink when a URL is available.

Additional fields are hidden initially. Pressing `Tab` toggles their visibility. The additional fields are the existing secondary view fields: assignee, sprint, reporter, resolution, and labels. The description remains the scrollable content area in either mode. `Esc` closes the overlay.

The overlay uses the injected Pi TUI theme and key handling APIs, and is sized responsively with a bounded maximum height so it does not cover the entire terminal unnecessarily.

## Data Flow

1. `twg.view(key)` returns the existing Jira JSON envelope.
2. A structured view parser validates the envelope and converts it into a typed view model containing key, summary, description text, issue type, priority, URL, and additional fields.
3. The view model is passed to `JiraIssueOverlay`.
4. The command awaits `ctx.ui.custom()` with `{ overlay: true }`.
5. Non-TUI modes retain a concise notification fallback because custom overlays require interactive TUI mode.

The current compact string formatter remains available for fallback and existing tests, but the overlay should consume structured data rather than reparsing formatted text.

## Scrolling

The description body uses the Pi TUI scrolling component or equivalent component-level scroll state. Header and footer are rendered outside the scrollable body so they remain fixed. Keyboard input must update scroll position and request a render; unhandled keys should preserve standard overlay behavior. The component must obey the TUI line-width contract after wrapping and styling.

## URL Rendering

The URL is emitted with Pi's supported hyperlink helper so terminals supporting OSC 8 make it clickable. The raw URL remains readable in terminals without hyperlink support.

## Error Handling and Compatibility

Malformed Jira output continues to produce `JiraOutputError`. Fetch and authentication failures continue to use the existing `TwgError` handling. If the command is run outside interactive TUI mode, it should not attempt to construct a custom component.

## Testing

Add credential-free tests for:

- converting the live Jira envelope into the structured view model;
- rendering summary, fixed metadata, URL, and additional fields;
- hiding and showing additional fields with `Tab`;
- scrolling description content while fixed regions remain represented;
- closing the overlay with `Esc` and preserving malformed-output errors.

Run the complete existing test suite and `git diff --check` before completion.
