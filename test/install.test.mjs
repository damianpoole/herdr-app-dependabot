import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm, cp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { integrateLayout } from "../scripts/layout.mjs";

const layout = () => ({
  id: "root",
  type: "column",
  theme: "mine",
  children: [
    { id: "tabs", type: "block", content: { mod: "tabs" }, size: { px: 31 } },
    { id: "ship-it", type: "block", content: { mod: "ship-it" } },
    {
      id: "panel-body",
      type: "stack",
      active: "files",
      hidden: true,
      children: [
        { id: "files", type: "block", content: { mod: "files", props: { custom: true } } },
      ],
    },
  ],
});

test("launcher is below tabs, not beside Ship-it; selection and unrelated content survive", () => {
  const before = layout();
  const after = integrateLayout(before);
  assert.deepEqual(before, layout());
  assert.deepEqual(after.children[0], before.children[0]);
  assert.deepEqual(after.children[1], {
    id: "dependabot-strip",
    type: "block",
    size: { px: 40 },
    content: { mod: "dependabot", props: { role: "strip" } },
  });
  assert.deepEqual(after.children[2], before.children[1]);
  assert.equal(after.children[3].active, "files");
  assert.equal(after.children[3].hidden, true);
  assert.deepEqual(after.children[3].children[0], before.children[2].children[0]);
  assert.equal(after.children[3].children[1].id, "dependabot-panel");
  assert.deepEqual(integrateLayout(after), after);
});

test("no panel stack needs only a launcher; nested tabs are supported", () => {
  const tree = layout();
  tree.children.pop();
  const nested = { type: "row", children: [tree] };
  const after = integrateLayout(nested);
  assert.equal(after.children[0].children[1].id, "dependabot-strip");
  assert.doesNotMatch(JSON.stringify(after), /dependabot-panel/);
  assert.deepEqual(integrateLayout(after), after);
  tree.children.push({ id: "panel-body", type: "block", content: { mod: "personal" } });
  assert.deepEqual(integrateLayout(tree).children.at(-1), tree.children.at(-1));
});

test("conflicting and duplicate IDs fail rather than replace content", () => {
  for (const id of ["dependabot-strip", "dependabot-panel"]) {
    const tree = layout();
    tree.children.push({ id, type: "block", content: { mod: "personal" } });
    assert.throws(() => integrateLayout(tree), /belongs to another/);
  }
  const tree = layout();
  tree.floating = [{ id: "tabs", type: "block" }];
  assert.throws(() => integrateLayout(tree), /Duplicate/);
  assert.throws(() => integrateLayout({ type: "column", children: [] }), /No tabs/);
});

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), "dependabot install ' "));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const project = join(dir, "project"),
    home = join(dir, "home"),
    bin = join(dir, "bin");
  await mkdir(project);
  await cp(fileURLToPath(new URL("../scripts", import.meta.url)), join(project, "scripts"), {
    recursive: true,
  });
  for (const folder of ["mods/dependabot", "dist"])
    await mkdir(join(project, folder), { recursive: true });
  for (const file of ["main.js", "model.js", "client.js", "mod.json"])
    await writeFile(
      join(project, "mods/dependabot", file),
      file === "mod.json" ? '{"place":"none"}' : `// ${file}\n`,
    );
  await writeFile(join(project, "mods/dependabot/config.js"), "DO NOT COPY");
  await writeFile(join(project, "dist/cli.js"), "// fixture backend");
  await mkdir(join(home, "layouts"), { recursive: true });
  await mkdir(bin);
  const original = JSON.stringify(layout());
  await writeFile(join(home, "layouts/main.json"), original);
  await writeFile(join(home, "layouts/personal.json"), original);
  const state = '{"layout":"main","selection":"untouched"}';
  for (const file of ["view.json", "shared.json"]) await writeFile(join(home, file), state);
  const run = (args = [], env = {}) =>
    spawnSync(
      process.execPath,
      [join(project, "scripts/install.mjs"), "--home", home, "--layout", "personal", ...args],
      {
        encoding: "utf8",
        env: { ...process.env, ...env, PATH: `${bin}:${process.env.PATH}` },
      },
    );
  const stub = async (body) =>
    writeFile(join(bin, "herdr-app"), `#!${process.execPath}\n${body}\n`, { mode: 0o755 });
  return { dir, project, home, original, run, stub, state };
}
const success = (result) => assert.equal(result.status, 0, result.stderr);
const failure = (result, message) => {
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, message);
};

