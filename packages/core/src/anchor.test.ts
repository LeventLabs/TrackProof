import { test } from "node:test";
import assert from "node:assert/strict";
import { generateAgentKeyPair } from "./keys.js";
import { appendCapsule } from "./chain.js";
import { capsuleLeaf, type SignedCapsule, type TradeDecisionBody } from "./capsule.js";
import {
  MemoryAnchorStore,
  anchorCapsules,
  isCertifiable,
  verifyCommitment,
  verifyInclusion,
} from "./anchor.js";

function body(): TradeDecisionBody {
  return {
    market_ref: { venue: "bitget", instrument: "BTCUSDT", decision_time: 1, candles: { granularity: "1m", window: [1, 2] } },
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

test("MemoryAnchorStore is monotonic, append-only, and uses the injected clock", async () => {
  let now = 1000;
  const store = new MemoryAnchorStore(() => now);
  const r1 = await store.submitRoot("aa");
  now = 2000;
  const r2 = await store.submitRoot("bb");
  assert.deepEqual(r1, { root: "aa", block: 1, timestamp: 1000 });
  assert.deepEqual(r2, { root: "bb", block: 2, timestamp: 2000 });
  assert.deepEqual(await store.submitRoot("aa"), r1); // append-only: same record
  assert.deepEqual(await store.getByRoot("bb"), r2);
  assert.deepEqual(await store.getByBlock(1), r1);
});

test("anchorCapsules anchors a batch; each capsule's inclusion verifies", async () => {
  const chain = chainOf(3);
  const store = new MemoryAnchorStore(() => 5000);
  const { record, proofs } = await anchorCapsules(store, chain);
  for (const capsule of chain) {
    assert.ok(verifyInclusion(capsule, proofs.get(capsuleLeaf(capsule))!, record));
  }
  const outsider = chainOf(1)[0]!;
  assert.equal(verifyInclusion(outsider, [], record), false);
});

test("certifiability requires the anchor to precede the outcome start (R4.4)", () => {
  const record = { root: "aa", block: 1, timestamp: 1000 };
  assert.equal(isCertifiable(record, 1001), true);
  assert.equal(isCertifiable(record, 1000), false);
  assert.equal(isCertifiable(record, 999), false);
});

test("verifyCommitment composes inclusion + certifiability", async () => {
  const chain = chainOf(2);
  const store = new MemoryAnchorStore(() => 1000);
  const { record, proofs } = await anchorCapsules(store, chain);
  const capsule = chain[0]!;
  const proof = proofs.get(capsuleLeaf(capsule))!;

  const certified = verifyCommitment(capsule, proof, record, 2000);
  assert.equal(certified.included, true);
  assert.equal(certified.certifiable, true);

  const late = verifyCommitment(capsule, proof, record, 500);
  assert.equal(late.included, true);
  assert.equal(late.certifiable, false);

  const badProof = verifyCommitment(capsule, [], record, 2000);
  assert.equal(badProof.included, false);
  assert.equal(badProof.certifiable, false);
});
