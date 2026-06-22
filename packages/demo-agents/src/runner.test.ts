import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { capsuleLeaf, MemoryAnchorStore, verifyCapsule, verifyChain, verifyInclusion, type TradeDecisionBody } from "@trackproof/core";
import { loadAnchor, openStore, readChain } from "@trackproof/sdk";
import { DEMO_AGENTS, TIER2_AGENT_KEY } from "./agents.js";
import { FixtureMarketData } from "./fixtures.js";
import { anchorRun, runAgents } from "./runner.js";

const HOUR = 60 * 60 * 1000;
const NOW = 1_700_000_000_000;

function freshBaseDir(): string {
  return mkdtempSync(join(tmpdir(), "trackproof-demo-"));
}

function runConfig(baseDir: string) {
  return {
    baseDir,
    source: new FixtureMarketData(),
    lookbackMs: 12 * HOUR,
    settleGuardMs: HOUR,
    maxPerAgent: 40,
    now: () => NOW,
  };
}

test("runner emits a verifiable chain per agent over fixture history", async () => {
  const baseDir = freshBaseDir();
  try {
    const results = await runAgents(runConfig(baseDir));
    assert.equal(results.length, DEMO_AGENTS.length);

    for (const r of results) {
      assert.ok(r.emitted > 0, `${r.key} emitted nothing`);
      const chain = readChain(openStore(r.home));
      assert.equal(chain.length, r.emitted, `${r.key} chain length != emitted`);
      const check = verifyChain(chain);
      assert.ok(check.ok, `${r.key} chain broken at seq ${check.firstBadSeq}: ${check.reason}`);
    }
  } finally {
    rmSync(baseDir, { recursive: true, force: true });
  }
});

test("a sampled capsule passes G1 and settles against the same source", async () => {
  const baseDir = freshBaseDir();
  try {
    const source = new FixtureMarketData();
    const [first] = await runAgents({ ...runConfig(baseDir), source });
    const chain = readChain(openStore(first!.home));
    const sample = chain[Math.floor(chain.length / 2)]!;
    const result = await verifyCapsule(sample, source);
    assert.equal(result.kind, "trade_decision");
    assert.equal(result.verdict, "PASSED");
    if (result.kind === "trade_decision") {
      assert.equal(result.outcome, "settled");
      assert.ok(result.pnl !== undefined, "settled trade should have P&L");
    }
  } finally {
    rmSync(baseDir, { recursive: true, force: true });
  }
});

test("only the Tier-2 agent carries a repro badge (never generalized)", async () => {
  const baseDir = freshBaseDir();
  try {
    const results = await runAgents(runConfig(baseDir));
    for (const r of results) {
      const chain = readChain(openStore(r.home));
      const withRepro = chain.filter((cap) => (cap.body as TradeDecisionBody).repro !== undefined).length;
      if (r.key === TIER2_AGENT_KEY) {
        assert.equal(withRepro, chain.length, "every Tier-2 capsule must carry repro");
        const repro = (chain[0]!.body as TradeDecisionBody).repro!;
        assert.match(repro.strategy_hash, /^[0-9a-f]{64}$/);
        assert.ok(repro.seed.length > 0);
      } else {
        assert.equal(withRepro, 0, `${r.key} (Tier-1) must not carry repro`);
      }
    }
  } finally {
    rmSync(baseDir, { recursive: true, force: true });
  }
});

test("the run is deterministic: a fresh re-run reproduces byte-identical chains", async () => {
  const baseDir = freshBaseDir();
  try {
    const r1 = await runAgents(runConfig(baseDir));
    const snapshot1 = r1.map((r) => readFileSync(join(r.home, "chain.jsonl"), "utf8"));
    // Re-run in the SAME dir: fresh clears chains but the persistent key is reused, so the
    // signed capsules are byte-identical (Ed25519 is deterministic).
    const r2 = await runAgents(runConfig(baseDir));
    const snapshot2 = r2.map((r) => readFileSync(join(r.home, "chain.jsonl"), "utf8"));
    assert.deepEqual(
      r2.map((r) => r.emitted),
      r1.map((r) => r.emitted),
    );
    assert.deepEqual(snapshot2, snapshot1);
  } finally {
    rmSync(baseDir, { recursive: true, force: true });
  }
});

test("anchorRun anchors each agent's chain and the saved inclusion proofs verify", async () => {
  const baseDir = freshBaseDir();
  try {
    await runAgents(runConfig(baseDir));
    const anchorStore = new MemoryAnchorStore();
    const anchors = await anchorRun(anchorStore, { baseDir });
    assert.equal(anchors.length, DEMO_AGENTS.length);

    for (const a of anchors) {
      assert.match(a.root, /^[0-9a-f]{64}$/);
      const store = openStore(join(baseDir, a.key));
      const chain = readChain(store);
      assert.equal(a.proofs, chain.length, `${a.key}: one proof per capsule`);

      const anchorFile = loadAnchor(store);
      assert.ok(anchorFile, `${a.key}: anchor.json saved`);
      const record = await anchorStore.getByRoot(anchorFile!.root);
      assert.ok(record, `${a.key}: root readable from the store`);

      for (const cap of chain) {
        const proof = anchorFile!.proofs[capsuleLeaf(cap)];
        assert.ok(proof, `${a.key}: proof present for seq ${cap.seq}`);
        assert.ok(verifyInclusion(cap, proof!, record!), `${a.key}: inclusion failed at seq ${cap.seq}`);
      }
    }
  } finally {
    rmSync(baseDir, { recursive: true, force: true });
  }
});
