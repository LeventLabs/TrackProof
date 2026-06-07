import { test } from "node:test";
import assert from "node:assert/strict";
import { generateAgentKeyPair } from "./keys.js";
import { appendCapsule } from "./chain.js";
import {
  verifyCapsuleSignature,
  capsuleLeaf,
  GENESIS_PREV_HASH,
  type MemoryPurchaseBody,
  type TradeDecisionBody,
} from "./capsule.js";

function tradeBody(): TradeDecisionBody {
  return {
    market_ref: {
      venue: "bitget",
      instrument: "BTCUSDT",
      decision_time: 1_700_000_000_000,
      candles: { granularity: "1m", window: [1_700_000_000_000, 1_700_000_600_000] },
    },
    inputs_digest: "deadbeef",
    action: { side: "short", size: "1", type: "market" },
  };
}

test("sign and verify a trade_decision genesis capsule", () => {
  const kp = generateAgentKeyPair();
  const capsule = appendCapsule(
    null,
    { kind: "trade_decision", body: tradeBody(), committed_at: 1_700_000_000_500 },
    kp.publicKeyHex,
    kp.privateKey,
  );
  assert.equal(capsule.seq, 0);
  assert.equal(capsule.prev_hash, GENESIS_PREV_HASH);
  assert.equal(capsule.agent_id, kp.publicKeyHex);
  assert.ok(verifyCapsuleSignature(capsule));
});

test("tampering the body invalidates the signature", () => {
  const kp = generateAgentKeyPair();
  const capsule = appendCapsule(
    null,
    { kind: "trade_decision", body: tradeBody(), committed_at: 1 },
    kp.publicKeyHex,
    kp.privateKey,
  );
  const tampered = structuredClone(capsule);
  (tampered.body as TradeDecisionBody).action.size = "999";
  assert.equal(verifyCapsuleSignature(tampered), false);
});

test("a memory_purchase capsule signs and verifies", () => {
  const kp = generateAgentKeyPair();
  const body: MemoryPurchaseBody = {
    slice_id: "slice-1",
    seller_agent_id: "abcd",
    price: "12",
    payment_ref: "x402:0xfeed",
    body_hash: "beef",
  };
  const capsule = appendCapsule(
    null,
    { kind: "memory_purchase", body, committed_at: 2 },
    kp.publicKeyHex,
    kp.privateKey,
  );
  assert.equal(capsule.kind, "memory_purchase");
  assert.ok(verifyCapsuleSignature(capsule));
});

test("capsuleLeaf differs when content differs", () => {
  const kp = generateAgentKeyPair();
  const a = appendCapsule(null, { kind: "trade_decision", body: tradeBody(), committed_at: 1 }, kp.publicKeyHex, kp.privateKey);
  const b = appendCapsule(null, { kind: "trade_decision", body: tradeBody(), committed_at: 2 }, kp.publicKeyHex, kp.privateKey);
  assert.notEqual(capsuleLeaf(a), capsuleLeaf(b));
});
