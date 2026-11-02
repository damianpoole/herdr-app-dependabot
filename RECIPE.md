# Dependabot dashboard

A native herdr-app dashboard for security alerts in locally checked-out GitHub
repositories. The sidebar footer reads Settings, Dependabot, Tasks, Add machine.
Dependabot opens a full native tab like Tasks, not a strip or side panel.

## What you see

The footer has 28px rows and 125px total height with Tasks present; 97px without.
It follows theme chrome/muted/hover colors and collapses to icons in a narrow
sidebar. Settings retains its update indicator. The full-tab dashboard has a
42px header with Refresh, confirmed alert totals and checked/unavailable counts,
search, severity buttons and an issues-only filter. A scrollable repository
list expands into alerts and advisory details, including patch and GitHub links.

## How it behaves

The footer does not fetch data. Dependabot opens a dashboard mod tab in the
current local space; clicking again reuses a matching tab. Tasks retains the
same reuse-first behavior, Settings opens settings, Add machine opens its picker.
Remote spaces are not used to execute the local backend.

The dashboard loads once, then refreshes manually. Two workers progressively
update results. Loading, clean zero, filtered-empty, failed and stale states are
distinct; errors never become zero. Search and severity filters compose. Click
a repo, then an alert, for advisory details. Links open in the system browser.

## Built from

One GPUI View with footer and dashboard roles. Native InputState/Input, theme,
spaces/panes/run, layout/updates, nextCommand, exec and cx.open_url are used.
Pure model/client modules handle filter/state logic and tab reuse. Installed
config pins Node plus dist/cli.js. The installer replaces only a known Tasks
or standard Settings sidebar-footer, leaves original mod files untouched,
backs up personal layouts, removes owned legacy strip/panel blocks, and refuses
unknown custom footers or ID conflicts.

The TypeScript backend scans .git directories/files, reads Git remotes and
uses authenticated gh api --include --method GET. Dependabot requires cursor
Link pagination, never numeric page parameters.

## Watch out

No DOM, React, Node APIs or retained cx in native UI code. Backend deadlines
are below the host's 30-second exec limit. Make limits and partial/unavailable
data honest. Never persist credentials, publish private alert data or modify
shipped layouts. The Tasks icon is from the installed Tasks mod only when that
footer was present. Linux is the only locally verified platform.

## Done when

Tests prove footer order, full-tab creation/reuse, local-space selection, safe
legacy migration, filters/details/links/stale results, cursor pagination, errors,
bounded workers and repeat installation. Build, types, lint/format, hosted CI
and native checks pass; inspect the installed footer/dashboard visually.
