# herdr-app-dependabot

A native **herdr-app** dashboard for Dependabot **security alerts** in your
locally checked-out GitHub repositories. No update-PR management, repairs,
alert dismissal, or GitHub writes.

## Requirements

- Current herdr-app with native GPUI mod support (not the old Herdr TUI API)
- Node.js **22+**, Git, and authenticated GitHub CLI: `gh auth login`
- Permission to read Dependabot alerts for each repository. A classic token
  generally needs `repo` / `security_events`; fine-grained tokens need
  Dependabot alerts read access. Organization/SSO policies may also apply.
  The mod never requests, stores, or changes credentials.

The UI is native GPUI JavaScript; the backend is TypeScript/Node using
`gh api`. React, a browser server, and paid model providers are not needed.

## Install

Inspect the code before installing: this trusted mod runs Node, Git and
authenticated `gh`, scans files under your configured roots, and reaches
GitHub. Alert/repository data stays in memory; GitHub links open in your
system browser. No project code is executed.

```sh
git clone https://github.com/damianpoole/herdr-app-dependabot.git
cd herdr-app-dependabot
npm ci --ignore-scripts
npm run build
herdr-app status  # find your personal layout name
node scripts/install.mjs --layout YOUR_PERSONAL_LAYOUT
```

If you use a shipped layout, first make a personal copy:

```sh
herdr-app do layout.clone '{"name":"main","as":"my-dashboard"}'
node scripts/install.mjs --layout my-dashboard
```

Alternatively `--layout my-dashboard --from main` creates a new personal
layout without switching to it. Use `herdr-app do layout.switch --name
my-dashboard` to show it. `--home PATH` or `HERDR_APP_HOME` selects another
app home.

The installer adds a **Dependabot** button in the sidebar footer, **below
Settings and above Tasks**. It opens a full native dashboard tab, reusing an
existing Dependabot tab like the Tasks launcher. No toolbar strip or side panel.
The known Tasks footer (or standard Settings footer) is replaced in the layout
by this mod's footer; the original mod files remain untouched. Settings, Tasks,
Add machine, the update indicator and collapsed-sidebar behavior are retained.
Other custom footers are refused rather than overwritten. Old Dependabot
strip/panel blocks are migrated away. No keybindings are installed.

Keep this checkout and its Node executable in place: the installed config
pins their absolute paths. Rebuild and rerun the installer after updates
or moving the checkout. Repeated installation does not duplicate blocks.
Unmanaged mod folders and shipped layouts are refused. Layout edits have
unique `.before-dependabot-*` backups.

## Choose repositories

By default the backend recursively scans `~/git`. To change roots, create
`~/.config/herdr-app-dependabot/config.json`:

```json
{ "roots": ["~/git", "~/work"] }
```

Use `DEPENDABOT_CONFIG=/path/to/config.json` for another config file (the
app must inherit that environment), or the sidebar footer block's
`content.props.roots` array to override roots for newly opened dashboard tabs. Invalid config
is an error, not a fallback to another scan. Changes apply on **Refresh**.

Discovery reads configured Git remotes, not just `origin`. Multiple clones,
remotes, and worktrees pointing at the same owner/repository share one entry.
Only github.com HTTPS, SSH/SCP and git URLs are recognized; GitHub Enterprise,
SSH host aliases, bare repositories, directory symlinks and hidden child
directories are not supported. A root itself may be a checkout or a hidden
directory. Common dependency/build/cache directories are skipped. Repositories
need not be personally owned; available alerts depend on your existing access.

Limits are explicit: depth 4, 10,000 directories, 22-second discovery deadline,
100 repositories per refresh, two concurrent requests, 100 pages (100 alerts
per page) per repository and a 22-second per-repository deadline. Narrow roots
if limits are reached. Discovery reports incomplete scans; incomplete API
pagination never produces a partial count presented as complete.

## Use

- Load happens when the dashboard tab first appears; **Refresh** rescans and fetches.
  No background polling or daemon.
- Search repository names, packages, manifests, ecosystems, GHSA IDs, CVEs,
  and advisory summaries. Select a severity or toggle alerts/unavailable only.
- Click a repository, then an alert for description, vulnerable range, manifest,
  scope, and first patched version. GitHub buttons open the authoritative page.
- Counts summarize successfully fetched repositories, not unavailable ones.
  Missing permissions/disabled alerts (403/404), auth, connectivity, rate limits,
  and timeouts are explicit errors, **never zero alerts**.
- Previous successful results survive a failed refresh, labeled stale.
  Results also become stale after 10 minutes. Hidden tabs keep their
  in-memory results; switching layouts/restarting does not persist them.

Optional app commands for existing shown copies: `dependabot.refresh`,
`dependabot.open`, `dependabot.issues`, `dependabot.next-repo`,
`dependabot.next-alert`. These do not install global shortcuts.

### Troubleshooting

Run `gh auth status` and test permissions with:

```sh
gh api --hostname github.com /repos/OWNER/REPO/dependabot/alerts?state=open
```

Do not paste private alert output into public issues. Rate-limit/auth failures
stop new queued requests in that refresh; already running requests may finish.
Retry manually once credentials or rate limits recover. API data may change
during pagination; GitHub does not provide an atomic alert snapshot.

The native host limits exec to 30s / 8 MiB; backend limits are lower. Large
repositories exceeding time/output/page limits are unavailable, not clean.
Linux is locally verified. macOS/Windows live UI behavior is unverified.

## Remove

Close Dependabot tabs, restore the sidebar-footer block to its previous content
(`obsidian-tasks-footer`, height 97px, for a Tasks setup; or `workspace-chrome`
with props `{ "footer": true }`, height 69px, for the standard footer), then
delete `mods/dependabot` in your app home. No daemon to stop. Restore a layout
backup only if you have made no later layout edits you want to keep. Optional
scan config can be deleted separately.

## Development / verification

```sh
npm ci --ignore-scripts
npm test
npm run check
npm run lint
npm run fmt:check
herdr-app check mods/dependabot
```

Tests use fictional fixtures/temp Git repositories, no live GitHub writes,
credentials, model providers or desktop automation. CI runs build/tests/types,
lint and formatting. Native check and live visual smoke require herdr-app.
See [architecture](docs/architecture.md) and [recipe](RECIPE.md).

For backend diagnostics (output may contain private data/local paths):
`node dist/cli.js discover --root ~/git`,
`node dist/cli.js alerts owner/repo`.
