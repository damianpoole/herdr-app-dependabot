import { execFile } from "node:child_process";
import { readdir, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import { homedir } from "node:os";

export type Runner = (
  command: string,
  args: string[],
  options?: { cwd?: string; timeout?: number },
) => Promise<string>;
export const run: Runner = (command, args, options = {}) =>
  new Promise((yes, no) => {
    execFile(
      command,
      args,
      {
        ...options,
        timeout: options.timeout ?? 12000,
        maxBuffer: 6 * 1024 * 1024,
        env: { ...process.env, GH_PROMPT_DISABLED: "1", GH_PAGER: "cat", GIT_TERMINAL_PROMPT: "0" },
      },
      (error, stdout, stderr) => (error ? no(new Error(stderr || error.message)) : yes(stdout)),
    );
  });
export function repository(remote: string): string | null {
  const text = remote.trim();
  let path: string;
  const scp = /^(?:git@)?github\.com:([^?#]+)$/i.exec(text);
  if (scp) path = scp[1];
  else {
    try {
      const url = new URL(text);
      if (
        !["https:", "ssh:", "git:"].includes(url.protocol) ||
        url.hostname.toLowerCase() !== "github.com" ||
        url.search ||
        url.hash
      )
        return null;
      path = url.pathname.replace(/^\//, "");
    } catch {
      return null;
    }
  }
  path = path.replace(/\/$/, "").replace(/\.git$/i, "");
  const parts = path.split("/");
  if (
    parts.length !== 2 ||
    !/^[a-z\d](?:[a-z\d-]*[a-z\d])?$/i.test(parts[0]) ||
    !/^[a-z\d_.-]+$/i.test(parts[1]) ||
    [".", ".."].includes(parts[1])
  )
    return null;
  return path.toLowerCase();
}
export interface LocalRepo {
  repository: string;
  paths: string[];
}
export interface Discovery {
  version: 1;
  repositories: LocalRepo[];
  warnings: string[];
  scanned: number;
}
export async function discover(
  roots = [join(homedir(), "git")],
  options: {
    runner?: Runner;
    maxDepth?: number;
    maxDirectories?: number;
    deadlineMs?: number;
  } = {},
): Promise<Discovery> {
  const runner = options.runner ?? run;
  const deadline = Date.now() + (options.deadlineMs ?? 22000);
  const limit = options.maxDirectories ?? 10000;
  const result: Discovery = { version: 1, repositories: [], warnings: [], scanned: 0 };
  const repos = new Map<string, Set<string>>(),
    visited = new Map<string, number>();
  const skipped = new Set([
    ".git",
    "node_modules",
    "vendor",
    "dist",
    "build",
    ".cache",
    ".pi",
    ".venv",
    "target",
  ]);
  let bounded = false,
    visits = 0;
  const warn = (message: string) => {
    if (!result.warnings.includes(message) && result.warnings.length < 30)
      result.warnings.push(message);
  };
  async function visit(path: string, depth: number): Promise<void> {
    if (Date.now() >= deadline || visits >= limit) {
      bounded = true;
      return;
    }
    let actual: string;
    try {
      actual = await realpath(path);
    } catch {
      warn("Cannot read a configured root or directory.");
      return;
    }
    if ((visited.get(actual) ?? Infinity) <= depth) return;
    const seenBefore = visited.has(actual);
    visited.set(actual, depth);
    visits++;
    if (!seenBefore) result.scanned++;
    let entries;
    try {
      entries = await readdir(actual, { withFileTypes: true });
    } catch {
      warn("A scan directory is inaccessible.");
      return;
    }
    if (!seenBefore && entries.some((e) => e.name === ".git")) {
      try {
        const urls = await runner("git", ["config", "--get-regexp", "^remote\\..*\\.url$"], {
          cwd: actual,
          timeout: Math.max(1, Math.min(2000, deadline - Date.now())),
        });
        for (const line of urls.split("\n")) {
          const repo = repository(line.replace(/^\S+\s+/, ""));
          if (repo) {
            const paths = repos.get(repo) ?? new Set<string>();
            paths.add(actual);
            repos.set(repo, paths);
          }
        }
      } catch {
        warn("A checkout has no readable Git remotes; it was skipped.");
      }
    }
    const children = entries.filter(
      (e) => e.isDirectory() && !skipped.has(e.name) && !e.name.startsWith("."),
    );
    if (depth >= (options.maxDepth ?? 4)) {
      if (children.length) warn("Scan depth limit reached; nested checkouts may be omitted.");
      return;
    }
    for (const entry of children) {
      await visit(join(actual, entry.name), depth + 1);
      if (bounded) break;
    }
  }
  for (const root of roots) {
    const expanded =
      root === "~"
        ? homedir()
        : root.startsWith("~/")
          ? join(homedir(), root.slice(2))
          : resolve(root);
    await visit(expanded, 0);
    if (bounded) break;
  }
  if (bounded)
    warn("Scan time/directory limit reached; results are incomplete. Narrow the configured roots.");
  result.repositories = [...repos]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([repository, paths]) => ({ repository, paths: [...paths].sort() }));
  return result;
}
export type Severity = "critical" | "high" | "medium" | "low" | "unknown";
export interface Alert {
  number: number;
  severity: Severity;
  summary: string;
  description: string;
  package: string;
  ecosystem: string;
  manifest: string;
  scope: string;
  vulnerableRange: string;
  patched: string;
  ghsa: string;
  cve: string;
  url: string;
}
export interface AlertResult {
  version: 1;
  repository: string;
  status: "ok" | "unavailable";
  alerts: Alert[];
  counts: Record<Severity, number> | null;
  fetchedAt: string;
  error?: string;
}
export const emptyCounts = (): Record<Severity, number> => ({
  critical: 0,
  high: 0,
  medium: 0,
  low: 0,
  unknown: 0,
});
function errorMessage(error: unknown): string {
  const message = String(error);
  if (/rate limit|secondary rate|abuse/i.test(message))
    return "GitHub rate limit reached. Wait before refreshing.";
  if (/401|authentication|auth login|GH_TOKEN|credentials/i.test(message))
    return "GitHub authentication failed. Run gh auth login and check permissions.";
  if (/403|404|disabled|not enabled|not found|resource not accessible/i.test(message))
    return "Alerts disabled, inaccessible, or insufficient GitHub permissions (403/404).";
  if (/timed|timeout|killed|SIGTERM/i.test(message))
    return "Request timed out; previous results may be stale.";
  return "GitHub request failed. Check gh installation, connectivity, and permissions.";
}
function string(value: unknown): string {
  return typeof value === "string" ? value.slice(0, 16000) : "";
}
export function normalizeAlert(value: unknown, repo: string): Alert {
  if (!value || typeof value !== "object") throw new Error("Malformed alert response");
  const a = value as Record<string, any>;
  if (!Number.isSafeInteger(a.number) || a.number < 1 || a.state !== "open")
    throw new Error("Malformed open alert response");
  const v = a.security_vulnerability ?? {},
    advisory = a.security_advisory ?? {},
    dependency = a.dependency ?? {};
  const severity = ["critical", "high", "medium", "low"].includes(v.severity ?? advisory.severity)
    ? (v.severity ?? advisory.severity)
    : "unknown";
  return {
    number: a.number,
    severity,
    summary: string(advisory.summary),
    description: string(advisory.description),
    package: string(dependency.package?.name ?? v.package?.name),
    ecosystem: string(dependency.package?.ecosystem ?? v.package?.ecosystem),
    manifest: string(dependency.manifest_path),
    scope: string(dependency.scope),
    vulnerableRange: string(v.vulnerable_version_range),
    patched: string(v.first_patched_version?.identifier),
    ghsa: string(advisory.ghsa_id),
    cve: string(advisory.cve_id),
    url: `https://github.com/${repo}/security/dependabot/${a.number}`,
  };
}
export async function alerts(
  repo: string,
  options: { runner?: Runner; deadlineMs?: number; maxPages?: number } = {},
): Promise<AlertResult> {
  if (repository("https://github.com/" + repo) !== repo)
    throw new Error("Expected canonical github.com owner/repo");
  const runner = options.runner ?? run,
    deadline = Date.now() + (options.deadlineMs ?? 22000);
  const base = { version: 1 as const, repository: repo, fetchedAt: new Date().toISOString() };
  try {
    const all: Alert[] = [],
      seen = new Set<number>();
    const route = `/repos/${repo}/dependabot/alerts`;
    let endpoint = `${route}?state=open&per_page=100`;
    const endpoints = new Set<string>();
    for (let page = 1; page <= (options.maxPages ?? 100); page++) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error("timeout");
      const raw = await runner(
        "gh",
        [
          "api",
          "--include",
          "--hostname",
          "github.com",
          "--method",
          "GET",
          "-H",
          "Accept: application/vnd.github+json",
          "-H",
          "X-GitHub-Api-Version: 2022-11-28",
          endpoint,
        ],
        { timeout: Math.min(12000, remaining) },
      );
      const boundary = /\r?\n\r?\n/.exec(raw);
      if (!boundary || !raw.startsWith("HTTP/")) throw new Error("Malformed HTTP response");
      const headers = raw.slice(0, boundary.index);
      const data: unknown = JSON.parse(raw.slice(boundary.index + boundary[0].length));
      const link = /^link:\s*(.+)$/im.exec(headers)?.[1];
      const next = link && /<([^>]+)>;\s*rel="next"/.exec(link)?.[1];
      if (link && /rel="next"/.test(link) && !next) throw new Error("Malformed pagination link");
      if (!Array.isArray(data)) throw new Error("Malformed response");
      for (const row of data) {
        const alert = normalizeAlert(row, repo);
        if (!seen.has(alert.number)) {
          seen.add(alert.number);
          all.push(alert);
        }
      }
      if (!next) {
        const counts = emptyCounts();
        for (const alert of all) counts[alert.severity]++;
        return { ...base, status: "ok", alerts: all, counts };
      }
      const url = new URL(next);
      if (
        url.protocol !== "https:" ||
        url.host !== "api.github.com" ||
        url.pathname !== route ||
        url.username ||
        url.password ||
        url.hash ||
        !url.searchParams.get("after") ||
        url.searchParams.get("state") !== "open" ||
        url.searchParams.get("per_page") !== "100"
      )
        throw new Error("Invalid pagination link");
      endpoint = url.pathname + url.search;
      if (endpoints.has(endpoint)) throw new Error("Invalid repeated pagination link");
      endpoints.add(endpoint);
    }
    throw new Error("Pagination limit reached");
  } catch (error) {
    return {
      ...base,
      status: "unavailable",
      alerts: [],
      counts: null,
      error: /Pagination limit/.test(String(error))
        ? "Pagination limit reached; no partial count shown."
        : errorMessage(error),
    };
  }
}
