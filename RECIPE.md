# Dependabot dashboard

A native herdr-app security-alert dashboard for the GitHub repositories checked
out on this computer. A compact launcher beneath tabs opens a themed side panel
or native tab. There is no GitHub-write control.

## What you see

A 40px launcher strip. The panel has a 42px header with Refresh, confirmed open
alert totals and checked/unavailable repository counts, a search input, wrapping
severity buttons and an alerts/unavailable filter. A scrollable list shows
repositories with counts, severity breakdowns and freshness. Expanding a repo
reveals alert rows; selecting an alert shows its advisory, package, manifest,
scope, vulnerable range, patch version and GitHub link. Theme surface/chrome,
foreground/muted/border/accent colors follow the user's appearance.

## How it behaves

Load on first panel display, then manual refresh only. Two workers fetch alerts
and progressively update rows. Distinguish discovering/loading, genuine zero,
filtered-empty, stale previous results and unavailable data. Errors never become
zero. Search combines repository/advisory/package/CVE fields with severity and
issues-only filtering. Click rows to expand/collapse and links to open the browser.
No agent status or autonomous repairs. Existing app commands can refresh, open,
toggle issues or step through repos/alerts without new global keybindings.

## Built from

`mods/dependabot/main.js` extends GPUI View, using native InputState/Input,
theme, exec, props, nextCommand, run, layout/focus and cx.open_url. Pure model
and client modules handle filters, stale merge, response validation and bounded
workers. Installed config pins Node plus `dist/cli.js`. The strip role performs
no network work; panel role uses backend discovery and per-repository alerts.
The installer adds a block under tabs and a panel child to panel-body while
preserving unrelated nodes. A missing standard panel container falls back to tab.

The TypeScript backend scans local .git directories/files, reads Git remotes,
and calls authenticated `gh api --include --method GET`, following validated
GitHub cursor Link headers. Never use numbered pages for this endpoint.

## Watch out

No DOM, CSS, React, Node APIs or retained cx inside the native mod. The host exec
limit is 30s, so backend deadlines are 22s. Discovery/API caps and failures must
be visible, not silently dropped. Do not persist credentials or alert data.
Do not patch shipped layouts or other mods. Tests and screenshots must use
fictional data; never publish the user's sidebar, local paths or live alerts.
Linux is the only locally verified platform.

## Done when

Fixture tests cover discovery/worktrees/dedup/bounds, Link pagination, errors
and no-false-zero behavior, queue bounds, stale/search/severity UI behavior and
safe repeat installation. Build, type checks, lint/format and CI pass. Native
check passes and the installed dashboard is visually inspected in the running
app, including actual asynchronous results and interactions.
