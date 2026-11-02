#!/usr/bin/env node
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve, relative, isAbsolute } from "node:path";
import { homedir, tmpdir } from "node:os";
import { access, mkdir, readFile, writeFile, copyFile, lstat, realpath } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { integrateLayout } from "./layout.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const exists = async (path) => {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
};
const validName = (name) => typeof name === "string" && /^[a-zA-Z0-9_-]+$/.test(name);
const defaultHome = join(homedir(), ".config/herdr-app");

try {
  const { values } = parseArgs({
    options: {
      home: { type: "string" },
      layout: { type: "string" },
      from: { type: "string" },
      "skip-check": { type: "boolean" },
      help: { type: "boolean" },
    },
  });
  if (values.help) {
    console.log(
      "node scripts/install.mjs [--home PATH] --layout PERSONAL [--from SOURCE]\n--skip-check is only for explicit temporary fixture homes.",
    );
  } else {
    if (!validName(values.layout)) throw new Error("--layout requires a personal layout name");
    if (values.from && !validName(values.from)) throw new Error("Invalid source layout name");
    const appHome = resolve(values.home ?? process.env.HERDR_APP_HOME ?? defaultHome);
    if (values["skip-check"]) {
      if (!values.home)
        throw new Error("--skip-check requires an explicit temporary fixture --home");
      const actual = await realpath(appHome);
      const rel = relative(await realpath(tmpdir()), actual);
      const live = await realpath(process.env.HERDR_APP_HOME ?? defaultHome).catch(() =>
        resolve(process.env.HERDR_APP_HOME ?? defaultHome),
      );
      if (
        !rel ||
        rel === ".." ||
        rel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) ||
        isAbsolute(rel) ||
        actual === live
      )
        throw new Error("--skip-check is only allowed for temporary fixture homes");
    }
    let installed = {};
    try {
      installed = JSON.parse(await readFile(join(appHome, "installed.json"), "utf8"));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    if (
      ["main", "terminals", "win98"].includes(values.layout) ||
      Object.hasOwn(installed, `layout:${values.layout}`)
    )
      throw new Error("Choose a personal layout name, not a shipped layout");
    const target = join(appHome, "layouts", `${values.layout}.json`);
    if (values.from && (await exists(target)))
      throw new Error("Target layout already exists; omit --from to update it");
    if (!values.from && (await lstat(target)).isSymbolicLink())
      throw new Error("Refusing a symlink layout");
    const original = await readFile(
      values.from ? join(appHome, "layouts", `${values.from}.json`) : target,
      "utf8",
    );
    const updated = JSON.stringify(integrateLayout(JSON.parse(original)), null, 2) + "\n";
    const destination = join(appHome, "mods/dependabot");
    const receipt = join(destination, ".dependabot-install.json");
    if (await exists(destination)) {
      let owner;
      try {
        owner = JSON.parse(await readFile(receipt, "utf8"));
      } catch {}
      if ((await lstat(destination)).isSymbolicLink() || owner?.package !== "herdr-app-dependabot")
        throw new Error(`Refusing to overwrite unmanaged mod: ${destination}`);
    }
    const backend = join(root, "dist/cli.js");
    await access(backend);
    const files = ["main.js", "model.js", "client.js", "mod.json"];
    for (const file of files) await access(join(root, "mods/dependabot", file));
    await mkdir(destination, { recursive: true });
    // Do not follow destination file symlinks, even inside a managed mod.
    for (const file of [...files, "config.js", ".dependabot-install.json"]) {
      if (
        (await exists(join(destination, file))) &&
        (await lstat(join(destination, file))).isSymbolicLink()
      )
        throw new Error(`Refusing mod file symlink: ${file}`);
    }
    for (const file of files)
      await copyFile(join(root, "mods/dependabot", file), join(destination, file));
    await writeFile(
      join(destination, "config.js"),
      `// Machine-local configuration.\nexport default ${JSON.stringify({ command: process.execPath, args: [backend] }, null, 2)};\n`,
    );
    await writeFile(
      receipt,
      JSON.stringify({ package: "herdr-app-dependabot", source: root, version: 1 }) + "\n",
    );
    if (!values["skip-check"]) {
      const checked = spawnSync("herdr-app", ["check", destination], {
        stdio: "inherit",
        env: { ...process.env, HERDR_APP_HOME: appHome },
      });
      if (checked.error || checked.status !== 0)
        throw new Error("Mod check failed; layout was not changed");
    }
    if (values.from) {
      // Exclusive creation also protects a target created during the check.
      await writeFile(target, updated, { flag: "wx" });
    } else {
      const unchanged = async () => {
        if ((await lstat(target)).isSymbolicLink() || (await readFile(target, "utf8")) !== original)
          throw new Error("Layout changed during installation; rerun to preserve those changes");
      };
      await unchanged();
      if (updated !== original) {
        const backup = `${target}.before-dependabot-${randomUUID()}`;
        await writeFile(backup, original, { flag: "wx" });
        await unchanged();
        await writeFile(target, updated);
        console.log(`Backup: ${backup}`);
      }
    }
    console.log(
      `Installed ${destination}\nBackend: ${backend}\nLayout: ${target}\nNo layout selection or shared state was changed.`,
    );
  }
} catch (error) {
  console.error(`install: ${error.message}`);
  process.exitCode = 1;
}
