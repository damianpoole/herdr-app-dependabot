import test from "node:test";
import assert from "node:assert/strict";
import {
  severities,
  mergeResult,
  matches,
  visibleAlerts,
  visibleRows,
  total,
  age,
  findBlock,
} from "../mods/dependabot/model.js";
import { call, fetchRows } from "../mods/dependabot/client.js";

const counts = (high = 0) => ({ critical: 0, high, medium: 0, low: 0, unknown: 0 });
const alert = (number, severity = "high", extra = {}) => ({
  number,
  severity,
  package: "lodash",
  summary: "Prototype pollution",
  ghsa: "GHSA-abcd-1234",
  cve: "CVE-2026-1234",
  manifest: "web/package-lock.json",
  ecosystem: "npm",
  ...extra,
});
const row = (repository = "org/project", alerts = [], extra = {}) => ({
  version: 1,
  repository,
  status: "ok",
  alerts,
  counts: counts(alerts.length),
  fetchedAt: "2026-01-01T12:00:00.000Z",
  ...extra,
});
const failure = (repository = "org/project", error = "Unavailable") =>
  row(repository, [], { status: "unavailable", counts: null, error });
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};

test("search covers repository and all advertised alert fields, case-insensitively with severity intersection", () => {
  const value = alert(1);
  for (const query of ["LODASH", "prototype", "ghsa-ABCD", "cve-2026", "WEB/package", "NPM", ""])
    assert.equal(matches(value, query), true, query);
  assert.equal(matches(value, "missing"), false);
  assert.equal(matches(value, "lodash", "low"), false);
  assert.equal(matches(value, "lodash", "high"), true);
  const r = row("Owner/Interesting", [value, alert(2, "unknown")]);
  assert.equal(visibleAlerts(r, "OWNER").length, 2);
  assert.deepEqual(
    visibleAlerts(r, "interesting", "unknown").map((a) => a.number),
    [2],
  );
  assert.deepEqual(
    visibleAlerts(r, "lodash", "high").map((a) => a.number),
    [1],
  );
  assert.deepEqual(visibleAlerts(r, "missing"), []);
});

test("alert sorting follows critical-to-unknown then number and never mutates source", () => {
  assert.deepEqual(severities, ["critical", "high", "medium", "low", "unknown"]);
  const input = [
    alert(7, "unknown"),
    alert(4, "high"),
    alert(2, "low"),
    alert(6, "critical"),
    alert(3, "medium"),
    alert(1, "high"),
  ];
  const r = row("o/r", input);
  const snapshot = structuredClone(r);
  assert.deepEqual(
    visibleAlerts(r).map((a) => a.number),
    [6, 1, 4, 3, 2, 7],
  );
  assert.deepEqual(r, snapshot);
  assert.deepEqual(visibleAlerts({ repository: "o/r" }), []);
});

test("issues-only distinguishes inaccessible/unavailable from genuine zero; filters compose", () => {
  const clean = row("org/clean"),
    issue = row("org/issue", [alert(1)]),
    unknown = failure("org/private");
  const rows = [clean, issue, unknown];
  assert.deepEqual(visibleRows(rows), rows);
  assert.deepEqual(visibleRows(rows, "", "all", true), [issue, unknown]);
  assert.deepEqual(visibleRows(rows, "ORG/CLEAN"), [clean]);
  assert.deepEqual(visibleRows(rows, "org/clean", "all", true), []);
  assert.deepEqual(visibleRows(rows, "lodash", "high", true), [issue]);
  assert.deepEqual(visibleRows(rows, "", "low", true), []);
  assert.equal(total(clean), 0);
  assert.equal(total(issue), 1);
  assert.equal(total(unknown), null);
});

test("unavailable refresh retains previous alerts, counts and timestamp explicitly stale", () => {
  const previous = row("o/r", [alert(1)]),
    next = failure("o/r", "GitHub rate limit reached");
  const snapshot = structuredClone({ previous, next });
  const stale = mergeResult(previous, next);
  assert.equal(stale.status, "unavailable");
  assert.equal(stale.error, next.error);
  assert.equal(stale.stale, true);
  assert.deepEqual(stale.alerts, previous.alerts);
  assert.deepEqual(stale.counts, previous.counts);
  assert.equal(stale.fetchedAt, previous.fetchedAt);
  assert.equal(total(stale), 1);
  assert.deepEqual({ previous, next }, snapshot);
  const again = mergeResult(stale, failure("o/r", "timeout"));
  assert.equal(again.stale, true);
  assert.equal(again.fetchedAt, previous.fetchedAt);
  const recovered = mergeResult(again, row("o/r"));
  assert.equal(recovered.stale, false);
  assert.equal(total(recovered), 0);
  assert.deepEqual(recovered.alerts, []);
  const neverFetched = mergeResult(null, next);
  assert.equal(neverFetched.stale, false);
  assert.equal(total(neverFetched), null);
  assert.equal(
    mergeResult(row("o/r"), next).stale,
    true,
    "previous zero is still a successful snapshot",
  );
});