test("isolated install copies native modules, generates Node config, owns updates and backs up uniquely", async (t) => {
  const f = await fixture(t);
  success(f.run(["--skip-check"]));
  const mod = join(f.home, "mods/dependabot");
  for (const file of ["main.js", "model.js", "client.js", "mod.json"])
    assert.equal(
      await readFile(join(mod, file), "utf8"),
      await readFile(join(f.project, "mods/dependabot", file), "utf8"),
    );
  const configText = await readFile(join(mod, "config.js"), "utf8");
  const config = JSON.parse(configText.split("export default ")[1].trim().replace(/;$/, ""));
  assert.deepEqual(config, {
    command: process.execPath,
    args: [resolve(f.project, "dist/cli.js")],
  });
  assert.equal(
    JSON.parse(await readFile(join(mod, ".dependabot-install.json"), "utf8")).package,
    "herdr-app-dependabot",
  );
  const target = join(f.home, "layouts/personal.json");
  const installed = await readFile(target, "utf8");
  success(f.run(["--skip-check"]));
  assert.equal(await readFile(target, "utf8"), installed);
  await writeFile(target, JSON.stringify({ ...layout(), theme: "new personal theme" }));
  success(f.run(["--skip-check"]));
  const backups = (await readdir(join(f.home, "layouts"))).filter((name) =>
    name.includes(".before-dependabot-"),
  );
  assert.equal(backups.length, 2);
  assert.ok(
    (
      await Promise.all(backups.map((name) => readFile(join(f.home, "layouts", name), "utf8")))
    ).includes(f.original),
  );
  assert.equal(await readFile(join(f.home, "layouts/main.json"), "utf8"), f.original);
  for (const file of ["view.json", "shared.json"])
    assert.equal(await readFile(join(f.home, file), "utf8"), f.state);
  await rm(join(mod, ".dependabot-install.json"));
  failure(f.run(["--skip-check"]), /unmanaged mod/);
  assert.equal(
    await readFile(target, "utf8"),
    JSON.stringify(integrateLayout({ ...layout(), theme: "new personal theme" }), null, 2) + "\n",
  );
});

test("clone never edits source or replaces an existing target; shipped manifests are respected", async (t) => {
  const f = await fixture(t);
  success(f.run(["--layout", "mine", "--from", "main", "--skip-check"]));
  assert.equal(await readFile(join(f.home, "layouts/main.json"), "utf8"), f.original);
  failure(f.run(["--layout", "mine", "--from", "main", "--skip-check"]), /already exists/);
  for (const name of ["main", "terminals", "win98"])
    failure(f.run(["--layout", name, "--skip-check"]), /personal layout/);
  await writeFile(
    join(f.home, "installed.json"),
    JSON.stringify({ "layout:personal": { json: "hash" } }),
  );
  failure(f.run(["--skip-check"]), /shipped layout/);
  failure(f.run(["--layout", "../escape", "--skip-check"]), /personal layout/);
});

test("check is mandatory, receives the selected home, and precedes any layout write", async (t) => {
  const f = await fixture(t);
  await f.stub(`const fs = require('node:fs');
    if (process.argv[2] !== 'check' || process.env.HERDR_APP_HOME !== ${JSON.stringify(f.home)}) process.exit(8);
    if (fs.readFileSync(${JSON.stringify(join(f.home, "layouts/personal.json"))}, 'utf8') !== ${JSON.stringify(f.original)}) process.exit(9);
    process.exit(1);`);
  failure(f.run(), /Mod check failed/);
  assert.equal(await readFile(join(f.home, "layouts/personal.json"), "utf8"), f.original);
  assert.equal((await readdir(join(f.home, "layouts"))).length, 2);
  await f.stub("process.exit(process.argv[2] === 'check' ? 0 : 1);");
  success(f.run());
});

test("concurrent edits and newly created clone targets are preserved", async (t) => {
  const f = await fixture(t);
  const target = join(f.home, "layouts/personal.json");
  const concurrent = JSON.stringify({ ...layout(), theme: "concurrent" });
  await f.stub(
    `require('node:fs').writeFileSync(${JSON.stringify(target)}, ${JSON.stringify(concurrent)});`,
  );
  failure(f.run(), /Layout changed/);
  assert.equal(await readFile(target, "utf8"), concurrent);
  const clone = join(f.home, "layouts/clone.json");
  await f.stub(`require('node:fs').writeFileSync(${JSON.stringify(clone)}, 'concurrent clone');`);
  failure(f.run(["--layout", "clone", "--from", "main"]), /EEXIST/);
  assert.equal(await readFile(clone, "utf8"), "concurrent clone");
});

test("layout conflicts are detected before mod installation", async (t) => {
  const f = await fixture(t);
  const tree = layout();
  tree.children.push({ id: "dependabot-strip", type: "block", content: { mod: "mine" } });
  await writeFile(join(f.home, "layouts/personal.json"), JSON.stringify(tree));
  failure(f.run(["--skip-check"]), /belongs to another/);
  await assert.rejects(readFile(join(f.home, "mods/dependabot/main.js")), { code: "ENOENT" });
});
