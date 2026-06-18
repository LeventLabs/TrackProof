import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadAnchor, openStore, saveAnchor } from "./store.js";

test("loadAnchor returns null when nothing is anchored yet", () => {
  const home = mkdtempSync(join(tmpdir(), "tp-store-"));
  try {
    assert.equal(loadAnchor(openStore(home)), null);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("saveAnchor/loadAnchor round-trips the root and per-leaf proofs", () => {
  const home = mkdtempSync(join(tmpdir(), "tp-store-"));
  try {
    const store = openStore(home);
    const anchor = { root: "ab".repeat(32), proofs: { leafA: ["p1", "p2"], leafB: [] } };
    saveAnchor(store, anchor);
    assert.deepEqual(loadAnchor(store), anchor);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
