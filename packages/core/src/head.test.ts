import { test } from "node:test";
import assert from "node:assert/strict";
import { appendCapsule, verifyHead } from "./chain.js";
import { capsuleLeaf, type SignedCapsule } from "./capsule.js";
import { generateAgentKeyPair } from "./keys.js";

function chainOf(n: number): SignedCapsule[] {
  const kp = generateAgentKeyPair();
  const chain: SignedCapsule[] = [];
  let prev: SignedCapsule | null = null;
  for (let i = 0; i < n; i++) {
    const body = { slice_id: `s${i}`, seller_agent_id: "x", price: "1", payment_ref: "r", body_hash: "h" };
    const cap = appendCapsule(prev, { kind: "memory_purchase", body, committed_at: 1000 + i }, kp.publicKeyHex, kp.privateKey);
    chain.push(cap);
    prev = cap;
  }
  return chain;
}

test("verifyHead accepts a chain whose head matches the on-chain commitment", () => {
  const chain = chainOf(5);
  const last = chain[4]!;
  const r = verifyHead(chain, { seq: last.seq, headLeaf: capsuleLeaf(last) });
  assert.ok(r.ok);
  assert.equal(r.truncated, false);
});

test("verifyHead detects a withheld tail (truncation)", () => {
  const chain = chainOf(5);
  const last = chain[4]!;
  const committed = { seq: last.seq, headLeaf: capsuleLeaf(last) };
  const truncated = chain.slice(0, 3); // an operator drops the last 2 (e.g. losing) capsules
  const r = verifyHead(truncated, committed);
  assert.equal(r.ok, false);
  assert.equal(r.truncated, true);
  assert.match(r.reason ?? "", /withheld tail/);
});

test("verifyHead requires an on-chain head and matches the head leaf", () => {
  assert.equal(verifyHead(chainOf(2), null).ok, false);
  const chain = chainOf(3);
  // right seq, wrong leaf → not ok
  assert.equal(verifyHead(chain, { seq: 2, headLeaf: "deadbeef" }).ok, false);
});
