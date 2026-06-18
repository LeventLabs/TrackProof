import { test } from "node:test";
import assert from "node:assert/strict";
import { toAnchorRecord, toBytes32 } from "./anchor-store.js";

test("toBytes32 normalizes a 64-hex root (with or without 0x)", () => {
  assert.equal(toBytes32("a".repeat(64)), `0x${"a".repeat(64)}`);
  assert.equal(toBytes32(`0x${"b".repeat(64)}`), `0x${"b".repeat(64)}`);
});

test("toBytes32 rejects a wrong-length root", () => {
  assert.throws(() => toBytes32("abcd"));
});

test("toAnchorRecord maps on-chain seconds to ms; 0 timestamp = not anchored", () => {
  assert.equal(toAnchorRecord("aa", 100n, 0n), null);
  assert.deepEqual(toAnchorRecord("aa", 100n, 1700n), { root: "aa", block: 100, timestamp: 1_700_000 });
});
