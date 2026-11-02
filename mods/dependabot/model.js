// Pure presentation/state helpers, also exercised by fixture tests.
export const severities = ["critical", "high", "medium", "low", "unknown"];
export function mergeResult(previous, next) {
  return next.status === "unavailable" && previous?.counts
    ? {
        ...next,
        alerts: previous.alerts,
        counts: previous.counts,
        fetchedAt: previous.fetchedAt,
        stale: true,
      }
    : { ...next, stale: false };
}
export function matches(alert, query, severity = "all") {
  return (
    (severity === "all" || alert.severity === severity) &&
    (!query ||
      [alert.package, alert.summary, alert.ghsa, alert.cve, alert.manifest, alert.ecosystem]
        .join(" ")
        .toLowerCase()
        .includes(query.toLowerCase()))
  );
}
export function visibleAlerts(row, query = "", severity = "all") {
  const repoMatches = row.repository.toLowerCase().includes(query.toLowerCase());
  return (row.alerts ?? [])
    .filter((a) => matches(a, repoMatches ? "" : query, severity))
    .sort(
      (a, b) =>
        severities.indexOf(a.severity) - severities.indexOf(b.severity) || a.number - b.number,
    );
}
export function visibleRows(rows, query = "", severity = "all", onlyIssues = false) {
  return rows.filter(
    (row) =>
      (!onlyIssues || row.status !== "ok" || row.alerts?.length) &&
      ((severity === "all" && row.repository.toLowerCase().includes(query.toLowerCase())) ||
        visibleAlerts(row, query, severity).length > 0),
  );
}
export function total(row) {
  return row.counts ? Object.values(row.counts).reduce((a, b) => a + b, 0) : null;
}
export function age(row, now = Date.now()) {
  if (!row.fetchedAt) return "Not fetched";
  const minutes = Math.max(0, Math.floor((now - Date.parse(row.fetchedAt)) / 60000));
  return `${row.stale || minutes >= 10 ? "Stale · " : ""}${minutes < 1 ? "just now" : minutes + "m ago"}`;
}
export function findBlock(node, id) {
  if (!node || typeof node !== "object") return null;
  if (node.id === id) return node;
  for (const child of node.children ?? []) {
    const found = findBlock(child, id);
    if (found) return found;
  }
  return null;
}
