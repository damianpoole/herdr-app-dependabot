import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { repository, discover, alerts, normalizeAlert, emptyCounts } from "../dist/core.js";

const cli = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
const git = (cwd, ...args) =>
  execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_TERMINAL_PROMPT: "0",
    },
  });
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "dependabot backend ' "));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}
async function checkout(root, name, remote = "git@github.com:Org/Project.git") {
  const dir = join(root, name);
  await mkdir(dir, { recursive: true });
  git(dir, "init", "--quiet", "--initial-branch=fixture");
  git(dir, "remote", "add", "origin", remote);
  return dir;
}
const rawAlert = (number, severity = "high") => ({
  number,
  state: "open",
  security_advisory: {
    summary: "Fixture vulnerability",
    description: "Details",
    ghsa_id: "GHSA-test",
    cve_id: "CVE-2026-1",
  },
  security_vulnerability: {
    severity,
    vulnerable_version_range: "< 2",
    first_patched_version: { identifier: "2.0.0" },
  },
  dependency: {
    package: { name: "fixture-package", ecosystem: "npm" },
    manifest_path: "package-lock.json",
    scope: "runtime",
  },
});
const page = (start, count = 100) => Array.from({ length: count }, (_, i) => rawAlert(start + i));
const cursorUrl = (repo, cursor = "fixture-cursor") =>
  `https://api.github.com/repos/${repo}/dependabot/alerts?state=open&per_page=100&after=${cursor}`;
const httpBody = (body, link = "") =>
  `HTTP/2.0 200 OK\r\n${link ? `Link: ${link}\r\n` : ""}Content-Type: application/json\r\n\r\n${body}`;
const http = (data, next = "") =>
  httpBody(JSON.stringify(data), next ? `<${next}>; rel="next"` : "");
function unavailable(result) {
  assert.equal(result.status, "unavailable");
  assert.equal(result.counts, null, "unavailable is not zero alerts");
  assert.deepEqual(result.alerts, [], "never expose a partial page as complete");
  assert.ok(result.error);
}

test("GitHub remote parsing canonicalizes supported transports only", () => {
  for (const value of [
    "git@github.com:Org/Repo.git",
    "github.com:Org/Repo.git",
    "https://github.com/Org/Repo.git",
    "ssh://git@github.com/Org/Repo.git",
    "git://github.com/Org/Repo.git",
    " HTTPS://GITHUB.COM/Org/Repo/ \n",
  ])
    assert.equal(repository(value), "org/repo", value);
  for (const value of [
    "",
    "/tmp/checkout",
    "../repo",
    "git@gitlab.com:o/r",
    "https://github.com.evil/o/r",
    "https://evil/github.com/o/r",
    "https://github.com@evil/o/r",
    "https://api.github.com/o/r",
    "http://github.com/o/r",
    "file://github.com/o/r",
    "https://github.com/o",
    "https://github.com/o/r/extra",
    "git@github.com:o/r/x.git",
    "https://github.com/o/r?x=y",
    "https://github.com/o/r#anchor",
    "https://github.com/-owner/r",
    "https://github.com/owner-/r",
    "git@github.com:owner/..",
    "git@github.com:owner/.",
    "https://github.com/owner/re%2Fpo",
    "https://github.com/owner/re po",
  ])
    assert.equal(repository(value), null, value);
});

test("recursive real Git discovery handles worktree .git files, nested checkouts, roots/remotes deduplication and skips", async (t) => {
  const root = await fixture(t);
  const parent = await checkout(root, "group/parent");
  git(parent, "remote", "add", "upstream", "https://github.com/ORG/PROJECT.git");
  git(
    parent,
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.invalid",
    "commit",
    "--quiet",
    "--allow-empty",
    "-m",
    "fixture",
  );
  const worktree = join(root, "group/worktree");
  git(parent, "worktree", "add", "--quiet", "-b", "fixture-worktree", worktree);
  assert.match(await readFile(join(worktree, ".git"), "utf8"), /^gitdir:/);
  const nested = await checkout(parent, "nested", "https://github.com/Other/Nested.git");
  const second = await checkout(root, "second", "ssh://git@github.com/org/project.git");
  await checkout(root, "non-github", "https://gitlab.com/ignored/repo.git");
  for (const name of ["node_modules/hidden", ".hidden/checkout", "dist/hidden", "vendor/hidden"])
    await checkout(root, name, "https://github.com/ignored/excluded.git");
  const alias = join(root, "alias");
  await symlink(parent, alias, "dir");
  const result = await discover([root, parent, root, alias], { maxDepth: 6 });
  assert.equal(result.version, 1);
  assert.deepEqual(result.repositories, [
    { repository: "org/project", paths: [parent, second, worktree].sort() },
    { repository: "other/nested", paths: [nested] },
  ]);
  assert.deepEqual(result.warnings, []);
  assert.equal(
    (await discover([root, parent], { maxDepth: 6 })).scanned,
    result.scanned,
    "duplicate roots and aliases do not add visits beyond necessary shallower-root rescans",
  );
});

