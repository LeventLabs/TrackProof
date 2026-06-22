import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { verifyChain, verifyMemoryPurchase } from "@trackproof/core";
import { openStore, readChain } from "@trackproof/sdk";
import { DEMO_AGENTS } from "./agents.js";
import { FixtureMarketData } from "./fixtures.js";
import { gatherEvidence } from "./evidence.js";
import { runHandoffs } from "./handoffs.js";
import { runAgents } from "./runner.js";

test("runHandoffs appends verifiable memory_purchase capsules; chains stay valid; evidence counts them", async () => {
  const baseDir = mkdtempSync(join(tmpdir(), "tp-ho-"));
  const source = new FixtureMarketData();
  try {
    await runAgents({ baseDir, source, maxPerAgent: 20, step: 1 });
    const handoffs = await runHandoffs({ baseDir });
    assert.ok(handoffs.length >= 5, `expected >=5 handoffs, got ${handoffs.length}`);

    let memoryCapsules = 0;
    for (const agent of DEMO_AGENTS) {
      const chain = readChain(openStore(join(baseDir, agent.key)));
      assert.ok(verifyChain(chain).ok, `chain for ${agent.key} should stay valid (G3)`);
      for (const c of chain) {
        if (c.kind === "memory_purchase") {
          memoryCapsules++;
          assert.equal(verifyMemoryPurchase(c).verdict, "PASSED");
        }
      }
    }
    assert.ok(memoryCapsules >= 5);

    const report = await gatherEvidence({ baseDir, source, verifySample: 6, tier2Sample: 3 });
    assert.equal(report.totals.handoffs, memoryCapsules);
    assert.equal(report.baseline.handoffs, true);
  } finally {
    rmSync(baseDir, { recursive: true, force: true });
  }
});
