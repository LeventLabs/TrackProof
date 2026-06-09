import { test } from "node:test";
import assert from "node:assert/strict";
import { parseArgs } from "./args.js";

test("parseArgs extracts the command and flags", () => {
  const { command, flags } = parseArgs(["emit", "--instrument", "BTCUSDT", "--demo"]);
  assert.equal(command, "emit");
  assert.equal(flags.instrument, "BTCUSDT");
  assert.equal(flags.demo, true);
});

test("parseArgs treats a leading flag as no command", () => {
  const { command, flags } = parseArgs(["--help"]);
  assert.equal(command, "");
  assert.equal(flags.help, true);
});

test("parseArgs handles a value-less flag before another flag", () => {
  const { flags } = parseArgs(["verify", "--last", "--with-anchor"]);
  assert.equal(flags.last, true);
  assert.equal(flags["with-anchor"], true);
});