test("explicit nested configured roots extend depth independent of root order", async (t) => {
  const root = await fixture(t);
  const checkoutPath = await checkout(root, "a/b/checkout", "https://github.com/org/deep.git");
  const nestedRoot = join(root, "a");
  const expected = [{ repository: "org/deep", paths: [checkoutPath] }];
  const ancestorFirst = await discover([root, nestedRoot], { maxDepth: 2 });
  const nestedFirst = await discover([nestedRoot, root], { maxDepth: 2 });
  assert.deepEqual(ancestorFirst.repositories, expected);
  assert.deepEqual(nestedFirst.repositories, expected);
  assert.deepEqual(ancestorFirst.repositories, nestedFirst.repositories);
});

test("discovery bounds and missing roots are explicit, not silent empty scans", async (t) => {
  const root = await fixture(t);
  await checkout(root, "one/two/three");
  const depth = await discover([root], { maxDepth: 1 });
  assert.deepEqual(depth.repositories, []);
  assert.ok(depth.warnings.some((w) => /depth limit/i.test(w)));
  const bounded = await discover([root], { maxDirectories: 1 });
  assert.equal(bounded.scanned, 1);
  assert.ok(bounded.warnings.some((w) => /incomplete/i.test(w)));
  const expired = await discover([root], { deadlineMs: 0 });
  assert.equal(expired.scanned, 0);
  assert.ok(expired.warnings.some((w) => /time\/directory limit/i.test(w)));
  const missing = await discover([join(root, "missing"), root], { maxDepth: 4 });
  assert.equal(missing.repositories[0].repository, "org/project");
  assert.ok(missing.warnings.some((w) => /Cannot read/i.test(w)));
  const unreadable = await discover([root], {
    runner: async () => {
      throw new Error("git unavailable");
    },
  });
  assert.deepEqual(unreadable.repositories, []);
  assert.ok(unreadable.warnings.some((w) => /remotes/i.test(w)));
});

test("pagination over 100, deduplication, safe GET/host and full alert normalization", async () => {
  const calls = [];
  const pages = [page(1), [rawAlert(100), rawAlert(101, "critical"), rawAlert(102, "unexpected")]];
  const result = await alerts("org/project", {
    runner: async (command, args, options) => {
      calls.push({ command, args, options });
      return http(
        pages[calls.length - 1],
        calls.length === 1 ? cursorUrl("org/project", "opaque%2Bcursor") : "",
      );
    },
  });
  assert.equal(result.status, "ok");
  assert.equal(result.alerts.length, 102);
  assert.deepEqual(result.counts, { critical: 1, high: 100, medium: 0, low: 0, unknown: 1 });
  assert.ok(Number.isFinite(Date.parse(result.fetchedAt)));
  for (const [i, call] of calls.entries()) {
    assert.equal(call.command, "gh");
    assert.equal(call.args[0], "api");
    assert.ok(call.args.includes("--include"));
    assert.equal(call.args[call.args.indexOf("--hostname") + 1], "github.com");
    assert.equal(call.args[call.args.indexOf("--method") + 1], "GET");
    assert.ok(call.args.includes("Accept: application/vnd.github+json"));
    assert.ok(call.args.includes("X-GitHub-Api-Version: 2022-11-28"));
    const url = new URL(call.args.at(-1), "https://api.github.com");
    assert.equal(url.origin, "https://api.github.com");
    assert.equal(url.pathname, "/repos/org/project/dependabot/alerts");
    assert.equal(url.searchParams.get("state"), "open");
    assert.equal(url.searchParams.get("per_page"), "100");
    assert.equal(url.searchParams.has("page"), false, "Dependabot rejects numeric pagination");
    assert.equal(url.searchParams.get("after"), i === 0 ? null : "opaque+cursor");
    assert.ok(call.options.timeout > 0 && call.options.timeout <= 12000);
  }
  assert.deepEqual(result.alerts[0], {
    number: 1,
    severity: "high",
    summary: "Fixture vulnerability",
    description: "Details",
    package: "fixture-package",
    ecosystem: "npm",
    manifest: "package-lock.json",
    scope: "runtime",
    vulnerableRange: "< 2",
    patched: "2.0.0",
    ghsa: "GHSA-test",
    cve: "CVE-2026-1",
    url: "https://github.com/org/project/security/dependabot/1",
  });
});

