import test from "node:test";
import assert from "node:assert/strict";
import { openTab } from "../mods/dependabot/client.js";

test("launcher creates a full mod tab in the current local space", () => {
  const calls = [];
  assert.equal(
    openTab({
      spaces: [{ id: "local", active: true, tabs: [] }],
      panes: [],
      run: (...a) => calls.push(a),
      mod: "dependabot",
      name: "Dependabot",
      props: { role: "dashboard" },
    }),
    true,
  );
  assert.deepEqual(calls, [
    [
      "tab.new",
      { space: "local", name: "Dependabot", mod: "dependabot", props: { role: "dashboard" } },
    ],
  ]);
});
test("launcher reuses matching tab and does not create duplicate dashboards", () => {
  const calls = [];
  openTab({
    spaces: [{ id: "local", active: true, tabs: [{ id: "tab" }] }],
    panes: [{ tab: "tab", mod: "dependabot", pane: "pane" }],
    run: (...a) => calls.push(a),
    mod: "dependabot",
    name: "Dependabot",
  });
  assert.deepEqual(calls, [
    ["space.select", { id: "local" }],
    ["tab.select", { id: "tab" }],
    ["pane.focus", { pane: "pane" }],
  ]);
});
test("remote spaces are never selected to run local backend and no-space returns false", () => {
  const calls = [];
  const options = {
    spaces: [
      { id: "remote", active: true, machine: "server", tabs: [] },
      { id: "local", tabs: [] },
    ],
    panes: [],
    run: (...a) => calls.push(a),
    mod: "dependabot",
    name: "Dependabot",
  };
  openTab(options);
  assert.equal(calls[0][1].space, "local");
  assert.equal(openTab({ ...options, spaces: options.spaces.slice(0, 1) }), false);
  assert.equal(calls.length, 1);
});
