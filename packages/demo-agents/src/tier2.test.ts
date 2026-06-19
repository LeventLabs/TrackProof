import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { SignedCapsule, TradeDecisionBody } from "@trackproof/core";
import { openStore, readChain } from "@trackproof/sdk";
import { TIER2_AGENT_KEY } from "./agents.js";
import { FixtureMarketData } from "./fixtures.js";
import { runAgents } from "./runner.js";
import { rederive, rederiveChain } from "./tier2.js";

const HOUR = 60 * 60 * 1000;
const NOW = 1_700_000_000_000;

async function runFixture(baseDir: string) {
  const source = new FixtureMarketData();
  await runAgents({ baseDir, source, lookbackMs: 12 * HOUR, settleGuardMs: HOUR, maxPerAgent: 30, now: () => NOW });
  return source;
}

function chainOf(baseDir: string, key: string): SignedCapsule[] {
  return readChain(openStore(join(baseDir, key)));
}

test("the Tier-2 (breakout) agent's capsules re-derive from repro {strategy_hash, seed}", async () => {
  const baseDir = await mkdtemp(join(tmpdir(), "trackproof-tier2-"));
  try {
    const source = await runFixture(baseDir);
    const chain = chainOf(baseDir, TIER2_AGENT_KEY);
    const sample = chain[Math.floor(chain.length / 2)]!;
    assert.ok((sample.body as TradeDecisionBody).repro, "breakout capsule must carry repro");

    const result = await rederive(sample, source);
    assert.equal(result.reproducible, true, result.reason);

    const summary = await rederiveChain(chain, source);
    assert.ok(summary.reproCapsules > 0);
    assert.equal(summary.reproduced, summary.reproCapsules);
    assert.equal(summary.badge, true);
  } finally {
    await rm(baseDir, { recursive: true, force: true });
  }
});

test("a Tier-1 (momentum) capsule is not reproducible (no repro) and earns no badge", async () => {
  const baseDir = await mkdtemp(join(tmpdir(), "trackproof-tier2-"));
  try {
    const source = await runFixture(baseDir);
    const chain = chainOf(baseDir, "momentum");
    const result = await rederive(chain[0]!, source);
    assert.equal(result.reproducible, false);
    assert.match(result.reason ?? "", /no repro/);

    const summary = await rederiveChain(chain, source);
    assert.equal(summary.reproCapsules, 0);
    assert.equal(summary.badge, false);
  } finally {
    await rm(baseDir, { recursive: true, force: true });
  }
});

test("a tampered action does not re-derive (Tier-2 catches it)", async () => {
  const baseDir = await mkdtemp(join(tmpdir(), "trackproof-tier2-"));
  try {
    const source = await runFixture(baseDir);
    const original = chainOf(baseDir, TIER2_AGENT_KEY)[0]!;
    const body = original.body as TradeDecisionBody;
    const tampered: SignedCapsule = {
      ...original,
      body: { ...body, action: { ...body.action, side: body.action.side === "long" ? "short" : "long" } },
    };
    const result = await rederive(tampered, source);
    assert.equal(result.reproducible, false);
    assert.match(result.reason ?? "", /did not re-derive/);
  } finally {
    await rm(baseDir, { recursive: true, force: true });
  }
});
