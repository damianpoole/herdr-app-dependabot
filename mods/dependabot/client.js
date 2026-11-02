export async function call(exec, config, args) {
  if (
    typeof config.command !== "string" ||
    !config.command.trim() ||
    !Array.isArray(config.args) ||
    config.args.some((a) => typeof a !== "string")
  )
    throw new Error("Invalid backend configuration; rerun installer.");
  const result = await exec(config.command, [...config.args, ...args]);
  if (result.code !== 0)
    throw new Error(result.stderr.trim() || "Backend failed; check Node/Git/gh installation.");
  const data = JSON.parse(result.stdout);
  const severities = ["critical", "high", "medium", "low", "unknown"];
  const validCounts =
    data?.counts &&
    severities.every((s) => Number.isSafeInteger(data.counts[s]) && data.counts[s] >= 0);
  if (
    !data ||
    data.version !== 1 ||
    (args[0] === "discover"
      ? !Array.isArray(data.repositories)
      : !["ok", "unavailable"].includes(data.status) ||
        !Array.isArray(data.alerts) ||
        (data.status === "ok" &&
          (!validCounts ||
            severities.some(
              (s) => data.counts[s] !== data.alerts.filter((a) => a.severity === s).length,
            ))))
  )
    throw new Error("Backend/mod version mismatch; reinstall.");
  return data;
}
export async function fetchRows(rows, fetchOne, receive, limit = 100) {
  let cursor = 0,
    stopped = "";
  const queued = rows.slice(0, limit);
  await Promise.all(
    [0, 1].map(async () => {
      for (;;) {
        const row = queued[cursor++];
        if (!row) return;
        let next;
        if (stopped)
          next = { ...row, status: "unavailable", alerts: [], counts: null, error: stopped };
        else {
          try {
            next = await fetchOne(row.repository);
          } catch {
            next = {
              ...row,
              status: "unavailable",
              alerts: [],
              counts: null,
              error: "Backend failed or timed out. Check Node/Git/gh and retry.",
            };
          }
          if (/rate limit|authentication failed/i.test(next.error ?? "")) stopped = next.error;
        }
        receive(row, next);
      }
    }),
  );
  for (const row of rows.slice(limit))
    receive(row, {
      ...row,
      status: "unavailable",
      alerts: [],
      counts: null,
      error: "Repository request limit reached (100). Narrow your configured roots.",
    });
}