test("Link cursor alone controls completion, even for short or exactly full pages", async () => {
  for (const count of [0, 1, 100]) {
    let calls = 0;
    const complete = await alerts("o/r", {
      maxPages: 1,
      runner: async () => {
        calls++;
        return http(page(1, count));
      },
    });
    assert.equal(complete.status, "ok");
    assert.equal(complete.alerts.length, count);
    assert.equal(calls, 1, "no next Link means no speculative extra request");
  }
  let calls = 0;
  const short = await alerts("o/r", {
    runner: async () => (++calls === 1 ? http(page(1, 1), cursorUrl("o/r")) : http(page(2, 1))),
  });
  assert.equal(short.status, "ok");
  assert.equal(short.alerts.length, 2, "a short page with next Link is not complete");
  assert.equal(calls, 2);
});

test("only rel=next is followed; other Link relations do not trigger requests", async () => {
  const calls = [];
  const result = await alerts("o/r", {
    runner: async (_command, args) => {
      calls.push(args.at(-1));
      return calls.length === 1
        ? httpBody(
            JSON.stringify(page(1, 1)),
            `<${cursorUrl("o/r", "previous")}>; rel="prev", <${cursorUrl("o/r", "next")}>; rel="next"`,
          )
        : httpBody(JSON.stringify(page(2, 1)), `<${cursorUrl("o/r", "previous")}>; rel="prev"`);
    },
  });
  assert.equal(result.status, "ok");
  assert.equal(calls.length, 2);
  assert.equal(new URL(calls[1], "https://api.github.com").searchParams.get("after"), "next");
});

test("malformed and off-host next links are rejected before requesting them, never exposing partial counts", async () => {
  for (const link of [
    '<https://evil.example/repos/o/r/dependabot/alerts?after=x>; rel="next"',
    '<https://api.github.com.evil.example/repos/o/r/dependabot/alerts?after=x>; rel="next"',
    '<https://api.github.com@evil.example/repos/o/r/dependabot/alerts?after=x>; rel="next"',
    '<http://api.github.com/repos/o/r/dependabot/alerts?after=x>; rel="next"',
    '<https://api.github.com/repos/other/repository/dependabot/alerts?after=x>; rel="next"',
    '<https://api.github.com/repos/o/r/issues?after=x>; rel="next"',
    '<not a URL>; rel="next"',
    'not-a-link; rel="next"',
    '<https://api.github.com/repos/o/r/dependabot/alerts?after=x; rel="next"',
  ]) {
    let calls = 0;
    const result = await alerts("o/r", {
      runner: async () => {
        calls++;
        assert.equal(calls, 1, `unsafe Link must not be requested: ${link}`);
        return httpBody(JSON.stringify(page(1, 1)), link);
      },
    });
    assert.equal(result.status, "unavailable", `malformed or unsafe Link: ${link}`);
    unavailable(result);
    assert.equal(calls, 1);
  }
});

test("repeated next cursor fails boundedly without exposing a partial result", async () => {
  let calls = 0;
  const result = await alerts("o/r", {
    runner: async () => {
      calls++;
      return http(page(calls, 1), cursorUrl("o/r", "same-cursor"));
    },
  });
  unavailable(result);
  assert.equal(calls, 2, "repeated cursor must stop before another request");
});

test("unknown/missing severity and null first patched version normalize safely", () => {
  for (const severity of ["critical", "high", "medium", "low", "unknown", "severe", null]) {
    const value = rawAlert(1, severity);
    value.security_vulnerability.first_patched_version = null;
    const result = normalizeAlert(value, "o/r");
    assert.equal(
      result.severity,
      ["critical", "high", "medium", "low"].includes(severity) ? severity : "unknown",
    );
    assert.equal(result.patched, "");
  }
  const value = rawAlert(1);
  delete value.security_vulnerability.severity;
  value.security_advisory.severity = "low";
  assert.equal(normalizeAlert(value, "o/r").severity, "low");
  const a = emptyCounts(),
    b = emptyCounts();
  a.high++;
  assert.equal(b.high, 0);
});

