import test from "node:test";
import assert from "node:assert/strict";
import { alerts } from "../dist/core.js";

test("tool-manager notices before HTTP headers do not hide real alerts", async () => {
  const result = await alerts("example/demo", {
    runner: async () =>
      "mise ~/.config/mise/config.toml tools: gh@2.103.3\nHTTP/2.0 200 OK\r\nContent-Type: application/json\r\n\r\n" +
      JSON.stringify([
        {
          number: 1,
          state: "open",
          security_vulnerability: { severity: "high" },
          security_advisory: { summary: "Fictional advisory" },
        },
      ]),
  });
  assert.equal(result.status, "ok");
  assert.equal(result.counts.high, 1);
  assert.equal(result.alerts.length, 1);
});