test("age uses injected time, including exact stale threshold and clock skew", () => {
  const now = Date.parse("2026-01-01T12:10:00Z");
  assert.equal(age({}, now), "Not fetched");
  assert.equal(age(row(), now), "Stale · 10m ago");
  assert.equal(age(row("o/r", [], { fetchedAt: "2026-01-01T12:01:00Z" }), now), "9m ago");
  assert.equal(age(row("o/r", [], { fetchedAt: "2026-01-01T12:09:59Z" }), now), "just now");
  assert.equal(age(row("o/r", [], { fetchedAt: "2026-01-01T12:11:00Z" }), now), "just now");
  assert.equal(age(row("o/r", [], { stale: true }), now), "Stale · 10m ago");
});

test("findBlock returns nested panel without mutating the tree or crashing on absent blocks", () => {
  const panel = { id: "dependabot-panel", type: "block" };
  const tree = { id: "root", children: [{ id: "panel-body", children: [panel] }] };
  assert.equal(findBlock(tree, "dependabot-panel"), panel);
  assert.equal(findBlock(tree, "root"), tree);
  assert.equal(findBlock(tree, "missing"), null);
  assert.equal(findBlock(null, "missing"), null);
});

test("client invocation passes arguments separately, validates versions, command failures and response shapes", async () => {
  const config = { command: "/path with spaces/node", args: ["/backend ' quoted/cli.js"] };
  const snapshot = structuredClone(config);
  const args = ["alerts", "org/project"];
  let invocation;
  const result = await call(
    async (...values) => {
      invocation = values;
      return { code: 0, stdout: JSON.stringify(row()), stderr: "" };
    },
    config,
    args,
  );
  assert.deepEqual(invocation, [config.command, [...config.args, ...args]]);
  assert.deepEqual(config, snapshot);
  assert.deepEqual(args, ["alerts", "org/project"]);
  assert.equal(result.repository, "org/project");
  const discovery = { version: 1, repositories: [], warnings: [], scanned: 0 };
  assert.deepEqual(
    await call(async () => ({ code: 0, stdout: JSON.stringify(discovery) }), config, ["discover"]),
    discovery,
  );
  for (const badConfig of [
    {},
    { command: 1, args: [] },
    { command: "node", args: "cli" },
    { command: "node", args: [42] },
  ])
    await assert.rejects(
      call(async () => assert.fail("invalid config executed"), badConfig, args),
      /Invalid backend configuration/,
    );
  await assert.rejects(
    call(async () => ({ code: 1, stderr: "  permission denied \n" }), config, args),
    /permission denied/,
  );
  await assert.rejects(
    call(async () => ({ code: 127, stderr: "" }), config, args),
    /Backend failed/,
  );
  await assert.rejects(
    call(
      async () => {
        throw new Error("exec timed out");
      },
      config,
      args,
    ),
    /timed out/,
  );
  for (const response of [
    "broken JSON",
    "null",
    "[]",
    '{"version":2,"status":"ok","alerts":[]}',
    '{"version":1,"status":"pending","alerts":[]}',
    '{"version":1,"status":"ok","alerts":{}}',
  ])
    await assert.rejects(call(async () => ({ code: 0, stdout: response }), config, args));
  await assert.rejects(
    call(async () => ({ code: 0, stdout: '{"version":1,"repositories":{}}' }), config, [
      "discover",
    ]),
    /version mismatch/,
  );
});

test("client rejects empty command before executing an invalid invocation", async () => {
  let executed = false;
  await assert.rejects(
    call(
      async () => {
        executed = true;
        return { code: 0, stdout: JSON.stringify(row()) };
      },
      { command: "", args: [] },
      ["alerts", "org/project"],
    ),
  );
  assert.equal(executed, false);
});

test("client rejects successful-looking malformed counts instead of allowing false zero/unavailable display", async () => {
  for (const value of [
    row("o/r", [alert(1)], { counts: null }),
    row("o/r", [], { counts: { high: "zero" } }),
  ]) {
    await assert.rejects(
      call(
        async () => ({ code: 0, stdout: JSON.stringify(value) }),
        { command: "node", args: ["cli.js"] },
        ["alerts", "o/r"],
      ),
    );
  }
});