test("only a successfully completed empty response reports genuine zero", async () => {
  const result = await alerts("o/r", { runner: async () => http([]) });
  assert.equal(result.status, "ok");
  assert.deepEqual(result.counts, emptyCounts());
  assert.deepEqual(result.alerts, []);
});

test("malformed first/later pages, bad alerts and page bounds never report partial or zero counts", async () => {
  for (const response of [
    "not JSON",
    "null",
    "{}",
    '{"message":"error"}',
    "[null]",
    '[{"number":0,"state":"open"}]',
    '[{"number":1,"state":"dismissed"}]',
    '[{"number":1.5,"state":"open"}]',
    '[{"number":"1","state":"open"}]',
  ]) {
    unavailable(await alerts("o/r", { runner: async () => httpBody(response) }));
    let calls = 0;
    unavailable(
      await alerts("o/r", {
        runner: async () => (++calls === 1 ? http(page(1), cursorUrl("o/r")) : httpBody(response)),
      }),
    );
    assert.equal(calls, 2);
  }
  let calls = 0;
  const bounded = await alerts("o/r", {
    maxPages: 2,
    runner: async () => http(page(++calls * 100), cursorUrl("o/r", `cursor-${calls}`)),
  });
  unavailable(bounded);
  assert.equal(calls, 2);
  assert.match(bounded.error, /Pagination limit.*no partial count/);
});

test("auth, permissions, rate limits, network errors and timeouts discard partial pages", async () => {
  for (const [message, expected] of [
    ["HTTP 401 bad credentials", /authentication failed/],
    ["gh auth login required", /authentication failed/],
    ["HTTP 403", /403\/404/],
    ["HTTP 404 not found", /403\/404/],
    ["Dependabot disabled", /403\/404/],
    ["HTTP 403 API rate limit exceeded", /rate limit reached/],
    ["secondary rate limit", /rate limit reached/],
    ["ETIMEDOUT timeout", /timed out/],
    ["process killed SIGTERM", /timed out/],
    ["network disconnected", /request failed/],
  ]) {
    let calls = 0;
    const result = await alerts("o/r", {
      runner: async () => {
        if (++calls === 1) return http(page(1), cursorUrl("o/r"));
        throw new Error(message);
      },
    });
    unavailable(result);
    assert.match(result.error, expected);
    assert.equal(calls, 2);
  }
  const timed = await alerts("o/r", {
    deadlineMs: 0,
    runner: async () => {
      assert.fail("expired requests must not start");
    },
  });
  unavailable(timed);
  assert.match(timed.error, /timed out/);
});

test("invalid repository invocation never starts gh", async () => {
  for (const repo of [
    "Org/Repo",
    "o/r/extra",
    "../r",
    "o/r?state=closed",
    "https://evil/o/r",
    "o/r#fragment",
    "o/re%2Fpo",
    "--hostname=evil",
  ]) {
    await assert.rejects(
      alerts(repo, {
        runner: async () => {
          assert.fail("unsafe request");
        },
      }),
      /canonical/,
    );
  }
});

test("CLI uses explicit roots/config, reports invalid input, and stays offline", async (t) => {
  const root = await fixture(t);
  await checkout(root, "checkout");
  const config = join(root, "config.json");
  await writeFile(config, JSON.stringify({ roots: [root] }));
  const invoke = (args) =>
    spawnSync(process.execPath, [cli, ...args], {
      encoding: "utf8",
      env: { ...process.env, DEPENDABOT_CONFIG: config },
    });
  for (const args of [
    ["discover", "--root", root],
    ["discover", "--config", config],
    ["discover"],
  ]) {
    const result = invoke(args);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).repositories[0].repository, "org/project");
  }
  for (const roots of [[], [""], [42], "not-an-array"]) {
    await writeFile(config, JSON.stringify({ roots }));
    const result = invoke(["discover", "--config", config]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /roots/);
    assert.equal(result.stdout, "");
  }
  for (const args of [
    [],
    ["nonsense"],
    ["alerts"],
    ["alerts", "../unsafe"],
    ["discover", "--unknown"],
    ["discover", "--config", join(root, "missing")],
  ]) {
    const result = invoke(args);
    assert.notEqual(result.status, 0);
    assert.equal(result.stdout, "");
  }
  assert.equal(invoke(["--help"]).status, 0);
});
