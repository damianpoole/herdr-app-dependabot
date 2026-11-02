# Architecture

The native UI is a GPUI JavaScript View using the installed `herdr`,
`gpui-kit` and `gpui-base` APIs. It is not a web view or React app.

- **Launcher:** a sidebar footer with Settings, Dependabot, Tasks (when already
  installed), and Add machine. Dependabot opens a full native mod tab, or focuses
  an existing dashboard tab. Original footer mods remain untouched. The footer
  performs no GitHub calls; old strip/panel blocks are removed during migration.
- **Dashboard:** a full-tab View owns transient in-memory results. Initial load
  and manual refresh discover local repositories, then run two API workers.
  Successful results remain visible, explicitly stale, after a failed refresh.
  No daemon, token store, persistent alert cache, or paid provider is involved.
- **Backend:** Node 22+, compiled from TypeScript. Each invocation performs
  discovery or retrieves all open alerts for one repository. The native exec
  API has a 30s limit; backend work has a 22s deadline and per-command timeouts.
  GitHub requests use `gh api --hostname github.com --method GET`.
- **Discovery:** recursive configurable roots (default `~/git`), at most
  four levels below each root / 10,000 directories / 22 seconds. Recognizes
  both directory and file `.git` entries, reads all configured remote URLs,
  canonicalizes GitHub owner/name, deduplicates roots/remotes/worktrees, and
  never modifies or runs project code. Directory symlinks are not traversed.
  Limits and unreadable directories produce warnings.
- **API bounds:** 100 repositories per refresh, two concurrent workers,
  100 pages per repo, 100 alerts per page. Authentication and rate-limit
  errors stop new network work. Partial pagination is unavailable, not zero.
- **Installation:** owned mod receipt, generated absolute backend/Node paths,
  native check before layout write, unique personal-layout backup, concurrent
  edit checks, and idempotent pure layout transformation. Only known Settings/
  Tasks footers are replaced; unknown custom footers are refused. Shipped layouts and
  unrelated nodes/selections remain untouched.

Tests inject command runners and a small native element/host adapter. This
checks presentation and interactions without needing GitHub credentials or a
GPU; it complements, but cannot replace, native check and a live visual smoke.
