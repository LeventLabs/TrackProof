import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { MemoryAnchorStore } from "@trackproof/core";
import { formatEvidenceReport, gatherEvidence } from "./evidence.js";
import { FixtureMarketData } from "./fixtures.js";
import { anchorRun, runAgents } from "./runner.js";

const HOUR = 60 * 60 * 1000;
const NOW = 1_700_000_000_000;

test("gatherEvidence aggregates counts, per-agent inclusion, Tier-2 badge, and >=3 fake catches", async () => {
  const baseDir = await mkdtemp(join(tmpdir(), "trackproof-ev-"));
  try {
    const source = new FixtureMarketData();
    await runAgents({ baseDir, source, lookbackMs: 12 * HOUR, settleGuardMs: HOUR, maxPerAgent: 40, now: () => NOW });
    const anchorStore = new MemoryAnchorStore();
    await anchorRun(anchorStore, { baseDir });

    const report = await gatherEvidence({ baseDir, source, anchorStore, verifySample: 30, tier2Sample: 10 });

    assert.equal(report.totals.agents, 3);
    assert.ok(report.totals.capsules > 0, "should have capsules");
    assert.equal(report.totals.verifiedPassed, report.totals.sampled, "every fixture capsule passes G1");
    assert.equal(report.totals.inclusionAgents, 3, "inclusion proof verified per agent");
    assert.equal(report.totals.tier2Agents, 1, "only the breakout agent is Tier-2");
    assert.ok(report.totals.fakeCatches >= 3, `expected >=3 catches, got ${report.totals.fakeCatches}`);
    assert.equal(report.baseline.inclusionPerAgent, true);
    assert.equal(report.baseline.fakeCatches, true);

    const text = formatEvidenceReport(report);
    assert.match(text, /verifiable usage evidence/);
    assert.match(text, /Caught fakes \(\d+ seeded, \d+ capsule-level catches\)/);
    assert.match(text, /Baseline \(R11\.2\)/);
  } finally {
    await rm(baseDir, { recursive: true, force: true });
  }
});

test("without an anchorStore, inclusion is not claimed (honest)", async () => {
  const baseDir = await mkdtemp(join(tmpdir(), "trackproof-ev-"));
  try {
    const source = new FixtureMarketData();
    await runAgents({ baseDir, source, lookbackMs: 6 * HOUR, settleGuardMs: HOUR, maxPerAgent: 20, now: () => NOW });
    const report = await gatherEvidence({ baseDir, source, verifySample: 12, tier2Sample: 6 });
    assert.equal(report.totals.inclusionAgents, 0);
    assert.equal(report.baseline.inclusionPerAgent, false);
  } finally {
    await rm(baseDir, { recursive: true, force: true });
  }
});