test("fetchRows runs at most two requests concurrently and receives each original row once", async () => {
  const rows = Array.from({ length: 5 }, (_, i) => row(`o/r${i}`));
  const pending = [],
    received = [],
    notices = Array.from({ length: rows.length }, deferred);
  let active = 0,
    maximum = 0;
  const finished = fetchRows(
    rows,
    async (repository) => {
      active++;
      maximum = Math.max(maximum, active);
      const gate = deferred();
      pending.push({ repository, gate });
      try {
        return await gate.promise;
      } finally {
        active--;
      }
    },
    (original, next) => {
      received.push({ original, next });
      notices[received.length - 1].resolve();
    },
  );
  assert.equal(pending.length, 2);
  assert.equal(active, 2);
  // Release the second request first: callback association must not depend on order.
  pending[1].gate.resolve(row(pending[1].repository));
  await notices[0].promise;
  assert.equal(pending.length, 3);
  pending[0].gate.resolve(row(pending[0].repository));
  await notices[1].promise;
  pending[2].gate.resolve(row(pending[2].repository));
  await notices[2].promise;
  pending[3].gate.resolve(row(pending[3].repository));
  await notices[3].promise;
  pending[4].gate.resolve(row(pending[4].repository));
  await finished;
  assert.equal(maximum, 2);
  assert.equal(active, 0);
  assert.equal(received.length, rows.length);
  assert.equal(new Set(received.map((r) => r.original)).size, rows.length);
  for (const pair of received) assert.equal(pair.original.repository, pair.next.repository);
});

test("fetchRows hard cap makes excess repositories explicitly unavailable, not false zero", async () => {
  const rows = Array.from({ length: 105 }, (_, i) => row(`o/r${i}`));
  const calls = [],
    received = new Map();
  await fetchRows(
    rows,
    async (repository) => {
      calls.push(repository);
      return row(repository);
    },
    (original, next) => received.set(original.repository, next),
  );
  assert.equal(calls.length, 100);
  assert.deepEqual(
    calls,
    rows.slice(0, 100).map((r) => r.repository),
  );
  assert.equal(received.size, 105);
  for (const original of rows.slice(100)) {
    const next = received.get(original.repository);
    assert.equal(next.status, "unavailable");
    assert.equal(next.counts, null);
    assert.match(next.error, /request limit reached/);
  }
  const capped = [];
  await fetchRows(
    rows.slice(0, 5),
    async (repository) => {
      capped.push(repository);
      return row(repository);
    },
    () => {},
    3,
  );
  assert.equal(capped.length, 3);
  await fetchRows(
    [],
    async () => assert.fail("empty queue fetched"),
    () => assert.fail("empty queue received"),
  );
});

for (const message of [
  "GitHub rate limit reached. Wait before refreshing.",
  "GitHub authentication failed. Run gh auth login.",
]) {
  test(`fetchRows stops new requests on ${message} but settles in-flight work`, async () => {
    const rows = Array.from({ length: 8 }, (_, i) => row(`o/r${i}`));
    const pending = [],
      received = new Map(),
      stopped = deferred();
    const done = fetchRows(
      rows,
      (repository) => {
        const gate = deferred();
        pending.push({ repository, gate });
        return gate.promise;
      },
      (original, next) => {
        received.set(original.repository, next);
        if (received.size === 7) stopped.resolve();
      },
    );
    assert.equal(pending.length, 2);
    pending[0].gate.resolve(failure(pending[0].repository, message));
    await stopped.promise;
    assert.equal(pending.length, 2, "queued repositories must not start after stop signal");
    for (const original of rows.slice(2)) {
      const next = received.get(original.repository);
      assert.equal(next.status, "unavailable");
      assert.equal(next.counts, null);
      assert.equal(next.error, message);
    }
    pending[1].gate.resolve(row(pending[1].repository));
    await done;
    assert.equal(received.size, 8);
    assert.equal(received.get(rows[1].repository).status, "ok");
  });
}

test("individual exceptions and permission failures do not stop other repositories", async () => {
  const rows = Array.from({ length: 5 }, (_, i) => row(`o/r${i}`));
  const calls = [],
    results = new Map();
  await fetchRows(
    rows,
    async (repository) => {
      calls.push(repository);
      if (repository === rows[0].repository) throw new Error("timeout");
      if (repository === rows[1].repository)
        return failure(repository, "Alerts disabled or inaccessible (403/404).");
      return row(repository);
    },
    (original, next) => results.set(original.repository, next),
  );
  assert.equal(calls.length, 5);
  assert.equal(results.get(rows[0].repository).counts, null);
  assert.match(results.get(rows[0].repository).error, /failed or timed out/);
  assert.equal(results.get(rows[1].repository).status, "unavailable");
  assert.equal(results.get(rows[4].repository).status, "ok");
});
