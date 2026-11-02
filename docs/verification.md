# Verification

- Automated fixture suite: 44 tests pass. Build, TypeScript, lint and formatting
  checks pass without GitHub credentials or native-host dependencies.
- Native source and installed-mod checks pass.
- Live native verification: sidebar order Settings / Dependabot / Tasks /
  Add machine; full native dashboard tab; successful real read-only GitHub
  alert fetch; unavailable entries stay distinct from clean repositories;
  repository and advisory selection render actual alert details.
- Original Tasks mod files remain untouched; legacy strip/panel blocks are
  removed, and personal layout changes have backups.
- A native-environment failure was reproduced: a mise shim emitted a notice
  before gh HTTP headers. A regression test failed before the parser fix,
  then passed. Backend commands now suppress tool-manager notices and parsing
  tolerates a prefix before the HTTP status line. Live native fetching passed.
- Live screenshots and diagnostic output are not published because they can
  expose private repositories/alerts. Only fictional fixtures are committed.
- Linux is locally verified; macOS/Windows native UI behavior remains unverified.
