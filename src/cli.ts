#!/usr/bin/env node
import { parseArgs } from "node:util";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { alerts, discover } from "./core.js";

try {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      root: { type: "string", multiple: true },
      config: { type: "string" },
      help: { type: "boolean" },
    },
  });
  if (values.help) {
    console.log(
      "node dist/cli.js discover [--root PATH ...] [--config FILE]\nnode dist/cli.js alerts owner/repo\nRead-only GitHub.com security alerts; uses existing gh authentication.",
    );
  } else if (positionals[0] === "discover") {
    let roots = values.root;
    if (!roots) {
      const file =
        values.config ??
        process.env.DEPENDABOT_CONFIG ??
        join(homedir(), ".config/herdr-app-dependabot/config.json");
      try {
        const config = JSON.parse(await readFile(file, "utf8"));
        if (
          !Array.isArray(config.roots) ||
          !config.roots.length ||
          config.roots.some((r: unknown) => typeof r !== "string" || !r.trim())
        )
          throw new Error("Config roots must be a nonempty array of paths");
        roots = config.roots;
      } catch (error) {
        if (
          (error as NodeJS.ErrnoException).code !== "ENOENT" ||
          values.config ||
          process.env.DEPENDABOT_CONFIG
        )
          throw error;
      }
    }
    console.log(JSON.stringify(await discover(roots)));
  } else if (positionals[0] === "alerts" && positionals[1])
    console.log(JSON.stringify(await alerts(positionals[1])));
  else throw new Error("Use --help for commands");
} catch (error) {
  console.error(error instanceof Error ? error.message : "Command failed");
  process.exitCode = 1;
}
