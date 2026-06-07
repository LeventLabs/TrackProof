import { test } from "node:test";
import assert from "node:assert/strict";
import { generateAgentKeyPair } from "./keys.js";
import { appendCapsule, verifyChain } from "./chain.js";
import type { SignedCapsule, TradeDecisionBody } from "./capsule.js";

function body(): TradeDecisionBody {
  return {
    market_ref: {
      venue: "bitget",
      instrument: "BTCUSDT",
      decision_time: 1,
      candles: { granularity: "1m", window: [1, 2] },
    },
    inputs_digest: "aa",
    action: { side: "long", size: "1", type: "market" },
  };
}

function chainOf(n: number): SignedCapsule[] {
  const kp = generateAgentKeyPair();
  const out: SignedCapsule[] = [];
  let prev: SignedCapsule | null = null;
  for (let i = 0; i < n; i++) {
    prev = appendCapsule(prev, { kind: "trade_decision", body: body(), committed_at: i + 1 }, kp.publicKeyHex, kp.privateKey);
    out.push(prev);
  }
  return out;
}

test("a well-formed chain verifies", () => {
  const result = verifyChain(chainOf(3));
  assert.ok(result.ok, result.reason);
  assert.equal(result.length, 3);
});

test("deleting a middle capsule (gap) is detected", () => {
  const chain = chainOf(3);
  const broken = [chain[0]!, chain[2]!]; // drop seq 1
  const result = verifyChain(broken);
  assert.equal(result.ok, false);
  assert.equal(result.firstBadSeq, 2);
});

test("tampering a prev_hash is detected", () => {
  const chain = structuredClone(chainOf(3));
  chain[2]!.prev_hash = "0".repeat(64);
  const result = verifyChain(chain);
  assert.equal(result.ok, false);
  assert.equal(result.firstBadSeq, 2);
});

test("splicing in another agent's capsule breaks the chain", () => {
  const a = chainOf(2);
  const b = chainOf(1);
  const result = verifyChain([a[0]!, b[0]!]); // b[0] has seq 0 where seq 1 is expected
  assert.equal(result.ok, false);
  assert.equal(result.firstBadSeq, 0);
});
