import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import * as model from "../mods/dependabot/model.js";
import * as client from "../mods/dependabot/client.js";

function node() {
  const data = { nodes: [], handlers: {}, attrs: {} };
  const proxy = new Proxy(data, {
    get(target, key) {
      if (key in target) return target[key];
      if (key === "child")
        return (child) => {
          if (child != null) target.nodes.push(child);
          return proxy;
        };
      if (key === "children")
        return (children) => {
          target.nodes.push(...children);
          return proxy;
        };
      if (key === "when")
        return (condition, fn) => {
          if (condition) fn(proxy);
          return proxy;
        };
      if (key === "on_click")
        return (fn) => {
          target.handlers.click = fn;
          return proxy;
        };
      return (...args) => {
        target.attrs[key] = args;
        return proxy;
      };
    },
  });
  return proxy;
}
function all(root) {
  return typeof root === "object" ? [root, ...root.nodes.flatMap(all)] : [root];
}
const text = (root) =>
  all(root)
    .filter((x) => typeof x === "string")
    .join(" ");
const find = (root, id) => all(root).find((x) => x?.attrs?.id?.[0] === id);
const theme = () => new Proxy({}, { get: (_, key) => String(key) });
const counts = { critical: 0, high: 1, medium: 0, low: 0, unknown: 0 };
const alert = {
  number: 7,
  severity: "high",
  package: "sample-lib",
  ecosystem: "npm",
  summary: "Example advisory",
  description: "Fictional description",
  manifest: "package-lock.json",
  scope: "runtime",
  vulnerableRange: "<2",
  patched: "2.0",
  ghsa: "GHSA-demo",
  cve: "CVE-DEMO",
  url: "https://github.com/example/demo/security/dependabot/7",
};

async function harness(role = "panel") {
  const source = (await readFile(new URL("../mods/dependabot/main.js", import.meta.url), "utf8"))
    .replace(/^import [\s\S]*?;\n/gm, "")
    .replace("export default class Dependabot", "return class Dependabot");
  const tasks = [],
    commands = [],
    urls = [];
  let fail = false;
  const exec = async (_command, args) => ({
    code: 0,
    stdout: JSON.stringify(
      args.includes("discover")
        ? {
            version: 1,
            repositories: [{ repository: "example/demo", paths: ["/fixture/demo"] }],
            warnings: [],
          }
        : {
            version: 1,
            repository: "example/demo",
            status: fail ? "unavailable" : "ok",
            alerts: fail ? [] : [alert],
            counts: fail ? null : counts,
            fetchedAt: new Date().toISOString(),
            ...(fail ? { error: "GitHub rate limit reached" } : {}),
          },
    ),
  });
  const state = {
    value: () => state.text,
    text: "",
    on: (_event, fn) => {
      state.change = fn;
    },
    focus() {},
  };
  const api = {
    View: class {},
    div: node,
    h_flex: node,
    v_flex: node,
    Input: { new: node },
    InputState: { new: () => state },
    theme,
    exec,
    props: () => ({ role }),
    run: (...args) => commands.push(args),
    layout: () => ({
      id: "root",
      children: [{ id: "panel" }, { id: "panel-body" }, { id: "dependabot-panel" }],
    }),
    focused: () => ({ space: "fixture-space" }),
    nextCommand: () => new Promise(() => {}),
    notify: () => {},
    config: { command: "node", args: [] },
    ...model,
    ...client,
  };
  const Class = new Function(...Object.keys(api), source)(...Object.values(api));
  const cx = {
    focus_handle: () => ({}),
    timer: { every() {} },
    spawn(fn) {
      tasks.push(fn(cx));
    },
    notify() {},
    open_url: (url) => urls.push(url),
  };
  const view = new Class();
  view.init({}, cx);
  const settle = async () => {
    await Promise.all(tasks.slice(1));
  };
  return {
    view,
    cx,
    state,
    commands,
    urls,
    settle,
    fail: () => {
      fail = true;
    },
  };
}

test("native view renders asynchronous loading, results, repository selection and details", async () => {
  const h = await harness();
  assert.match(text(h.view.render()), /Refreshing|Discovering/);
  await h.settle();
  let root = h.view.render();
  assert.match(text(root), /1 confirmed open/);
  find(root, "repo-example/demo").handlers.click({}, h.cx);
  root = h.view.render();
  assert.match(text(root), /sample-lib/);
  find(root, "alert-7").handlers.click({}, h.cx);
  root = h.view.render();
  assert.match(text(root), /Fictional description/);
  assert.match(text(root), /2.0/);
  find(root, "alert-github").handlers.click({}, h.cx);
  assert.deepEqual(h.urls, [alert.url]);
  h.state.text = "absent-query";
  h.state.change({}, h.cx);
  assert.match(text(h.view.render()), /No repositories match/);
  h.state.text = "";
  h.state.change({}, h.cx);
  find(h.view.render(), "severity-low").handlers.click({}, h.cx);
  assert.match(text(h.view.render()), /No repositories match/);
});

test("refresh failure preserves previous results with explicit stale and unavailable labels", async () => {
  const h = await harness();
  await h.settle();
  h.fail();
  h.view.selected = "example/demo";
  h.view.refresh(h.cx);
  await h.settle();
  const result = text(h.view.render());
  assert.match(result, /0 confirmed open/);
  assert.match(result, /1 unavailable/);
  assert.match(result, /previous count 1/);
  assert.match(result, /Previous results/);
  assert.match(result, /sample-lib/);
});

test("launcher does not fetch and opens existing side panel through app commands", async () => {
  const h = await harness("strip");
  find(h.view.render(), "dependabot-open").handlers.click({}, h.cx);
  assert.deepEqual(h.commands, [
    ["layout.show", { id: "panel" }],
    ["layout.select", { stack: "panel-body", child: "dependabot-panel" }],
  ]);
  assert.equal(h.view.rows.length, 0);
});
